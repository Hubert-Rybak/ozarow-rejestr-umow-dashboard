import { mkdir, writeFile } from 'node:fs/promises';

const API = 'https://rejestrumow.gov.pl/api-dp/v1/agreements/search';
const DEFAULT_FILTER = { jsfp: { gmina: 'Ożarów Mazowiecki' } };
const filter = process.env.CRU_FILTER_JSON ? JSON.parse(process.env.CRU_FILTER_JSON) : DEFAULT_FILTER;
const limit = Number(process.env.CRU_PAGE_SIZE ?? 100);

async function fetchPage(offset) {
  const url = `${API}?offset=${offset}&limit=${limit}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': 'Mozilla/5.0 (compatible; ozarow-dashboard/1.0)',
      referer: 'https://rejestrumow.gov.pl/',
    },
    body: JSON.stringify(filter),
  });
  if (!response.ok) throw new Error(`CRU HTTP ${response.status}: ${await response.text()}`);
  return response.json();
}

async function main() {
  const all = [];
  let offset = 0;
  let totalElements = 0;
  let totalVisibleElements = 0;
  for (;;) {
    const page = await fetchPage(offset);
    totalElements = page.totalElements ?? totalElements;
    totalVisibleElements = page.totalVisibleElements ?? totalVisibleElements;
    all.push(...(page.content ?? []));
    offset += limit;
    if (all.length >= totalVisibleElements || (page.content ?? []).length === 0) break;
  }
  all.sort((a, b) => String(b.dataZawarciaUmowy ?? '').localeCompare(String(a.dataZawarciaUmowy ?? '')));
  const payload = {
    fetchedAt: new Date().toISOString(),
    source: API,
    filter,
    totalElements,
    totalVisibleElements,
    agreements: all,
  };
  await mkdir('public/data', { recursive: true });
  await writeFile('public/data/agreements.json', `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Fetched ${all.length}/${totalVisibleElements} agreements`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
