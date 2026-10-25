import { CompletionTracker, createPayload, normalizeSettings, SETTINGS_KEY } from './core.js';
import { NativeNotifier, deliverNotification } from './notifications.js';
import { mountSettings, TOKEN_KEY } from './ui.js';

let runtime = null;
let pending = null;

export function onEnable() {
    if (runtime) return Promise.resolve(runtime);
    if (pending) return pending.promise;
    const controller = new AbortController();
    const initialization = { controller, promise: null };
    pending = initialization;
    initialization.promise = (async () => {
        const getContext = () => globalThis.SillyTavern.getContext();
        const context = getContext();
        const types = context.eventTypes || context.event_types;
        if (!types || !context.eventSource || !context.extensionSettings) throw new Error('SillyTavern extension API is unavailable.');
        let settings = normalizeSettings(context.extensionSettings[SETTINGS_KEY]);
        context.extensionSettings[SETTINGS_KEY] = settings;
        const native = new NativeNotifier();
        let panel;
        const tracker = new CompletionTracker({
            getContext,
            getSettings: () => settings,
            onComplete: message => {
                if (settings.onlyWhenAway && document.visibilityState !== 'hidden' && document.hasFocus()) return;
                const payload = createPayload(message, settings, location.href);
                void deliverNotification({ settings: { ...settings }, token: panel.getToken(), payload, native })
                    .then(results => panel.reportResults(results));
            },
        });

        const testChannel = (channel, token) => {
            const payload = createPayload({ name: 'SillyTavern', mes: '這是回覆完成通知的測試，設定成功後就會收到提醒。' }, { ...settings, includePreview: true }, location.href);
            payload.title = 'SillyTavern · 測試通知';
            return deliverNotification({
                settings: { ...settings, enabled: true, nativeEnabled: channel === 'native', ntfyEnabled: channel === 'ntfy' },
                token, payload, native,
            });
        };
        panel = await mountSettings({
            getSettings: () => settings,
            onChange: (key, value) => {
                settings = normalizeSettings({ ...settings, [key]: value });
                getContext().extensionSettings[SETTINGS_KEY] = settings;
                getContext().saveSettingsDebounced();
                if (!settings.enabled) tracker.reset();
            },
            native,
            onTestNative: token => testChannel('native', token),
            onTestNtfy: token => testChannel('ntfy', token),
            signal: controller.signal,
        });
        const subscriptions = [];
        const bind = (key, handler) => {
            if (!types[key]) return;
            context.eventSource.on(types[key], handler);
            subscriptions.push([types[key], handler]);
        };
        bind('GENERATION_STARTED', (type, options, dryRun) => tracker.start(type, options, dryRun));
        bind('MESSAGE_RECEIVED', (messageId, type) => tracker.receive(messageId, type));
        bind('GENERATION_ENDED', () => tracker.end());
        bind('GENERATION_STOPPED', () => tracker.stop());
        bind('CHAT_CHANGED', () => tracker.reset());
        bind('GROUP_WRAPPER_STARTED', () => tracker.groupStart());
        bind('GROUP_WRAPPER_FINISHED', () => tracker.groupEnd());
        runtime = {
            dispose() {
                tracker.reset();
                subscriptions.forEach(([type, handler]) => context.eventSource.removeListener(type, handler));
                panel.dispose();
            },
        };
        return runtime;
    })().finally(() => {
        if (pending === initialization) pending = null;
    });
    return initialization.promise;
}

export function onDisable() {
    pending?.controller.abort();
    pending = null;
    runtime?.dispose();
    runtime = null;
}

export async function onDelete() {
    onDisable();
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* Storage can be disabled. */ }
    try {
        const scope = new URL('./', import.meta.url).href;
        const registrations = await navigator.serviceWorker?.getRegistrations() || [];
        await Promise.all(registrations.filter(item => item.scope === scope).map(item => item.unregister()));
    } catch { /* Cleanup must not block uninstalling in unsupported browsers. */ }
}

function boot() {
    void onEnable().catch(failure => {
        if (failure.name !== 'AbortError') console.error('[Reply Notifier] Initialization failed. Please reload SillyTavern.');
    });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
