import { config } from '../../common/config.ts'
import { insufficientScope, statusCodes } from '../../common/status-codes.ts'
import { toSafeFrom } from './event-page.view-model.ts'

/** Each page Dev Ops answers with when it has nothing to show. */
export type StatusState =
  | 'not-found'
  | 'bad-request'
  | 'no-role'
  | 'refused'
  | 'error'
  | 'catalogue'

/** Only a missing role is about the user's roles; any other 403 refused the request itself. */
const toForbiddenState = (message: string): StatusState =>
  message === insufficientScope ? 'no-role' : 'refused'

const byCode: Record<number, (message: string) => StatusState> = {
  [statusCodes.badRequest]: () => 'bad-request',
  [statusCodes.notFound]: () => 'not-found',
  [statusCodes.forbidden]: toForbiddenState
}

export const toStatusState = (
  statusCode: number,
  message: string
): StatusState => byCode[statusCode]?.(message) ?? 'error'

const appOrigin = (): string => new URL(config.get('auth.appBaseUrl')).origin

const toUrl = (value: string): URL | null => {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

const toOwnPage = (url: URL | null): string | null =>
  url?.origin === appOrigin()
    ? toSafeFrom(`${url.pathname}${url.search}`) || null
    : null

/** The Dev Ops page the browser came from, for Back; none from anywhere else. */
export const toRefererBack = (referer: unknown): string | null =>
  typeof referer === 'string' ? toOwnPage(toUrl(referer)) : null

/** The page Dev Ops answers a catalogue it couldn't read with. */
export const catalogueUnavailableCode = statusCodes.serviceUnavailable

const titles: Record<StatusState, string> = {
  'not-found': 'Page not found',
  'bad-request': 'This link doesn’t work',
  'no-role': 'You don’t have access to Dev Ops',
  refused: 'This request was refused',
  error: 'Something went wrong',
  catalogue: 'Dev Ops couldn’t read its lists'
}

/** Without the role there is nothing in the navigation to use. */
const emptySidebar: StatusState[] = ['no-role']

export interface StatusRequest {
  method: string
  url: URL
  headers: Record<string, unknown>
  getTraceId?: () => string | undefined | null
}

export interface StatusPageModel {
  state: StatusState
  statusCode: number
  pageTitle: string
  emptySidebar: boolean
  backHref: string | null
  retryHref: string
  /** The id every log line of this request carries as `trace.id`, to quote to support. */
  reference: string | null
}

/** Try again repeats a read; after a write it goes back to the page the write was sent from. */
const toRetryHref = (request: StatusRequest, back: string | null): string =>
  request.method.toUpperCase() === 'GET'
    ? `${request.url.pathname}${request.url.search}`
    : (back ?? request.url.pathname)

export const toStatusPage = (
  request: StatusRequest,
  statusCode: number,
  state: StatusState
): StatusPageModel => {
  const backHref = toRefererBack(request.headers.referer)

  return {
    state,
    statusCode,
    pageTitle: titles[state],
    emptySidebar: emptySidebar.includes(state),
    backHref,
    retryHref: toRetryHref(request, backHref),
    reference: state === 'error' ? (request.getTraceId?.() ?? null) : null
  }
}
