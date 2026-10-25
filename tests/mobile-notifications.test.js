import assert from 'node:assert/strict';
import test from 'node:test';
import { NativeNotifier, deliverNotification } from '../notifications.js';
import { normalizeSettings } from '../core.js';

const payload = { title: '回覆完成', body: '手機原生通知 🔔', tag: 'reply', url: 'https://tavern.example/' };

function mobileFixture(platform, overrides = {}) {
    const events = [];
    const delivered = [];
    let constructors = 0;
    class Notification {
        static permission = 'granted';
        static requestPermission() {
            events.push('permission');
            return Promise.resolve('granted').then(permission => { this.permission = permission; return permission; });
        }
        constructor() { constructors++; throw new TypeError('The mobile constructor is unsupported.'); }
    }
    const registration = {
        active: { state: 'activated' },
        showNotification: async (title, options) => delivered.push({ title, options }),
    };
    const environment = {
        isSecureContext: true,
        Notification,
        navigator: {
            userAgent: platform === 'ios' ? 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' : 'Mozilla/5.0 (Linux; Android 15) Chrome/130.0.0.0 Mobile Safari/537.36',
            standalone: platform === 'ios',
            serviceWorker: { register: async () => { events.push('worker'); return registration; } },
        },
        matchMedia: () => ({ matches: platform === 'ios' }),
        ...overrides,
    };
    const notifier = new NativeNotifier({ environment, workerUrl: 'https://tavern.example/scripts/extensions/third-party/notifier/service-worker.js' });
    return { notifier, environment, events, delivered, registration, constructors: () => constructors };
}

for (const platform of ['android', 'ios']) {
    test(`${platform}: enable requests permission during the gesture and prepares worker delivery`, async () => {
        const f = mobileFixture(platform);
        f.environment.Notification.permission = 'default';
        const enabling = f.notifier.enable();
        assert.deepEqual(f.events, ['permission']);
        assert.deepEqual(await enabling, { permission: 'granted', via: 'service-worker' });
        assert.deepEqual(f.events, ['permission', 'worker']);
        await f.notifier.send(payload);
        assert.equal(f.delivered[0].title, '回覆完成');
        assert.equal(f.delivered[0].options.body, '手機原生通知 🔔');
        assert.equal(f.constructors(), 0);
        assert.equal(f.notifier.status().platform, platform);
    });

    test(`${platform}: a worker failure never falls back to the mobile Notification constructor`, async () => {
        const f = mobileFixture(platform);
        f.environment.navigator.serviceWorker.register = async () => { throw new Error('private server failure'); };
        await assert.rejects(f.notifier.send(payload), failure => {
            assert.equal(failure.code, 'WORKER_UNAVAILABLE');
            assert.doesNotMatch(failure.message, /private server failure/);
            return true;
        });
        assert.equal(f.constructors(), 0);
        assert.deepEqual(f.delivered, []);
    });

    test(`${platform}: missing worker API produces actionable failure before permission prompt`, async () => {
        const f = mobileFixture(platform);
        delete f.environment.navigator.serviceWorker;
        f.environment.Notification.permission = 'default';
        assert.equal(f.notifier.status().code, 'WORKER_UNAVAILABLE');
        await assert.rejects(f.notifier.enable(), { code: 'WORKER_UNAVAILABLE' });
        assert.deepEqual(f.events, []);
        assert.equal(f.constructors(), 0);
    });

    test(`${platform}: cancelled permission does not register or send a notification`, async () => {
        const f = mobileFixture(platform);
        f.environment.Notification.permission = 'default';
        f.environment.Notification.requestPermission = () => Promise.resolve('default');
        await assert.rejects(f.notifier.enable(), { code: 'PERMISSION_REQUIRED' });
        assert.deepEqual(f.events, []);
        assert.deepEqual(f.delivered, []);
    });
}

test('iOS regular tabs stay on native Home Screen guidance without requesting permission', async () => {
    const f = mobileFixture('ios', { matchMedia: () => ({ matches: false }) });
    f.environment.navigator.standalone = false;
    assert.equal(f.notifier.status().code, 'IOS_HOME_SCREEN');
    await assert.rejects(f.notifier.enable(), { code: 'IOS_HOME_SCREEN' });
    assert.deepEqual(f.events, []);
});

test('an iPad using the desktop user agent still gets the iOS worker-only path', async () => {
    const f = mobileFixture('ios');
    f.environment.navigator.userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15';
    f.environment.navigator.maxTouchPoints = 5;
    assert.equal(f.notifier.status().platform, 'ios');
    await f.notifier.enable();
    await f.notifier.send(payload);
    assert.equal(f.delivered.length, 1);
    assert.equal(f.constructors(), 0);
});

test('mobile capability hints require a worker even without an Android/iOS user agent', async () => {
    const f = mobileFixture('android');
    f.environment.navigator.userAgent = 'Custom Browser';
    f.environment.navigator.userAgentData = { mobile: true };
    delete f.environment.navigator.serviceWorker;
    await assert.rejects(f.notifier.send(payload), { code: 'WORKER_UNAVAILABLE' });
    assert.equal(f.constructors(), 0);
});

test('mobile enable waits until its worker has activated', async () => {
    const f = mobileFixture('android');
    const worker = new EventTarget();
    worker.state = 'installing';
    f.registration.active = null;
    f.registration.installing = worker;
    const enabling = f.notifier.enable();
    setTimeout(() => {
        worker.state = 'activated';
        f.registration.active = worker;
        worker.dispatchEvent(new Event('statechange'));
    }, 5);
    assert.deepEqual(await enabling, { permission: 'granted', via: 'service-worker' });
    assert.equal(f.registration.active.state, 'activated');
});

test('permission revoked during mobile delivery reports permission failure without constructor fallback', async () => {
    const f = mobileFixture('ios');
    f.registration.showNotification = async () => {
        f.environment.Notification.permission = 'denied';
        throw new Error('Notification permission revoked');
    };
    await assert.rejects(f.notifier.send(payload), { code: 'PERMISSION_DENIED' });
    assert.equal(f.constructors(), 0);
});

test('default native mobile delivery needs no third-party notification service', async () => {
    const f = mobileFixture('android');
    await f.notifier.enable();
    const results = await deliverNotification({
        settings: normalizeSettings(), payload, native: f.notifier,
        fetchImpl: () => { throw new Error('An external service must not be contacted.'); },
    });
    assert.deepEqual(results, [{ channel: 'native', ok: true }]);
    assert.equal(f.delivered.length, 1);
});
