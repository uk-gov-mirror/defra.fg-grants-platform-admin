import type { EditOutcome } from '../use-cases/edit-payload.use-case.ts'
import type {
  EventDetail,
  EventLastEdit
} from '../use-cases/get-event.use-case.ts'
import { isAfter, toAbsoluteInstant, toPreciseOrNone } from './event-formats.ts'
import type { EventState } from './event-state.ts'
import type { JsonKeyProblem, JsonPosition } from './json-scan.ts'
import { scanJson, toFaultMessage } from './json-scan.ts'
import type { PayloadDiff } from './payload-diff.ts'
import { toPayloadDiff } from './payload-diff.ts'
import type { PayloadProblem } from './payload-form.ts'
import { editNoteMaxLength } from './payload-form.ts'

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

/** The stored payload as the editor opens on it and the review compares against. */
export const toStoredJson = (event: EventDetail): string =>
  event.payload === undefined ? '' : JSON.stringify(event.payload, null, 2)

/** The owning service sends a revision only once it can take an edit, so its presence is the capability. */
export const canEditEvent = (event: EventDetail, state: EventState): boolean =>
  (state.deadLetter || state.purged) &&
  typeof event.payloadRevision === 'number'

/** Someone else's edit landed after this editor opened: the text is kept, and set against the payload as it is now. */
export type EditorProblem = PayloadProblem | { kind: 'stale' }

/** What a review or a save sends back to the page. The stored payload is never in it: the page reads that for itself. */
export type PayloadEditInput =
  | {
      step: 'edit'
      text: string
      revision: number
      problem: EditorProblem | null
    }
  | {
      step: 'review'
      text: string
      revision: number
      note: string
      noteError: string | null
    }

export interface EditorAlert {
  role: 'error' | 'neutral'
  lead: string
  message: string
  /** Where the scanner stopped, for the link that takes the caret there. */
  line: number | null
  column: number | null
}

export interface PayloadEditor {
  text: string
  revision: number
  rows: number
  alert: EditorAlert | null
  /** The payload as it is now, shown beside the operator's text once theirs has gone stale. */
  currentJson: string | null
}

interface NoteErrorLink {
  message: string
  href: string
}

export interface PayloadReview {
  text: string
  revision: number
  diff: PayloadDiff
  confirmBody: string
  note: string
  noteCount: string
  noteMax: number
  noteMessage: string | null
  noteInvalid: boolean
  noteDescribedBy: string
  error: NoteErrorLink | null
  numberWarning: string | null
}

const cannotRead = "Couldn't read the payload."

const cannotUse = "Couldn't use the payload."

const keyMessages: Record<JsonKeyProblem, (at: JsonPosition) => string> = {
  'dollar-key': ({ line, column }) =>
    `The key at line ${line}, column ${column} starts with $, which can't be saved.`,
  'duplicate-key': ({ line, column }) =>
    `The key at line ${line}, column ${column} is already used earlier in the same object. Each key can appear only once.`
}

const problemAlerts: Record<
  Exclude<EditorProblem['kind'], 'unreadable' | JsonKeyProblem>,
  EditorAlert
> = {
  'prototype-key': {
    role: 'error',
    lead: cannotRead,
    message: "It has a key named __proto__, which can't be saved.",
    line: null,
    column: null
  },
  'not-an-object': {
    role: 'error',
    lead: cannotUse,
    message: 'It must be a JSON object, in braces.',
    line: null,
    column: null
  },
  'too-large': {
    role: 'error',
    lead: 'The payload is too large.',
    message: 'It must be 256 KiB or smaller once formatted.',
    line: null,
    column: null
  },
  stale: {
    role: 'error',
    lead: 'Not saved — the payload changed while you were editing.',
    message:
      'Your version is still in the editor. Review it again to compare it with the payload as it is now, shown below it.',
    line: null,
    column: null
  },
  unchanged: {
    role: 'neutral',
    lead: 'Nothing to review.',
    message:
      'The payload is unchanged. Edit it, or discard your changes to leave it as it is.',
    line: null,
    column: null
  }
}

const toPlacedAlert = (
  lead: string,
  message: string,
  { line, column }: JsonPosition
): EditorAlert => ({ role: 'error', lead, message, line, column })

/** The scanner's sentences name a place, and a token or a rule, and never the text. */
const toEditorAlert = (problem: EditorProblem): EditorAlert => {
  if ('fault' in problem) {
    return toPlacedAlert(
      cannotRead,
      toFaultMessage(problem.fault),
      problem.fault
    )
  }

  if ('at' in problem) {
    return toPlacedAlert(
      cannotUse,
      keyMessages[problem.kind](problem.at),
      problem.at
    )
  }

  return problemAlerts[problem.kind]
}

/** Tall enough for the payload up to the viewer's own cap, then it scrolls. */
const maxRows = 24

const toRows = (text: string): number =>
  Math.min(text.split('\n').length, maxRows)

export const toPayloadEditor = (
  input: Extract<PayloadEditInput, { step: 'edit' }>,
  storedJson: string
): PayloadEditor => ({
  text: input.text,
  revision: input.revision,
  rows: toRows(input.text),
  alert: input.problem === null ? null : toEditorAlert(input.problem),
  currentJson: input.problem?.kind === 'stale' ? storedJson : null
})

const editNoteId = 'edit-note'
const editNoteHintId = 'edit-note-hint'
const editNoteHelpId = 'edit-note-help'

const toConfirmBody = (state: EventState): string =>
  `Your version replaces the stored payload. The edit is audited. The event stays ${state.purged ? 'purged' : 'a dead letter'} — nothing is retried until you redrive it.`

/** `validator-hint` is hidden with `visibility`, so its id joins the description only while it shows. */
const toNoteField = (note: string, message: string | null) => ({
  note,
  noteCount: `${note.length} / ${editNoteMaxLength}`,
  noteMax: editNoteMaxLength,
  noteMessage: message,
  noteInvalid: message !== null,
  noteDescribedBy:
    message === null ? editNoteHelpId : `${editNoteHintId} ${editNoteHelpId}`,
  error: message === null ? null : { message, href: `#${editNoteId}` }
})

/**
 * Warned rather than refused: a payload can already hold such a number, and
 * refusing would leave it uneditable. The line is the saved text's, as the
 * diff and the payload below it number it.
 */
const toNumberWarning = (formatted: string): string | null => {
  const unsafe = scanJson(formatted).unsafeInteger

  return unsafe === null
    ? null
    : `The number on line ${unsafe.line} is too large to be saved exactly, so it will be saved rounded, as shown. Put it in quotes if every digit matters.`
}

export const toPayloadReview = (
  input: Extract<PayloadEditInput, { step: 'review' }>,
  storedJson: string,
  state: EventState
): PayloadReview => ({
  text: input.text,
  revision: input.revision,
  diff: toPayloadDiff(storedJson, input.text),
  confirmBody: toConfirmBody(state),
  ...toNoteField(input.note, input.noteError),
  numberWarning: toNumberWarning(input.text)
})

const plainJsonWarning =
  "Some values in this payload aren't plain JSON and will be saved as JSON text, for example dates as strings."

/** Only a service that looked and said no warns; `null` is a service that can't tell. */
export const toPlainJsonWarning = (event: EventDetail): string | null =>
  event.payloadIsPlainJson === false ? plainJsonWarning : null

export interface EditBanner {
  role: 'success' | 'warning' | 'error'
  message: string
}

export interface EditNotice {
  status: string | null
  reason?: string | null
}

/** Null where the page could not read the event back. */
interface EditBannerContext {
  purged: boolean | null
}

type EditBannerFor = (
  notice: EditNotice,
  context: EditBannerContext
) => EditBanner

/** The state is read off the event this page has just fetched, not taken from the answer to the write. */
const saved = (purged: boolean | null): string => {
  if (purged === null) {
    return "Payload saved. It hasn't been retried."
  }

  return `Payload saved. The event is still ${purged ? 'purged' : 'a dead letter'} and hasn't been retried.`
}

const notSaved = (sentence: string): string =>
  `Not saved — ${sentence} Nothing has changed.`

const refusals: Record<string, string> = {
  TOO_LARGE: notSaved('the payload is over 256 KiB once formatted.'),
  UNCHANGED: notSaved('the payload is the same as the one stored.'),
  NOT_AN_OBJECT: notSaved('the payload must be a JSON object.'),
  DOLLAR_KEY: notSaved("a key starts with $, which can't be stored.")
}

/** A reason this release has no sentence for still reads as a refusal, never as an outage. */
const toRefusal = (reason: string | null | undefined): string =>
  refusals[reason ?? ''] ?? notSaved('fg-gas-backend refused the change.')

const cannotEdit = "Not saved — this event can't be edited."

export const editBanners: Record<EditOutcome, EditBannerFor> = {
  saved: (_notice, { purged }) => ({
    role: 'success',
    message: saved(purged)
  }),
  conflict: ({ status }) => ({
    role: 'warning',
    message:
      status === null
        ? cannotEdit
        : `${cannotEdit} Its status is now ${status}.`
  }),
  stale: () => ({
    role: 'error',
    message:
      'Not saved — the payload changed while you were editing. Open the editor again to make your change to the payload as it is now.'
  }),
  refused: ({ reason }) => ({ role: 'error', message: toRefusal(reason) }),
  'not-found': () => ({
    role: 'error',
    message: notSaved('fg-gas-backend no longer has this event.')
  }),
  'timed-out': () => ({
    role: 'warning',
    message:
      'Save status unknown — refresh to check whether your change went through.'
  }),
  unavailable: () => ({
    role: 'error',
    message: notSaved('fg-gas-backend could not be reached.')
  })
}
