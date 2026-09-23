import type {
  EventDetail,
  EventKey,
  EventLastPurge,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import type {
  RedriveOutcome,
  RedriveResult
} from '../use-cases/redrive-event.use-case.ts'
import type {
  PurgeOutcome,
  PurgeResult
} from '../use-cases/purge-event.use-case.ts'
import { toAttemptCount } from './attempt-count.ts'
import type { AttemptCount } from './attempt-count.ts'
import { toBoxLabel, toServiceLabel } from './event-labels.ts'
import { toEventName } from './event-names.ts'
import type { EventName } from './event-names.ts'
import { toEventState } from './event-state.ts'
import type { EventState } from './event-state.ts'
import type { BadgeRole } from './event-formats.ts'
import {
  isAfter,
  toAbsolute,
  toAbsoluteInstant,
  toEventHref,
  toGap,
  toPreciseInstant,
  toPreciseOrNone,
  toSearchHref,
  toSearchTitle,
  toTraceHref,
  toValidDate
} from './event-formats.ts'
import type { PurgeFormError } from './purge-form.ts'
import {
  noteMaxLength,
  purgeReasons,
  toPurgeReasonLabel
} from './purge-form.ts'
import type { EditedFact } from './payload-edit.ts'
import {
  hasNoAttemptsSinceEdit,
  isEditedSinceAttempts,
  isEditedSinceRedrive,
  toEditedFact,
  toOriginalPayloadJson,
  toRedriveEditedNote
} from './payload-edit.ts'
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

interface PurgeReasonChoice {
  value: string
  label: string
  id: string
  checked: boolean
}

interface PurgeErrorLink {
  message: string
  /** The field the alert sends focus to; there is only ever one. */
  href: string
}

export interface PurgeConfirm {
  deletionText: string | null
  deletionInstant: string | null
  reasons: PurgeReasonChoice[]
  reasonMessage: string | null
  reasonDescribedBy: string
  note: string
  noteCount: string
  noteMax: number
  noteMessage: string | null
  noteInvalid: boolean
  noteDescribedBy: string
  error: PurgeErrorLink | null
}

/** "Purged", or "Previously purged" once the event has been redriven out of it. */
export interface PurgedFact {
  label: string
  reason: string
  by: string
  at: string
  atInstant: string | null
  note: string | null
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
  noAttemptsSinceEdit: boolean

  payloadJson: string | null
  originalPayloadJson: string | null
  editedFact: EditedFact | null

  canRedrive: boolean
  confirmRedrive: boolean
  redriveHref: string
  cancelHref: string
  redriveAction: string
  redrivePurgedNote: string | null
  redriveEditedNote: string | null

  canPurge: boolean
  purgeHref: string
  purgeAction: string
  purgeConfirm: PurgeConfirm | null
  purgedFact: PurgedFact | null

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

const toPayloadJson = (payload: unknown): string | null =>
  payload === undefined ? null : JSON.stringify(payload, null, 2)

/** Both writes leave their outcome here, under the redrive's key so a session in flight across a deploy still finds its message. */
export const redriveNoticeKey = 'redriveOutcome'

export const purgeFormKey = 'purgeForm'

export type EventWriteAction = 'redrive' | 'purge'

export interface EventNotice {
  outcome: RedriveResult['outcome'] | PurgeResult['outcome']
  /** Only a conflict reports one. */
  status: string | null
  /** A flash the redirect never delivered must not surface on another event. */
  page: string
  /** A session written before purge existed names none: it can only be a redrive. */
  action?: EventWriteAction
}

type BannerFor = (
  notice: EventNotice,
  expiresText: string | null
) => EventBanner

/** The status is the backend's own word for it, so it is quoted, not translated. */
const withStatus = (sentence: string, status: string | null): string =>
  status === null ? sentence : `${sentence} Its status is now ${status}.`

const cannotRedrive = "Not redriven — this event can't be redriven."

const redriveBanners: Record<RedriveOutcome, BannerFor> = {
  redriven: () => ({
    role: 'success',
    message:
      'Redrive requested — status is now Resubmitted; the poller will retry it. Refresh to follow the attempts.'
  }),
  conflict: ({ status }) => ({
    role: 'warning',
    message: withStatus(cannotRedrive, status)
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

const notDeadLettered = 'Not purged — this event is no longer dead-lettered.'

/** The date is read back off the event this page has just fetched, not taken from the answer to the write. */
const purged = (expiresText: string | null): string =>
  expiresText === null
    ? 'Purged.'
    : `Purged. It will be deleted on ${expiresText}.`

const purgeBanners: Record<PurgeOutcome, BannerFor> = {
  purged: (_notice, expiresText) => ({
    role: 'success',
    message: purged(expiresText)
  }),
  conflict: ({ status }) => ({
    role: 'warning',
    message: withStatus(notDeadLettered, status)
  }),
  'not-found': () => ({
    role: 'error',
    message:
      'Not purged — fg-gas-backend no longer has this event. Nothing has changed.'
  }),
  rejected: () => ({
    role: 'error',
    message:
      'Not purged — fg-gas-backend refused the request. Nothing has changed.'
  }),
  'timed-out': () => ({
    role: 'warning',
    message: 'Purge status unknown — refresh to check.'
  }),
  unavailable: () => ({
    role: 'error',
    message:
      'Not purged — fg-gas-backend could not be reached. Nothing has changed.'
  })
}

const banners: Record<string, Record<string, BannerFor>> = {
  redrive: redriveBanners,
  purge: purgeBanners
}

const bannersFor = (notice: EventNotice): Record<string, BannerFor> =>
  banners[notice.action ?? 'redrive'] ?? {}

/** The action and the outcome both come off a session flash, which another release may have written. */
const toOutcomeBanner = (
  notice: EventNotice,
  expiresText: string | null
): EventBanner | null =>
  bannersFor(notice)[notice.outcome]?.(notice, expiresText) ?? null

const toBanner = (
  key: EventKey,
  expiresText: string | null,
  notice?: EventNotice
): EventBanner | null => {
  if (notice === undefined || notice.page !== toEventHref(key)) {
    return null
  }

  return toOutcomeBanner(notice, expiresText)
}

export interface EventPageQuery {
  from?: string
  confirm?: string
}

const toShell = (
  key: EventKey,
  from: string,
  expiresText: string | null,
  notice?: EventNotice
) => ({
  from,
  backHref: toBackHref(from),
  banner: toBanner(key, expiresText, notice),
  redriveAction: `${toEventHref(key)}/redrive`,
  purgeAction: `${toEventHref(key)}/purge`
})

type ShellKey =
  | 'unavailable'
  | 'timedOut'
  | 'backHref'
  | 'from'
  | 'banner'
  | 'redriveAction'
  | 'purgeAction'

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
  noAttemptsSinceEdit: false,
  payloadJson: null,
  originalPayloadJson: null,
  editedFact: null,
  canRedrive: false,
  confirmRedrive: false,
  redriveHref: '',
  cancelHref: '',
  redrivePurgedNote: null,
  redriveEditedNote: null,
  canPurge: false,
  purgeHref: '',
  purgeConfirm: null,
  purgedFact: null,
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

/** A purged event keeps its Redrive: the backend's fence takes it back out of PURGED. */
const toRedrive = (
  state: EventState,
  key: EventKey,
  query: EventPageQuery,
  from: string
) => {
  const canRedrive = state.deadLetter || state.purged

  return {
    canRedrive,
    confirmRedrive: canRedrive && query.confirm === 'redrive',
    redriveHref: toSelfHref(key, from, ['confirm', 'redrive']),
    cancelHref: toSelfHref(key, from)
  }
}

const lastPurgeOf = (event: EventDetail): EventLastPurge | null =>
  event.lastPurge ?? null

/** An edit not yet retried is the fix for a broken payload, so the warning that it will fail again would contradict the edit note beside it. */
const toBrokenPayloadClause = (event: EventDetail): string =>
  isEditedSinceRedrive(event)
    ? '.'
    : '; if the payload is broken, it will fail again.'

/** Redriving a purged event reverses a decision somebody made, so the confirm names it first. */
const toRedrivePurgedNote = ({
  event,
  state
}: DetailContext): string | null => {
  const purge = lastPurgeOf(event)

  if (purge === null || !state.purged) {
    return null
  }

  return `It was purged as '${toPurgeReasonLabel(purge.reasonCode)}'${toBrokenPayloadClause(event)} Its deletion date is cleared.`
}

const noteId = 'purge-note'
const noteHintId = 'purge-note-hint'
const noteHelpId = 'purge-note-help'
const reasonHintId = 'purge-reason-hint'

const toReasonId = (value: string): string => `purge-reason-${value}`

const anchors: Record<PurgeFormError['field'], string> = {
  reason: `#${toReasonId(purgeReasons[0].value)}`,
  note: `#${noteId}`
}

const toReasonChoices = (chosen: string): PurgeReasonChoice[] =>
  purgeReasons.map(({ value, label }) => ({
    value,
    label,
    id: toReasonId(value),
    checked: value === chosen
  }))

const toNoteError = (error: PurgeFormError | null): PurgeFormError | null =>
  error !== null && error.field === 'note' ? error : null

/** A radio group takes no `aria-invalid`, so the message is written beside the choices and the fieldset is described by it. */
const toReasonField = (error: PurgeFormError | null) => ({
  reasonMessage:
    error !== null && error.field === 'reason' ? error.message : null,
  reasonDescribedBy: reasonHintId
})

/** `validator-hint` is hidden with `visibility`, which `aria-describedby` reads out all the same, so its id joins the description only while it shows. */
const toNoteField = (note: string, error: PurgeFormError | null) => {
  const message = error === null ? null : error.message

  return {
    note,
    noteCount: `${note.length} / ${noteMaxLength}`,
    noteMax: noteMaxLength,
    noteMessage: message,
    noteInvalid: message !== null,
    noteDescribedBy:
      message === null ? noteHelpId : `${noteHintId} ${noteHelpId}`
  }
}

/** What the operator sent back, so a rejected form is never retyped. */
export interface PurgeFormNotice {
  page: string
  reasonCode: string
  note: string
  error: PurgeFormError | null
}

const emptyPurgeForm: PurgeFormNotice = {
  page: '',
  reasonCode: '',
  note: '',
  error: null
}

const toPurgeConfirm = (
  deletionDate: string | null,
  form: PurgeFormNotice
): PurgeConfirm => ({
  deletionText: deletionDate === null ? null : toPreciseOrNone(deletionDate),
  deletionInstant: toAbsoluteInstant(deletionDate),
  reasons: toReasonChoices(form.reasonCode),
  ...toReasonField(form.error),
  ...toNoteField(form.note, toNoteError(form.error)),
  error:
    form.error === null
      ? null
      : { message: form.error.message, href: anchors[form.error.field] }
})

const purgeDeletionDateOf = (event: EventDetail): string | null =>
  event.purgeDeletionDate ?? null

const canPurgeEvent = ({ event, state }: DetailContext): boolean =>
  state.deadLetter && purgeDeletionDateOf(event) !== null

const toPurge = (
  context: DetailContext,
  key: EventKey,
  query: EventPageQuery,
  from: string,
  form: PurgeFormNotice
) => {
  const canPurge = canPurgeEvent(context)
  const open = canPurge && query.confirm === 'purge'

  return {
    canPurge,
    purgeHref: toSelfHref(key, from, ['confirm', 'purge']),
    purgeConfirm: open
      ? toPurgeConfirm(purgeDeletionDateOf(context.event), form)
      : null
  }
}

const toShownNote = (note: string | null): string | null =>
  note === null || note === '' ? null : note

/** The row keeps one purge, and keeps it through a redrive, so the label moves rather than the fact. */
const toPurgedFact = ({ event, state }: DetailContext): PurgedFact | null => {
  const purge = lastPurgeOf(event)

  if (purge === null) {
    return null
  }

  return {
    label: state.purged ? 'Purged' : 'Previously purged',
    reason: toPurgeReasonLabel(purge.reasonCode),
    by: purge.by,
    at: toPreciseOrNone(purge.at),
    atInstant: toAbsoluteInstant(purge.at),
    note: toShownNote(purge.note)
  }
}

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

/** Nothing has run on an edited payload yet, so the old failures say nothing about it. */
const mayBeFutile = ({ event, state }: DetailContext): boolean =>
  state.deadLetter &&
  failedTheSameWayTwice(event.attemptHistory) &&
  !isEditedSinceAttempts(event)

const toFutileWarning = (context: DetailContext): string | null => {
  const redrive = context.event.lastRedrive

  if (redrive === null || !mayBeFutile(context)) {
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
  attemptsBlock: toAttemptsBlock(context),
  noAttemptsSinceEdit: hasNoAttemptsSinceEdit(context.event)
})

const toDetail = (
  event: EventDetail,
  key: EventKey,
  query: EventPageQuery,
  from: string,
  form: PurgeFormNotice
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
    originalPayloadJson: toOriginalPayloadJson(event),
    editedFact: toEditedFact(event),
    ...toRedrive(state, key, query, from),
    redrivePurgedNote: toRedrivePurgedNote(context),
    redriveEditedNote: toRedriveEditedNote(event),
    ...toPurge(context, key, query, from, form),
    purgedFact: toPurgedFact(context),
    ...toLastRedriveDetail(event.lastRedrive),
    futileWarning: toFutileWarning(context),
    errorSearchHref: toErrorSearchHref(context, attempts)
  }
}

type EventDetailModel = ReturnType<typeof toDetail>

const toFoundDetail = (
  { outcome, event }: EventResult,
  key: EventKey,
  query: EventPageQuery,
  from: string,
  form: PurgeFormNotice
): EventDetailModel | null =>
  outcome === 'found' && event !== null
    ? toDetail(event, key, query, from, form)
    : null

const expiresTextOf = (detail: EventDetailModel | null): string | null =>
  detail === null ? null : detail.expiresText

/** A flash the redirect never delivered must not refill the form on another event. */
const toPurgeForm = (key: EventKey, form?: PurgeFormNotice): PurgeFormNotice =>
  form !== undefined && form.page === toEventHref(key) ? form : emptyPurgeForm

export const toEventPage = (
  result: EventResult,
  key: EventKey,
  query: EventPageQuery,
  notice?: EventNotice,
  form?: PurgeFormNotice
): EventPageModel => {
  const from = toSafeFrom(query.from)
  const detail = toFoundDetail(result, key, query, from, toPurgeForm(key, form))
  const shell = toShell(key, from, expiresTextOf(detail), notice)

  if (detail === null) {
    return {
      unavailable: true,
      timedOut: result.outcome === 'timed-out',
      ...shell,
      ...emptyDetail,
      eventId: key.id
    }
  }

  return { unavailable: false, timedOut: false, ...shell, ...detail }
}
