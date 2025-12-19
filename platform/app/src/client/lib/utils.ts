import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Formats an ISO 8601 UTC timestamp to local date and time
 * @param isoString - ISO 8601 UTC timestamp (e.g., "2025-12-17T17:33:45.827Z")
 * @param options - Intl.DateTimeFormatOptions for customization
 * @returns Formatted date and time in viewer's local timezone
 */
export function formatDateTime(
  isoString: string,
  options?: Intl.DateTimeFormatOptions,
): string {
  if (!isoString) return ""

  const date = new Date(isoString)

  // Verify the date is valid
  if (Number.isNaN(date.getTime())) {
    console.error(`Invalid date string: ${isoString}`)
    return "Invalid date"
  }

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hour12: true,
    ...options,
  }

  return date.toLocaleString(undefined, defaultOptions)
}

/**
 * Formats an ISO 8601 UTC timestamp to local date only (no time)
 * @param isoString - ISO 8601 UTC timestamp
 * @returns Formatted date in viewer's local timezone
 */
export function formatDate(isoString: string): string {
  if (!isoString) return ""

  const date = new Date(isoString)

  if (Number.isNaN(date.getTime())) {
    console.error(`Invalid date string: ${isoString}`)
    return "Invalid date"
  }

  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  })
}
