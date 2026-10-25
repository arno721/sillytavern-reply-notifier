import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

const root = new URL('../../', import.meta.url);
const prefix = '/scripts/extensions/third-party/sillytavern-reply-notifier/';
const allowed = new Set(['manifest.json', 'index.js', 'ui.js', 'core.js', 'notifications.js', 'service-worker.js', 'settings.html', 'style.css']);
const mime = { js: 'text/javascript', css: 'text/css', json: 'application/json', html: 'text/html' };

const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1:4179').pathname;
    let file;
    if (path === '/fixture.html') file = new URL('tests/browser/fixture.html', root);
    else if (path.startsWith(prefix) && allowed.has(path.slice(prefix.length))) file = new URL(path.slice(prefix.length), root);
    else { response.writeHead(404); response.end(); return; }
    try {
        const body = await readFile(file);
        response.writeHead(200, { 'Content-Type': `${mime[file.pathname.split('.').at(-1)]}; charset=utf-8`, 'Cache-Control': 'no-store' });
        response.end(body);
    } catch {
        response.writeHead(404);
        response.end('Not found');
    }
});

server.listen(4179, '127.0.0.1');
