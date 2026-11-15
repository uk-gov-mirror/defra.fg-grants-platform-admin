import { ukZone } from './zoned-clock.ts'
import type {
  SummaryRead,
  SummaryResult
} from '../use-cases/summarise-bucket.use-case.ts'
import {
  errorsSummary,
  outboxBucket,
  summarisedBucket
} from '../use-cases/test-fixtures.ts'
import { drawnSummaries, toSummarySections } from './bucket-summaries.ts'

const now = new Date('2026-10-09T09:20:00.000Z')

const result = (overrides: Partial<SummaryResult> = {}): SummaryResult => ({
  bucket: 'gas.outbox',
  summary: 'errors',
  entries: [
    {
      values: {
        'lastError.name': 'TimeoutError',
        eventType: 'UpdateCaseStatus'
      },
      count: 100000,
      capped: true,
      firstAt: '2026-10-01T08:00:00.000Z',
      lastAt: '2026-10-09T09:14:03.120Z'
    },
    {
      values: { 'lastError.name': null, eventType: null },
      count: 1,
      capped: false,
      firstAt: null,
      lastAt: null
    }
  ],
  more: false,
  complete: true,
  ...overrides
})

const answered = (page: SummaryResult | null = result()): SummaryRead => ({
  page,
  unavailable: page === null,
  refused: false,
  refusal: null
})

const sections = (read: SummaryRead = answered(), filters = {}) =>
  toSummarySections(
    summarisedBucket,
    [{ summary: errorsSummary, read }],
    filters,
    ukZone,
    now
  )

describe('drawnSummaries', () => {
  test('draws none on a list that declares none', () => {
    expect(drawnSummaries(outboxBucket, {})).toEqual([])
  })

  test.each([
    ['nothing is filtered', {}],
    ['the list is narrowed to the rows it counts', { status: 'DEAD_LETTER' }],
    ['another fact is filtered', { eventType: 'UpdateCaseStatus' }],
    ['its own value is filtered', { 'lastError.name': 'TimeoutError' }]
  ])('draws a summary while %s', (_name, filters) => {
    expect(drawnSummaries(summarisedBucket, filters)).toEqual([errorsSummary])
  })

  test('draws none while the list is narrowed to rows it does not count', () => {
    expect(drawnSummaries(summarisedBucket, { status: 'COMPLETED' })).toEqual(
      []
    )
  })
})

describe('toSummarySections', () => {
  test('is titled as declared with how many groups it found, and headed by each fact it counts and when each was first and last seen', () => {
    expect(sections()[0]).toMatchObject({
      id: 'errors',
      title: 'Top errors (2 groups)',
      valueLabels: ['Error name', 'Event'],
      firstLabel: 'First seen',
      lastLabel: 'Last seen',
      unavailable: false,
      notes: []
    })
    expect(
      sections(answered(result({ entries: result().entries.slice(0, 1) })))[0]
        .title
    ).toBe('Top errors (1 group)')
  })

  test('links an entry to the same list under what the summary counts among and each of its values', () => {
    const [entry] = sections()[0].entries

    expect(entry).toMatchObject({
      cells: [
        { text: 'TimeoutError', missing: false },
        { text: 'UpdateCaseStatus', missing: false }
      ],
      countLabel: '100,000+',
      href: '/dev-ops/events/gas/outbox?status=DEAD_LETTER&event=UpdateCaseStatus&error=TimeoutError'
    })
    expect(entry.first).toMatchObject({ instant: '2026-10-01T08:00:00Z' })
    expect(entry.last).toMatchObject({ instant: '2026-10-09T09:14:03.120Z' })
  })

  test('keeps the time range and the shown facts in the link, and drops every other filter', () => {
    const [entry] = sections(answered(), {
      eventType: 'UpdateCaseStatus',
      'lastError.name': 'OtherError',
      show: 'eventType',
      from: '2026-10-08T09:20:00.000Z',
      range: '24h'
    })[0].entries

    expect(entry.href).toBe(
      '/dev-ops/events/gas/outbox?status=DEAD_LETTER&event=UpdateCaseStatus&error=TimeoutError&audit=on&from=2026-10-08T09%3A20%3A00.000Z&range=24h'
    )
  })

  test('names the rows that hold no value as declared, with no link a filter could not follow', () => {
    expect(sections()[0].entries[1]).toMatchObject({
      cells: [
        { text: 'No error recorded', missing: true },
        { text: '—', missing: true }
      ],
      href: null,
      countLabel: '1',
      first: { instant: '' },
      last: { instant: '' }
    })
  })

  test('says when entries were left off, and when not every value was counted', () => {
    expect(
      sections(answered(result({ more: true, complete: false })))[0].notes
    ).toEqual([
      'Showing the 20 most frequent.',
      'There are more distinct values than were counted.'
    ])
  })

  test("keeps a summary that found nothing, saying so in what it counts among and the list's own noun", () => {
    expect(sections(answered(result({ entries: [] })))).toEqual([
      expect.objectContaining({
        title: 'Top errors',
        entries: [],
        emptyText: 'No dead letter events.'
      })
    ])
    expect(
      sections(answered(result({ entries: [] })), {
        from: '2026-10-08T09:20:00.000Z'
      })[0].emptyText
    ).toBe('No dead letter events in this time range.')
  })

  test('says so, by its declared name, when it could not be read', () => {
    expect(sections(answered(null))).toEqual([
      expect.objectContaining({
        title: 'Top errors',
        unavailable: true,
        entries: []
      })
    ])
  })
})
