import type {
  EventDetail,
  EventKey,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import { toEventHref } from './event-formats.ts'
import type { EventNotice, EventPageModel } from './event-page.view-model.ts'
import { toEventPage } from './event-page.view-model.ts'
import { toEventState } from './event-state.ts'
import type { EditorProblem, PayloadEditInput } from './payload-edit.ts'
import { canEditEvent, toStoredJson } from './payload-edit.ts'
import { readPayload, toEditText } from './payload-form.ts'

/** A review or a save, as the form posted it. */
export interface PayloadSubmission {
  text: string
  revision: number
  from: string
  /** Back to editing: the text goes back into the editor unchecked. */
  back?: boolean
  note?: string
  noteError?: string | null
  /** The service answered 412, whatever revision the page now reads. */
  stale?: boolean
}

/** Said straight away rather than after a save that was bound to fail. */
const toConflict = (key: EventKey, event: EventDetail): EventNotice => ({
  outcome: 'conflict',
  status: event.statusLabel,
  reason: null,
  page: toEventHref(key),
  action: 'edit'
})

const toEditStep = (
  text: string,
  revision: number,
  problem: EditorProblem | null
): PayloadEditInput => ({ step: 'edit', text, revision, problem })

/** Someone else's edit landed after this editor opened. */
const isStale = (event: EventDetail, submission: PayloadSubmission): boolean =>
  submission.stale === true || event.payloadRevision !== submission.revision

/**
 * The operator's text goes back into the editor under the current revision,
 * so the next review diffs it against the payload as it is now, and shows
 * any of the other edit it would undo.
 */
const toStaleStep = (event: EventDetail, text: string): PayloadEditInput =>
  toEditStep(text, event.payloadRevision ?? 0, { kind: 'stale' })

const toReviewStep = (
  formatted: string,
  { revision, note, noteError }: PayloadSubmission
): PayloadEditInput => ({
  step: 'review',
  text: formatted,
  revision,
  note: note ?? '',
  noteError: noteError ?? null
})

/** A text that reads clean and changes nothing has nothing to review. */
const toCheckedStep = (
  event: EventDetail,
  text: string,
  submission: PayloadSubmission
): PayloadEditInput => {
  const read = readPayload(text)

  if (read.kind === 'refused') {
    return toEditStep(text, submission.revision, read.problem)
  }

  return read.formatted === toStoredJson(event)
    ? toEditStep(text, submission.revision, { kind: 'unchanged' })
    : toReviewStep(read.formatted, submission)
}

const toSubmittedStep = (
  event: EventDetail,
  submission: PayloadSubmission
): PayloadEditInput => {
  const text = toEditText(submission.text)

  if (isStale(event, submission)) {
    return toStaleStep(event, text)
  }

  return submission.back
    ? toEditStep(text, submission.revision, null)
    : toCheckedStep(event, text, submission)
}

const toFoundPage = (
  result: EventResult,
  event: EventDetail,
  key: EventKey,
  submission: PayloadSubmission
): EventPageModel => {
  const query = { from: submission.from }

  return canEditEvent(event, toEventState(event))
    ? toEventPage(
        result,
        key,
        query,
        undefined,
        undefined,
        toSubmittedStep(event, submission)
      )
    : toEventPage(result, key, query, toConflict(key, event))
}

/**
 * The event page with the editor or the review in the payload card, built
 * from the text the form posted. It is rendered, not redirected to: the text
 * travels in the page body and never in a url or the session.
 */
export const toPayloadPage = (
  result: EventResult,
  key: EventKey,
  submission: PayloadSubmission
): EventPageModel =>
  result.event === null
    ? toEventPage(result, key, { from: submission.from })
    : toFoundPage(result, result.event, key, submission)
