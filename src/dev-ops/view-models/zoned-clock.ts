/** Wall clocks in the zone a page writes its times in. Free of server modules, so the browser can format with them too. */

/**
 * The zones a person can choose to read times in (the account menu's Times).
 * Named zones rather than fixed offsets, so UK time follows the clocks by
 * itself. The instant behind each time is carried by the `<time datetime>`
 * attribute, which stays UTC.
 */
export type Zone = 'UTC' | 'Europe/London'

/** The zone a rule is stated in rather than a choice: GAS and CW end a token's day at 23:59:59 UK time. */
export const ukZone: Zone = 'Europe/London'

const formats = new Map<string, Intl.DateTimeFormat>()

/** One formatter per locale, options and zone, built on first use. */
export const formatIn = (
  zone: Zone,
  locale: string,
  options: Intl.DateTimeFormatOptions
): Intl.DateTimeFormat => {
  const key = `${zone} ${locale} ${JSON.stringify(options)}`
  const known = formats.get(key)

  if (known) {
    return known
  }

  const format = new Intl.DateTimeFormat(locale, { ...options, timeZone: zone })
  formats.set(key, format)

  return format
}

export const partsOf = (
  format: Intl.DateTimeFormat,
  date: Date
): Record<string, string> =>
  Object.fromEntries(
    format
      .formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value])
  )

/** `2026-09-16T09:00:00`: the digits a `datetime-local` box carries. */
const inputOptions: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
}

/** An instant as the zone's wall clock, `yyyy-mm-ddThh:mm:ss`; whole seconds, which is all a range box carries. */
export const toZonedInput = (date: Date, zone: Zone): string => {
  const parts = partsOf(formatIn(zone, 'en-CA', inputOptions), date)

  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`
}

/**
 * Measured, never assumed: BST and GMT differ by an hour and the switch moves.
 * Read at the whole second, because `toZonedInput` spells no milliseconds —
 * subtracting like from like leaves the offset exact for any instant.
 */
const zoneOffsetMs = (instant: Date, zone: Zone): number => {
  const whole = instant.getTime() - instant.getUTCMilliseconds()

  return Date.parse(`${toZonedInput(new Date(whole), zone)}Z`) - whole
}

export const msPerSecond = 1000
export const secondsPerMinute = 60
export const minutesPerHour = 60
export const hoursPerDay = 24
export const msPerMinute = msPerSecond * secondsPerMinute
export const msPerDay = msPerMinute * minutesPerHour * hoursPerDay

/** Far enough either side of a wall clock to read the offset past any clock change near it. */
const offsetProbeMs = msPerDay / 2

/** Which end of an hour the clocks hand out twice a given box should take. */
export type ZonedEdge = 'earliest' | 'latest'

/**
 * The instants that really are this wall clock: two on the autumn morning the
 * hour repeats, none in the spring hour that never happens, one otherwise.
 */
const instantsFor = (wallClockMs: number, zone: Zone): Date[] => {
  const offsets = [-offsetProbeMs, offsetProbeMs].map((shift) =>
    zoneOffsetMs(new Date(wallClockMs + shift), zone)
  )

  return [...new Set(offsets)]
    .map((offset) => new Date(wallClockMs - offset))
    .filter(
      (instant) =>
        zoneOffsetMs(instant, zone) === wallClockMs - instant.getTime()
    )
}

/**
 * The reverse of `toZonedInput`, taking back the same `yyyy-mm-ddThh:mm:ss`
 * digits it hands out. An ambiguous hour widens the range rather than dropping
 * events from it: the `from` box takes the first time the clock reads that,
 * the `to` box the second. An hour that never happened has no instant to take,
 * so the wall clock is read against the offset in force *before* the change,
 * which lands it just after — 01:30 on a spring morning becomes 02:30.
 */
export const fromZonedInput = (
  wallClock: string,
  edge: ZonedEdge,
  zone: Zone
): Date => {
  const wallClockMs = Date.parse(`${wallClock}Z`)
  const instants = instantsFor(wallClockMs, zone)

  if (instants.length === 0) {
    const provisional = new Date(
      wallClockMs - zoneOffsetMs(new Date(wallClockMs), zone)
    )

    return new Date(wallClockMs - zoneOffsetMs(provisional, zone))
  }

  const pick = edge === 'earliest' ? Math.min : Math.max

  return new Date(pick(...instants.map((instant) => instant.getTime())))
}
