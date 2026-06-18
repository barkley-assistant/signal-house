import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  mockVerifyAccess: vi.fn(),
}))

vi.mock('../../lib/access-protection', () => ({
  verifyAccess: mocks.mockVerifyAccess,
}))

import middleware from '../access-protection.global'

describe('access protection middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('runs the shared protection check for every request', () => {
    const event = { url: '/api/state' } as any
    ;(middleware as (event: unknown) => void)(event)
    expect(mocks.mockVerifyAccess).toHaveBeenCalledWith(event)
  })
})
