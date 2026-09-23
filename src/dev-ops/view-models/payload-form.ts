import { parse } from '@hapi/bourne'

import type {
  JsonFault,
  JsonKeyProblem,
  JsonPosition,
  JsonScan
} from './json-scan.ts'
import { scanJson } from './json-scan.ts'

export const editNoteMaxLength = 500

/** The same bound both backends apply, measured on the payload as it will be stored: pretty-printed at two spaces. */
export const payloadMaxBytes = 256 * 1024

/** Past this the text is refused unread: indentation can make a payload under the bound several times longer as typed. */
const textMaxLength = payloadMaxBytes * 4

/** Room for the longest text read, form-encoded, where one character can take nine bytes; past it hapi answers 413. */
export const formMaxBytes = textMaxLength * 9

/** A browser sends a textarea's line breaks as CRLF but counts each as one character, so they are folded before anything else. */
export const toEditText = (text: string): string => text.replace(/\r\n/g, '\n')

export const toEditNote = (note: string): string => toEditText(note).trim()

const missingNote = 'Enter a note saying why you are changing it.'

const longNote = `Shorten the note to ${editNoteMaxLength} characters or fewer.`

export const toEditNoteError = (note: string): string | null => {
  if (note === '') {
    return missingNote
  }

  return note.length > editNoteMaxLength ? longNote : null
}

export type PayloadProblem =
  | { kind: 'too-large' }
  | { kind: 'unreadable'; fault: JsonFault }
  | { kind: JsonKeyProblem; at: JsonPosition }
  | { kind: 'prototype-key' }
  | { kind: 'not-an-object' }
  | { kind: 'unchanged' }

export type PayloadRead =
  | { kind: 'read'; value: Record<string, unknown>; formatted: string }
  | { kind: 'refused'; problem: PayloadProblem }

const refused = (problem: PayloadProblem): PayloadRead => ({
  kind: 'refused',
  problem
})

const isObject = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

const byteLength = (text: string): number => Buffer.byteLength(text, 'utf8')

const toFormatted = (value: unknown): PayloadRead => {
  if (!isObject(value)) {
    return refused({ kind: 'not-an-object' })
  }

  const formatted = JSON.stringify(value, null, 2)

  return byteLength(formatted) > payloadMaxBytes
    ? refused({ kind: 'too-large' })
    : { kind: 'read', value, formatted }
}

const prototypeKey = Symbol('prototype key')

/**
 * The backends' own body parser refuses a `__proto__` key with a bare 400, so
 * it is refused here first, where it can be said in a sentence. The text has
 * already scanned clean, so this is the only way `parse` can throw.
 */
const parseGuarded = (text: string): unknown => {
  try {
    return parse(text, { protoAction: 'error' })
  } catch {
    return prototypeKey
  }
}

const toParsed = (text: string): PayloadRead => {
  const value = parseGuarded(text)

  return value === prototypeKey
    ? refused({ kind: 'prototype-key' })
    : toFormatted(value)
}

/** A key the backends would refuse, or that parsing would quietly collapse, is said where it is. */
const toChecked = (
  text: string,
  keyFault: JsonScan['keyFault']
): PayloadRead => {
  if (keyFault === null) {
    return toParsed(text)
  }

  const { problem, ...at } = keyFault

  return refused({ kind: problem, at })
}

/** The scanner runs first: it is the only step that can say where a text is broken without quoting it. */
export const readPayload = (text: string): PayloadRead => {
  if (text.length > textMaxLength) {
    return refused({ kind: 'too-large' })
  }

  const { fault, keyFault } = scanJson(text)

  return fault === null
    ? toChecked(text, keyFault)
    : refused({ kind: 'unreadable', fault })
}
