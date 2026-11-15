import Joi from 'joi'

import {
  fromZonedInput,
  hoursPerDay,
  minutesPerHour,
  msPerMinute,
  toValidDate,
  toZonedInput
} from './event-formats.ts'
import type { Zone, ZonedEdge } from './event-formats.ts'
import { present, toFields, toFilterHref } from './list-filters.ts'
import type { FilterField, FilterKeys } from './list-filters.ts'

export interface TimeRangeQuery {
  from?: string
  to?: string
  range?: string
}

/** The list the menu sits on: where its links go, what else they carry, and how a preset is described. */
export interface TimeRangeList<Q extends TimeRangeQuery> {
  basePath: string
  filterKeys: FilterKeys<Q>
  /** Ends just before the preset's key, as "Events from the last". */
  presetTitlePrefix: string
}

interface TimeRangePreset {
  key: string
  label: string
  href: string
  title: string
  active: boolean
}

export interface TimeRange {
  label: string
  title: string
  active: boolean
  presets: TimeRangePreset[]
  anyTimeHref: string
  anyTimeActive: boolean
  action: string
  hiddenFields: FilterField[]
  fromInput: string
  toInput: string
}

const rangeKeys = ['from', 'to', 'range'] as const

const rangeKeySet = new Set<string>(rangeKeys)

const datetimeLocal = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

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

const rangeBox = Joi.string()
  .allow('')
  .custom((value: string, helpers) => {
    const match = datetimeLocal.exec(value)

    return match === null || isRealDatetime(value, match[1])
      ? value
      : helpers.error('any.invalid')
  })

export const timeRangeFilters = {
  from: rangeBox,
  to: rangeBox,
  range: Joi.string().allow('')
}

/**
 * What a Custom box means. The digits carry no zone and the page fills them in
 * UK time, so they are read in UK time: typing 09:00 means 09:00 as the
 * operator means it.
 */
const toInstant = (
  value: string | undefined,
  edge: ZonedEdge,
  zone: Zone
): string | undefined => {
  if (!value) {
    return undefined
  }

  const match = datetimeLocal.exec(value)

  return match === null || !isRealDatetime(value, match[1])
    ? value
    : fromZonedInput(toWallClock(value, match[1]), edge, zone).toISOString()
}

/** The window as instants, whether it came from a preset link or the Custom boxes. */
export const toRangeInstants = (
  { from, to }: TimeRangeQuery,
  zone: Zone
): Pick<TimeRangeQuery, 'from' | 'to'> => ({
  ...present('from', toInstant(from, 'earliest', zone)),
  ...present('to', toInstant(to, 'latest', zone))
})

/** Every filter the list holds but the window, which the menu sets itself. */
const otherKeys = <Q extends TimeRangeQuery>(
  list: TimeRangeList<Q>
): FilterKeys<Q> => list.filterKeys.filter((key) => !rangeKeySet.has(key))

const toHref = <Q extends TimeRangeQuery>(
  list: TimeRangeList<Q>,
  query: Q
): string =>
  toFilterHref(list.basePath, [...otherKeys(list), ...rangeKeys], query)

/**
 * `datetime-local` carries no zone, so the digits in the Custom boxes have to
 * be the ones the page displays. Writing the UTC wall clock into a control the
 * browser reads as local was an hour out at both edges of a range under BST.
 */
const toRangeInput = (value: string | undefined, zone: Zone): string => {
  if (!value) {
    return ''
  }

  const date = toValidDate(value)

  return date === null ? value : toZonedInput(date, zone)
}

const timeRangePresets: { key: string; minutes: number }[] = [
  { key: '15m', minutes: 15 },
  { key: '1h', minutes: minutesPerHour },
  { key: '6h', minutes: 6 * minutesPerHour },
  { key: '24h', minutes: hoursPerDay * minutesPerHour },
  { key: '7d', minutes: 7 * hoursPerDay * minutesPerHour },
  { key: '30d', minutes: 30 * hoursPerDay * minutesPerHour }
]

const presetLabel = (key: string) => `Last ${key}`

const toActivePreset = ({ from, to, range }: TimeRangeQuery) =>
  from && !to
    ? timeRangePresets.find((preset) => preset.key === range)
    : undefined

const toPresets = <Q extends TimeRangeQuery>(
  list: TimeRangeList<Q>,
  query: Q,
  now: Date
): TimeRangePreset[] => {
  const active = toActivePreset(query)

  return timeRangePresets.map(({ key, minutes }) => ({
    key,
    label: presetLabel(key),
    title: `${list.presetTitlePrefix} ${key}`,
    active: active?.key === key,
    href: toHref(list, {
      ...query,
      from: new Date(now.getTime() - minutes * msPerMinute).toISOString(),
      to: undefined,
      range: key
    })
  }))
}

const toAbsoluteMinute = (value: string, zone: Zone): string => {
  const date = toValidDate(value)

  return date === null
    ? value
    : toZonedInput(date, zone)
        .slice(0, 'yyyy-mm-ddThh:mm'.length)
        .replace('T', ' ')
}

const toAbsoluteRangeLabel = (
  zone: Zone,
  from?: string,
  to?: string
): string => {
  const start = from ? toAbsoluteMinute(from, zone) : 'earliest'
  const end = to ? toAbsoluteMinute(to, zone) : 'now'

  return `${start} – ${end}`
}

const toTimeRangeLabel = (query: TimeRangeQuery, zone: Zone): string => {
  const { from, to } = query

  if (!from && !to) {
    return 'All'
  }

  const preset = toActivePreset(query)

  return preset ? presetLabel(preset.key) : toAbsoluteRangeLabel(zone, from, to)
}

export const toTimeRange = <Q extends TimeRangeQuery>(
  list: TimeRangeList<Q>,
  query: Q,
  now: Date,
  zone: Zone
): TimeRange => {
  const label = toTimeRangeLabel(query, zone)

  return {
    label,
    title: `Time range: ${label}`,
    active: Boolean(query.from ?? query.to),
    presets: toPresets(list, query, now),
    anyTimeHref: toHref(list, {
      ...query,
      from: undefined,
      to: undefined,
      range: undefined
    }),
    anyTimeActive: !query.from && !query.to,
    action: list.basePath,
    hiddenFields: toFields(query, otherKeys(list)),
    fromInput: toRangeInput(query.from, zone),
    toInput: toRangeInput(query.to, zone)
  }
}
