import type { EditNoteProblem } from '../use-cases/edit-payload-command.ts'
import { editNoteMaxLength } from '../use-cases/edit-payload-command.ts'
import type {
  EditProblem,
  PayloadEditStep
} from '../use-cases/edit-payload-step.ts'
import type {
  EventDetail,
  EventLastEdit
} from '../use-cases/get-event.use-case.ts'
import type { JsonFault } from '../use-cases/json-scan.ts'
import { scanJson } from '../use-cases/json-scan.ts'
import { isAfter } from './event-formats.ts'
import type { EventState } from './event-state.ts'

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

/** Edited, and not yet retried: the state the redrive dialog names. */
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

/** The owning service sends a revision only once it can take an edit, so its presence is the capability. */
export const canEditEvent = (event: EventDetail, state: EventState): boolean =>
  (state.deadLetter || state.purged) &&
  typeof event.payloadRevision === 'number'

/** Tall enough for the payload and two lines more, up to 24, then it scrolls. */
const maxRows = 24

export const toRows = (text: string): number =>
  Math.min(text.split('\n').length + 2, maxRows)

const missingPunctuation =
  'Check the JSON — a comma, quote or brace is missing.'

const unreadable = ({ expected, line, column }: JsonFault): string =>
  `Couldn’t read the payload: expected ${expected} (line ${line}, column ${column}). ${missingPunctuation}`

/** The scanner's sentences name a place, and a token or a rule, and never the text. */
const fieldErrors: Record<
  Exclude<EditProblem['kind'], 'stale' | 'unchanged'>,
  (problem: EditProblem) => string
> = {
  unreadable: (problem) =>
    'fault' in problem ? unreadable(problem.fault) : missingPunctuation,
  'dollar-key': (problem) =>
    'at' in problem
      ? `Couldn’t use the payload: the key at line ${problem.at.line}, column ${problem.at.column} starts with $, which can’t be saved.`
      : '',
  'duplicate-key': (problem) =>
    'at' in problem
      ? `Couldn’t use the payload: the key at line ${problem.at.line}, column ${problem.at.column} is already used earlier in the same object. Each key can appear only once.`
      : '',
  'prototype-key': () =>
    'Couldn’t use the payload: it has a key named __proto__, which can’t be saved.',
  'not-an-object': () =>
    'Couldn’t use the payload: it must be a JSON object, in braces.',
  'too-large': () =>
    'The payload is too large: it must be 256 KiB or smaller once formatted.'
}

const alertKinds = new Set(['stale', 'unchanged'])

/** Unchanged and stale are said above the field; the rest under it. */
const toFieldError = (problem: EditProblem | null): string | null =>
  problem && !alertKinds.has(problem.kind)
    ? fieldErrors[problem.kind as keyof typeof fieldErrors](problem)
    : null

export interface EditorState {
  text: string
  note: string
  revision: number
  rows: number
  /** Said under the field: the JSON couldn't be read or used. */
  error: string | null
  unchanged: boolean
  stale: boolean
}

export const toEditorState = (
  step: Extract<PayloadEditStep, { step: 'edit' }>
): EditorState => {
  const kind = step.problem?.kind

  return {
    text: step.text,
    note: step.note,
    revision: step.revision,
    rows: toRows(step.text),
    error: toFieldError(step.problem),
    unchanged: kind === 'unchanged',
    stale: kind === 'stale'
  }
}

const noteErrors: Record<EditNoteProblem, string> = {
  missing: 'Say why you’re changing the payload',
  'too-long': `Shorten the note to ${editNoteMaxLength} characters or fewer`
}

export interface ReviewState {
  text: string
  revision: number
  note: string
  noteError: string | null
  noteMax: number
  /** The lines of the saved text with a number that will be rounded, as the diff numbers them. */
  roundedLines: number[]
}

/**
 * Warned rather than refused: a payload can already hold such a number, and
 * refusing would leave it uneditable.
 */
export const toReviewState = (
  step: Extract<PayloadEditStep, { step: 'review' }>
): ReviewState => ({
  text: step.text,
  revision: step.revision,
  note: step.note,
  noteError: step.noteProblem === null ? null : noteErrors[step.noteProblem],
  noteMax: editNoteMaxLength,
  roundedLines: [
    ...new Set(scanJson(step.text).unsafeIntegers.map(({ line }) => line))
  ]
})

/** Only a service that looked and said no warns; `null` is a service that can't tell. */
export const isNotPlainJson = (event: EventDetail): boolean =>
  event.payloadIsPlainJson === false
