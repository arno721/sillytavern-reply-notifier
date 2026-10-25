import { validateNtfySettings, NotificationError } from './notifications.js';

export const TOKEN_KEY = 'sillytavern_reply_notifier_token';

export async function mountSettings({ getSettings, onChange, native, onTestNative, onTestNtfy, signal }) {
    const response = await fetch(new URL('./settings.html', import.meta.url), { signal, credentials: 'same-origin' });
    if (!response.ok) throw new Error('Unable to load Reply Notifier settings.');
    const template = document.createElement('template');
    template.innerHTML = await response.text();
    signal?.throwIfAborted();
    const root = template.content.firstElementChild;
    const container = document.querySelector('#extensions_settings') || document.querySelector('#extensions_settings2');
    if (!container) throw new Error('SillyTavern extension settings container is unavailable.');
    container.append(root);
    const result = root.querySelector('[data-status="result"]');
    const tokenInput = root.querySelector('[data-token]');
    let token = '';
    try { token = sessionStorage.getItem(TOKEN_KEY) || ''; } catch { /* Per-tab memory still works. */ }
    tokenInput.value = token;

    function refreshStatus() {
        root.querySelector('[data-status="native"]').textContent = native.status().message;
    }

    function refreshSubscribe() {
        const link = root.querySelector('[data-subscribe]');
        try {
            const { server, topic } = validateNtfySettings(getSettings());
            link.href = `${server}${encodeURIComponent(topic)}`;
            link.setAttribute('aria-disabled', 'false');
        } catch {
            link.removeAttribute('href');
            link.setAttribute('aria-disabled', 'true');
        }
    }

    function showResult(message, ok) {
        result.textContent = message;
        result.dataset.ok = String(ok);
        refreshStatus();
    }

    function reportResults(results) {
        if (!results.length) return;
        showResult(results.map(item => `${item.channel === 'native' ? '系統通知' : 'ntfy'}：${item.ok ? '傳送成功' : item.message}`).join('　'), results.every(item => item.ok));
    }

    for (const input of root.querySelectorAll('[data-setting]')) {
        const value = getSettings()[input.dataset.setting];
        if (input.type === 'checkbox') input.checked = value;
        else input.value = value;
    }
    root.addEventListener('input', event => {
        const input = event.target;
        if (input.matches('[data-token]')) {
            token = input.value;
            try {
                if (token) sessionStorage.setItem(TOKEN_KEY, token);
                else sessionStorage.removeItem(TOKEN_KEY);
            } catch { /* Keep only the in-memory token when storage is blocked. */ }
        } else if (input.matches('[data-setting]')) {
            onChange(input.dataset.setting, input.type === 'checkbox' ? input.checked : input.value);
            refreshSubscribe();
        }
    });

    async function action(button, run) {
        button.disabled = true;
        try {
            await run();
        } catch (failure) {
            showResult(failure instanceof NotificationError ? failure.message : '操作失敗，請檢查設定後重新嘗試。', false);
        } finally {
            button.disabled = false;
        }
    }

    root.querySelector('[data-action="permission"]').addEventListener('click', event => {
        void action(event.currentTarget, async () => {
            const permission = await native.requestPermission();
            showResult(permission === 'granted' ? '通知權限已允許，請測試系統通知。' : native.status().message, permission === 'granted');
        });
    });
    root.querySelector('[data-action="test-native"]').addEventListener('click', event => {
        void action(event.currentTarget, async () => reportResults(await onTestNative(token)));
    });
    root.querySelector('[data-action="test-ntfy"]').addEventListener('click', event => {
        void action(event.currentTarget, async () => reportResults(await onTestNtfy(token)));
    });
    root.querySelector('[data-action="generate-topic"]').addEventListener('click', () => {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        const topic = `st-${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
        root.querySelector('[data-setting="ntfyTopic"]').value = topic;
        onChange('ntfyTopic', topic);
        refreshSubscribe();
        showResult('已產生隨機 Topic。請在 ntfy App 訂閱相同主題，再測試推送。', true);
    });

    globalThis.addEventListener('focus', refreshStatus);
    refreshStatus();
    refreshSubscribe();
    return {
        getToken: () => token,
        reportResults,
        dispose: () => { globalThis.removeEventListener('focus', refreshStatus); root.remove(); },
    };
}
