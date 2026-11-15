import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import {
  canEditEvent,
  hasNoAttemptsSinceEdit,
  isEditedSinceAttempts,
  isEditedSinceRedrive,
  toEditorState,
  toReviewState,
  toRows
} from './payload-edit.ts'
import { toEventState } from './event-state.ts'

const event = (overrides: Partial<EventDetail> = {}): EventDetail =>
  ({
    status: 'DEAD_LETTER',
    payloadRevision: 1,
    attemptHistory: [
      {
        at: '2026-10-13T10:00:00.000Z',
        name: 'Error',
        message: 'x',
        stack: null
      }
    ],
    lastRedrive: null,
    lastEdit: null,
    ...overrides
  }) as EventDetail

const edit = { at: '2026-10-13T11:00:00.000Z', by: 'ada', note: 'n' }

describe('the edit and what has run since', () => {
  test('an edit after the last attempt and with no redrive since: not retried, nothing run on it', () => {
    const edited = event({ lastEdit: edit })

    expect(isEditedSinceRedrive(edited)).toBe(true)
    expect(isEditedSinceAttempts(edited)).toBe(true)
    expect(hasNoAttemptsSinceEdit(edited)).toBe(true)
  })

  test('a redrive after the edit: retried', () => {
    const redriven = event({
      lastEdit: edit,
      lastRedrive: { at: '2026-10-13T11:05:00.000Z', by: 'ada' }
    })

    expect(isEditedSinceRedrive(redriven)).toBe(false)
    expect(hasNoAttemptsSinceEdit(redriven)).toBe(false)
  })

  test('an attempt after the edit: the edit has been tried', () => {
    expect(
      isEditedSinceAttempts(
        event({
          lastEdit: edit,
          attemptHistory: [
            {
              at: '2026-10-13T12:00:00.000Z',
              name: 'Error',
              message: 'x',
              stack: null
            }
          ]
        })
      )
    ).toBe(false)
  })
})

describe('canEditEvent', () => {
  test.each([
    ['a dead letter with a revision', event(), true],
    ['a purged one', event({ status: 'PURGED' }), true],
    [
      'one the service sends no revision for',
      event({ payloadRevision: null }),
      false
    ],
    ['a completed one', event({ status: 'COMPLETED' }), false]
  ])('%s: %s', (_name, given, can) => {
    expect(canEditEvent(given, toEventState(given))).toBe(can)
  })
})

describe('toEditorState', () => {
  test('two lines more than the text, up to 24', () => {
    expect(toRows('{\n}')).toBe(4)
    expect(toRows('x\n'.repeat(40))).toBe(24)
  })

  test('JSON that can’t be read: where, and what to check', () => {
    expect(
      toEditorState({
        step: 'edit',
        note: '',
        text: '{',
        revision: 1,
        problem: {
          kind: 'unreadable',
          fault: { line: 1, column: 2, expected: 'a key' }
        }
      }).error
    ).toBe(
      'Couldn’t read the payload: expected a key (line 1, column 2). Check the JSON — a comma, quote or brace is missing.'
    )
  })

  test.each([
    [
      { kind: 'dollar-key', at: { line: 2, column: 3 } },
      'Couldn’t use the payload: the key at line 2, column 3 starts with $, which can’t be saved.'
    ],
    [
      { kind: 'not-an-object' },
      'Couldn’t use the payload: it must be a JSON object, in braces.'
    ],
    [
      { kind: 'too-large' },
      'The payload is too large: it must be 256 KiB or smaller once formatted.'
    ]
  ] as const)('%o', (problem, error) => {
    expect(
      toEditorState({ step: 'edit', note: '', text: '', revision: 1, problem })
        .error
    ).toBe(error)
  })

  test('unchanged and stale are alerts, not field errors', () => {
    expect(
      toEditorState({
        step: 'edit',
        note: '',
        text: '',
        revision: 1,
        problem: { kind: 'unchanged' }
      })
    ).toEqual(
      expect.objectContaining({ error: null, unchanged: true, stale: false })
    )
    expect(
      toEditorState({
        step: 'edit',
        note: '',
        text: '',
        revision: 1,
        problem: { kind: 'stale' }
      })
    ).toEqual(expect.objectContaining({ error: null, stale: true }))
  })
})

describe('toReviewState', () => {
  test('a number too large to keep warns once per line', () => {
    expect(
      toReviewState({
        step: 'review',
        text: '{\n  "a": [12345678901234567890, 12345678901234567891]\n}',
        revision: 1,
        note: '',
        noteProblem: null
      }).roundedLines
    ).toEqual([2])
  })

  test.each([
    ['missing', 'Say why you’re changing the payload'],
    ['too-long', 'Shorten the note to 500 characters or fewer']
  ] as const)('a %s note says how to fix it', (noteProblem, error) => {
    expect(
      toReviewState({
        step: 'review',
        text: '{}',
        revision: 1,
        note: '',
        noteProblem
      }).noteError
    ).toBe(error)
  })
})
