import { RequestError } from "@octokit/request-error";

/**
 * Ensures that the unknown value is an Error object.
 *
 * If the value is already an Error object, it is returned as is.
 * Otherwise, a new Error object is created with a message describing the original value.
 *
 * @param value - The value to be checked and potentially converted to an Error object.
 * @returns An Error object, either the original one or a new one wrapping the original value.
 *
 * @example
 * ```typescript
 * try {
 *   // Some code that might throw
 * } catch (e) {
 *   const error = ensureError(e);
 *   console.error(error.message);
 * }
 * ```
 */
export function ensureError(value: unknown): Error {
  if (value instanceof Error) return value;

  let stringified;
  try {
    stringified = JSON.stringify(value);
  } catch {
		stringified = "[Unknown value that cannot be stringified]"
	}

  const error = new Error(`Non-Error Value: ${stringified}`, {cause: value});
  return error;
}


/**
 * Asserts that the given value is an Oktokit RequestError.
 *
 * @param value - The value to check.
 * @param message - An optional message to prepend to the error message if the value is not a RequestError.
 * @returns The value casted as a RequestError if it is one.
 * @throws {Error} If the value is not a RequestError.
 */
export function assertRequestError(value: unknown, message?: string): RequestError {
  const error = ensureError(value);
  if (!(value instanceof RequestError)) {
    if (message) {
      error.message = `${message}: ${error.message}`;
    }
    throw error
  };
  return value;
}