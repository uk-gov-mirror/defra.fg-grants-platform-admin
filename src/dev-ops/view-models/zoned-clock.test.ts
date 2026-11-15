import { fromZonedInput, toDayClock, toZonedInput } from './zoned-clock.ts'

describe('the zoned clock', () => {
  const summer = new Date('2026-06-16T09:00:00Z')

  test.each([
    ['UTC', '2026-06-16T09:00:00', '16 Jun 09:00'],
    ['Europe/London', '2026-06-16T10:00:00', '16 Jun 10:00']
  ] as const)('writes an instant in %s', (zone, input, clock) => {
    expect(toZonedInput(summer, zone)).toBe(input)
    expect(toDayClock(summer, zone)).toBe(clock)
  })

  test.each([
    ['UTC', '2026-06-16T09:00:00'],
    ['Europe/London', '2026-06-16T10:00:00']
  ] as const)(
    'reads a box written in %s back to the same instant',
    (zone, input) => {
      expect(fromZonedInput(input, 'earliest', zone)).toEqual(summer)
    }
  )
})
