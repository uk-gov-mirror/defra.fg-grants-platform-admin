import type { EditOutcome } from '../use-cases/edit-payload.use-case.ts'
import type { PurgeOutcome } from '../use-cases/purge-event.use-case.ts'
import type { RedriveOutcome } from '../use-cases/redrive-event.use-case.ts'

export type EventWriteAction = 'redrive' | 'purge' | 'edit'

interface RedriveNotice {
  outcome: RedriveOutcome
  status: string | null
}

/** What a write left in the session for the page it returns to, spent on one render. */
export interface EventNotice {
  outcome: RedriveOutcome | PurgeOutcome | EditOutcome
  /** Only a conflict reports one. */
  status: string | null
  /** Only a refused edit reports one. */
  reason?: string | null
  /** A flash the redirect never delivered must not surface on another event. */
  page: string
  /** A session written before purge existed names none: it can only be a redrive. */
  action?: EventWriteAction
  /** Save and redrive: the redrive that followed a saved edit. */
  redrive?: RedriveNotice | null
}

export interface Banner {
  tone: 'info' | 'success' | 'warning' | 'danger'
  title: string
  text: string
  /** Saved but not retried: the banner offers the redrive. */
  redriveNow: boolean
}

export interface Toast {
  tone: 'success' | 'info'
  text: string
}

/** What the page has just read about the event, for a banner that says where it now stands. */
export interface BannerContext {
  /** GAS or CW: the service that owns the event. */
  service: string
  /** The attempts a redrive allows, from the event's own count. */
  allowed: number | null
  /** The event's deletion date, as a day. */
  deletionDay: string | null
  canRedrive: boolean
}

type BannerFor = (notice: EventNotice, context: BannerContext) => Banner

const banner = (
  tone: Banner['tone'],
  title: string,
  text: string,
  redriveNow = false
): Banner => ({ tone, title, text, redriveNow })

/** The status is the service's own word for it, so it is quoted, not translated. */
const nowIs = (status: string | null, cannot: string): string =>
  status === null
    ? `This event can’t be ${cannot} now. Nothing has changed.`
    : `This event is now ${status}, so it can’t be ${cannot}. Nothing has changed.`

const gone = ({ service }: BannerContext) =>
  `${service} no longer has this event. Nothing has changed.`

const unreachable = ({ service }: BannerContext) =>
  `${service} couldn’t be reached. Nothing has changed — try again in a moment.`

const retries = ({ allowed }: BannerContext) =>
  allowed === null
    ? 'The poller will pick it up shortly and retry it.'
    : `The poller will pick it up shortly and retry it up to ${allowed} times.`

const redriveBanners: Record<RedriveOutcome, BannerFor> = {
  redriven: (_notice, context) =>
    banner('success', 'Redriven.', retries(context)),
  conflict: ({ status }) =>
    banner('warning', 'Not redriven.', nowIs(status, 'redriven')),
  'not-found': (_notice, context) =>
    banner('danger', 'Not redriven.', gone(context)),
  'timed-out': (_notice, { service }) =>
    banner(
      'warning',
      'Redrive status unknown.',
      `${service} didn’t answer in time. Refresh to see whether the event was queued before redriving it again.`
    ),
  unavailable: (_notice, context) =>
    banner('danger', 'Not redriven.', unreachable(context))
}

const purgeBanners: Record<PurgeOutcome, BannerFor> = {
  purged: (_notice, { deletionDay }) =>
    banner(
      'info',
      'Purged.',
      deletionDay === null
        ? 'It won’t be retried. You can still redrive it.'
        : `It won’t be retried. You can still redrive it until ${deletionDay}.`
    ),
  conflict: ({ status }) =>
    banner('warning', 'Not purged.', nowIs(status, 'purged')),
  'not-found': (_notice, context) =>
    banner('danger', 'Not purged.', gone(context)),
  rejected: (_notice, { service }) =>
    banner(
      'danger',
      'Not purged.',
      `${service} refused the request. Nothing has changed.`
    ),
  'timed-out': (_notice, { service }) =>
    banner(
      'warning',
      'Purge status unknown.',
      `${service} didn’t answer in time. Refresh to see whether the event was purged before trying again.`
    ),
  unavailable: (_notice, context) =>
    banner('danger', 'Not purged.', unreachable(context))
}

const refusals: Record<string, string> = {
  TOO_LARGE: 'The payload is over 256 KiB once formatted.',
  UNCHANGED: 'The payload is the same as the one stored.',
  NOT_AN_OBJECT: 'The payload must be a JSON object.',
  DOLLAR_KEY: 'A key starts with $, which can’t be stored.'
}

/** A reason this release has no sentence for still reads as a refusal, never as an outage. */
const toRefusal = (reason: string | null | undefined, service: string) =>
  `${refusals[reason ?? ''] ?? `${service} refused the change.`} Nothing has changed.`

/** Save and redrive, where the save went through and the redrive didn't: the redrive's own banner, after the save. */
const savedThenRedrive = (
  redrive: RedriveNotice,
  context: BannerContext
): Banner => {
  if (redrive.outcome === 'redriven') {
    return banner(
      'success',
      'Payload saved and redriven.',
      'The poller will retry it with the edited payload.'
    )
  }

  const after = redriveBanners[redrive.outcome](
    { ...redrive, page: '' },
    context
  )

  return { ...after, title: `Payload saved. ${after.title}` }
}

/** A stale or timed-out save is the editor or the held changes again, never a flash, so it has no banner. */
const editBanners: Record<EditOutcome, BannerFor> = {
  saved: ({ redrive }, context) =>
    redrive
      ? savedThenRedrive(redrive, context)
      : banner(
          'info',
          'Payload saved.',
          'It hasn’t been retried yet — redrive it to process the edited payload.',
          context.canRedrive
        ),
  conflict: ({ status }) =>
    banner('warning', 'Not saved.', nowIs(status, 'edited')),
  refused: ({ reason }, { service }) =>
    banner('danger', 'Not saved.', toRefusal(reason, service)),
  'not-found': (_notice, context) =>
    banner('danger', 'Not saved.', gone(context)),
  stale: () =>
    banner(
      'danger',
      'Not saved — the payload changed while you were editing.',
      'Open the editor again to compare your change with the payload as it is now.'
    ),
  'timed-out': (_notice, { service }) =>
    banner(
      'warning',
      'Save status unknown.',
      `${service} didn’t answer in time. Refresh to see whether your change went through.`
    ),
  unavailable: (_notice, context) =>
    banner('danger', 'Not saved.', unreachable(context))
}

const banners: Partial<Record<string, Record<string, BannerFor>>> = {
  redrive: redriveBanners,
  purge: purgeBanners,
  edit: editBanners
}

const actionOf = (notice: EventNotice): EventWriteAction =>
  notice.action ?? 'redrive'

const bannerFor = (notice: EventNotice): BannerFor | undefined =>
  banners[actionOf(notice)]?.[notice.outcome]

/** The action and the outcome both come off a session flash, which another release may have written. */
export const toBanner = (
  notice: EventNotice | null,
  context: BannerContext
): Banner | null => {
  const banner = notice && bannerFor(notice)

  return banner ? banner(notice, context) : null
}

const savedToast = ({ redrive }: EventNotice): Toast => ({
  tone: 'success',
  text:
    redrive?.outcome === 'redriven'
      ? 'Payload saved and redriven'
      : 'Payload saved'
})

/** The outcome that went through, by action, and what its toast says. */
/** Partial: a flash another release wrote may name an action this one hasn't. */
const toasts: Partial<
  Record<string, [string, (notice: EventNotice) => Toast]>
> = {
  redrive: ['redriven', () => ({ tone: 'success', text: 'Event redriven' })],
  purge: ['purged', () => ({ tone: 'info', text: 'Event purged' })],
  edit: ['saved', savedToast]
}

const toastFor = (notice: EventNotice) => {
  const [outcome, toast] = toasts[actionOf(notice)] ?? []

  return toast && notice.outcome === outcome ? [toast(notice)] : []
}

/** A write that went through is also said in a toast. */
export const toToasts = (notice: EventNotice | null): Toast[] =>
  notice ? toastFor(notice) : []
