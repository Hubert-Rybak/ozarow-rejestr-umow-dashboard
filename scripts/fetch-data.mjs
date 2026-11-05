import { mkdir, readFile, writeFile } from 'node:fs/promises';
import {
  SUMMARY_FIELDS,
  collectPaginated,
  fetchJsonWithRetry,
  mapWithinBudget,
  planDetailFetches,
  validatePageSize,
} from './cru-client.mjs';

const API_BASE = 'https://rejestrumow.gov.pl';
const SEARCH_API = `${API_BASE}/api-dp/v1/agreements/search`;
const DETAIL_API = `${API_BASE}/api-dp/v1/agreement`;
const DEFAULT_FILTER = { jsfp: { gmina: 'Ożarów Mazowiecki' } };
const filter = process.env.CRU_FILTER_JSON ? JSON.parse(process.env.CRU_FILTER_JSON) : DEFAULT_FILTER;
const limit = validatePageSize(Number(process.env.CRU_PAGE_SIZE ?? 50));
const detailDelayMs = Number(process.env.CRU_DETAIL_DELAY_MS ?? 500);
const detailBudgetMs = Number(process.env.CRU_DETAIL_BUDGET_MS ?? 12 * 60_000);
const detailMaxAgeMs = Number(process.env.CRU_DETAIL_MAX_AGE_DAYS ?? 14) * 86_400_000;
const OUTPUT_PATH = 'public/data/agreements.json';
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
    detailsFetchedAt: new Date().toISOString(),
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

/** Agreement whose detail could not be downloaded in this run. */
function pendingAgreement(summary, previous) {
  if (!previous) {
    return {
      ...summary,
      sourceUrl: `${API_BASE}/umowa/${encodeURIComponent(summary.idUmowy)}`,
      detailsFetchedAt: null,
      detailsPending: true,
      contractors: [],
      procurers: [],
      details: null,
    };
  }
  const summaryFields = Object.fromEntries(SUMMARY_FIELDS.map((field) => [field, summary[field] ?? null]));
  return { ...previous, ...summaryFields, detailsPending: true };
}

async function loadPrevious() {
  try {
    const payload = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
    return {
      agreements: Array.isArray(payload?.agreements) ? payload.agreements : [],
      fetchedAt: typeof payload?.fetchedAt === 'string' ? payload.fetchedAt : null,
    };
  } catch (error) {
    if (error?.code !== 'ENOENT') console.warn(`Cannot reuse ${OUTPUT_PATH}: ${error.message}`);
    return { agreements: [], fetchedAt: null };
  }
}

function annotate(level, message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::${level}::${message}`);
  else console.warn(message);
}

async function main() {
  if (!Number.isInteger(detailBudgetMs) || detailBudgetMs < 0) {
    throw new TypeError('CRU_DETAIL_BUDGET_MS must be a non-negative integer');
  }
  if (!Number.isInteger(detailMaxAgeMs) || detailMaxAgeMs < 0) {
    throw new TypeError('CRU_DETAIL_MAX_AGE_DAYS must be a non-negative integer');
  }

  const previous = await loadPrevious();
  const {
    items: summaries,
    totalElements,
    totalMatchingElements,
  } = await collectPaginated(fetchPage);

  const { reuse, queue } = planDetailFetches(summaries, previous.agreements, {
    maxAgeMs: detailMaxAgeMs,
    fallbackFetchedAt: previous.fetchedAt,
  });
  const reasons = Object.groupBy(queue, (entry) => entry.reason);
  console.log(`Search: ${summaries.length} agreements; details reused: ${reuse.size}, to fetch: `
    + Object.entries(reasons).map(([reason, entries]) => `${reason} ${entries.length}`).join(', '));

  const { results, failed, remaining, stopReason } = await mapWithinBudget(queue, async (entry) => {
    const detail = await fetchAgreementDetail(entry.summary.idUmowy);
    return normalizeAgreement(entry.summary, detail);
  }, { delayMs: detailDelayMs, budgetMs: detailBudgetMs });

  const fetchedById = new Map();
  for (const [index, record] of results) fetchedById.set(queue[index].summary.idUmowy, record);
  const notFetched = new Map();
  for (const index of [...failed, ...remaining]) notFetched.set(queue[index].summary.idUmowy, queue[index]);

  const all = summaries.map((summary) => {
    const fetched = fetchedById.get(summary.idUmowy);
    if (fetched) return fetched;
    const reused = reuse.get(summary.idUmowy);
    if (reused) return { ...reused, detailsFetchedAt: reused.detailsFetchedAt ?? previous.fetchedAt };
    const entry = notFetched.get(summary.idUmowy);
    // A stale detail that did not fit is still valid data; keep it untouched.
    if (entry.reason === 'stale') {
      return { ...entry.previous, detailsFetchedAt: entry.previous.detailsFetchedAt ?? previous.fetchedAt };
    }
    return pendingAgreement(summary, entry.previous);
  });

  if (all.length !== totalMatchingElements) {
    throw new Error(`Refusing to publish ${all.length} of ${totalMatchingElements} agreements`);
  }

  all.sort((a, b) => String(b.dataZawarciaUmowy ?? '').localeCompare(String(a.dataZawarciaUmowy ?? '')));
  const detailsPending = all.filter((agreement) => agreement.detailsPending).length;
  const payload = {
    fetchedAt: new Date().toISOString(),
    source: SEARCH_API,
    detailSource: DETAIL_API,
    filter,
    totalElements,
    totalMatchingElements,
    totalVisibleElements: totalMatchingElements,
    detailsPending,
    agreements: all,
  };
  await mkdir('public/data', { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`Saved ${all.length}/${totalMatchingElements} agreements; details fetched ${results.size}, `
    + `failed ${failed.length}, deferred ${remaining.length}`);
  if (detailsPending > 0) {
    const why = stopReason === 'budget' ? 'time budget exhausted' : stopReason === 'failures' ? 'CRU kept failing' : 'requests failed';
    annotate('warning', `${detailsPending} agreements published with pending details (${why}); they will be retried on the next run`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
