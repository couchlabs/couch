// Simple date helpers for unit tests
export const FIXED_DATE = new Date("2025-01-01T00:00:00Z")

export function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}
