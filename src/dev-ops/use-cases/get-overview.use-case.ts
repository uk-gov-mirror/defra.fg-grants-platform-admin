import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type { Overview } from '../repositories/overview.repository.ts'
import { getOverview } from '../repositories/overview.repository.ts'
import { toGasFailure } from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type {
  ConfigFailed,
  DeadLetters,
  FailedVersion,
  ListLink,
  Overview,
  OverviewCount,
  OverviewPart,
  OverviewSourceError,
  PerService,
  TokensExpiring,
  TopError,
  TopErrors
} from '../repositories/overview.repository.ts'

/**
 * - `read`: GAS answered, each part read or saying why not.
 * - `not-offered`: GAS answered 404 with no error code: a GAS without the overview.
 * - `failed`: GAS couldn't be reached, or didn't answer, or answered with an error.
 */
export type OverviewResult =
  | { outcome: 'read'; overview: Overview }
  | { outcome: 'not-offered' }
  | { outcome: 'failed'; failure: GasFailure }

const isNotOffered = (failure: GasFailure): boolean =>
  failure.kind === 'refused' &&
  failure.statusCode === statusCodes.notFound &&
  failure.errorCode === null

export const getOverviewUseCase = async (): Promise<OverviewResult> => {
  try {
    return { outcome: 'read', overview: await getOverview() }
  } catch (error) {
    const failure = toGasFailure(error)

    if (isNotOffered(failure)) {
      logger.warn('fg-gas-backend has no overview route')

      return { outcome: 'not-offered' }
    }

    logger.error(
      `Could not read the overview from fg-gas-backend: ${describeError(error)}`
    )

    return { outcome: 'failed', failure }
  }
}
