import { load } from 'cheerio'
import type { Request, ResponseToolkit, Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type { ListedToken } from '../use-cases/access-tokens.use-case.ts'
import {
  changeTokenExpiryUseCase,
  deleteAccessTokenUseCase,
  issueAccessTokenUseCase,
  listAccessTokensUseCase,
  revokeAccessTokenUseCase,
  rotateAccessTokenUseCase
} from '../use-cases/access-tokens.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/access-tokens.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const sameOrigin = { 'sec-fetch-site': 'same-origin' }

const tokenId = '6650c1f2a9e4b1d07c20bd91'
const raw = 'Zq3pLm8Rt2Vw9Xy4Ab7Cd1Ef6Gh0Ij5Kl3Mn8Op2x7Qa'

const token = (fields: Partial<ListedToken> = {}): ListedToken => ({
  tokenId,
  clientId: 'grants-ui',
  tokenHint: 'x7Qa',
  status: 'ACTIVE',
  createdAt: '2026-11-02T10:00:00.000Z',
  createdBy: 'Alex Operator',
  expiresAt: null,
  revokedAt: null,
  revokedBy: null,
  inUse: false,
  stored: {
    _id: { $oid: fields.tokenId ?? '6650c1f2a9e4b1d07c20bd91' },
    id: 'a1b••••••f2c',
    clientId: fields.clientId ?? 'grants-ui'
  },
  ...fields
})

const tokens: ListedToken[] = [
  token(),
  token({
    tokenId: '6650c1f2a9e4b1d07c20bd92',
    clientId: 'fg-grants-platform-admin',
    tokenHint: 'Lp2e',
    inUse: true
  }),
  token({
    tokenId: '6650c1f2a9e4b1d07c20bd93',
    clientId: 'example-legacy-caller',
    tokenHint: null,
    status: 'REVOKED',
    revokedAt: '2026-11-01T09:00:00.000Z',
    revokedBy: 'Sam Revoker',
    expiresAt: '2026-11-01T09:00:00.000Z'
  })
]

const tokenPath = `/dev-ops/clients/gas/grants-ui/tokens/${tokenId}`

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The hint's mask, and the stored hash's between its first and last 3 characters. */
const withoutMasks = (text: string) =>
  text.replaceAll('••••••', '').replaceAll('••••', '')

let server: Server
let sessions: string[]

const get = async (url: string, cookie?: string) => {
  const response = await server.inject({
    method: 'GET',
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    auth: { strategy: 'session', credentials }
  })

  return { ...response, $: load(response.payload) }
}

const post = async (
  url: string,
  payload: Record<string, string> = {},
  headers: Record<string, string> = sameOrigin
) => {
  const response = await server.inject({
    method: 'POST',
    url,
    payload,
    headers,
    auth: { strategy: 'session', credentials }
  })

  return { ...response, $: load(response.payload) }
}

const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  (response.headers['set-cookie'] as string[])[0].split(';')[0]

/** The write, then the page it redirects to, as a browser does it. */
const postAndFollow = async (url: string, payload: Record<string, string>) => {
  const written = await post(url, payload)
  const cookie = sessionCookie(written)

  return { written, cookie, page: await get('/dev-ops/clients/gas', cookie) }
}

const toastOf = ($: ReturnType<typeof load>) => ({
  role: $('[data-testid="token-toast"]').attr('role'),
  text: flatten($('[data-testid="token-toast-message"]').text())
})

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  // What the session holds once each response is ready, to show what never gets into it.
  server.ext('onPreResponse', (request: Request, h: ResponseToolkit) => {
    sessions.push(
      JSON.stringify((request.yar as unknown as { _store: object })._store)
    )
    return h.continue
  })
  await server.initialize()
})

beforeEach(() => {
  sessions = []
  vi.mocked(listAccessTokensUseCase).mockResolvedValue(tokens)
})

afterAll(async () => {
  await server.stop()
})

describe('the access tokens page', () => {
  test.each([
    ['gas', 'GAS access tokens'],
    ['cw', 'CW access tokens']
  ] as const)('draws the %s page', async (service, title) => {
    const { statusCode, $ } = await get(`/dev-ops/clients/${service}`)

    expect(statusCode).toBe(statusCodes.ok)
    expect($('title').text()).toBe(`${title} – Grants Platform`)
    expect($('h1').text()).toBe(title)
    expect(listAccessTokensUseCase).toHaveBeenCalledWith(service)
  })

  test('is never stored by the browser', async () => {
    const { headers } = await get('/dev-ops/clients/gas')

    expect(headers['cache-control']).toBe('no-store')
  })

  test("marks its own service in the navigation, each link in its service's group", async () => {
    const { $ } = await get('/dev-ops/clients/cw')

    expect($('[data-testid="shell-nav-clients-cw"]').attr('aria-current')).toBe(
      'page'
    )
    expect(
      $('[data-testid="shell-nav-clients-gas"]').attr('aria-current')
    ).toBeUndefined()
    expect(
      $('[data-testid="shell-nav-clients-gas"]')
        .closest('[role="group"]')
        .attr('aria-label')
    ).toBe('Grant Application Service')
    expect(
      $('[data-testid="shell-nav-clients-cw"]')
        .closest('[role="group"]')
        .attr('aria-label')
    ).toBe('Caseworking')
  })

  test('draws one row per token, sorted, with the hint masked and the token in use tagged', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const rows = $('[data-testid="token-row"]')

    expect(
      rows
        .find(
          '[data-testid="token-row-client"], [data-testid="token-row-client-none"]'
        )
        .map((_i, cell) => $(cell).text())
        .get()
    ).toEqual([
      'example-legacy-caller',
      'fg-grants-platform-admin',
      'grants-ui'
    ])
    expect(
      flatten(rows.eq(2).find('[data-testid="token-row-hint"]').text())
    ).toBe('••••ending x7Qa')
    expect(
      rows
        .eq(2)
        .find('[data-testid="token-row-hint"] [aria-hidden="true"]')
        .text()
    ).toBe('••••')
    expect(rows.eq(0).find('[data-testid="token-row-hint-none"]').text()).toBe(
      '—'
    )
    expect(rows.find('[data-testid="token-row-tag"]')).toHaveLength(0)
    expect(flatten(rows.text())).not.toContain('this portal')
    expect(
      rows.eq(2).find('[data-testid="token-row-open"]').attr('aria-label')
    ).toBe('Open token for grants-ui')
    expect(
      rows.eq(2).find('[data-testid="token-row-open"]').attr('data-drawer-open')
    ).toBe(tokenId)
    expect(rows.eq(2).is('[data-drawer-row]')).toBe(true)
    expect(rows.eq(2).find('button, [href], [tabindex]')).toHaveLength(1)
  })

  test('heads the table Client ID, Token, Status and Expires, with no filters', async () => {
    const { $ } = await get('/dev-ops/clients/gas')

    expect(
      $('[data-testid="tokens-table"] th')
        .map((_i, th) => flatten($(th).text()))
        .get()
    ).toEqual(['Client ID', 'Token', 'Status', 'Expires', 'Details'])
    expect($('input[type="search"]')).toHaveLength(0)
    expect($('[aria-pressed]')).toHaveLength(0)
  })

  test('offers no Revoke and no note on the token in use, and Delete only on one that no longer works', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const panel = (id: string) => $(`[data-token-panel="${id}"]`)
    const inUse = panel(tokens[1].tokenId)

    expect(panel(tokenId).find('[data-testid$="-revoke"]')).toHaveLength(1)
    expect(panel(tokenId).find('[data-testid$="-delete"]')).toHaveLength(0)
    expect(inUse.find('[data-testid$="-revoke"]')).toHaveLength(0)
    expect(
      inUse
        .find('[data-testid$="-actions"] button')
        .map((_i, b) => flatten($(b).text()))
        .get()
    ).toEqual(['Rotate', 'Change expiry'])
    expect(inUse.find('[data-testid$="-in-use"]')).toHaveLength(0)
    expect(inUse.text()).not.toContain('Only this portal may call')
    expect($(`#token-${tokens[1].tokenId}-revoke`)).toHaveLength(0)
    expect(
      panel(tokens[2].tokenId).find('[data-testid$="-delete"]')
    ).toHaveLength(1)
    expect(
      panel(tokens[2].tokenId).find('[data-testid$="-revoke"]')
    ).toHaveLength(0)
  })

  test('draws Rotate on a token that no longer works as disabled, pointing at the line that says why', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const id = `token-panel-${tokens[2].tokenId}`
    const rotate = $(`[data-testid="${id}-rotate"]`)

    expect(rotate.attr('aria-disabled')).toBe('true')
    expect(rotate.attr('data-modal-open')).toBeUndefined()
    expect(rotate.attr('aria-describedby')).toBe(`${id}-note`)
    expect(flatten($(`#${id}-note`).text())).toBe(
      'This token no longer works. Change its expiry to bring it back, or delete it.'
    )
    expect($('body').text()).not.toContain('Only working tokens can be rotated')
    expect($(`#token-${tokens[2].tokenId}-rotate`)).toHaveLength(0)
    expect(
      $(`[data-testid="token-panel-${tokenId}-rotate"]`).attr('aria-disabled')
    ).toBeUndefined()
  })

  test('offers the token in use no immediate end on Rotate, saying why', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const id = `token-${tokens[1].tokenId}-rotate`

    expect($(`#${id} [value="none"]`).attr('disabled')).toBe('disabled')
    expect(flatten($(`[data-testid="${id}-locked"]`).text())).toContain(
      'Not for the token in use'
    )
    expect(
      $(`#token-${tokenId}-rotate [value="none"]`).attr('disabled')
    ).toBeUndefined()
  })

  test('shows the drawer facts and the stored document as the design does', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const panel = $(`[data-token-panel="${tokens[2].tokenId}"]`)

    expect(flatten(panel.find('h2 span').first().text())).toBe(
      'GAS Access token'
    )
    expect(
      panel
        .find('dt')
        .map((_i, dt) => $(dt).text())
        .get()
    ).toEqual(['Client ID', 'Expires', 'Token'])
    expect(flatten(panel.find('[data-testid$="-token"]').text())).toBe('—')
    expect(flatten(panel.find('[data-testid$="-expires"]').text())).toBe(
      '1 Nov 2026'
    )
    expect($(`[data-token-panel="${tokenId}"]`).text()).not.toContain(
      'Only expired or revoked tokens can be deleted'
    )
    expect(
      $(`[data-token-panel="${tokenId}"] [data-testid$="-note"]`)
    ).toHaveLength(0)
    expect(JSON.parse(panel.find('pre').text())).toEqual(tokens[2].stored)
  })

  test('opens no dialog and no drawer on a plain visit', async () => {
    const { $ } = await get('/dev-ops/clients/gas')

    expect($('do-modal[data-open]')).toHaveLength(0)
    expect(
      $('[data-testid="token-drawer"]').attr('data-open-token')
    ).toBeUndefined()
    expect($('[data-testid="token-reveal"]')).toHaveLength(0)
  })

  test('names no one who created or revoked a token', async () => {
    const { payload } = await get('/dev-ops/clients/gas')

    expect(payload).not.toContain('Alex Operator')
    expect(payload).not.toContain('Sam Revoker')
    expect(payload).not.toContain('createdBy')
    expect(payload).not.toContain('revokedBy')
  })

  test('draws no character icons but the hint mask', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const text = withoutMasks($('body').text())

    expect(text).not.toMatch(/[…·›→•]/)
  })

  test('says when there are no tokens yet, keeping New token', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue([])

    const { $ } = await get('/dev-ops/clients/gas')

    expect(flatten($('[data-testid="tokens-none"]').text())).toBe(
      'No access tokens yet.'
    )
    expect($('[data-testid="tokens-new"]')).toHaveLength(1)
  })

  test('says the list could not be loaded, with no table', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue(null)

    const { statusCode, $ } = await get('/dev-ops/clients/cw')

    expect(statusCode).toBe(statusCodes.ok)
    expect(flatten($('[data-testid="tokens-error"]').text())).toBe(
      'CW access tokens could not be loaded.'
    )
    expect($('[data-testid="tokens-table"]')).toHaveLength(0)
    expect($('[data-testid="tokens-new"]')).toHaveLength(0)
  })

  test('refuses a service it does not know', async () => {
    const { statusCode } = await get('/dev-ops/clients/payments')

    expect(statusCode).toBe(statusCodes.badRequest)
  })
})

describe('the access token writes', () => {
  test.each([
    [
      '/dev-ops/clients/gas/tokens',
      { clientId: 'grants-ui', expiry: '90', date: '' }
    ],
    [`${tokenPath}/rotate`, { keepOld: '24h' }],
    [`${tokenPath}/expiry`, { expiry: 'never', date: '', hint: 'x7Qa' }],
    [`${tokenPath}/revoke`, { confirm: 'grants-ui', hint: 'x7Qa' }],
    [`${tokenPath}/delete`, { hint: 'x7Qa' }]
  ])('refuses a cross-site POST to %s', async (url, payload) => {
    const refused: Record<string, string>[] = [
      { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' },
      {
        'sec-fetch-site': 'same-site',
        origin: 'https://other.cdp-int.defra.cloud'
      },
      {}
    ]
    const answers = await Promise.all(
      refused.map(
        async (headers) => (await post(url, payload, headers)).statusCode
      )
    )

    expect(answers).toEqual(refused.map(() => statusCodes.forbidden))

    expect(issueAccessTokenUseCase).not.toHaveBeenCalled()
    expect(rotateAccessTokenUseCase).not.toHaveBeenCalled()
    expect(changeTokenExpiryUseCase).not.toHaveBeenCalled()
    expect(revokeAccessTokenUseCase).not.toHaveBeenCalled()
    expect(deleteAccessTokenUseCase).not.toHaveBeenCalled()
  })

  test('accepts a write whose Origin is this app, from a browser that sends no Sec-Fetch-Site', async () => {
    vi.mocked(deleteAccessTokenUseCase).mockResolvedValue({ outcome: 'done' })

    const { statusCode } = await post(
      `${tokenPath}/delete`,
      { hint: 'x7Qa' },
      {
        origin: new URL(config.get('auth.appBaseUrl')).origin
      }
    )

    expect(statusCode).toBe(statusCodes.seeOther)
  })

  test.each([
    [
      'a client ID outside the name rule',
      '/dev-ops/clients/gas/Grants_UI/tokens/6650c1f2a9e4b1d07c20bd91/revoke'
    ],
    [
      'a token id that is not an object id',
      '/dev-ops/clients/gas/grants-ui/tokens/x/revoke'
    ],
    [
      'a service it does not know',
      '/dev-ops/clients/pay/grants-ui/tokens/6650c1f2a9e4b1d07c20bd91/revoke'
    ]
  ])('refuses %s', async (_name, url) => {
    const { statusCode } = await post(url, { confirm: 'grants-ui', hint: '' })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(revokeAccessTokenUseCase).not.toHaveBeenCalled()
  })

  test('answers no GET at a write address', async () => {
    const { statusCode } = await get(`${tokenPath}/revoke`)

    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('New token', () => {
  const url = '/dev-ops/clients/gas/tokens'

  beforeEach(() => {
    vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
      outcome: 'issued',
      raw,
      token: token({ tokenId: '6650c1f2a9e4b1d07c20bd99' })
    })
  })

  test('issues for the client with the chosen expiry, to the end of its UK day', async () => {
    vi.useFakeTimers({
      now: new Date('2026-11-04T13:50:00.000Z'),
      toFake: ['Date']
    })
    await post(url, { clientId: ' grants-ui ', expiry: '90', date: '' })
    vi.useRealTimers()

    expect(issueAccessTokenUseCase).toHaveBeenCalledWith(
      'gas',
      'grants-ui',
      '2027-02-02T23:59:59.000Z'
    )
  })

  test('reveals the token in the response to the POST, uncached, and nowhere else', async () => {
    const { statusCode, headers, payload, $ } = await post(url, {
      clientId: 'grants-ui',
      expiry: 'never',
      date: ''
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['cache-control']).toBe('no-store')
    expect(headers.location).toBeUndefined()
    expect($('[data-testid="token-reveal-token"]').text()).toBe(raw)
    expect($('[data-testid="token-reveal-modal"]').attr('data-open')).toBe('')
    expect($('[data-testid="token-reveal-modal"]').attr('data-locked')).toBe('')
    expect(flatten($('[data-testid="token-reveal-hint"]').text())).toBe(
      '••••ending x7Qa'
    )
    expect(payload.split(raw)).toHaveLength(2)
    expect(JSON.stringify(headers)).not.toContain(raw)
    expect(sessions.join('')).not.toContain(raw)
  })

  test('says the token is live on the page Done leads to, naming only the client', async () => {
    const written = await post(url, {
      clientId: 'grants-ui',
      expiry: 'never',
      date: ''
    })
    const page = await get('/dev-ops/clients/gas', sessionCookie(written))

    expect(toastOf(page.$)).toEqual({
      role: 'status',
      text: 'Token for grants-ui is live'
    })
    expect(sessions.join('')).not.toContain(raw)
  })

  test('lets Done leave only once the token is stored, without a word in the url', async () => {
    const { $ } = await post(url, {
      clientId: 'grants-ui',
      expiry: 'never',
      date: ''
    })
    const done = $('[data-testid="token-reveal-done"]').closest('form')

    expect(done.attr('method')).toBe('get')
    expect(done.attr('action')).toBe('/dev-ops/clients/gas')
    expect($('[data-testid="token-reveal-ack"]').attr('required')).toBe(
      'required'
    )
    expect($('[data-testid="token-reveal-ack"]').attr('name')).toBeUndefined()
  })

  test.each([
    [{ clientId: '', expiry: '90', date: '' }, 'Enter a client ID.'],
    [
      { clientId: 'Grants_UI', expiry: '90', date: '' },
      'Use lowercase letters, digits and hyphens only.'
    ],
    [
      { clientId: 'grants-ui', expiry: 'custom', date: '2020-01-01' },
      'Pick a date in the future.'
    ],
    [
      { clientId: 'grants-ui', expiry: 'custom', date: '2027-13-01' },
      'Pick a date.'
    ]
  ])('opens the dialog again on %j', async (payload, message) => {
    const { statusCode, headers, $ } = await post(url, payload)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(headers['cache-control']).toBe('no-store')
    expect($('[data-testid="token-new-modal"]').attr('data-open')).toBe('')
    expect(
      flatten(
        $(
          '[data-testid="token-new-client-error"]:not([hidden]), [data-testid="token-new-expires-summary"]'
        ).text()
      )
    ).toContain(message)
    expect($('[data-testid="token-new-client"]').attr('value')).toBe(
      payload.clientId
    )
    expect(issueAccessTokenUseCase).not.toHaveBeenCalled()
  })

  test('marks the field that is wrong', async () => {
    const { $ } = await post(url, { clientId: 'Bad', expiry: '90', date: '' })

    expect($('[data-testid="token-new-client"]').attr('aria-invalid')).toBe(
      'true'
    )
    expect(
      $('[data-testid="token-new-client"]').attr('aria-describedby')
    ).toContain('token-new-client-error')
    expect(
      $('[data-testid="token-new-client-error"]').attr('hidden')
    ).toBeUndefined()
  })

  test.each([
    ['API_CLIENT_EXISTS', 'Someone has just created this client.'],
    ['API_CLIENT_NOT_FOUND', 'This client has just lost its last token.'],
    [
      'API_CLIENT_INVALID_NAME',
      'Use lowercase letters, digits and hyphens only.'
    ]
  ])('puts a %s refusal on the field', async (errorCode, message) => {
    vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode
    })

    const { statusCode, $ } = await post(url, {
      clientId: 'grants-ui',
      expiry: '90',
      date: ''
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(
      flatten($('[data-testid="token-new-client-error"]').text())
    ).toContain(message)
    expect($('[data-testid="token-reveal"]')).toHaveLength(0)
  })

  test.each([
    [
      { outcome: 'unknown' },
      'alert',
      'New token status unknown — refresh to check.'
    ],
    [
      { outcome: 'unreachable' },
      'alert',
      'Not issued — fg-gas-backend could not be reached. Nothing has changed.'
    ]
  ] as const)(
    'goes back to the page with a toast, and no token, for %j',
    async (result, role, text) => {
      vi.mocked(issueAccessTokenUseCase).mockResolvedValue(result)

      const { written, page } = await postAndFollow(url, {
        clientId: 'grants-ui',
        expiry: '90',
        date: ''
      })

      expect(written.statusCode).toBe(statusCodes.seeOther)
      expect(written.headers.location).toBe('/dev-ops/clients/gas')
      expect(toastOf(page.$)).toEqual({
        role,
        text: expect.stringContaining(text)
      })
      expect(page.$('[data-testid="token-reveal"]')).toHaveLength(0)
      expect(sessions.join('')).not.toContain(raw)
    }
  )
})

describe('Rotate', () => {
  const url = `${tokenPath}/rotate`

  test('reveals the new token in the response to the POST', async () => {
    vi.mocked(rotateAccessTokenUseCase).mockResolvedValue({
      outcome: 'issued',
      raw,
      token: token()
    })

    const { statusCode, headers, $ } = await post(url, { keepOld: '7d' })

    expect(rotateAccessTokenUseCase).toHaveBeenCalledWith(
      { service: 'gas', clientId: 'grants-ui', tokenId },
      '7d'
    )
    expect(statusCode).toBe(statusCodes.ok)
    expect(headers['cache-control']).toBe('no-store')
    expect($('[data-testid="token-reveal-token"]').text()).toBe(raw)
    expect(sessions.join('')).not.toContain(raw)
  })

  test('refuses an overlap it does not offer', async () => {
    const { statusCode } = await post(url, { keepOld: '30d' })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(rotateAccessTokenUseCase).not.toHaveBeenCalled()
  })

  test.each([
    [
      { outcome: 'refused', statusCode: 404, errorCode: 'API_TOKEN_NOT_FOUND' },
      'Not rotated — fg-gas-backend no longer has this token. Nothing has changed.'
    ],
    [{ outcome: 'unknown' }, 'Rotation status unknown — refresh to check.']
  ] as const)(
    'goes back to the page with a toast for %j',
    async (result, text) => {
      vi.mocked(rotateAccessTokenUseCase).mockResolvedValue(result)

      const { written, page } = await postAndFollow(url, { keepOld: 'none' })

      expect(written.statusCode).toBe(statusCodes.seeOther)
      expect(toastOf(page.$).text).toContain(text)
      expect(page.$('[data-testid="token-reveal"]')).toHaveLength(0)
    }
  )
})

describe('Change expiry', () => {
  const url = `${tokenPath}/expiry`

  beforeEach(() => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValue({
      outcome: 'done',
      token: token({ expiresAt: '2027-02-01T23:59:59.000Z' })
    })
  })

  test('sets the end of the chosen day, and says so', async () => {
    const { written, page } = await postAndFollow(url, {
      expiry: 'custom',
      date: '2027-02-01',
      hint: 'x7Qa'
    })

    expect(changeTokenExpiryUseCase).toHaveBeenCalledWith(
      { service: 'gas', clientId: 'grants-ui', tokenId },
      '2027-02-01T23:59:59.000Z'
    )
    expect(written.statusCode).toBe(statusCodes.seeOther)
    expect(toastOf(page.$).role).toBe('status')
    expect(toastOf(page.$).text).toMatch(
      /^Expiry updated — expires 1 Feb 2027$/
    )
  })

  test('keeps the exact current expiry when the date is left on its day', async () => {
    await post(url, {
      expiry: 'custom',
      date: '2027-02-01',
      current: '2027-02-01T10:00:00.000Z',
      hint: 'x7Qa'
    })

    expect(changeTokenExpiryUseCase).toHaveBeenCalledWith(
      { service: 'gas', clientId: 'grants-ui', tokenId },
      '2027-02-01T10:00:00.000Z'
    )
  })

  test('opens the dialog again, in its drawer, on a date in the past', async () => {
    const { statusCode, $ } = await post(url, {
      expiry: 'custom',
      date: '2020-01-01',
      hint: 'x7Qa'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(
      $(`[data-testid="token-${tokenId}-expiry-modal"]`).attr('data-open')
    ).toBe('')
    expect($('[data-testid="token-drawer"]').attr('data-open-token')).toBe(
      tokenId
    )
    expect(
      flatten($(`[data-testid="token-${tokenId}-expires-summary"]`).text())
    ).toContain('Pick a date in the future.')
    expect(
      $(`[data-testid="token-${tokenId}-expires-custom-date"]`)
    ).toHaveLength(1)
    expect(
      $(`[data-testid="token-${tokenId}-expires-date"]`).attr('value')
    ).toBe('2020-01-01')
    expect(changeTokenExpiryUseCase).not.toHaveBeenCalled()
  })

  test('opens the dialog again on a date that is not in the calendar', async () => {
    const { statusCode, $ } = await post(url, {
      expiry: 'custom',
      date: '2027-13-01',
      hint: 'x7Qa'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(
      flatten($(`[data-testid="token-${tokenId}-expires-summary"]`).text())
    ).toBe('Pick a date.')
    expect(changeTokenExpiryUseCase).not.toHaveBeenCalled()
  })

  test('puts a refused expiry on the field', async () => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 400,
      errorCode: 'API_TOKEN_INVALID_EXPIRY'
    })

    const { statusCode, $ } = await post(url, {
      expiry: '30',
      date: '',
      hint: 'x7Qa'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(
      $(`[data-testid="token-${tokenId}-expiry-modal"]`).attr('data-open')
    ).toBe('')
  })

  test.each([
    [
      { outcome: 'unknown' },
      'alert',
      'Expiry change status unknown — refresh to check.'
    ]
  ] as const)(
    'goes back to the page with a toast for %j',
    async (result, role, text) => {
      vi.mocked(changeTokenExpiryUseCase).mockResolvedValue(result)

      const { page } = await postAndFollow(url, {
        expiry: 'never',
        date: '',
        hint: 'x7Qa'
      })

      expect(toastOf(page.$)).toEqual({ role, text })
    }
  )
})

describe('Revoke', () => {
  const url = `${tokenPath}/revoke`

  beforeEach(() => {
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue({ outcome: 'done' })
  })

  test('revokes once the client name is typed, and says so', async () => {
    const { written, page } = await postAndFollow(url, {
      confirm: 'grants-ui',
      hint: 'x7Qa'
    })

    expect(revokeAccessTokenUseCase).toHaveBeenCalledWith({
      service: 'gas',
      clientId: 'grants-ui',
      tokenId
    })
    expect(written.headers.location).toBe('/dev-ops/clients/gas')
    expect(toastOf(page.$)).toEqual({
      role: 'status',
      text: 'Token revoked — grants-ui gets 401 from now on'
    })
  })

  test.each(['', 'grants', 'GRANTS-UI', 'x7Qa'])(
    'opens the dialog again when "%s" is typed, revoking nothing',
    async (confirm) => {
      const { statusCode, $ } = await post(url, { confirm, hint: 'x7Qa' })
      const field = $(`[data-testid="token-${tokenId}-revoke-confirm"]`)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(
        $(`[data-testid="token-${tokenId}-revoke-modal"]`).attr('data-open')
      ).toBe('')
      expect(
        flatten(
          $(`[data-testid="token-${tokenId}-revoke-confirm-error"]`).text()
        )
      ).toBe("That doesn't match.")
      expect(field.attr('aria-invalid')).toBe('true')
      expect(field.attr('value')).toBe(confirm)
      expect(revokeAccessTokenUseCase).not.toHaveBeenCalled()
    }
  )

  test.each([
    [
      { outcome: 'unknown' },
      'alert',
      'Revoke status unknown — refresh to check.'
    ],
    [
      { outcome: 'unreachable' },
      'alert',
      'Not revoked — fg-gas-backend could not be reached. Nothing has changed.'
    ]
  ] as const)(
    'goes back to the page with a toast for %j',
    async (result, role, text) => {
      vi.mocked(revokeAccessTokenUseCase).mockResolvedValue(result)

      const { page } = await postAndFollow(url, {
        confirm: 'grants-ui',
        hint: 'x7Qa'
      })

      expect(toastOf(page.$)).toEqual({ role, text })
    }
  )

  test('says what the write did after a reveal left without Done', async () => {
    vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
      outcome: 'issued',
      raw,
      token: token({ tokenId: '6650c1f2a9e4b1d07c20bd99' })
    })
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue({
      outcome: 'unknown'
    })

    const revealed = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'grants-ui',
      expiry: 'never',
      date: ''
    })
    const written = await post(
      url,
      { confirm: 'grants-ui', hint: 'x7Qa' },
      { ...sameOrigin, cookie: sessionCookie(revealed) }
    )
    const page = await get('/dev-ops/clients/gas', sessionCookie(written))

    expect(toastOf(page.$)).toEqual({
      role: 'alert',
      text: 'Revoke status unknown — refresh to check.'
    })
  })

  test('says it once: the toast is gone by the next visit', async () => {
    const { cookie } = await postAndFollow(url, {
      confirm: 'grants-ui',
      hint: 'x7Qa'
    })
    const again = await get('/dev-ops/clients/gas', cookie)

    expect(again.$('[data-testid="token-toast"]')).toHaveLength(0)
  })

  test("drops the toast, rather than move it, when the other service's page is opened first", async () => {
    const cookie = sessionCookie(
      await post(url, { confirm: 'grants-ui', hint: 'x7Qa' })
    )

    expect(
      (await get('/dev-ops/clients/cw', cookie)).$(
        '[data-testid="token-toast"]'
      )
    ).toHaveLength(0)
    expect(
      (await get('/dev-ops/clients/gas', cookie)).$(
        '[data-testid="token-toast"]'
      )
    ).toHaveLength(0)
  })
})

describe('Delete', () => {
  const url = `${tokenPath}/delete`

  test('deletes, and says so', async () => {
    vi.mocked(deleteAccessTokenUseCase).mockResolvedValue({ outcome: 'done' })

    const { page } = await postAndFollow(url, { hint: 'x7Qa' })

    expect(deleteAccessTokenUseCase).toHaveBeenCalledWith({
      service: 'gas',
      clientId: 'grants-ui',
      tokenId
    })
    expect(toastOf(page.$)).toEqual({
      role: 'status',
      text: 'Token deleted — grants-ui ••••ending x7Qa'
    })
  })

  test.each([
    [{ outcome: 'unknown' }, 'Delete status unknown — refresh to check.']
  ] as const)(
    'goes back to the page with a toast for %j',
    async (result, text) => {
      vi.mocked(deleteAccessTokenUseCase).mockResolvedValue(result)

      const { page } = await postAndFollow(url, { hint: '' })

      expect(toastOf(page.$).text).toBe(text)
    }
  )
})

const banned = /[…·›→•]/

/** Every character icon is banned but the `••••` of a hint mask. */
const bannedIn = ($: ReturnType<typeof load>) =>
  banned.test(withoutMasks($('body').text()))

describe('refusals the operator can act on', () => {
  const revoked = token({
    status: 'REVOKED',
    revokedAt: '2026-11-01T09:00:00.000Z',
    expiresAt: '2026-11-01T09:00:00.000Z'
  })

  test.each([
    [
      'a rotation of a token that has just stopped',
      `${tokenPath}/rotate`,
      { keepOld: '24h' },
      rotateAccessTokenUseCase,
      'API_TOKEN_NOT_ACTIVE',
      `token-${tokenId}-rotate`,
      'Not rotated — this token is no longer active. Nothing has changed.'
    ],
    [
      'a rotation that would end the token in use',
      `${tokenPath}/rotate`,
      { keepOld: 'none' },
      rotateAccessTokenUseCase,
      'API_TOKEN_IN_USE',
      `token-${tokenId}-rotate`,
      'Not rotated — this is the token GPA is calling with. Choose Keep valid until end of tomorrow or Keep valid for 7 days, to end of day. Nothing has changed.'
    ],
    [
      'a new token whose hash is already stored',
      `${tokenPath}/rotate`,
      { keepOld: '7d' },
      rotateAccessTokenUseCase,
      'API_TOKEN_DUPLICATE',
      `token-${tokenId}-rotate`,
      'Not rotated — the new token matched one already stored. Try again for a fresh one. Nothing has changed.'
    ],
    [
      'an expiry that would end the token in use',
      `${tokenPath}/expiry`,
      { expiry: '30', date: '', hint: 'x7Qa' },
      changeTokenExpiryUseCase,
      'API_TOKEN_IN_USE',
      `token-${tokenId}-expiry`,
      "Not changed — this is the token GPA is calling with, so it can't expire now. Nothing has changed."
    ],
    [
      'a revoke of the token in use',
      `${tokenPath}/revoke`,
      { confirm: 'grants-ui', hint: 'x7Qa' },
      revokeAccessTokenUseCase,
      'API_TOKEN_IN_USE',
      `token-${tokenId}-revoke`,
      'Not revoked — Grants Platform Admin is calling GAS with this token. Rotate it instead. Nothing has changed.'
    ],
    [
      'a delete of a token someone has just brought back',
      `${tokenPath}/delete`,
      { hint: 'x7Qa' },
      deleteAccessTokenUseCase,
      'API_TOKEN_ACTIVE',
      `token-${tokenId}-delete`,
      'Not deleted. Nothing has changed.'
    ]
  ] as const)(
    'reopens the dialog on %s, saying why, linked to it',
    async (_name, url, payload, useCase, errorCode, dialogId, text) => {
      vi.mocked(useCase).mockResolvedValue({
        outcome: 'refused',
        statusCode: 409,
        errorCode
      } as never)

      const { statusCode, headers, $ } = await post(url, payload)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(headers.location).toBeUndefined()
      expect($(`[data-testid="${dialogId}-modal"]`).attr('data-open')).toBe('')
      expect($(`#${dialogId}`).attr('aria-describedby')).toBe(
        `${dialogId}-form-error`
      )
      expect(flatten($(`#${dialogId}-form-error`).text())).toBe(text)
      expect($(`#${dialogId}-form-error`).attr('role')).toBe('alert')
      expect($('[data-testid="token-drawer"]').attr('data-open-token')).toBe(
        tokenId
      )
      expect($('[data-testid="token-toast"]')).toHaveLength(0)
    }
  )

  test('reopens Rotate on the overlap it was sent with, starting afresh on 24 hours', async () => {
    vi.mocked(rotateAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_DUPLICATE'
    })

    const { $ } = await post(`${tokenPath}/rotate`, { keepOld: '7d' })
    const choice = (value: string) =>
      $(`[data-testid="token-${tokenId}-rotate-${value}"]`)

    expect(choice('7d').attr('checked')).toBe('checked')
    expect(choice('24h').attr('checked')).toBeUndefined()
    expect(choice('24h').attr('data-reset-checked')).toBe('')
    expect(choice('7d').attr('data-reset-checked')).toBeUndefined()
  })

  test('reopens the dialog of an action that no longer applies, as the page now stands', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue([revoked])
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_NOT_ACTIVE'
    })

    const { $ } = await post(`${tokenPath}/revoke`, {
      confirm: 'grants-ui',
      hint: 'x7Qa'
    })

    expect(
      $(`[data-testid="token-${tokenId}-revoke-modal"]`).attr('data-open')
    ).toBe('')
    expect(flatten($(`#token-${tokenId}-revoke-form-error`).text())).toBe(
      'Not revoked — this token is no longer active. Nothing has changed.'
    )
  })

  test('says it as a toast when the token has gone from the list', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue([])
    vi.mocked(rotateAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_NOT_ACTIVE'
    })

    const { $ } = await post(`${tokenPath}/rotate`, { keepOld: '24h' })

    expect(toastOf($)).toEqual({
      role: 'alert',
      text: 'Not rotated — this token is no longer active. Nothing has changed.'
    })
  })

  test('reopens New token on a hash already stored, keeping what was typed, revealing nothing', async () => {
    vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_DUPLICATE'
    })

    const { $ } = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'grants-ui',
      expiry: '30',
      date: ''
    })

    expect($('[data-testid="token-new-modal"]').attr('data-open')).toBe('')
    expect(flatten($('#token-new-form-error').text())).toBe(
      'Not issued — the new token matched one already stored. Try again for a fresh one. Nothing has changed.'
    )
    expect($('[data-testid="token-new-client"]').attr('value')).toBe(
      'grants-ui'
    )
    expect($('[data-testid="token-new-expires-30"]').attr('checked')).toBe(
      'checked'
    )
    expect($('[data-testid="token-reveal"]')).toHaveLength(0)
    expect(bannedIn($)).toBe(false)
  })
})

describe('the drawer and dialogs, as the design and QA settled them', () => {
  test('points nothing at a note that is no longer drawn', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const described = $('[aria-describedby]')
      .map((_i, el) => $(el).attr('aria-describedby')!.split(' '))
      .get()

    expect(described.filter((id) => id.endsWith('-in-use'))).toEqual([])
  })

  test('sets Revoked in the weight Active and Expired take, in the table and the drawer', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const labels = $('[data-testid$="-status-label"]')
      .filter((_i, label) => $(label).text() === 'Revoked')
      .map((_i, label) => $(label).attr('class'))
      .get()

    expect(labels).toEqual(['font-normal', 'font-normal'])
  })

  test('sets the client ID in the table in mono, as the design does', async () => {
    const { $ } = await get('/dev-ops/clients/gas')

    expect(
      $('[data-testid="token-row-client"]').first().attr('class')
    ).toContain('Noto_Sans_Mono')
  })

  test('labels the custom date as the end of that day, with no zone', async () => {
    const { $ } = await get('/dev-ops/clients/gas')

    expect(flatten($('label[for="token-new-expires-date"]').text())).toBe(
      'Expiry date (end of day)'
    )
  })

  test('names the Change expiry choices "Expires" for a screen reader', async () => {
    const { $ } = await get('/dev-ops/clients/gas')

    expect(
      flatten($(`[data-testid="token-${tokenId}-expires"] legend`).text())
    ).toBe('Expires')
  })

  test.each(['gas', 'cw'])(
    'says only the date in every %s dialog, and never the service in full',
    async (service) => {
      vi.mocked(listAccessTokensUseCase).mockResolvedValue([
        token({ expiresAt: '2027-02-01T10:00:00.000Z' })
      ])

      const { $ } = await get(`/dev-ops/clients/${service}`)
      const tokenDialogs = $('dialog').not('#times-dialog')
      const dialogs = flatten(tokenDialogs.text())

      expect(tokenDialogs).toHaveLength(4)
      expect(
        flatten($(`[data-testid="token-${tokenId}-expiry-currently"]`).text())
      ).toBe('Currently: 1 Feb 2027')
      expect(dialogs).not.toMatch(/\bin \d+[dh]\b|\b\d+[dh] ago\b/)
      expect(dialogs).not.toMatch(/\bin \d+ days?\b|\bdays? ago\b/)
      expect(dialogs).not.toContain('Grant Application Service')
      expect(dialogs).not.toContain('Caseworking Backend')
    }
  )

  test('opens Change expiry on the exact current expiry, and on Never for none', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue([
      token({ expiresAt: '2027-02-01T10:00:00.000Z' }),
      token({ tokenId: '6650c1f2a9e4b1d07c20bd95', expiresAt: null })
    ])

    const { $ } = await get('/dev-ops/clients/gas')
    const picker = $(`[data-testid="token-${tokenId}-expires"]`)

    expect(picker.attr('data-current')).toBe('2027-02-01T10:00:00.000Z')
    expect(
      $(`[data-testid="token-${tokenId}-expires-custom"]`).attr('checked')
    ).toBe('checked')
    expect(flatten(picker.find('[data-expiry-summary]').text())).toMatch(
      /^Expires 1 Feb 2027\.$/
    )
    expect(
      $('[data-testid="token-6650c1f2a9e4b1d07c20bd95-expires-never"]').attr(
        'checked'
      )
    ).toBe('checked')
  })

  test('holds Save on a token that has stopped until a new expiry is picked', async () => {
    const { $ } = await get('/dev-ops/clients/gas')

    expect(
      flatten(
        $(`[data-testid="token-${tokens[2].tokenId}-expires-summary"]`).text()
      )
    ).toBe('Pick a date in the future.')
  })

  test('never revives a stopped token on an untouched Save', async () => {
    const { statusCode } = await post(
      `/dev-ops/clients/gas/example-legacy-caller/tokens/${tokens[2].tokenId}/expiry`,
      {
        expiry: 'custom',
        date: '2026-11-01',
        current: '2026-11-01T09:00:00.000Z',
        hint: ''
      }
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(changeTokenExpiryUseCase).not.toHaveBeenCalled()
  })

  test('links a past date to its field, with the error on the page from the start', async () => {
    const { $ } = await post(`${tokenPath}/expiry`, {
      expiry: 'custom',
      date: '2020-01-01',
      hint: 'x7Qa'
    })
    const date = $(`[data-testid="token-${tokenId}-expires-date"]`)
    const error = $(`#token-${tokenId}-expires-error`)

    expect(date.attr('aria-invalid')).toBe('true')
    expect(date.attr('aria-describedby')).toBe(`token-${tokenId}-expires-error`)
    expect(flatten(error.text())).toBe('Pick a date in the future.')
  })

  test('shows a row with no valid name as "—", with a drawer that offers nothing', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue([
      token({ clientId: null })
    ])

    const { $ } = await get('/dev-ops/clients/gas')
    const panel = $(`[data-token-panel="${tokenId}"]`)

    expect(flatten($('[data-testid="token-row-client-none"]').text())).toBe('—')
    expect(panel.find('[data-testid$="-actions"] button')).toHaveLength(0)
    expect(flatten(panel.find('[data-testid$="-note"]').text())).toBe(
      "This token has no valid client ID, so it can't be changed here."
    )
    expect($(`[id^="token-${tokenId}-"]`).filter('dialog')).toHaveLength(0)
  })
})

describe('the CW page', () => {
  const cwPath = `/dev-ops/clients/cw/grants-ui/tokens/${tokenId}`

  beforeEach(() => {
    vi.mocked(listAccessTokensUseCase).mockImplementation(async (service) =>
      service === 'cw' ? tokens : tokens.slice(0, 1)
    )
  })

  test('tags no row, and draws no note or Revoke on the token GAS calls with', async () => {
    const { $ } = await get('/dev-ops/clients/cw')
    const inUse = $(`[data-token-panel="${tokens[1].tokenId}"]`)

    expect($('[data-testid="token-row-tag"]')).toHaveLength(0)
    expect(inUse.find('[data-testid$="-in-use"]')).toHaveLength(0)
    expect(inUse.text()).not.toContain(
      'This is the token GAS calls Caseworking with'
    )
    expect(inUse.find('[data-testid$="-revoke"]')).toHaveLength(0)
    expect(bannedIn($)).toBe(false)
  })

  test('says CW could not be loaded while GAS still can', async () => {
    vi.mocked(listAccessTokensUseCase).mockImplementation(async (service) =>
      service === 'cw' ? null : tokens
    )

    const cw = await get('/dev-ops/clients/cw')
    const gas = await get('/dev-ops/clients/gas')

    expect(flatten(cw.$('[data-testid="tokens-error"]').text())).toBe(
      'CW access tokens could not be loaded.'
    )
    expect(gas.$('[data-testid="token-row"]')).toHaveLength(3)
  })

  test.each([
    [
      { outcome: 'refused', statusCode: 403, errorCode: null },
      'Not revoked — CW-BE refused the request. Nothing has changed.'
    ],
    [
      { outcome: 'refused', statusCode: 404, errorCode: 'API_TOKEN_NOT_FOUND' },
      'Not revoked — CW-BE no longer has this token. Nothing has changed.'
    ],
    [
      { outcome: 'unreachable', errorCode: 'CW_UNREACHABLE' },
      'Not revoked — CW-BE could not be reached. Nothing has changed.'
    ],
    [
      { outcome: 'unreachable' },
      'Not revoked — fg-gas-backend could not be reached. Nothing has changed.'
    ],
    [{ outcome: 'unknown' }, 'Revoke status unknown — refresh to check.']
  ] as const)('names who failed for %j', async (result, text) => {
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue(result)

    const written = await post(`${cwPath}/revoke`, {
      confirm: 'grants-ui',
      hint: 'x7Qa'
    })
    const page = await get('/dev-ops/clients/cw', sessionCookie(written))

    expect(toastOf(page.$).text).toBe(text)
    expect(bannedIn(page.$)).toBe(false)
  })

  test('refuses an in-use revoke in the dialog, in the Caseworking words', async () => {
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_IN_USE'
    })

    const { $ } = await post(`${cwPath}/revoke`, {
      confirm: 'grants-ui',
      hint: 'x7Qa'
    })

    expect(flatten($(`#token-${tokenId}-revoke-form-error`).text())).toBe(
      'Not revoked — fg-gas-backend is calling CW-BE with this token. Rotate it instead. Nothing has changed.'
    )
  })
})

describe('what a failed rotation leaves', () => {
  test.each([
    ['a 500', { outcome: 'unknown' }],
    ['a 504', { outcome: 'unknown' }]
  ] as const)(
    'shows no token after %s, in the page or the session',
    async (_name, result) => {
      vi.mocked(rotateAccessTokenUseCase).mockResolvedValue(result)

      const { written, page } = await postAndFollow(`${tokenPath}/rotate`, {
        keepOld: '24h'
      })

      expect(written.payload).not.toContain(raw)
      expect(page.payload).not.toContain(raw)
      expect(page.$('[data-testid="token-reveal"]')).toHaveLength(0)
      expect(sessions.join('')).not.toContain(raw)
      expect(toastOf(page.$).text).toBe(
        'Rotation status unknown — refresh to check. If a new token was issued, revoke it: its value is gone.'
      )
    }
  )
})

describe('character icons', () => {
  test('appear nowhere but the hint mask on a reveal, an error re-render or a toast', async () => {
    vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
      outcome: 'issued',
      raw,
      token: token()
    })
    const reveal = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'grants-ui',
      expiry: '90',
      date: ''
    })
    const error = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'Bad',
      expiry: '90',
      date: ''
    })
    vi.mocked(deleteAccessTokenUseCase).mockResolvedValue({ outcome: 'done' })
    const { page } = await postAndFollow(`${tokenPath}/delete`, {
      hint: 'x7Qa'
    })

    expect(bannedIn(reveal.$)).toBe(false)
    expect(bannedIn(error.$)).toBe(false)
    expect(page.$('[data-testid="token-toast"]')).toHaveLength(1)
    expect(bannedIn(page.$)).toBe(false)
  })
})
