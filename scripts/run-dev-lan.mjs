#!/usr/bin/env node
/**
 * Uruchamia web + server (+ opcjonalnie PocketBase) z CORS i NEXT_PUBLIC_*
 * ustawionymi na bieżące IP LAN.
 *
 * Konfiguracja PocketBase (opcjonalna):
 *   POCKETBASE_BIN=/absolutna/sciezka/do/pocketbase   ← ustaw w .env w katalogu głównym
 * Jeśli POCKETBASE_BIN jest ustawione, skrypt sam uruchomi PB na 0.0.0.0:8090.
 * Jeśli nie — przypomni, żebyś uruchomił PB ręcznie.
 *
 * Zmienne z procesu nadpisują wartości z plików .env (Next i dotenv tak działają).
 */
import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { homedir } from 'os';
import { config as loadEnv } from 'dotenv';
import { detectLanIPv4 } from './detect-lan-ip.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Wczytaj root .env, żeby mieć POCKETBASE_BIN i ALLOWED_ROOM_CREATOR_EMAIL itp.
loadEnv({ path: join(repoRoot, '.env') });

const ip = detectLanIPv4();
if (!ip) {
  console.error('[dev:lan] Nie znaleziono adresu IPv4 (Wi‑Fi / Ethernet).');
  process.exit(1);
}

const cors = `http://localhost:3000,http://${ip}:3000`;
const childEnv = {
  ...process.env,
  CORS_ORIGIN: cors,
  // PB dla serwera Node: zawsze localhost (oba procesy na tym samym Macu).
  POCKETBASE_URL: 'http://127.0.0.1:8090',
  // PB i Socket dla przeglądarki: aktualne IP LAN.
  NEXT_PUBLIC_SOCKET_URL: `http://${ip}:3002`,
  NEXT_PUBLIC_POCKETBASE_URL: `http://${ip}:8090`,
};

console.log(`[dev:lan] Wykryte IP LAN: ${ip}`);
console.log(`[dev:lan] Otwórz w przeglądarce / na telefonie:`);
console.log(`[dev:lan]   • Aplikacja:        http://${ip}:3000`);
console.log(`[dev:lan]   • Panel PocketBase: http://${ip}:8090/_/`);
console.log(`[dev:lan] Socket.io (przeglądarka): ${childEnv.NEXT_PUBLIC_SOCKET_URL}`);
console.log(`[dev:lan] PocketBase (serwer Node): ${childEnv.POCKETBASE_URL}`);
console.log(`[dev:lan] CORS (serwer gry): ${cors}`);

// --- Auto-spawn PocketBase --------------------------------------------------
function resolvePocketBaseBin() {
  const fromEnv = process.env.POCKETBASE_BIN;
  if (fromEnv) {
    let abs;
    if (fromEnv.startsWith('~')) {
      abs = join(homedir(), fromEnv.slice(1));
    } else if (fromEnv.startsWith('.')) {
      // Ścieżka relatywna do katalogu głównego repo.
      abs = join(repoRoot, fromEnv);
    } else {
      abs = resolve(fromEnv);
    }
    return existsSync(abs) ? abs : null;
  }
  // Heurystyka — najpierw szukamy w repozytorium (zalecana lokalizacja).
  const guesses = [
    join(repoRoot, 'pb', 'pocketbase'),
    join(repoRoot, 'pocketbase'),
    join(homedir(), 'Downloads', 'pocketbase_0.36.8_darwin_amd64', 'pocketbase'),
    join(homedir(), 'Downloads', 'pocketbase'),
  ];
  for (const g of guesses) {
    if (existsSync(g)) return g;
  }
  return null;
}

const children = [];

function spawnChild(name, cmd, args, opts = {}) {
  const child = spawn(cmd, args, {
    cwd: repoRoot,
    env: childEnv,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...opts,
  });
  children.push({ name, child });
  child.on('exit', (code) => {
    console.log(`[dev:lan] ${name} zakończony (kod ${code ?? 0}).`);
  });
  return child;
}

const pbBin = resolvePocketBaseBin();
if (pbBin) {
  console.log(`[dev:lan] Uruchamiam PocketBase: ${pbBin}`);
  spawnChild('pocketbase', pbBin, ['serve', '--http=0.0.0.0:8090'], {
    cwd: dirname(pbBin),
  });
} else {
  console.log('[dev:lan] ⚠️  Nie znaleziono binarki PocketBase.');
  console.log('[dev:lan]    Ustaw POCKETBASE_BIN w pliku .env w katalogu głównym, np.:');
  console.log('[dev:lan]    POCKETBASE_BIN=~/Dow/pocketbase_0.36.8_darwin_amd64/pocketbase');
  console.log('[dev:lan]    Albo uruchom PB ręcznie w innym terminalu:');
  console.log('[dev:lan]      ./pocketbase serve --http=0.0.0.0:8090');
}

console.log(`[dev:lan] (W panelu PB /_/ → Settings → Application dodaj origin: http://${ip}:3000)\n`);

// --- Web + Server -----------------------------------------------------------
spawnChild(
  'web+server',
  'pnpm',
  [
    'exec',
    'concurrently',
    '-n', 'web,server',
    '-c', 'cyan,magenta',
    'pnpm --filter mafia-web dev:lan',
    'pnpm --filter mafia-server dev',
  ],
);

// --- Czysta śmierć dzieci przy Ctrl+C ---------------------------------------
function shutdown() {
  for (const { child } of children) {
    if (!child.killed) child.kill('SIGINT');
  }
  setTimeout(() => process.exit(0), 500).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
