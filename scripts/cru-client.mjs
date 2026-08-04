const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_PAGE_SIZE = 50;
const MAX_RETRY_ATTEMPTS = 10;
const MAX_ERROR_BODY_BYTES = 4_096;

const defaultSleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function retryAfterMilliseconds(value, now) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);

  const date = Date.parse(value);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - now());
}

function backoffMilliseconds(attempt, response, { baseDelayMs, maxDelayMs, random, now }) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
  const withJitter = Math.min(maxDelayMs, exponential + Math.floor(exponential * 0.2 * random()));
  const retryAfter = retryAfterMilliseconds(response?.headers?.get('retry-after'), now);
  return Math.min(maxDelayMs, Math.max(withJitter, retryAfter ?? 0));
}

function assertTimerDelay(name, value) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_TIMER_DELAY_MS) {
    throw new TypeError(`${name} must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`);
  }
}

export function validatePageSize(value) {
  if (!Number.isInteger(value) || value < 1 || value > MAX_PAGE_SIZE) {
    throw new TypeError(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  return value;
}

function errorBody(body) {
  const compact = body.trim();
  return compact.length > 1_000 ? `${compact.slice(0, 1_000)}…` : compact;
}

async function readErrorBody(response) {
  const reader = response.body?.getReader?.();
  if (!reader) return errorBody(await response.text());

  const chunks = [];
  let bytesRead = 0;
  let shouldCancel = false;
  try {
    while (bytesRead < MAX_ERROR_BODY_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);
      const remaining = MAX_ERROR_BODY_BYTES - bytesRead;
      const accepted = chunk.subarray(0, remaining);
      chunks.push(accepted);
      bytesRead += accepted.byteLength;
      if (accepted.byteLength < chunk.byteLength || bytesRead >= MAX_ERROR_BODY_BYTES) {
        shouldCancel = true;
        break;
      }
    }
  } finally {
    if (shouldCancel && typeof reader.cancel === 'function') {
      try {
        await reader.cancel();
      } catch {
        // The useful prefix is already buffered; cancellation is best-effort.
      }
    }
  }

  const bytes = new Uint8Array(bytesRead);
  let position = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, position);
    position += chunk.byteLength;
  }
  return errorBody(new TextDecoder().decode(bytes));
}

/**
 * Fetch JSON with bounded retries for rate limits, transient server errors, and
 * network failures. Non-transient 4xx responses fail immediately.
 */
export async function fetchJsonWithRetry(label, url, init = {}, options = {}) {
  const {
    fetchImpl = globalThis.fetch,
    sleep = defaultSleep,
    logger = console,
    maxAttempts = 7,
    baseDelayMs = 2_000,
    maxDelayMs = 60_000,
    timeoutMs = 30_000,
    random = Math.random,
    now = Date.now,
  } = options;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > MAX_RETRY_ATTEMPTS) {
    throw new TypeError(`maxAttempts must be an integer between 1 and ${MAX_RETRY_ATTEMPTS}`);
  }
  assertTimerDelay('baseDelayMs', baseDelayMs);
  assertTimerDelay('maxDelayMs', maxDelayMs);
  assertTimerDelay('timeoutMs', timeoutMs);

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response;
    try {
      const signal = init.signal ?? (timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined);
      response = await fetchImpl(url, { ...init, signal });
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      if (attempt === maxAttempts) {
        throw new Error(`${label} network failure after ${maxAttempts} attempts: ${reason}`, { cause });
      }

      const waitMs = backoffMilliseconds(attempt, null, {
        baseDelayMs,
        maxDelayMs,
        random,
        now,
      });
      logger.warn(`${label} network failure on attempt ${attempt}/${maxAttempts}: ${reason}; retrying in ${waitMs} ms`);
      await sleep(waitMs);
      continue;
    }

    if (response.ok) {
      try {
        return await response.json();
      } catch (cause) {
        const reason = cause instanceof Error ? cause.message : String(cause);
        if (attempt === maxAttempts) {
          throw new Error(`${label} response body failure after ${maxAttempts} attempts: ${reason}`, { cause });
        }

        const waitMs = backoffMilliseconds(attempt, null, {
          baseDelayMs,
          maxDelayMs,
          random,
          now,
        });
        logger.warn(`${label} response body failure on attempt ${attempt}/${maxAttempts}: ${reason}; retrying in ${waitMs} ms`);
        await sleep(waitMs);
        continue;
      }
    }

    const isRetryable = RETRYABLE_HTTP_STATUSES.has(response.status);
    let body;
    try {
      body = await readErrorBody(response);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      if (!isRetryable) {
        throw new Error(`${label} HTTP ${response.status} response body failure: ${reason}`, { cause });
      }
      if (attempt === maxAttempts) {
        throw new Error(`${label} HTTP ${response.status} response body failure after ${maxAttempts} attempts: ${reason}`, { cause });
      }

      const waitMs = backoffMilliseconds(attempt, response, {
        baseDelayMs,
        maxDelayMs,
        random,
        now,
      });
      logger.warn(`${label} HTTP ${response.status} response body failure on attempt ${attempt}/${maxAttempts}: ${reason}; retrying in ${waitMs} ms`);
      await sleep(waitMs);
      continue;
    }

    const message = `${label} HTTP ${response.status}${body ? `: ${body}` : ''}`;
    if (!isRetryable) throw new Error(message);
    if (attempt === maxAttempts) {
      throw new Error(`${label} HTTP ${response.status} after ${maxAttempts} attempts${body ? `: ${body}` : ''}`);
    }

    const waitMs = backoffMilliseconds(attempt, response, {
      baseDelayMs,
      maxDelayMs,
      random,
      now,
    });
    logger.warn(`${label} HTTP ${response.status} on attempt ${attempt}/${maxAttempts}; retrying in ${waitMs} ms`);
    await sleep(waitMs);
  }

  throw new Error(`${label} failed without an HTTP response`);
}

/**
 * Collect every search page without assuming the server honored the requested
 * page size. The CRU API currently caps responses at 50 rows and reports the
 * filtered count as totalMatchingElements.
 */
export async function collectPaginated(fetchPage) {
  const items = [];
  const seenIds = new Set();
  let offset = 0;
  let declaredTotalElements;
  let declaredMatchingTotal;

  for (;;) {
    const page = await fetchPage(offset);
    if (!Array.isArray(page?.content)) {
      throw new Error('CRU search response content must be an array');
    }
    if (!Number.isInteger(page.offset) || page.offset < 0) {
      throw new Error('CRU pagination response offset must be a non-negative integer');
    }
    if (page.offset !== offset) {
      throw new Error(`CRU pagination returned offset ${page.offset} for requested offset ${offset}`);
    }
    if (!Number.isInteger(page.limit) || page.limit < 1 || page.limit > MAX_PAGE_SIZE) {
      throw new Error(`CRU pagination response limit must be an integer between 1 and ${MAX_PAGE_SIZE}`);
    }
    if (page.content.length > page.limit) {
      throw new Error(`CRU pagination returned ${page.content.length} records with limit ${page.limit}`);
    }

    if (page.totalElements !== undefined) {
      if (!Number.isInteger(page.totalElements) || page.totalElements < 0) {
        throw new Error('CRU pagination totalElements must be a non-negative integer');
      }
      if (declaredTotalElements === undefined) {
        declaredTotalElements = page.totalElements;
      } else if (page.totalElements !== declaredTotalElements) {
        throw new Error(`CRU pagination totalElements changed from ${declaredTotalElements} to ${page.totalElements}`);
      }
    }

    const matchingCount = page.totalMatchingElements
      ?? page.totalVisibleElements
      ?? page.totalElements;
    if (!Number.isInteger(matchingCount) || matchingCount < 0) {
      throw new Error('CRU pagination matching total must be a non-negative integer');
    }
    if (declaredMatchingTotal === undefined) {
      declaredMatchingTotal = matchingCount;
    } else if (matchingCount !== declaredMatchingTotal) {
      throw new Error(`CRU pagination matching total changed from ${declaredMatchingTotal} to ${matchingCount}`);
    }

    const content = page.content;
    if (content.length === 0) {
      if (items.length !== declaredMatchingTotal) {
        throw new Error(`CRU pagination ended early at ${items.length} of ${declaredMatchingTotal} records`);
      }
      break;
    }

    if (items.length + content.length > declaredMatchingTotal) {
      throw new Error(`CRU pagination collected ${items.length + content.length} records but expected ${declaredMatchingTotal}`);
    }
    for (const item of content) {
      if (typeof item?.idUmowy !== 'string' || item.idUmowy.trim() === '') {
        throw new Error('CRU pagination record is missing idUmowy');
      }
      if (seenIds.has(item.idUmowy)) {
        throw new Error(`CRU pagination returned duplicate idUmowy ${item.idUmowy}`);
      }
      seenIds.add(item.idUmowy);
    }
    items.push(...content);

    if (items.length === declaredMatchingTotal) break;
    offset += content.length;
  }

  return {
    items,
    totalElements: declaredTotalElements ?? declaredMatchingTotal,
    totalMatchingElements: declaredMatchingTotal,
  };
}

/**
 * Map items in order while adding a pause between calls. Keeping requests
 * sequential and paced reduces the chance of triggering the CRU rate limit.
 */
export async function mapSequentiallyWithDelay(items, mapper, options = {}) {
  const {
    delayMs = 0,
    sleep = defaultSleep,
  } = options;
  assertTimerDelay('delayMs', delayMs);
  const results = [];

  for (let index = 0; index < items.length; index += 1) {
    if (index > 0 && delayMs > 0) await sleep(delayMs);
    results.push(await mapper(items[index], index));
  }

  return results;
}
