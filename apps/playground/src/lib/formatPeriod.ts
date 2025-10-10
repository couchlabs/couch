/**
 * Formats a period in seconds to a human-readable string
 * Examples:
 * - 60 seconds -> "1 min"
 * - 3600 seconds -> "1 hour"
 * - 86400 seconds -> "1 day"
 * - 2592000 seconds -> "30 days"
 */
export function formatPeriod(seconds: number): string {
  const minute = 60
  const hour = 60 * minute
  const day = 24 * hour
  const week = 7 * day
  const month = 30 * day

  if (seconds < minute) {
    return `${seconds} sec${seconds !== 1 ? "s" : ""}`
  }

  if (seconds < hour) {
    const mins = Math.floor(seconds / minute)
    return `${mins} min${mins !== 1 ? "s" : ""}`
  }

  if (seconds < day) {
    const hours = Math.floor(seconds / hour)
    return `${hours} hour${hours !== 1 ? "s" : ""}`
  }

  if (seconds < week) {
    const days = Math.floor(seconds / day)
    return `${days} day${days !== 1 ? "s" : ""}`
  }

  if (seconds < month) {
    const weeks = Math.floor(seconds / week)
    return `${weeks} week${weeks !== 1 ? "s" : ""}`
  }

  const months = Math.floor(seconds / month)
  return `${months} month${months !== 1 ? "s" : ""}`
}

/**
 * Formats subscription details as "Charges X USDC every Y"
 * Example: "Charges 0.01 USDC every 30 mins"
 */
export function formatSubscriptionSummary(
  amount: string,
  periodInSeconds: number,
): string {
  return `Charges ${amount} USDC every ${formatPeriod(periodInSeconds)}`
}
