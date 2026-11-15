import {
  noteMaxLength,
  purgeReasons,
  toPurgeFormError,
  toPurgeNote,
  toPurgeReasonLabel
} from './purge-form.ts'

const submission = (reasonCode: string, note = '') => ({ reasonCode, note })

describe('purgeReasons', () => {
  test('offers the three the backends accept, Other last', () => {
    expect(purgeReasons.map(({ value }) => value)).toEqual([
      'BROKEN_PAYLOAD',
      'SENT_IN_ERROR',
      'OTHER'
    ])
    expect(purgeReasons.map(({ label }) => label)).toEqual([
      'Payload is broken',
      'Sent in error',
      'Other'
    ])
  })
})

describe('toPurgeReasonLabel', () => {
  test.each([
    ['BROKEN_PAYLOAD', 'Payload is broken'],
    ['SENT_IN_ERROR', 'Sent in error'],
    ['OTHER', 'Other']
  ])('reads %s as %s', (code, label) => {
    expect(toPurgeReasonLabel(code)).toBe(label)
  })

  test('shows a code it has no label for as it arrived', () => {
    expect(toPurgeReasonLabel('SUPERSEDED')).toBe('SUPERSEDED')
  })
})

describe('toPurgeNote', () => {
  test('reads a CRLF break as the one character it was counted as', () => {
    expect(toPurgeNote('one\r\ntwo\r\nthree')).toBe('one\ntwo\nthree')
  })

  test('leaves a note of exactly the limit at the limit', () => {
    const note = ['x'.repeat(249), 'y'.repeat(250)].join('\n')

    expect(note).toHaveLength(noteMaxLength)
    expect(toPurgeNote(note.replace(/\n/g, '\r\n'))).toHaveLength(noteMaxLength)
  })

  test('trims it after the breaks are folded, so a note of space is none', () => {
    expect(toPurgeNote('  \r\n  ')).toBe('')
  })

  test('leaves a lone carriage return and a lone newline alone', () => {
    expect(toPurgeNote('one\rtwo\nthree')).toBe('one\rtwo\nthree')
  })
})

describe('toPurgeFormError', () => {
  test.each(['BROKEN_PAYLOAD', 'SENT_IN_ERROR'])(
    'accepts %s with no note',
    (reasonCode) => {
      expect(toPurgeFormError(submission(reasonCode))).toBeNull()
    }
  )

  test('accepts Other with a note', () => {
    expect(
      toPurgeFormError(submission('OTHER', 'sent by the retired form'))
    ).toBeNull()
  })

  test('accepts a note exactly at the limit', () => {
    expect(
      toPurgeFormError(submission('OTHER', 'x'.repeat(noteMaxLength)))
    ).toBeNull()
  })

  test('asks for a reason when none was chosen', () => {
    expect(toPurgeFormError(submission(''))).toEqual({
      field: 'reason',
      message: 'Choose a reason'
    })
  })

  test('asks for a reason when the code is not one of the three', () => {
    expect(toPurgeFormError(submission('SUPERSEDED'))?.field).toBe('reason')
  })

  test('asks for a note when the reason is Other', () => {
    expect(toPurgeFormError(submission('OTHER'))).toEqual({
      field: 'note',
      message: 'Say why: the reason is Other'
    })
  })

  test('asks for a shorter note past the limit', () => {
    expect(
      toPurgeFormError(submission('BROKEN_PAYLOAD', 'x'.repeat(501)))
    ).toEqual({
      field: 'note',
      message: 'Shorten the note to 500 characters or fewer'
    })
  })

  test('reports the missing reason before the note that is too long', () => {
    expect(toPurgeFormError(submission('', 'x'.repeat(501)))?.field).toBe(
      'reason'
    )
  })
})
