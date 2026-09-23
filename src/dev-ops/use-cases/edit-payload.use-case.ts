import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  EventKey,
  PayloadEdit
} from '../repositories/events.repository.ts'
import { editPayload } from '../repositories/events.repository.ts'
import { toGasErrorField, toGasStatusCode } from './gas-status.ts'

/**
 * `conflict`: the event can no longer be edited, so the page names the state it is in.
 * `stale`: someone saved first; the revision this edit was made against is gone.
 * `refused`: the backend answered and would not take the payload, with its reason when it gave one.
 */
export type EditOutcome =
  | 'saved'
  | 'conflict'
  | 'stale'
  | 'refused'
  | 'not-found'
  | 'timed-out'
  | 'unavailable'

export interface EditResult {
  outcome: EditOutcome
  /** Only a conflict reports one. */
  status: string | null
  /** Only a refusal reports one, and only when the backend named it. */
  reason: string | null
}

/** A timeout leaves the save's outcome unknown: the owning service may still have applied it. */
const failureOutcomes: Record<number, EditOutcome> = {
  [statusCodes.notFound]: 'not-found',
  [statusCodes.preconditionFailed]: 'stale',
  [statusCodes.unprocessableEntity]: 'refused',
  [statusCodes.gatewayTimeout]: 'timed-out'
}

const isClientError = (statusCode: number): boolean =>
  statusCode >= statusCodes.badRequest &&
  statusCode < statusCodes.internalServerError

/** Any other 4xx is still an answer, so it is never read as the backend being down. */
const toFailureOutcome = (statusCode: number | null): EditOutcome => {
  if (statusCode === null) {
    return 'unavailable'
  }

  return (
    failureOutcomes[statusCode] ??
    (isClientError(statusCode) ? 'refused' : 'unavailable')
  )
}

const toStatus = (error: unknown): string | null =>
  toGasErrorField(error, 'statusLabel') ?? toGasErrorField(error, 'status')

const toOutcome = (error: unknown): EditResult => {
  const statusCode = toGasStatusCode(error)

  if (statusCode === statusCodes.conflict) {
    return { outcome: 'conflict', status: toStatus(error), reason: null }
  }

  const outcome = toFailureOutcome(statusCode)

  return {
    outcome,
    status: null,
    reason: outcome === 'refused' ? toGasErrorField(error, 'reason') : null
  }
}

/** The backend answered: the event moved on, went away, was edited first or the payload was refused. */
const answeredOutcomes = new Set<EditOutcome>([
  'conflict',
  'stale',
  'refused',
  'not-found'
])

const toLevel = (outcome: EditOutcome): 'info' | 'warn' | 'error' => {
  if (outcome === 'saved') {
    return 'info'
  }

  return answeredOutcomes.has(outcome) ? 'warn' : 'error'
}

/**
 * One line whatever happened, naming the event and the outcome and nothing
 * else: the payload, the note, a parse message and the changed paths all
 * stay out of the log, and so does the error, whose body the backend wrote.
 */
const logOutcome = (key: EventKey, { outcome }: EditResult) => {
  logger[toLevel(outcome)](
    `Edited event ${key.service}/${key.box}/${key.id}: ${outcome}`
  )
}

/** `actor` goes to the backend on `x-actor`, so `lastEdit` names a person. */
export const editPayloadUseCase = async (
  key: EventKey,
  edit: PayloadEdit,
  actor?: string
): Promise<EditResult> => {
  const result = await editPayload(key, edit, actor).then(
    (): EditResult => ({ outcome: 'saved', status: null, reason: null }),
    toOutcome
  )

  logOutcome(key, result)

  return result
}
