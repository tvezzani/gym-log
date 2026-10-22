import { Temporal } from '@js-temporal/polyfill';
export const todayIn = (zone: string, now = Temporal.Now.instant()) =>
  now.toZonedDateTimeISO(zone).toPlainDate().toString();
export const shiftDate = (date: string, days: number) =>
  Temporal.PlainDate.from(date).add({ days }).toString();
export function dayBounds(date: string, zone: string) {
  const day = Temporal.PlainDate.from(date);
  return {
    start: day
      .toZonedDateTime(zone)
      .toInstant()
      .toString({ fractionalSecondDigits: 3 }),
    end: day
      .add({ days: 1 })
      .toZonedDateTime(zone)
      .toInstant()
      .toString({ fractionalSecondDigits: 3 }),
  };
}
export function wallTime(instant: string, zone: string) {
  return Temporal.Instant.from(instant)
    .toZonedDateTimeISO(zone)
    .toPlainDateTime()
    .toString({ fractionalSecondDigits: 3 });
}
export function performedInstant(
  local: string,
  zone: string,
  occurrence: 'earlier' | 'later' = 'earlier',
) {
  const plain = Temporal.PlainDateTime.from(local);
  const zoned = plain.toZonedDateTime(zone, { disambiguation: occurrence });
  if (!zoned.toPlainDateTime().equals(plain))
    throw new Error(
      'This time does not exist in your timezone because the clocks move forward. Choose another time.',
    );
  return zoned.toInstant().toString({ fractionalSecondDigits: 3 });
}
export function repeatedTime(local: string, zone: string) {
  try {
    const p = Temporal.PlainDateTime.from(local);
    const a = p.toZonedDateTime(zone, { disambiguation: 'earlier' }),
      b = p.toZonedDateTime(zone, { disambiguation: 'later' });
    return (
      a.toPlainDateTime().equals(p) &&
      b.toPlainDateTime().equals(p) &&
      a.epochMilliseconds !== b.epochMilliseconds
    );
  } catch {
    return false;
  }
}
export function dateLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  },
) {
  return new Intl.DateTimeFormat('en-US', {
    ...options,
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00.000Z`));
}
export const timeLabel = (instant: string, zone: string) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant));
export const initialTime = (date: string, zone: string) =>
  `${date}T${wallTime(new Date().toISOString(), zone).split('T')[1]}`;

// At the API's extreme supported years, omit/clamp UTC bounds that cannot
// contain a valid workout instant rather than sending expanded-year strings.
export function historyBounds(
  date: string,
  zone: string,
): Record<string, string> {
  const bounds = dayBounds(date, zone);
  const minimum = '0001-01-01T00:00:00.000Z',
    maximum = '9999-12-31T23:59:59.999Z';
  return {
    start:
      Date.parse(bounds.start) < Date.parse(minimum) ? minimum : bounds.start,
    ...(Date.parse(bounds.end) > Date.parse(maximum)
      ? {}
      : { end: bounds.end }),
  };
}
