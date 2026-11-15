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
    notices: $('[data-testid="grant-notice"]')
      .toArray()
      .map((notice) => ({
        role: $(notice).attr('role'),
        className: $(notice).attr('class'),
        text: flatten($(notice).text()),
        mono: $(notice).find('.font-mono').text(),
        icon: $(notice).find('[data-testid^="do-icon-"]').attr('data-testid')
      })),
    banner: flatten($('[data-testid="grant-banner"]').text())
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

  test('names every file stored, once, in a solid success notice with a ticked circle', async () => {
    const { cookie, notices, banner } = await fetchAndFollow()

    expect(notices).toEqual([
      {
        role: 'status',
        className: expect.stringMatching(/^(?!.*alert-soft).*alert-success$/),
        text: 'Stored: grant, agreement and payment definitions.',
        mono: '',
        icon: 'do-icon-circle-check'
      }
    ])
    expect(banner).toBe('')
    expect((await follow(cookie)).notices).toEqual([])
  })

  test('names a file that failed and its reason in mono, and keeps the banner for it', async () => {
    givenOutcome({
      outcome: 'fetched',
      files: [
        { file: 'grant', outcome: 'stored' },
        { file: 'payment', outcome: 'failed', reason: 'missing', message: null }
      ]
    })
    givenFiles({ grant: fetched, agreement: fetched, payment: pending })

    const { notices, banner } = await fetchAndFollow()

    expect(notices).toEqual([
      expect.objectContaining({
        role: 'status',
        text: 'Stored: grant definition.'
      }),
      {
        role: 'alert',
        className: expect.stringContaining('alert-soft alert-error'),
        text: "Couldn't fetch the payment definition: Definition file missing. Pressing Fetch again fails the same way until the file is in S3. Nothing has changed.",
        mono: 'Definition file missing',
        icon: 'do-icon-exclamation-circle'
      }
    ])
    expect(banner).toMatch(
      / Payment definition not stored yet\. Fetch definitions$/
    )
  })

  // An aliased grant's files are stored under the code they publish, so GAS
  // reports them stored while this version still reads not stored.
  test('shows what GAS said even when the version still reads not stored', async () => {
    givenOutcome({
      outcome: 'fetched',
      files: [{ file: 'grant', outcome: 'stored' }]
    })
    givenFiles({ grant: pending })

    const { notices, banner } = await fetchAndFollow()

    expect(notices.map(({ text }) => text)).toEqual([
      'Stored: grant definition.'
    ])
    expect(banner).toMatch(
      / Grant definition not stored yet\. Fetch definitions$/
    )
  })

  test.each([
    [
      'not-found',
      'Not fetched: GAS no longer has this version. Nothing has changed.'
    ],
    [
      'unavailable',
      'Fetch failed: GAS could not finish it. Refresh to see what was stored.'
    ],
    [
      'timed-out',
      'Fetch status unknown: GAS did not answer in time. Refresh to check.'
    ]
  ] as const)('says what a %s fetch means', async (outcome, text) => {
    givenOutcome({ outcome, files: [] })

    const { notices } = await fetchAndFollow()

    expect(notices.map((notice) => [notice.role, notice.text])).toEqual([
      ['alert', text]
    ])
  })

  test('says nothing after a fetch that found every file already stored', async () => {
    givenOutcome({ outcome: 'fetched', files: [] })

    const { notices } = await fetchAndFollow()

    expect(notices).toEqual([])
  })

  test("never shows one version's outcome on another", async () => {
    const cookie = sessionCookie(await fetch())

    const { notices } = await follow(
      cookie,
      '/dev-ops/grants/woodland-creation/1.2.0'
    )

    expect(notices).toEqual([])
  })
})
