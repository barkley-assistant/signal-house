import { describe, expect, it, vi, afterEach } from 'vitest'
import { getAccessProtectionConfig, verifyAccess } from '../access-protection'

vi.mock('h3', () => ({
  createError: (error: unknown) => error,
  getRequestHeader: (event: any, key: string) => event.headers?.[key],
  setResponseHeader: vi.fn(),
}))

describe('access protection', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('is disabled by default', () => {
    expect(getAccessProtectionConfig({})).toMatchObject({ enabled: false, username: 'signal-house' })
  })

  it('accepts the configured basic auth credential', () => {
    vi.stubEnv('SECRET_HOUSE_ACCESS_USERNAME', 'jake')
    vi.stubEnv('SECRET_HOUSE_ACCESS_PASSWORD', 's3cret')
    const event = { headers: { authorization: `Basic ${Buffer.from('jake:s3cret').toString('base64')}` } } as any
    expect(() => verifyAccess(event)).not.toThrow()
  })

  it('rejects missing or wrong credentials', () => {
    vi.stubEnv('SECRET_HOUSE_ACCESS_PASSWORD', 's3cret')
    const event = { headers: {} } as any
    expect(() => verifyAccess(event)).toThrowError()
  })
})
