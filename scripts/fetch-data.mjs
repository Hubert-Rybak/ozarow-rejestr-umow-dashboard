import { mkdir, writeFile } from 'node:fs/promises';
import {
  collectPaginated,
  fetchJsonWithRetry,
  mapSequentiallyWithDelay,
  validatePageSize,
} from './cru-client.mjs';

const API_BASE = 'https://rejestrumow.gov.pl';
const SEARCH_API = `${API_BASE}/api-dp/v1/agreements/search`;
const DETAIL_API = `${API_BASE}/api-dp/v1/agreement`;
const DEFAULT_FILTER = { jsfp: { gmina: 'Ożarów Mazowiecki' } };
const filter = process.env.CRU_FILTER_JSON ? JSON.parse(process.env.CRU_FILTER_JSON) : DEFAULT_FILTER;
const limit = validatePageSize(Number(process.env.CRU_PAGE_SIZE ?? 50));
const detailDelayMs = Number(process.env.CRU_DETAIL_DELAY_MS ?? 500);
const retryOptions = {
  maxAttempts: Number(process.env.CRU_RETRY_ATTEMPTS ?? 7),
  baseDelayMs: Number(process.env.CRU_RETRY_BASE_DELAY_MS ?? 2_000),
  maxDelayMs: Number(process.env.CRU_RETRY_MAX_DELAY_MS ?? 60_000),
  timeoutMs: Number(process.env.CRU_REQUEST_TIMEOUT_MS ?? 30_000),
};

const baseHeaders = {
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (compatible; ozarow-dashboard/1.0)',
  referer: 'https://rejestrumow.gov.pl/',
};

async function fetchPage(offset) {
  const url = `${SEARCH_API}?offset=${offset}&limit=${limit}`;
  return fetchJsonWithRetry('CRU search', url, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'content-type': 'application/json',
    },
    body: JSON.stringify(filter),
  }, retryOptions);
}

async function fetchAgreementDetail(idUmowy) {
  return fetchJsonWithRetry(
    `CRU detail ${idUmowy}`,
    `${DETAIL_API}/${encodeURIComponent(idUmowy)}`,
    { headers: baseHeaders },
    retryOptions,
  );
}

function extractContractors(detail) {
  const parties = detail.stronyUmowy ?? [];
  const nonJsfp = parties.filter((party) => party.rodzaj?.toUpperCase() !== 'JSFP');
  return nonJsfp.length > 0 ? nonJsfp : parties;
}

function extractProcurers(detail) {
  return (detail.stronyUmowy ?? []).filter((party) => party.rodzaj?.toUpperCase() === 'JSFP');
}

function normalizeAgreement(summary, detail) {
  return {
    ...summary,
    przedmiotUmowy: detail.szczegolyUmowy?.przedmiotUmowy ?? summary.przedmiotUmowy,
    wartoscPrzedmiotuUmowy: detail.szczegolyUmowy?.wartoscPrzedmiotu ?? summary.wartoscPrzedmiotuUmowy,
    statusUmowy: detail.podstawoweDane?.statusUmowy ?? summary.statusUmowy,
    dataZawarciaUmowy: detail.podstawoweDane?.dataZawarciaUmowy ?? summary.dataZawarciaUmowy,
    dataZakonczeniaUmowy: detail.podstawoweDane?.dataZakonczeniaUmowy ?? summary.dataZakonczeniaUmowy,
    sourceUrl: `${API_BASE}/umowa/${encodeURIComponent(summary.idUmowy)}`,
    contractors: extractContractors(detail),
    procurers: extractProcurers(detail),
    details: {
      numerUmowy: detail.podstawoweDane?.numerUmowy ?? null,
      okres: detail.okresObowiazywania?.okres ?? null,
      dataPublikacji: detail.dataPublikacji ?? null,
      dataModyfikacji: detail.dataModyfikacji ?? null,
      finansowanaZeSrodkow: detail.finansowanaZeSrodkow ?? null,
    },
  };
}

async function main() {
  const {
    items: summaries,
    totalElements,
    totalMatchingElements,
  } = await collectPaginated(fetchPage);

  const all = await mapSequentiallyWithDelay(summaries, async (summary) => {
    const detail = await fetchAgreementDetail(summary.idUmowy);
    return normalizeAgreement(summary, detail);
  }, { delayMs: detailDelayMs });

  all.sort((a, b) => String(b.dataZawarciaUmowy ?? '').localeCompare(String(a.dataZawarciaUmowy ?? '')));
  const payload = {
    fetchedAt: new Date().toISOString(),
    source: SEARCH_API,
    detailSource: DETAIL_API,
    filter,
    totalElements,
    totalMatchingElements,
    totalVisibleElements: totalMatchingElements,
    agreements: all,
  };
  await mkdir('public/data', { recursive: true });
  await writeFile('public/data/agreements.json', `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Fetched ${all.length}/${totalMatchingElements} agreements with details`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
