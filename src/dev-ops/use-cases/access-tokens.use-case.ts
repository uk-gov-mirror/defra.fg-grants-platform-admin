import { describeError } from '../../common/describe-error.ts'
import { logger } from '../../common/logger.ts'
import { statusCodes } from '../../common/status-codes.ts'
import type {
  ApiToken,
  ClientService,
  KeepOld,
  ListedToken,
  TokenKey
} from '../repositories/clients.repository.ts'
import {
  changeTokenExpiry,
  deleteToken,
  issueToken,
  listTokens,
  revokeToken,
  rotateToken
} from '../repositories/clients.repository.ts'
import { generateToken } from './generate-token.ts'
import {
  cwNotReachedCode,
  toGasErrorField,
  toGasStatusCode
} from './gas-status.ts'

export type { ApiToken, ClientService, KeepOld, ListedToken, TokenKey }

/**
 * Why a write did not happen, as far as this app can tell.
 *
 * - `refused`: GAS (or Caseworking, through it) answered with a 4xx, so nothing changed.
 * - `unreachable`: no connection was made, so nothing changed. With an
 *   `errorCode`, GAS answered but could not reach Caseworking at all.
 * - `unknown`: a timeout or a 5xx: the change may or may not have been made.
 * - `unchecked`: GAS answered, but the list a new token is checked against
 *   could not be read, so nothing was sent.
 */
export type TokenFailure =
  | { outcome: 'refused'; statusCode: number; errorCode: string | null }
  | { outcome: 'unreachable'; errorCode?: string }
  | { outcome: 'unknown' }
  | { outcome: 'unchecked' }

/** The raw token lives in this result and in the page rendered from it, nowhere else. */
export type IssueResult =
  | { outcome: 'issued'; raw: string; token: ApiToken }
  | TokenFailure

export type WriteResult = { outcome: 'done' } | TokenFailure

export type ExpiryResult = { outcome: 'done'; token: ApiToken } | TokenFailure

type Attempt<T> = { outcome: 'done'; value: T } | TokenFailure

const neverConnectedCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/** wreck boomifies a failed connection's socket error as a 502, keeping its code. */
const neverConnected = (error: unknown): boolean =>
  neverConnectedCodes.has(String((error as { code?: unknown })?.code))

/** Only a status the backend itself answered with says nothing changed: wreck's own 408 is a read that timed out. */
const isResponseError = (error: unknown): boolean =>
  (error as { data?: { isResponseError?: unknown } })?.data?.isResponseError ===
  true

const isClientError = (statusCode: number | null): statusCode is number =>
  statusCode !== null &&
  statusCode >= statusCodes.badRequest &&
  statusCode < statusCodes.internalServerError

const toRefusal = (error: unknown): TokenFailure | null => {
  const statusCode = toGasStatusCode(error)

  return isResponseError(error) && isClientError(statusCode)
    ? {
        outcome: 'refused',
        statusCode,
        errorCode: toGasErrorField(error, 'errorCode')
      }
    : null
}

const cwNotReached = (error: unknown): boolean =>
  isResponseError(error) &&
  toGasErrorField(error, 'errorCode') === cwNotReachedCode

const toFailure = (error: unknown): TokenFailure => {
  if (neverConnected(error)) {
    return { outcome: 'unreachable' }
  }

  return cwNotReached(error)
    ? { outcome: 'unreachable', errorCode: cwNotReachedCode }
    : (toRefusal(error) ?? { outcome: 'unknown' })
}

/** Names the token by its address alone: no hash, hint or raw value is ever logged. */
const attempt = async <T>(
  what: string,
  write: () => Promise<T>
): Promise<Attempt<T>> => {
  try {
    return { outcome: 'done', value: await write() }
  } catch (error) {
    const failure = toFailure(error)

    if (failure.outcome === 'refused') {
      logger.warn(
        `Did not ${what}: ${failure.statusCode} ${failure.errorCode ?? 'with no error code'}`
      )
    } else {
      logger.error(
        `Could not ${what} in fg-gas-backend: ${describeError(error)}`
      )
    }

    return failure
  }
}

const toWhere = ({ service, clientId, tokenId }: TokenKey): string =>
  `${service}/${clientId}/${tokenId}`

/** GAS not reached at all says so; any other failed read is one GAS answered for itself or for Caseworking. */
const toUnchecked = (failure: TokenFailure): TokenFailure =>
  failure.outcome === 'unreachable' && !failure.errorCode
    ? failure
    : { outcome: 'unchecked' }

/** Null when the list could not be read, for any reason. */
export const listAccessTokensUseCase = async (
  service: ClientService
): Promise<ListedToken[] | null> => {
  const result = await attempt(`list ${service} access tokens`, () =>
    listTokens(service)
  )

  return result.outcome === 'done' ? result.value : null
}

/**
 * Creates the client as it issues when no row has its name yet. The list is
 * read first to tell; a client created or emptied in between is refused by
 * GAS as exists or not found, and nothing is issued.
 */
export const issueAccessTokenUseCase = async (
  service: ClientService,
  clientId: string,
  expiresAt: string | null
): Promise<IssueResult> => {
  const listed = await attempt(`list ${service} access tokens`, () =>
    listTokens(service)
  )

  if (listed.outcome !== 'done') {
    return toUnchecked(listed)
  }

  const tokens = listed.value
  const newClient = !tokens.some((token) => token.clientId === clientId)
  const { raw, hash, hint } = generateToken()
  const result = await attempt(`issue a token for ${service}/${clientId}`, () =>
    issueToken(
      service,
      clientId,
      { tokenHash: hash, tokenHint: hint },
      { expiresAt, newClient }
    )
  )

  return result.outcome === 'done'
    ? { outcome: 'issued', raw, token: result.value }
    : result
}

export const rotateAccessTokenUseCase = async (
  key: TokenKey,
  keepOld: KeepOld
): Promise<IssueResult> => {
  const { raw, hash, hint } = generateToken()
  const result = await attempt(`rotate token ${toWhere(key)}`, () =>
    rotateToken(key, { tokenHash: hash, tokenHint: hint }, keepOld)
  )

  return result.outcome === 'done'
    ? { outcome: 'issued', raw, token: result.value }
    : result
}

export const changeTokenExpiryUseCase = async (
  key: TokenKey,
  expiresAt: string | null
): Promise<ExpiryResult> => {
  const result = await attempt(
    `change the expiry of token ${toWhere(key)}`,
    () => changeTokenExpiry(key, expiresAt)
  )

  return result.outcome === 'done'
    ? { outcome: 'done', token: result.value }
    : result
}

const toWriteResult = (result: Attempt<void>): WriteResult =>
  result.outcome === 'done' ? { outcome: 'done' } : result

export const revokeAccessTokenUseCase = async (
  key: TokenKey
): Promise<WriteResult> =>
  toWriteResult(
    await attempt(`revoke token ${toWhere(key)}`, () => revokeToken(key))
  )

export const deleteAccessTokenUseCase = async (
  key: TokenKey
): Promise<WriteResult> =>
  toWriteResult(
    await attempt(`delete token ${toWhere(key)}`, () => deleteToken(key))
  )
