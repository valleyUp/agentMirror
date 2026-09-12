import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { createServer } from 'node:http';
import { stringify } from 'yaml';

const root = process.env.MIRROR_ROOT || '/opt/mirror';
// This is an internal filesystem path, never substituted from HTTP requests.
if (!/^\/[a-zA-Z0-9/_-]+$/.test(root)) throw Error('Invalid MIRROR_ROOT');
let publicUrl = process.env.PUBLIC_URL || '';
if (publicUrl) {
  const u = new URL(publicUrl);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error('PUBLIC_URL must be an http(s) origin without path or credentials');
  publicUrl = u.origin;
}
await access(`${root}/storage`);
const catalogPath = `${root}/public/catalog.json`;
await access(catalogPath);
const catalog = JSON.parse(await readFile(catalogPath, 'utf8'));
if (typeof catalog.nodeVersion !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(catalog.nodeVersion)) throw Error('Invalid catalog Node.js version');
const nodeFilename = `node-v${catalog.nodeVersion}-linux-x64.tar.xz`;
const nodeAsset = catalog.assets?.find(asset => asset.filename === nodeFilename);
if (!nodeAsset || nodeAsset.path !== `/downloads/${nodeFilename}` || !/^[a-f0-9]{64}$/.test(nodeAsset.sha256)) throw Error('Catalog has no valid Linux x64 Node.js asset');
const installerTemplates = {
  '/install-tool.sh': await readFile(`${root}/installers/install-tool.sh`, 'utf8'),
  '/install.sh': await readFile(`${root}/installers/install.sh`, 'utf8'),
  '/install.ps1': await readFile(`${root}/installers/install.ps1`, 'utf8'),
  '/install-node.sh': await readFile(`${root}/installers/install-node.sh`, 'utf8'),
};
for (const [path, template] of Object.entries(installerTemplates)) if (path === '/install-node.sh') {
  for (const placeholder of ['__NODE_MIRROR_BASE_URL__', '__NODE_VERSION__', '__NODE_LINUX_X64_FILENAME__', '__NODE_LINUX_X64_SHA256__']) {
    if (!template.includes(placeholder)) throw Error(`Invalid Node.js installer template: missing ${placeholder}`);
  }
} else if (path === '/install-tool.sh') {
  if (!template.includes('__TOOL_CONFIG_BASE64__')) throw Error('Invalid tool installer template');
} else if (!template.includes('__CLAUDE_MIRROR_BASE_URL__')) throw Error('Invalid Claude installer template');
await writeFile(`${root}/public/runtime.json`, JSON.stringify({ publicUrl }));
await writeFile('/tmp/verdaccio.yaml', stringify({
  storage: `${root}/storage`,
  auth: { htpasswd: { file: '/tmp/disabled.htpasswd', max_users: -1 } },
  uplinks: {}, packages: { '**': { access: '$all', publish: [], unpublish: [] } },
  url_prefix: '/npm/', web: { enable: false },
  log: { type: 'stdout', format: 'json', level: 'http' },
}));
await writeFile('/tmp/nginx.conf', `
pid /tmp/agent-mirror-nginx.pid;
error_log /dev/stderr warn;
worker_processes auto;
events { worker_connections 1024; }
http {
  include /etc/nginx/mime.types;
  default_type application/octet-stream;
  access_log /dev/stdout;
  sendfile on;
  client_body_temp_path /tmp/nginx-client;
  proxy_temp_path /tmp/nginx-proxy;
  fastcgi_temp_path /tmp/nginx-fastcgi;
  uwsgi_temp_path /tmp/nginx-uwsgi;
  scgi_temp_path /tmp/nginx-scgi;
  server {
    listen 8080;
    root ${root}/public;
    add_header X-Content-Type-Options nosniff always;
    add_header Referrer-Policy no-referrer always;
    location = / {
      limit_except GET HEAD { deny all; }
      etag off;
      if_modified_since off;
      add_header Cache-Control "no-store, no-cache, must-revalidate" always;
      add_header Pragma "no-cache" always;
      add_header X-Content-Type-Options nosniff always;
      add_header Referrer-Policy no-referrer always;
      try_files /index.html =404;
    }
    location = /index.html {
      limit_except GET HEAD { deny all; }
      etag off;
      if_modified_since off;
      add_header Cache-Control "no-store, no-cache, must-revalidate" always;
      add_header Pragma "no-cache" always;
      add_header X-Content-Type-Options nosniff always;
      add_header Referrer-Policy no-referrer always;
    }
    location = /app.js {
      limit_except GET HEAD { deny all; }
      etag off;
      if_modified_since off;
      add_header Cache-Control "no-store, no-cache, must-revalidate" always;
      add_header Pragma "no-cache" always;
      add_header X-Content-Type-Options nosniff always;
      add_header Referrer-Policy no-referrer always;
    }
    location = /style.css {
      limit_except GET HEAD { deny all; }
      etag off;
      if_modified_since off;
      add_header Cache-Control "no-store, no-cache, must-revalidate" always;
      add_header Pragma "no-cache" always;
      add_header X-Content-Type-Options nosniff always;
      add_header Referrer-Policy no-referrer always;
    }
    location / { limit_except GET HEAD { deny all; } try_files $uri $uri/ =404; }
    location = /catalog.json { add_header Cache-Control no-store; }
    location = /runtime.json { add_header Cache-Control no-store; }
    location = /install.sh {
      limit_except GET HEAD { deny all; }
      add_header Cache-Control no-store;
      proxy_set_header Host $http_host;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_pass http://127.0.0.1:4874/install.sh;
    }
    location = /install.ps1 {
      limit_except GET HEAD { deny all; }
      add_header Cache-Control no-store;
      proxy_set_header Host $http_host;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_pass http://127.0.0.1:4874/install.ps1;
    }
    location = /install-tool.sh {
      limit_except GET HEAD { deny all; }
      add_header Cache-Control no-store;
      proxy_set_header Host $http_host;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_pass http://127.0.0.1:4874/install-tool.sh;
    }
    location = /install-node.sh {
      limit_except GET HEAD { deny all; }
      add_header Cache-Control no-store;
      proxy_set_header Host $http_host;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_pass http://127.0.0.1:4874/install-node.sh;
    }
    location /npm/ {
      limit_except GET HEAD { deny all; }
      proxy_set_header Host $http_host;
      # Keep libc and full install metadata; some abbreviated registry responses
      # omit libc, causing glibc and musl optional packages to be confused.
      proxy_set_header Accept application/json;
      proxy_set_header X-Forwarded-Proto $scheme;
      proxy_set_header X-Forwarded-For $remote_addr;
      proxy_pass http://127.0.0.1:4873/;
      proxy_read_timeout 300s;
      proxy_buffering off;
    }
    location = /healthz { proxy_pass http://127.0.0.1:4874/healthz; }
  }
}
`);
const children = [];
let stopping = false;
const health = createServer(async (req, res) => {
  try {
    const template = installerTemplates[req.url];
    if (template) {
      const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'https:' : 'http:';
      const host = req.headers.host;
      if (!host) throw Error('Host header required');
      const requested = new URL(`${protocol}//${host}`);
      if (requested.username || requested.password || requested.pathname !== '/' || requested.search || requested.hash) throw Error('Invalid mirror origin');
      const origin = publicUrl || requested.origin;
      const body = req.url === '/install-tool.sh'
        ? template.replaceAll('__TOOL_CONFIG_BASE64__', Buffer.from(JSON.stringify({ origin, tools: catalog.tools })).toString('base64'))
        : req.url === '/install-node.sh'
        ? template
          .replaceAll('__NODE_MIRROR_BASE_URL__', `${origin}/downloads`)
          .replaceAll('__NODE_VERSION__', catalog.nodeVersion)
          .replaceAll('__NODE_LINUX_X64_FILENAME__', nodeFilename)
          .replaceAll('__NODE_LINUX_X64_SHA256__', nodeAsset.sha256)
        : template.replaceAll('__CLAUDE_MIRROR_BASE_URL__', `${origin}/claude-code-releases`);
      if (/__[A-Z0-9_]+__/.test(body)) throw Error('Unresolved installer template placeholder');
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    if (req.url !== '/healthz') { res.writeHead(404); res.end('not found'); return; }
    if (stopping || children.length !== 2 || children.some(p => p.exitCode !== null)) throw Error('Service exited');
    await readFile(catalogPath);
    const r = await fetch('http://127.0.0.1:4873/-/ping', { signal: AbortSignal.timeout(2000) });
    if (!r.ok) throw Error('Registry not ready');
    res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ok"}');
  } catch { res.writeHead(503); res.end('not ready'); }
});
health.listen(4874, '127.0.0.1');
function stop(code) {
  if (stopping) return; stopping = true; health.close();
  for (const p of children) p.kill('SIGTERM');
  const timer = setTimeout(() => { for (const p of children) p.kill('SIGKILL'); process.exit(code); }, 8000);
  Promise.all(children.map(p => p.exitCode !== null || p.signalCode !== null ? Promise.resolve() : new Promise(r => p.once('exit', r)))).then(() => { clearTimeout(timer); process.exit(code); });
}
for (const [cmd, args, env] of [
  [process.execPath, ['/app/node_modules/verdaccio/bin/verdaccio', '-c', '/tmp/verdaccio.yaml', '-l', '127.0.0.1:4873'], { ...process.env, ...(publicUrl ? { VERDACCIO_PUBLIC_URL: publicUrl } : {}) }],
  ['/usr/sbin/nginx', ['-c', '/tmp/nginx.conf', '-g', 'daemon off;'], process.env],
]) {
  const p = spawn(cmd, args, { stdio: 'inherit', env }); children.push(p);
  p.on('error', e => { console.error(e); stop(1); });
  p.on('exit', (code, signal) => { if (!stopping) { console.error(`${cmd} exited: ${code ?? signal}`); stop(1); } });
}
process.on('SIGTERM', () => stop(0)); process.on('SIGINT', () => stop(0));
