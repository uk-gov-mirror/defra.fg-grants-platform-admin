import Joi from 'joi'

import { formatDate, formatRange } from '../views/components/nunjucks.ts'
import {
  fromZonedInput,
  hoursPerDay,
  minutesPerHour,
  msPerMinute,
  toValidDate,
  toZonedInput
} from './event-formats.ts'
import type { Zone, ZonedEdge } from './event-formats.ts'
import { present } from './list-filters.ts'

export interface TimeRangeQuery {
  from?: string
  to?: string
  range?: string
}

const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/** A calendar day, as the range chip's calendar and its From/To boxes send it. */
const isoDay = /^\d{4}-\d{2}-\d{2}$/

/** A box may or may not carry seconds; `fromZonedInput` takes the full wall clock. */
const toWallClock = (value: string, seconds: string | undefined): string =>
  `${value}${seconds ? '' : ':00'}`

const toUtcDate = (value: string, seconds: string | undefined): Date =>
  new Date(`${toWallClock(value, seconds)}Z`)

/** `2026-02-30` silently rolls forward; an impossible month throws. Check both. */
const isRealDatetime = (
  value: string,
  seconds: string | undefined
): boolean => {
  const date = toUtcDate(value, seconds)

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().startsWith(seconds ? value : `${value}:00`)
  )
}

const isRealDay = (value: string): boolean =>
  isRealDatetime(`${value}T00:00`, undefined)

/** Anything not shaped like a day or a wall clock is an instant, checked where it is read. */
const isWallClockOk = (value: string): boolean => {
  const match = datetimeLocal.exec(value)

  return match === null || isRealDatetime(value, match[1])
}

const isRealBox = (value: string): boolean =>
  isoDay.test(value) ? isRealDay(value) : isWallClockOk(value)

const rangeBox = Joi.string()
  .allow('')
  .custom((value: string, helpers) =>
    isRealBox(value) ? value : helpers.error('any.invalid')
  )

export const timeRangeFilters = {
  from: rangeBox,
  to: rangeBox,
  range: Joi.string().allow('')
}

/** A day starts at its first moment and ends at its last, on the clock the person reads times by. */
const dayEdges: Record<ZonedEdge, string> = {
  earliest: 'T00:00:00',
  latest: 'T23:59:59'
}

const toClockInstant = (value: string, edge: ZonedEdge, zone: Zone): string => {
  const match = datetimeLocal.exec(value)

  return match === null || !isRealDatetime(value, match[1])
    ? value
    : fromZonedInput(toWallClock(value, match[1]), edge, zone).toISOString()
}

/** The last moment of a day is its last millisecond, as GAS compares `to` inclusively. */
const lastMs: Record<ZonedEdge, number> = { earliest: 0, latest: 999 }

const toDayEdge = (value: string, edge: ZonedEdge, zone: Zone): string =>
  new Date(
    fromZonedInput(`${value}${dayEdges[edge]}`, edge, zone).getTime() +
      lastMs[edge]
  ).toISOString()

/** What a box means: a day, or a wall clock, read in the person's zone; an instant is taken as it is. */
const toInstant = (
  value: string | undefined,
  edge: ZonedEdge,
  zone: Zone
): string | undefined => {
  if (!value) {
    return undefined
  }

  return isoDay.test(value)
    ? toDayEdge(value, edge, zone)
    : toClockInstant(value, edge, zone)
}

/** The window as instants, whether it came from a quick range or the calendar. */
export const toRangeInstants = (
  { from, to }: TimeRangeQuery,
  zone: Zone
): Pick<TimeRangeQuery, 'from' | 'to'> => ({
  ...present('from', toInstant(from, 'earliest', zone)),
  ...present('to', toInstant(to, 'latest', zone))
})

/** The design system's quick ranges. */
const quickRanges: { key: string; text: string; minutes: number }[] = [
  { key: '1h', text: 'Last hour', minutes: minutesPerHour },
  { key: '24h', text: 'Last 24 hours', minutes: hoursPerDay * minutesPerHour },
  {
    key: '7d',
    text: 'Last 7 days',
    minutes: 7 * hoursPerDay * minutesPerHour
  },
  {
    key: '30d',
    text: 'Last 30 days',
    minutes: 30 * hoursPerDay * minutesPerHour
  }
]

export const anyTime = 'Any time'

const toActiveRange = ({ from, to, range }: TimeRangeQuery) =>
  from && !to ? quickRanges.find(({ key }) => key === range) : undefined

const dayOfInstant = (value: string, zone: Zone): string | undefined => {
  const date = toValidDate(value)

  return date ? toZonedInput(date, zone).slice(0, 10) : undefined
}

/** The day a box falls on in the zone: a wall clock is the zone's already; a value that is no instant is no day. */
const toDay = (value: string | undefined, zone: Zone): string | undefined => {
  if (!value) {
    return undefined
  }

  return isoDay.test(value) || datetimeLocal.test(value)
    ? value.slice(0, 10)
    : dayOfInstant(value, zone)
}

export interface RangeChoice {
  text: string
  href: string
  checked: boolean
}

export interface RangeChip {
  /** The chip's text, which the applied tag repeats. */
  text: string
  /** Nothing chosen, so no tag. */
  isSet: boolean
  start: string | undefined
  end: string | undefined
  presets: RangeChoice[]
  /** Today in the zone: nothing later can have been kept. */
  max: string
}

const toOneSided = (start: string | undefined, end: string | undefined) => {
  if (start) {
    return `From ${formatDate(start)}`
  }

  return end ? `Until ${formatDate(end)}` : anyTime
}

/** "3–9 Nov 2026", "From 3 Nov 2026", "Until 9 Nov 2026", a quick range's name or "Any time". */
const toRangeText = (
  query: TimeRangeQuery,
  start: string | undefined,
  end: string | undefined
): string => {
  const quick = toActiveRange(query)

  if (quick) {
    return quick.text
  }

  return start && end ? formatRange(start, end) : toOneSided(start, end)
}

/**
 * A list's time filter. `toHref` gives the list's own link with another
 * window, so every choice keeps the other filters.
 */
export const toRangeChip = (
  query: TimeRangeQuery,
  toHref: (window: TimeRangeQuery) => string,
  now: Date,
  zone: Zone
): RangeChip => {
  const quick = toActiveRange(query)
  const start = quick ? undefined : toDay(query.from, zone)
  const end = quick ? undefined : toDay(query.to, zone)
  const isSet = Boolean(query.from ?? query.to)

  return {
    text: toRangeText(query, start, end),
    isSet,
    start,
    end,
    presets: [
      { text: anyTime, href: toHref({}), checked: !isSet },
      ...quickRanges.map(({ key, text, minutes }) => ({
        text,
        href: toHref({
          from: new Date(now.getTime() - minutes * msPerMinute).toISOString(),
          range: key
        }),
        checked: quick?.key === key
      }))
    ],
    max: toZonedInput(now, zone).slice(0, 10)
  }
}
