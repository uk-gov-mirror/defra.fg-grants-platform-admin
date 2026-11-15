import {
  applicationsBucket,
  auditedOutbox
} from '../use-cases/test-fixtures.ts'
import {
  fromUrlQuery,
  repeatedKeys,
  toUrlQuery,
  unknownValues,
  unknownKeys
} from './bucket-urls.ts'

describe('toUrlQuery', () => {
  test('spells each fact by its key, several values as a list, and keeps the time range', () => {
    expect(
      toUrlQuery(auditedOutbox, {
        status: ['DEAD_LETTER', 'FAILED'],
        'lastError.name': 'TypeError',
        from: '2026-10-08T12:00:00.000Z',
        range: '24h'
      })
    ).toEqual({
      status: ['DEAD_LETTER', 'FAILED'],
      event: undefined,
      grant: undefined,
      error: 'TypeError',
      from: '2026-10-08T12:00:00.000Z',
      to: undefined,
      range: '24h'
    })
  })

  test('spells the same fact by each list’s own key', () => {
    expect(toUrlQuery(applicationsBucket, { code: ['example-grant'] })).toEqual(
      expect.objectContaining({ grant: ['example-grant'] })
    )
  })
})

describe('fromUrlQuery', () => {
  test('reads each key back to its fact: a fact with offered values as a list, any other as one value', () => {
    expect(
      fromUrlQuery(auditedOutbox, {
        event: 'Audit',
        status: ['DEAD_LETTER', 'FAILED', 'DEAD_LETTER', ''],
        error: 'TypeError',
        range: '24h'
      })
    ).toEqual({
      eventType: ['Audit'],
      status: ['DEAD_LETTER', 'FAILED'],
      'lastError.name': 'TypeError',
      range: '24h'
    })
  })

  test('reads a fact that takes one value from the first, when the address repeats it', () => {
    expect(fromUrlQuery(auditedOutbox, { error: ['A', 'B'] })).toEqual({
      'lastError.name': 'A'
    })
  })

  test('reads no key it does not declare', () => {
    expect(
      fromUrlQuery(auditedOutbox, { eventType: 'Audit', audit: 'on' })
    ).toEqual({})
  })
})

describe('unknownKeys', () => {
  test('names every key the list does not declare, the old audit switch’s among them', () => {
    expect(
      unknownKeys(auditedOutbox, {
        status: ['FAILED', 'DEAD_LETTER'],
        eventType: 'Audit',
        show: 'eventType',
        audit: 'on',
        from: '2026-10-08T12:00:00.000Z',
        colour: 'x'
      })
    ).toEqual(['eventType', 'show', 'audit', 'colour'])
  })
})

describe('repeatedKeys', () => {
  test('names a key given twice for a fact that takes one value, not one whose values are offered', () => {
    expect(
      repeatedKeys(auditedOutbox, {
        status: ['FAILED', 'DEAD_LETTER'],
        error: ['A', 'B'],
        event: 'Audit'
      })
    ).toEqual(['error'])
  })
})

describe('unknownValues', () => {
  test('names a key whose value its fact doesn’t offer', () => {
    expect(
      unknownValues(auditedOutbox, {
        status: ['FAILED', 'BOGUS'],
        event: 'Audit',
        error: 'anything'
      })
    ).toEqual(['status'])
  })
})
