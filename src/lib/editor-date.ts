/**
 * The stored date format used by the editor's date-picker placeholder.
 *
 * Clipio writes a plain `YYYY-MM-DD` string into the Plate node and into the
 * serialized `{{datepicker:…}}` token. A calendar returns a local `Date`, so the
 * conversion is deliberately local-calendar based: formatting in UTC made a date
 * picked late in the day shift by one for users west of Greenwich.
 */

const STORED_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Formats a picked date can be rendered in, shared by the editor and storage. */
export const STORED_DATE_FORMATS = [
  "iso",
  "us",
  "eu",
  "long",
  "short",
] as const;

export type StoredDateFormat = (typeof STORED_DATE_FORMATS)[number];

export function isValidStoredDateFormat(
  value: string
): value is StoredDateFormat {
  return (STORED_DATE_FORMATS as readonly string[]).includes(value);
}

/** Whether a string is a real calendar date in `YYYY-MM-DD` form. */
export function isValidStoredDate(value: string): boolean {
  const match = STORED_DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

/** Convert a calendar selection to the stored form, or `null` if it is invalid. */
export function toStoredDate(date: Date): string | null {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const stored = `${year}-${month}-${day}`;
  return isValidStoredDate(stored) ? stored : null;
}

/** Today in the user's local calendar, in the stored form. */
export function todayStoredDate(): string {
  return toStoredDate(new Date()) ?? "";
}

/**
 * Human-readable date for the picker trigger and its hover text. An unknown
 * format falls back to the long form, matching the original token's behavior.
 */
export function formatStoredDate(
  value: string,
  format: string = "long"
): string {
  if (!isValidStoredDate(value)) return value;
  const [year, month, day] = value.split("-").map(Number);
  if (!isValidStoredDateFormat(format)) format = "long";

  if (format === "iso") return value;
  if (format === "us") return `${month}/${day}/${year}`;
  if (format === "eu") {
    return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
  }

  const date = new Date(year!, month! - 1, day!);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    ...(format === "long" ? { year: "numeric" } : {}),
  }).format(date);
}
