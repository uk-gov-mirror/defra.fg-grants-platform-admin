import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import type { PayloadSubmission } from '../use-cases/edit-payload-step.ts'
import { toSubmittedStep } from '../use-cases/edit-payload-step.ts'
import type {
  EventDetail,
  EventKey,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import { toEventHref } from './event-formats.ts'
import type { Zone } from './event-formats.ts'
import type { EventNotice, EventPageModel } from './event-page.view-model.ts'
import { toEventPage } from './event-page.view-model.ts'
import { toEventState } from './event-state.ts'
import type { HeldEdit } from './payload-edit.ts'
import { canEditEvent, toHeldEdit, toUnattributedEdit } from './payload-edit.ts'

export interface PayloadPageModel extends EventPageModel {
  pageTitle: string
  /** The operator's text and note, when the event could not be read to check them against. */
  heldEdit: HeldEdit | null
}

/** Said straight away rather than after a save that was bound to fail. */
const toConflict = (key: EventKey, event: EventDetail): EventNotice => ({
  outcome: 'conflict',
  status: event.statusLabel,
  reason: null,
  page: toEventHref(key),
  action: 'edit'
})

const toFoundPage = (
  result: EventResult,
  event: EventDetail,
  key: EventKey,
  submission: PayloadSubmission,
  zone: Zone,
  bucket: BucketEntry | null
): PayloadPageModel => {
  const query = { back: submission.from }
  const page = canEditEvent(event, toEventState(event))
    ? toEventPage(
        result,
        key,
        query,
        zone,
        undefined,
        undefined,
        toSubmittedStep(event, submission),
        bucket
      )
    : toEventPage(
        result,
        key,
        query,
        zone,
        toConflict(key, event),
        undefined,
        undefined,
        bucket
      )

  return { ...page, pageTitle: 'Event', heldEdit: null }
}

/**
 * Without the event there is no revision or status to check the text against,
 * so nothing can be reviewed or saved; the text and the note are handed back
 * rather than dropped, until the event can be read again.
 */
const toUnreadPage = (
  result: EventResult,
  key: EventKey,
  submission: PayloadSubmission,
  zone: Zone
): PayloadPageModel => ({
  ...toEventPage(result, key, { back: submission.from }, zone),
  pageTitle: result.outcome === 'not-found' ? 'Event not found' : 'Event',
  heldEdit: toHeldEdit(result.outcome, submission)
})

/**
 * The event page with the editor or the review in the payload card, built
 * from the text the form posted. It is rendered, not redirected to: the text
 * travels in the page body and never in a url or the session.
 */
export const toPayloadPage = (
  result: EventResult,
  key: EventKey,
  submission: PayloadSubmission,
  zone: Zone,
  bucket: BucketEntry | null = null
): PayloadPageModel =>
  result.event === null
    ? toUnreadPage(result, key, submission, zone)
    : toFoundPage(result, result.event, key, submission, zone, bucket)

/** Not read: nothing is written, and the event has nothing to add to the refusal. */
export const toUnattributedPage = (
  key: EventKey,
  submission: PayloadSubmission,
  zone: Zone
): PayloadPageModel => ({
  ...toEventPage(
    { outcome: 'unavailable', event: null },
    key,
    { back: submission.from },
    zone
  ),
  pageTitle: 'Event',
  heldEdit: toUnattributedEdit(submission)
})
