export interface FormatNumberOptions {
  compact?: boolean
}

const NUMBER_FORMATTER = new Intl.NumberFormat('en-US')

export function formatCompactNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  if (!Number.isFinite(value)) return '—'

  const abs = Math.abs(value)
  if (abs < 1000) return NUMBER_FORMATTER.format(value)

  const formatter = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: abs >= 10_000 ? 0 : 1,
  })

  return formatter.format(value)
}

export function formatNumber(value: number | null | undefined, options: FormatNumberOptions = {}): string {
  if (value == null) return '—'
  if (!Number.isFinite(value)) return '—'
  if (options.compact) return formatCompactNumber(value)
  return NUMBER_FORMATTER.format(value)
}
