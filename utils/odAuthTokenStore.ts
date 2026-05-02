import Redis from 'ioredis'

// Persistent key-value store is provided by Redis, hosted on Upstash
// https://vercel.com/integrations/upstash
const kv = new Redis(process.env.REDIS_URL ?? 'redis://127.0.0.1:6379')

export async function getOdAuthTokens(): Promise<{ accessToken: unknown; refreshToken: unknown }> {
  const accessToken = await kv.get('access_token')
  const refreshToken = await kv.get('refresh_token')

  return {
    accessToken,
    refreshToken,
  }
}

export async function storeOdAuthTokens({
  accessToken,
  accessTokenExpiry,
  refreshToken,
}: {
  accessToken: string
  accessTokenExpiry: number
  refreshToken: string
}): Promise<void> {
  await kv.set('access_token', accessToken, 'EX', accessTokenExpiry)
  await kv.set('refresh_token', refreshToken)
}
