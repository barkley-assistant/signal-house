import { describe, expect, it, jest, beforeEach, afterEach } from '@jest/globals'
import { getAccessProtectionConfig, verifyAccess } from '../access-protection'

jest.mock('h3', () => ({
  createError: (error: unknown) => error,
  getRequestHeader: (event: any, key: string) => event.headers?.[key],
  setResponseHeader: jest.fn(),
}))

describe('access protection', () => {
  let savedAccessUsername: string | undefined
  let savedAccessPassword: string | undefined

  beforeEach(() => {
    savedAccessUsername = process.env['SECRET_HOUSE_ACCESS_USERNAME']
    savedAccessPassword = process.env['SECRET_HOUSE_ACCESS_PASSWORD']
    delete process.env['SECRET_HOUSE_ACCESS_USERNAME']
    delete process.env['SECRET_HOUSE_ACCESS_PASSWORD']
  })

  afterEach(() => {
    if (savedAccessUsername === undefined) {
      delete process.env['SECRET_HOUSE_ACCESS_USERNAME']
    } else {
      process.env['SECRET_HOUSE_ACCESS_USERNAME'] = savedAccessUsername
    }
    if (savedAccessPassword === undefined) {
      delete process.env['SECRET_HOUSE_ACCESS_PASSWORD']
    } else {
      process.env['SECRET_HOUSE_ACCESS_PASSWORD'] = savedAccessPassword
    }
  })

  it('is disabled by default', () => {
    expect(getAccessProtectionConfig({})).toMatchObject({ enabled: false, username: 'signal-house' })
  })

  it('accepts the configured basic auth credential', () => {
    process.env['SECRET_HOUSE_ACCESS_USERNAME'] = 'jake'
    process.env['SECRET_HOUSE_ACCESS_PASSWORD'] = 's3cret'
    const event = { headers: { authorization: `Basic ${Buffer.from('jake:s3cret').toString('base64')}` } } as any
    expect(() => verifyAccess(event)).not.toThrow()
  })

  it('rejects missing or wrong credentials', () => {
    process.env['SECRET_HOUSE_ACCESS_PASSWORD'] = 's3cret'
    const event = { headers: {} } as any
    expect(() => verifyAccess(event)).toThrow()
  })
})
