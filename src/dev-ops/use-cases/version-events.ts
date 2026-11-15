import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import type { SourceError } from '../repositories/events.repository.ts'
import type { RecordEvents } from './record-reads.ts'

interface EventsRead {
  events?: RecordEvents | null
  sourceErrors?: SourceError[]
}

/** The Event row is never worth holding Overview up for. */
export const versionEventsTimeoutMs = 1500

const timedOut = Symbol('timed out')

const within = <T>(
  read: Promise<T>,
  ms: number
): Promise<T | typeof timedOut> =>
  Promise.race([
    read,
    new Promise<typeof timedOut>((resolve) => {
      setTimeout(() => resolve(timedOut), ms).unref?.()
    })
  ])

/** GAS answers an inbox it couldn't read with no rows and the hop in `sourceErrors`: that is unread, never empty. */
const toEvents = (read: EventsRead): RecordEvents | null =>
  read.sourceErrors?.length ? null : (read.events ?? null)

interface EventsAnswer {
  events: RecordEvents | null
  problem?: string
}

const answerOf = async (
  name: string,
  read: () => Promise<EventsRead>
): Promise<EventsAnswer> => {
  try {
    const answer = await within(read(), versionEventsTimeoutMs)

    return answer === timedOut
      ? {
          events: null,
          problem: `The ${name}'s events took too long; Overview went on without them`
        }
      : { events: toEvents(answer) }
  } catch (error) {
    return {
      events: null,
      problem: `Could not read the ${name}'s events from fg-gas-backend: ${describeError(error)}`
    }
  }
}

/**
 * A version's own events, for the Details' Event row, as GAS keeps no event ID
 * on the version. Overview reads them beside the version, so it waits on one
 * GAS round trip rather than two, and nothing is said of them until the
 * version is found.
 */
export const readOverviewEvents = async (
  tab: string,
  name: string,
  read: () => Promise<EventsRead>
): Promise<EventsAnswer | undefined> =>
  tab === 'overview' ? answerOf(name, read) : undefined

/** Says why a found version's events couldn't be shown, when they couldn't. */
export const logUnreadEvents = (answer: EventsAnswer | undefined) => {
  if (answer?.problem) {
    logger.warn(answer.problem)
  }
}

/**
 * The found page with its events, null when they couldn't be read or not in
 * time: the rest of the page stands without them.
 */
export const withEvents = <P extends object>(
  page: P,
  answer: EventsAnswer | undefined
): P => (answer === undefined ? page : { ...page, events: answer.events })
