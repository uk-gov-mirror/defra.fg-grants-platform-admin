import type { BucketEntry } from '../use-cases/get-catalogue.use-case.ts'
import type {
  EventAttempt,
  EventDetail
} from '../use-cases/get-event.use-case.ts'
import type { AttemptCount } from './attempt-count.ts'
import { toBucketHref } from './bucket-links.ts'
import {
  allSame,
  errorLine,
  lastAttemptOf,
  sameError,
  timeOf,
  toBlock,
  toRecordLink
} from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { isAfter, toGap } from './event-formats.ts'
import { hasNoAttemptsSinceEdit } from './payload-edit.ts'
import { toClockTime, toSecondsTime } from './times.ts'
import type { TimeText } from './times.ts'

export interface AttemptItem {
  title: string
  tone: 'danger' | 'warning'
  clock: TimeText | null
  gap: string | null
  /** Said where this attempt's error differs from the last. */
  differs: { message: string; stack: string | null } | null
  /** Said where errors differ but this one is the last's. */
  sameAsLast: boolean
}

export interface RedrivenSince {
  at: TimeText | null
  by: string
  service: string
  allowed: number | null
  error: string | null
}

export interface AttemptsModel {
  count: string | null
  errorsHref: string | null
  /** Redriven since the attempts, with none since. */
  redriven: RedrivenSince | null
  lead: string | null
  lastAt: TimeText | null
  block: string | null
  items: AttemptItem[]
  noAttemptsSinceEdit: boolean
}

export interface WhyItFailed {
  error: string
  sentence: string
  at: TimeText | null
  find: { text: string; href: string } | null
}

interface Anchor {
  at: string
  after: string
}

/** After creation, and not after the attempt it would be measured to. */
const isBetween = (redrive: string, { createdAt }: EventDetail, at: string) =>
  isAfter(redrive, createdAt) && !isAfter(redrive, at)

const redriveAnchor = (event: EventDetail, at: string): Anchor | null => {
  const redrive = event.lastRedrive?.at

  return redrive && isBetween(redrive, event, at)
    ? { at: redrive, after: 'the redrive' }
    : null
}

/** A redrive newer than creation starts the clock again for the attempt after it. */
const firstAnchor = (event: EventDetail, at: string): Anchor =>
  redriveAnchor(event, at) ?? { at: event.createdAt, after: 'it was created' }

const after = (from: string, at: string, what: string): string | null => {
  const gap = toGap(from, at)

  return gap && `${gap} after ${what}`
}

/** Unknown instants get no gap, and the next one is measured from the last known. */
const toGapText = (
  event: EventDetail,
  history: EventAttempt[],
  index: number
): string | null => {
  const at = history[index].at

  if (at === null) {
    return null
  }

  if (index === 0) {
    const anchor = firstAnchor(event, at)

    return after(anchor.at, at, anchor.after)
  }

  const previous = history
    .slice(0, index)
    .findLastIndex((attempt) => attempt.at !== null)

  return previous < 0
    ? null
    : after(history[previous].at!, at, `attempt ${previous + 1}`)
}

const toDiffers = (attempt: EventAttempt) => ({
  message: errorLine(attempt),
  stack: attempt.stack ? toBlock(attempt) : null
})

interface ItemContext {
  context: EventContext
  last: EventAttempt | null
  mixed: boolean
}

const isLastOf = (history: EventAttempt[], index: number) =>
  index === history.length - 1

/** No more retries follow a dead letter's last attempt, so it is "the last"; a retrying one's isn't. */
const toTitle = ({ state }: EventContext, index: number, isLast: boolean) =>
  `Attempt ${index + 1}${isLast && (state.deadLetter || state.purged) ? ', the last' : ''}`

const isSame = (attempt: EventAttempt, last: EventAttempt | null) =>
  last !== null && sameError(attempt, last)

/** Only a dead letter's newest failure ended it; every other one was retried. */
const toAttemptTone = (
  { state }: EventContext,
  isLast: boolean
): AttemptItem['tone'] => (isLast && state.deadLetter ? 'danger' : 'warning')

const toItem =
  ({ context, last, mixed }: ItemContext) =>
  (
    attempt: EventAttempt,
    index: number,
    history: EventAttempt[]
  ): AttemptItem => {
    const isLast = isLastOf(history, index)
    const same = isSame(attempt, last)

    return {
      title: toTitle(context, index, isLast),
      tone: toAttemptTone(context, isLast),
      clock: timeOf(attempt.at, context.times, toClockTime),
      gap: toGapText(context.event, history, index),
      differs: same ? null : toDiffers(attempt),
      sameAsLast: mixed && same && !isLast
    }
  }

const toItems = (context: EventContext): AttemptItem[] => {
  const history = context.event.attemptHistory
  const last = lastAttemptOf(context.event)
  const mixed =
    last !== null && history.some((attempt) => !sameError(attempt, last))

  return history.map(toItem({ context, last, mixed }))
}

const deadLetter = 'DEAD_LETTER'

const errorNameFact = 'lastError.name'

const offersDeadLetter = ({ name, values }: BucketEntry['facts'][number]) =>
  name === 'status' && (values ?? []).some(({ value }) => value === deadLetter)

/** A list can show every event with one error only if it filters by both the status and the error's name. */
const filtersByError = ({ facts }: BucketEntry): boolean =>
  facts.some(({ name }) => name === errorNameFact) &&
  facts.some(offersDeadLetter)

/** Its own queue, narrowed to dead letters with this error's name: the event detail has no error key to match exactly. */
const toErrorsHref = ({ event, ownList }: EventContext): string | null =>
  event.lastError && ownList && filtersByError(ownList)
    ? toBucketHref(ownList, {
        status: deadLetter,
        [errorNameFact]: event.lastError.name
      })
    : null

const countText = (made: number, count: AttemptCount | null) =>
  count && `${made} of ${count.allowed}`

const attemptStatuses = new Set([
  'DEAD_LETTER',
  'FAILED',
  'RESUBMITTED',
  'PURGED'
])

const errorOf = (event: EventDetail): string | null =>
  event.lastError && errorLine(event.lastError)

const toRedriven = (context: EventContext): AttemptsModel => {
  const { event, count, times, service } = context
  const redrive = event.lastRedrive!

  return {
    count: countText(0, count),
    errorsHref: null,
    redriven: {
      at: timeOf(redrive.at, times),
      by: redrive.by,
      service,
      allowed: count?.allowed ?? null,
      error: errorOf(event)
    },
    lead: null,
    lastAt: null,
    block: null,
    items: [],
    noAttemptsSinceEdit: hasNoAttemptsSinceEdit(event)
  }
}

const toLead = (event: EventDetail): string | null => {
  if (allSame(event)) {
    return 'All failed with the same error'
  }

  if (event.attemptHistory.length) {
    return `The last error, from attempt ${event.attemptHistory.length}`
  }

  return event.lastError && 'The last error'
}

const toBlockOf = (event: EventDetail): string | null => {
  const last = lastAttemptOf(event)

  return last ? toBlock(last) : errorOf(event)
}

const lastErrorAt = (event: EventDetail): string | null =>
  event.lastError?.at ?? null

const lastAtOf = (event: EventDetail): string | null =>
  lastAttemptOf(event)?.at ?? lastErrorAt(event)

const madeOf = ({ event, count }: EventContext): number =>
  count?.made ?? event.attemptHistory.length

const toFailing = (context: EventContext): AttemptsModel => {
  const { event, count, times } = context

  return {
    count: countText(madeOf(context), count),
    errorsHref: toErrorsHref(context),
    redriven: null,
    lead: toLead(event),
    lastAt: timeOf(lastAtOf(event), times, toSecondsTime),
    block: toBlockOf(event),
    items: toItems(context),
    noAttemptsSinceEdit: hasNoAttemptsSinceEdit(event)
  }
}

/** Drawn while the event has failed, been redriven or purged. */
export const toAttempts = (context: EventContext): AttemptsModel | null => {
  if (!attemptStatuses.has(context.event.status)) {
    return null
  }

  return context.state.redrivenSinceAttempts && context.event.lastRedrive
    ? toRedriven(context)
    : toFailing(context)
}

const listed = (numbers: number[]): string =>
  numbers.length === 1
    ? String(numbers[0])
    : `${numbers.slice(0, -1).join(', ')} and ${numbers.at(-1)}`

const matchingOf = (event: EventDetail): number[] => {
  const last = lastAttemptOf(event)

  return last
    ? event.attemptHistory.flatMap((attempt, index) =>
        sameError(attempt, last) ? [index + 1] : []
      )
    : []
}

/** What failed this way, and the words that lead to when it last did. */
const toSentence = (event: EventDetail): [string, string] => {
  const matching = matchingOf(event)
  const total = event.attemptHistory.length

  if (matching.length === 0) {
    return ['It failed with this error', ' at']
  }

  if (allSame(event)) {
    return [`Same error on all ${total} attempts`, ', the last at']
  }

  const attempts = matching.length === 1 ? 'Attempt' : 'Attempts'

  return [`${attempts} ${listed(matching)} failed with this error`, ', last at']
}

const toFind = (context: EventContext) => {
  const record = toRecordLink(context.event.record)

  return (
    record && {
      text: `Find ${record.title.toLowerCase()} ${record.text}`,
      href: record.href
    }
  )
}

/** Which attempts failed as the last did, and when the last of them was: no zone after the time. */
export const toWhy = (context: EventContext): WhyItFailed | null => {
  const { event, times } = context

  if (event.lastError === null) {
    return null
  }

  const at = timeOf(lastAtOf(event), times, toSecondsTime)
  const [sentence, when] = toSentence(event)

  return {
    error: errorLine(lastAttemptOf(event) ?? event.lastError),
    sentence: at ? `${sentence}${when}` : sentence,
    at,
    find: toFind(context)
  }
}
