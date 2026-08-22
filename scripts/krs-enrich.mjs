#!/usr/bin/env node
/**
 * Wzbogaca dane o powiązania KRS: dla każdego NIP-u wykonawcy pobiera
 * numer KRS z Białej Listy VAT (MF), a dla spółek z KRS — skład organów
 * i wspólników z publicznego API KRS (Ministerstwo Sprawiedliwości).
 *
 * Osoby w odpisach są zanonimizowane (pierwsza litera + gwiazdki), ale
 * gwiazdki zachowują długość nazwiska/imienia — wystarcza to do bardzo
 * selektywnego dopasowania z listą urzędników (patrz src/compliance.ts).
 *
 * Wynik: public/data/krs-links.json (cache odświeżany co najmniej co 30 dni).
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const DATA = path.join(ROOT, 'public', 'data');
const CACHE_FILE = path.join(DATA, 'krs-cache.json');
const OUT_FILE = path.join(DATA, 'krs-links.json');
const CACHE_TTL_DAYS = 30;
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36';

const today = new Date().toISOString().slice(0, 10);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(25000) });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      await sleep(1500 * (i + 1));
    }
  }
  return null;
}

function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}

/** Osoby (reprezentacja + wspólnicy) z anonimizowanego odpisu KRS. */
export function extractPersons(odpis) {
  const out = [];
  const dane = odpis?.dane ?? {};
  const push = (p, rola) => {
    if (!p || typeof p !== 'object') return;
    const last = p?.nazwisko?.nazwiskoICzlon ?? null;
    const first = p?.imiona?.imie ?? null;
    if (!last || !first || typeof last !== 'string') return;
    out.push({ lastMasked: last, firstMasked: String(first), funkcja: p?.funkcjaWOrganie ?? rola });
  };
  const rep = dane?.dzial2?.reprezentacja;
  if (Array.isArray(rep)) {
    for (const organ of rep) (organ?.sklad ?? []).forEach((p) => push(p, 'członek organu'));
  } else if (rep && typeof rep === 'object') {
    (rep.sklad ?? []).forEach((p) => push(p, 'członek organu'));
  }
  const wsp = dane?.dzial1?.wspolnicySpzoo;
  if (Array.isArray(wsp)) wsp.forEach((p) => push(p, 'wspólnik'));
  return out;
}

async function main() {
  const agreements = JSON.parse(readFileSync(path.join(DATA, 'agreements.json'), 'utf8')).agreements;
  const nips = new Set();
  for (const a of agreements) {
    for (const c of a.contractors ?? []) {
      if (c.nip && /^\d{10}$/.test(c.nip)) nips.add(c.nip);
    }
  }
  const cache = loadCache();
  let fetchedBl = 0, fetchedKrs = 0;

  for (const nip of [...nips].sort()) {
    const cached = cache[nip];
    const fresh = cached && cached.checkedAt && Date.now() - new Date(cached.checkedAt).getTime() < CACHE_TTL_DAYS * 864e5;
    if (!fresh) {
      const bl = await getJson(`https://wl-api.mf.gov.pl/api/search/nip/${nip}?date=${today}`);
      const subject = bl?.result?.subject ?? null;
      cache[nip] = {
        checkedAt: new Date().toISOString(),
        name: subject?.name ?? null,
        krs: subject?.krs ?? null,
        statusVat: subject?.statusVat ?? null,
      };
      fetchedBl++;
      await sleep(350);
    }
    const entry = cache[nip];
    if (entry.krs && !entry.personsCheckedAt) {
      const odpis = await getJson(`https://api-krs.ms.gov.pl/api/krs/OdpisAktualny/${entry.krs}?rejestr=P&format=json`);
      entry.persons = odpis ? extractPersons(odpis.odpis) : null;
      entry.personsCheckedAt = new Date().toISOString();
      fetchedKrs++;
      await sleep(350);
    }
  }

  writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  const links = Object.entries(cache)
    .filter(([, v]) => v.krs && Array.isArray(v.persons))
    .map(([nip, v]) => ({ nip, krs: v.krs, name: v.name, persons: v.persons }));
  writeFileSync(OUT_FILE, JSON.stringify({ checkedAt: new Date().toISOString(), links }, null, 2));
  console.log(`KRS enrichment: ${nips.size} NIP-ów (BL: ${fetchedBl}, KRS: ${fetchedKrs}), spółek z osobami: ${links.length} -> public/data/krs-links.json`);
}

if (process.argv[1] && process.argv[1].endsWith('krs-enrich.mjs')) main();

