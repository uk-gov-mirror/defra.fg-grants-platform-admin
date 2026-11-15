import type { EventDetail } from '../repositories/events.repository.ts'
import type { EditNoteProblem, PayloadProblem } from './edit-payload-command.ts'
import { readPayload, toEditText } from './edit-payload-command.ts'

/** Someone else's edit landed after this editor opened: the text is kept, and set against the payload as it is now. */
export type EditProblem =
  | PayloadProblem
  | { kind: 'stale' }
  | { kind: 'unchanged' }

/** Where a review or a save leaves the operator. The stored payload is never in it: the page reads that for itself. */
export type PayloadEditStep =
  | {
      step: 'edit'
      text: string
      revision: number
      problem: EditProblem | null
      /** A note typed at review, kept through Back to editing. */
      note: string
    }
  | {
      step: 'review'
      text: string
      revision: number
      note: string
      noteProblem: EditNoteProblem | null
    }

/** A review or a save, as the form posted it. */
export interface PayloadSubmission {
  text: string
  revision: number
  from: string
  /** Back to editing: the text goes back into the editor unchecked. */
  back?: boolean
  note?: string
  noteProblem?: EditNoteProblem | null
  /** The service answered 412, whatever revision the page now reads. */
  stale?: boolean
}

/** The stored payload as the editor opens on it and the review compares against. */
export const toStoredJson = (event: EventDetail): string =>
  event.payload === undefined ? '' : JSON.stringify(event.payload, null, 2)

const toCurrentRevision = (event: EventDetail): number =>
  event.payloadRevision ?? 0

const toEditStep = (
  text: string,
  revision: number,
  problem: EditProblem | null,
  note = ''
): PayloadEditStep => ({ step: 'edit', text, revision, problem, note })

export const toOpenedStep = (event: EventDetail): PayloadEditStep =>
  toEditStep(toStoredJson(event), toCurrentRevision(event), null)

/** Someone else's edit landed after this editor opened. */
const isStale = (event: EventDetail, submission: PayloadSubmission): boolean =>
  submission.stale === true || event.payloadRevision !== submission.revision

/**
 * The operator's text goes back into the editor under the current revision,
 * so the next review diffs it against the payload as it is now, and shows
 * any of the other edit it would undo.
 */
const toStaleStep = (
  event: EventDetail,
  text: string,
  note: string
): PayloadEditStep =>
  toEditStep(text, toCurrentRevision(event), { kind: 'stale' }, note)

const toReviewStep = (
  formatted: string,
  { revision, note, noteProblem }: PayloadSubmission
): PayloadEditStep => ({
  step: 'review',
  text: formatted,
  revision,
  note: note ?? '',
  noteProblem: noteProblem ?? null
})

/** A text that reads clean and changes nothing has nothing to review. */
const toCheckedStep = (
  event: EventDetail,
  text: string,
  submission: PayloadSubmission
): PayloadEditStep => {
  const read = readPayload(text)
  const note = submission.note ?? ''

  if (read.kind === 'refused') {
    return toEditStep(text, submission.revision, read.problem, note)
  }

  return read.formatted === toStoredJson(event)
    ? toEditStep(text, submission.revision, { kind: 'unchanged' }, note)
    : toReviewStep(read.formatted, submission)
}

export const toSubmittedStep = (
  event: EventDetail,
  submission: PayloadSubmission
): PayloadEditStep => {
  const text = toEditText(submission.text)
  const note = submission.note ?? ''

  if (isStale(event, submission)) {
    return toStaleStep(event, text, note)
  }

  return submission.back
    ? toEditStep(text, submission.revision, null, note)
    : toCheckedStep(event, text, submission)
}
