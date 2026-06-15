export function formatCompactNumber(value: number | null | undefined): string {
  if (value == null) return '—'
  if (!Number.isFinite(value)) return '—'

  const abs = Math.abs(value)
  if (abs < 1000) return Number.isInteger(value) ? `${value}` : value.toLocaleString()

  const formatter = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    compactDisplay: 'short',
    maximumFractionDigits: abs >= 10_000 ? 0 : 1,
  })

  return formatter.format(value)
}
