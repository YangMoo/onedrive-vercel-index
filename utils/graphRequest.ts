import axios, { type AxiosRequestConfig, type AxiosResponse, isAxiosError } from 'axios'

export interface GraphRetryOptions {
  maxAttempts?: number
  maxWaitPerAttemptMs?: number
  maxTotalWaitMs?: number
  initialBackoffMs?: number
  maxBackoffMs?: number
}

/** Defaults sized for Vercel serverless (~10s wall clock on Hobby): leave room for token + Graph RTT. */
const defaults = {
  maxAttempts: 4,
  maxWaitPerAttemptMs: 2000,
  maxTotalWaitMs: 5000,
  initialBackoffMs: 750,
  maxBackoffMs: 8000,
} as const

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
 * Parse Microsoft Graph / HTTP Retry-After: delay-seconds or HTTP-date.
 * @see https://learn.microsoft.com/graph/throttling
 */
export function parseRetryAfterMs(retryAfter: string | undefined): number | null {
  if (retryAfter === undefined) return null
  const trimmed = retryAfter.trim()
  if (!trimmed) return null
  if (/^\d+$/.test(trimmed)) {
    return Math.max(0, parseInt(trimmed, 10)) * 1000
  }
  const dateMs = Date.parse(trimmed)
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now())
  }
  return null
}

/**
 * Run an axios-based Microsoft Graph call with 429 handling: honor Retry-After, else exponential backoff.
 */
export async function withGraphRetry<T>(fn: () => Promise<T>, options: GraphRetryOptions = {}): Promise<T> {
  const maxAttempts = options.maxAttempts ?? defaults.maxAttempts
  const maxWaitPerAttemptMs = options.maxWaitPerAttemptMs ?? defaults.maxWaitPerAttemptMs
  const maxTotalWaitMs = options.maxTotalWaitMs ?? defaults.maxTotalWaitMs
  const initialBackoffMs = options.initialBackoffMs ?? defaults.initialBackoffMs
  const maxBackoffMs = options.maxBackoffMs ?? defaults.maxBackoffMs

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
