// Local acceptance harness only. This server and its switch endpoint are not part of dist.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, extname } from 'node:path';

const builds = [
  { name: 'release-a', base: '/', stamp: 'acceptance-a' },
  { name: 'release-b', base: '/', stamp: 'acceptance-b' },
  { name: 'subpath', base: '/rpg-trip/', stamp: 'acceptance-subpath' },
];
for (const build of builds) {
  const result = spawnSync(
    process.execPath,
    ['node_modules/vite/bin/vite.js', 'build'],
    {
      stdio: 'inherit',
      env: {
        ...process.env,
        DEPLOY_BASE: build.base,
        APP_BUILD: build.stamp,
        BUILD_OUT_DIR: `artifacts/deployment/${build.name}`,
      },
    },
  );
  if (result.status !== 0) process.exit(result.status || 1);
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
const servers = [];
for (const port of [4174, 4175, 4176, 4177, 4178]) {
  const subpath = port === 4175 || port === 4177;
  let current = subpath ? 'subpath' : 'release-a';
  let offline = false;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    if (url.pathname === '/__test/network' && req.method === 'POST') {
      offline = url.searchParams.get('offline') === 'true';
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ offline }));
      return;
    }
    if (
      url.pathname === '/__test/deploy' &&
      req.method === 'POST' &&
      !subpath
    ) {
      current =
        url.searchParams.get('release') === 'b' ? 'release-b' : 'release-a';
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ current }));
      return;
    }
    if (offline) {
      req.socket.destroy();
      return;
    }
    const base = subpath ? '/rpg-trip/' : '/';
    if (!url.pathname.startsWith(base)) {
      res.writeHead(404);
      res.end();
      return;
    }
    const root = resolve(`artifacts/deployment/${current}`);
    const path = resolve(
      root,
      decodeURIComponent(url.pathname.slice(base.length)) || 'index.html',
    );
    if (!path.startsWith(`${root}/`)) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      const file = (await stat(path)).isDirectory()
        ? resolve(path, 'index.html')
        : path;
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': types[extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((resolveReady) =>
    server.listen(port, '127.0.0.1', resolveReady),
  );
  servers.push(server);
}
console.log(
  'Acceptance build servers: root 4174/4176; /rpg-trip/ on 4175/4177; photos on 4178',
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    for (const server of servers) server.close();
    process.exit(0);
  });
}
