/**
 * Where a JSON text stops being JSON, and what should have been there; and,
 * in a text that is JSON, the first key that can't be saved and the first
 * number `JSON.parse` would round.
 *
 * `JSON.parse` can't be asked instead: its message sometimes carries no
 * position at all and sometimes quotes a run of the document back, which
 * here would put applicant data into an alert. So the fault is found here and
 * the sentence is built from the phrases below, which never repeat the text.
 *
 * Iterative, with its own stack, so a deeply nested text can't exhaust the
 * call stack. Columns are UTF-16 code units, as a textarea counts them.
 */
export interface JsonPosition {
  line: number
  column: number
}

export interface JsonFault extends JsonPosition {
  expected: string
}

/** Well-formed JSON the payload still can't be: Mongo stores no `$` key, and a repeated key silently keeps its last value. */
export type JsonKeyProblem = 'dollar-key' | 'duplicate-key'

export interface JsonKeyFault extends JsonPosition {
  problem: JsonKeyProblem
}

/** Null throughout means one well-formed document, every key usable and every whole number exact. */
export interface JsonScan {
  fault: JsonFault | null
  keyFault: JsonKeyFault | null
  /** The first whole number past ±(2^53 − 1), which `JSON.parse` rounds. */
  unsafeInteger: JsonPosition | null
}

type Container = '{' | '['

type Step = 'value' | 'firstValue' | 'firstKey' | 'key' | 'colon' | 'after'

interface KeyFaultAt {
  at: number
  problem: JsonKeyProblem
}

interface Scan {
  text: string
  at: number
  open: Container[]
  /** One set per open container, kept in step with `open`; an array's stays empty. */
  keys: Set<string>[]
  keyFault: KeyFaultAt | null
  unsafeIntegerAt: number | null
}

class Fault {
  readonly at: number
  readonly expected: string

  constructor(at: number, expected: string) {
    this.at = at
    this.expected = expected
  }
}

const fail = (scan: Scan, expected: string): never => {
  throw new Fault(Math.min(scan.at, scan.text.length), expected)
}

const peek = (scan: Scan): string => scan.text.charAt(scan.at)

const whitespace = new Set([' ', '\t', '\n', '\r'])

const skipWhitespace = (scan: Scan) => {
  while (whitespace.has(peek(scan))) {
    scan.at++
  }
}

const isDigit = (char: string): boolean => char >= '0' && char <= '9'

const digits = (scan: Scan) => {
  const start = scan.at

  while (isDigit(peek(scan))) {
    scan.at++
  }

  if (scan.at === start) {
    fail(scan, 'a digit')
  }
}

const skipIf = (scan: Scan, chars: string): boolean => {
  const matched = peek(scan) !== '' && chars.includes(peek(scan))

  if (matched) {
    scan.at++
  }

  return matched
}

const integer = (scan: Scan) => {
  if (!skipIf(scan, '0')) {
    digits(scan)
  }
}

const fraction = (scan: Scan): boolean => {
  const found = skipIf(scan, '.')

  if (found) {
    digits(scan)
  }

  return found
}

const exponent = (scan: Scan): boolean => {
  const found = skipIf(scan, 'eE')

  if (found) {
    skipIf(scan, '+-')
    digits(scan)
  }

  return found
}

const noteUnsafeInteger = (scan: Scan, start: number) => {
  const exact = Number.isSafeInteger(Number(scan.text.slice(start, scan.at)))

  if (!exact && scan.unsafeIntegerAt === null) {
    scan.unsafeIntegerAt = start
  }
}

const number = (scan: Scan): Step => {
  const start = scan.at

  skipIf(scan, '-')
  integer(scan)

  // Both are read, in order. Only a plain whole number is checked: it is the one an operator expects kept digit for digit.
  if (![fraction(scan), exponent(scan)].includes(true)) {
    noteUnsafeInteger(scan, start)
  }

  return 'after'
}

const hex = /^[0-9a-fA-F]{4}$/

const unicodeEscape = (scan: Scan) => {
  if (!hex.test(scan.text.slice(scan.at + 1, scan.at + 5))) {
    scan.at++
    fail(scan, 'four hexadecimal digits')
  }

  scan.at += 5
}

const escape = (scan: Scan) => {
  scan.at++

  if (skipIf(scan, '"\\/bfnrt')) {
    return
  }

  if (peek(scan) === 'u') {
    unicodeEscape(scan)

    return
  }

  fail(scan, 'a valid escape')
}

const lineBreaks = new Set(['\n', '\r'])

/** JSON allows no raw control character in a string; a line break is the likeliest, and means the quote was never closed. */
const controlCharacter = (scan: Scan, char: string): never =>
  fail(
    scan,
    lineBreaks.has(char) ? 'a closing quote' : 'an escaped control character'
  )

const isControl = (char: string): boolean => char < ' '

/** Moves past one character of a string's body; false once the closing quote is passed. */
const stringCharacter = (scan: Scan, char: string): boolean => {
  if (char === '"') {
    scan.at++

    return false
  }

  if (char === '\\') {
    escape(scan)

    return true
  }

  if (isControl(char)) {
    controlCharacter(scan, char)
  }

  scan.at++

  return true
}

const string = (scan: Scan): Step => {
  scan.at++

  while (scan.at < scan.text.length) {
    if (!stringCharacter(scan, peek(scan))) {
      return 'after'
    }
  }

  return fail(scan, 'a closing quote')
}

const words = ['true', 'false', 'null']

const skip = (scan: Scan, length: number): Step => {
  scan.at += length

  return 'after'
}

const word = (scan: Scan): Step => {
  const found = words.find((candidate) =>
    scan.text.startsWith(candidate, scan.at)
  )

  return found === undefined ? fail(scan, 'a value') : skip(scan, found.length)
}

const open = (scan: Scan, container: Container): Step => {
  scan.at++
  scan.open.push(container)
  scan.keys.push(new Set())

  return container === '{' ? 'firstKey' : 'firstValue'
}

const values: Record<string, (scan: Scan) => Step> = {
  '{': (scan) => open(scan, '{'),
  '[': (scan) => open(scan, '['),
  '"': string,
  '-': number,
  t: word,
  f: word,
  n: word
}

const value = (scan: Scan): Step => {
  skipWhitespace(scan)

  const char = peek(scan)
  const read = isDigit(char) ? number : values[char]

  return read === undefined ? fail(scan, 'a value') : read(scan)
}

const close = (scan: Scan): Step => {
  scan.at++
  scan.open.pop()
  scan.keys.pop()

  return 'after'
}

const firstValue = (scan: Scan): Step => {
  skipWhitespace(scan)

  return peek(scan) === ']' ? close(scan) : 'value'
}

const firstKey = (scan: Scan): Step => {
  skipWhitespace(scan)

  return peek(scan) === '}' ? close(scan) : 'key'
}

const toKeyProblem = (
  seen: Set<string>,
  name: string
): JsonKeyProblem | null => {
  if (name.startsWith('$')) {
    return 'dollar-key'
  }

  return seen.has(name) ? 'duplicate-key' : null
}

/** Only the first is kept: the scan goes on, since a syntax fault later in the text still comes first. */
const noteKey = (scan: Scan, start: number) => {
  const seen = scan.keys.at(-1) ?? new Set<string>()
  const name = JSON.parse(scan.text.slice(start, scan.at)) as string
  const problem = toKeyProblem(seen, name)

  if (problem !== null && scan.keyFault === null) {
    scan.keyFault = { at: start, problem }
  }

  seen.add(name)
}

const key = (scan: Scan): Step => {
  skipWhitespace(scan)

  if (peek(scan) !== '"') {
    fail(scan, 'a property name in double quotes')
  }

  const start = scan.at

  string(scan)
  noteKey(scan, start)

  return 'colon'
}

const colon = (scan: Scan): Step => {
  skipWhitespace(scan)

  if (!skipIf(scan, ':')) {
    fail(scan, 'a colon')
  }

  return 'value'
}

interface Separators {
  next: Step
  closer: string
  expected: string
}

const separators: Record<Container, Separators> = {
  '{': { next: 'key', closer: '}', expected: 'a comma or a closing brace' },
  '[': {
    next: 'value',
    closer: ']',
    expected: 'a comma or a closing bracket'
  }
}

const afterMember = (scan: Scan, container: Container): Step => {
  const { next, closer, expected } = separators[container]

  if (skipIf(scan, ',')) {
    return next
  }

  return peek(scan) === closer ? close(scan) : fail(scan, expected)
}

/** Null once the whole document is read. */
const after = (scan: Scan): Step | null => {
  skipWhitespace(scan)

  const container = scan.open.at(-1)

  if (container !== undefined) {
    return afterMember(scan, container)
  }

  return scan.at < scan.text.length
    ? fail(scan, 'the end of the document')
    : null
}

const steps: Record<Step, (scan: Scan) => Step | null> = {
  value,
  firstValue,
  firstKey,
  key,
  colon,
  after
}

const toPosition = (text: string, at: number): JsonPosition => {
  const before = text.slice(0, at)

  return {
    line: before.split('\n').length,
    column: at - before.lastIndexOf('\n')
  }
}

const toFault = (text: string, fault: Fault): JsonFault => ({
  ...toPosition(text, fault.at),
  expected: fault.expected
})

const toKeyFault = (text: string, fault: KeyFaultAt | null) =>
  fault === null
    ? null
    : { ...toPosition(text, fault.at), problem: fault.problem }

const toUnsafeInteger = (text: string, at: number | null) =>
  at === null ? null : toPosition(text, at)

const walk = (scan: Scan) => {
  let step: Step | null = 'value'

  while (step !== null) {
    step = steps[step](scan)
  }
}

const toFaultScan = (text: string, error: unknown): JsonScan => {
  if (error instanceof Fault) {
    return { fault: toFault(text, error), keyFault: null, unsafeInteger: null }
  }

  throw error
}

export const scanJson = (text: string): JsonScan => {
  const scan: Scan = {
    text,
    at: 0,
    open: [],
    keys: [],
    keyFault: null,
    unsafeIntegerAt: null
  }

  try {
    walk(scan)
  } catch (error) {
    return toFaultScan(text, error)
  }

  return {
    fault: null,
    keyFault: toKeyFault(text, scan.keyFault),
    unsafeInteger: toUnsafeInteger(text, scan.unsafeIntegerAt)
  }
}

export const toFaultMessage = ({ line, column, expected }: JsonFault): string =>
  `Expected ${expected} at line ${line}, column ${column}.`
