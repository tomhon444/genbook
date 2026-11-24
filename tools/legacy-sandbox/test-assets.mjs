import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:18082/';
const response = await fetch(base, { redirect: 'manual' });
let html = await response.text();
const settings = JSON.parse(await readFile(new URL('../../.local/legacy-sandbox/private-settings.json', import.meta.url), 'utf8'));
const account = settings.accounts.find(item => item.username === 't02_owner');
const login = await fetch(base + 'user/authen', { method: 'POST', redirect: 'manual',
  body: new URLSearchParams({ uname: account.username, upass: account.password }) });
await login.arrayBuffer();
assert.equal(login.status, 302);
const cookie = [...new Map(login.headers.getSetCookie().map(value => {
  const pair = value.split(';')[0]; return [pair.slice(0, pair.indexOf('=')), pair];
})).values()].join('; ');
const dashboard = await fetch(base + 'genbook', { redirect: 'manual', headers: { Cookie: cookie } });
assert.equal(dashboard.status, 200);
html += await dashboard.text();
html = html.replace(/<!--[\s\S]*?-->/g, '');
const assets = [...new Set([...html.matchAll(/(?:href|src)\s*=\s*["']([^"']+)["']/gi)]
  .map(match => new URL(match[1], base))
  .filter(url => url.origin === new URL(base).origin && /\.(css|js|png|gif|jpe?g|ico)(?:$)/i.test(url.pathname))
  .map(url => url.href))];
assert(assets.some(url => url.endsWith('.css')), 'Legacy template must reference a stylesheet');
for (const asset of assets) {
  const result = await fetch(asset, { redirect: 'manual' });
  assert.equal(result.status, 200, `Template asset unavailable: ${new URL(asset).pathname}`);
  const content = await result.text();
  if (new URL(asset).pathname.endsWith('.css')) {
    assert.match(result.headers.get('content-type'), /^text\/css/);
    const activeCss = content.replace(/\/\*[\s\S]*?\*\//g, '');
    for (const match of activeCss.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) {
      const image = new URL(match[1], asset);
      if (image.origin !== new URL(base).origin) continue;
      const background = await fetch(image, { redirect: 'manual' });
      await background.arrayBuffer();
      assert.equal(background.status, 200, `CSS background unavailable in ${new URL(asset).pathname}: ${image.pathname}`);
    }
  }
}
for (const route of ['assets/../application/config/database.php', 'assets/%2e%2e%2fapplication/config/database.php', 'assets/index.php']) {
  const result = await fetch(new URL(route, base), { redirect: 'manual' });
  await result.arrayBuffer();
  assert([403, 404].includes(result.status), 'Static handler must not expose application or PHP files');
}
assert.equal((await fetch(base + 'css/templatemo_style.css', { method: 'POST' })).status, 403);
assert.equal((await fetch(base + 'css/templatemo_style.css', { headers: { Origin: 'https://example.invalid' } })).status, 403);
console.log(JSON.stringify({ templateAssetsPassed: assets.length, traversalAndPhpBlocked: true }));
