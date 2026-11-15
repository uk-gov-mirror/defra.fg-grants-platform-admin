import {
  timeRangeFilters,
  toRangeChip,
  toRangeInstants
} from './time-range.view-model.ts'

const now = new Date('2026-11-10T12:00:00.000Z')

const href = (window: object) =>
  `/list?${new URLSearchParams(window as Record<string, string>)}`

describe('toRangeInstants', () => {
  test('a day from the calendar is the whole day, in the zone the person reads times in', () => {
    expect(
      toRangeInstants({ from: '2026-07-01', to: '2026-07-02' }, 'Europe/London')
    ).toEqual({
      from: '2026-06-30T23:00:00.000Z',
      to: '2026-07-02T22:59:59.999Z'
    })
    expect(toRangeInstants({ from: '2026-07-01' }, 'UTC')).toEqual({
      from: '2026-07-01T00:00:00.000Z'
    })
  })

  test('a wall clock is read in the zone; an instant is kept as it is', () => {
    expect(
      toRangeInstants({ from: '2026-07-01T09:00' }, 'Europe/London').from
    ).toBe('2026-07-01T08:00:00.000Z')
    expect(
      toRangeInstants({ from: '2026-07-01T09:00:00.000Z' }, 'Europe/London')
        .from
    ).toBe('2026-07-01T09:00:00.000Z')
  })
})

describe('timeRangeFilters', () => {
  test.each(['2026-02-30', '2026-13-01T00:00'])('refuses %s', (value) => {
    expect(timeRangeFilters.from.validate(value).error).toBeDefined()
  })

  test.each(['2026-02-28', '2026-02-28T23:59', '2026-02-28T23:59:59', ''])(
    'takes %s',
    (value) => {
      expect(timeRangeFilters.from.validate(value).error).toBeUndefined()
    }
  )
})

describe('toRangeChip', () => {
  test('nothing chosen: Any time, first and ticked, then the quick ranges back from now', () => {
    const chip = toRangeChip({}, href, now, 'UTC')

    expect(chip.text).toBe('Any time')
    expect(chip.isSet).toBe(false)
    expect(chip.presets.map(({ text, checked }) => [text, checked])).toEqual([
      ['Any time', true],
      ['Last hour', false],
      ['Last 24 hours', false],
      ['Last 7 days', false],
      ['Last 30 days', false]
    ])
    expect(chip.presets[2].href).toBe(
      '/list?from=2026-11-09T12%3A00%3A00.000Z&range=24h'
    )
    expect(chip.max).toBe('2026-11-10')
  })

  test('a quick range names itself and is ticked', () => {
    const chip = toRangeChip(
      { from: '2026-11-03T12:00:00.000Z', range: '7d' },
      href,
      now,
      'UTC'
    )

    expect(chip.text).toBe('Last 7 days')
    expect(chip.start).toBeUndefined()
    expect(chip.presets[3].checked).toBe(true)
  })

  test('days: the range as the design system writes it, and the days for the calendar', () => {
    const chip = toRangeChip(
      { from: '2026-11-03', to: '2026-11-09' },
      href,
      now,
      'UTC'
    )

    expect(chip.text).toBe('3–9 Nov 2026')
    expect([chip.start, chip.end]).toEqual(['2026-11-03', '2026-11-09'])
  })

  test('one side only', () => {
    expect(toRangeChip({ from: '2026-11-03' }, href, now, 'UTC').text).toBe(
      'From 3 Nov 2026'
    )
    expect(toRangeChip({ to: '2026-11-09' }, href, now, 'UTC').text).toBe(
      'Until 9 Nov 2026'
    )
  })

  test('an instant falls on its day in the zone', () => {
    expect(
      toRangeChip(
        { from: '2026-11-02T23:30:00.000Z' },
        href,
        now,
        'Europe/London'
      ).start
    ).toBe('2026-11-02')
    expect(
      toRangeChip(
        { from: '2026-07-02T23:30:00.000Z' },
        href,
        now,
        'Europe/London'
      ).start
    ).toBe('2026-07-03')
  })

  test('a quick range this release doesn’t have is read as where it starts', () => {
    expect(
      toRangeChip(
        { from: '2026-11-10T06:00:00.000Z', range: '6h' },
        href,
        now,
        'UTC'
      ).text
    ).toBe('From 10 Nov 2026')
  })
})
