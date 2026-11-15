import type { StoredDate } from '../use-cases/record-reads.ts'
import { isIsoInstant } from './event-formats.ts'
import { toTime } from './times.ts'
import type { TimeText, Times } from './times.ts'

const msPerMinute = 60 * 1000

/** A stored time as the page writes it: an instant in a `<time>`, anything else GAS found there as stored. */
export type RecordTime =
  | TimeText
  | { datetime: null; text: string; title: null }

/** Null where nothing is stored; a malformed date is shown as it is, never read as another. */
export const toRecordTime = (
  value: StoredDate,
  times: Times
): RecordTime | null => {
  if (value === null || value === '') {
    return null
  }

  return isIsoInstant(value)
    ? toTime(new Date(value), times)
    : { datetime: null, text: value, title: null }
}

const minuteOf = (time: RecordTime | null): string | number | undefined =>
  time?.datetime
    ? Math.floor(Date.parse(time.datetime) / msPerMinute)
    : time?.text

/** Two times in the same minute, by their instants: the page writes those the same whatever the zone and the clocks. */
export const readsTheSame = (
  a: RecordTime | null,
  b: RecordTime | null
): boolean => minuteOf(a) === minuteOf(b)
