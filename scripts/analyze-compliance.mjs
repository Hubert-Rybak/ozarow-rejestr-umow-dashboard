#!/usr/bin/env node
/**
 * Uruchamiany automatycznie po `npm run fetch` (patrz alias w package.json).
 * Wczytuje świeżo pobrany public/data/agreements.json, przepuszcza go przez
 * reguły zgodności z src/compliance.ts i zapisuje wynik jako statyczny
 * public/data/compliance.json — dzięki temu analiza jest wykonywana raz
 * dziennie podczas synchronizacji, a nie przy każdym otwarciu dashboardu.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { buildCompliancePayload } from '../src/compliance.ts';

const DATA_PATH = 'public/data/agreements.json';
const KRS_PATH = 'public/data/krs-links.json';
const OUTPUT_PATH = 'public/data/compliance.json';

async function main() {
  const raw = await readFile(DATA_PATH, 'utf8');
  const payload = JSON.parse(raw);
  const agreements = Array.isArray(payload?.agreements) ? payload.agreements : [];

  if (agreements.length === 0) {
    throw new Error(`${DATA_PATH} nie zawiera żadnych umów — pomijam analizę zgodności.`);
  }

  // Mapa NIP -> dane KRS (produkuje scripts/krs-enrich.mjs); opcjonalna.
  let krsLinks;
  try {
    const krs = JSON.parse(await readFile(KRS_PATH, 'utf8'));
    krsLinks = new Map((krs.links ?? []).map((l) => [l.nip, l]));
  } catch {
    console.warn(`Brak ${KRS_PATH} — pomijam regułę powiązań przez KRS (uruchom: node scripts/krs-enrich.mjs).`);
  }

  const report = buildCompliancePayload(agreements, new Date(), krsLinks);
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report)}\n`);

  console.log(`Compliance analysis: ${report.summary.flagged}/${report.summary.total} flagged, `
    + `${report.summary.errors} errors -> ${OUTPUT_PATH}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
