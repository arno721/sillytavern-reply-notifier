import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import test from 'node:test';
import { NativeNotifier, deliverNotification, sendNtfy, validateNtfySettings } from '../notifications.js';
import { normalizeSettings } from '../core.js';

const payload = { title: '酒館 · 回覆完成', body: '你好，朋友 🔔', tag: 'test', url: 'https://tavern.example/' };

async function withServer(handler, run) {
    const server = createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
        await run(`http://127.0.0.1:${server.address().port}`);
    } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    }
}

function nativeEnvironment(extra = {}) {
    return {
        isSecureContext: true,
        navigator: { userAgent: 'Desktop' },
        matchMedia: () => ({ matches: false }),
        Notification: { permission: 'granted', requestPermission: async () => 'granted' },
        ...extra,
    };
}

test('HTTP origins explain HTTPS requirements without prompting for permission', async () => {
    const notifier = new NativeNotifier({ environment: nativeEnvironment({ isSecureContext: false }) });
    assert.equal(notifier.status().code, 'INSECURE_CONTEXT');
    await assert.rejects(notifier.requestPermission(), { code: 'INSECURE_CONTEXT' });
});

test('iOS browser tabs explain the Home Screen requirement', () => {
    const notifier = new NativeNotifier({ environment: nativeEnvironment({ navigator: { userAgent: 'iPhone' } }) });
    assert.equal(notifier.status().code, 'IOS_HOME_SCREEN');
});

test('denied permission never gets requested again automatically', async () => {
    const notifier = new NativeNotifier({ environment: nativeEnvironment({ Notification: { permission: 'denied' } }) });
    await assert.rejects(notifier.send(payload), { code: 'PERMISSION_DENIED' });
});

test('permission is requested synchronously within the user gesture', async () => {
    let requested = false;
    const notifier = new NativeNotifier({ environment: nativeEnvironment({ Notification: {
        permission: 'default',
        requestPermission: () => { requested = true; return Promise.resolve('granted'); },
    } }) });
    const result = notifier.requestPermission();
    assert.equal(requested, true);
    assert.equal(await result, 'granted');
});

test('worker notifications use the extension scope and UTF-8 payload', async () => {
    const delivered = [];
    let registered;
    const registration = { active: { state: 'activated' }, showNotification: async (title, options) => delivered.push({ title, options }) };
    const notifier = new NativeNotifier({
        workerUrl: 'https://tavern.example/scripts/extensions/third-party/notifier/service-worker.js',
        environment: nativeEnvironment({ navigator: {
            userAgent: 'Desktop',
            serviceWorker: { register: async (url, options) => { registered = { url, options }; return registration; } },
        } }),
    });
    await notifier.send(payload);
    assert.equal(registered.options.scope, 'https://tavern.example/scripts/extensions/third-party/notifier/');
    assert.equal(delivered[0].title, '酒館 · 回覆完成');
    assert.equal(delivered[0].options.body, '你好，朋友 🔔');
    assert.equal(delivered[0].options.data.url, 'https://tavern.example/');
    await notifier.send(payload);
    assert.equal(delivered.length, 2);
    assert.notEqual(delivered[0].options.tag, delivered[1].options.tag, 'every reply must create a fresh native notification');
});

test('desktop constructor fallback still works after worker registration failure', async () => {
    const delivered = [];
    let focused = false;
    class Notification {
        static permission = 'granted';
        constructor(title, options) { this.title = title; this.options = options; delivered.push(this); }
        close() { this.closed = true; }
    }
    const notifier = new NativeNotifier({ environment: nativeEnvironment({
        Notification,
        focus: () => { focused = true; },
        navigator: { userAgent: 'Desktop', serviceWorker: { register: async () => { throw new Error('blocked'); } } },
    }) });
    await notifier.send(payload);
    assert.equal(delivered[0].options.body, '你好，朋友 🔔');
    delivered[0].onclick();
    assert.equal(focused, true);
    assert.equal(delivered[0].closed, true);
});

test('unsupported native environments leave the ntfy channel usable', async () => {
    const notifier = new NativeNotifier({ environment: nativeEnvironment({ Notification: undefined }) });
    assert.equal(notifier.status().code, 'UNSUPPORTED');
    await assert.rejects(notifier.send(payload), { code: 'UNSUPPORTED' });
});

test('ntfy posts JSON to the configured base path with Unicode and a bearer token', async () => {
    let received;
    await withServer(async (request, response) => {
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        received = { method: request.method, path: request.url, headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
        response.writeHead(200, { 'Content-Type': 'application/json' });
        response.end('{"id":"test"}');
    }, async server => {
        await sendNtfy({ ntfyServer: `${server}/notify/`, ntfyTopic: 'st-secret_topic-123' }, 'tk_example', payload);
    });
    assert.equal(received.path, '/notify/');
    assert.equal(received.method, 'POST');
    assert.equal(received.headers.authorization, 'Bearer tk_example');
    assert.equal(received.headers['content-type'], 'application/json');
    assert.deepEqual(received.body, {
        topic: 'st-secret_topic-123', title: '酒館 · 回覆完成', message: '你好，朋友 🔔',
        tags: ['speech_balloon'], priority: 3, click: 'https://tavern.example/',
    });
});

test('ntfy omits authorization when no token is supplied', async () => {
    await withServer((request, response) => {
        assert.equal(request.headers.authorization, undefined);
        response.end('{}');
    }, async server => {
        await sendNtfy({ ntfyServer: server, ntfyTopic: 'valid-topic' }, '', payload);
    });
});

for (const ntfyServer of ['javascript:alert(1)', 'ftp://host/', 'https://user:pass@host/', 'https://host/?token=secret', 'https://host/#secret', 'not a url']) {
    test(`rejects unsafe ntfy endpoint: ${ntfyServer}`, () => {
        assert.throws(() => validateNtfySettings({ ntfyServer, ntfyTopic: 'valid' }), { code: 'NTFY_CONFIG' });
    });
}

for (const ntfyTopic of ['', '../other', 'abc/def', 'topic?token=x', 'topic with space']) {
    test(`rejects invalid ntfy topic: ${JSON.stringify(ntfyTopic)}`, () => {
        assert.throws(() => validateNtfySettings({ ntfyServer: 'https://ntfy.sh', ntfyTopic }), { code: 'NTFY_CONFIG' });
    });
}

test('HTTP errors include the status without leaking response contents or configuration', async () => {
    await withServer((_request, response) => {
        response.writeHead(429);
        response.end('secret server error details');
    }, async server => {
        await assert.rejects(sendNtfy({ ntfyServer: server, ntfyTopic: 'my-secret-topic' }, 'my-secret-token', payload), error => {
            assert.equal(error.code, 'NTFY_HTTP');
            assert.match(error.message, /429/);
            assert.doesNotMatch(error.message, /secret|127\.0\.0\.1/);
            return true;
        });
    });
});

test('a stalled ntfy server is aborted within the request timeout', async () => {
    await withServer(() => {}, async server => {
        await assert.rejects(sendNtfy({ ntfyServer: server, ntfyTopic: 'valid' }, '', payload, { timeoutMs: 30 }), { code: 'NTFY_TIMEOUT' });
    });
});

test('ntfy refuses redirects that could forward notification content elsewhere', async () => {
    await withServer((_request, response) => {
        response.writeHead(302, { Location: 'https://example.invalid/collect' });
        response.end();
    }, async server => {
        await assert.rejects(sendNtfy({ ntfyServer: server, ntfyTopic: 'valid' }, '', payload), { code: 'NTFY_NETWORK' });
    });
});

test('native failure cannot prevent successful ntfy delivery', async () => {
    let delivered = false;
    await withServer((_request, response) => { delivered = true; response.end('{}'); }, async server => {
        const results = await deliverNotification({
            settings: normalizeSettings({ ntfyEnabled: true, ntfyServer: server, ntfyTopic: 'valid' }),
            token: '', payload,
            native: new NativeNotifier({ environment: nativeEnvironment({ Notification: undefined }) }),
        });
        assert.deepEqual(results.map(result => [result.channel, result.ok]), [['native', false], ['ntfy', true]]);
        assert.equal(delivered, true);
    });
});

test('disabled channels do not invoke browser APIs or make requests', async () => {
    const results = await deliverNotification({ settings: normalizeSettings({ enabled: false }), payload });
    assert.deepEqual(results, []);
});
