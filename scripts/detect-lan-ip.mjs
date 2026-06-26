import os from 'os';
import { fileURLToPath } from 'url';

/**
 * Pierwszy sensowny IPv4 z interfejsu sieciowego (nie loopback).
 * Preferuje adresy prywatne (RFC1918 / lokalna sieć).
 */
export function detectLanIPv4() {
  let nets;
  try {
    nets = os.networkInterfaces();
  } catch {
    return null;
  }
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name] || []) {
      const fam = net.family;
      if (fam !== 'IPv4' && fam !== 4) continue;
      if (net.internal) continue;
      candidates.push({ address: net.address, name });
    }
  }
  if (candidates.length === 0) return null;

  const privateRe = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/;
  candidates.sort((a, b) => {
    const da = privateRe.test(a.address) ? 0 : 1;
    const db = privateRe.test(b.address) ? 0 : 1;
    if (da !== db) return da - db;
    return a.name.localeCompare(b.name);
  });
  return candidates[0].address;
}

const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  const ip = detectLanIPv4();
  if (ip) console.log(ip);
  process.exit(ip ? 0 : 1);
}
