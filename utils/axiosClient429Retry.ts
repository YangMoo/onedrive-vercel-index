import axios, { type AxiosRequestConfig, type AxiosResponse } from 'axios'

import { parseRetryAfterMs } from './retryAfter'

export interface Client429RetryOptions {
  maxAttempts?: number
  maxWaitMs?: number
}

/**
 * Browser-side: retry GET when our API returns Graph 429 with Retry-After (or short backoff if missing).
 */
export async function axiosGetRespecting429<T = unknown>(
  url: string,
  config?: AxiosRequestConfig,
  options?: Client429RetryOptions
): Promise<AxiosResponse<T>> {
  const maxAttempts = options?.maxAttempts ?? 5
  const maxWaitMs = options?.maxWaitMs ?? 8000

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await axios.get<T>(url, config)
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number; headers?: Record<string, string> } })?.response?.status
      if (status !== 429 || attempt === maxAttempts) {
        throw err
      }
      const headers = (err as { response?: { headers?: Record<string, string> } }).response?.headers
      const ra = headers?.['retry-after']
      let ms = parseRetryAfterMs(typeof ra === 'string' ? ra : undefined) ?? 1500
      ms = Math.min(ms, maxWaitMs)
      await new Promise<void>(resolve => setTimeout(resolve, ms))
    }
  }

  throw new Error('axiosGetRespecting429: exhausted attempts')
}
