#!/usr/bin/env node
/**
 * Tryb imprezowy: cała gra z jednego komputera, dostępna z internetu przez
 * darmowy tunel Cloudflare (bez domeny, bez konta, bez otwierania portów).
 *
 *   pnpm party              → PocketBase + serwer gry + Next (prod) + proxy + tunel
 *   pnpm party --lan        → bez tunelu, tylko sieć lokalna (Wi‑Fi)
 *   pnpm party --build      → wymuś przebudowanie frontendu
 *
 * Wszystko idzie przez JEDEN port (PARTY_PORT, domyślnie 8080):
 *   /pb/*        → PocketBase (127.0.0.1:8090), prefiks /pb jest ucinany
 *   /socket.io/* → Express + Socket.io (127.0.0.1:3002), także WebSocket
 *   reszta       → Next.js (127.0.0.1:3000)
 * Dzięki temu frontend używa adresów względnych i nie trzeba go przebudowywać,
 * gdy tunel dostanie nowy losowy adres *.trycloudflare.com.
 *
 * Brakujące binarki (PocketBase, cloudflared) są pobierane do .tools/ z oficjalnych
 * wydań na GitHubie. Własne ścieżki: POCKETBASE_BIN, CLOUDFLARED_BIN w .env.
 */
import { spawn, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, chmodSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import http from 'http';
import net from 'net';
import { config as loadEnv } from 'dotenv';
import qrcode from 'qrcode-terminal';
import { detectLanIPv4 } from './detect-lan-ip.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: join(repoRoot, '.env') });

const args = new Set(process.argv.slice(2));
const LAN_ONLY = args.has('--lan');
const FORCE_BUILD = args.has('--build');

const PB_VERSION = '0.36.8';
const PARTY_PORT = Number(process.env.PARTY_PORT || 8080);
const PB_PORT = 8090;
const SOCKET_PORT = 3002;
const WEB_PORT = 3000;
const IS_WIN = process.platform === 'win32';
const TOOLS_DIR = join(repoRoot, '.tools');
const WEB_DIR = join(repoRoot, 'apps', 'web');
const SERVER_DIR = join(repoRoot, 'apps', 'server');
const DIST_DIR = '.next-party';
const PB_DATA = join(repoRoot, 'pb', 'pb_data');
const PB_MIGRATIONS = join(repoRoot, 'pb_migrations');

const children = [];
let shuttingDown = false;

function log(tag, msg) {
  console.log(`[${tag}] ${msg}`);
}

function expandHome(p) {
  return p?.startsWith('~') ? join(homedir(), p.slice(1)) : p;
}

// ── Pobieranie narzędzi ───────────────────────────────────────────────────────

function archName() {
  return process.arch === 'arm64' ? 'arm64' : 'amd64';
}

async function download(url, dest) {
  log('setup', `pobieram ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} dla ${url}`);
  writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

function extract(archive, destDir) {
  // bsdtar (Windows 10+, macOS) rozpakowuje też .zip; na Linuksie fallback na unzip.
  let r = spawnSync('tar', ['-xf', archive, '-C', destDir], { stdio: 'inherit' });
  if (r.status !== 0 && archive.endsWith('.zip')) {
    r = spawnSync('unzip', ['-o', archive, '-d', destDir], { stdio: 'inherit' });
  }
  if (r.status !== 0) throw new Error(`Nie udało się rozpakować ${archive}`);
}

async function ensurePocketBase() {
  const custom = expandHome(process.env.POCKETBASE_BIN);
  if (custom) {
    if (!existsSync(custom)) throw new Error(`POCKETBASE_BIN wskazuje na nieistniejący plik: ${custom}`);
    return custom;
  }
  const dir = join(TOOLS_DIR, `pocketbase-${PB_VERSION}`);
  const bin = join(dir, IS_WIN ? 'pocketbase.exe' : 'pocketbase');
  if (existsSync(bin)) return bin;

  const os = IS_WIN ? 'windows' : process.platform === 'darwin' ? 'darwin' : 'linux';
  const file = `pocketbase_${PB_VERSION}_${os}_${archName()}.zip`;
  mkdirSync(dir, { recursive: true });
  const zip = join(dir, file);
  await download(`https://github.com/pocketbase/pocketbase/releases/download/v${PB_VERSION}/${file}`, zip);
  extract(zip, dir);
  if (!IS_WIN) chmodSync(bin, 0o755);
  return bin;
}

async function ensureCloudflared() {
  const custom = expandHome(process.env.CLOUDFLARED_BIN);
  if (custom) return custom;
  if (spawnSync('cloudflared', ['--version'], { stdio: 'ignore' }).status === 0) return 'cloudflared';

  mkdirSync(TOOLS_DIR, { recursive: true });
  const base = 'https://github.com/cloudflare/cloudflared/releases/latest/download';
  if (IS_WIN) {
    const bin = join(TOOLS_DIR, 'cloudflared.exe');
    if (!existsSync(bin)) await download(`${base}/cloudflared-windows-${archName()}.exe`, bin);
    return bin;
  }
  const bin = join(TOOLS_DIR, 'cloudflared');
  if (existsSync(bin)) return bin;
  if (process.platform === 'darwin') {
    const tgz = join(TOOLS_DIR, 'cloudflared.tgz');
    await download(`${base}/cloudflared-darwin-${archName()}.tgz`, tgz);
    extract(tgz, TOOLS_DIR);
  } else {
    await download(`${base}/cloudflared-linux-${archName()}`, bin);
  }
  chmodSync(bin, 0o755);
  return bin;
}

// ── Procesy ───────────────────────────────────────────────────────────────────

function run(tag, cmd, cmdArgs, opts = {}) {
  const child = spawn(cmd, cmdArgs, {
    cwd: opts.cwd || repoRoot,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const onData = (buf) => {
    for (const line of buf.toString().split(/\r?\n/)) {
      if (!line.trim()) continue;
      if (opts.onLine?.(line) === false) continue;
      log(tag, line);
    }
  };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  child.on('exit', (code) => {
    if (shuttingDown || opts.oneShot) return;
    log(tag, `proces zakończył się (kod ${code}) — zamykam resztę`);
    shutdown(1);
  });
  if (!opts.oneShot) children.push(child);
  return child;
}

function runToEnd(tag, cmd, cmdArgs, opts = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = run(tag, cmd, cmdArgs, { ...opts, oneShot: true });
    child.on('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`${tag}: kod wyjścia ${code}`))));
    child.on('error', reject);
  });
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log('party', 'zamykam…');
  for (const c of children) {
    if (c.exitCode !== null) continue;
    if (IS_WIN) spawnSync('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
    else c.kill('SIGTERM');
  }
  setTimeout(() => process.exit(code), 500);
}

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

async function waitForHttp(port, path, label, timeoutMs = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok = await new Promise((r) => {
      const req = http.get({ host: '127.0.0.1', port, path, timeout: 2000 }, (res) => {
        res.resume();
        r(res.statusCode < 500);
      });
      req.on('error', () => r(false));
      req.on('timeout', () => {
        req.destroy();
        r(false);
      });
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${label} nie odpowiada na porcie ${port}`);
}

// ── Proxy na jednym porcie ────────────────────────────────────────────────────

function pickTarget(url) {
  if (url === '/pb' || url.startsWith('/pb/') || url.startsWith('/pb?')) {
    let path = url.slice(3);
    if (!path.startsWith('/')) path = '/' + path;
    return { port: PB_PORT, path, isPb: true };
  }
  if (url.startsWith('/socket.io')) return { port: SOCKET_PORT, path: url };
  return { port: WEB_PORT, path: url };
}

function startProxy() {
  const agent = new http.Agent({ keepAlive: true, maxSockets: 256 });

  const server = http.createServer((req, res) => {
    const t = pickTarget(req.url);
    const headers = {
      ...req.headers,
      'x-forwarded-host': req.headers['x-forwarded-host'] || req.headers.host,
      'x-forwarded-proto': req.headers['x-forwarded-proto'] || 'http',
    };
    const upstream = http.request(
      { host: '127.0.0.1', port: t.port, method: req.method, path: t.path, headers, agent },
      (ures) => {
        const outHeaders = { ...ures.headers };
        // PocketBase przekierowuje np. /_ → /_/ — dopisz prefiks /pb.
        if (t.isPb && typeof outHeaders.location === 'string' && outHeaders.location.startsWith('/')) {
          outHeaders.location = '/pb' + outHeaders.location;
        }
        res.writeHead(ures.statusCode, outHeaders);
        ures.pipe(res);
      }
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Gra jeszcze startuje albo jeden z procesów nie działa — odśwież za chwilę.');
    });
    req.pipe(upstream);
  });

  // WebSocket (Socket.io) — przepinamy surowe połączenie TCP.
  server.on('upgrade', (req, socket, head) => {
    const t = pickTarget(req.url);
    const upstream = net.connect(t.port, '127.0.0.1', () => {
      let raw = `${req.method} ${t.path} HTTP/${req.httpVersion}\r\n`;
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        raw += `${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`;
      }
      upstream.write(raw + '\r\n');
      if (head?.length) upstream.write(head);
      upstream.pipe(socket);
      socket.pipe(upstream);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
  });

  return new Promise((r, reject) => {
    server.once('error', reject);
    server.listen(PARTY_PORT, '0.0.0.0', () => r(server));
  });
}

// ── Główny przebieg ───────────────────────────────────────────────────────────

function needsBuild() {
  if (FORCE_BUILD) return true;
  const marker = join(WEB_DIR, DIST_DIR, 'party-build.json');
  if (!existsSync(join(WEB_DIR, DIST_DIR, 'BUILD_ID')) || !existsSync(marker)) return true;
  try {
    const prev = JSON.parse(readFileSync(marker, 'utf8'));
    return prev.hostEmail !== (process.env.NEXT_PUBLIC_ROOM_HOST_EMAIL || '');
  } catch {
    return true;
  }
}

async function main() {
  if (!existsSync(join(repoRoot, '.env'))) {
    console.error('[party] Brak pliku .env w katalogu głównym — skopiuj .env.example do .env i uzupełnij.');
    process.exit(1);
  }
  const adminEmail = process.env.POCKETBASE_ADMIN_EMAIL;
  const adminPass = process.env.POCKETBASE_ADMIN_PASSWORD;
  if (!adminEmail || !adminPass) {
    console.error('[party] Uzupełnij POCKETBASE_ADMIN_EMAIL i POCKETBASE_ADMIN_PASSWORD w .env (min. 10 znaków hasła).');
    process.exit(1);
  }

  // Adresy względne — przeglądarka zawsze gada z tym samym hostem, z którego wczytała stronę.
  const appEnv = {
    NODE_ENV: 'production',
    NEXT_DIST_DIR: DIST_DIR,
    NEXT_PUBLIC_POCKETBASE_URL: '/pb',
    NEXT_PUBLIC_SOCKET_URL: '/',
    POCKETBASE_URL: `http://127.0.0.1:${PB_PORT}`,
    SERVER_PORT: String(SOCKET_PORT),
  };

  const pbBin = await ensurePocketBase();
  const cfBin = LAN_ONLY ? null : await ensureCloudflared();

  const nextBin = join(WEB_DIR, 'node_modules', 'next', 'dist', 'bin', 'next');
  if (!existsSync(nextBin)) {
    console.error('[party] Brak zależności — uruchom najpierw: pnpm install');
    process.exit(1);
  }

  if (needsBuild()) {
    log('web', 'buduję frontend (pierwszy raz trwa ~1 min)…');
    await runToEnd('web', process.execPath, [nextBin, 'build'], { cwd: WEB_DIR, env: appEnv });
    writeFileSync(
      join(WEB_DIR, DIST_DIR, 'party-build.json'),
      JSON.stringify({ hostEmail: process.env.NEXT_PUBLIC_ROOM_HOST_EMAIL || '', at: new Date().toISOString() })
    );
  }

  const pbArgs = ['--dir', PB_DATA, '--migrationsDir', PB_MIGRATIONS, '--automigrate=false'];
  await runToEnd('pb', pbBin, ['superuser', 'upsert', adminEmail, adminPass, ...pbArgs]);

  run('pb', pbBin, ['serve', `--http=127.0.0.1:${PB_PORT}`, ...pbArgs], {
    onLine: (l) => !/Server started|REST API|Dashboard|├|└/.test(l) && undefined,
  });
  run('gra', process.execPath, ['index.js'], { cwd: SERVER_DIR, env: appEnv });
  run('web', process.execPath, [nextBin, 'start', '-H', '127.0.0.1', '-p', String(WEB_PORT)], {
    cwd: WEB_DIR,
    env: appEnv,
  });

  await startProxy();
  await Promise.all([
    waitForHttp(PB_PORT, '/api/health', 'PocketBase'),
    waitForHttp(SOCKET_PORT, '/health', 'Serwer gry'),
    waitForHttp(WEB_PORT, '/', 'Next.js'),
  ]);

  const lanIp = detectLanIPv4();
  const lanUrl = lanIp ? `http://${lanIp}:${PARTY_PORT}` : null;

  if (LAN_ONLY) {
    announce(lanUrl || `http://localhost:${PARTY_PORT}`, null);
    return;
  }

  log('tunel', 'uruchamiam tunel Cloudflare…');
  let announced = false;
  run('tunel', cfBin, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${PARTY_PORT}`], {
    onLine: (line) => {
      const m = line.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (m && !announced) {
        announced = true;
        log('tunel', `adres przydzielony: ${m[0]} — czekam, aż zacznie działać w DNS…`);
        waitForPublicDns(new URL(m[0]).hostname).then(() => announce(m[0], lanUrl));
        return false;
      }
      return /ERR|error|failed/i.test(line) && !/Cannot determine default configuration/.test(line)
        ? undefined
        : false;
    },
  });
}

/**
 * Nowa subdomena trycloudflare.com pojawia się w DNS po kilku–kilkunastu sekundach.
 * Sprawdzamy przez DNS-over-HTTPS (a nie systemowy resolver), żeby Windows nie
 * zapamiętał „brak domeny” na kilka minut, gdy zapytamy za wcześnie.
 */
async function waitForPublicDns(hostname, timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`https://cloudflare-dns.com/dns-query?name=${hostname}&type=A`, {
        headers: { accept: 'application/dns-json' },
      });
      const data = await res.json();
      if (data.Status === 0 && data.Answer?.length) {
        await new Promise((r) => setTimeout(r, 2000));
        return;
      }
    } catch {
      // brak internetu / chwilowy błąd — próbujemy dalej
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  log('tunel', 'DNS nadal nie widzi adresu — podaję go mimo to, może zadziałać za chwilę.');
}

function announce(url, lanUrl) {
  const bar = '═'.repeat(60);
  console.log(`\n${bar}`);
  console.log('  🎭  MAFIA — gra działa!');
  console.log(`\n  Adres dla graczy:   ${url}`);
  if (lanUrl) console.log(`  W tej samej Wi‑Fi:  ${lanUrl}  (działa też bez internetu)`);
  console.log(`  Panel PocketBase:   http://localhost:${PARTY_PORT}/pb/_/`);
  console.log('\n  Zeskanuj telefonem:\n');
  qrcode.generate(url, { small: true }, (qr) => {
    console.log(qr.replace(/^/gm, '  '));
    console.log(`  Zatrzymanie: Ctrl+C\n${bar}\n`);
  });
}

main().catch((err) => {
  console.error(`[party] ${err.message}`);
  shutdown(1);
});
