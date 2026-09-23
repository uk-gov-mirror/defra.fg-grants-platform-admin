import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  EventDetail,
  EventKey
} from '../repositories/events.repository.ts'
import { findEvent } from '../repositories/events.repository.ts'
import { toGasStatusCode } from './gas-status.ts'

export type {
  EventDetail,
  EventKey,
  EventLastEdit,
  EventLastPurge
} from '../repositories/events.repository.ts'

export type EventOutcome = 'found' | 'not-found' | 'timed-out' | 'unavailable'

export interface EventResult {
  outcome: EventOutcome
  event: EventDetail | null
}

const notFound: EventResult = {
  outcome: 'not-found',
  event: null
}
const unavailable: EventResult = {
  outcome: 'unavailable',
  event: null
}
const timedOut: EventResult = {
  outcome: 'timed-out',
  event: null
}

export const getEventUseCase = async (key: EventKey): Promise<EventResult> => {
  try {
    return { outcome: 'found', event: await findEvent(key) }
  } catch (error) {
    const where = `${key.service}/${key.box}/${key.id}`

    if (toGasStatusCode(error) === statusCodes.notFound) {
      logger.info(`No event ${where} in fg-gas-backend`)

      return notFound
    }

    logger.error(
      `Could not read event ${where} from fg-gas-backend: ${describeError(error)}`
    )

    return toGasStatusCode(error) === statusCodes.gatewayTimeout
      ? timedOut
      : unavailable
  }
}
