import type { Request, ResponseToolkit, Server, ServerRoute } from '@hapi/hapi'
import type { OidcToken } from '@defra/hapi-auth-oidc'
import type { OutgoingHttpHeaders } from 'node:http'

import { createServer } from '../../index.ts'
import { statusCodes } from '../../../common/status-codes.ts'
import { redirectCookieName } from './redirect-cookie.ts'
import { destinationsOf } from './test-utils.ts'

const protectedRoute: ServerRoute = {
  method: 'GET',
  path: '/protected',
  options: { auth: 'session' },
  handler: (request: Request) => request.auth.credentials.user.name
}

const getRawCookie = (headers: OutgoingHttpHeaders, name: string) =>
  (headers['set-cookie'] as string[])?.find((cookie) =>
    cookie.startsWith(`${name}=`)
  )

const getCookie = (headers: OutgoingHttpHeaders, name: string) =>
  getRawCookie(headers, name)?.split(';')[0]

/** Bounded so that a chain that loops ends the test rather than the run. */
const maxHops = 4

const follow = async (start: string, cookie: string) => {
  const visited: string[] = []
  let url = start

  while (visited.length < maxHops) {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url,
      headers: { cookie }
    })

    visited.push(url)
    if (statusCode !== statusCodes.found) {
      return visited
    }
    url = headers.location as string
  }

  return visited
}

let server: Server

describe('auth', () => {
  beforeAll(async () => {
    server = await createServer()
    server.route(protectedRoute)
    await server.initialize()

    // Stands in for the code-for-token exchange with Entra ID.
    server.plugins['hapi-auth-oidc'].oidc.callback = async () => ({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      idToken: 'id-token',
      claims: { name: 'Ada Lovelace' }
    })

    // Refreshing against Entra ID is ./session-scheme.test.ts's subject, not
    // this file's.
    server.plugins['hapi-auth-oidc'].oidc.ensureValidToken = async (
      _request: Request,
      token: OidcToken
    ) => ({ token, refreshed: false })
  })

  afterAll(async () => {
    await server.stop()
  })

  test('hands an anonymous user at the login path to the identity provider', async () => {
    const authorizeUrl = 'https://login.microsoftonline.com/authorize'

    server.plugins['hapi-auth-oidc'].oidc.login = async (
      _request: Request,
      h: ResponseToolkit
    ) => h.redirect(authorizeUrl)

    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: '/auth/login'
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(authorizeUrl)
  })

  test('remembers the requested page across the login round trip', async () => {
    const protectedPage = await server.inject({
      method: 'GET',
      url: '/protected?ref=email'
    })

    const redirectCookie = getCookie(protectedPage.headers, redirectCookieName)
    expect(redirectCookie).toBeDefined()

    const rawCookie = getRawCookie(protectedPage.headers, redirectCookieName)
    expect(rawCookie).toEqual(expect.stringContaining('HttpOnly'))

    const { statusCode, payload } = await server.inject({
      method: 'POST',
      url: '/auth/callback',
      headers: { cookie: redirectCookie }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(destinationsOf(payload).refresh).toBe('/protected?ref=email')
  })

  test('lands on the home page when no page was requested', async () => {
    const { statusCode, payload } = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(destinationsOf(payload).refresh).toBe('/')
  })

  // A redirect here would be a cross-site initiated navigation, and the browser
  // would withhold the Strict session cookie set alongside it.
  test('answers with a page rather than a redirect, carrying the session cookie', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers.location).toBeUndefined()
    expect(headers['content-type']).toEqual(
      expect.stringContaining('text/html')
    )
    const sessionCookie = getRawCookie(headers, 'session')
    expect(sessionCookie).toEqual(expect.stringContaining('SameSite=Strict'))
    expect(sessionCookie).toEqual(expect.stringContaining('HttpOnly'))
  })

  test('leaves the page uncached and under the content security policy', async () => {
    const { headers } = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    expect(headers['cache-control']).toBe('no-store')
    expect(headers['content-security-policy']).toEqual(
      expect.stringContaining("default-src 'self'")
    )
  })

  test('renders nothing of the session it has just created', async () => {
    const { headers, payload } = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    const sessionValue = getCookie(headers, 'session')?.split('=')[1] as string

    for (const secret of [
      'access-token',
      'refresh-token',
      'id-token',
      'Ada Lovelace',
      sessionValue
    ]) {
      expect(payload).not.toEqual(expect.stringContaining(secret))
    }
  })

  test('signs the user in, granting access to the protected page', async () => {
    const callback = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    const sessionCookie = getCookie(callback.headers, 'session')

    const { statusCode, result } = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: sessionCookie }
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(result).toEqual(expect.stringContaining('Ada Lovelace'))
  })

  test('clears the session on logout', async () => {
    const callback = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    const sessionCookie = getCookie(callback.headers, 'session')

    const logout = await server.inject({
      method: 'GET',
      url: '/auth/logout',
      headers: { cookie: sessionCookie }
    })

    expect(logout.statusCode).toBe(statusCodes.found)
    expect(logout.headers.location).toBe('/auth/signed-out')

    const afterLogout = await server.inject({
      method: 'GET',
      url: '/protected',
      headers: { cookie: sessionCookie }
    })

    expect(afterLogout.statusCode).toBe(statusCodes.found)
    expect(afterLogout.headers.location).toBe('/auth/login')
  })

  test.each([
    [
      'an area asks for its own signed out page',
      '/dev-ops/signed-out',
      '/dev-ops/signed-out'
    ],
    ['next names a page elsewhere', 'https://example.com/', '/auth/signed-out'],
    [
      'next names a path that is no signed out page',
      '/dev-ops',
      '/auth/signed-out'
    ]
  ])('lands logout where %s', async (_case, next, location) => {
    const { headers } = await server.inject({
      method: 'GET',
      url: `/auth/logout?next=${encodeURIComponent(next)}`
    })

    expect(headers.location).toBe(location)
  })

  test('serves the signed out page to a visitor with no session at all', async () => {
    const { statusCode, headers, payload } = await server.inject({
      method: 'GET',
      url: '/auth/signed-out'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers.location).toBeUndefined()
    expect(payload).toEqual(expect.stringContaining('Signed out'))
    expect(destinationsOf(payload).link).toBe('/auth/login')
  })

  test('clears the browser cache on the signed out page, so Back shows no list', async () => {
    const { headers } = await server.inject({
      method: 'GET',
      url: '/auth/signed-out'
    })

    expect(headers['clear-site-data']).toBe('"cache"')
  })

  test('ends signing out on a page, not back inside the app', async () => {
    const callback = await server.inject({
      method: 'POST',
      url: '/auth/callback'
    })

    const visited = await follow(
      '/auth/logout',
      getCookie(callback.headers, 'session') as string
    )

    expect(visited).toEqual(['/auth/logout', '/auth/signed-out'])
  })
})
