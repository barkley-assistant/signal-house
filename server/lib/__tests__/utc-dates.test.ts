import { describe, it, expect } from '@jest/globals'
import { formatDayLabel, formatWindowRange } from '../../../utils/utc-dates'

describe('formatDayLabel', () => {
  it('formats a YYYY-MM-DD string into a readable en-US label in UTC', () => {
    expect(formatDayLabel('2026-06-14')).toBe('Jun 14')
    expect(formatDayLabel('2026-01-01')).toBe('Jan 1')
    expect(formatDayLabel('2026-12-25')).toBe('Dec 25')
  })
})

describe('formatWindowRange', () => {
  it('formats a date range from two YYYY-MM-DD strings', () => {
    expect(formatWindowRange('2026-05-18', '2026-06-14')).toBe('May 18 – Jun 14')
    expect(formatWindowRange('2026-01-01', '2026-01-31')).toBe('Jan 1 – Jan 31')
  })
})
