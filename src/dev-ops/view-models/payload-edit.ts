import type { EditNoteProblem } from '../use-cases/edit-payload-command.ts'
import {
  editNoteMaxLength,
  toEditText
} from '../use-cases/edit-payload-command.ts'
import type {
  EditProblem,
  PayloadEditStep,
  PayloadSubmission
} from '../use-cases/edit-payload-step.ts'
import type { EditOutcome } from '../use-cases/edit-payload.use-case.ts'
import type {
  EventDetail,
  EventLastEdit,
  EventOutcome
} from '../use-cases/get-event.use-case.ts'
import type {
  JsonFault,
  JsonKeyProblem,
  JsonPosition
} from '../use-cases/json-scan.ts'
import { scanJson } from '../use-cases/json-scan.ts'
import { isAfter, toAbsoluteInstant, toPreciseOrNone } from './event-formats.ts'
import type { Zone } from './event-formats.ts'
import type { EventState } from './event-state.ts'
import { toJsonTextView, toJsonViewOrNone } from './json-viewer.view-model.ts'
import type { JsonView } from './json-viewer.view-model.ts'
import type { PayloadDiff } from './payload-diff.ts'
import { toPayloadDiff } from './payload-diff.ts'

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

/** An undated edit is newer only than what is undated too, as against a redrive. */
const attemptedAfter = (event: EventDetail, editAt: string | null): boolean =>
  event.attemptHistory.some(
    (attempt) =>
      attempt.at !== null && (editAt === null || isAfter(attempt.at, editAt))
  )

/** No attempt has run on the payload as it now stands. */
export const isEditedSinceAttempts = (event: EventDetail): boolean => {
  const edit = lastEditOf(event)

  return edit !== null && !attemptedAfter(event, edit.at)
}

/** Once the edit is redriven, the attempts card says so in its own words. */
export const hasNoAttemptsSinceEdit = (event: EventDetail): boolean =>
  isEditedSinceRedrive(event) && isEditedSinceAttempts(event)

const toShownNote = (note: string | null): string | null =>
  note === null || note === '' ? null : note

export const toEditedFact = (
  event: EventDetail,
  zone: Zone
): EditedFact | null => {
  const edit = lastEditOf(event)

  if (edit === null) {
    return null
  }

  return {
    by: edit.by,
    at: toPreciseOrNone(edit.at, zone),
    atInstant: toAbsoluteInstant(edit.at),
    note: toShownNote(edit.note)
  }
}

/** Drawn as the payload is, so the two read line for line. */
export const toOriginalPayloadView = (event: EventDetail): JsonView | null =>
  toJsonViewOrNone(event.originalPayload ?? undefined)

export const toRedriveEditedNote = (
  event: EventDetail,
  zone: Zone
): string | null => {
  const edit = lastEditOf(event)

  if (edit === null || !isEditedSinceRedrive(event)) {
    return null
  }

  return `The payload was edited on ${toPreciseOrNone(edit.at, zone)} and hasn't been retried since.`
}

/** The owning service sends a revision only once it can take an edit, so its presence is the capability. */
export const canEditEvent = (event: EventDetail, state: EventState): boolean =>
  (state.deadLetter || state.purged) &&
  typeof event.payloadRevision === 'number'

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
  currentView: JsonView | null
}

interface NoteErrorLink {
  message: string
  href: string
}

export interface PayloadReview {
  text: string
  toSave: JsonView
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

export const toFaultMessage = ({ line, column, expected }: JsonFault): string =>
  `Expected ${expected} at line ${line}, column ${column}.`

const cannotRead = "Couldn't read the payload."

const cannotUse = "Couldn't use the payload."

const keyMessages: Record<JsonKeyProblem, (at: JsonPosition) => string> = {
  'dollar-key': ({ line, column }) =>
    `The key at line ${line}, column ${column} starts with $, which can't be saved.`,
  'duplicate-key': ({ line, column }) =>
    `The key at line ${line}, column ${column} is already used earlier in the same object. Each key can appear only once.`
}

const problemAlerts: Record<
  Exclude<EditProblem['kind'], 'unreadable' | JsonKeyProblem>,
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
const toEditorAlert = (problem: EditProblem): EditorAlert => {
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

/** An event with no payload has nothing to show beside a stale edit. */
const toCurrentView = (
  input: Extract<PayloadEditStep, { step: 'edit' }>,
  storedJson: string
): JsonView | null =>
  input.problem?.kind === 'stale' && storedJson !== ''
    ? toJsonTextView(storedJson)
    : null

export const toPayloadEditor = (
  input: Extract<PayloadEditStep, { step: 'edit' }>,
  storedJson: string
): PayloadEditor => ({
  text: input.text,
  revision: input.revision,
  rows: toRows(input.text),
  alert: input.problem === null ? null : toEditorAlert(input.problem),
  currentView: toCurrentView(input, storedJson)
})

const editNoteId = 'edit-note'
const editNoteHintId = 'edit-note-hint'
const editNoteHelpId = 'edit-note-help'

const noteMessages: Record<EditNoteProblem, string> = {
  missing: 'Enter a note saying why you are changing it.',
  'too-long': `Shorten the note to ${editNoteMaxLength} characters or fewer.`
}

const toNoteMessage = (problem: EditNoteProblem | null): string | null =>
  problem === null ? null : noteMessages[problem]

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
  input: Extract<PayloadEditStep, { step: 'review' }>,
  storedJson: string,
  state: EventState
): PayloadReview => ({
  text: input.text,
  toSave: toJsonTextView(input.text),
  revision: input.revision,
  diff: toPayloadDiff(storedJson, input.text),
  confirmBody: toConfirmBody(state),
  ...toNoteField(input.note, toNoteMessage(input.noteProblem)),
  numberWarning: toNumberWarning(input.text)
})

export interface HeldEdit {
  lead: string
  message: string
  text: string
  rows: number
  revision: number
  /** Only a save sends a note, and only a save's is kept. */
  hasNote: boolean
  note: string
  noteCount: string
  noteMax: number
  /** An event that is gone won't come back, so there is nothing to try again. */
  canRetry: boolean
}

const unsaved = "Your changes haven't been saved."

const heldMessages: Record<Exclude<EventOutcome, 'found'>, string> = {
  'not-found': `fg-gas-backend no longer has this event. ${unsaved} They're below, so you can copy them.`,
  'timed-out': `fg-gas-backend timed out. ${unsaved} They're below: try again to check them against the event as it is now.`,
  unavailable: `fg-gas-backend could not be reached. ${unsaved} They're below: try again to check them against the event as it is now.`
}

const toHeldNote = (note: string | undefined) => ({
  hasNote: note !== undefined,
  note: note ?? '',
  noteCount: `${note?.length ?? 0} / ${editNoteMaxLength}`,
  noteMax: editNoteMaxLength
})

export const toHeldEdit = (
  outcome: EventOutcome,
  { text, revision, note }: PayloadSubmission
): HeldEdit => {
  const unread = outcome === 'found' ? 'unavailable' : outcome
  const held = toEditText(text)

  return {
    lead: "Couldn't load the event.",
    message: heldMessages[unread],
    text: held,
    rows: toRows(held),
    revision,
    ...toHeldNote(note),
    canRetry: unread !== 'not-found'
  }
}

/** The backend records who made every edit, so a session that names nobody can't make one. */
export const toUnattributedEdit = ({
  text,
  revision,
  note
}: PayloadSubmission): HeldEdit => {
  const held = toEditText(text)

  return {
    lead: 'Not saved — your account has no name or email to record against this change.',
    message:
      'Nothing has changed. Your changes are below, so you can copy them.',
    text: held,
    rows: toRows(held),
    revision,
    ...toHeldNote(note),
    canRetry: false
  }
}

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

/** A stale save is the editor again, never a flash, so it has no banner. */
export const editBanners: Record<
  Exclude<EditOutcome, 'stale'>,
  EditBannerFor
> = {
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
