import { ukZone } from './zoned-clock.ts'
import {
  isIsoInstant,
  fromZonedInput,
  toClock,
  toPreciseInstant,
  toTimestamp,
  toZonedInput
} from './event-formats.ts'

/**
 * The clocks these tests turn on: BST began 2026-03-29T01:00Z and ended
 * 2026-10-25T01:00Z. Every instant is written in UTC and every wall clock in
 * Europe/London, which is the whole point of the module.
 */
const at = (instant: string) => new Date(instant)

describe('toZonedInput', () => {
  test.each([
    ['2026-06-16T10:10:00.000Z', '2026-06-16T11:10:00'],
    ['2026-01-16T10:10:00.000Z', '2026-01-16T10:10:00']
  ])('reads %s as the UK wall clock %s', (instant, wallClock) => {
    expect(toZonedInput(at(instant), ukZone)).toBe(wallClock)
  })

  test('follows the clocks across the spring change rather than an offset', () => {
    expect(toZonedInput(at('2026-03-29T00:59:59.000Z'), ukZone)).toBe(
      '2026-03-29T00:59:59'
    )
    expect(toZonedInput(at('2026-03-29T01:00:00.000Z'), ukZone)).toBe(
      '2026-03-29T02:00:00'
    )
  })

  test('repeats the hour the autumn change hands out twice', () => {
    expect(toZonedInput(at('2026-10-25T00:30:00.000Z'), ukZone)).toBe(
      '2026-10-25T01:30:00'
    )
    expect(toZonedInput(at('2026-10-25T01:30:00.000Z'), ukZone)).toBe(
      '2026-10-25T01:30:00'
    )
  })

  test('spells whole seconds, which is all a range box carries', () => {
    expect(toZonedInput(at('2026-06-16T10:10:00.250Z'), ukZone)).toBe(
      '2026-06-16T11:10:00'
    )
  })
})

describe('fromZonedInput', () => {
  test.each([
    ['2026-06-16T09:00:00', '2026-06-16T08:00:00.000Z'],
    ['2026-01-16T09:00:00', '2026-01-16T09:00:00.000Z']
  ])('reads the box %s as the instant %s', (wallClock, instant) => {
    expect(fromZonedInput(wallClock, 'earliest', ukZone).toISOString()).toBe(
      instant
    )
    expect(fromZonedInput(wallClock, 'latest', ukZone).toISOString()).toBe(
      instant
    )
  })

  test('widens an ambiguous hour rather than dropping events from it', () => {
    const repeated = '2026-10-25T01:30:00'

    expect(fromZonedInput(repeated, 'earliest', ukZone).toISOString()).toBe(
      '2026-10-25T00:30:00.000Z'
    )
    expect(fromZonedInput(repeated, 'latest', ukZone).toISOString()).toBe(
      '2026-10-25T01:30:00.000Z'
    )
  })

  test('takes an hour that never happened to just after the change', () => {
    const never = '2026-03-29T01:30:00'

    for (const edge of ['earliest', 'latest'] as const) {
      const instant = fromZonedInput(never, edge, ukZone)

      expect(instant.toISOString()).toBe('2026-03-29T01:30:00.000Z')
      expect(toZonedInput(instant, ukZone)).toBe('2026-03-29T02:30:00')
    }
  })

  test.each([
    ['2026-06-16T09:00:00'],
    ['2026-01-16T09:00:00'],
    ['2026-10-25T01:30:00'],
    ['2026-12-31T23:59:59']
  ])('round-trips %s back through toZonedInput', (wallClock) => {
    expect(
      toZonedInput(fromZonedInput(wallClock, 'earliest', ukZone), ukZone)
    ).toBe(wallClock)
    expect(
      toZonedInput(fromZonedInput(wallClock, 'latest', ukZone), ukZone)
    ).toBe(wallClock)
  })

  test('lands the first instant of each change on the hour it is named by', () => {
    expect(
      fromZonedInput('2026-03-29T02:00:00', 'earliest', ukZone).toISOString()
    ).toBe('2026-03-29T01:00:00.000Z')
    expect(
      fromZonedInput('2026-10-25T02:00:00', 'latest', ukZone).toISOString()
    ).toBe('2026-10-25T02:00:00.000Z')
  })
})

describe('isIsoInstant', () => {
  test.each([
    '2026-06-16T10:00:00Z',
    '2026-06-16T10:00:00.123Z',
    '2026-06-16T10:00Z',
    '2026-06-16T11:00:00+01:00'
  ])('reads %s as an instant', (value) => {
    expect(isIsoInstant(value)).toBe(true)
  })

  test.each([
    '',
    '16/06/2026',
    '2026-06-16 10:00',
    '2026-06-16',
    '2026-06-16T10:00:00',
    '2026-02-30T10:00:00Z',
    '2026-06-16T24:00:00Z'
  ])('does not read %j as an instant', (value) => {
    expect(isIsoInstant(value)).toBe(false)
  })
})

describe('toPreciseInstant', () => {
  test('states the UK wall clock to the millisecond, with no zone suffix', () => {
    expect(toPreciseInstant(at('2026-06-16T10:10:00.000Z'), ukZone)).toBe(
      '16 Jun 2026 11:10:00.000'
    )
    expect(toPreciseInstant(at('2026-01-16T10:10:00.000Z'), ukZone)).toBe(
      '16 Jan 2026 10:10:00.000'
    )
  })

  test('keeps the milliseconds of the instant, which the zone does not move', () => {
    expect(toPreciseInstant(at('2026-06-16T10:10:00.007Z'), ukZone)).toBe(
      '16 Jun 2026 11:10:00.007'
    )
  })
})

describe('toClock', () => {
  const now = at('2026-06-16T12:00:00.000Z')

  test('says the UK wall clock alone within a day', () => {
    expect(toClock(at('2026-06-16T10:10:05.000Z'), now, ukZone)).toBe(
      '11:10:05'
    )
  })

  test('replaces the seconds with the date past a day', () => {
    expect(toClock(at('2026-06-14T10:10:05.000Z'), now, ukZone)).toBe(
      '14 Jun 11:10'
    )
  })
})

describe('toTimestamp', () => {
  test('carries the instant in UTC and the precise clock in UK time', () => {
    expect(
      toTimestamp(
        '2026-06-16T10:10:00.000Z',
        at('2026-06-16T10:12:00.000Z'),
        ukZone
      )
    ).toEqual({
      text: '2m ago',
      instant: '2026-06-16T10:10:00Z',
      precise: '16 Jun 2026 11:10:00.000'
    })
  })

  test.each([[null], ['not a date']])('says nothing of %j', (value) => {
    expect(toTimestamp(value, at('2026-06-16T10:12:00.000Z'), ukZone)).toEqual({
      text: '-',
      instant: '',
      precise: ''
    })
  })
})
