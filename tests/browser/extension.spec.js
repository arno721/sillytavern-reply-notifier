import { test, expect } from '@playwright/test';

const modulePath = '/scripts/extensions/third-party/sillytavern-reply-notifier/index.js';

async function open(page) {
    await page.goto('/fixture.html');
    await expect(page.locator('#reply_notifier_settings')).toBeVisible();
}

async function ntfySetup(page) {
    const requests = [];
    await page.route('https://ntfy.example/**', async route => {
        requests.push({ body: route.request().postDataJSON(), headers: route.request().headers() });
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{"id":"test"}' });
    });
    await page.locator('[data-setting="nativeEnabled"]').uncheck();
    await page.locator('[data-setting="ntfyEnabled"]').check();
    await page.locator('[data-setting="ntfyServer"]').fill('https://ntfy.example');
    await page.locator('[data-setting="ntfyTopic"]').fill('st-browser-topic');
    return requests;
}

test('settings persist while tokens remain outside saved preferences', async ({ page }) => {
    await open(page);
    await expect(page.locator('[data-setting="includePreview"]')).not.toBeChecked();
    await page.locator('[data-setting="onlyWhenAway"]').check();
    await page.locator('[data-token]').fill('tk_browser_secret');
    await expect.poll(() => page.evaluate(() => fixture.saveCount)).toBeGreaterThan(0);
    const saved = await page.evaluate(() => localStorage.getItem('fixture-settings'));
    expect(saved).not.toContain('tk_browser_secret');
    await page.reload();
    await expect(page.locator('[data-setting="onlyWhenAway"]')).toBeChecked();
    await expect(page.locator('[data-token]')).toHaveValue('tk_browser_secret');
});

test('both real event orders send one private notification and support Chinese previews', async ({ page }) => {
    await open(page);
    const requests = await ntfySetup(page);
    await page.evaluate(() => fixture.reply('私密訊息', 'end-first'));
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0].body.message).toBe('AI 回覆已完成，點擊返回酒館。');
    expect(requests[0].body.title).toBe('SillyTavern · 回覆完成');
    await page.locator('[data-setting="includePreview"]').check();
    await page.evaluate(() => fixture.reply('你好，朋友 🔔'));
    await expect.poll(() => requests.length).toBe(2);
    expect(requests[1].body.message).toBe('你好，朋友 🔔');
    expect(requests[1].body.title).toBe('Alice · 回覆完成');
});

test('chat switches cancel delayed completions through the host event bus', async ({ page }) => {
    await open(page);
    const requests = await ntfySetup(page);
    await page.evaluate(async () => {
        await fixture.reply('stale');
        fixture.currentChatId = 'other-chat';
        await fixture.emit('CHAT_CHANGED', 'other-chat');
    });
    await page.waitForTimeout(400);
    expect(requests).toHaveLength(0);
});

test('focused-tab filtering skips automatic notifications but allows explicit tests', async ({ page }) => {
    await open(page);
    const requests = await ntfySetup(page);
    await page.locator('[data-setting="onlyWhenAway"]').check();
    await page.bringToFront();
    await page.evaluate(() => fixture.reply());
    await page.waitForTimeout(400);
    expect(requests).toHaveLength(0);
    await page.locator('[data-action="test-ntfy"]').click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(page.locator('[data-status="result"]')).toContainText('成功');
});

test('topic generation updates preferences and the subscription link', async ({ page }) => {
    await open(page);
    await page.locator('[data-action="generate-topic"]').click();
    const topic = await page.locator('[data-setting="ntfyTopic"]').inputValue();
    expect(topic).toMatch(/^st-[0-9a-f]{32}$/);
    await expect(page.locator('[data-subscribe]')).toHaveAttribute('href', `https://ntfy.sh/${topic}`);
});

test('disabling removes event handlers and enabling registers exactly once', async ({ page }) => {
    await open(page);
    await page.evaluate(async path => {
        const extension = await import(path);
        extension.onDisable();
    }, modulePath);
    await expect(page.locator('#reply_notifier_settings')).toHaveCount(0);
    expect(await page.evaluate(() => fixture.listenerCount('GENERATION_STARTED'))).toBe(0);
    await page.evaluate(async path => {
        const extension = await import(path);
        await Promise.all([extension.onEnable(), extension.onEnable()]);
    }, modulePath);
    await expect(page.locator('#reply_notifier_settings')).toHaveCount(1);
    expect(await page.evaluate(() => fixture.listenerCount('GENERATION_STARTED'))).toBe(1);
});

test('settings fit a mobile screen without horizontal overflow', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await open(page);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await expect(page.getByText('iOS／Android 接收方式')).toBeVisible();
});

test('Chromium activates a real scoped worker and stores an actual notification', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit automation does not expose OS notification permissions.');
    await context.grantPermissions(['notifications']);
    await open(page);
    await page.locator('[data-action="test-native"]').click();
    await expect(page.locator('[data-status="result"]')).toContainText('成功');
    const notification = await page.evaluate(async () => {
        const registrations = await navigator.serviceWorker.getRegistrations();
        const registration = registrations.find(item => item.scope.endsWith('/sillytavern-reply-notifier/'));
        const notifications = await registration.getNotifications();
        const values = notifications.map(item => ({ title: item.title, body: item.body, url: item.data.url }));
        notifications.forEach(item => item.close());
        return { scope: registration.scope, active: registration.active.state, values, controller: navigator.serviceWorker.controller };
    });
    expect(notification.active).toBe('activated');
    expect(notification.controller).toBeNull();
    expect(notification.values[0].title).toContain('測試通知');
    expect(notification.values[0].url).toBe('http://127.0.0.1:4179/fixture.html');
});
