/**
 * Parse HTTP Retry-After: delay-seconds or HTTP-date (Graph + our API proxy use the same header).
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
