import { describe, expect, it, jest, beforeEach } from '@jest/globals'

const mocks = {
  mockVerifyAccess: jest.fn(),
}

jest.mock('../../lib/access-protection', () => ({
  verifyAccess: mocks.mockVerifyAccess,
}))

import middleware from '../access-protection.global'

describe('access protection middleware', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('runs the shared protection check for every request', () => {
    const event = { url: '/api/state' } as any
    ;(middleware as (event: unknown) => void)(event)
    expect(mocks.mockVerifyAccess).toHaveBeenCalledWith(event)
  })
})
