import { createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, access, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const toolRoot = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(toolRoot, '../..');
const runtime = path.join(repoRoot, '.local/legacy-sandbox');
const legacy = 'C:/laragon/www/book-number';
const php = 'C:/laragon/bin/php/php-8.1.10-Win32-vs16-x64/php.exe';
const cgi = 'C:/laragon/bin/php/php-5.3.29-nts-Win32-VC9-x86/php-cgi.exe';
const webPort = 18082;
const databasePort = 3306;
const baseUrl = `http://127.0.0.1:${webPort}/`;
const stateFile = path.join(runtime, 'state.json');
const slash = value => value.replaceAll('\\', '/');
const secret = () => randomBytes(24).toString('hex');
if (process.env.NODE_ENV === 'production') throw new Error('Sandbox refuses production environment');

if (process.argv.includes('--stop')) {
  const state = JSON.parse(await readFile(stateFile, 'utf8'));
  const response = await fetch(baseUrl + '__sandbox/stop', {
    method: 'POST', headers: { 'X-Sandbox-Stop': state.stopToken },
  });
  if (!response.ok) throw new Error('Sandbox stop rejected');
  console.log('Sandbox stopped; files retained, no databases deleted.');
} else {
  await main();
}

async function checkPort(port) {
  await new Promise((resolve, reject) => {
    const probe = createSocketServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
}

async function run(executable, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`Local setup failed (${code}); no credentials printed`)));
  });
}

async function configureRuntime(web, settings) {
  let config = await readFile(path.join(legacy, 'application/config/config.php'), 'utf8');
  if ((config.match(/\$config\['encryption_key'\]\s*=/g) || []).length !== 1 ||
      (config.match(/\$config\['base_url'\]\s*=/g) || []).length !== 1) {
    throw new Error('Legacy config changed; refusing unsafe config generation');
  }
  config = config.replace(/\$config\['encryption_key'\]\s*=[^;]*;/, `$config['encryption_key'] = '${secret()}';`)
    .replace(/\$config\['base_url'\]\s*=[\s\S]*?;/, `$config['base_url'] = '${baseUrl}';`);
  config += `\n$config['sess_cookie_name'] = 't02_isolated_session';\n$config['cookie_prefix'] = '';\n$config['cookie_domain'] = '';\n$config['log_threshold'] = 0;\n`;
  await writeFile(path.join(web, 'application/config/config.php'), config);
  const group = database => ({ hostname: '127.0.0.1', port: databasePort, username: 't02_fixture', password: settings.appPassword,
    database, dbdriver: 'mysqli', dbprefix: '', pconnect: false, db_debug: false,
    cache_on: false, cachedir: '', char_set: 'utf8', dbcollat: 'utf8_general_ci', swap_pre: '', autoinit: true, stricton: false });
  const phpValue = value => typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : typeof value === 'number' ? String(value) : `'${value}'`;
  let databaseConfig = "<?php if (!defined('BASEPATH') || ENVIRONMENT !== 'testing') exit;\n$active_group = 'genbook';\n$active_record = TRUE;\n";
  for (const [name, database] of [['central', 't02_central'], ['genbook', 't02_genbook']]) {
    databaseConfig += Object.entries(group(database)).map(([key, value]) => `$db['${name}']['${key}'] = ${phpValue(value)};`).join('\n') + '\n';
  }
  // Always regenerate, including --resume: mutable runtime config is not trusted.
  await writeFile(path.join(web, 'application/config/database.php'), databaseConfig, { mode: 0o600 });
  let index = await readFile(path.join(legacy, 'index.php'), 'utf8');
  for (const expected of ["define('ENVIRONMENT', 'development')", "$system_path = 'system';", "$application_folder = 'application';"]) {
    if (!index.includes(expected)) throw new Error('Legacy front controller changed; refusing sandbox startup');
  }
  index = index.replace("define('ENVIRONMENT', 'development')", "define('ENVIRONMENT', 'testing')")
    .replace("$system_path = 'system';", `$system_path = '${slash(path.join(legacy, 'system'))}';`)
    .replace("$application_folder = 'application';", `$application_folder = '${slash(path.join(web, 'application'))}';`);
  await writeFile(path.join(web, 'index.php'), index);
  await cp(path.join(toolRoot, 'Identity.php'), path.join(web, 'application/controllers/sandbox_identity.php'));
  await cp(path.join(toolRoot, 'DenyRemoteAuth.php'), path.join(web, 'application/libraries/Authen.php'));
}

async function main() {
  await checkPort(webPort);
  for (const executable of [php, cgi]) await access(executable);
  const resume = process.argv.includes('--resume');
  const web = path.join(runtime, 'web');
  const settingsFile = path.join(runtime, 'private-settings.json');
  let settings;
  if (resume) {
    settings = JSON.parse(await readFile(settingsFile, 'utf8'));
    if (settings.databasePort !== databasePort || !/^[a-f0-9]{48}$/.test(settings.appPassword)) throw new Error('Invalid saved sandbox settings');
  } else {
  // Never reuse a directory which could contain another server's data/config.
  await mkdir(path.dirname(runtime), { recursive: true });
  await mkdir(runtime, { recursive: false });
  await mkdir(web);
  const accounts = ['owner', 'other', 'manager', 'inactive', 'no_start', 'no_prefix'].map(name => ({
    username: `t02_${name}`, password: secret(),
  }));
  settings = { databasePort, appPassword: secret(), accounts };
  await writeFile(settingsFile, JSON.stringify(settings, null, 2), { mode: 0o600 });
  await writeFile(path.join(runtime, 'test-accounts.txt'), accounts.map(account =>
    `${account.username}\t${account.password}`).join('\n') + '\n', { mode: 0o600 });

  for (const directory of ['controllers', 'models', 'views', 'libraries', 'helpers', 'errors', 'language']) {
    const source = path.join(legacy, 'application', directory);
    try { await access(source); } catch { continue; }
    await cp(source, path.join(web, 'application', directory), { recursive: true });
  }
  await mkdir(path.join(web, 'application/config'), { recursive: true });
  await mkdir(path.join(web, 'application/logs'), { recursive: true });
  for (const file of ['autoload.php', 'constants.php', 'doctypes.php', 'foreign_chars.php', 'mimes.php', 'profiler.php', 'routes.php', 'smileys.php', 'user_agents.php', 'template.php']) {
    await cp(path.join(legacy, 'application/config', file), path.join(web, 'application/config', file));
  }
  }
  await configureRuntime(web, settings);

  let closing = false;
  const stop = () => { if (!closing) { closing = true; server?.close(); } };
  let server;
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  try {
    // Readiness checked by TCP only; bootstrap creates new schemas once.
    const { createConnection } = await import('node:net');
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      ready = await new Promise(resolve => {
        const socket = createConnection({ host: '127.0.0.1', port: databasePort });
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
      });
      if (!ready) await new Promise(resolve => setTimeout(resolve, 200));
    }
    if (!ready) throw new Error('Existing localhost MySQL is not running');
    if (!resume) await run(php, [path.join(toolRoot, 'bootstrap.php'), settingsFile]);
    await run(php, [path.join(toolRoot, 'verify.php'), settingsFile]);
    const stopToken = secret();
    // Harness-only mitigation: original CI cookie sessions cannot revoke a stolen
    // pre-logout cookie. This set exists only in this isolated test process.
    const revokedCookies = new Set();
    const cookieFingerprint = value => {
      const session = (value || '').split(';').map(pair => pair.trim()).find(pair => pair.startsWith('t02_isolated_session='));
      if (!session) return null;
      return createHash('sha256').update(decodeURIComponent(session.slice('t02_isolated_session='.length))).digest('hex');
    };
    server = createServer(async (request, response) => {
      try {
        if (request.headers.host !== `127.0.0.1:${webPort}` || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress)) {
          response.writeHead(403).end(); return;
        }
        if (request.headers.origin && request.headers.origin !== baseUrl.slice(0, -1)) { response.writeHead(403).end(); return; }
        const url = new URL(request.url, baseUrl);
        response.setHeader('Content-Security-Policy', "default-src 'self' data:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'");
        if (request.headers.cookie && revokedCookies.has(cookieFingerprint(request.headers.cookie))) {
          response.writeHead(401).end('Sandbox session revoked'); return;
        }
        if (url.pathname === '/__sandbox/stop' && request.method === 'POST' && request.headers['x-sandbox-stop'] === stopToken) {
          response.writeHead(200).end('Stopped'); setTimeout(stop, 50); return;
        }
        const assetFolders = new Set(['assets', 'css', 'js', 'images', 'img', 'stylesheets', 'javascripts']);
        const segments = decodeURIComponent(url.pathname).split('/').filter(Boolean);
        // Legacy table CSS uses table-images/ relative to css/, while the
        // supplied images actually live under images/table-images/.
        if (segments[0] === 'css' && segments[1] === 'table-images') segments[0] = 'images';
        if (segments.length === 2 && segments[0] === 'js' && segments[1] === 'jquery-1.7.1.js') segments[1] = 'jquery-1.7.1.min.js';
        if (assetFolders.has(segments[0])) {
          const mime = { '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
            '.png': 'image/png', '.gif': 'image/gif', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
            '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.woff': 'font/woff', '.woff2': 'font/woff2',
            '.ttf': 'font/ttf', '.eot': 'application/vnd.ms-fontobject' }[path.extname(segments.at(-1)).toLowerCase()];
          if (!['GET', 'HEAD'].includes(request.method) || !mime || segments.some(segment => ['.', '..'].includes(segment) || segment.includes('\\') || segment.includes(':'))) {
            response.writeHead(403).end(); return;
          }
          try {
            const root = await realpath(path.join(legacy, segments[0]));
            const file = await realpath(path.join(root, ...segments.slice(1)));
            const sourceRoot = await realpath(legacy);
            if (!root.startsWith(sourceRoot + path.sep) || !file.startsWith(root + path.sep)) { response.writeHead(403).end(); return; }
            const info = await stat(file);
            if (!info.isFile() || info.size > 8_000_000) { response.writeHead(403).end(); return; }
            const body = request.method === 'HEAD' ? undefined : await readFile(file);
            response.writeHead(200, { 'Content-Type': mime, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
            response.end(body); return;
          } catch { response.writeHead(404).end(); return; }
        }
        const allowed = new Set(['/', '/user/authen', '/user/logout', '/genbook', '/genbook/form', '/sandbox_identity']);
        if (!allowed.has(url.pathname) || !['GET', 'POST'].includes(request.method) ||
            (request.method === 'POST' && url.pathname !== '/user/authen')) {
          response.writeHead(403).end('Read-only sandbox: route blocked'); return;
        }
        if (url.search) { response.writeHead(403).end(); return; }
        let body = Buffer.alloc(0);
        for await (const chunk of request) { body = Buffer.concat([body, chunk]); if (body.length > 8192) throw new Error('Body too large'); }
        if (request.method === 'POST' && !new URLSearchParams(body.toString()).get('uname')?.startsWith('t02_')) {
          response.writeHead(403).end('Synthetic accounts only'); return;
        }
        if (url.pathname === '/user/logout' && request.headers.cookie) revokedCookies.add(cookieFingerprint(request.headers.cookie));
        const child = spawn(cgi, ['-d', 'cgi.force_redirect=0', '-d', 'display_errors=0', '-d', 'log_errors=1', '-d', `error_log=${slash(path.join(runtime, 'php-errors.log'))}`], {
          cwd: web, windowsHide: true,
          env: { ...process.env, REDIRECT_STATUS: '1', GATEWAY_INTERFACE: 'CGI/1.1', REQUEST_METHOD: request.method,
            REQUEST_URI: url.pathname, SCRIPT_NAME: '/index.php', PHP_SELF: '/index.php',
            SCRIPT_FILENAME: slash(path.join(web, 'index.php')), DOCUMENT_ROOT: slash(web),
            SERVER_NAME: '127.0.0.1', SERVER_PORT: String(webPort), SERVER_PROTOCOL: 'HTTP/1.1', REMOTE_ADDR: '127.0.0.1',
            HTTP_HOST: `127.0.0.1:${webPort}`, HTTP_COOKIE: request.headers.cookie || '',
            CONTENT_TYPE: request.headers['content-type'] || '', CONTENT_LENGTH: String(body.length), QUERY_STRING: '',
          },
        });
        const chunks = []; let bytes = 0;
        child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes < 2_000_000) chunks.push(chunk); else child.kill(); });
        child.stderr.resume();
        const timer = setTimeout(() => child.kill(), 15000);
        child.on('error', () => { clearTimeout(timer); if (!response.headersSent) response.writeHead(502).end('Sandbox CGI failed'); });
        child.on('close', code => {
          clearTimeout(timer);
          if (response.headersSent) return;
          if (code !== 0 || bytes >= 2_000_000) { response.writeHead(502).end('Sandbox CGI failed'); return; }
          const output = Buffer.concat(chunks); const separator = output.indexOf('\r\n\r\n');
          if (separator < 0) { response.writeHead(502).end('Invalid CGI response'); return; }
          let status = 200;
          for (const line of output.subarray(0, separator).toString().split('\r\n')) {
            const colon = line.indexOf(':'); if (colon < 0) continue;
            const name = line.slice(0, colon); const value = line.slice(colon + 1).trim();
            if (name.toLowerCase() === 'status') status = Number.parseInt(value, 10);
            else if (name.toLowerCase() === 'set-cookie') response.appendHeader(name, value);
            else if (name.toLowerCase() === 'location') {
              if (new URL(value, baseUrl).origin !== baseUrl.slice(0, -1)) { response.writeHead(502).end('External redirect blocked'); return; }
              response.setHeader(name, value);
            } else response.setHeader(name, value);
          }
          response.setHeader('Cache-Control', 'no-store');
          response.writeHead(status).end(output.subarray(separator + 4));
        });
        child.stdin.end(body);
      } catch { if (!response.headersSent) response.writeHead(500).end('Sandbox request failed'); }
    });
    await new Promise(resolve => server.listen(webPort, '127.0.0.1', resolve));
    await writeFile(stateFile, JSON.stringify({ baseUrl, databasePort, stopToken, pid: process.pid }), { mode: 0o600 });
    console.log(`Synthetic sandbox ready: ${baseUrl}`);
    console.log('Test credentials are in .local/legacy-sandbox/test-accounts.txt (ignored by Git).');
  } catch (error) { stop(); throw error; }
}
