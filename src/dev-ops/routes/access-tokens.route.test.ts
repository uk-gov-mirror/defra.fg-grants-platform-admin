import { load } from 'cheerio'
import type { CheerioAPI } from 'cheerio'
import type { Request, ResponseToolkit, Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  closeHrefOf,
  expectTablesStyled,
  isOpenWithoutScript,
  resetsOnOpen,
  tableStyles
} from '../test-utils.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import type {
  ListResult,
  ListedToken
} from '../use-cases/access-tokens.use-case.ts'
import {
  changeTokenExpiryUseCase,
  deleteAccessTokenUseCase,
  issueAccessTokenUseCase,
  listAccessTokensUseCase,
  revokeAccessTokenUseCase,
  rotateAccessTokenUseCase
} from '../use-cases/access-tokens.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/access-tokens.use-case.ts'), async (original) => ({
  ...(await original()),
  listAccessTokensUseCase: vi.fn(),
  issueAccessTokenUseCase: vi.fn(),
  rotateAccessTokenUseCase: vi.fn(),
  changeTokenExpiryUseCase: vi.fn(),
  revokeAccessTokenUseCase: vi.fn(),
  deleteAccessTokenUseCase: vi.fn()
}))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const sameOrigin = { 'sec-fetch-site': 'same-origin' }
const day = 86_400_000
const raw = 'Zq3pLm8Rt2Vw9Xy4Ab7Cd1Ef6Gh0Ij5Kl3Mn8Op2x7Qa'

const inDays = (days: number) => new Date(Date.now() + days * day).toISOString()

const token = (fields: Partial<ListedToken> = {}): ListedToken => ({
  tokenId: '6650c1f2a9e4b1d07c20bd91',
  clientId: 'grants-ui',
  tokenHint: '3e1d',
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

const ids = {
  inUse: '6650c1f2a9e4b1d07c20bd90',
  active: '6650c1f2a9e4b1d07c20bd91',
  dated: '6650c1f2a9e4b1d07c20bd92',
  expiring: '6650c1f2a9e4b1d07c20bd93',
  revoked: '6650c1f2a9e4b1d07c20bd94',
  expired: '6650c1f2a9e4b1d07c20bd95',
  legacy: '6650c1f2a9e4b1d07c20bd96'
}

const gasTokens: ListedToken[] = [
  token({
    tokenId: ids.inUse,
    clientId: 'fg-grants-platform-admin',
    tokenHint: '0c4a',
    inUse: true
  }),
  token({ tokenId: ids.active }),
  token({
    tokenId: ids.dated,
    clientId: 'farming-grants-agreements-ui',
    tokenHint: '7f2c',
    expiresAt: '2027-01-31T23:59:59.000Z'
  }),
  token({
    tokenId: ids.expiring,
    clientId: 'fg-gss-pmf',
    tokenHint: 'e91a',
    expiresAt: inDays(4)
  }),
  token({
    tokenId: ids.revoked,
    clientId: 'old-caller',
    tokenHint: 'b4d0',
    status: 'REVOKED',
    expiresAt: '2026-10-01T09:00:00.000Z'
  }),
  token({
    tokenId: ids.expired,
    clientId: 'land-grants-api',
    tokenHint: '91aa',
    status: 'EXPIRED',
    expiresAt: '2026-11-01T23:59:59.000Z'
  }),
  token({ tokenId: ids.legacy, clientId: null, tokenHint: null })
]

const cwTokens: ListedToken[] = [
  token({
    tokenId: ids.inUse,
    clientId: 'fg-gas-backend',
    tokenHint: 'a6f1',
    inUse: true
  }),
  token({ tokenId: ids.active, clientId: 'fg-cw-frontend', tokenHint: '52aa' })
]

const listed = (tokens: ListedToken[]): ListResult => ({
  outcome: 'done',
  tokens
})

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

let server: Server
let sessions: string[]

interface Page {
  statusCode: number
  headers: Record<string, unknown>
  payload: string
  $: CheerioAPI
}

const get = async (url: string, cookie?: string): Promise<Page> => {
  const response = await server.inject({
    method: 'GET',
    url,
    ...(cookie ? { headers: { cookie } } : {}),
    auth: { strategy: 'session', credentials }
  })

  const $ = load(response.payload)
  expectTablesStyled($, response.headers['content-security-policy'])

  return { ...response, $ }
}

const post = async (
  url: string,
  payload: Record<string, string> = {},
  headers: Record<string, string> = sameOrigin
): Promise<Page> => {
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
const postAndFollow = async (
  url: string,
  payload: Record<string, string> = {}
) => {
  const written = await post(url, payload)
  const cookie = sessionCookie(written)

  return {
    written,
    cookie,
    page: await get(written.headers.location as string, cookie)
  }
}

const isChoice = (type: string | undefined) =>
  type === 'radio' || type === 'checkbox'

/** A form as a browser without a script would send it: its fields, the ones picked, and its hidden values. */
const formOf = ($: CheerioAPI, formId: string): Record<string, string> =>
  Object.fromEntries(
    $(`form#${formId} input[name]`)
      .filter(
        (_i, input) =>
          !isChoice($(input).attr('type')) || $(input).is('[checked]')
      )
      .map((_i, input) => [
        [$(input).attr('name') as string, $(input).attr('value') ?? '']
      ])
      .get()
  )

const text = ($: CheerioAPI, selector: string) => flatten($(selector).text())

/** Each choice of a radio group as read aloud: its label, then its hint. */
const choicesOf = ($: CheerioAPI, selector: string) =>
  $(`${selector} .gpa-group-options .gpa-check`)
    .map((_i, o) =>
      flatten(
        $(o)
          .find('.gpa-check-text > span')
          .add($(o).children('span:not(.gpa-radio-dot):not(.gpa-check-text)'))
          .map((_j, part) => $(part).text())
          .get()
          .join(' ')
      )
    )
    .get()
const tokenPath = (id: string, client = 'grants-ui') =>
  `/dev-ops/clients/gas/${client}/tokens/${id}`
const drawerOf = ($: CheerioAPI, id: string) => $(`dialog#token-${id}`)
const toastOf = ($: CheerioAPI) => ({
  tone: ($('[data-testid="toast"]').attr('class') ?? '').replace(
    /.*gpa-toast-(\w+).*/,
    '$1'
  ),
  text: text($, '[data-testid="toast"] .gpa-toast-text')
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
  vi.mocked(listAccessTokensUseCase).mockImplementation(async (service) =>
    listed(service === 'gas' ? gasTokens : cwTokens)
  )
})

afterAll(async () => {
  await server.stop()
})

describe('the list', () => {
  test('Loaded (GAS): four columns, each token’s row opening its drawer, and the page never cached', async () => {
    const { statusCode, headers, $ } = await get('/dev-ops/clients/gas')

    expect(statusCode).toBe(200)
    expect(headers['cache-control']).toBe('no-store')
    expect(text($, 'h1')).toBe('Access tokens')
    expect(
      $('.gpa-pageheader-meta .gpa-meta-item')
        .map((_i, m) => flatten($(m).text()))
        .get()
    ).toEqual([
      'Grant Application Service',
      'Tokens are stored as SHA-256 hashes; the value is shown once, when it’s issued.'
    ])
    expect(
      $('[data-testid="tokens-table"] th')
        .map((_i, th) => flatten($(th).text()))
        .get()
    ).toEqual(['Client ID', 'Token', 'Status', 'Expires'])

    const newButton = $('[data-testid="token-new-open"]')
    expect(newButton.attr('href')).toBe('/dev-ops/clients/gas?dialog=new')
    expect(newButton.attr('data-gpa-open')).toBe('token-new')

    const rows = $('[data-testid="token-row"]')
    expect(rows).toHaveLength(7)

    const first = rows.first()
    expect(first.find('.gpa-rowlink').attr('href')).toBe(
      `/dev-ops/clients/gas?token=${ids.dated}`
    )
    expect(first.find('.gpa-rowlink').attr('data-gpa-open')).toBe(
      `token-${ids.dated}`
    )
    expect(first.find('.gpa-rowlink').hasClass('gpa-mono')).toBe(true)
    expect(flatten(first.find('td').eq(1).text())).toBe('…7f2c')
    expect(first.find('.gpa-dot').hasClass('gpa-dot-success')).toBe(true)
    expect(flatten(first.find('time').text())).toBe('31 Jan 2027')
  })

  test('Loaded: each state has its tone, and a token that never expires says Never, faintly', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const rowOf = (id: string) =>
      $(`[data-testid="token-row"]:has(a[data-gpa-open="token-${id}"])`)

    expect(rowOf(ids.expiring).find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-warning'
    )
    expect(flatten(rowOf(ids.expiring).find('.gpa-status').text())).toBe(
      'Expiring soon'
    )
    expect(rowOf(ids.revoked).find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-danger'
    )
    expect(rowOf(ids.expired).find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-neutral'
    )
    expect(
      rowOf(ids.active).find('td').eq(3).find('.gpa-text-subtle').text()
    ).toBe('Never')
  })

  test('Loaded: a row with no client ID or hint shows Not set, and sorts last', async () => {
    const { $ } = await get('/dev-ops/clients/gas')
    const last = $('[data-testid="token-row"]').last()

    expect(last.find('.gpa-rowlink .gpa-fact-empty').attr('aria-label')).toBe(
      'Not set'
    )
    expect(last.find('td').eq(1).find('.gpa-fact-empty')).toHaveLength(1)
  })

  test('Loaded (CW): Caseworking named in full under the title', async () => {
    const { $ } = await get('/dev-ops/clients/cw')

    expect(text($, '.gpa-pageheader-meta .gpa-meta-item:first-child')).toBe(
      'Caseworking'
    )
    expect($('[data-testid="token-row"]')).toHaveLength(2)
  })

  test('loads only the design system’s stylesheet, with no inline style but the table’s nonce’d widths', async () => {
    const { payload, headers, $ } = await get('/dev-ops/clients/gas')

    expect(
      $('link[rel="stylesheet"]')
        .map((_i, link) => $(link).attr('href'))
        .get()
    ).toEqual(['/public/src/dev-ops/views/components/index.css'])
    expect(payload).not.toMatch(/style="/)
    expect($('style')).toHaveLength(1)
    expect(tableStyles($, headers['content-security-policy'])).toEqual([
      { label: 'Access tokens', nonced: true, widths: true }
    ])
  })

  test('No matches is the empty list: no tokens yet, with no body (tokens have no filters)', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue(listed([]))

    const { $ } = await get('/dev-ops/clients/gas')

    expect(text($, '.gpa-empty-title')).toBe('No access tokens yet')
    expect($('.gpa-empty-body')).toHaveLength(0)
    expect($('[data-testid="token-row"]')).toHaveLength(0)
  })

  test('Unavailable: GAS didn’t answer, so no table, a way to try again, and New token stays', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue({ outcome: 'unknown' })

    const { statusCode, $ } = await get('/dev-ops/clients/gas')
    const alert = $('[data-testid="tokens-alert"]')

    expect(statusCode).toBe(503)
    expect(alert.hasClass('gpa-alert-danger')).toBe(true)
    expect(text($, '[data-testid="tokens-alert"] .gpa-alert-title')).toBe(
      'The tokens list couldn’t be loaded.'
    )
    expect(flatten(alert.find('.gpa-alert-body > div').first().text())).toBe(
      'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
    )
    expect(alert.find('.gpa-alert-actions a').attr('href')).toBe(
      '/dev-ops/clients/gas'
    )
    expect(text($, '.gpa-alert-actions')).toBe('Try again')
    expect($('[data-testid="tokens-table"]')).toHaveLength(0)
    expect($('[data-testid="token-new-open"]')).toHaveLength(1)
    expect($('dialog#token-new')).toHaveLength(1)
  })

  test('Unavailable: GAS answered with an error, as when CW has no client routes, names GAS', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue({ outcome: 'errored' })

    const { statusCode, $ } = await get('/dev-ops/clients/cw')
    const alert = $('[data-testid="tokens-alert"]')

    expect(statusCode).toBe(503)
    expect(alert.hasClass('gpa-alert-danger')).toBe(true)
    expect(flatten(alert.find('.gpa-alert-body > div').first().text())).toBe(
      'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.'
    )
    expect(text($, '.gpa-alert-actions')).toBe('Try again')
  })

  test.each(['gas', 'cw'] as const)(
    'Not offered: a GAS with no token routes says so on the %s page, with nothing to retry and no New token',
    async (service) => {
      vi.mocked(listAccessTokensUseCase).mockResolvedValue({
        outcome: 'not-offered'
      })

      const { statusCode, $ } = await get(`/dev-ops/clients/${service}`)
      const alert = $('[data-testid="tokens-alert"]')

      expect(statusCode).toBe(200)
      expect(alert).toHaveLength(1)
      expect(alert.hasClass('gpa-alert-warning')).toBe(true)
      expect(alert.is('[data-focus-on-arrival]')).toBe(false)
      expect(text($, '[data-testid="tokens-alert"] .gpa-alert-title')).toBe(
        'This GAS doesn’t offer access tokens.'
      )
      expect(flatten(alert.find('.gpa-alert-body > div').first().text())).toBe(
        'It’s an older version without the access tokens API. Tokens can be managed here once GAS is upgraded.'
      )
      expect(alert.find('.gpa-alert-actions')).toHaveLength(0)
      expect($('[data-testid="tokens-table"]')).toHaveLength(0)
      expect($('[data-testid="token-new-open"]')).toHaveLength(0)
      expect($('dialog#token-new')).toHaveLength(0)
    }
  )

  test('Not offered: an address asking for New token opens nothing', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue({
      outcome: 'not-offered'
    })

    const { $ } = await get('/dev-ops/clients/gas?dialog=new')

    expect($('dialog#token-new')).toHaveLength(0)
    expect($('dialog[open]')).toHaveLength(0)
  })

  test('Unavailable: the alert isn’t news, so it doesn’t take the focus', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue({ outcome: 'unknown' })

    const { $ } = await get('/dev-ops/clients/gas')

    expect(
      $('[data-testid="tokens-alert"]').is('[data-focus-on-arrival]')
    ).toBe(false)
  })

  test('Unavailable: CW not reached behind GAS names CW', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue({
      outcome: 'unreachable',
      errorCode: 'CW_UNREACHABLE'
    })

    const { $ } = await get('/dev-ops/clients/cw')

    expect(
      flatten(
        $('[data-testid="tokens-alert"] .gpa-alert-body > div').first().text()
      )
    ).toBe(
      'CW couldn’t be reached. Nothing has changed — try again in a moment.'
    )
  })

  test('Catalogue down: the tokens page still works, and the sidebar keeps only the Overview and Access tokens', async () => {
    vi.mocked(getCatalogueUseCase).mockResolvedValueOnce(null)

    const { statusCode, $ } = await get('/dev-ops/clients/gas')

    expect(statusCode).toBe(200)
    expect($('[data-testid="token-row"]')).toHaveLength(7)
    expect(
      $('[data-testid="shell-nav"] a')
        .map((_i, a) => $(a).attr('href'))
        .get()
    ).toEqual(['/dev-ops', '/dev-ops/clients/gas', '/dev-ops/clients/cw'])
  })

  test('a token, dialog or param the address can’t mean is a bad request', async () => {
    expect((await get('/dev-ops/clients/gas?token=nope')).statusCode).toBe(400)
    expect((await get('/dev-ops/clients/gas?dialog=burn')).statusCode).toBe(400)
    expect((await get('/dev-ops/clients/gas?status=active')).statusCode).toBe(
      400
    )
  })

  test('opens Times from the address over an open drawer, which stays open', async () => {
    const page = `/dev-ops/clients/gas?token=${ids.dated}`
    const { statusCode, $ } = await get(`${page}&times=open`)

    expect(statusCode).toBe(200)
    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect($('#times-dialog .gpa-dialog-close').attr('href')).toBe(page)
    expect(isOpenWithoutScript($, `token-${ids.dated}`)).toBe(true)
  })
})

describe('the drawer', () => {
  test('is drawn for every token, closed, so the script can open it in place', async () => {
    const { $ } = await get('/dev-ops/clients/gas')

    expect($('[data-testid="token-drawer"]')).toHaveLength(7)
    expect($('dialog[open]')).toHaveLength(0)
  })

  test('Active: mono title, state under it, the three facts, the stored document and three actions', async () => {
    const { $ } = await get(`/dev-ops/clients/gas?token=${ids.dated}`)
    const drawer = drawerOf($, ids.dated)

    expect(isOpenWithoutScript($, `token-${ids.dated}`)).toBe(true)
    expect(drawer.find(`#token-${ids.dated}-title`).hasClass('gpa-mono')).toBe(
      true
    )
    expect(flatten(drawer.find(`#token-${ids.dated}-title`).text())).toBe(
      'farming-grants-agreements-ui'
    )
    expect(flatten(drawer.find('.gpa-drawer-sub').text())).toBe('Active')
    expect(
      drawer
        .find('dt')
        .map((_i, dt) => $(dt).text())
        .get()
    ).toEqual(['Client ID', 'Token', 'Expires'])
    expect(drawer.find('dd').eq(0).find('gpa-copy').attr('data-value')).toBe(
      'farming-grants-agreements-ui'
    )
    expect(flatten(drawer.find('dd').eq(1).text())).toBe('…7f2c')
    expect(drawer.find('dd').eq(2).find('time').attr('datetime')).toBe(
      '2027-01-31T23:59:59Z'
    )
    expect(text($, `dialog#token-${ids.dated} .gpa-card-head`)).toBe(
      'Stored document'
    )
    expect(JSON.parse(drawer.find('pre').text())).toMatchObject({
      clientId: 'farming-grants-agreements-ui'
    })
    expect(
      drawer
        .find('.gpa-drawer-foot .gpa-btn')
        .map((_i, b) => flatten($(b).text()))
        .get()
    ).toEqual(['Rotate', 'Change expiry', 'Revoke'])
    expect(drawer.find('[data-testid="token-rotate"]').attr('href')).toBe(
      `/dev-ops/clients/gas?token=${ids.dated}&dialog=rotate`
    )
    expect(
      drawer.find('[data-testid="token-rotate"]').attr('data-gpa-open')
    ).toBe(`token-${ids.dated}-rotate`)
    expect(drawer.find('.gpa-dialog-close').attr('href')).toBe(
      '/dev-ops/clients/gas'
    )
    expect(
      $(`tr:has(a[data-gpa-open="token-${ids.dated}"])`).hasClass('is-selected')
    ).toBe(true)
  })

  test('Expiring soon', async () => {
    const { $ } = await get(`/dev-ops/clients/gas?token=${ids.expiring}`)

    expect(
      flatten(drawerOf($, ids.expiring).find('.gpa-drawer-sub').text())
    ).toBe('Expiring soon')
  })

  test('Expired: Change expiry and Delete, as the services refuse rotating or revoking it', async () => {
    const { $ } = await get(`/dev-ops/clients/gas?token=${ids.expired}`)
    const drawer = drawerOf($, ids.expired)

    expect(flatten(drawer.find('.gpa-drawer-sub').text())).toBe('Expired')
    expect(
      drawer
        .find('.gpa-drawer-foot .gpa-btn')
        .map((_i, b) => flatten($(b).text()))
        .get()
    ).toEqual(['Change expiry', 'Delete'])
  })

  test('Revoked: Delete only', async () => {
    const { $ } = await get(`/dev-ops/clients/gas?token=${ids.revoked}`)

    expect(
      drawerOf($, ids.revoked)
        .find('.gpa-drawer-foot .gpa-btn')
        .map((_i, b) => flatten($(b).text()))
        .get()
    ).toEqual(['Delete'])
  })

  test('In use (GAS): says Dev Ops calls GAS with it, and Revoke is off with the reason as its description', async () => {
    const { $ } = await get(`/dev-ops/clients/gas?token=${ids.inUse}`)
    const drawer = drawerOf($, ids.inUse)
    const revoke = drawer.find('[data-testid="token-revoke"]')

    expect(
      text(
        $,
        `dialog#token-${ids.inUse} [data-testid="token-in-use"] .gpa-alert-title`
      )
    ).toBe('Dev Ops calls GAS with this token.')
    expect(
      flatten(
        drawer.find('[data-testid="token-in-use"] .gpa-alert-body > div').text()
      )
    ).toBe(
      'Revoking it would cut Dev Ops off from GAS. Rotate it instead, keeping the old one valid while the new one is deployed.'
    )
    expect(revoke.attr('aria-disabled')).toBe('true')
    expect(revoke.attr('data-gpa-open')).toBeUndefined()
    expect(revoke.attr('href')).toBeUndefined()
    expect(flatten($(`#${revoke.attr('aria-describedby')}`).text())).toBe(
      'Dev Ops is calling GAS with this token. Rotate it instead.'
    )
    expect($(`dialog#token-${ids.inUse}-revoke`)).toHaveLength(0)
  })

  test('In use (CW): GAS calls CW with it', async () => {
    const { $ } = await get(`/dev-ops/clients/cw?token=${ids.inUse}`)
    const drawer = drawerOf($, ids.inUse)

    expect(
      flatten(
        drawer.find('[data-testid="token-in-use"] .gpa-alert-title').text()
      )
    ).toBe('GAS calls CW with this token.')
    expect(
      flatten(
        drawer.find('[data-testid="token-in-use"] .gpa-alert-body > div').text()
      )
    ).toBe(
      'Revoking it would cut GAS, and Dev Ops through it, off from CW. Rotate it instead, keeping the old one valid while the new one is deployed.'
    )
    expect(
      flatten(
        $(
          `#${drawer.find('[data-testid="token-revoke"]').attr('aria-describedby')}`
        ).text()
      )
    ).toBe('GAS is calling CW with this token. Rotate it instead.')
  })

  test('A row with no client ID or hint: Not set, no actions, and why', async () => {
    const { $ } = await get(`/dev-ops/clients/gas?token=${ids.legacy}`)
    const drawer = drawerOf($, ids.legacy)

    expect(flatten(drawer.find(`#token-${ids.legacy}-title`).text())).toBe(
      'Not set'
    )
    expect(drawer.find(`#token-${ids.legacy}-title`).hasClass('gpa-mono')).toBe(
      false
    )
    expect(drawer.find('dd').eq(0).find('.gpa-fact-empty')).toHaveLength(1)
    expect(drawer.find('dd').eq(1).find('.gpa-fact-empty')).toHaveLength(1)
    expect(drawer.find('.gpa-drawer-foot')).toHaveLength(0)
    expect(
      text($, `dialog#token-${ids.legacy} [data-testid="token-no-actions"]`)
    ).toBe('This token has no valid client ID, so it can’t be changed here.')
  })

  test('a token the list doesn’t have opens nothing', async () => {
    const { statusCode, $ } = await get(
      '/dev-ops/clients/gas?token=ffffffffffffffffffffffff&dialog=rotate'
    )

    expect(statusCode).toBe(200)
    expect($('dialog[open]')).toHaveLength(0)
  })
})

describe('New token', () => {
  test('opens from the address, over the list: client ID, expiry choices each saying where they land, 90 days picked', async () => {
    vi.useFakeTimers({
      toFake: ['Date'],
      now: new Date('2026-11-10T15:00:00.000Z')
    })
    try {
      const { $ } = await get('/dev-ops/clients/gas?dialog=new')
      const dialog = $('dialog#token-new')

      expect(isOpenWithoutScript($, 'token-new')).toBe(true)
      expect(flatten(dialog.find('h2').text())).toBe('New token')
      expect(dialog.find('.gpa-dialog-close').attr('href')).toBe(
        '/dev-ops/clients/gas'
      )
      expect(text($, 'label[for="token-new-client"]')).toBe('Client ID')
      expect(text($, '#token-new-client-hint')).toBe(
        'The calling service, usually its CDP name. Lowercase letters, digits and hyphens.'
      )
      expect($('#token-new-client').attr('placeholder')).toBe('grants-ui')
      expect(text($, '#token-new-expiry-hint')).toBe(
        'The token stops working at the end of that day, UK time.'
      )
      expect(choicesOf($, 'dialog#token-new')).toEqual([
        'Never Not recommended for a service.',
        '30 days Ends 10 Dec 2026.',
        '90 days Ends 8 Feb 2027.',
        '1 year Ends 10 Nov 2027.',
        'Custom date'
      ])
      expect(dialog.find('input[name="expiry"][checked]').val()).toBe('90')
      expect(
        dialog
          .find('#token-new-expiry-5-conditional input[type="date"]')
          .attr('min')
      ).toBe('2026-11-11')
      expect(
        dialog
          .find('.gpa-dialog-foot .gpa-btn')
          .map((_i, b) => flatten($(b).text()))
          .get()
      ).toEqual(['Cancel', 'Issue token'])
      expect(dialog.find('[data-testid="token-new-submit"]').attr('form')).toBe(
        'token-new-form'
      )
      expect(
        dialog
          .find('[data-testid="token-new-submit"]')
          .is('[data-gpa-loading-on-submit]')
      ).toBe(true)
      expect($('[data-testid="token-prod-note"]')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  test('a client ID that breaks the rule comes back on the field and in the summary', async () => {
    const { statusCode, headers, $ } = await post(
      '/dev-ops/clients/gas/tokens',
      { clientId: 'Grants UI', expiry: '90', date: '' }
    )

    expect(statusCode).toBe(400)
    expect(headers['cache-control']).toBe('no-store')
    expect(isOpenWithoutScript($, 'token-new')).toBe(true)
    expect(text($, '#token-new-client-err')).toBe(
      'Use lowercase letters, digits and hyphens only.'
    )
    expect($('#token-new-client').attr('value')).toBe('Grants UI')
    expect($('#token-new-client').attr('aria-invalid')).toBe('true')
    expect($('.gpa-errorsummary a').attr('href')).toBe('#token-new-client')
    expect(issueAccessTokenUseCase).not.toHaveBeenCalled()
  })

  test('Custom date with no date asks for one on the date box, Custom date still picked', async () => {
    const { statusCode, $ } = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'grants-ui',
      expiry: 'custom',
      date: ''
    })

    expect(statusCode).toBe(400)
    expect(text($, '#token-new-expiry-date-err')).toBe(
      'Enter an expiry date like 4 Feb 2027.'
    )
    expect($('dialog#token-new input[name="expiry"][checked]').val()).toBe(
      'custom'
    )
    expect($('.gpa-errorsummary a').attr('href')).toBe('#token-new-expiry-date')
  })

  test('a date of today or before asks for a later one', async () => {
    const { $ } = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'grants-ui',
      expiry: 'custom',
      date: '2020-01-01'
    })

    expect(text($, '#token-new-expiry-date-err')).toBe(
      'Pick a date after today.'
    )
    expect($('#token-new-expiry-date').attr('value')).toBe('2020-01-01')
  })

  test('a client ID over 64 characters', async () => {
    const { $ } = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'a'.repeat(65),
      expiry: '90',
      date: ''
    })

    expect(text($, '#token-new-client-err')).toBe('Use 64 characters or fewer.')
  })

  test.each([
    [
      'API_CLIENT_EXISTS',
      'Someone has just created this client. Issue again to add a token to it.'
    ],
    [
      'API_CLIENT_NOT_FOUND',
      'This client has just lost its last token. Issue again to make it afresh.'
    ]
  ])(
    'a race on the client (%s) comes back on the field',
    async (errorCode, message) => {
      vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
        outcome: 'refused',
        statusCode: 409,
        errorCode
      })

      const { statusCode, $ } = await post('/dev-ops/clients/gas/tokens', {
        clientId: 'new-caller',
        expiry: '90',
        date: ''
      })

      expect(statusCode).toBe(400)
      expect(text($, '#token-new-client-err')).toBe(message)
    }
  )

  test('a client with active tokens is warned about once, and issuing again goes ahead', async () => {
    vi.mocked(issueAccessTokenUseCase).mockResolvedValueOnce({
      outcome: 'has-active',
      active: 2
    })

    const warned = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'grants-ui',
      expiry: '30',
      date: ''
    })

    expect(warned.statusCode).toBe(200)
    expect(isOpenWithoutScript(warned.$, 'token-new')).toBe(true)
    expect(text(warned.$, '#token-new-client-warn')).toBe(
      'grants-ui already has 2 active tokens. If this replaces one, rotate that token instead; to add another, issue it again.'
    )
    expect(warned.$('#token-new-client').attr('aria-describedby')).toContain(
      'token-new-client-warn'
    )
    expect(warned.$('.gpa-errorsummary')).toHaveLength(0)
    expect(vi.mocked(issueAccessTokenUseCase).mock.calls[0][2]).toEqual({
      expiresAt: expect.any(String),
      confirmed: false
    })

    const again = formOf(warned.$, 'token-new-form')
    expect(again).toEqual({
      confirmFor: 'grants-ui',
      clientId: 'grants-ui',
      expiry: '30',
      date: ''
    })

    vi.mocked(issueAccessTokenUseCase).mockResolvedValueOnce({
      outcome: 'issued',
      raw,
      token: token()
    })
    const issued = await post('/dev-ops/clients/gas/tokens', again)

    expect(vi.mocked(issueAccessTokenUseCase).mock.calls[1][2]).toMatchObject({
      confirmed: true
    })
    expect(issued.$('#token-issued-value').attr('value')).toBe(raw)
  })

  test.each([
    [
      { outcome: 'unreachable' },
      'Not issued.',
      'GAS couldn’t be reached. Nothing has changed.'
    ],
    [
      { outcome: 'unchecked' },
      'Not issued.',
      'GAS couldn’t list the tokens to check this client. Nothing has changed.'
    ]
  ] as const)(
    'a write that didn’t happen (%j) says so at the top of the dialog',
    async (failure, title, body) => {
      vi.mocked(issueAccessTokenUseCase).mockResolvedValue(failure)

      const { statusCode, $ } = await post('/dev-ops/clients/gas/tokens', {
        clientId: 'new-caller',
        expiry: '90',
        date: ''
      })

      expect(statusCode).toBe(400)
      expect(
        text(
          $,
          'dialog#token-new [data-testid="token-refusal"] .gpa-alert-title'
        )
      ).toBe(title)
      expect(
        text(
          $,
          'dialog#token-new [data-testid="token-refusal"] .gpa-alert-body > div'
        )
      ).toBe(body)
      expect($('#token-new-client').attr('value')).toBe('new-caller')
    }
  )

  test('a stale New token against a GAS with no token routes: 400, the page says so, and no dialog', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue({
      outcome: 'not-offered'
    })
    vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
      outcome: 'not-offered'
    })

    const { statusCode, $ } = await post('/dev-ops/clients/gas/tokens', {
      clientId: 'new-caller',
      expiry: '90',
      date: ''
    })

    expect(statusCode).toBe(400)
    expect(text($, '[data-testid="tokens-alert"] .gpa-alert-title')).toBe(
      'This GAS doesn’t offer access tokens.'
    )
    expect($('dialog#token-new')).toHaveLength(0)
    expect($('dialog[open]')).toHaveLength(0)
  })
})

describe('Rotate', () => {
  test('says what it does with the same expiry and the old hint; starts on Keep valid until end of tomorrow', async () => {
    const { $ } = await get(
      `/dev-ops/clients/gas?token=${ids.dated}&dialog=rotate`
    )
    const dialog = $(`dialog#token-${ids.dated}-rotate`)

    expect(isOpenWithoutScript($, `token-${ids.dated}-rotate`)).toBe(true)
    expect(isOpenWithoutScript($, `token-${ids.dated}`)).toBe(true)
    expect(flatten(dialog.find('form p').first().text())).toBe(
      'Issues a new token for farming-grants-agreements-ui with the same expiry (31 Jan 2027). Keep the old one (…7f2c) valid long enough for the caller to switch over.'
    )
    expect(dialog.find('form p code').text()).toBe(
      'farming-grants-agreements-ui'
    )
    expect(choicesOf($, `dialog#token-${ids.dated}-rotate`)).toEqual([
      'Expire immediately The caller fails until it has the new token.',
      'Keep valid until end of tomorrow Enough for a same-day redeploy of the caller.',
      'Keep valid for 7 days, to end of day For callers released on a slower cycle.'
    ])
    expect(dialog.find('input[name="keepOld"][checked]').val()).toBe('24h')
    expect(dialog.find('.gpa-dialog-foot a').first().attr('href')).toBe(
      `/dev-ops/clients/gas?token=${ids.dated}`
    )
    expect(flatten(dialog.find('[data-testid$="-submit"]').text())).toBe(
      'Rotate token'
    )
  })

  test('a token that never expires says so', async () => {
    const { $ } = await get(
      `/dev-ops/clients/gas?token=${ids.active}&dialog=rotate`
    )

    expect(
      flatten($(`dialog#token-${ids.active}-rotate form p`).first().text())
    ).toContain('with the same expiry (never expires)')
  })

  test('In use: Expire immediately is off, with the reason under it', async () => {
    const { $ } = await get(
      `/dev-ops/clients/gas?token=${ids.inUse}&dialog=rotate`
    )
    const none = $(`dialog#token-${ids.inUse}-rotate input[value="none"]`)

    expect(none.is('[disabled]')).toBe(true)
    expect(flatten($(`#${none.attr('id')}-why`).text())).toBe(
      'Not for the token in use: Dev Ops would be locked out of GAS until it has the new token.'
    )
  })

  test.each([
    [
      'API_TOKEN_NOT_ACTIVE',
      'This token is no longer active. Nothing has changed.'
    ],
    [
      'API_TOKEN_IN_USE',
      'Dev Ops is calling GAS with this token. Keep the old one valid until the new one is deployed. Nothing has changed.'
    ],
    [
      'API_TOKEN_DUPLICATE',
      'The new token matched one already stored. Try again for a fresh one. Nothing has changed.'
    ]
  ])(
    'a refusal (%s) comes back in the dialog, on the choice it was sent with',
    async (errorCode, body) => {
      vi.mocked(rotateAccessTokenUseCase).mockResolvedValue({
        outcome: 'refused',
        statusCode: 409,
        errorCode
      })

      const { statusCode, $ } = await post(`${tokenPath(ids.active)}/rotate`, {
        keepOld: '7d'
      })
      const dialog = $(`dialog#token-${ids.active}-rotate`)

      expect(statusCode).toBe(400)
      expect(isOpenWithoutScript($, `token-${ids.active}-rotate`)).toBe(true)
      expect(
        flatten(
          dialog.find('[data-testid="token-refusal"] .gpa-alert-title').text()
        )
      ).toBe('Not rotated.')
      expect(
        flatten(
          dialog
            .find('[data-testid="token-refusal"] .gpa-alert-body > div')
            .text()
        )
      ).toBe(body)
      expect(dialog.find('input[name="keepOld"][checked]').val()).toBe('7d')
    }
  )
})

describe('Change expiry', () => {
  test('from a date: says what it is now and starts on it', async () => {
    const { $ } = await get(
      `/dev-ops/clients/gas?token=${ids.dated}&dialog=expiry`
    )
    const dialog = $(`dialog#token-${ids.dated}-expiry`)

    expect(isOpenWithoutScript($, `token-${ids.dated}-expiry`)).toBe(true)
    expect(flatten(dialog.find('form p').first().text())).toBe(
      'Currently: 31 Jan 2027.'
    )
    expect(dialog.find('input[name="expiry"][checked]').val()).toBe('custom')
    expect(dialog.find('input[type="date"]').attr('value')).toBe('2027-01-31')
    expect(flatten(dialog.find('[data-testid$="-submit"]').text())).toBe(
      'Save expiry'
    )
  })

  test('from never', async () => {
    const { $ } = await get(
      `/dev-ops/clients/gas?token=${ids.active}&dialog=expiry`
    )
    const dialog = $(`dialog#token-${ids.active}-expiry`)

    expect(flatten(dialog.find('form p').first().text())).toBe(
      'Currently: never expires.'
    )
    expect(dialog.find('input[name="expiry"][checked]').val()).toBe('never')
  })

  test('Custom date with no date comes back on the date box', async () => {
    const { statusCode, $ } = await post(`${tokenPath(ids.active)}/expiry`, {
      expiry: 'custom',
      date: '',
      hint: '3e1d'
    })

    expect(statusCode).toBe(400)
    expect(text($, `#token-${ids.active}-expiry-choice-date-err`)).toBe(
      'Enter an expiry date like 4 Feb 2027.'
    )
    expect(changeTokenExpiryUseCase).not.toHaveBeenCalled()
  })

  test('refused for the token in use, in the dialog', async () => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_IN_USE'
    })

    const { $ } = await post(
      `${tokenPath(ids.inUse, 'fg-grants-platform-admin')}/expiry`,
      { expiry: '30', date: '', hint: '0c4a' }
    )

    expect(
      text(
        $,
        `dialog#token-${ids.inUse}-expiry [data-testid="token-refusal"] .gpa-alert-body > div`
      )
    ).toBe(
      'Dev Ops is calling GAS with this token. Its expiry has to stay in the future. Nothing has changed.'
    )
  })
})

describe('Revoke', () => {
  test('asks for the client to be typed, and says what it does', async () => {
    const { $ } = await get(
      `/dev-ops/clients/gas?token=${ids.active}&dialog=revoke`
    )
    const dialog = $(`dialog#token-${ids.active}-revoke`)

    expect(isOpenWithoutScript($, `token-${ids.active}-revoke`)).toBe(true)
    expect(dialog.find('section').attr('role')).toBe('alertdialog')
    expect(dialog.find('section').hasClass('gpa-dialog-sm')).toBe(true)
    expect(flatten(dialog.find('h2').text())).toBe('Revoke token')
    expect(flatten(dialog.find('form p').text())).toBe(
      'Sets expiresAt to now. GAS rejects the token with 401 on the caller’s next request. The record stays for audit.'
    )
    expect(text($, `label[for="token-${ids.active}-revoke-type"]`)).toBe(
      'Type grants-ui to confirm'
    )
    expect(
      dialog.find('input[name="confirmText"]').attr('data-gpa-require')
    ).toBe('grants-ui')
    expect(dialog.find('.gpa-dialog-foot a').attr('href')).toBe(
      `/dev-ops/clients/gas?token=${ids.active}`
    )
    expect(dialog.find('.gpa-dialog-foot a').hasClass('gpa-btn-tertiary')).toBe(
      true
    )
    expect(
      dialog.find('[data-gpa-confirm]').hasClass('gpa-btn-danger-solid')
    ).toBe(true)
    expect(flatten(dialog.find('[data-gpa-confirm]').text())).toBe('Revoke')
  })

  test('on CW, CW rejects it', async () => {
    const { $ } = await get(
      `/dev-ops/clients/cw?token=${ids.active}&dialog=revoke`
    )

    expect(
      flatten($(`dialog#token-${ids.active}-revoke form p`).text())
    ).toContain('CW rejects the token with 401')
  })

  test('typed text that doesn’t match comes back, checked on the server', async () => {
    const { statusCode, $ } = await post(`${tokenPath(ids.active)}/revoke`, {
      confirmText: 'grants',
      hint: '3e1d'
    })

    const field = $(`#token-${ids.active}-revoke-type`)

    expect(statusCode).toBe(400)
    expect(isOpenWithoutScript($, `token-${ids.active}-revoke`)).toBe(true)
    expect(field.attr('value')).toBe('grants')
    expect(field.attr('aria-invalid')).toBe('true')
    expect(field.attr('aria-describedby')).toContain(
      `token-${ids.active}-revoke-type-err`
    )
    expect(text($, `#token-${ids.active}-revoke-type-err`)).toBe(
      'That doesn’t match.'
    )
    expect(
      $(`dialog#token-${ids.active}-revoke .gpa-errorsummary`)
    ).toHaveLength(0)
    expect(revokeAccessTokenUseCase).not.toHaveBeenCalled()
  })

  test('typed text comes back as text, never as markup', async () => {
    const typed = '"><b id="injected">x</b>'
    const { $ } = await post(`${tokenPath(ids.active)}/revoke`, {
      confirmText: typed,
      hint: '3e1d'
    })

    expect($(`#token-${ids.active}-revoke-type`).attr('value')).toBe(typed)
    expect($('#injected')).toHaveLength(0)
  })

  test('a refusal for a token the list no longer has is a toast', async () => {
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 404,
      errorCode: 'API_TOKEN_NOT_FOUND'
    })
    vi.mocked(listAccessTokensUseCase).mockResolvedValue(listed([gasTokens[0]]))

    const { statusCode, $ } = await post(`${tokenPath(ids.active)}/revoke`, {
      confirmText: 'grants-ui',
      hint: '3e1d'
    })

    expect(statusCode).toBe(400)
    expect($('dialog[open]')).toHaveLength(0)
    expect($('.gpa-toast-region')).toHaveLength(1)
    expect(toastOf($)).toEqual({
      tone: 'danger',
      text: 'Not revoked. GAS no longer has this token. Nothing has changed.'
    })
  })
})

describe('Delete', () => {
  test('says what happens to the record, Cancel the way out', async () => {
    const { $ } = await get(
      `/dev-ops/clients/gas?token=${ids.revoked}&dialog=delete`
    )
    const dialog = $(`dialog#token-${ids.revoked}-delete`)

    expect(isOpenWithoutScript($, `token-${ids.revoked}-delete`)).toBe(true)
    expect(flatten(dialog.find('h2').text())).toBe('Delete token record')
    expect(flatten(dialog.find('form p').text())).toBe(
      'Removes the token’s record, so this list won’t show it again. Its audit events stay.'
    )
    expect(dialog.find('.gpa-dialog-foot a').hasClass('gpa-btn-tertiary')).toBe(
      true
    )
    expect(flatten(dialog.find('[data-gpa-confirm]').text())).toBe('Delete')
    expect(dialog.find('form').attr('action')).toBe(
      `${tokenPath(ids.revoked, 'old-caller')}/delete`
    )
  })

  test('refused for an active token, in the dialog', async () => {
    vi.mocked(deleteAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_ACTIVE'
    })

    const { statusCode, $ } = await post(
      `${tokenPath(ids.revoked, 'old-caller')}/delete`
    )

    expect(statusCode).toBe(400)
    expect(
      text(
        $,
        `dialog#token-${ids.revoked}-delete [data-testid="token-refusal"] .gpa-alert-title`
      )
    ).toBe('Not deleted.')
    expect(
      text(
        $,
        `dialog#token-${ids.revoked}-delete [data-testid="token-refusal"] .gpa-alert-body > div`
      )
    ).toBe(
      'Only a revoked or expired token can be deleted. Nothing has changed.'
    )
  })
})

/** The code GAS refuses with, by the reason the page gives for it. */
const codeFor = (body: string): string =>
  [
    ['Dev Ops is calling', 'API_TOKEN_IN_USE'],
    ['Only a revoked', 'API_TOKEN_ACTIVE']
  ].find(([lead]) => body.startsWith(lead))?.[1] ?? 'API_TOKEN_NOT_ACTIVE'

/** The token changed state while its dialog was open: the fresh list no longer offers the action, so the drawer says why. */
describe('a refusal whose dialog isn’t drawn any more', () => {
  const withToken = (fields: Partial<ListedToken>) =>
    vi
      .mocked(listAccessTokensUseCase)
      .mockResolvedValue(
        listed(
          gasTokens.map((t) =>
            t.tokenId === ids.active ? { ...t, ...fields } : t
          )
        )
      )

  const drawerRefusal = ($: CheerioAPI, id: string) => ({
    title: text(
      $,
      `dialog#token-${id} [data-testid="token-drawer-refusal"] .gpa-alert-title`
    ),
    text: text(
      $,
      `dialog#token-${id} [data-testid="token-drawer-refusal"] .gpa-alert-body > div`
    )
  })

  test.each([
    [
      'rotate',
      'revoked',
      { status: 'REVOKED' as const },
      rotateAccessTokenUseCase,
      { keepOld: '24h' },
      'Not rotated.',
      'This token is no longer active. Nothing has changed.'
    ],
    [
      'rotate',
      'expired',
      { status: 'EXPIRED' as const },
      rotateAccessTokenUseCase,
      { keepOld: '24h' },
      'Not rotated.',
      'This token is no longer active. Nothing has changed.'
    ],
    [
      'revoke',
      'revoked',
      { status: 'REVOKED' as const },
      revokeAccessTokenUseCase,
      { confirmText: 'grants-ui' },
      'Not revoked.',
      'This token is no longer active. Nothing has changed.'
    ],
    [
      'revoke',
      'now the token in use',
      { inUse: true },
      revokeAccessTokenUseCase,
      { confirmText: 'grants-ui' },
      'Not revoked.',
      'Dev Ops is calling GAS with this token. Rotate it instead. Nothing has changed.'
    ],
    [
      'delete',
      'revived',
      { status: 'ACTIVE' as const },
      deleteAccessTokenUseCase,
      {},
      'Not deleted.',
      'Only a revoked or expired token can be deleted. Nothing has changed.'
    ]
  ] as const)(
    '%s on a token %s meanwhile: the refusal at the top of its drawer',
    async (action, _state, fields, useCase, payload, title, body) => {
      const errorCode = codeFor(body)
      vi.mocked(useCase).mockResolvedValue({
        outcome: 'refused',
        statusCode: 409,
        errorCode
      })
      withToken(fields)

      const { statusCode, $ } = await post(
        `${tokenPath(ids.active)}/${action}`,
        payload
      )

      expect(statusCode).toBe(400)
      expect(isOpenWithoutScript($, `token-${ids.active}`)).toBe(true)
      expect($(`dialog#token-${ids.active}-${action}[open]`)).toHaveLength(0)
      expect(drawerRefusal($, ids.active)).toEqual({ title, text: body })
      expect(
        $(`dialog#token-${ids.active} [data-testid="token-drawer-refusal"]`).is(
          '[data-focus-on-arrival]'
        )
      ).toBe(true)
      expect(toastOf($).text).toBe('')
    }
  )

  test('a refusal whose dialog is still drawn stays in the dialog, not the drawer', async () => {
    vi.mocked(rotateAccessTokenUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_DUPLICATE'
    })

    const { $ } = await post(`${tokenPath(ids.active)}/rotate`, {
      keepOld: '24h'
    })

    expect(
      $(`dialog#token-${ids.active}-rotate [data-testid="token-refusal"]`)
    ).toHaveLength(1)
    expect($('[data-testid="token-drawer-refusal"]')).toHaveLength(0)
  })

  test('change expiry on a token that changed under it says so in its dialog, which every state has', async () => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValue({
      outcome: 'refused',
      statusCode: 409,
      errorCode: 'API_TOKEN_NOT_ACTIVE'
    })
    withToken({ status: 'REVOKED' })

    const { $ } = await post(`${tokenPath(ids.active)}/expiry`, {
      expiry: '30',
      date: '',
      hint: '3e1d'
    })

    expect(drawerRefusal($, ids.active)).toEqual({
      title: 'Expiry not changed.',
      text: 'The token changed while this was open. Refresh and try again. Nothing has changed.'
    })
  })
})

describe('Change expiry reads the current expiry from GAS, not the form', () => {
  test('a forged current is refused', async () => {
    const { statusCode } = await post(
      `${tokenPath(ids.dated, 'farming-grants-agreements-ui')}/expiry`,
      {
        expiry: 'custom',
        date: '2027-01-31',
        current: '2027-01-31T12:00:00.000Z',
        hint: ''
      }
    )

    expect(statusCode).toBe(400)
    expect(changeTokenExpiryUseCase).not.toHaveBeenCalled()
  })
})

describe('a dialog the address opens', () => {
  const list = '/dev-ops/clients/gas'
  const drawer = (tokenId: string) => `${list}?token=${tokenId}`

  test.each([
    ['the drawer', drawer(ids.dated), `token-${ids.dated}`, list],
    ['New token', `${list}?dialog=new`, 'token-new', list],
    [
      'Rotate',
      `${drawer(ids.dated)}&dialog=rotate`,
      `token-${ids.dated}-rotate`,
      drawer(ids.dated)
    ],
    [
      'Change expiry',
      `${drawer(ids.dated)}&dialog=expiry`,
      `token-${ids.dated}-expiry`,
      drawer(ids.dated)
    ],
    [
      'Revoke',
      `${drawer(ids.active)}&dialog=revoke`,
      `token-${ids.active}-revoke`,
      drawer(ids.active)
    ],
    [
      'Delete',
      `${drawer(ids.revoked)}&dialog=delete`,
      `token-${ids.revoked}-delete`,
      drawer(ids.revoked)
    ]
  ])(
    '%s closes to the page without its opener',
    async (_name, url, id, closed) => {
      const { $ } = await get(url)

      expect(isOpenWithoutScript($, id)).toBe(true)
      expect(closeHrefOf($, id)).toBe(closed)
    }
  )

  test.each([
    ['the drawer', drawer(ids.dated), `token-${ids.dated}`, false],
    ['New token', `${list}?dialog=new`, 'token-new', true],
    [
      'Rotate',
      `${drawer(ids.dated)}&dialog=rotate`,
      `token-${ids.dated}-rotate`,
      true
    ],
    [
      'Change expiry',
      `${drawer(ids.dated)}&dialog=expiry`,
      `token-${ids.dated}-expiry`,
      true
    ],
    [
      'Revoke',
      `${drawer(ids.active)}&dialog=revoke`,
      `token-${ids.active}-revoke`,
      true
    ],
    [
      'Delete',
      `${drawer(ids.revoked)}&dialog=delete`,
      `token-${ids.revoked}-delete`,
      false
    ]
  ])(
    '%s starts clean when opened again from the page only if it holds fields',
    async (_name, url, id, resets) => {
      const { $ } = await get(url)

      expect(resetsOnOpen($, id)).toBe(resets)
    }
  )

  test('a dialog handed back with its errors closes to the list, not the address it posted to', async () => {
    const { $ } = await post(`${list}/tokens`, {
      clientId: 'Grants UI',
      expiry: '90',
      date: ''
    })

    expect(isOpenWithoutScript($, 'token-new')).toBe(true)
    expect(closeHrefOf($, 'token-new')).toBe(list)
  })
})

describe('Token issued', () => {
  test('shows the token once, in the answer to the POST, not dismissible, never stored or cached', async () => {
    vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
      outcome: 'issued',
      raw,
      token: token({ clientId: 'new-caller' })
    })

    const { statusCode, headers, $, payload } = await post(
      '/dev-ops/clients/gas/tokens',
      { clientId: 'new-caller', expiry: 'never', date: '' }
    )
    const dialog = $('dialog#token-issued')

    expect(statusCode).toBe(200)
    expect(headers['cache-control']).toBe('no-store')
    expect(isOpenWithoutScript($, 'token-issued')).toBe(true)
    expect(dialog.parent('gpa-dialog').attr('data-dismissible')).toBe('false')
    expect(dialog.find('.gpa-dialog-close')).toHaveLength(0)
    expect(text($, 'dialog#token-issued .gpa-alert-title')).toBe('Copy it now.')
    expect(text($, 'dialog#token-issued .gpa-alert-body > div')).toBe(
      'This is the only time the token is shown. Only its hash is stored.'
    )
    expect(text($, 'label[for="token-issued-value"]')).toBe(
      'Token for new-caller'
    )
    expect($('#token-issued-value').attr('value')).toBe(raw)
    expect($('#token-issued-value').is('[readonly]')).toBe(true)
    expect(dialog.find('gpa-copy').attr('data-value')).toBe(raw)
    expect(dialog.find('gpa-copy [data-gpa-copy]').is('[hidden]')).toBe(false)
    expect(dialog.find('[data-testid="token-issued-done"]').attr('href')).toBe(
      '/dev-ops/clients/gas'
    )
    expect(payload.split(raw)).toHaveLength(3)
    expect(sessions.join('')).not.toContain(raw)
    expect(sessions.join('')).not.toContain(raw.slice(-4))
  })

  test('after a rotation: the old token’s drawer stays open behind, and Done goes back to it', async () => {
    vi.mocked(rotateAccessTokenUseCase).mockResolvedValue({
      outcome: 'issued',
      raw,
      token: token({ tokenId: 'ffffffffffffffffffffffff' })
    })

    const { $ } = await post(`${tokenPath(ids.active)}/rotate`, {
      keepOld: '24h'
    })

    expect(isOpenWithoutScript($, 'token-issued')).toBe(true)
    expect(isOpenWithoutScript($, `token-${ids.active}`)).toBe(true)
    expect($('[data-testid="token-issued-done"]').attr('href')).toBe(
      `/dev-ops/clients/gas?token=${ids.active}`
    )
    expect(rotateAccessTokenUseCase).toHaveBeenCalledWith(
      { service: 'gas', clientId: 'grants-ui', tokenId: ids.active },
      '24h'
    )
  })

  test('the next page has no token in it', async () => {
    const { payload } = await get('/dev-ops/clients/gas')

    expect(payload).not.toContain(raw)
    expect(payload).not.toContain('token-issued')
  })
})

describe('in production', () => {
  afterEach(() => {
    config.set('environmentLabel', 'local')
  })

  test('every dialog that changes something says so first; Token issued doesn’t', async () => {
    config.set('environmentLabel', 'prod')

    const { $ } = await get(`/dev-ops/clients/gas?token=${ids.active}`)
    const notes = (id: string) =>
      $(`dialog#${id} [data-testid="token-prod-note"]`)

    for (const id of [
      'token-new',
      `token-${ids.active}-rotate`,
      `token-${ids.active}-expiry`,
      `token-${ids.active}-revoke`,
      `token-${ids.revoked}-delete`
    ]) {
      expect(notes(id)).toHaveLength(1)
      expect(flatten(notes(id).find('.gpa-badge').text())).toBe('prod')
      expect(flatten(notes(id).find('.gpa-badge + span').text())).toBe(
        'This changes production.'
      )
      expect(notes(id).find('.gpa-badge').attr('class')).toContain(
        'gpa-badge-danger gpa-badge-outline'
      )
    }
  })

  test('none elsewhere', async () => {
    const { $ } = await get('/dev-ops/clients/gas')

    expect($('[data-testid="token-prod-note"]')).toHaveLength(0)
  })
})

describe('the outcome of a write', () => {
  test.each([
    [
      'issue',
      '/dev-ops/clients/gas/tokens',
      { clientId: 'new-caller', expiry: '90', date: '' },
      issueAccessTokenUseCase,
      'New token status unknown.'
    ],
    [
      'rotate',
      `${tokenPath(ids.active)}/rotate`,
      { keepOld: '24h' },
      rotateAccessTokenUseCase,
      'Rotation status unknown.'
    ],
    [
      'expiry',
      `${tokenPath(ids.active)}/expiry`,
      { expiry: '30', date: '', hint: '3e1d' },
      changeTokenExpiryUseCase,
      'Expiry change status unknown.'
    ],
    [
      'revoke',
      `${tokenPath(ids.active)}/revoke`,
      { confirmText: 'grants-ui', hint: '3e1d' },
      revokeAccessTokenUseCase,
      'Revoke status unknown.'
    ],
    [
      'delete',
      `${tokenPath(ids.revoked, 'old-caller')}/delete`,
      {},
      deleteAccessTokenUseCase,
      'Delete status unknown.'
    ]
  ] as const)(
    'unknown after %s: back to the list with a warning, once',
    async (action, url, payload, useCase, title) => {
      vi.mocked(useCase).mockResolvedValue({ outcome: 'unknown' })

      const { written, page, cookie } = await postAndFollow(url, payload)
      const alert = page.$('[data-testid="tokens-alert"]')

      expect(written.statusCode).toBe(303)
      expect(written.headers.location).toBe('/dev-ops/clients/gas')
      expect(alert.hasClass('gpa-alert-warning')).toBe(true)
      expect(alert.is('[data-focus-on-arrival]')).toBe(true)
      expect(flatten(alert.find('.gpa-alert-title').text())).toBe(title)
      expect(flatten(alert.find('.gpa-alert-body > div').text())).toMatch(
        action === 'issue' || action === 'rotate'
          ? /^GAS didn’t answer in time\. Refresh to see .* before trying again\. If a token was issued, revoke it: its value can’t be shown again\.$/
          : /^GAS didn’t answer in time\. Refresh to see .* before trying again\.$/
      )
      expect(
        (await get('/dev-ops/clients/gas', cookie)).$(
          '[data-testid="tokens-alert"]'
        )
      ).toHaveLength(0)
    }
  )

  test('an error GAS answered a write with: back to the list, naming GAS', async () => {
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue({
      outcome: 'errored'
    })

    const { written, page } = await postAndFollow(
      `${tokenPath(ids.active)}/revoke`,
      { confirmText: 'grants-ui', hint: '3e1d' }
    )
    const alert = page.$('[data-testid="tokens-alert"]')

    expect(written.statusCode).toBe(303)
    expect(alert.hasClass('gpa-alert-warning')).toBe(true)
    expect(flatten(alert.find('.gpa-alert-title').text())).toBe(
      'Revoke status unknown.'
    )
    expect(flatten(alert.find('.gpa-alert-body > div').text())).toBe(
      'GAS answered with an error. Refresh to see whether the token was revoked before trying again.'
    )
  })

  test('a GAS with no token routes refuses a write in its dialog', async () => {
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue({
      outcome: 'not-offered'
    })

    const { statusCode, $ } = await post(`${tokenPath(ids.active)}/revoke`, {
      confirmText: 'grants-ui',
      hint: '3e1d'
    })
    const refusal = `dialog#token-${ids.active}-revoke [data-testid="token-refusal"]`

    expect(statusCode).toBe(400)
    expect(text($, `${refusal} .gpa-alert-title`)).toBe('Not revoked.')
    expect(text($, `${refusal} .gpa-alert-body > div`)).toBe(
      'GAS doesn’t offer access tokens. Nothing has changed.'
    )
  })

  test('a notice isn’t shown on the other service’s page', async () => {
    vi.mocked(deleteAccessTokenUseCase).mockResolvedValue({ outcome: 'done' })

    const written = await post(`${tokenPath(ids.revoked, 'old-caller')}/delete`)

    expect(
      toastOf((await get('/dev-ops/clients/cw', sessionCookie(written))).$).text
    ).toBe('')
  })
})

describe('Times', () => {
  test.each([
    [
      'utc',
      '2027-01-31T23:59:59.000Z',
      '31 Jan 2027',
      '31 Jan 2027 23:59:59 GMT'
    ],
    [
      'uk',
      '2027-01-31T23:59:59.000Z',
      '31 Jan 2027',
      '31 Jan 2027 23:59:59 GMT'
    ],
    [
      'utc',
      '2027-07-31T22:59:59.000Z',
      '31 Jul 2027',
      '31 Jul 2027 23:59:59 BST'
    ],
    [
      'uk',
      '2027-07-31T22:59:59.000Z',
      '31 Jul 2027',
      '31 Jul 2027 23:59:59 BST'
    ],
    [
      'utc',
      '2027-05-30T23:59:59.000Z',
      '31 May 2027',
      '31 May 2027 00:59:59 BST'
    ],
    [
      'uk',
      '2027-05-30T23:59:59.000Z',
      '31 May 2027',
      '31 May 2027 00:59:59 BST'
    ]
  ])(
    'under %s, an expiry of %s is the UK day %s, as the dialog and toasts say it, with the title %s',
    async (choice, expiresAt, day, title) => {
      vi.mocked(listAccessTokensUseCase).mockResolvedValue(
        listed([token({ expiresAt })])
      )

      const { $ } = await get('/dev-ops/clients/gas', `dev-ops-times=${choice}`)
      const time = $('[data-testid="token-row"] time')

      expect(time.text()).toBe(day.replace(' ', '\u00a0'))
      expect(time.attr('title')).toBe(title)
      expect(time.attr('datetime')).toBe(expiresAt.replace('.000', ''))
    }
  )

  test('the list writes an expiry the same under UTC and UK time', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue(
      listed([token({ expiresAt: '2027-05-30T23:59:59.000Z' })])
    )

    const expiryUnder = async (choice: string) => {
      const time = (
        await get('/dev-ops/clients/gas', `dev-ops-times=${choice}`)
      ).$('[data-testid="token-row"] time')

      return { text: time.text(), title: time.attr('title') }
    }

    const utc = await expiryUnder('utc')

    expect(utc).toEqual({
      text: '31\u00a0May 2027',
      title: '31 May 2027 00:59:59 BST'
    })
    expect(await expiryUnder('uk')).toEqual(utc)
  })

  test('the Change expiry dialog starts on the same UK day the list shows', async () => {
    vi.mocked(listAccessTokensUseCase).mockResolvedValue(
      listed([
        token({ tokenId: ids.active, expiresAt: '2027-05-30T23:59:59.000Z' })
      ])
    )

    const { $ } = await get(
      `/dev-ops/clients/gas?token=${ids.active}&dialog=expiry`,
      'dev-ops-times=utc'
    )

    expect($('[data-testid="token-row"] time').text()).toBe('31\u00a0May 2027')
    expect(
      $(`dialog#token-${ids.active}-expiry input[type="date"]`).attr('value')
    ).toBe('2027-05-31')
  })
})

/** Each action end to end as a browser without a script does it: follow the link, send the form as drawn, follow the redirect. */
describe('each action without a script', () => {
  test('issue: New token, the form, Token issued, Done', async () => {
    vi.mocked(issueAccessTokenUseCase).mockResolvedValue({
      outcome: 'issued',
      raw,
      token: token({ clientId: 'new-caller' })
    })

    const list = await get('/dev-ops/clients/gas')
    const opened = await get(
      list.$('[data-testid="token-new-open"]').attr('href') as string
    )
    const form = {
      ...formOf(opened.$, 'token-new-form'),
      clientId: 'new-caller'
    }
    const action = opened.$('form#token-new-form').attr('action') as string
    const issued = await post(action, form)
    const done = await get(
      issued.$('[data-testid="token-issued-done"]').attr('href') as string
    )

    expect(form).toEqual({ clientId: 'new-caller', expiry: '90', date: '' })
    expect(issued.$('#token-issued-value').attr('value')).toBe(raw)
    expect(done.$('dialog[open]')).toHaveLength(0)
    expect(vi.mocked(issueAccessTokenUseCase).mock.calls[0]).toEqual([
      'gas',
      'new-caller',
      {
        expiresAt: expect.stringMatching(/T2[23]:59:59\.000Z$/),
        confirmed: false
      }
    ])
  })

  test('rotate: the drawer, Rotate, the form, Token issued, Done back to the drawer', async () => {
    vi.mocked(rotateAccessTokenUseCase).mockResolvedValue({
      outcome: 'issued',
      raw,
      token: token()
    })

    const drawer = await get(`/dev-ops/clients/gas?token=${ids.inUse}`)
    const opened = await get(
      drawer
        .$(`dialog#token-${ids.inUse} [data-testid="token-rotate"]`)
        .attr('href') as string
    )
    const formId = `token-${ids.inUse}-rotate-form`
    const issued = await post(
      opened.$(`form#${formId}`).attr('action') as string,
      formOf(opened.$, formId)
    )
    const done = await get(
      issued.$('[data-testid="token-issued-done"]').attr('href') as string
    )

    expect(rotateAccessTokenUseCase).toHaveBeenCalledWith(
      {
        service: 'gas',
        clientId: 'fg-grants-platform-admin',
        tokenId: ids.inUse
      },
      '24h'
    )
    expect(isOpenWithoutScript(done.$, `token-${ids.inUse}`)).toBe(true)
  })

  test('change expiry: preset, then the drawer again with a toast, once', async () => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValue({
      outcome: 'done',
      token: token({ expiresAt: '2027-02-04T23:59:59.000Z' })
    })

    const opened = await get(
      `/dev-ops/clients/gas?token=${ids.active}&dialog=expiry`
    )
    const formId = `token-${ids.active}-expiry-form`
    const form = { ...formOf(opened.$, formId), expiry: '30' }
    const { written, page, cookie } = await postAndFollow(
      opened.$(`form#${formId}`).attr('action') as string,
      form
    )

    expect(form).toEqual({ hint: '3e1d', expiry: '30', date: '' })
    expect(written.statusCode).toBe(303)
    expect(written.headers.location).toBe(
      `/dev-ops/clients/gas?token=${ids.active}`
    )
    expect(isOpenWithoutScript(page.$, `token-${ids.active}`)).toBe(true)
    expect(toastOf(page.$)).toEqual({
      tone: 'success',
      text: 'Expiry changed to 4 Feb 2027'
    })
    const again = (await get('/dev-ops/clients/gas', cookie)).$

    expect(toastOf(again).text).toBe('')
    expect(again('.gpa-toast-region')).toHaveLength(0)
  })

  test('change expiry: a custom date left as it is keeps the token’s exact instant', async () => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValue({
      outcome: 'done',
      token: token({ expiresAt: null })
    })

    const opened = await get(
      `/dev-ops/clients/gas?token=${ids.dated}&dialog=expiry`
    )
    const formId = `token-${ids.dated}-expiry-form`
    const { page } = await postAndFollow(
      `${tokenPath(ids.dated, 'farming-grants-agreements-ui')}/expiry`,
      formOf(opened.$, formId)
    )

    expect(changeTokenExpiryUseCase).toHaveBeenCalledWith(
      {
        service: 'gas',
        clientId: 'farming-grants-agreements-ui',
        tokenId: ids.dated
      },
      '2027-01-31T23:59:59.000Z'
    )
    expect(toastOf(page.$).text).toBe('Expiry changed to never')
  })

  test('change expiry: a custom date ends at 23:59:59 UK time, in summer too', async () => {
    vi.mocked(changeTokenExpiryUseCase).mockResolvedValue({
      outcome: 'done',
      token: token()
    })

    await post(`${tokenPath(ids.active)}/expiry`, {
      expiry: 'custom',
      date: '2099-07-04',
      hint: ''
    })

    expect(vi.mocked(changeTokenExpiryUseCase).mock.calls[0][1]).toBe(
      '2099-07-04T22:59:59.000Z'
    )
  })

  test('revoke: typed text, then the drawer again, now revoked, with a toast', async () => {
    vi.mocked(revokeAccessTokenUseCase).mockResolvedValue({ outcome: 'done' })

    const opened = await get(
      `/dev-ops/clients/gas?token=${ids.active}&dialog=revoke`
    )
    const formId = `token-${ids.active}-revoke-form`
    const form = { ...formOf(opened.$, formId), confirmText: 'grants-ui' }
    const { written, page } = await postAndFollow(
      opened.$(`form#${formId}`).attr('action') as string,
      form
    )

    expect(form).toEqual({ hint: '3e1d', confirmText: 'grants-ui' })
    expect(written.headers.location).toBe(
      `/dev-ops/clients/gas?token=${ids.active}`
    )
    expect(revokeAccessTokenUseCase).toHaveBeenCalledWith({
      service: 'gas',
      clientId: 'grants-ui',
      tokenId: ids.active
    })
    expect(toastOf(page.$)).toEqual({
      tone: 'success',
      text: 'Token …3e1d revoked'
    })
  })

  test('delete: then the list, drawer closed, with an info toast', async () => {
    vi.mocked(deleteAccessTokenUseCase).mockResolvedValue({ outcome: 'done' })

    const opened = await get(
      `/dev-ops/clients/gas?token=${ids.revoked}&dialog=delete`
    )
    const formId = `token-${ids.revoked}-delete-form`
    const { written, page } = await postAndFollow(
      opened.$(`form#${formId}`).attr('action') as string,
      formOf(opened.$, formId)
    )

    expect(written.headers.location).toBe('/dev-ops/clients/gas')
    expect(page.$('dialog[open]')).toHaveLength(0)
    expect(toastOf(page.$)).toEqual({
      tone: 'info',
      text: 'Token record deleted'
    })
  })

  test.each([
    ['/dev-ops/clients/gas/tokens', { clientId: 'x', expiry: '90', date: '' }],
    [`${tokenPath(ids.active)}/rotate`, { keepOld: '24h' }],
    [`${tokenPath(ids.active)}/expiry`, { expiry: '30', date: '' }],
    [`${tokenPath(ids.active)}/revoke`, { confirmText: 'grants-ui' }],
    [`${tokenPath(ids.revoked, 'old-caller')}/delete`, {}]
  ])(
    'a cross-site POST to %s is refused, and nothing is written',
    async (url, payload) => {
      const { statusCode } = await post(url, payload, {
        'sec-fetch-site': 'cross-site'
      })

      expect(statusCode).toBe(403)
      for (const useCase of [
        issueAccessTokenUseCase,
        rotateAccessTokenUseCase,
        changeTokenExpiryUseCase,
        revokeAccessTokenUseCase,
        deleteAccessTokenUseCase
      ]) {
        expect(useCase).not.toHaveBeenCalled()
      }
    }
  )
})
