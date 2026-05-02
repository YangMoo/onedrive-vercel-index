import useSWRInfinite from 'swr/infinite'

import type { OdAPIResponse } from '../types'

import { axiosGetRespecting429 } from './axiosClient429Retry'
import { getStoredToken } from './protectedRouteHandler'

function normaliseFetcherArgs(args: unknown[]): { url: string; token?: string } {
  const first = args[0]
  if (Array.isArray(first) && typeof first[0] === 'string') {
    const t = first[1]
    return { url: first[0], token: typeof t === 'string' && t.length > 0 ? t : undefined }
  }
  if (typeof first === 'string') {
    const t = args[1]
    return { url: first, token: typeof t === 'string' && t.length > 0 ? t : undefined }
  }
  throw new Error('fetcher: invalid key from useSWRInfinite')
}

// Common axios fetch function for use with useSWR
export async function fetcher(...args: unknown[]): Promise<any> {
  const { url, token } = normaliseFetcherArgs(args)
  try {
    const res = await axiosGetRespecting429(
      url,
      token ? { headers: { 'od-protected-token': token } } : undefined
    )
    return res.data
  } catch (err: any) {
    throw { status: err.response?.status, message: err.response?.data }
  }
}

/**
 * Paging with useSWRInfinite + protected token support
 * @param path Current query directory path
 * @returns useSWRInfinite API
 */
export function useProtectedSWRInfinite(path: string = '') {
  const hashedToken = getStoredToken(path)

  /**
   * Next page infinite loading for useSWR
   * @param pageIdx The index of this paging collection
   * @param prevPageData Previous page information
   * @param path Directory path
   * @returns API to the next page
   */
  function getNextKey(pageIndex: number, previousPageData: OdAPIResponse): (string | null)[] | null {
    // Reached the end of the collection
    if (previousPageData && !previousPageData.folder) return null

    // First page with no prevPageData
    if (pageIndex === 0) return [`/api/?path=${path}`, hashedToken]

    // Add nextPage token to API endpoint
    return [`/api/?path=${path}&next=${previousPageData.next}`, hashedToken]
  }

  // Disable auto-revalidate, these options are equivalent to useSWRImmutable
  // https://swr.vercel.app/docs/revalidation#disable-automatic-revalidations
  const revalidationOptions = {
    revalidateIfStale: false,
    revalidateOnFocus: false,
    revalidateOnReconnect: true,
  }
  return useSWRInfinite(getNextKey, fetcher, revalidationOptions)
}
