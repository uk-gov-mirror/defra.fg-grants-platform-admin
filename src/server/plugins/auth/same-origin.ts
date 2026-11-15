import Boom from '@hapi/boom'
import type { Request, ResponseToolkit, ServerRoute } from '@hapi/hapi'

import { config } from '../../../common/config.ts'

interface OriginHeaders {
  'sec-fetch-site'?: string
  origin?: string
}

const appOrigin = (): string => new URL(config.get('auth.appBaseUrl')).origin

/** Null for a header the browser did not send. */
const checks = ({ 'sec-fetch-site': site, origin }: OriginHeaders) => [
  site === undefined ? null : site === 'same-origin',
  origin === undefined ? null : origin === appOrigin()
]

/**
 * A request this app's own pages sent. The session cookie's SameSite=Strict
 * still rides along on a request from any other CDP frontend, because every
 * `*.cdp-int.defra.cloud` site is the same site as this one. So a write that
 * mints or revokes credentials also asks the browser where it came from: at
 * least one of the two headers, and nothing either says against it.
 */
export const isSameOrigin = (headers: OriginHeaders): boolean => {
  const said = checks(headers).filter((check) => check !== null)

  return said.length > 0 && said.every(Boolean)
}

export const requireSameOrigin = (request: Request, h: ResponseToolkit) => {
  if (!isSameOrigin(request.headers)) {
    throw Boom.forbidden('Cross-origin write refused')
  }

  return h.continue
}

/** Runs before these routes validate what was sent, so a refusal is always a 403. */
export const sameOriginOnly = (routes: ServerRoute[]): ServerRoute[] =>
  routes.map((route) => ({
    ...route,
    options: {
      ...route.options,
      ext: { onPostAuth: { method: requireSameOrigin } }
    }
  }))
