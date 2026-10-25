import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
assert.equal(manifest.version, pkg.version, 'Extension and package versions must match.');
assert.ok(manifest.display_name && manifest.author && manifest.homePage);
for (const file of [manifest.js, manifest.css, 'settings.html', 'LICENSE', 'README.md']) {
    await access(new URL(`../${file}`, import.meta.url));
}
for (const file of ['core.js', 'notifications.js', 'service-worker.js', 'index.js', 'ui.js']) {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
}
console.log(`Validated extension v${manifest.version}: manifest, installable files and JavaScript syntax.`);
