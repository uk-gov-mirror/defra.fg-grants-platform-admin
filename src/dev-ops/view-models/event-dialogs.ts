import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { allSame, timeOf, toSelfHref } from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { toEventHref } from './event-formats.ts'
import type { PurgeFormError } from './purge-form.ts'
import { noteMaxLength, purgeReasons } from './purge-form.ts'
import {
  canEditEvent,
  isEditedSinceAttempts,
  isEditedSinceRedrive
} from './payload-edit.ts'
import { toDayTime } from './times.ts'
import type { TimeText } from './times.ts'

export const redriveDialogId = 'redrive-dialog'

export const purgeDialogId = 'purge-dialog'

/** What the operator sent back, so a rejected form is never retyped. */
export interface PurgeFormNotice {
  page: string
  reasonCode: string
  note: string
  error: PurgeFormError | null
}

interface ShortName {
  name: string
  id: string
}

interface DialogBase {
  id: string
  open: boolean
  closeHref: string
  action: string
  back: string
  /** Production: the dialog says so first. */
  prod: boolean
  short: ShortName
}

interface Byline {
  by: string
  at: TimeText | null
}

export interface RedriveDialog extends DialogBase {
  service: string
  allowed: number | null
  futile: { count: number; editHref: string | null } | null
  edited: Byline | null
  purged: Byline | null
}

export interface PurgeDialog extends DialogBase {
  deletionDay: TimeText | null
  reasons: { value: string; text: string; checked: boolean }[]
  reasonError: string | null
  note: string
  noteError: string | null
  noteMax: number
}

export interface DialogAsks {
  query: { confirm?: string }
  prod: boolean
  form?: PurgeFormNotice
}

/** The first 8 and the last 4 of the id, as the dialogs name the event. */
const shortId = (id: string): string =>
  id.length > 12 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id

const toBase = (
  context: EventContext,
  asks: DialogAsks,
  id: string,
  write: string
): DialogBase => ({
  id,
  open: asks.query.confirm === write,
  closeHref: toSelfHref(context),
  action: `${toEventHref(context.key)}/${write}`,
  back: context.from,
  prod: asks.prod,
  short: {
    name: context.event.eventType ?? context.event.type,
    id: shortId(context.event.eventId)
  }
})

export const canRedriveEvent = ({ state }: EventContext): boolean =>
  state.deadLetter || state.purged

/** Every attempt failed as the last did and nothing has changed since, so a redrive would fail the same way. */
const isFutile = ({ event, state }: EventContext): boolean =>
  state.deadLetter && allSame(event) && !isEditedSinceAttempts(event)

const editInstead = (context: EventContext): string | null =>
  canEditEvent(context.event, context.state)
    ? toSelfHref(context, ['edit', 'payload'], '#payload')
    : null

const toFutile = (context: EventContext) =>
  isFutile(context)
    ? {
        count: context.event.attemptHistory.length,
        editHref: editInstead(context)
      }
    : null

const toEdited = ({ event, times }: EventContext): Byline | null =>
  event.lastEdit && isEditedSinceRedrive(event)
    ? { by: event.lastEdit.by, at: timeOf(event.lastEdit.at, times) }
    : null

/** Redriving a purged event reverses a decision somebody made, so the dialog names it first. */
const toPurged = ({ event, state, times }: EventContext): Byline | null =>
  state.purged && event.lastPurge
    ? {
        by: event.lastPurge.by,
        at: timeOf(event.lastPurge.at, times, toDayTime)
      }
    : null

export const toRedriveDialog = (
  context: EventContext,
  asks: DialogAsks
): RedriveDialog | null =>
  canRedriveEvent(context)
    ? {
        ...toBase(context, asks, redriveDialogId, 'redrive'),
        service: context.service,
        allowed: context.count?.allowed ?? null,
        futile: toFutile(context),
        edited: toEdited(context),
        purged: toPurged(context)
      }
    : null

/** The service's own gate: a dead letter it gives a deletion date for. */
export const canPurgeEvent = ({ event, state }: EventContext): boolean =>
  state.deadLetter && Boolean(event.purgeDeletionDate)

/** A flash the redirect never delivered must not refill the form on another event. */
const formFor = (context: EventContext, form?: PurgeFormNotice) =>
  form?.page === context.eventHref ? form : null

const fieldError = (form: PurgeFormNotice | null, field: string) =>
  form?.error?.field === field ? form.error.message : null

const toReasons = (form: PurgeFormNotice | null) =>
  purgeReasons.map(({ value, label }) => ({
    value,
    text: label,
    checked: form?.reasonCode === value
  }))

const deletionOf = ({ event, times }: EventContext) =>
  timeOf((event as EventDetail).purgeDeletionDate, times, toDayTime)

export const toPurgeDialog = (
  context: EventContext,
  asks: DialogAsks
): PurgeDialog | null => {
  const form = formFor(context, asks.form)

  return canPurgeEvent(context)
    ? {
        ...toBase(context, asks, purgeDialogId, 'purge'),
        deletionDay: deletionOf(context),
        reasons: toReasons(form),
        reasonError: fieldError(form, 'reason'),
        note: form?.note ?? '',
        noteError: fieldError(form, 'note'),
        noteMax: noteMaxLength
      }
    : null
}
