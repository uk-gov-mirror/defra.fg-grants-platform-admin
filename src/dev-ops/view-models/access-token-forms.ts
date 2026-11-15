import { statusCodes } from '../../common/status-codes.ts'
import type { KeepOld } from '../use-cases/access-tokens.use-case.ts'
import { toExpiryDay, toUkDate, toUkEndOfDay } from './access-token-dates.ts'

export type DialogKind = 'new' | 'rotate' | 'expiry' | 'revoke' | 'delete'

export const dialogKinds: DialogKind[] = [
  'new',
  'rotate',
  'expiry',
  'revoke',
  'delete'
]

/** What a dialog says about the whole write rather than one field: a refusal. */
export interface FormRefusal {
  title: string
  text: string
}

/**
 * A dialog a POST answers with, open again: what was typed, what was wrong
 * with it by field, and a refusal for the whole form. The raw token is never
 * part of it.
 */
export interface OpenDialog {
  kind: DialogKind
  /** Null for New token, which belongs to no token yet. */
  tokenId: string | null
  values: Record<string, string>
  errors: Record<string, string>
  refusal?: FormRefusal | null
  /** New token only: how many active tokens the client already has, said once before issuing another. */
  active?: number
}

/** A dialog handed back: 400 with what to fix, 200 with a warning that isn't an error. */
export const formStatus = {
  refused: statusCodes.badRequest,
  warned: statusCodes.ok
}

export type Parsed<T> =
  | { ok: true; value: T }
  | { ok: false; errors: Record<string, string> }

const ok = <T>(value: T): Parsed<T> => ({ ok: true, value })

const refused = <T>(field: string, message: string): Parsed<T> => ({
  ok: false,
  errors: { [field]: message }
})

export const expiryChoices = [
  { value: 'never', text: 'Never' },
  { value: '30', text: '30 days' },
  { value: '90', text: '90 days' },
  { value: '365', text: '1 year' },
  { value: 'custom', text: 'Custom date' }
] as const

export type ExpiryChoice = (typeof expiryChoices)[number]['value']

export const expiryChoiceValues = expiryChoices.map(({ value }) => value)

export const defaultExpiry: ExpiryChoice = '90'

export interface ExpiryInput {
  expiry: ExpiryChoice
  /** `yyyy-mm-dd`, read only for a custom expiry. */
  date: string
  /** The expiry the token has now, as the service lists it: a custom date left on its day keeps it to the second. */
  current?: string
}

export const missingDate = 'Enter an expiry date like 4 Feb 2027.'

export const pastDate = 'Pick a date after today.'

const presetDays: Record<string, number> = { 30: 30, 90: 90, 365: 365 }

const datePattern = /^\d{4}-\d{2}-\d{2}$/

const isRealDate = (date: string): boolean => {
  const midnight = new Date(`${date}T00:00:00.000Z`)

  return (
    datePattern.test(date) &&
    !Number.isNaN(midnight.getTime()) &&
    midnight.toISOString().startsWith(date)
  )
}

/**
 * A date left on the day the token already expires keeps its exact instant,
 * which must still be ahead: an untouched date never brings a stopped token
 * back.
 */
const isCurrentDay = (date: string, current: string): boolean =>
  current !== '' && toUkDate(new Date(current)) === date

const keepCurrent = (current: string, now: Date): Parsed<string> =>
  new Date(current) > now ? ok(current) : refused('date', pastDate)

/** A new date ends at 23:59:59 UK time, and has to be after today, as the date box's `min` says. */
const parseNewDate = (date: string, now: Date): Parsed<string> => {
  if (!isRealDate(date)) {
    return refused('date', missingDate)
  }

  return date > toUkDate(now)
    ? ok(toUkEndOfDay(date).toISOString())
    : refused('date', pastDate)
}

const parseCustomDate = (
  date: string,
  now: Date,
  current = ''
): Parsed<string> =>
  isCurrentDay(date, current)
    ? keepCurrent(current, now)
    : parseNewDate(date, now)

/** That many calendar days after a `yyyy-mm-dd`. */
const addDays = (date: string, days: number): string => {
  const day = new Date(`${date}T00:00:00.000Z`)
  day.setUTCDate(day.getUTCDate() + days)

  return day.toISOString().slice(0, 10)
}

/** The end of the UK day that many calendar days after today's UK date. */
const toPresetEnd = (days: number, now: Date): Date =>
  toUkEndOfDay(addDays(toUkDate(now), days))

/** Null is never. A preset's day counts from today; it and a custom date end at 23:59:59 UK time. */
export const parseExpiry = (
  { expiry, date, current }: ExpiryInput,
  now: Date
): Parsed<string | null> => {
  if (expiry === 'never') {
    return ok(null)
  }

  return expiry === 'custom'
    ? parseCustomDate(date.trim(), now, current)
    : ok(toPresetEnd(presetDays[expiry], now).toISOString())
}

/** Where each choice lands, said under it: it doesn't change as the choice does, so the server draws it. */
const toChoiceHint = (choice: ExpiryChoice, now: Date): string | null => {
  if (choice === 'never') {
    return 'Not recommended for a service.'
  }

  return choice === 'custom'
    ? null
    : `Ends ${toExpiryDay(toPresetEnd(presetDays[choice], now))}.`
}

/** The day after today in the UK: the first a custom date can be. */
export const toFirstCustomDate = (now: Date): string =>
  addDays(toUkDate(now), 1)

export interface ExpiryGroup {
  /** The radio group's id; its options are `<id>-1` to `<id>-5`. */
  id: string
  dateId: string
  options: {
    value: string
    text: string
    hint: string | null
    checked: boolean
  }[]
  date: string
  min: string
  error: string | null
  dateError: string | null
}

/** The first radio: where an error on the whole group takes focus. */
export const toFirstOptionId = (groupId: string): string => `${groupId}-1`

export const toExpiryGroup = (
  id: string,
  input: ExpiryInput,
  errors: Record<string, string>,
  now: Date
): ExpiryGroup => ({
  id,
  dateId: `${id}-date`,
  options: expiryChoices.map((choice) => ({
    ...choice,
    hint: toChoiceHint(choice.value, now),
    checked: choice.value === input.expiry
  })),
  date: input.date,
  min: toFirstCustomDate(now),
  error: errors.expiry ?? null,
  dateError: errors.date ?? null
})

export const clientIdMax = 64

/** The services' name rule, which the routes' paths check too. */
export const clientNamePattern = /^[a-z0-9-]{1,64}$/

const clientNameRule = 'Use lowercase letters, digits and hyphens only.'

export const parseClientId = (value: string): Parsed<string> => {
  const clientId = value.trim()

  if (clientId.length > clientIdMax) {
    return refused('clientId', `Use ${clientIdMax} characters or fewer.`)
  }

  return clientNamePattern.test(clientId)
    ? ok(clientId)
    : refused('clientId', clientNameRule)
}

export interface NewTokenInput extends ExpiryInput {
  clientId: string
  /** The client the dialog last warned about: issuing for it again goes ahead. */
  confirmFor: string
}

const errorsOf = <T>(parsed: Parsed<T>): Record<string, string> =>
  parsed.ok ? {} : parsed.errors

/** Both fields are checked, so one submit shows every mistake. */
export const parseNewToken = (
  input: NewTokenInput,
  now: Date
): Parsed<{ clientId: string; expiresAt: string | null }> => {
  const clientId = parseClientId(input.clientId)
  const expiresAt = parseExpiry(input, now)

  return clientId.ok && expiresAt.ok
    ? ok({ clientId: clientId.value, expiresAt: expiresAt.value })
    : { ok: false, errors: { ...errorsOf(clientId), ...errorsOf(expiresAt) } }
}

/** A past date the service refused: on the date box for a custom date, else on the choices. */
const invalidExpiry = (expiry: string): Record<string, string> =>
  expiry === 'custom' ? { date: pastDate } : { expiry: pastDate }

/**
 * The refusals of a new token that a different answer in the dialog can
 * fix. The client ones come from a race: the page's list was read before
 * someone else created or emptied the client.
 */
const issueFieldErrors: Record<
  string,
  (expiry: string) => Record<string, string>
> = {
  API_CLIENT_INVALID_NAME: () => ({ clientId: clientNameRule }),
  API_CLIENT_EXISTS: () => ({
    clientId:
      'Someone has just created this client. Issue again to add a token to it.'
  }),
  API_CLIENT_NOT_FOUND: () => ({
    clientId:
      'This client has just lost its last token. Issue again to make it afresh.'
  }),
  API_TOKEN_INVALID_EXPIRY: invalidExpiry
}

export const toIssueFieldErrors = (
  errorCode: string | null,
  expiry: string
): Record<string, string> | null =>
  issueFieldErrors[errorCode ?? '']?.(expiry) ?? null

export const toExpiryFieldErrors = (
  errorCode: string | null,
  expiry: string
): Record<string, string> | null =>
  errorCode === 'API_TOKEN_INVALID_EXPIRY' ? invalidExpiry(expiry) : null

/** Typed exactly, but for the spaces a paste brings along. */
export const confirmsRevoke = (typed: string, clientId: string): boolean =>
  typed.trim() === clientId

export const revokeMismatch = 'That doesn’t match.'

export const keepOldChoices: {
  value: KeepOld
  text: string
  hint: string
}[] = [
  {
    value: 'none',
    text: 'Expire immediately',
    hint: 'The caller fails until it has the new token.'
  },
  {
    value: '24h',
    text: 'Keep valid until end of tomorrow',
    hint: 'Enough for a same-day redeploy of the caller.'
  },
  {
    value: '7d',
    text: 'Keep valid for 7 days, to end of day',
    hint: 'For callers released on a slower cycle.'
  }
]

export const keepOldValues = keepOldChoices.map(({ value }) => value)

export const defaultKeepOld: KeepOld = '24h'

/**
 * The token a request is made with can't be ended at once, so that choice is
 * offered off, with the reason. A refused rotation comes back on the choice
 * it was sent with, unless that is the one that is off.
 */
export const toKeepOldOptions = (
  inUse: { reason: string } | null,
  sent: string | undefined
) => {
  const chosen =
    inUse && sent === 'none' ? defaultKeepOld : (sent ?? defaultKeepOld)

  return keepOldChoices.map((choice) => ({
    ...choice,
    checked: choice.value === chosen,
    disabled: inUse !== null && choice.value === 'none',
    reason: inUse !== null && choice.value === 'none' ? inUse.reason : null
  }))
}
