export class NotificationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'NotificationError';
        this.code = code;
    }
}

const error = (code, message) => new NotificationError(code, message);
let notificationSequence = 0;

function deviceInfo(env) {
    const userAgent = env.navigator?.userAgent ?? '';
    const ios = /iPad|iPhone|iPod/.test(userAgent)
        || (/Macintosh/.test(userAgent) && env.navigator?.maxTouchPoints > 1);
    const android = /Android/i.test(userAgent);
    // Android's desktop-site mode reports Linux, including on tablets by default.
    // Use the worker-only path for touch-capable Linux contexts as a precaution.
    const touchLinux = /Linux/i.test(userAgent) && env.navigator?.maxTouchPoints > 0;
    return {
        ios,
        mobile: ios || android || touchLinux || Boolean(env.navigator?.userAgentData?.mobile),
        platform: ios ? 'ios' : android ? 'android' : 'desktop',
        standalone: Boolean(env.navigator?.standalone || env.matchMedia?.('(display-mode: standalone)').matches),
    };
}

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
        const device = deviceInfo(env);
        const { ios, mobile, standalone, platform } = device;
        let code = 'READY';
        let message = `${ios ? 'iPhone／iPad' : platform === 'android' ? 'Android' : '系統'}原生通知已授權，可點擊測試確認。`;
        if (!env.isSecureContext) {
            code = 'INSECURE_CONTEXT';
            message = '原生通知需要 HTTPS 或本機 localhost，請改以安全網址開啟酒館。';
        } else if (ios && !standalone) {
            code = 'IOS_HOME_SCREEN';
            message = 'iPhone／iPad 請用 Safari 開啟 HTTPS 酒館，選擇「分享 → 加入主畫面」，再從主畫面圖示啟動並啟用原生通知。';
        } else if (!env.Notification) {
            code = 'UNSUPPORTED';
            message = '這個瀏覽器未提供系統通知介面，請更新至支援通知的瀏覽器；iOS 需 16.4+ 並從主畫面開啟。';
        } else if (mobile && typeof env.navigator?.serviceWorker?.register !== 'function') {
            code = 'WORKER_UNAVAILABLE';
            message = '手機原生通知服務不可用，請確認使用 HTTPS 與支援 Service Worker 的瀏覽器；iOS 請從主畫面開啟酒館。';
        } else if (permission === 'denied') {
            code = 'PERMISSION_DENIED';
            message = '通知已被封鎖，請在瀏覽器的網站權限及系統通知設定中允許。';
        } else if (permission !== 'granted') {
            code = 'PERMISSION_REQUIRED';
            message = '點擊「啟用原生通知」，允許通知權限後即可在本裝置接收提醒。';
        }
        return { code, message, permission, ...device };
    }

    async requestPermission() {
        const status = this.status();
        if (!['READY', 'PERMISSION_REQUIRED'].includes(status.code)) throw error(status.code, status.message);
        if (status.permission === 'granted') return 'granted';
        // Keep this call before the first await: Safari requires a direct user gesture.
        return await this.environment.Notification.requestPermission();
    }

    async enable() {
        // Calling requestPermission synchronously preserves the button's user gesture.
        const permission = await this.requestPermission();
        if (permission !== 'granted') {
            const status = this.status();
            throw error(permission === 'denied' ? 'PERMISSION_DENIED' : 'PERMISSION_REQUIRED', status.message);
        }
        try {
            await this.getRegistration();
            return { permission, via: 'service-worker' };
        } catch (failure) {
            if (this.status().mobile) throw failure;
            return { permission, via: 'notification' };
        }
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
                throw failure instanceof NotificationError ? failure : error('WORKER_UNAVAILABLE', '通知服務啟動失敗，請確認 HTTPS 與網站權限，重新整理酒館後再啟用原生通知。');
            });
        }
        return this.registrationPromise;
    }

    async send(payload) {
        const status = this.status();
        if (status.code !== 'READY') throw error(status.code, status.message);
        // Unique tags keep later replies from silently replacing an earlier alert.
        const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++notificationSequence}`;
        const options = { body: payload.body, tag: `${payload.tag || 'sillytavern-reply'}-${id}`, data: { url: payload.url } };
        try {
            const registration = await this.getRegistration();
            await registration.showNotification(payload.title, options);
            return;
        } catch (failure) {
            const current = this.status();
            if (current.mobile) {
                if (current.code !== 'READY') throw error(current.code, current.message);
                if (failure instanceof NotificationError) throw failure;
                throw error('NATIVE_FAILED', '手機原生通知未能顯示，請檢查系統通知權限並重新啟用。iOS 請從主畫面圖示開啟。');
            }
            // Only desktop browsers can use the constructor when workers are blocked.
        }
        try {
            const notification = new this.environment.Notification(payload.title, options);
            notification.onclick = () => {
                this.environment.focus?.();
                notification.close();
            };
        } catch {
            throw error('NATIVE_FAILED', '無法顯示系統通知，請檢查瀏覽器與作業系統的通知權限，再重新測試。');
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
