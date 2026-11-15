import { statusCodes } from '../../common/status-codes.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import type {
  PayloadEditStep,
  PayloadSubmission
} from '../use-cases/edit-payload-step.ts'
import { toSubmittedStep } from '../use-cases/edit-payload-step.ts'
import type {
  EventDetail,
  EventKey,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import { toAttemptCount } from './attempt-count.ts'
import {
  devOpsPath,
  isEventList,
  toBackBucket,
  toListAt,
  toListLabel
} from './bucket-nav.ts'
import { toTone } from './catalogue-presentation.ts'
import type { Tone } from './catalogue-presentation.ts'
import { toUrlService } from './event-address.ts'
import { toAttempts } from './event-attempts.ts'
import type { AttemptsModel } from './event-attempts.ts'
import { toBanner, toToasts } from './event-banners.ts'
import type { Banner, EventNotice, Toast } from './event-banners.ts'
import {
  ownListPath,
  serviceNames,
  timeOf,
  toOwnList,
  toSelfHref
} from './event-context.ts'
import type { EventContext } from './event-context.ts'
import {
  canPurgeEvent,
  canRedriveEvent,
  toPurgeDialog,
  toRedriveDialog
} from './event-dialogs.ts'
import type {
  PurgeDialog,
  PurgeFormNotice,
  RedriveDialog
} from './event-dialogs.ts'
import { toFacts } from './event-facts.ts'
import type { Fact } from './event-facts.ts'
import { toEventHref } from './event-formats.ts'
import { toPayload } from './event-payload.ts'
import type { HeldSave, PayloadModel, SaveError } from './event-payload.ts'
import { toEventState } from './event-state.ts'
import { canEditEvent } from './payload-edit.ts'
import { toBackLabel } from './record-filters.ts'
import { toDayTime } from './times.ts'
import type { Times } from './times.ts'

export type { HeldSave, PurgeFormNotice }

const unsafeInPath = /\/\/|\\/

/** A page is opened from a list or a record's page of this admin, and goes back to it. */
const isOwnPage = (from: string): boolean => from.startsWith(`${devOpsPath}/`)

/** Open-redirect guard: only a list's or a record's own path and query, and `//` or `\` could leave it. */
export const toSafeFrom = (from: string | undefined | null): string =>
  typeof from === 'string' && isOwnPage(from) && !unsafeInPath.test(from)
    ? from
    : ''

/** Both writes leave their outcome here, under the redrive's key so a session in flight across a deploy still finds its message. */
export const redriveNoticeKey = 'redriveOutcome'

export const purgeFormKey = 'purgeForm'

/**
 * The page can hold an editor with a revision in it. `no-cache`, hapi's
 * default, still lets Back show a copy from before a save, whose revision is
 * spent; `no-store` makes Back read the event again.
 */
export const eventPageCache = { otherwise: 'no-store' }

/** Where a write's redirect lands, so the banner it takes focus to is in view. */
export const eventBannerId = 'event-banner'

export interface EventPageQuery {
  back?: string
  confirm?: string
  edit?: string
}

/** What a request hands the page beside the event it reads. */
export interface EventPageAsks {
  query: EventPageQuery
  notice?: EventNotice
  form?: PurgeFormNotice
  edit?: PayloadEditStep
  held?: HeldSave
  saveError?: SaveError
  /** Posted changes the page couldn't check, because the event couldn't be read: shown, so nothing typed is lost. */
  kept?: { text: string; note?: string }
}

export interface EventPageInput extends EventPageAsks {
  result: EventResult
  key: EventKey
  times: Times
  catalogue: Catalogue | null
  /** The production environment, where every dialog that changes something says so. */
  prod: boolean
}

export interface MissingEvent {
  state: 'unavailable' | 'timed-out' | 'not-found'
  title: string
  text: string
}

export interface EventPageModel {
  pageTitle: string
  navActive: string | null
  eventHref: string
  /** This very page again, keeping where it was opened from. */
  retryHref: string
  back: { href: string; text: string }
  missing: MissingEvent | null
  kept: { text: string; note: string | null } | null
  title: string
  titleMono: boolean
  status: { text: string; tone: Tone }
  eventId: string
  purgeHref: string | null
  redriveHref: string | null
  banner: (Banner & { redriveHref: string | null }) | null
  toasts: Toast[]
  facts: Fact[]
  attempts: AttemptsModel | null
  payload: PayloadModel | null
  redriveDialog: RedriveDialog | null
  purgeDialog: PurgeDialog | null
}

/** The production environment's label, as CDP gives it. */
export const isProduction = (environment: string): boolean =>
  environment === 'prod'

/** Back where it came from: a record by its name, any event list as Events. */
const toBack = (
  catalogue: Catalogue | null,
  key: EventKey,
  from: string
): { href: string; text: string } => {
  const list = toListAt(catalogue, from)

  return {
    href: from || `${devOpsPath}/${ownListPath(key)}`,
    text: toBackLabel(from, {
      listLabel: list && !isEventList(list) ? toListLabel(list) : null,
      ownListLabel: 'Events'
    })
  }
}

const toStatus = ({ event, key }: EventContext) => ({
  text: event.statusLabel,
  tone: toTone(
    { id: `${toUrlService(key.service)}.${key.box}` },
    'status',
    event.status,
    event.statusRole
  )
})

const noticeFor = (context: EventContext, notice?: EventNotice) =>
  notice?.page === context.eventHref ? notice : null

const actionHref = (
  context: EventContext,
  can: boolean,
  confirm: string
): string | null => (can ? toSelfHref(context, ['confirm', confirm]) : null)

const deletionDayOf = ({ event, times }: EventContext): string | null =>
  timeOf(event.expiresAt, times, toDayTime)?.text ?? null

const allowedOf = ({ count }: EventContext): number | null =>
  count?.allowed ?? null

const toBannerModel = (context: EventContext, notice: EventNotice | null) => {
  const banner = toBanner(notice, {
    service: context.service,
    allowed: allowedOf(context),
    deletionDay: deletionDayOf(context),
    canRedrive: canRedriveEvent(context)
  })

  return (
    banner && {
      ...banner,
      redriveHref: actionHref(context, banner.redriveNow, 'redrive')
    }
  )
}

const navActiveOf = (
  catalogue: Catalogue | null,
  key: EventKey,
  from: string
): string | null =>
  (toBackBucket(catalogue, from) ?? toOwnList(catalogue, key))?.id ?? null

const toContext = (
  input: EventPageInput,
  event: EventDetail
): EventContext => ({
  event,
  key: input.key,
  state: toEventState(event),
  count: toAttemptCount(event.attempts),
  times: input.times,
  service: serviceNames[input.key.service],
  from: toSafeFrom(input.query.back),
  eventHref: toEventHref(input.key),
  ownList: toOwnList(input.catalogue, input.key)
})

const toFound = (input: EventPageInput, event: EventDetail): EventPageModel => {
  const context = toContext(input, event)
  const notice = noticeFor(context, input.notice)
  const title = event.eventType ?? event.eventId

  return {
    pageTitle: `${title} – ${context.service} event`,
    navActive: navActiveOf(input.catalogue, input.key, context.from),
    eventHref: context.eventHref,
    retryHref: toSelfHref(context),
    back: toBack(input.catalogue, input.key, context.from),
    missing: null,
    kept: null,
    title,
    titleMono: event.eventType === null,
    status: toStatus(context),
    eventId: event.eventId,
    purgeHref: actionHref(context, canPurgeEvent(context), 'purge'),
    redriveHref: actionHref(context, canRedriveEvent(context), 'redrive'),
    banner: toBannerModel(context, notice),
    toasts: toToasts(notice),
    facts: toFacts(context),
    attempts: toAttempts(context),
    payload: toPayload(context, input),
    redriveDialog: toRedriveDialog(context, input),
    purgeDialog: toPurgeDialog(context, input)
  }
}

const missingCopy = (
  service: string
): Record<MissingEvent['state'], Omit<MissingEvent, 'state'>> => ({
  'timed-out': {
    title: 'This event couldn’t be loaded.',
    text: `${service} timed out waiting for it. Nothing has changed — try again in a moment.`
  },
  unavailable: {
    title: 'This event couldn’t be loaded.',
    text: `${service} couldn’t be reached. Nothing has changed — try again in a moment.`
  },
  'not-found': {
    title: `No ${service} event has this ID.`,
    text: 'It may have passed its deletion date, or the ID may be from the other service. Check the ID, or search for it from Events.'
  }
})

const missingStateOf = ({ outcome }: EventResult): MissingEvent['state'] =>
  outcome === 'found' ? 'unavailable' : outcome

const toKept = ({ kept }: EventPageAsks) =>
  kept ? { text: kept.text, note: kept.note || null } : null

/** The event's address names it, so the page keeps its header with the reason in place of the event. */
const toMissing = (input: EventPageInput): EventPageModel => {
  const { key, catalogue } = input
  const from = toSafeFrom(input.query.back)
  const service = serviceNames[key.service]
  const state = missingStateOf(input.result)

  return {
    pageTitle: `${state === 'not-found' ? 'Not found – ' : ''}${service} event ${key.id}`,
    navActive: navActiveOf(catalogue, key, from),
    eventHref: toEventHref(key),
    retryHref: toSelfHref({ key, from }),
    back: toBack(catalogue, key, from),
    missing: { state, ...missingCopy(service)[state] },
    kept: toKept(input),
    title: key.id,
    titleMono: true,
    status: { text: '', tone: 'neutral' },
    eventId: key.id,
    purgeHref: null,
    redriveHref: null,
    banner: null,
    toasts: [],
    facts: [],
    attempts: null,
    payload: null,
    redriveDialog: null,
    purgeDialog: null
  }
}

export const toEventPage = (input: EventPageInput): EventPageModel =>
  input.result.event === null
    ? toMissing(input)
    : toFound(input, input.result.event)

const missingCodes: Record<MissingEvent['state'], number> = {
  'not-found': statusCodes.notFound,
  'timed-out': statusCodes.gatewayTimeout,
  unavailable: statusCodes.serviceUnavailable
}

/** An event the service couldn't give is no page of it: the status says why. */
export const toEventStatusCode = ({ missing }: EventPageModel): number =>
  missing ? missingCodes[missing.state] : statusCodes.ok

/** An event that can no longer be edited says so, as the save would have. */
const toConflict = (key: EventKey, event: EventDetail): EventNotice => ({
  outcome: 'conflict',
  status: event.statusLabel,
  page: toEventHref(key),
  action: 'edit'
})

/** Held changes stand in for the editor; otherwise the posted text goes back into it, or on to the review. */
const toStep = (
  event: EventDetail,
  submission: PayloadSubmission,
  { held }: Pick<EventPageAsks, 'held'>
) => (held ? {} : { edit: toSubmittedStep(event, submission) })

/**
 * What a review or a save hands the page: the editor, the review or the held
 * changes, built from the text the form posted; the text itself when the
 * event couldn't be read to check it against.
 */
export const toSubmissionAsks = (
  read: EventResult,
  key: EventKey,
  submission: PayloadSubmission,
  extras: Pick<EventPageAsks, 'held' | 'saveError'> = {}
): EventPageAsks => {
  const query = { back: toSafeFrom(submission.from) }
  const { event } = read

  if (event === null) {
    return { query, kept: submission }
  }

  if (!canEditEvent(event, toEventState(event))) {
    return { query, notice: toConflict(key, event) }
  }

  return { query, ...toStep(event, submission, extras), ...extras }
}
