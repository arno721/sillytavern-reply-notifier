import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

async function workerFixture(clients = []) {
    const listeners = new Map();
    const opened = [];
    const focused = [];
    const self = {
        location: new URL('https://tavern.example/scripts/extensions/third-party/notifier/service-worker.js'),
        addEventListener: (name, handler) => listeners.set(name, handler),
        skipWaiting: async () => {},
        clients: {
            matchAll: async () => clients.map(url => ({ url, focus: async () => focused.push(url) })),
            openWindow: async url => opened.push(url),
        },
    };
    vm.runInNewContext(await readFile(new URL('../service-worker.js', import.meta.url), 'utf8'), { self, URL });
    const click = async url => {
        let closed = false;
        let task;
        listeners.get('notificationclick')({ notification: { data: { url }, close: () => { closed = true; } }, waitUntil: promise => { task = promise; } });
        await task;
        assert.equal(closed, true);
    };
    return { click, opened, focused, listeners };
}

test('notification clicks focus an existing uncontrolled SillyTavern window', async () => {
    const f = await workerFixture(['https://tavern.example/?existing=1']);
    await f.click('https://tavern.example/');
    assert.deepEqual(f.focused, ['https://tavern.example/?existing=1']);
    assert.deepEqual(f.opened, []);
    assert.equal(f.listeners.has('fetch'), false);
    assert.equal(f.listeners.has('activate'), false);
});

test('notification clicks open the same-origin installation path if no matching window exists', async () => {
    const f = await workerFixture(['https://tavern.example/other/']);
    await f.click('https://tavern.example/tavern/');
    assert.deepEqual(f.opened, ['https://tavern.example/tavern/']);
});

for (const url of ['https://evil.example/steal', 'javascript:alert(1)', 'data:text/html,hello', 'https://user:pass@tavern.example/']) {
    test(`notification clicks refuse an unsafe target: ${url}`, async () => {
        const f = await workerFixture();
        await f.click(url);
        assert.deepEqual(f.opened, []);
        assert.deepEqual(f.focused, []);
    });
}
