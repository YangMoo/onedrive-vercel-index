import type { NextApiRequest, NextApiResponse } from 'next'

import { getAccessToken } from '.'
import { graphGet } from '../../utils/graphRequest'
import apiConfig from '../../config/api.config'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Get access token from storage
  const accessToken = await getAccessToken()

  // Get item details (specifically, its path) by its unique ID in OneDrive
  const { id = '' } = req.query

  // Set edge function caching for faster load times, check docs:
  // https://vercel.com/docs/concepts/functions/edge-caching
  res.setHeader('Cache-Control', apiConfig.cacheControlHeader)

  if (typeof id === 'string') {
    const itemApi = `${apiConfig.driveApi}/items/${id}`

    try {
      const { data } = await graphGet(itemApi, {
        headers: { Authorization: `Bearer ${accessToken}` },
        params: {
          select: 'id,name,parentReference',
        },
      })
      res.status(200).json(data)
    } catch (error: any) {
      const status = error?.response?.status ?? 500
      const retryAfter = error?.response?.headers?.['retry-after']
      if (retryAfter) {
        res.setHeader('Retry-After', String(retryAfter))
      }
      res.status(status).json({ error: error?.response?.data ?? 'Internal server error.' })
    }
  } else {
    res.status(400).json({ error: 'Invalid driveItem ID.' })
  }
  return
}
