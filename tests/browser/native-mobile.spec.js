import { test, expect } from '@playwright/test';

async function open(page) {
    await page.goto('/fixture.html');
    await expect(page.locator('#reply_notifier_settings')).toBeVisible();
}

test('native-first setup provides Android/iOS instructions with optional push folded away', async ({ page }, testInfo) => {
    await open(page);
    await expect(page.getByRole('button', { name: '啟用原生通知', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Android 原生通知', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'iPhone／iPad 原生通知', exact: true })).toBeVisible();
    await expect(page.locator('[data-setting="ntfyEnabled"]')).not.toBeVisible();
    if (testInfo.project.name === 'ios-webkit') {
        await expect(page.locator('[data-status="native"]')).toContainText('加入主畫面');
        await page.locator('[data-action="permission"]').click();
        await expect(page.locator('[data-status="result"]')).toContainText('從主畫面圖示啟動');
    }
    await page.locator('.rn-advanced > summary').click();
    await expect(page.locator('[data-setting="ntfyEnabled"]')).toBeVisible();
    await expect(page.locator('[data-setting="ntfyEnabled"]')).not.toBeChecked();
});

test('native enable activates the real worker before the test notification', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit automation cannot grant native OS notification permission.');
    await context.grantPermissions(['notifications']);
    await open(page);
    await page.locator('[data-action="permission"]').click();
    await expect(page.locator('[data-status="result"]')).toContainText('原生通知已啟用');
    const prepared = await page.evaluate(async () => {
        const registration = (await navigator.serviceWorker.getRegistrations()).find(item => item.scope.endsWith('/sillytavern-reply-notifier/'));
        return registration ? { active: registration.active?.state, count: (await registration.getNotifications()).length } : null;
    });
    expect(prepared).toEqual({ active: 'activated', count: 0 });
    await page.locator('[data-action="test-native"]').click();
    await expect(page.locator('[data-status="result"]')).toContainText('傳送成功');
});

test('a completed reply creates an actual native worker notification with no ntfy', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'WebKit automation cannot grant native OS notification permission.');
    const external = [];
    page.on('request', request => {
        if (new URL(request.url()).origin !== 'http://127.0.0.1:4179') external.push(request.url());
    });
    await context.grantPermissions(['notifications']);
    await open(page);
    await page.locator('[data-action="permission"]').click();
    await expect(page.locator('[data-status="result"]')).toContainText('原生通知已啟用');
    await page.evaluate(() => fixture.reply('私人手機回覆', 'end-first'));
    await expect.poll(() => page.evaluate(async () => {
        const registration = (await navigator.serviceWorker.getRegistrations()).find(item => item.scope.endsWith('/sillytavern-reply-notifier/'));
        return (await registration.getNotifications()).map(item => ({ title: item.title, body: item.body }));
    })).toEqual([{ title: 'SillyTavern · 回覆完成', body: 'AI 回覆已完成，點擊返回酒館。' }]);
    expect(external).toEqual([]);
});
