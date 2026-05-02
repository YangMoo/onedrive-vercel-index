import axios, { type AxiosRequestConfig, type AxiosResponse, isAxiosError } from 'axios'

import { parseRetryAfterMs } from './retryAfter'

export interface GraphRetryOptions {
  maxAttempts?: number
  maxWaitPerAttemptMs?: number
  maxTotalWaitMs?: number
  initialBackoffMs?: number
  maxBackoffMs?: number
}

/** Re-export for callers/tests that imported from graphRequest before. */
export { parseRetryAfterMs } from './retryAfter'

function readIntEnv(name: string, fallback: number, min: number, max: number): number {
  if (typeof process === 'undefined' || !process.env) return fallback
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const n = parseInt(raw, 10)
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, n))
}

function resolveDefaults(): {
  maxAttempts: number
  maxWaitPerAttemptMs: number
  maxTotalWaitMs: number
  initialBackoffMs: number
  maxBackoffMs: number
} {
  return {
    maxAttempts: readIntEnv('GRAPH_RETRY_MAX_ATTEMPTS', 4, 1, 15),
    maxWaitPerAttemptMs: readIntEnv('GRAPH_RETRY_MAX_WAIT_MS', 2000, 500, 120_000),
    maxTotalWaitMs: readIntEnv('GRAPH_RETRY_MAX_TOTAL_MS', 5000, 0, 120_000),
    initialBackoffMs: readIntEnv('GRAPH_RETRY_INITIAL_BACKOFF_MS', 750, 100, 60_000),
    maxBackoffMs: readIntEnv('GRAPH_RETRY_MAX_BACKOFF_MS', 8000, 500, 120_000),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function headerRetryAfter(headers: Record<string, unknown> | undefined): string | undefined {
  if (!headers) return undefined
  const v = headers['retry-after'] ?? headers['Retry-After']
  if (typeof v === 'string') return v
  if (Array.isArray(v) && typeof v[0] === 'string') return v[0]
  return undefined
}

/**
 * Run an axios-based Microsoft Graph call with 429 handling: honor Retry-After, else exponential backoff.
 * Tune with GRAPH_RETRY_* env vars (see resolveDefaults).
 */
export async function withGraphRetry<T>(fn: () => Promise<T>, options: GraphRetryOptions = {}): Promise<T> {
  const d = resolveDefaults()
  const maxAttempts = options.maxAttempts ?? d.maxAttempts
  const maxWaitPerAttemptMs = options.maxWaitPerAttemptMs ?? d.maxWaitPerAttemptMs
  const maxTotalWaitMs = options.maxTotalWaitMs ?? d.maxTotalWaitMs
  const initialBackoffMs = options.initialBackoffMs ?? d.initialBackoffMs
  const maxBackoffMs = options.maxBackoffMs ?? d.maxBackoffMs

  let totalWaited = 0
  let backoffMs = initialBackoffMs

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      if (!isAxiosError(err) || err.response?.status !== 429) {
        throw err
      }
      if (attempt === maxAttempts) {
        throw err
      }

      const raw = headerRetryAfter(err.response?.headers as Record<string, unknown> | undefined)
      let delayMs = parseRetryAfterMs(raw)

      if (delayMs === null) {
        const jitter = 0.85 + Math.random() * 0.3
        delayMs = Math.min(backoffMs * jitter, maxBackoffMs)
        backoffMs = Math.min(backoffMs * 2, maxBackoffMs)
      }

      delayMs = Math.min(delayMs, maxWaitPerAttemptMs)
      const remaining = maxTotalWaitMs - totalWaited
      if (remaining <= 0) {
        throw err
      }
      delayMs = Math.min(delayMs, remaining)
      await sleep(delayMs)
      totalWaited += delayMs
    }
  }

  throw new Error('withGraphRetry: exhausted attempts')
}

export function graphGet<T = unknown>(url: string, config?: AxiosRequestConfig): Promise<AxiosResponse<T>> {
  return withGraphRetry(() => axios.get<T>(url, config))
}
