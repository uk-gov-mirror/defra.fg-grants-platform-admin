import type {
  EventDetail,
  EventLastEdit
} from '../use-cases/get-event.use-case.ts'
import { isAfter, toAbsoluteInstant, toPreciseOrNone } from './event-formats.ts'

export interface EditedFact {
  by: string
  at: string
  atInstant: string | null
  note: string | null
}

const lastEditOf = (event: EventDetail): EventLastEdit | null =>
  event.lastEdit ?? null

const redriveAtOf = (event: EventDetail): string | null =>
  event.lastRedrive?.at ?? null

/** An undated redrive predates the edits, so the edit is the newer of the two. */
const isNewerThanRedrive = (
  edit: EventLastEdit,
  event: EventDetail
): boolean => {
  const redriveAt = redriveAtOf(event)

  return redriveAt === null || isAfter(edit.at ?? '', redriveAt)
}

/** Edited, and not yet retried: the state the redrive confirm names. */
export const isEditedSinceRedrive = (event: EventDetail): boolean => {
  const edit = lastEditOf(event)

  return edit !== null && isNewerThanRedrive(edit, event)
}

const attemptedAfter = (event: EventDetail, editAt: string): boolean =>
  event.attemptHistory.some(
    (attempt) => attempt.at !== null && isAfter(attempt.at, editAt)
  )

/** No attempt has run on the payload as it now stands. */
export const isEditedSinceAttempts = (event: EventDetail): boolean => {
  const edit = lastEditOf(event)

  return edit !== null && !attemptedAfter(event, edit.at ?? '')
}

/** Once the edit is redriven, the attempts card says so in its own words. */
export const hasNoAttemptsSinceEdit = (event: EventDetail): boolean =>
  isEditedSinceRedrive(event) && isEditedSinceAttempts(event)

const toShownNote = (note: string | null): string | null =>
  note === null || note === '' ? null : note

export const toEditedFact = (event: EventDetail): EditedFact | null => {
  const edit = lastEditOf(event)

  if (edit === null) {
    return null
  }

  return {
    by: edit.by,
    at: toPreciseOrNone(edit.at),
    atInstant: toAbsoluteInstant(edit.at),
    note: toShownNote(edit.note)
  }
}

/** Printed as the payload is, so the two read line for line. */
export const toOriginalPayloadJson = (event: EventDetail): string | null =>
  event.originalPayload === undefined || event.originalPayload === null
    ? null
    : JSON.stringify(event.originalPayload, null, 2)

export const toRedriveEditedNote = (event: EventDetail): string | null => {
  const edit = lastEditOf(event)

  if (edit === null || !isEditedSinceRedrive(event)) {
    return null
  }

  return `The payload was edited on ${toPreciseOrNone(edit.at)} and hasn't been retried since.`
}
