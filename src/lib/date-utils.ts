/**
 * Date utility functions
 */

/**
 * Convert a date to a relative time string (e.g., "2 days ago", "just now")
 */
export const getRelativeTime = (date: string | Date): string => {
  const now = new Date();
  const then = new Date(date);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  // Less than a minute
  if (seconds < 60) {
    return "just now";
  }

  // Less than an hour
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }

  // Less than a day
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }

  // Less than a week
  const days = Math.floor(hours / 24);
  if (days < 7) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }

  // Less than a month
  const weeks = Math.floor(days / 7);
  if (weeks < 4) {
    return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  }

  // Less than a year
  const months = Math.floor(days / 30);
  if (months < 12) {
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }

  // Years
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
};

const RELATIVE_TIME_UNITS = {
  second: "s",
  minute: "m",
  hour: "h",
  day: "d",
  week: "w",
  month: "mo",
  year: "y",
} as const;

/**
 * Shorten a relative time for the footer's narrow layout ("1 day ago" → "1d ago").
 * Unknown values are returned unchanged rather than inventing a label.
 */
export const shortenRelativeTime = (value: string): string => {
  if (value === "just now") return "now";
  const match = /^(\d+) (second|minute|hour|day|week|month|year)s? ago$/.exec(
    value
  );
  if (!match) return value;
  const unit = match[2] as keyof typeof RELATIVE_TIME_UNITS;
  return `${match[1]}${RELATIVE_TIME_UNITS[unit]} ago`;
};

/**
 * Format a date to a short string (e.g., "Nov 11")
 */
export const formatShortDate = (date: string | Date): string => {
  return new Date(date).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
};

/**
 * Format a date to a full string (e.g., "November 11, 2025")
 */
export const formatFullDate = (date: string | Date): string => {
  return new Date(date).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};
