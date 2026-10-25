import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/browser',
    timeout: 15000,
    expect: { timeout: 5000 },
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 1 : 0,
    workers: process.env.CI ? 2 : 4,
    reporter: 'list',
    use: { baseURL: 'http://127.0.0.1:4179', trace: 'retain-on-failure' },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'], channel: 'chromium' } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    ],
    webServer: {
        command: 'node tests/browser/server.mjs',
        url: 'http://127.0.0.1:4179/fixture.html',
        reuseExistingServer: !process.env.CI,
        timeout: 10000,
    },
});
