import { load } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { DefinitionFetchResult } from '../use-cases/definition-fetches.ts'
import { fetchGrantDefinitionsUseCase } from '../use-cases/fetch-grant-definitions.use-case.ts'
import type {
  DefinitionFileType,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/fetch-grant-definitions.use-case.ts'))
vi.mock(import('../use-cases/get-grant-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-grant-page.use-case.ts')
  >('../use-cases/get-grant-page.use-case.ts')),
  getGrantPageUseCase: vi.fn()
}))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const page = '/dev-ops/grants/woodland-creation/2.0.0'
const path = `${page}/fetch`
const from = '/dev-ops/grants?status=draft'

const pending = { stored: false, fetchStatus: 'pending' } as const
const fetched = { stored: true, fetchStatus: 'fetched' } as const

const header: GrantVersionPage['header'] = {
  code: 'woodland-creation',
  version: '2.0.0',
  status: 'draft',
  receivedAt: '2026-10-15T10:04:00.000Z',
  files: { grant: fetched, agreement: fetched, payment: fetched },
  versions: [
    {
      version: '2.0.0',
      status: 'draft',
      receivedAt: '2026-10-15T10:04:00.000Z'
    },
    {
      version: '1.2.0',
      status: 'active',
      receivedAt: '2026-10-10T16:25:00.000Z'
    }
  ],
  counterpart: null
}

const givenOutcome = (result: DefinitionFetchResult<DefinitionFileType>) =>
  vi.mocked(fetchGrantDefinitionsUseCase).mockResolvedValue(result)

const givenFiles = (files: GrantVersionPage['header']['files']) =>
  vi.mocked(getGrantPageUseCase).mockImplementation(async ({ version }) => ({
    outcome: 'found',
    page: {
      header: { ...header, version, files },
      overview: null,
      sourceErrors: [],
      sectionErrors: []
    }
  }))

const allStored: DefinitionFetchResult<DefinitionFileType> = {
  outcome: 'fetched',
  files: [
    { file: 'grant', outcome: 'stored' },
    { file: 'agreement', outcome: 'stored' },
    { file: 'payment', outcome: 'stored' }
  ]
}

const fetch = async (payload: object | undefined = {}, url = path) =>
  server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials },
    headers: { 'sec-fetch-site': 'same-origin' }
  })

const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  (response.headers['set-cookie'] as string[])[0].split(';')[0]

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The page the browser is sent to, carrying only the session cookie. */
const follow = async (cookie: string, url = page) => {
  const { result } = await server.inject({
    method: 'GET',
    url,
    headers: { cookie },
    auth: { strategy: 'session', credentials }
  })
  const $ = load(result as unknown as string)

  return {
    alerts: $('[data-testid="version-alert"]')
      .toArray()
      .map((alert) => ({
        tone: /gpa-alert-(\w+)/.exec($(alert).attr('class') ?? '')?.[1],
        text: flatten(
          `${$(alert).find('.gpa-alert-title').text()} ${$(alert).find('.gpa-alert-title').next().text()}`
        ),
        action: flatten($(alert).find('.gpa-alert-actions').text())
      })),
    toast: flatten($('[data-testid="toast"]').text()),
    toastRegions: $('.gpa-toast-region').length,
    tabFetch: flatten($('[data-testid="tab-fetch"]').text())
  }
}

/** The write, then the page it redirects to, exactly as a browser does it. */
const fetchAndFollow = async (payload: object = {}) => {
  const written = await fetch(payload)
  const cookie = sessionCookie(written)

  return { cookie, ...(await follow(cookie, written.headers.location)) }
}

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenOutcome(allStored)
  givenFiles({ grant: fetched, agreement: fetched, payment: fetched })
})

afterAll(async () => {
  await server.stop()
})

describe('fetchGrantDefinitionsRoute', () => {
  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: path,
      payload: {}
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(fetchGrantDefinitionsUseCase).not.toHaveBeenCalled()
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: path,
      payload: {},
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(fetchGrantDefinitionsUseCase).not.toHaveBeenCalled()
  })

  test('refuses a Fetch posted from another site', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: path,
      payload: {},
      auth: { strategy: 'session', credentials },
      headers: { 'sec-fetch-site': 'cross-site' }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(fetchGrantDefinitionsUseCase).not.toHaveBeenCalled()
  })

  test('fetches the version in the URL, for the signed in operator', async () => {
    await fetch()

    expect(fetchGrantDefinitionsUseCase).toHaveBeenCalledTimes(1)
    expect(fetchGrantDefinitionsUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '2.0.0' },
      'Ada Lovelace'
    )
  })

  test('goes back to the same tab of the version, and the list it was opened from', async () => {
    const { statusCode, headers } = await fetch({ back: from, tab: 'raw' })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(
      `${page}?tab=raw&back=${encodeURIComponent(from)}`
    )
  })

  test('goes back to Overview from a page still on the old Events tab', async () => {
    const { statusCode, headers } = await fetch({ back: from, tab: 'events' })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?back=${encodeURIComponent(from)}`)
  })

  test('accepts a POST with no body, going back to the Overview tab', async () => {
    const { statusCode, headers } = await fetch(undefined)

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(page)
  })

  test('drops a back that leaves the admin', async () => {
    const { headers } = await fetch({ back: 'https://example.com/' })

    expect(headers.location).toBe(page)
  })

  test.each([
    ['a tab the grant page has not got', { tab: 'answers' }, path],
    [
      'a version with no patch',
      {},
      '/dev-ops/grants/woodland-creation/2.0/fetch'
    ]
  ])('refuses %s', async (_name, payload, url) => {
    const { statusCode } = await fetch(payload, url)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(fetchGrantDefinitionsUseCase).not.toHaveBeenCalled()
  })

  test('toasts the definitions stored, once', async () => {
    const { cookie, alerts, toast, toastRegions } = await fetchAndFollow()

    expect(toast).toBe('Definitions stored for woodland-creation@2.0.0')
    expect(toastRegions).toBe(1)
    expect(alerts).toEqual([])
    expect(await follow(cookie)).toMatchObject({ toast: '', toastRegions: 0 })
  })

  test('says why a file could not be fetched, in place of its state, as GAS keeps no record of the fetch', async () => {
    givenOutcome({
      outcome: 'fetched',
      files: [
        { file: 'grant', outcome: 'stored' },
        { file: 'payment', outcome: 'failed', reason: 'missing', message: null }
      ]
    })
    givenFiles({ grant: fetched, agreement: fetched, payment: pending })

    const { alerts, toast } = await fetchAndFollow()

    expect(toast).toBe('Definitions stored for woodland-creation@2.0.0')
    expect(alerts).toEqual([
      {
        tone: 'danger',
        text: 'The payment definition couldn’t be fetched: the file isn’t in S3. Fetching again fails the same way until the file is in S3. Nothing has changed.',
        action: 'Try again'
      }
    ])
  })

  // An aliased grant's files are stored under the code they publish, so GAS
  // reports them stored while this version still reads not stored.
  test('toasts what GAS stored even when the version still reads not stored', async () => {
    givenOutcome({
      outcome: 'fetched',
      files: [{ file: 'grant', outcome: 'stored' }]
    })
    givenFiles({ grant: pending })

    const { alerts, toast } = await fetchAndFollow()

    expect(toast).toBe('Definitions stored for woodland-creation@2.0.0')
    expect(alerts.map(({ tone }) => tone)).toEqual(['info'])
  })

  test('says a fetch GAS did not answer in time may still have worked, with Refresh', async () => {
    givenOutcome({ outcome: 'timed-out', files: [] })
    givenFiles({ grant: pending })

    const { alerts } = await fetchAndFollow()

    expect(alerts).toEqual([
      {
        tone: 'warning',
        text: 'Fetch status unknown: GAS didn’t answer in time. The fetch may still have worked. Refresh to check before fetching again.',
        action: 'Refresh'
      }
    ])
  })

  test('keeps the waiting tab’s Fetch while the alert above offers only Refresh', async () => {
    givenOutcome({ outcome: 'timed-out', files: [] })
    givenFiles({ grant: pending })

    const { alerts, tabFetch } = await fetchAndFollow({ tab: 'questions' })

    expect(alerts.map(({ action }) => action)).toEqual(['Refresh'])
    expect(tabFetch).toBe('Fetch definitions')
  })

  test.each(['not-found', 'unavailable'] as const)(
    'says a %s fetch may have stored some files',
    async (outcome) => {
      givenOutcome({ outcome, files: [] })

      const { alerts } = await fetchAndFollow()

      expect(alerts).toEqual([
        {
          tone: 'danger',
          text: 'The definitions couldn’t be fetched: GAS answered with an error. Some files may have been stored. Refresh to check.',
          action: 'Refresh'
        }
      ])
    }
  )

  test('says nothing after a fetch that found every file already stored', async () => {
    givenOutcome({ outcome: 'fetched', files: [] })

    const { alerts, toast } = await fetchAndFollow()

    expect(alerts).toEqual([])
    expect(toast).toBe('')
  })

  test("never shows one version's outcome on another", async () => {
    const cookie = sessionCookie(await fetch())

    const { alerts, toast } = await follow(
      cookie,
      '/dev-ops/grants/woodland-creation/1.2.0'
    )

    expect(alerts).toEqual([])
    expect(toast).toBe('')
  })
})
