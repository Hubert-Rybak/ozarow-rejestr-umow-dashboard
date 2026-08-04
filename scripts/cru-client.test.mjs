import { describe, expect, it, vi } from 'vitest';
import {
  collectPaginated,
  fetchJsonWithRetry,
  mapSequentiallyWithDelay,
  validatePageSize,
} from './cru-client.mjs';

const MAX_TIMER_DELAY_MS = 2_147_483_647;

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('fetchJsonWithRetry', () => {
  it('retries HTTP 429 and honors Retry-After before succeeding', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, {
        status: 429,
        headers: { 'retry-after': '2' },
      }))
      .mockResolvedValueOnce(jsonResponse({ agreements: [1] }));
    const sleep = vi.fn().mockResolvedValue(undefined);
    const logger = { warn: vi.fn() };

    const result = await fetchJsonWithRetry('CRU search', 'https://example.test/search', {}, {
      fetchImpl,
      sleep,
      logger,
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 3_000,
      random: () => 0,
    });

    expect(result).toEqual({ agreements: [1] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledOnce();
    expect(sleep).toHaveBeenCalledWith(2_000);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('HTTP 429'));
  });

  it('caps jitter and excessive Retry-After values at maxDelayMs', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'rate limited' }, {
        status: 429,
        headers: { 'retry-after': '120' },
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await fetchJsonWithRetry('CRU search', 'https://example.test/search', {}, {
      fetchImpl,
      sleep,
      logger: { warn: vi.fn() },
      maxAttempts: 2,
      baseDelayMs: 1_000,
      maxDelayMs: 1_000,
      random: () => 1,
    });

    expect(sleep).toHaveBeenCalledWith(1_000);
  });

  it('honors an HTTP-date Retry-After value within the configured cap', async () => {
    const now = Date.parse('2026-08-04T10:00:00.000Z');
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: 'temporarily unavailable' }, {
        status: 503,
        headers: { 'retry-after': 'Tue, 04 Aug 2026 10:00:05 GMT' },
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await fetchJsonWithRetry('CRU search', 'https://example.test/search', {}, {
      fetchImpl,
      sleep,
      logger: { warn: vi.fn() },
      maxAttempts: 2,
      baseDelayMs: 100,
      maxDelayMs: 10_000,
      random: () => 0,
      now: () => now,
    });

    expect(sleep).toHaveBeenCalledWith(5_000);
  });

  it('retries transient network failures with exponential backoff', async () => {
    const fetchImpl = vi.fn()
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockRejectedValueOnce(new TypeError('socket closed'))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchJsonWithRetry('CRU detail test-id', 'https://example.test/detail', {}, {
      fetchImpl,
      sleep,
      logger: { warn: vi.fn() },
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      random: () => 0,
    })).resolves.toEqual({ ok: true });

    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it('retries when a successful response body is truncated', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: vi.fn().mockRejectedValue(new TypeError('terminated')),
      })
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchJsonWithRetry('CRU detail test-id', 'https://example.test/detail', {}, {
      fetchImpl,
      sleep,
      logger: { warn: vi.fn() },
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      random: () => 0,
    })).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[100]]);
  });

  it('retries when a retryable error response body is truncated', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        headers: new Headers(),
        text: vi.fn().mockRejectedValue(new TypeError('terminated')),
      })
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchJsonWithRetry('CRU detail test-id', 'https://example.test/detail', {}, {
      fetchImpl,
      sleep,
      logger: { warn: vi.fn() },
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      random: () => 0,
    })).resolves.toEqual({ ok: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep.mock.calls).toEqual([[100]]);
  });

  it('bounds and cancels oversized HTTP error bodies', async () => {
    const reader = {
      read: vi.fn().mockResolvedValueOnce({
        done: false,
        value: new TextEncoder().encode('x'.repeat(10_000)),
      }),
      cancel: vi.fn().mockResolvedValue(undefined),
    };
    const text = vi.fn().mockResolvedValue('x'.repeat(10_000));
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: new Headers(),
      body: { getReader: () => reader },
      text,
    });

    await expect(fetchJsonWithRetry('CRU search', 'https://example.test/search', {}, {
      fetchImpl,
      maxAttempts: 1,
    })).rejects.toThrow('CRU search HTTP 400');

    expect(reader.read).toHaveBeenCalledOnce();
    expect(reader.cancel).toHaveBeenCalledOnce();
    expect(text).not.toHaveBeenCalled();
  });

  it('does not retry non-transient HTTP errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ error: 'bad filter' }, { status: 400 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchJsonWithRetry('CRU search', 'https://example.test/search', {}, {
      fetchImpl,
      sleep,
      logger: { warn: vi.fn() },
      maxAttempts: 3,
      random: () => 0,
    })).rejects.toThrow('CRU search HTTP 400');

    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('fails with the last HTTP error after exhausting retry attempts', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse({ error: 'still limited' }, { status: 429 }));
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(fetchJsonWithRetry('CRU detail test-id', 'https://example.test/detail', {}, {
      fetchImpl,
      sleep,
      logger: { warn: vi.fn() },
      maxAttempts: 3,
      baseDelayMs: 100,
      maxDelayMs: 1_000,
      random: () => 0,
    })).rejects.toThrow('CRU detail test-id HTTP 429 after 3 attempts');

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[100], [200]]);
  });

  it.each([
    0,
    -1,
    1.5,
    11,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.MAX_SAFE_INTEGER,
    1e100,
  ])('rejects invalid maxAttempts value %s', async (maxAttempts) => {
    await expect(fetchJsonWithRetry('CRU search', 'https://example.test/search', {}, {
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
      maxAttempts,
    })).rejects.toThrow('maxAttempts must be an integer between 1 and 10');
  });

  it.each([
    ['baseDelayMs', Number.NaN],
    ['baseDelayMs', -1],
    ['baseDelayMs', 1.5],
    ['baseDelayMs', MAX_TIMER_DELAY_MS + 1],
    ['maxDelayMs', Number.POSITIVE_INFINITY],
    ['maxDelayMs', -1],
    ['maxDelayMs', 1.5],
    ['maxDelayMs', MAX_TIMER_DELAY_MS + 1],
    ['timeoutMs', Number.NaN],
    ['timeoutMs', -1],
    ['timeoutMs', 1.5],
    ['timeoutMs', MAX_TIMER_DELAY_MS + 1],
  ])('rejects invalid %s configuration', async (option, value) => {
    await expect(fetchJsonWithRetry('CRU search', 'https://example.test/search', {}, {
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ ok: true })),
      [option]: value,
    })).rejects.toThrow(`${option} must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`);
  });
});

describe('validatePageSize', () => {
  it('accepts the CRU maximum page size', () => {
    expect(validatePageSize(50)).toBe(50);
  });

  it.each([0, -1, 1.5, 51, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid page size %s', (value) => {
    expect(() => validatePageSize(value)).toThrow('pageSize must be an integer between 1 and 50');
  });
});

describe('collectPaginated', () => {
  it('uses the server-returned page length so a capped page does not skip records', async () => {
    const agreements = Array.from({ length: 115 }, (_, index) => ({ idUmowy: `agreement-${index + 1}` }));
    const fetchPage = vi.fn(async (offset) => ({
      content: agreements.slice(offset, offset + 50),
      totalElements: 115,
      totalMatchingElements: 115,
      offset,
      limit: 50,
    }));

    const result = await collectPaginated(fetchPage);

    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0, 50, 100]);
    expect(result.items).toEqual(agreements);
    expect(result.totalElements).toBe(115);
    expect(result.totalMatchingElements).toBe(115);
  });

  it('falls back to totalElements when matching-count metadata is absent', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: 'one' }],
      totalElements: 1,
      offset: 0,
      limit: 1,
    });

    const result = await collectPaginated(fetchPage);

    expect(fetchPage.mock.calls.map(([offset]) => offset)).toEqual([0]);
    expect(result.items).toEqual([{ idUmowy: 'one' }]);
    expect(result.totalElements).toBe(1);
    expect(result.totalMatchingElements).toBe(1);
  });

  it('preserves compatibility with the legacy totalVisibleElements name', async () => {
    const result = await collectPaginated(async () => ({
      content: [{ idUmowy: 'one' }],
      totalElements: 1,
      totalVisibleElements: 1,
      offset: 0,
      limit: 1,
    }));

    expect(result).toEqual({
      items: [{ idUmowy: 'one' }],
      totalElements: 1,
      totalMatchingElements: 1,
    });
  });

  it('fails closed when the API returns an empty page before the declared total', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ content: [{ idUmowy: 'one' }], totalMatchingElements: 2, offset: 0, limit: 1 })
      .mockResolvedValueOnce({ content: [], totalMatchingElements: 2, offset: 1, limit: 1 });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('ended early at 1 of 2 records');
  });

  it('fails closed when page content is missing or malformed', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: null,
      totalMatchingElements: 1,
      offset: 0,
      limit: 1,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('content must be an array');
  });

  it('rejects a response offset that would skip records', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: 'skipped' }],
      totalElements: 1,
      totalMatchingElements: 1,
      offset: 50,
      limit: 1,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('returned offset 50 for requested offset 0');
  });

  it.each([undefined, -1, 1.5, '0'])('rejects malformed response offset %s', async (responseOffset) => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: 'one' }],
      totalElements: 1,
      totalMatchingElements: 1,
      offset: responseOffset,
      limit: 1,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('response offset must be a non-negative integer');
  });

  it.each([undefined, 0, -1, 1.5, 51, '1'])('rejects malformed response limit %s', async (responseLimit) => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: 'one' }],
      totalElements: 1,
      totalMatchingElements: 1,
      offset: 0,
      limit: responseLimit,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('response limit must be an integer between 1 and 50');
  });

  it.each([-1, 1.5, '1'])('rejects malformed matching total %s', async (matchingTotal) => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: 'one' }],
      totalElements: 1,
      totalMatchingElements: matchingTotal,
      offset: 0,
      limit: 1,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('matching total must be a non-negative integer');
  });

  it('rejects changing total metadata between pages', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        content: [{ idUmowy: 'one' }],
        totalElements: 2,
        totalMatchingElements: 2,
        offset: 0,
        limit: 1,
      })
      .mockResolvedValueOnce({
        content: [{ idUmowy: 'two' }],
        totalElements: 2,
        totalMatchingElements: 1,
        offset: 1,
        limit: 1,
      });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('matching total changed from 2 to 1');
  });

  it('rejects changing totalElements between pages', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        content: [{ idUmowy: 'one' }],
        totalElements: 2,
        totalMatchingElements: 2,
        offset: 0,
        limit: 1,
      })
      .mockResolvedValueOnce({
        content: [{ idUmowy: 'two' }],
        totalElements: 3,
        totalMatchingElements: 2,
        offset: 1,
        limit: 1,
      });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('totalElements changed from 2 to 3');
  });

  it('rejects duplicate agreement IDs across pages', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({
        content: [{ idUmowy: 'duplicate' }],
        totalElements: 2,
        totalMatchingElements: 2,
        offset: 0,
        limit: 1,
      })
      .mockResolvedValueOnce({
        content: [{ idUmowy: 'duplicate' }],
        totalElements: 2,
        totalMatchingElements: 2,
        offset: 1,
        limit: 1,
      });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('duplicate idUmowy duplicate');
  });

  it('rejects pages larger than the server-declared limit', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: 'one' }, { idUmowy: 'two' }],
      totalElements: 2,
      totalMatchingElements: 2,
      offset: 0,
      limit: 1,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('returned 2 records with limit 1');
  });

  it('rejects a record count greater than the declared matching total', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: 'one' }, { idUmowy: 'two' }],
      totalElements: 2,
      totalMatchingElements: 1,
      offset: 0,
      limit: 2,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('collected 2 records but expected 1');
  });

  it('rejects missing count metadata instead of guessing completeness', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: 'one' }],
      offset: 0,
      limit: 1,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('matching total must be a non-negative integer');
  });

  it('rejects records without a usable idUmowy', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      content: [{ idUmowy: '' }],
      totalElements: 1,
      totalMatchingElements: 1,
      offset: 0,
      limit: 1,
    });

    await expect(collectPaginated(fetchPage)).rejects.toThrow('record is missing idUmowy');
  });
});

describe('mapSequentiallyWithDelay', () => {
  it('spaces sequential detail requests without delaying the first one', async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const mapper = vi.fn(async (value) => value * 2);

    const result = await mapSequentiallyWithDelay([1, 2, 3], mapper, {
      delayMs: 500,
      sleep,
    });

    expect(result).toEqual([2, 4, 6]);
    expect(mapper.mock.calls.map(([value]) => value)).toEqual([1, 2, 3]);
    expect(sleep.mock.calls).toEqual([[500], [500]]);
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    -1,
    1.5,
    MAX_TIMER_DELAY_MS + 1,
  ])('rejects invalid delayMs value %s', async (delayMs) => {
    await expect(mapSequentiallyWithDelay([1], async (value) => value, { delayMs }))
      .rejects.toThrow(`delayMs must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`);
  });
});
