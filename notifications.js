export class NotificationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'NotificationError';
        this.code = code;
    }
}

const error = (code, message) => new NotificationError(code, message);

/** Owns only the worker registration inside this extension's directory. */
export class NativeNotifier {
    constructor({ environment = globalThis, workerUrl = new URL('./service-worker.js', import.meta.url).href } = {}) {
        this.environment = environment;
        this.workerUrl = workerUrl;
        this.registrationPromise = null;
    }

    status() {
        const env = this.environment;
        const permission = env.Notification?.permission ?? 'unsupported';
        const ios = /iPad|iPhone|iPod/.test(env.navigator?.userAgent ?? '')
            || (/Macintosh/.test(env.navigator?.userAgent ?? '') && env.navigator?.maxTouchPoints > 1);
        const standalone = Boolean(env.navigator?.standalone || env.matchMedia?.('(display-mode: standalone)').matches);
        let code = 'READY';
        let message = '原生通知已授權。';
        if (!env.isSecureContext) {
            code = 'INSECURE_CONTEXT';
            message = '原生通知需要 HTTPS 或本機 localhost；HTTP 區域網路網址可使用 ntfy。';
        } else if (ios && !standalone) {
            code = 'IOS_HOME_SCREEN';
            message = 'iOS 請用 HTTPS 開啟酒館，加入主畫面後從圖示啟動，或使用 ntfy App 接收。';
        } else if (!env.Notification) {
            code = 'UNSUPPORTED';
            message = '這個瀏覽器未提供原生通知，請使用 ntfy 接收。';
        } else if (permission === 'denied') {
            code = 'PERMISSION_DENIED';
            message = '通知已被封鎖，請在瀏覽器的網站權限及系統通知設定中允許。';
        } else if (permission !== 'granted') {
            code = 'PERMISSION_REQUIRED';
            message = '點擊「允許系統通知」授權後，即可接收通知。';
        }
        return { code, message, permission, ios, standalone };
    }

    async requestPermission() {
        const status = this.status();
        if (!['READY', 'PERMISSION_REQUIRED'].includes(status.code)) throw error(status.code, status.message);
        if (status.permission === 'granted') return 'granted';
        // Keep this call before the first await: Safari requires a direct user gesture.
        return await this.environment.Notification.requestPermission();
    }

    async getRegistration() {
        const serviceWorker = this.environment.navigator?.serviceWorker;
        if (!serviceWorker) throw error('WORKER_UNAVAILABLE', '瀏覽器未提供 Service Worker 通知。');
        if (!this.registrationPromise) {
            this.registrationPromise = (async () => {
                const registration = await serviceWorker.register(this.workerUrl, {
                    scope: new URL('./', this.workerUrl).href,
                    updateViaCache: 'none',
                });
                if (registration.active?.state === 'activated') return registration;
                const worker = registration.installing || registration.waiting || registration.active;
                if (!worker) throw error('WORKER_UNAVAILABLE', '通知服務未能啟動。');
                await new Promise((resolve, reject) => {
                    const finish = failure => {
                        clearTimeout(timer);
                        worker.removeEventListener('statechange', changed);
                        failure ? reject(failure) : resolve();
                    };
                    const changed = () => {
                        if (worker.state === 'activated') finish();
                        else if (worker.state === 'redundant') finish(error('WORKER_UNAVAILABLE', '通知服務安裝失敗。'));
                    };
                    const timer = setTimeout(() => finish(error('WORKER_TIMEOUT', '通知服務啟動逾時，請重新嘗試。')), 8000);
                    worker.addEventListener('statechange', changed);
                    changed();
                });
                return registration;
            })().catch(failure => {
                this.registrationPromise = null;
                throw failure;
            });
        }
        return this.registrationPromise;
    }

    async send(payload) {
        const status = this.status();
        if (status.code !== 'READY') throw error(status.code, status.message);
        const options = { body: payload.body, tag: payload.tag, data: { url: payload.url } };
        try {
            const registration = await this.getRegistration();
            await registration.showNotification(payload.title, options);
            return;
        } catch {
            // Desktop browsers may allow the constructor when workers are blocked.
        }
        try {
            const notification = new this.environment.Notification(payload.title, options);
            notification.onclick = () => {
                this.environment.focus?.();
                notification.close();
            };
        } catch {
            throw error('NATIVE_FAILED', '無法顯示系統通知，請檢查瀏覽器／系統權限，或使用 ntfy。');
        }
    }
}

export function validateNtfySettings(settings) {
    let server;
    try {
        server = new URL(String(settings.ntfyServer ?? '').trim());
    } catch {
        throw error('NTFY_CONFIG', '請填入完整的 ntfy 伺服器網址。');
    }
    if (!['http:', 'https:'].includes(server.protocol) || server.username || server.password || server.search || server.hash) {
        throw error('NTFY_CONFIG', 'ntfy 伺服器必須是 HTTP(S) 網址，且不可包含帳密、查詢參數或片段。');
    }
    const topic = String(settings.ntfyTopic ?? '').trim();
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(topic)) {
        throw error('NTFY_CONFIG', 'ntfy Topic 必須是 1–64 個英文字母、數字、底線或連字號。');
    }
    server.pathname = `${server.pathname.replace(/\/+$/, '')}/`;
    return { server: server.href, topic };
}

export async function sendNtfy(settings, token, payload, { fetchImpl = globalThis.fetch, timeoutMs = 10000 } = {}) {
    const { server, topic } = validateNtfySettings(settings);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (token?.trim()) headers.Authorization = `Bearer ${token.trim()}`;
        const response = await fetchImpl(server, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                topic,
                title: payload.title,
                message: payload.body,
                tags: ['speech_balloon'],
                priority: 3,
                ...(payload.url ? { click: payload.url } : {}),
            }),
            signal: controller.signal,
            credentials: 'omit',
            referrerPolicy: 'no-referrer',
            redirect: 'error',
            cache: 'no-store',
        });
        if (!response.ok) throw error('NTFY_HTTP', `ntfy 傳送失敗（HTTP ${response.status}），請檢查權限或服務額度。`);
    } catch (failure) {
        if (failure instanceof NotificationError) throw failure;
        if (controller.signal.aborted) throw error('NTFY_TIMEOUT', 'ntfy 傳送逾時，請檢查網路及伺服器。');
        throw error('NTFY_NETWORK', 'ntfy 連線失敗，請檢查網路、HTTPS 及伺服器的 CORS 設定。');
    } finally {
        clearTimeout(timer);
    }
}

/** Failures are isolated so a blocked native channel never suppresses remote delivery. */
export async function deliverNotification({ settings, token, payload, native, fetchImpl }) {
    if (!settings.enabled) return [];
    const tasks = [];
    if (settings.nativeEnabled) tasks.push(['native', () => native.send(payload)]);
    if (settings.ntfyEnabled) tasks.push(['ntfy', () => sendNtfy(settings, token, payload, { fetchImpl })]);
    return await Promise.all(tasks.map(async ([channel, send]) => {
        try {
            await send();
            return { channel, ok: true };
        } catch (failure) {
            return {
                channel,
                ok: false,
                code: failure instanceof NotificationError ? failure.code : 'DELIVERY_FAILED',
                message: failure instanceof NotificationError ? failure.message : '通知傳送失敗，請重新測試或檢查設定。',
            };
        }
    }));
}
