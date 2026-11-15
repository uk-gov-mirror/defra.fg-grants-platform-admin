import { toReplacedAlert, toSeries } from './record-series.ts'
import { toTimes } from './times.ts'

const times = toTimes('uk')

const hrefOf = (ref: string) => `/dev-ops/cases/woodland/${ref}`

const options = {
  current: 'b',
  source: 'CW',
  showClosed: true,
  hrefOf,
  times
}

const member = (
  ref: string,
  createdAt: string | null,
  closedAt: string | null = null
) => ({
  ref,
  createdAt,
  closedAt
})

const identity = (m: ReturnType<typeof member>) => m

describe('toSeries', () => {
  test('has a row per ref, oldest first, marking this one and the replaced ones', () => {
    const series = toSeries(
      {
        latestRef: 'c',
        refs: ['a', 'b', 'c'],
        members: [
          member('a', '2026-10-08T10:12:00.000Z', '2026-10-10T16:40:00.000Z'),
          member('b', '2026-10-10T16:40:00.000Z'),
          member('c', '2026-10-13T14:04:00.000Z')
        ]
      },
      identity,
      options
    )!

    expect(series.detailed).toBe(true)
    expect(series.showClosed).toBe(true)
    expect(series.description).toBe(
      'Oldest first. Each one replaces the one before it; CW only acts on the newest.'
    )
    expect(
      series.rows.map(({ ref, href, current, replaced }) => ({
        ref,
        href,
        current,
        replaced
      }))
    ).toEqual([
      { ref: 'a', href: hrefOf('a'), current: false, replaced: true },
      { ref: 'b', href: null, current: true, replaced: false },
      { ref: 'c', href: hrefOf('c'), current: false, replaced: false }
    ])
    expect(series.rows[0].created?.text).toBe('8\u00a0Oct 2026 11:12')
    expect(series.rows[0].closed?.text).toBe('10\u00a0Oct 2026 17:40')
    expect(series.rows[1].closed).toBeNull()
  })

  test('takes the last ref as the newest when GAS names none', () => {
    const series = toSeries(
      { latestRef: null, refs: ['a', 'b', 'c'] },
      identity,
      options
    )!

    expect(series.rows.map(({ replaced }) => replaced)).toEqual([
      true,
      false,
      false
    ])
  })

  test('says GAS sent only the refs when it sent no members', () => {
    const series = toSeries({ latestRef: 'b', refs: ['a', 'b'] }, identity, {
      ...options,
      source: 'GAS'
    })!

    expect(series.detailed).toBe(false)
    expect(series.description).toBe(
      'Oldest first. GAS sent only the references, so their dates aren’t shown. Open one to see it.'
    )
    expect(series.rows[0].created).toBeNull()
  })

  test('keeps a row, with nothing known, for a ref GAS sent no member for', () => {
    const series = toSeries(
      {
        latestRef: 'b',
        refs: ['a', 'b'],
        members: [member('b', '2026-10-10T16:40:00.000Z')]
      },
      identity,
      options
    )!

    expect(series.rows[1].known).toBe(true)
    expect(series.rows[0]).toMatchObject({
      known: false,
      ref: 'a',
      created: null,
      closed: null
    })
  })

  test.each([
    ['no series', null],
    ['one ref', { latestRef: 'b', refs: ['b'], members: [] }]
  ])('is no series with %s', (_, given) => {
    expect(toSeries(given, identity, options)).toBeNull()
  })
})

describe('toReplacedAlert', () => {
  const words = { current: 'b', noun: 'case', source: 'CW', hrefOf }

  test('names the newest, with a way to it, when this one was replaced', () => {
    expect(
      toReplacedAlert({ latestRef: 'c', refs: ['b', 'c'] }, words)
    ).toEqual({
      title: 'This case was replaced by c.',
      text: 'CW only acts on the newest in the series. This one is kept for its history.',
      action: { text: 'Open c', href: hrefOf('c') }
    })
  })

  test('takes the same newest as the Replaced badges when GAS names none', () => {
    const series = { latestRef: null, refs: ['a', 'b', 'c'] }
    const rows = toSeries(series, identity, options)!.rows

    expect(
      rows.filter(({ replaced }) => replaced).map(({ ref }) => ref)
    ).toEqual(['a'])
    expect(toReplacedAlert(series, words)?.title).toBe(
      'This case was replaced by c.'
    )
  })

  test.each([
    ['this is the newest', { latestRef: 'b', refs: ['a', 'b'] }],
    [
      'GAS names none and this is the last',
      { latestRef: null, refs: ['a', 'b'] }
    ],
    ['there is no series', null]
  ])('is none when %s', (_, series) => {
    expect(toReplacedAlert(series, words)).toBeNull()
  })
})
