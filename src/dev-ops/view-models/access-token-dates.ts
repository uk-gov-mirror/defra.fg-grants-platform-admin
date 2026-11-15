import {
  formatIn,
  fromZonedInput,
  partsOf,
  toZonedInput,
  ukZone
} from './zoned-clock.ts'

const hourMs = 3_600_000
export const dayMs = 24 * hourMs

/** The day it is in the UK at that instant, `yyyy-mm-dd`, as a date box holds it. */
export const toUkDate = (date: Date): string =>
  toZonedInput(date, ukZone).slice(0, 10)

/** 23:59:59 in the UK on that `yyyy-mm-dd`, summer or winter. */
export const toUkEndOfDay = (date: string): Date =>
  fromZonedInput(`${date}T23:59:59`, 'latest', ukZone)

/** `1 Sep 2027`: day-first from parts, with `en-US` months because `en-GB` writes `Sept`. */
const dayFormat = formatIn(ukZone, 'en-US', {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
})

/** An expiry as the day it falls on in the UK, always with its year: `2 Feb 2027`. */
export const toExpiryDay = (date: Date): string => {
  const parts = partsOf(dayFormat, date)

  return `${parts.day} ${parts.month} ${parts.year}`
}
