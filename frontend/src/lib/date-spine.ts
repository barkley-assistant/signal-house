export function buildDateSpine(startDay: string, endDay: string): string[] {
  const start = new Date(startDay + "T00:00:00Z");
  const end = new Date(endDay + "T00:00:00Z");
  const days: string[] = [];
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return days;
  }
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}
