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
import { cwNotReachedCode, toGasFailure } from './gas-status.ts'
import type { GasFailure } from './gas-status.ts'

export type { ApiToken, ClientService, KeepOld, ListedToken, TokenKey }

/**
 * Why a write did not happen, as far as this app can tell.
 *
 * - `refused`: GAS (or Caseworking, through it) answered with a 4xx, so nothing changed.
 * - `not-offered`: GAS answered 404 with no error code: it has no token routes, so nothing changed.
 * - `unreachable`: no connection was made, so nothing changed. With an
 *   `errorCode`, GAS answered but could not reach Caseworking at all.
 * - `errored`: GAS answered with a 5xx of its own, or the call failed some other
 *   way: the change may or may not have been made.
 * - `unknown`: no answer in time: the change may or may not have been made.
 *   GAS's 504 is its own wait for Caseworking; `gasSilent` is GAS sending
 *   nothing (a timeout here, or a connection dropped mid-request).
 * - `unchecked`: GAS answered, but the list a new token is checked against
 *   could not be read, so nothing was sent.
 */
export type TokenFailure =
  | { outcome: 'refused'; statusCode: number; errorCode: string | null }
  | { outcome: 'not-offered' }
  | { outcome: 'unreachable'; errorCode?: string }
  | { outcome: 'errored' }
  | { outcome: 'unknown'; gasSilent?: true }
  | { outcome: 'unchecked' }

/** The raw token lives in this result and in the page rendered from it, nowhere else. */
export type IssueResult =
  | { outcome: 'issued'; raw: string; token: ApiToken }
  | TokenFailure

/** A new token's result: or, before issuing, the client's active tokens, said once in case a rotation was meant. */
export type NewTokenResult =
  | IssueResult
  | { outcome: 'has-active'; active: number }

export type ListResult =
  | { outcome: 'done'; tokens: ListedToken[] }
  | TokenFailure

export type WriteResult = { outcome: 'done' } | TokenFailure

export type ExpiryResult = { outcome: 'done'; token: ApiToken } | TokenFailure

type Attempt<T> = { outcome: 'done'; value: T } | TokenFailure

/** GAS refuses with a code for every token or client it hasn't got, so a bare 404 is a route it hasn't got. */
const toRefusal = (
  statusCode: number,
  errorCode: string | null
): TokenFailure =>
  statusCode === statusCodes.notFound && errorCode === null
    ? { outcome: 'not-offered' }
    : { outcome: 'refused', statusCode, errorCode }

const tokenFailures: {
  [K in GasFailure['kind']]: (
    failure: Extract<GasFailure, { kind: K }>
  ) => TokenFailure
} = {
  'not-connected': () => ({ outcome: 'unreachable' }),
  'cw-not-reached': () => ({
    outcome: 'unreachable',
    errorCode: cwNotReachedCode
  }),
  refused: ({ statusCode, errorCode }) => toRefusal(statusCode, errorCode),
  errored: () => ({ outcome: 'errored' }),
  'timed-out': () => ({ outcome: 'unknown' }),
  'no-answer': () => ({ outcome: 'unknown', gasSilent: true })
}

const toFailure = (error: unknown): TokenFailure => {
  const failure = toGasFailure(error)

  return (tokenFailures[failure.kind] as (failure: GasFailure) => TokenFailure)(
    failure
  )
}

const logFailure = (
  what: string,
  failure: TokenFailure,
  error: unknown
): void => {
  if (failure.outcome === 'refused') {
    logger.warn(
      `Did not ${what}: ${failure.statusCode} ${failure.errorCode ?? 'with no error code'}`
    )
  } else if (failure.outcome === 'not-offered') {
    logger.warn(`Did not ${what}: fg-gas-backend has no access token routes`)
  } else {
    logger.error(`Could not ${what} in fg-gas-backend: ${describeError(error)}`)
  }
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

    logFailure(what, failure, error)

    return failure
  }
}

const toWhere = ({ service, clientId, tokenId }: TokenKey): string =>
  `${service}/${clientId}/${tokenId}`

/** GAS not reached at all, or not offering tokens, says so; any other failed read is one GAS answered for itself or for Caseworking. */
const saysWhy = (failure: TokenFailure): boolean =>
  failure.outcome === 'not-offered' ||
  (failure.outcome === 'unreachable' && !failure.errorCode)

const toUnchecked = (failure: TokenFailure): TokenFailure =>
  saysWhy(failure) ? failure : { outcome: 'unchecked' }

/** The failure says who didn't answer: GAS, or CW behind it. */
export const listAccessTokensUseCase = async (
  service: ClientService
): Promise<ListResult> => {
  const result = await attempt(`list ${service} access tokens`, () =>
    listTokens(service)
  )

  return result.outcome === 'done'
    ? { outcome: 'done', tokens: result.value }
    : result
}

const activeTokensOf = (tokens: ListedToken[], clientId: string): number =>
  tokens.filter(
    (token) => token.clientId === clientId && token.status === 'ACTIVE'
  ).length

/**
 * Creates the client as it issues when no row has its name yet. The list is
 * read first to tell; a client created or emptied in between is refused by
 * GAS as exists or not found, and nothing is issued. A client that already
 * has active tokens most likely wants a rotation, so unless `confirmed`, it
 * is answered with their count and nothing is issued.
 */
export const issueAccessTokenUseCase = async (
  service: ClientService,
  clientId: string,
  { expiresAt, confirmed }: { expiresAt: string | null; confirmed: boolean }
): Promise<NewTokenResult> => {
  const listed = await attempt(`list ${service} access tokens`, () =>
    listTokens(service)
  )

  if (listed.outcome !== 'done') {
    return toUnchecked(listed)
  }

  const active = activeTokensOf(listed.value, clientId)

  return active > 0 && !confirmed
    ? { outcome: 'has-active', active }
    : issueFor(service, clientId, {
        expiresAt,
        newClient: !listed.value.some((token) => token.clientId === clientId)
      })
}

const issueFor = async (
  service: ClientService,
  clientId: string,
  { expiresAt, newClient }: { expiresAt: string | null; newClient: boolean }
): Promise<IssueResult> => {
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
