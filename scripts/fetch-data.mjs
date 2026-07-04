import { mkdir, writeFile } from 'node:fs/promises';

const API_BASE = 'https://rejestrumow.gov.pl';
const SEARCH_API = `${API_BASE}/api-dp/v1/agreements/search`;
const DETAIL_API = `${API_BASE}/api-dp/v1/agreement`;
const DEFAULT_FILTER = { jsfp: { gmina: 'Ożarów Mazowiecki' } };
const filter = process.env.CRU_FILTER_JSON ? JSON.parse(process.env.CRU_FILTER_JSON) : DEFAULT_FILTER;
const limit = Number(process.env.CRU_PAGE_SIZE ?? 100);

const baseHeaders = {
  accept: 'application/json',
  'user-agent': 'Mozilla/5.0 (compatible; ozarow-dashboard/1.0)',
  referer: 'https://rejestrumow.gov.pl/',
};

async function fetchPage(offset) {
  const url = `${SEARCH_API}?offset=${offset}&limit=${limit}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...baseHeaders,
      'content-type': 'application/json',
    },
    body: JSON.stringify(filter),
  });
  if (!response.ok) throw new Error(`CRU search HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function fetchAgreementDetail(idUmowy) {
  const response = await fetch(`${DETAIL_API}/${encodeURIComponent(idUmowy)}`, { headers: baseHeaders });
  if (!response.ok) throw new Error(`CRU detail ${idUmowy} HTTP ${response.status}: ${await response.text()}`);
  return response.json();
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
  const summaries = [];
  let offset = 0;
  let totalElements = 0;
  let totalVisibleElements = 0;
  for (;;) {
    const page = await fetchPage(offset);
    totalElements = page.totalElements ?? totalElements;
    totalVisibleElements = page.totalVisibleElements ?? totalVisibleElements;
    summaries.push(...(page.content ?? []));
    offset += limit;
    if (summaries.length >= totalVisibleElements || (page.content ?? []).length === 0) break;
  }

  const all = [];
  for (const summary of summaries) {
    const detail = await fetchAgreementDetail(summary.idUmowy);
    all.push(normalizeAgreement(summary, detail));
  }

  all.sort((a, b) => String(b.dataZawarciaUmowy ?? '').localeCompare(String(a.dataZawarciaUmowy ?? '')));
  const payload = {
    fetchedAt: new Date().toISOString(),
    source: SEARCH_API,
    detailSource: DETAIL_API,
    filter,
    totalElements,
    totalVisibleElements,
    agreements: all,
  };
  await mkdir('public/data', { recursive: true });
  await writeFile('public/data/agreements.json', `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Fetched ${all.length}/${totalVisibleElements} agreements with details`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
