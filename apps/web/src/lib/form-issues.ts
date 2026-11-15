// Pure helpers behind components/form.tsx: reading a field's errors, placing the server's
// issues on fields, and the id that ties a control to its label, error and focus.
import type { FieldIssue } from './api-client';

/**
 * The message to show for a field. A Standard Schema validator (zod) leaves issue objects
 * in a field's errors; a server issue is set as a plain string.
 */
export function firstMessage(errors: readonly unknown[]): string | undefined {
  for (const error of errors) {
    if (typeof error === 'string' && error) return error;
    if (typeof error === 'object' && error !== null && 'message' in error) {
      const { message } = error;
      if (typeof message === 'string' && message) return message;
    }
  }
  return undefined;
}

/** The server's issues keyed by field, first message per field, for fields the form has. */
export function serverFieldErrors(
  issues: readonly FieldIssue[],
  fieldNames: readonly string[],
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const { path, message } of issues) {
    if (fieldNames.includes(path) && !Object.hasOwn(errors, path)) errors[path] = message;
  }
  return errors;
}

/** The id of a field's control, unique per form: label, error and focus all find it by this. */
export function controlId(formId: string, fieldName: string): string {
  return `${formId}-${fieldName.replaceAll('.', '-')}`;
}
