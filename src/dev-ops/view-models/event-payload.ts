import { toEditText } from '../use-cases/edit-payload-command.ts'
import type { PayloadEditStep } from '../use-cases/edit-payload-step.ts'
import { toOpenedStep, toStoredJson } from '../use-cases/edit-payload-step.ts'
import type { EventDetail, EventKey } from '../use-cases/get-event.use-case.ts'
import { toWhy } from './event-attempts.ts'
import type { WhyItFailed } from './event-attempts.ts'
import { timeOf, toSelfHref } from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { toEventHref } from './event-formats.ts'
import {
  canEditEvent,
  isNotPlainJson,
  toEditorState,
  toReviewState
} from './payload-edit.ts'
import type { EditorState, ReviewState } from './payload-edit.ts'
import type { TimeText } from './times.ts'

/** A save the service didn't answer: the changes are held on the page, to try again. */
export interface HeldSave {
  /** The service timed out, so the save may have gone through. */
  timedOut: boolean
  text: string
  revision: number
  note: string
  /** `redrive` for Save and redrive, which Try again repeats. */
  then: string
}

export interface SaveError {
  title: string
  text: string
}

export interface PayloadAsks {
  query: { edit?: string; confirm?: string }
  /** Handed over by a review or a save, in place of the editor the link opens. */
  edit?: PayloadEditStep
  held?: HeldSave
  saveError?: SaveError
}

interface PayloadView {
  mode: 'view'
  text: string
  edited: boolean
  editHref: string | null
  original: string | null
}

type PayloadEditor = {
  mode: 'edit'
  action: string
  discardHref: string
  back: string
  why: WhyItFailed | null
  current: { text: string; by: string | null; at: TimeText | null } | null
  notPlainJson: boolean
} & EditorState

type PayloadReview = {
  mode: 'review'
  action: string
  reviewAction: string
  back: string
  before: string
  notPlainJson: boolean
  saveError: SaveError | null
} & ReviewState

type PayloadHeld = {
  mode: 'held'
  action: string
  cancelHref: string
  back: string
  before: string
  title: string
  body: string
} & HeldSave

export type PayloadModel =
  | PayloadView
  | PayloadEditor
  | PayloadReview
  | PayloadHeld

const toOriginal = (event: EventDetail): string | null =>
  event.lastEdit && event.originalPayload != null
    ? JSON.stringify(event.originalPayload, null, 2)
    : null

const editHrefOf = (context: EventContext): string | null =>
  canEditEvent(context.event, context.state)
    ? toSelfHref(context, ['edit', 'payload'], '#payload')
    : null

const toView = (context: EventContext): PayloadView => ({
  mode: 'view',
  text: toStoredJson(context.event),
  edited: Boolean(context.event.lastEdit),
  editHref: editHrefOf(context),
  original: toOriginal(context.event)
})

const reviewAction = (key: EventKey) =>
  `${toEventHref(key)}/payload/review#payload`

const saveAction = (key: EventKey) => `${toEventHref(key)}/payload#payload`

/** Someone else's edit, set beside the operator's own once theirs has gone stale. */
const toCurrent = ({ event, times }: EventContext) => ({
  text: toStoredJson(event),
  by: event.lastEdit?.by ?? null,
  at: timeOf(event.lastEdit?.at, times)
})

const toEditor = (
  context: EventContext,
  step: Extract<PayloadEditStep, { step: 'edit' }>
): PayloadEditor => {
  const editor = toEditorState(step)

  return {
    mode: 'edit',
    action: reviewAction(context.key),
    discardHref: toSelfHref(context),
    back: context.from,
    why: toWhy(context),
    current: editor.stale ? toCurrent(context) : null,
    notPlainJson: isNotPlainJson(context.event),
    ...editor
  }
}

const toReview = (
  context: EventContext,
  step: Extract<PayloadEditStep, { step: 'review' }>,
  saveError: SaveError | null
): PayloadReview => ({
  mode: 'review',
  action: saveAction(context.key),
  reviewAction: reviewAction(context.key),
  back: context.from,
  before: toStoredJson(context.event),
  notPlainJson: isNotPlainJson(context.event),
  saveError,
  ...toReviewState(step)
})

const heldCopy = (service: string, timedOut: boolean) =>
  timedOut
    ? {
        title: `Not saved — ${service} timed out.`,
        body: 'It may not have been saved. Your payload and note are below; trying again is safe: if it was saved, you’ll see the payload as it is now.'
      }
    : {
        title: `Not saved — ${service} couldn’t be reached.`,
        body: 'Nothing has changed on the event. Your payload and note are below.'
      }

/** A timed-out save may have been made, so the page says only what is certain. */
const toHeld = (context: EventContext, held: HeldSave): PayloadHeld => ({
  mode: 'held',
  action: saveAction(context.key),
  cancelHref: toSelfHref(context),
  back: context.from,
  before: toStoredJson(context.event),
  ...heldCopy(context.service, held.timedOut),
  ...held,
  text: toEditText(held.text)
})

/** Opened by its link, never over a dialog the address also asks for. */
const openedStep = (
  { event }: EventContext,
  { edit, confirm }: PayloadAsks['query']
): PayloadEditStep | null =>
  edit === 'payload' && confirm === undefined ? toOpenedStep(event) : null

const stepOf = (context: EventContext, asks: PayloadAsks) =>
  canEditEvent(context.event, context.state)
    ? (asks.edit ?? openedStep(context, asks.query))
    : null

const toStepModel = (
  context: EventContext,
  step: PayloadEditStep,
  asks: PayloadAsks
): PayloadModel =>
  step.step === 'edit'
    ? toEditor(context, step)
    : toReview(context, step, asks.saveError ?? null)

export const toPayload = (
  context: EventContext,
  asks: PayloadAsks
): PayloadModel => {
  if (asks.held) {
    return toHeld(context, asks.held)
  }

  const step = stepOf(context, asks)

  return step ? toStepModel(context, step, asks) : toView(context)
}
