import { config } from '../../common/config.ts'
import { logger } from '../../common/logger.ts'
import type { EventKey } from '../use-cases/get-event.use-case.ts'
import { toUrlService } from './event-address.ts'
import {
  fromZonedInput,
  hoursPerDay,
  minutesPerHour,
  msPerMinute,
  msPerSecond,
  secondsPerMinute,
  toZonedInput
} from './zoned-clock.ts'
import type { Zone, ZonedEdge } from './zoned-clock.ts'

export {
  fromZonedInput,
  hoursPerDay,
  minutesPerHour,
  msPerMinute,
  toZonedInput
}
export type { Zone, ZonedEdge }

export const none = '—'

/** Intl and `toISOString` throw on an unparseable date. */
export const toValidDate = (value: string): Date | null => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

const isoInstant =
  /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d+)?)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/

/** ISO 8601 with a zone, on a day the calendar has: `new Date` reads far more than that. */
export const isIsoInstant = (value: string): boolean => {
  const match = isoInstant.exec(value)

  if (match === null) {
    return false
  }

  const [year, month, day] = match.slice(1, 4).map(Number)
  const date = new Date(Date.UTC(year, month - 1, day))

  return date.getUTCMonth() === month - 1 && date.getUTCDate() === day
}

/** Compared as instants: two ISO spellings of one moment need not sort as strings. */
export const isAfter = (later: string, earlier: string): boolean => {
  const a = toValidDate(later)
  const b = toValidDate(earlier)

  return a !== null && b !== null && a.getTime() > b.getTime()
}

/** The shared CDP logs pattern, so one link shows the trace across every service. */
const indexPattern = 'e55f3890-5d4a-11ee-8f40-670c9b0b8093'

const traceWindowMs = 6 * minutesPerHour * secondsPerMinute * msPerSecond

/** Rison escapes with `!` and delimits with `'`; escaping both first keeps a hostile id inside the string. */
const toRisonString = (value: string): string =>
  encodeURIComponent(value.replace(/!/g, '!!').replace(/'/g, "!'"))

/** Six hours either side: wide enough for later retries, narrow enough to stay quick. */
const toTraceWindow = (createdAt: string) => {
  const created = toValidDate(createdAt)

  if (created === null) {
    return null
  }

  return {
    from: new Date(created.getTime() - traceWindowMs).toISOString(),
    to: new Date(created.getTime() + traceWindowMs).toISOString()
  }
}

const buildDiscoverHref = (
  base: string,
  kuery: string,
  createdAt: string
): string | null => {
  const window = toTraceWindow(createdAt)

  if (window === null) {
    return null
  }

  const columns = 'container_name,message,log.level,trace.id'

  return (
    `${base}/_dashboards/app/data-explorer/discover/#` +
    `?_a=(discover:(columns:!(${columns}),isDirty:!f,sort:!('@timestamp',desc)),metadata:(indexPattern:${indexPattern},view:discover))` +
    `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'${window.from}',to:'${window.to}'))` +
    `&_q=(filters:!(),query:(language:kuery,query:'${kuery}'))`
  )
}

/** `%22` is the kuery's double quote, url-encoded inside the single-quoted rison string. */
const toKuery = (field: string, value: string): string =>
  `${field}:%22${toRisonString(value)}%22`

export const toTraceHref = (event: {
  traceId: string | null
  createdAt: string
}): string | null => {
  if (event.traceId === null) {
    return null
  }

  const href = buildDiscoverHref(
    config.get('logs.explorerBaseUrl'),
    toKuery('trace.id', event.traceId),
    event.createdAt
  )

  // A date that will not parse leaves nowhere to centre the search, and the
  // plain text it falls back to reads on the page as a link that has broken.
  if (href === null) {
    logger.warn(
      `No trace link for ${event.traceId}: fg-gas-backend sent no usable createdAt (${event.createdAt})`
    )
  }

  return href
}

/** A tenth of a second, the resolution the `1.2s` spelling reports in. */
const decisecond = 10

/** `5h 34m` past an hour, so a backoff reads as a duration rather than a sum. */
const toDuration = (ms: number): string => {
  if (ms < msPerSecond) {
    return `${ms}ms`
  }

  // Rounded before the unit is chosen, so 59.97s reads as a minute, not `60.0s`.
  const tenths = Math.round((ms * decisecond) / msPerSecond)

  if (tenths < secondsPerMinute * decisecond) {
    return `${(tenths / decisecond).toFixed(1)}s`
  }

  const whole = Math.round(ms / msPerSecond)
  const minutes = Math.floor(whole / secondsPerMinute)

  return minutes < minutesPerHour
    ? `${minutes}m ${whole % secondsPerMinute}s`
    : `${Math.floor(minutes / minutesPerHour)}h ${minutes % minutesPerHour}m`
}

/** The gap between two instants, or null when either will not parse. */
export const toGap = (from: string, to: string): string | null => {
  const started = toValidDate(from)
  const finished = toValidDate(to)

  return started === null || finished === null
    ? null
    : toDuration(Math.max(0, finished.getTime() - started.getTime()))
}

export const toEventHref = (key: EventKey): string =>
  `/dev-ops/events/${toUrlService(key.service)}/${encodeURIComponent(key.box)}/${encodeURIComponent(key.id)}`
