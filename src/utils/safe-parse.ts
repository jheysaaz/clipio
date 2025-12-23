/**
 * Safe JSON parsing utilities to prevent JSON parse errors from crashing the app
 */

/**
 * Safely parse JSON with error handling
 * @param json JSON string to parse
 * @returns Parsed object or null if parsing fails
 */
export const safeJsonParse = <T = unknown>(json: string | null | undefined): T | null => {
  if (!json || typeof json !== "string") {
    return null;
  }

  try {
    return JSON.parse(json) as T;
  } catch (error) {
    console.error("Failed to parse JSON:", error);
    return null;
  }
};

/**
 * Safely parse JSON with validation
 * @param json JSON string to parse
 * @param validator Function to validate the parsed object
 * @returns Parsed and validated object or null if parsing/validation fails
 */
export const safeJsonParseWithValidation = <T = unknown>(
  json: string | null | undefined,
  validator: (obj: unknown) => obj is T
): T | null => {
  const parsed = safeJsonParse(json);
  if (parsed && validator(parsed)) {
    return parsed;
  }
  return null;
};
