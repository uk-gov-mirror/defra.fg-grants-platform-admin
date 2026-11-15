import Joi from 'joi'

import { formatIn, partsOf } from './zoned-clock.ts'
import type { Zone } from './zoned-clock.ts'
import { toFittingBack } from './record-filters.ts'

/** Where the dialog saves the setting. */
export const timesPath = '/dev-ops/times'

/** The account menu's Times setting, kept in this cookie like the theme. */
export const timesCookieName = 'dev-ops-times'

export const timesChoices = ['utc', 'uk'] as const

export type TimesChoice = (typeof timesChoices)[number]

export interface Times {
  choice: TimesChoice
  zone: Zone
  label: string
  hint: string
}

const settings: Record<TimesChoice, Times> = {
  utc: {
    choice: 'utc',
    zone: 'UTC',
    label: 'UTC',
    hint: 'The same as the logs, queues and the other services.'
  },
  uk: {
    choice: 'uk',
    zone: 'Europe/London',
    label: 'UK time',
    hint: 'GMT in winter, BST in summer.'
  }
}

const isChoice = (value: unknown): value is TimesChoice =>
  timesChoices.includes(value as TimesChoice)

/** What the cookie says, or UTC: the default, and what a missing or unknown value reads as. */
export const toTimes = (cookie: unknown): Times =>
  settings[isChoice(cookie) ? cookie : 'utc']

/** The setting's options, in the order the dialog lists them. */
export const toTimesOptions = (times: Times) =>
  timesChoices.map((choice) => ({
    value: choice,
    text: settings[choice].label,
    hint: settings[choice].hint,
    checked: choice === times.choice
  }))

const dateTimeOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
}

/** `en-GB`, which names UK time GMT or BST where `en-US` writes `GMT+1`. */
const zoneNameOptions: Intl.DateTimeFormatOptions = { timeZoneName: 'short' }

/** A time as a page writes it in a `<time>`. */
export interface TimeText {
  /** The instant, in UTC, for the `datetime` attribute. */
  datetime: string
  /** `13 Oct 2026 15:04`: no zone, which the person chose once. */
  text: string
  /** `13 Oct 2026 15:04:00 BST`: the seconds, and the zone's name on that date. */
  title: string
}

/** A no-break space after the day, so `13 Oct` never breaks apart in a narrow column, as the design system's Time. */
const keepDayWithMonth = (text: string) =>
  text.replace(/^(\d{1,2}) (?=[A-Za-z])/, '$1\u00a0')

/** Day-first from parts, with `en-US` months because `en-GB` writes `Sept`. */
export const toTime = (instant: Date, times: Times): TimeText => {
  const parts = partsOf(formatIn(times.zone, 'en-US', dateTimeOptions), instant)
  const zone = partsOf(formatIn(times.zone, 'en-GB', zoneNameOptions), instant)
  const day = `${parts.day} ${parts.month} ${parts.year}`
  const clock = `${parts.hour}:${parts.minute}`

  return {
    datetime: instant.toISOString().replace('.000', ''),
    text: keepDayWithMonth(`${day} ${clock}`),
    title: `${day} ${clock}:${parts.second} ${zone.timeZoneName}`
  }
}

/** The setting a request carries in its cookie. */
export const timesOf = (request: { state?: Record<string, unknown> }): Times =>
  toTimes(request.state?.[timesCookieName])

/** The address that opens the Times dialog over a page, so a browser without the script can open it too. */
export const timesOpenParam = 'times'
const timesOpenValue = 'open'

/** The keys the shell adds to any Dev Ops page's address: every page's query schema takes them. */
export const shellQuery = {
  [timesOpenParam]: Joi.string().valid(timesOpenValue)
}

/** A page's own params: the shell's keys are the shell's to read. */
export const withoutShellKeys = <Q extends object>(query: Q): Q =>
  Object.fromEntries(
    Object.entries(query).filter(([key]) => !Object.hasOwn(shellQuery, key))
  ) as Q

export interface TimesDialog {
  /** The account menu's Times: this page, asking for the dialog. */
  href: string
  /** Whether this page was asked for with the dialog open. */
  open: boolean
  /** This page without the dialog: its close button without a script, and where saving goes back to. */
  closeHref: string
  /** Where the dialog's form saves the choice, carrying the page to go back to. */
  action: string
}

const withoutOpen = (url: URL): string => {
  const params = new URLSearchParams(url.search)
  params.delete(timesOpenParam)
  const search = params.toString()

  return `${url.pathname}${search ? `?${search}` : ''}`
}

const withOpen = (page: string): string =>
  `${page}${page.includes('?') ? '&' : '?'}${timesOpenParam}=${timesOpenValue}`

/**
 * A page drawn in answer to a form has no address of its own to open the
 * dialog over, so it opens over the page the form was sent from.
 */
export const toTimesDialog = (
  url: URL | undefined,
  from: string
): TimesDialog => {
  const page = toFittingBack(url ? withoutOpen(url) : from)

  return {
    href: withOpen(page),
    open: url?.searchParams.get(timesOpenParam) === timesOpenValue,
    closeHref: page,
    action: `${timesPath}?back=${encodeURIComponent(page)}`
  }
}
