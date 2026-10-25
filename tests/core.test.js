import assert from 'node:assert/strict';
import test from 'node:test';
import { CompletionTracker, createPayload, normalizeSettings } from '../core.js';

function fixture() {
    const context = { chat: [], chatId: 'chat-a', streamingProcessor: null };
    const completed = [];
    const pending = new Map();
    let timerId = 0;
    const settings = normalizeSettings();
    const tracker = new CompletionTracker({
        getContext: () => context,
        getSettings: () => settings,
        onComplete: message => completed.push(message),
        schedule: callback => { pending.set(++timerId, callback); return timerId; },
        cancel: id => pending.delete(id),
    });
    const reply = (text = '你好！', extra = {}) => {
        context.chat.push({ name: 'Alice', mes: text, is_user: false, is_system: false, ...extra });
        return context.chat.length - 1;
    };
    const flush = () => {
        const callbacks = [...pending.values()];
        pending.clear();
        callbacks.forEach(callback => callback());
    };
    return { context, completed, tracker, reply, flush, settings };
}

test('waits for generation end before notifying a non-streamed reply, once', () => {
    const f = fixture();
    f.tracker.start('normal');
    f.tracker.receive(f.reply(), 'normal');
    f.flush();
    assert.equal(f.completed.length, 0);
    f.tracker.end();
    f.flush();
    assert.equal(f.completed.length, 1);
    assert.equal(f.completed[0].mes, '你好！');
    f.tracker.end();
    f.tracker.receive(0, 'normal');
    f.flush();
    assert.equal(f.completed.length, 1);
});

test('handles streaming end arriving before message received, even after a timer turn', () => {
    const f = fixture();
    f.tracker.start('normal');
    f.tracker.end();
    f.flush();
    assert.equal(f.completed.length, 0);
    f.tracker.receive(f.reply('完整串流回覆'), 'normal');
    f.flush();
    assert.equal(f.completed[0].mes, '完整串流回覆');
});

test('a stop after an end cancels the pending completion', () => {
    const f = fixture();
    f.tracker.start('normal');
    f.tracker.receive(f.reply(), 'normal');
    f.tracker.end();
    f.tracker.stop();
    f.flush();
    assert.equal(f.completed.length, 0);
});

test('a stop between end and received suppresses the aborted streaming reply', () => {
    const f = fixture();
    f.tracker.start('normal');
    f.tracker.end();
    f.tracker.stop();
    f.tracker.receive(f.reply('partial'), 'normal');
    f.flush();
    assert.equal(f.completed.length, 0);
});

for (const streamingProcessor of [
    { isStopped: true },
    { abortController: { signal: { aborted: true } } },
]) {
    test(`ignores failed streams: ${JSON.stringify(streamingProcessor)}`, () => {
        const f = fixture();
        f.tracker.start('normal');
        f.context.streamingProcessor = streamingProcessor;
        f.tracker.end();
        f.context.streamingProcessor = null;
        f.tracker.receive(f.reply('partial'), 'normal');
        f.flush();
        assert.equal(f.completed.length, 0);
    });
}

test('an aborted generation signal cancels an otherwise valid reply', () => {
    const f = fixture();
    const controller = new AbortController();
    f.tracker.start('normal', { signal: controller.signal });
    f.tracker.receive(f.reply(), 'normal');
    f.tracker.end();
    controller.abort();
    f.flush();
    assert.equal(f.completed.length, 0);
});

for (const [type, dryRun] of [['quiet', false], ['impersonate', false], ['normal', true]]) {
    test(`suppresses ${type} generation (dryRun=${dryRun})`, () => {
        const f = fixture();
        f.tracker.start(type, {}, dryRun);
        f.tracker.receive(f.reply(), type);
        f.tracker.end();
        f.flush();
        assert.equal(f.completed.length, 0);
    });
}

for (const [text, extra, type] of [
    ['user text', { is_user: true }, 'normal'],
    ['system text', { is_system: true }, 'normal'],
    ['   ', {}, 'normal'],
    ['...', {}, 'normal'],
    ['greeting', {}, 'first_message'],
]) {
    test(`ignores non-reply candidate ${JSON.stringify({ text, extra, type })}`, () => {
        const f = fixture();
        f.tracker.start('normal');
        f.tracker.receive(f.reply(text, extra), type);
        f.tracker.end();
        f.flush();
        assert.equal(f.completed.length, 0);
    });
}

test('does not announce an old reply when a generation errors without receiving a new message', () => {
    const f = fixture();
    f.reply('old reply');
    f.tracker.start('normal');
    f.tracker.end();
    f.flush();
    assert.equal(f.completed.length, 0);
});

test('chat identity changes suppress an already scheduled notification', () => {
    const f = fixture();
    f.tracker.start('normal');
    f.tracker.receive(f.reply(), 'normal');
    f.tracker.end();
    f.context.chatId = 'chat-b';
    f.flush();
    assert.equal(f.completed.length, 0);
});

test('a replaced chat array cannot supply a candidate for the old generation', () => {
    const f = fixture();
    f.tracker.start('normal');
    f.context.chat = [];
    f.tracker.receive(f.reply(), 'normal');
    f.tracker.end();
    f.flush();
    assert.equal(f.completed.length, 0);
});

test('reset and disabling the extension cancel pending completions', () => {
    for (const action of ['reset', 'disable']) {
        const f = fixture();
        f.tracker.start('normal');
        f.tracker.receive(f.reply(), 'normal');
        f.tracker.end();
        if (action === 'reset') f.tracker.reset();
        else f.settings.enabled = false;
        f.flush();
        assert.equal(f.completed.length, 0);
    }
});

test('a swipe or continuation can notify again at the same message index', () => {
    const f = fixture();
    const id = f.reply('original');
    for (const type of ['swipe', 'continue']) {
        f.tracker.start(type);
        f.context.chat[id].mes = type;
        f.tracker.receive(id, type);
        f.tracker.end();
        f.flush();
    }
    assert.deepEqual(f.completed.map(message => message.mes), ['swipe', 'continue']);
});

test('coalesces a group batch into one notification for its last reply', () => {
    const f = fixture();
    f.tracker.groupStart();
    for (const name of ['Alice', 'Bob']) {
        f.tracker.start('normal');
        f.tracker.receive(f.reply(`${name} replied`, { name }), 'normal');
        f.tracker.end();
        f.flush();
        assert.equal(f.completed.length, 0);
    }
    f.tracker.groupEnd();
    f.flush();
    assert.equal(f.completed.length, 1);
    assert.equal(f.completed[0].name, 'Bob');
});

test('stopping a group batch cancels its earlier successful candidates', () => {
    const f = fixture();
    f.tracker.groupStart();
    f.tracker.start('normal');
    f.tracker.receive(f.reply(), 'normal');
    f.tracker.end();
    f.tracker.stop();
    f.tracker.groupEnd();
    f.flush();
    assert.equal(f.completed.length, 0);
});

test('defaults keep preview and external push off and discard secret/unknown settings', () => {
    const settings = normalizeSettings({ token: 'secret', previewLength: 9000 });
    assert.equal(settings.enabled, true);
    assert.equal(settings.nativeEnabled, true);
    assert.equal(settings.ntfyEnabled, false);
    assert.equal(settings.includePreview, false);
    assert.equal(settings.previewLength, 500);
    assert.equal('token' in settings, false);
    assert.equal(normalizeSettings({ previewLength: 'bad' }).previewLength, 120);
});

test('private payloads reveal neither the character nor reply and strip URL credentials/query/hash', () => {
    const payload = createPayload({ name: 'Private Name', mes: 'private text' }, normalizeSettings(), 'https://user:pass@example.test/tavern/?secret=abc#chat');
    assert.equal(payload.title, 'SillyTavern · 回覆完成');
    assert.equal(payload.body, 'AI 回覆已完成，點擊返回酒館。');
    assert.equal(payload.url, 'https://example.test/tavern/');
    assert.equal(JSON.stringify(payload).includes('private'), false);
});

test('opt-in previews strip hidden reasoning, markup and scripts and preserve Chinese/emoji', () => {
    const payload = createPayload(
        { name: '<b>Alice</b>', mes: '<think>secret reasoning</think><script>hidden()</script>你好 **朋友**，<b>完成</b>了 &amp; [連結](https://secret.test/) 🔔' },
        normalizeSettings({ includePreview: true }),
        'https://example.test/',
    );
    assert.equal(payload.title, 'Alice · 回覆完成');
    assert.equal(payload.body, '你好 朋友，完成了 & 連結 🔔');
    assert.equal(createPayload({ mes: '😀'.repeat(25) }, normalizeSettings({ includePreview: true, previewLength: 20 }), 'javascript:bad').body, `${'😀'.repeat(20)}…`);
    assert.equal(createPayload({}, normalizeSettings(), 'javascript:bad').url, '');
});
