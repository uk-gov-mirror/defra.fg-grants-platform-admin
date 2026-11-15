import type { Request, ResponseToolkit, Server, ServerRoute } from '@hapi/hapi'

import { oidc } from './oidc.ts'
import { sessionScheme } from './session-scheme.ts'
import {
  redirectCookieName,
  redirectCookieOptions,
  takeRedirectTo
} from './redirect-cookie.ts'
import { clearAuthSession, setAuthSession } from './session.ts'
import { continuePage } from './continue-page.ts'
import { signedOutPage } from './signed-out-page.ts'
import {
  loginCallbackPath,
  loginPath,
  logoutPath,
  signedOutPath,
  signedOutPaths
} from './paths.ts'

const loginRoute: ServerRoute = {
  method: 'GET',
  path: loginPath,
  options: {
    auth: false as const
  },
  handler(request: Request, h: ResponseToolkit) {
    return request.login(h)
  }
}

/**
 * Where Entra ID returns the user. `request.callback` validates state, nonce
 * and the PKCE verifier before swapping the code for tokens, so the handler
 * body only ever runs for a request that passed those checks.
 *
 * Both methods are accepted because the response mode follows the cookie
 * security setting: `form_post` over HTTPS, a `query` redirect over plain HTTP.
 *
 * It ends in a page rather than a redirect; see ./continue-page.ts.
 */
const loginCallbackRoute: ServerRoute = {
  method: ['GET', 'POST'],
  path: loginCallbackPath,
  options: {
    auth: false as const
  },
  async handler(request: Request, h: ResponseToolkit) {
    const credentials = await request.callback(h)

    setAuthSession(request, credentials)

    // The content type is left to hapi: blankie adds no content security
    // policy to a response whose type the handler set itself.
    return h
      .response(continuePage(takeRedirectTo(request, h)))
      .header('cache-control', 'no-store')
  }
}

/** Only a signed out page this app serves: `next` is never an open redirect. */
const toSignedOutPath = (next: unknown): string =>
  signedOutPaths.find((path) => path === next) ?? signedOutPath

// The Entra ID session is left alone, so a user who logs back in is signed
// straight in again without re-entering credentials.
const logoutRoute: ServerRoute = {
  method: 'GET',
  path: logoutPath,
  options: {
    auth: false as const
  },
  handler(request: Request, h: ResponseToolkit) {
    clearAuthSession(request)

    return h.redirect(toSignedOutPath(request.query.next))
  }
}

/**
 * `auth: false` is the whole of this route: a signed out user has no session,
 * so anything that asked for one would send them to Entra ID, which still
 * holds its own and would sign them back in without a prompt.
 */
const signedOutRoute: ServerRoute = {
  method: 'GET',
  path: signedOutPath,
  options: {
    auth: false as const
  },
  handler(_request: unknown, h: ResponseToolkit) {
    // Back on a shared machine must not bring a list back from the cache.
    return h.response(signedOutPage()).header('clear-site-data', '"cache"')
  }
}

/**
 * Everything this app does about authentication: the OIDC handshake with Entra
 * ID, the `session` strategy that route protection is declared against, and
 * the routes a user signs in and out through.
 */
export const auth = {
  plugin: {
    name: 'auth',
    dependencies: ['@hapi/yar'],
    async register(server: Server) {
      await server.register(oidc)

      server.state(redirectCookieName, redirectCookieOptions)

      const schemeName = 'oidc-session'

      // Named but not made the server default, so a route is anonymous unless
      // it opts in with `options.auth`.
      server.auth.scheme(schemeName, sessionScheme)
      server.auth.strategy('session', schemeName)

      server.route([
        loginRoute,
        loginCallbackRoute,
        logoutRoute,
        signedOutRoute
      ])
    }
  }
}
