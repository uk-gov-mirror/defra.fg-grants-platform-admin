import { statusCodes } from '../../common/status-codes.ts'

/**
 * The status fg-gas-backend answered with, dug out of the error `@hapi/wreck`
 * throws for it.
 *
 * Every failure the list page can meet is the same fact — it could not be read
 * — so that page never had to ask. A single event is different: a 404 is a
 * page of its own, a 409 is a sentence naming the status that refused a
 * redrive, and only the rest are "something is down". Boom carries the
 * upstream status on `output.statusCode`, and nothing else about the error is
 * safe to look at.
 */
export const toGasStatusCode = (error: unknown): number | null => {
  const output = (error as { output?: { statusCode?: unknown } })?.output

  return typeof output?.statusCode === 'number' ? output.statusCode : null
}

/**
 * A field of the backend's own response body.
 *
 * Read for exactly one thing: the status a 409 names. The body is never
 * logged and never rendered as markup — nunjucks escapes it like any other
 * string the endpoint passed through — and anything that is not a string is
 * treated as absent rather than coerced into one.
 */
const toGasErrorPayload = (error: unknown): unknown =>
  (error as { data?: { payload?: unknown } })?.data?.payload

const toGasErrorBody = (error: unknown): Record<string, unknown> => {
  const payload = toGasErrorPayload(error)

  return payload === null || typeof payload !== 'object'
    ? {}
    : (payload as Record<string, unknown>)
}

export const toGasErrorField = (
  error: unknown,
  field: string
): string | null => {
  const value = toGasErrorBody(error)[field]

  return typeof value === 'string' ? value : null
}

/** GAS's answer when it could not reach Caseworking at all, so nothing was sent on. */
export const cwNotReachedCode = 'CW_UNREACHABLE'

/**
 * How a call to GAS failed, as far as this app can tell. The app talks only
 * to GAS, CW's lists and tokens included, so every status is GAS's.
 *
 * - `not-connected`: no connection to GAS was made.
 * - `cw-not-reached`: GAS answered that it couldn't reach CW at all.
 * - `refused`: GAS, or CW through it, answered with a 4xx.
 * - `errored`: GAS answered with a 5xx of its own, its 502 for a CW failure included.
 * - `timed-out`: GAS's 504: it waited for CW, or whatever it called, in vain.
 * - `no-answer`: GAS sent nothing: a timeout here, or a connection dropped mid-request.
 *   Any other failure of the call is `errored`: GAS may have answered something unreadable.
 */
export type GasFailure =
  | { kind: 'not-connected' }
  | { kind: 'cw-not-reached' }
  | { kind: 'refused'; statusCode: number; errorCode: string | null }
  | { kind: 'errored' }
  | { kind: 'timed-out' }
  | { kind: 'no-answer' }

const neverConnectedCodes = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN'])

/** A connection that dropped or went quiet before GAS's answer came. */
const droppedCodes = new Set(['ECONNRESET', 'EPIPE', 'ETIMEDOUT'])

/** wreck boomifies a failed connection's socket error as a 502, keeping its code. */
const neverConnected = (error: unknown): boolean =>
  neverConnectedCodes.has(String((error as { code?: unknown })?.code))

/** Only a status GAS itself answered with is GAS's: wreck's own 408 or 504 is a read that timed out. */
const isResponseError = (error: unknown): boolean =>
  (error as { data?: { isResponseError?: unknown } })?.data?.isResponseError ===
  true

const isClientError = (statusCode: number | null): statusCode is number =>
  statusCode !== null &&
  statusCode >= statusCodes.badRequest &&
  statusCode < statusCodes.internalServerError

const toAnswered = (
  statusCode: number | null,
  errorCode: string | null
): GasFailure => {
  if (errorCode === cwNotReachedCode) {
    return { kind: 'cw-not-reached' }
  }

  if (isClientError(statusCode)) {
    return { kind: 'refused', statusCode, errorCode }
  }

  return statusCode === statusCodes.gatewayTimeout
    ? { kind: 'timed-out' }
    : { kind: 'errored' }
}

/** wreck's own timeouts are a 408 or 504 with no response; a dropped socket keeps its code. */
const isNoAnswer = (error: unknown): boolean =>
  droppedCodes.has(String((error as { code?: unknown })?.code)) ||
  [statusCodes.requestTimeout, statusCodes.gatewayTimeout].includes(
    toGasStatusCode(error) ?? 0
  )

export const toGasFailure = (error: unknown): GasFailure => {
  if (neverConnected(error)) {
    return { kind: 'not-connected' }
  }

  if (isResponseError(error)) {
    return toAnswered(
      toGasStatusCode(error),
      toGasErrorField(error, 'errorCode')
    )
  }

  return isNoAnswer(error) ? { kind: 'no-answer' } : { kind: 'errored' }
}
