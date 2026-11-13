/**
 * Shared date/time formatting so every timestamp in the workspace reads the
 * same way. Falls back to the raw value when the input cannot be parsed.
 */
const dateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatDateTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : dateTime.format(date);
}
