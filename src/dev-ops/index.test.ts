import type { Server } from '@hapi/hapi'
import type { Schema } from 'joi'

import { roles } from '../common/roles.ts'
import { statusCodes } from '../common/status-codes.ts'
import { plugins } from '../main.ts'
import { createServer } from '../server/index.ts'

// So that a scope check failing here cannot also fire the queue write this
// file exists to keep unauthorised hands off.
vi.mock(import('./use-cases/redrive-event.use-case.ts'))

interface Route {
  method: string
  url: string
}

const user = { name: 'Ada Lovelace' }

const applicationsAdminRole = 'FCP.GrantApplicationsAdmin'

const refusalSweepMs = 20_000

/** Any value will do: hapi checks auth before it validates a param. */
const address = (path: string) => path.replace(/\{[^}]+\}/g, 'x')

let server: Server

/**
 * Do not replace this with a list of paths, and do not narrow the server to one
 * plugin: reading the whole table is what makes a `/dev-ops` route added later
 * fail these tests, wherever in the app it is registered from.
 */
/** Dev Ops' signed out page is the one route a signed out visitor has to reach. */
const publicPaths = ['/dev-ops/signed-out']

const devOpsRoutes = (): Route[] =>
  server
    .table()
    .filter(({ path }) => path === '/dev-ops' || path.startsWith('/dev-ops/'))
    .filter(({ path }) => !publicPaths.includes(path))
    .map(({ method, path }) => ({ method, url: address(path) }))

const answers = async <T extends object>(
  inject: (route: Route) => Promise<T>,
  routes = devOpsRoutes()
) =>
  Promise.all(
    routes.map(async (route) => ({
      route: `${route.method.toUpperCase()} ${route.url}`,
      ...(await inject(route))
    }))
  )

const asUser = (scope: string[]) => async (route: Route) => {
  const { statusCode } = await server.inject({
    ...route,
    auth: { strategy: 'session', credentials: { user, scope } }
  })

  return { statusCode }
}

const anonymously = async (route: Route) => {
  const { statusCode, headers } = await server.inject(route)

  return { statusCode, location: headers.location }
}

const crossSite = async (route: Route) => {
  const { statusCode } = await server.inject({
    ...route,
    headers: { 'sec-fetch-site': 'cross-site' },
    auth: {
      strategy: 'session',
      credentials: { user, scope: [roles.grantOperationsAdmin] }
    }
  })

  return { statusCode }
}

const sameFor = <T>(given: { route: string }[], answer: T) =>
  given.map(({ route }) => ({ route, ...answer }))

describe('devOps', () => {
  beforeAll(async () => {
    server = await createServer()
    await server.register(plugins)
    await server.initialize()
  })

  afterAll(async () => {
    await server.stop()
  })

  test('serves the routes the rest of these tests answer for', () => {
    expect(devOpsRoutes()).not.toHaveLength(0)
  })

  test('serves its signed out page to a visitor with no session', async () => {
    const { statusCode, headers } = await server.inject('/dev-ops/signed-out')

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers.location).toBeUndefined()
    expect(
      server.table().filter(({ path }) => publicPaths.includes(path))
    ).toHaveLength(1)
  })

  test.each([
    ['holding only the applications admin role', [applicationsAdminRole]],
    ['holding no roles', []]
  ])(
    'refuses every route under /dev-ops a user %s',
    async (_name, scope) => {
      const given = await answers(asUser(scope))

      expect(given).toEqual(
        sameFor(given, { statusCode: statusCodes.forbidden })
      )
    },
    // Each refusal is a whole Dev Ops page, which hapi compiles afresh on every request outside production.
    refusalSweepMs
  )

  test('sends an anonymous visitor from every route under /dev-ops to sign in', async () => {
    const given = await answers(anonymously)

    expect(given).toEqual(
      sameFor(given, {
        statusCode: statusCodes.found,
        location: '/auth/login'
      })
    )
  })

  test(
    'refuses a cross-site POST to every route under /dev-ops',
    async () => {
      const given = await answers(
        crossSite,
        devOpsRoutes().filter(({ method }) => method === 'post')
      )

      expect(given).not.toHaveLength(0)
      expect(given).toEqual(
        sameFor(given, { statusCode: statusCodes.forbidden })
      )
    },
    refusalSweepMs
  )

  test('takes the shell’s Times param on every GET route under /dev-ops', () => {
    const gets = server
      .table()
      .filter(({ method }) => method === 'get')
      .filter(({ path }) => path === '/dev-ops' || path.startsWith('/dev-ops/'))
    const refusing = gets
      .filter(({ settings }) => {
        const query = settings.validate?.query as Schema | null | undefined

        return Boolean(query?.validate?.({ times: 'open' }).error)
      })
      .map(({ path }) => path)

    expect(gets).not.toHaveLength(0)
    expect(refusing).toEqual([])
  })
})
