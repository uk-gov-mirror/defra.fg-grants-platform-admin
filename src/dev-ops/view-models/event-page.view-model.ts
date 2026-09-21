import type {
  EventDetail,
  EventKey,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import type { RedriveResult } from '../use-cases/redrive-event.use-case.ts'
import { toAttemptCount } from './attempt-count.ts'
import type { AttemptCount } from './attempt-count.ts'
import { toBoxLabel, toServiceLabel } from './event-labels.ts'
import { toEventName } from './event-names.ts'
import type { EventName } from './event-names.ts'
import { toEventState } from './event-state.ts'
import type { EventState } from './event-state.ts'
import type { BadgeRole } from './event-formats.ts'
import {
  none,
  toAbsolute,
  toEventHref,
  toGap,
  toPreciseInstant,
  toSearchHref,
  toSearchTitle,
  toTraceHref,
  toValidDate
} from './event-formats.ts'
import { toStackFrames } from './stack-frames.ts'

type AttemptRole = Extract<BadgeRole, 'warning' | 'error'>

interface AttemptEntry {
  number: string
  role: AttemptRole
  precise: string
  delta: string | null
  name: string
  message: string
  stack: string | null
  instant: string | null
}

interface AttemptSuccess {
  number: string
  precise: string | null
  delta: string | null
  instant: string | null
}

type AttemptsBlock =
  | 'timeline'
  | 'redriven'
  | 'predated'
  | 'predatedCompleted'
  | 'notYet'

interface EventBanner {
  role: 'success' | 'warning' | 'error'
  message: string
}

export interface EventPageModel {
  unavailable: boolean
  timedOut: boolean
  backHref: string
  from: string
  banner: EventBanner | null

  eventName: EventName | null
  type: string
  eventId: string

  status: string
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
  attempts: AttemptCount | null

  serviceLabel: string
  boxLabel: string
  targetTopic: string | null
  segregationRef: string | null
  segregationRefHref: string | null
  segregationRefTitle: string | null
  traceId: string | null
  traceHref: string | null
  expiresText: string | null
  expiresInstant: string | null

  isInbox: boolean

  lastResubmissionDate: string | null
  lastResubmissionInstant: string | null
  resubmittedSinceLastAttempt: boolean

  errorName: string | null
  errorMessage: string | null
  errorAt: string | null
  errorAtInstant: string | null
  errorRole: AttemptRole

  attemptHistory: AttemptEntry[]
  attemptSuccess: AttemptSuccess | null
  attemptsBlock: AttemptsBlock

  payloadJson: string | null

  canRedrive: boolean
  confirmRedrive: boolean
  redriveHref: string
  cancelHref: string
  redriveAction: string

  lastRedriveInstant: string | null
  lastRedriveText: string | null
  lastRedriveBy: string | null
  futileWarning: string | null
  errorSearchHref: string | null
}

/** Open-redirect guard: `//` would make this a protocol-relative url. */
export const toSafeFrom = (from: string | undefined | null): string =>
  typeof from === 'string' && from.startsWith('?') && !from.includes('//')
    ? from
    : ''

const toBackHref = (from: string): string => `/dev-ops/events${from}`

const toSelfHref = (
  key: EventKey,
  from: string,
  extra?: [string, string]
): string => {
  const params = new URLSearchParams()

  if (from !== '') {
    params.set('from', from)
  }

  if (extra) {
    params.set(extra[0], extra[1])
  }

  return params.size ? `${toEventHref(key)}?${params}` : toEventHref(key)
}

const toAbsoluteInstant = (at: string | null): string | null =>
  at === null ? null : toAbsolute(at)

const toPreciseOrNone = (value: string | null): string => {
  if (value === null) {
    return none
  }

  const date = toValidDate(value)

  return date === null ? none : toPreciseInstant(date)
}

const toPayloadJson = (payload: unknown): string | null =>
  payload === undefined ? null : JSON.stringify(payload, null, 2)

export const redriveNoticeKey = 'redriveOutcome'

export interface RedriveNotice extends RedriveResult {
  /** A flash the redirect never delivered must not surface on another event. */
  page: string
}

const notDeadLettered = 'Not redriven — this event is no longer dead-lettered.'

const banners: Record<
  RedriveNotice['outcome'],
  (notice: RedriveNotice) => EventBanner
> = {
  redriven: () => ({
    role: 'success',
    message:
      'Redrive requested — status is now Resubmitted; the poller will retry it. Refresh to follow the attempts.'
  }),
  conflict: ({ status }) => ({
    role: 'warning',
    message:
      status === null
        ? notDeadLettered
        : `${notDeadLettered} Its status is now ${status}.`
  }),
  'not-found': () => ({
    role: 'error',
    message:
      'Not redriven — fg-gas-backend no longer has this event. Nothing has changed.'
  }),
  'timed-out': () => ({
    role: 'warning',
    message:
      'Redrive status unknown — CW-BE did not answer in time. Refresh to check the event.'
  }),
  unavailable: () => ({
    role: 'error',
    message:
      'Not redriven — fg-gas-backend could not be reached. Nothing has changed.'
  })
}

/** An outcome with no banner is a session written by an older release. */
const toOutcomeBanner = (notice: RedriveNotice): EventBanner | null =>
  banners[notice.outcome]?.(notice) ?? null

const toBanner = (
  key: EventKey,
  notice?: RedriveNotice
): EventBanner | null => {
  if (notice === undefined || notice.page !== toEventHref(key)) {
    return null
  }

  return toOutcomeBanner(notice)
}

export interface EventPageQuery {
  from?: string
  confirm?: string
}

const toShell = (
  key: EventKey,
  query: EventPageQuery,
  notice?: RedriveNotice
) => {
  const from = toSafeFrom(query.from)

  return {
    from,
    backHref: toBackHref(from),
    banner: toBanner(key, notice),
    redriveAction: `${toEventHref(key)}/redrive`
  }
}

type ShellKey =
  | 'unavailable'
  | 'timedOut'
  | 'backHref'
  | 'from'
  | 'banner'
  | 'redriveAction'

const emptyDetail: Omit<EventPageModel, ShellKey> = {
  eventName: null,
  type: '',
  eventId: '',
  status: '',
  statusLabel: '',
  statusRole: 'neutral',
  statusRetrying: false,
  attempts: null,
  serviceLabel: '',
  boxLabel: '',
  targetTopic: null,
  segregationRef: null,
  segregationRefHref: null,
  segregationRefTitle: null,
  traceId: null,
  traceHref: null,
  expiresText: null,
  expiresInstant: null,
  isInbox: true,
  lastResubmissionDate: null,
  lastResubmissionInstant: null,
  resubmittedSinceLastAttempt: false,
  errorName: null,
  errorMessage: null,
  errorAt: null,
  errorAtInstant: null,
  errorRole: 'warning',
  attemptHistory: [],
  attemptSuccess: null,
  attemptsBlock: 'notYet',
  payloadJson: null,
  canRedrive: false,
  confirmRedrive: false,
  redriveHref: '',
  cancelHref: '',
  lastRedriveInstant: null,
  lastRedriveText: null,
  lastRedriveBy: null,
  futileWarning: null,
  errorSearchHref: null
}

interface DetailContext {
  event: EventDetail
  state: EventState
  count: AttemptCount | null
}

/**
 * GAS counts failures only, so the success is one more; a legacy row with no
 * history counted the success already.
 */
const toCompletedAttempts = ({ event, count }: DetailContext): number => {
  const recorded = event.attemptHistory.length

  if (count === null) {
    return recorded + 1
  }

  return recorded > 0 || count.made === 0 ? count.made + 1 : count.made
}

const toAttemptsShown = (context: DetailContext): AttemptCount | null =>
  context.state.completed && context.count !== null
    ? { ...context.count, made: toCompletedAttempts(context) }
    : context.count

const toStatus = (context: DetailContext) => ({
  status: context.event.status,
  statusLabel: context.event.statusLabel,
  statusRole: context.event.statusRole,
  statusRetrying: context.event.statusRetrying,
  attempts: toAttemptsShown(context)
})

const isAuditRecord = (event: EventDetail): boolean => event.type === 'audit'

const toSegregationRef = (event: EventDetail) => {
  const segregationRef = event.segregationRef ?? null

  return segregationRef === null
    ? {
        segregationRef,
        segregationRefHref: null,
        segregationRefTitle: null
      }
    : {
        segregationRef,
        segregationRefHref: toSearchHref(segregationRef, isAuditRecord(event)),
        segregationRefTitle: toSearchTitle(segregationRef, 'segregation ref')
      }
}

/** Compared as instants: two ISO spellings of one moment need not sort as strings. */
const isAfter = (later: string, earlier: string): boolean => {
  const a = toValidDate(later)
  const b = toValidDate(earlier)

  return a !== null && b !== null && a.getTime() > b.getTime()
}

const lastKnownAt = (attempts: EventDetail['attemptHistory']): string | null =>
  attempts.findLast((attempt) => attempt.at !== null)?.at ?? null

const toResubmission = ({ event, state }: DetailContext) => {
  const at = event.lastResubmissionDate

  if (at === null || !state.waiting) {
    return {
      lastResubmissionDate: null,
      lastResubmissionInstant: null,
      resubmittedSinceLastAttempt: false
    }
  }

  const last = lastKnownAt(event.attemptHistory)

  return {
    lastResubmissionDate: toPreciseOrNone(at),
    lastResubmissionInstant: toAbsoluteInstant(at),
    resubmittedSinceLastAttempt: last === null || isAfter(at, last)
  }
}

const noFailure = {
  errorName: null,
  errorMessage: null,
  errorAt: null,
  errorAtInstant: null
}

const toFailure = (error: EventDetail['lastError']) =>
  error === null
    ? noFailure
    : {
        errorName: error.name,
        errorMessage: error.message,
        errorAt: error.at === null ? null : toPreciseOrNone(error.at),
        errorAtInstant: toAbsoluteInstant(error.at)
      }

/** A redrive newer than creation starts the clock again for the attempt after it. */
const redriveAt = (event: EventDetail): string | null =>
  event.lastRedrive?.at ?? null

const toFirstAnchor = (event: EventDetail, at: string): string => {
  const redrive = redriveAt(event)

  return redrive !== null &&
    isAfter(redrive, event.createdAt) &&
    !isAfter(redrive, at)
    ? redrive
    : event.createdAt
}

const toFirstGap = (event: EventDetail, at: string): string | null => {
  const gap = toGap(toFirstAnchor(event, at), at)

  return gap === null ? null : `after ${gap}`
}

const toLaterGap = (previous: string | null, at: string): string | null => {
  const gap = previous === null ? null : toGap(previous, at)

  return gap === null ? null : `+${gap}`
}

/** Unknown instants get no gap, and the next one is measured from the last known. */
const toAttemptDelta = (
  event: EventDetail,
  before: EventDetail['attemptHistory'],
  at: string | null
): string | null => {
  if (at === null) {
    return null
  }

  return before.length === 0
    ? toFirstGap(event, at)
    : toLaterGap(lastKnownAt(before), at)
}

/** The backend caps an attempt's message at 512 and `lastError` at 1024. */
const toAttemptMessage = (
  message: string,
  isLast: boolean,
  lastError: EventDetail['lastError']
): string =>
  isLast && lastError !== null && lastError.message.startsWith(message)
    ? lastError.message
    : message

/** Only a dead letter's newest failure ended it; every other one was retried. */
const toAttemptRole = (
  state: EventState,
  index: number,
  count: number
): AttemptRole =>
  state.deadLetter && index === count - 1 ? 'error' : 'warning'

/** The last error's role, when no timeline says which attempt it was. */
const toLastErrorRole = (state: EventState): AttemptRole =>
  state.deadLetter ? 'error' : 'warning'

const toAttemptHistory = ({ event, state }: DetailContext): AttemptEntry[] =>
  event.attemptHistory.map((attempt, index, all) => ({
    number: `#${index + 1}`,
    role: toAttemptRole(state, index, all.length),
    precise: toPreciseOrNone(attempt.at),
    delta: toAttemptDelta(event, all.slice(0, index), attempt.at),
    name: attempt.name,
    message: toAttemptMessage(
      attempt.message,
      index === all.length - 1,
      event.lastError
    ),
    stack: toStackFrames(attempt.name, attempt.message, attempt.stack),
    instant: toAbsoluteInstant(attempt.at)
  }))

const undated = { precise: null, delta: null, instant: null }

const toSuccessInstant = (event: EventDetail, at: string) => {
  const instant = toAbsolute(at)

  return instant === null
    ? undated
    : {
        precise: toPreciseOrNone(at),
        delta: toAttemptDelta(event, event.attemptHistory, at),
        instant
      }
}

const toAttemptSuccess = (context: DetailContext): AttemptSuccess | null => {
  const { event, state } = context

  if (!state.completed) {
    return null
  }

  return {
    number: `#${toCompletedAttempts(context)}`,
    ...(event.completionDate === null
      ? undated
      : toSuccessInstant(event, event.completionDate))
  }
}

/** Only a row still in play, at a count of 0 with no error, is untried. */
const madeAny = (count: AttemptCount | null): boolean => (count?.made ?? 0) > 0

const isUntried = ({ event, state, count }: DetailContext): boolean =>
  !state.completed &&
  !state.deadLetter &&
  !madeAny(count) &&
  event.lastError === null

/**
 * The first rule that applies picks the block; an old row predates the history.
 * A completed row at a count of 0 is a first-time success, not an old one.
 */
const attemptsBlockRules: [
  AttemptsBlock,
  (context: DetailContext) => boolean
][] = [
  ['timeline', ({ event }) => event.attemptHistory.length > 0],
  ['redriven', ({ state }) => state.redrivenSinceAttempts],
  [
    'predatedCompleted',
    ({ state, count }) => state.completed && madeAny(count)
  ],
  ['timeline', ({ state }) => state.completed],
  ['notYet', isUntried]
]

const toAttemptsBlock = (context: DetailContext): AttemptsBlock =>
  attemptsBlockRules.find(([, applies]) => applies(context))?.[0] ?? 'predated'

const toRedrive = (
  isDeadLetter: boolean,
  key: EventKey,
  query: EventPageQuery,
  from: string
) => ({
  canRedrive: isDeadLetter,
  confirmRedrive: isDeadLetter && query.confirm === 'redrive',
  redriveHref: toSelfHref(key, from, ['confirm', 'redrive']),
  cancelHref: toSelfHref(key, from)
})

const toLastRedriveDetail = (lastRedrive: EventDetail['lastRedrive']) => {
  if (lastRedrive === null) {
    return {
      lastRedriveInstant: null,
      lastRedriveText: null,
      lastRedriveBy: null
    }
  }

  return {
    lastRedriveInstant: toAbsoluteInstant(lastRedrive.at),
    lastRedriveText: toPreciseOrNone(lastRedrive.at),
    lastRedriveBy: lastRedrive.by
  }
}

const failedTheSameWayTwice = (
  history: EventDetail['attemptHistory']
): boolean => {
  const [previous, last] = history.slice(-2)

  return history.length >= 2 && previous.message === last.message
}

const toFutileWarning = ({ event, state }: DetailContext): string | null => {
  const redrive = event.lastRedrive

  if (
    redrive === null ||
    !state.deadLetter ||
    !failedTheSameWayTwice(event.attemptHistory)
  ) {
    return null
  }

  return (
    `The last two attempts since the redrive (by ${redrive.by}, ${toPreciseOrNone(redrive.at)}) failed with the identical error — ` +
    'redriving again is unlikely to succeed until the underlying cause is fixed.'
  )
}

/** They correspond when one is a truncation of the other; a different failure gets no link. */
const showsLastError = (attempts: AttemptEntry[], message: string): boolean => {
  const shown = attempts.at(-1)?.message

  return (
    shown === undefined ||
    shown.startsWith(message) ||
    message.startsWith(shown)
  )
}

const toDeadLetterErrorMessage = ({
  event,
  state
}: DetailContext): string | null =>
  state.deadLetter ? (event.lastError?.message ?? null) : null

const toErrorSearchHref = (
  context: DetailContext,
  attempts: AttemptEntry[]
): string | null => {
  const message = toDeadLetterErrorMessage(context)

  if (!message || !showsLastError(attempts, message)) {
    return null
  }

  // The error alone: where else a failure happened is no question about status.
  // `audit` is a scope rather than a filter — an audit row finds none without it.
  const params = new URLSearchParams({ error: message })

  if (isAuditRecord(context.event)) {
    params.set('audit', 'include')
  }

  return `/dev-ops/events?${params}`
}

const toTrace = (event: EventDetail) => {
  const traceId = event.traceId ?? null

  return {
    traceId,
    traceHref: toTraceHref({ traceId, createdAt: event.createdAt })
  }
}

/** A dashed "Deletion date" would read as a date this page failed to find. */
const toExpiry = (event: EventDetail) => {
  const expiresAt = event.expiresAt ?? null
  const date = expiresAt === null ? null : toValidDate(expiresAt)

  return date === null
    ? { expiresText: null, expiresInstant: null }
    : {
        expiresText: toPreciseInstant(date),
        expiresInstant: toAbsoluteInstant(expiresAt)
      }
}

const toAttempts = (context: DetailContext, attempts: AttemptEntry[]) => ({
  ...toResubmission(context),
  attemptHistory: attempts,
  attemptSuccess: toAttemptSuccess(context),
  attemptsBlock: toAttemptsBlock(context)
})

const toDetail = (
  event: EventDetail,
  key: EventKey,
  query: EventPageQuery,
  from: string
) => {
  const state = toEventState(event)
  const context = { event, state, count: toAttemptCount(event.attempts) }
  const attempts = toAttemptHistory(context)

  return {
    eventName: toEventName(event.type),
    type: event.type,
    eventId: event.eventId,
    ...toStatus(context),
    serviceLabel: toServiceLabel(event.service),
    boxLabel: toBoxLabel(event.box),
    targetTopic: event.targetTopic,
    ...toSegregationRef(event),
    ...toTrace(event),
    ...toExpiry(event),
    isInbox: key.box === 'inbox',
    ...toFailure(event.lastError),
    errorRole: toLastErrorRole(state),
    ...toAttempts(context, attempts),
    payloadJson: toPayloadJson(event.payload),
    ...toRedrive(state.deadLetter, key, query, from),
    ...toLastRedriveDetail(event.lastRedrive),
    futileWarning: toFutileWarning(context),
    errorSearchHref: toErrorSearchHref(context, attempts)
  }
}

export const toEventPage = (
  { outcome, event }: EventResult,
  key: EventKey,
  query: EventPageQuery,
  notice?: RedriveNotice
): EventPageModel => {
  const shell = toShell(key, query, notice)

  if (outcome !== 'found' || event === null) {
    return {
      unavailable: true,
      timedOut: outcome === 'timed-out',
      ...shell,
      ...emptyDetail,
      eventId: key.id
    }
  }

  return {
    unavailable: false,
    timedOut: false,
    ...shell,
    ...toDetail(event, key, query, shell.from)
  }
}
