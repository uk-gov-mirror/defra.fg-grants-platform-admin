import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { toGasErrorField, toGasFailure, toGasStatusCode } from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type {
  Counterpart,
  ListTotal,
  Position,
  RecordEvents,
  RecordSectionError,
  RecordSeries,
  RecordTab,
  StoredDate
} from '../repositories/record-page.ts'
export { recordTabs } from '../repositories/record-page.ts'

export interface ListResult<P> {
  page: P
  unavailable: boolean
  /** No answer in time: GAS's 504 for CW, or a timeout here. */
  timedOut: boolean
  /** GAS itself sent nothing: a timeout here, or a connection dropped mid-request. */
  gasSilent?: true
  /** GAS answered with an error, CW's failures behind it included. Otherwise an unread list is one GAS couldn't be reached for. */
  errored: boolean
  refused: boolean
  /** GAS's own reason for a refusal: fixed text that never repeats what was sent. */
  refusal: string | null
}

const logListFailure = (name: string, refused: boolean, error: unknown) => {
  if (refused) {
    logger.warn(
      `fg-gas-backend refused the ${name} list parameters: ${describeError(error)}`
    )

    return
  }

  logger.error(
    `Could not read the ${name} list from fg-gas-backend: ${describeError(error)}`
  )
}

const isRefusal = (failure: GasFailure): boolean =>
  failure.kind === 'refused' && failure.statusCode === statusCodes.badRequest

const timedOutKinds = new Set<GasFailure['kind']>(['timed-out', 'no-answer'])

/** Any answer but a 400 or a timeout is an error GAS answered with, CW's included: its status is GAS's. */
const answeredKinds = new Set<GasFailure['kind']>([
  'refused',
  'errored',
  'cw-not-reached'
])

/** A list has one source, so any failure leaves it empty; a 400 is a bad link, not an outage. */
export const readList = async <P>(
  name: string,
  read: () => Promise<P>,
  empty: P
): Promise<ListResult<P>> => {
  try {
    return {
      page: await read(),
      unavailable: false,
      timedOut: false,
      errored: false,
      refused: false,
      refusal: null
    }
  } catch (error) {
    return toFailedList(name, error, empty)
  }
}

const toFailedList = <P>(
  name: string,
  error: unknown,
  empty: P
): ListResult<P> => {
  const failure = toGasFailure(error)
  const refused = isRefusal(failure)

  logListFailure(name, refused, error)

  return {
    page: empty,
    unavailable: !refused,
    timedOut: timedOutKinds.has(failure.kind),
    ...(failure.kind === 'no-answer' ? { gasSilent: true as const } : {}),
    errored: !refused && answeredKinds.has(failure.kind),
    refused,
    refusal: refused ? toGasErrorField(error, 'message') : null
  }
}

export type RecordOutcome = 'found' | 'not-found' | 'timed-out' | 'unavailable'

export interface RecordResult<P> {
  outcome: RecordOutcome
  page: P | null
}

/** A tab for a file the record has not got is hidden, not empty. */
export interface HiddenTab {
  outcome: 'hidden'
  page: null
}

/** Only the backend's own miss is a missing record; a bare 404 is a route GAS has not got. */
export const isMissing = (error: unknown, reason: string): boolean =>
  toGasStatusCode(error) === statusCodes.notFound &&
  toGasErrorField(error, 'reason') === reason

const toFailure = (error: unknown): RecordOutcome =>
  toGasStatusCode(error) === statusCodes.gatewayTimeout
    ? 'timed-out'
    : 'unavailable'

/** The ref is in the URL already, so no log line repeats it. */
export const readRecord = async <P>(
  name: string,
  read: () => Promise<P>,
  notFoundReason: string
): Promise<RecordResult<P>> => {
  try {
    return { outcome: 'found', page: await read() }
  } catch (error) {
    if (isMissing(error, notFoundReason)) {
      logger.info(`No such ${name} in fg-gas-backend`)

      return { outcome: 'not-found', page: null }
    }

    logger.error(
      `Could not read a ${name} from fg-gas-backend: ${describeError(error)}`
    )

    return { outcome: toFailure(error), page: null }
  }
}
