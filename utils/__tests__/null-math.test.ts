import { describe, it, expect } from '@jest/globals'
import { sumOrNull } from '../null-math'

describe('sumOrNull', () => {
  it('returns null for an empty array', () => {
    expect(sumOrNull([])).toBeNull()
  })

  it('returns null when every value is null', () => {
    expect(sumOrNull([null, null, null])).toBeNull()
  })

  it('returns the single value when only one numeric entry is present', () => {
    expect(sumOrNull([42])).toBe(42)
    expect(sumOrNull([0])).toBe(0)
  })

  it('skips nulls and sums non-null values', () => {
    expect(sumOrNull([null, 1, null, 2, 3])).toBe(6)
  })

  it('treats 0 as a real measured value, distinct from null', () => {
    expect(sumOrNull([0, null, 0])).toBe(0)
    expect(sumOrNull([0, 1, null])).toBe(1)
  })

  it('handles negative values', () => {
    expect(sumOrNull([-5, null, 3])).toBe(-2)
  })

  it('does not mutate the input array', () => {
    const input: Array<number | null> = [1, null, 2]
    const copy = [...input]
    sumOrNull(input)
    expect(input).toEqual(copy)
  })
})
