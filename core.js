export const SETTINGS_KEY = 'reply_notifier';

const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    nativeEnabled: true,
    onlyWhenAway: false,
    includePreview: false,
    previewLength: 120,
    ntfyEnabled: false,
    ntfyServer: 'https://ntfy.sh',
    ntfyTopic: '',
});

export function normalizeSettings(value = {}) {
    const source = value && typeof value === 'object' ? value : {};
    const settings = { ...DEFAULT_SETTINGS };
    for (const [key, fallback] of Object.entries(DEFAULT_SETTINGS)) {
        if (typeof source[key] === typeof fallback) settings[key] = source[key];
    }
    const length = Number(settings.previewLength);
    settings.previewLength = Number.isFinite(length) ? Math.max(20, Math.min(500, Math.round(length))) : 120;
    settings.ntfyServer = settings.ntfyServer.trim();
    settings.ntfyTopic = settings.ntfyTopic.trim();
    return settings;
}

function plainText(value) {
    const entities = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    return String(value ?? '')
        .replace(/<(think|analysis|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<(think|analysis|script|style)\b[^>]*>[\s\S]*$/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replace(/[*_`~#]/g, '')
        .replace(/&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
            if (!entity.startsWith('#')) return entities[entity.toLowerCase()] ?? match;
            const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
            return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : '';
        })
        .replace(/\s+/g, ' ')
        .trim();
}

function truncate(text, length) {
    const characters = Array.from(text);
    return characters.length > length ? `${characters.slice(0, length).join('')}…` : text;
}

export function safePageUrl(value) {
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol)) return '';
        url.username = '';
        url.password = '';
        url.search = '';
        url.hash = '';
        return url.href;
    } catch {
        return '';
    }
}

export function createPayload(message, settings, pageUrl) {
    const options = normalizeSettings(settings);
    const name = options.includePreview ? truncate(plainText(message?.name), 60) : '';
    const preview = options.includePreview ? truncate(plainText(message?.mes), options.previewLength) : '';
    return {
        title: `${name || 'SillyTavern'} · 回覆完成`,
        body: preview || 'AI 回覆已完成，點擊返回酒館。',
        tag: 'sillytavern-reply-notifier',
        url: safePageUrl(pageUrl),
    };
}

function scopeOf(context) {
    return { chat: context.chat, id: context.getCurrentChatId?.() ?? context.chatId };
}

function sameScope(scope, context) {
    const current = scopeOf(context);
    return scope.chat === current.chat && scope.id === current.id;
}

function failedStream(context) {
    const stream = context.streamingProcessor;
    return Boolean(stream?.isStopped || stream?.abortController?.signal?.aborted);
}

const IGNORED_TYPES = new Set(['quiet', 'impersonate', 'first_message']);

/** Pairs successful message events with end events without blocking the host emitter. */
export class CompletionTracker {
    constructor({ getContext, getSettings, onComplete, schedule = callback => setTimeout(callback, 250), cancel = id => clearTimeout(id) }) {
        this.getContext = getContext;
        this.getSettings = getSettings;
        this.onComplete = onComplete;
        this.schedule = schedule;
        this.cancel = cancel;
        this.session = null;
        this.timer = null;
        this.revision = 0;
        this.inGroup = false;
        this.groupCandidate = null;
    }

    cancelPending() {
        this.revision++;
        if (this.timer !== null) this.cancel(this.timer);
        this.timer = null;
    }

    reset() {
        this.cancelPending();
        this.session = null;
        this.inGroup = false;
        this.groupCandidate = null;
    }

    stop() {
        this.reset();
    }

    start(type, options = {}, dryRun = false) {
        this.cancelPending();
        this.session = {
            scope: scopeOf(this.getContext()),
            signal: options?.signal,
            eligible: !dryRun && !IGNORED_TYPES.has(type),
            ended: false,
            failed: false,
            done: false,
            candidateId: null,
        };
    }

    receive(messageId, type) {
        const session = this.session;
        const context = this.getContext();
        if (!session || !session.eligible || session.done || IGNORED_TYPES.has(type) || !sameScope(session.scope, context)) return;
        if (!Number.isInteger(messageId) || messageId < 0) return;
        const message = context.chat?.[messageId];
        if (!message || message.is_user || message.is_system || !String(message.mes ?? '').trim() || message.mes.trim() === '...') return;
        session.candidateId = messageId;
        session.failed ||= failedStream(context);
        this.prepare();
    }

    end() {
        if (!this.session) return;
        this.session.ended = true;
        this.session.failed ||= failedStream(this.getContext());
        this.prepare();
    }

    prepare() {
        const session = this.session;
        const context = this.getContext();
        if (!session || !session.eligible || !session.ended || session.done || session.failed || session.signal?.aborted) return;
        if (session.candidateId === null || !sameScope(session.scope, context)) return;
        const message = context.chat[session.candidateId];
        if (!message || message.is_user || message.is_system || !String(message.mes ?? '').trim()) return;
        const candidate = {
            message: { name: String(message.name ?? ''), mes: String(message.mes) },
            scope: session.scope,
            signal: session.signal,
        };
        session.done = true;
        if (this.inGroup) this.groupCandidate = candidate;
        else this.enqueue(candidate);
    }

    enqueue(candidate) {
        this.cancelPending();
        const revision = this.revision;
        this.timer = this.schedule(() => {
            this.timer = null;
            if (revision !== this.revision || !this.getSettings().enabled || candidate.signal?.aborted) return;
            const context = this.getContext();
            if (!sameScope(candidate.scope, context) || failedStream(context)) return;
            this.onComplete(candidate.message);
        });
    }

    groupStart() {
        this.reset();
        this.inGroup = true;
    }

    groupEnd() {
        this.prepare();
        this.inGroup = false;
        if (this.groupCandidate) this.enqueue(this.groupCandidate);
        this.groupCandidate = null;
    }
}
