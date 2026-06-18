import { createError, getRequestHeader, setResponseHeader, type H3Event } from 'h3'
import { getEnv } from './env'

const WWW_AUTH = 'Basic realm="Signal House", charset="UTF-8"'

export interface AccessProtectionConfig {
  enabled: boolean
  username: string
  password: string
}

function decodeBasicAuth(value: string): { username: string; password: string } | null {
  if (!value.startsWith('Basic ')) return null
  try {
    const raw = Buffer.from(value.slice(6), 'base64').toString('utf8')
    const separator = raw.indexOf(':')
    if (separator < 0) return null
    return {
      username: raw.slice(0, separator),
      password: raw.slice(separator + 1),
    }
  } catch {
    return null
  }
}

export function getAccessProtectionConfig(env: NodeJS.ProcessEnv = process.env): AccessProtectionConfig {
  const password = getEnv(env, 'SECRET_HOUSE_ACCESS_PASSWORD')?.trim() ?? ''
  const username = getEnv(env, 'SECRET_HOUSE_ACCESS_USERNAME')?.trim() ?? 'signal-house'

  return {
    enabled: password.length > 0,
    username,
    password,
  }
}

export function verifyAccess(event: H3Event, env: NodeJS.ProcessEnv = process.env): void {
  const config = getAccessProtectionConfig(env)
  if (!config.enabled) return

  const authorization = getRequestHeader(event, 'authorization') ?? ''
  const parsed = decodeBasicAuth(authorization)
  const ok = parsed !== null && parsed.username === config.username && parsed.password === config.password

  if (ok) return

  setResponseHeader(event, 'WWW-Authenticate', WWW_AUTH)

  throw createError({
    statusCode: 401,
    statusMessage: 'Access denied',
    data: { protected: true },
  })
}
