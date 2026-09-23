import { config } from '../../common/config.ts'
import { logger } from '../../common/logger.ts'
import type { EventKey } from '../repositories/events.repository.ts'
import { toEventKeyPath } from '../repositories/events.repository.ts'

/** Named by meaning; the classes live in status-badge/template.njk, where Tailwind can see them. */
export type BadgeRole = 'neutral' | 'info' | 'warning' | 'success' | 'error'

/**
 * `Europe/London` rather than a fixed offset, so the display follows the
 * clocks by itself and nothing needs correcting twice a year. No date is
 * rendered with a zone suffix; the instant behind each one is carried by the
 * `<time datetime>` attribute, which stays UTC.
 */
const displayZone = 'Europe/London'

/** The wall clock alone: `10:16:05`. */
const clockFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: displayZone,
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

/** `1 Sep 08:18`: day-first from parts, with `en-US` months because `en-GB` writes `Sept`. */
const dayClockFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: displayZone,
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
})

const preciseFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: displayZone,
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

/** `2026-09-16T09:00:00`: the digits a `datetime-local` box carries. */
const inputFormat = new Intl.DateTimeFormat('en-CA', {
  timeZone: displayZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
})

const partsOf = (
  format: Intl.DateTimeFormat,
  date: Date
): Record<string, string> =>
  Object.fromEntries(
    format
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )

/** An instant as the display zone's wall clock, `yyyy-mm-ddThh:mm:ss`; whole seconds, which is all a range box carries. */
export const toZonedInput = (date: Date): string => {
  const parts = partsOf(inputFormat, date)

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

/**
 * Measured, never assumed: BST and GMT differ by an hour and the switch moves.
 * Read at the whole second, because `toZonedInput` spells no milliseconds —
 * subtracting like from like leaves the offset exact for any instant.
 */
const zoneOffsetMs = (instant: Date): number => {
  const whole = instant.getTime() - instant.getUTCMilliseconds()

  return Date.parse(`${toZonedInput(new Date(whole))}Z`) - whole
}

const msPerSecond = 1000
const secondsPerMinute = 60
export const minutesPerHour = 60
export const hoursPerDay = 24
export const msPerMinute = msPerSecond * secondsPerMinute
const msPerDay = msPerMinute * minutesPerHour * hoursPerDay

/** Far enough either side of a wall clock to read the offset past any clock change near it. */
const offsetProbeMs = msPerDay / 2

/** Which end of an hour the clocks hand out twice a given box should take. */
export type ZonedEdge = 'earliest' | 'latest'

/**
 * The instants that really are this wall clock: two on the autumn morning the
 * hour repeats, none in the spring hour that never happens, one otherwise.
 */
const instantsFor = (wallClockMs: number): Date[] => {
  const offsets = [-offsetProbeMs, offsetProbeMs].map((shift) =>
    zoneOffsetMs(new Date(wallClockMs + shift))
  )

  return [...new Set(offsets)]
    .map((offset) => new Date(wallClockMs - offset))
    .filter(
      (instant) => zoneOffsetMs(instant) === wallClockMs - instant.getTime()
    )
}

/**
 * The reverse of `toZonedInput`, taking back the same `yyyy-mm-ddThh:mm:ss`
 * digits it hands out. An ambiguous hour widens the range rather than dropping
 * events from it: the `from` box takes the first time the clock reads that,
 * the `to` box the second. An hour that never happened has no instant to take,
 * so the wall clock is read against the offset in force *before* the change,
 * which lands it just after — 01:30 on a spring morning becomes 02:30.
 */
export const fromZonedInput = (wallClock: string, edge: ZonedEdge): Date => {
  const wallClockMs = Date.parse(`${wallClock}Z`)
  const instants = instantsFor(wallClockMs)

  if (instants.length === 0) {
    const provisional = new Date(
      wallClockMs - zoneOffsetMs(new Date(wallClockMs))
    )

    return new Date(wallClockMs - zoneOffsetMs(provisional))
  }

  const pick = edge === 'earliest' ? Math.min : Math.max

  return new Date(pick(...instants.map((instant) => instant.getTime())))
}

const toRelative = (from: Date, now: Date): string => {
  const seconds = Math.max(
    0,
    Math.round((now.getTime() - from.getTime()) / msPerSecond)
  )

  if (seconds < secondsPerMinute) {
    return `${seconds}s ago`
  }

  const minutes = Math.round(seconds / secondsPerMinute)

  if (minutes < minutesPerHour) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / minutesPerHour)

  return hours < hoursPerDay
    ? `${hours}h ${minutes % minutesPerHour}m ago`
    : `${Math.floor(hours / hoursPerDay)}d ago`
}

export interface Timestamp {
  text: string
  /** UTC, for a `datetime` attribute; never rendered. */
  instant: string
  /** UK time, so what is hovered or announced matches what is on screen. */
  precise: string
}

export const none = '—'

/** Intl and `toISOString` throw on an unparseable date. */
export const toValidDate = (value: string): Date | null => {
  const date = new Date(value)

  return Number.isNaN(date.getTime()) ? null : date
}

/** The instant a developer pastes into a log query: `2026-06-16T10:00:00Z`. */
export const toAbsolute = (value: string): string | null =>
  toValidDate(value)?.toISOString().replace('.000', '') ?? null

/** Past a day the date replaces the seconds, so an old row cannot read as this morning. */
export const toClock = (date: Date, now: Date): string => {
  if (now.getTime() - date.getTime() <= msPerDay) {
    return clockFormat.format(date)
  }

  const parts = partsOf(dayClockFormat, date)

  return `${parts.day} ${parts.month} ${parts.hour}:${parts.minute}`
}

/** Never shortened by age: the detail page is read against logs. */
export const toPreciseInstant = (date: Date): string => {
  const parts = partsOf(preciseFormat, date)
  // Milliseconds do not move with the zone, so they come off the instant.
  const ms = String(date.getUTCMilliseconds()).padStart(3, '0')

  return `${parts.day} ${parts.month} ${parts.year} ${parts.hour}:${parts.minute}:${parts.second}.${ms}`
}

export const toAbsoluteInstant = (at: string | null): string | null =>
  at === null ? null : toAbsolute(at)

export const toPreciseOrNone = (value: string | null): string => {
  if (value === null) {
    return none
  }

  const date = toValidDate(value)

  return date === null ? none : toPreciseInstant(date)
}

/** Compared as instants: two ISO spellings of one moment need not sort as strings. */
export const isAfter = (later: string, earlier: string): boolean => {
  const a = toValidDate(later)
  const b = toValidDate(earlier)

  return a !== null && b !== null && a.getTime() > b.getTime()
}

/** Relative on the page, the same instant spelled out beside it. */
export const toTimestamp = (value: string | null, now: Date): Timestamp => {
  const date = value === null ? null : toValidDate(value)

  if (date === null) {
    return { text: '-', instant: '', precise: '' }
  }

  return {
    text: toRelative(date, now),
    instant: date.toISOString().replace('.000', ''),
    precise: toPreciseInstant(date)
  }
}

/** No other filter, so a Dead letter page does not hide the rest; audit rows only find audit rows when included. */
export const toSearchHref = (value: string, includeAudit = false): string =>
  `/dev-ops/events?q=${encodeURIComponent(value)}${includeAudit ? '&audit=include' : ''}`

export const toSearchTitle = (value: string, noun: string): string =>
  `${value}\nShow every event with this ${noun}`

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
  `/dev-ops/events/${toEventKeyPath(key)}`
