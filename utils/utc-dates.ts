export function formatDayLabel(day: string): string {
  const [y, m, d] = day.split('-').map(Number)
  const date = new Date(Date.UTC(y!, m! - 1, d!))
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function formatWindowRange(startDay: string, endDay: string): string {
  return `${formatDayLabel(startDay)} – ${formatDayLabel(endDay)}`
}
