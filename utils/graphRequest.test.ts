import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { AxiosError } from 'axios'
import type { InternalAxiosRequestConfig } from 'axios'

import { parseRetryAfterMs, withGraphRetry } from './graphRequest'

function ax429(retryAfter?: string): AxiosError {
  const config = {} as InternalAxiosRequestConfig
  const response = {
    data: { error: { code: 'TooManyRequests' } },
    status: 429,
    statusText: 'Too Many Requests',
    headers: retryAfter ? { 'retry-after': retryAfter } : {},
    config,
  }
  return new AxiosError('Throttled', 'ERR_BAD_REQUEST', config, undefined, response)
}

describe('parseRetryAfterMs', () => {
  it('returns null for missing or empty', () => {
    expect(parseRetryAfterMs(undefined)).toBeNull()
    expect(parseRetryAfterMs('')).toBeNull()
    expect(parseRetryAfterMs('   ')).toBeNull()
  })

  it('parses delay-seconds', () => {
    expect(parseRetryAfterMs('0')).toBe(0)
    expect(parseRetryAfterMs('10')).toBe(10000)
  })

  it('parses HTTP-date', () => {
    const future = new Date(Date.now() + 5000).toUTCString()
    const ms = parseRetryAfterMs(future)
    expect(ms).not.toBeNull()
    expect(ms!).toBeGreaterThanOrEqual(4000)
    expect(ms!).toBeLessThanOrEqual(6000)
  })

  it('returns null for unparseable string', () => {
    expect(parseRetryAfterMs('not-a-number-or-date')).toBeNull()
  })
})

describe('withGraphRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.spyOn(Math, 'random').mockReturnValue(0.5)
  })
  afterEach(() => {
    vi.mocked(Math.random).mockRestore()
    vi.useRealTimers()
  })

  it('returns on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok')
    const p = withGraphRetry(fn)
    await expect(p).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('rethrows non-429 errors', async () => {
    const err = new Error('network')
    const fn = vi.fn().mockRejectedValue(err)
    await expect(withGraphRetry(fn)).rejects.toThrow('network')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('waits Retry-After seconds then retries until success', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(ax429('2'))
      .mockResolvedValueOnce('done')

    const p = withGraphRetry(fn)
    const settled = expect(p).resolves.toBe('done')
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1999)
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    await settled
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('uses exponential backoff when Retry-After header is absent', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(ax429())
      .mockRejectedValueOnce(ax429())
      .mockResolvedValueOnce('ok')

    const p = withGraphRetry(fn, {
      initialBackoffMs: 1000,
      maxBackoffMs: 1000,
      maxWaitPerAttemptMs: 1000,
      maxTotalWaitMs: 10_000,
    })
    const settled = expect(p).resolves.toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    expect(fn).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(1000)
    await settled
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('throws last 429 when maxAttempts exhausted', async () => {
    const e = ax429('1')
    const fn = vi.fn().mockRejectedValue(e)
    const p = withGraphRetry(fn, { maxAttempts: 2, maxTotalWaitMs: 60_000 })
    const rejected = expect(p).rejects.toBe(e)
    expect(fn).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1000)
    await rejected
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
