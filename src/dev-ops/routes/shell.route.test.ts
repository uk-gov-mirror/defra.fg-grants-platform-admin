import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { plugins } from '../../main.ts'
import { createServer } from '../../server/index.ts'
import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import {
  closeHrefOf,
  isOpenWithoutScript,
  resetsOnOpen
} from '../test-utils.ts'
import { listAccessTokensUseCase } from '../use-cases/access-tokens.use-case.ts'
import { queryBucketUseCase } from '../use-cases/query-bucket.use-case.ts'
import { catalogue, outboxBucket } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-application-page.use-case.ts'))
vi.mock(import('../use-cases/access-tokens.use-case.ts'))
vi.mock(import('../use-cases/query-bucket.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const operator = {
  user: { name: 'ada LOVELACE', email: 'ada.lovelace@example.gov.uk' },
  scope: ['FCP.GrantOperationsAdmin']
}

const applicationsAdmin = { ...operator, scope: ['FCP.GrantApplicationsAdmin'] }

const applicationPath = '/dev-ops/applications/frps-private-beta/a7c-2f1-9e4'

const tokensPath = '/dev-ops/clients/gas'

const appOrigin = () => new URL(config.get('auth.appBaseUrl')).origin

let server: Server

interface Visit {
  cookie?: string
  credentials?: object
  headers?: Record<string, string>
}

const withCookie = (headers: Record<string, string>, cookie?: string) =>
  cookie ? { ...headers, cookie } : headers

const visit = async (url: string, visiting: Visit = {}) => {
  const { cookie, credentials = operator, headers = {} } = visiting
  const response = await server.inject({
    method: 'GET',
    url,
    headers: withCookie(headers, cookie),
    auth: { strategy: 'session', credentials }
  })

  return {
    $: load(response.payload),
    statusCode: response.statusCode,
    headers: response.headers
  }
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const stylesheets = ($: CheerioAPI) =>
  $('link[rel="stylesheet"]')
    .toArray()
    .map((link) => $(link).attr('href'))

const accountMenu = ($: CheerioAPI) => part($, 'shell-sidebar-foot')

/** Each item's label, then its meta when it has one. */
const menuItems = ($: CheerioAPI) =>
  accountMenu($)
    .find('.gpa-menuitem')
    .toArray()
    .map((item) =>
      [
        $(item).find('.gpa-menuitem-label').text(),
        $(item).find('.gpa-menuitem-meta').text()
      ]
        .filter(Boolean)
        .join(' ')
    )

const sameOrigin = () => ({
  origin: appOrigin(),
  'sec-fetch-site': 'same-origin'
})

beforeAll(async () => {
  server = await createServer()
  await server.register(plugins)
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(getCatalogueUseCase).mockResolvedValue(catalogue)
  vi.mocked(getApplicationPageUseCase).mockResolvedValue({
    outcome: 'not-found',
    page: null
  })
  vi.mocked(listAccessTokensUseCase).mockResolvedValue({
    outcome: 'done',
    tokens: []
  })
})

afterAll(async () => {
  await server.stop()
})

describe('the shell', () => {
  test('heads the sidebar with the product, its environment and every service’s pages, marking the open one', async () => {
    const { $ } = await visit(tokensPath)

    expect(flatten(part($, 'shell-brand').text())).toBe('Grants Platform')
    expect(
      part($, 'shell-nav')
        .find('[role="group"]')
        .toArray()
        .map((group) => $(group).attr('aria-label'))
    ).toEqual(['Grant Application Service', 'Caseworking'])
    expect(
      part($, 'shell-nav')
        .find('a')
        .toArray()
        .map((link) => [
          flatten($(link).text()),
          $(link).find('svg').attr('data-icon')
        ])
    ).toEqual([
      ['Grant Application Service Outbox', 'radio-tower'],
      ['Applications', 'file-text'],
      ['Grants', 'landmark'],
      ['Grant Application Service Access tokens', 'key-round'],
      ['Cases', 'briefcase'],
      ['Workflows', 'workflow'],
      ['Caseworking Access tokens', 'key-round']
    ])
    expect(
      part($, 'shell-nav').find('[aria-current="page"]').attr('href')
    ).toBe(tokensPath)
  })

  const hiddenNames = ($: CheerioAPI, selector: string) =>
    part($, 'shell-nav')
      .find(`${selector} .gpa-navitem-label`)
      .toArray()
      .map((label) => [
        flatten($(label).find('.gpa-vh').text()),
        flatten($(label).contents().last().text())
      ])

  test('names the service before Access tokens, for screen readers only', async () => {
    const { $ } = await visit(tokensPath)

    expect(hiddenNames($, 'a[href^="/dev-ops/clients/"]')).toEqual([
      ['Grant Application Service', 'Access tokens'],
      ['Caseworking', 'Access tokens']
    ])
    expect(
      part($, 'shell-nav').find('a[href="/dev-ops/applications"] .gpa-vh')
    ).toHaveLength(0)
  })

  test('names the service before each outbox that has no page of its own, so its link reads "Outbox"', async () => {
    vi.mocked(getCatalogueUseCase).mockResolvedValue({
      buckets: [
        outboxBucket,
        {
          ...outboxBucket,
          id: 'cw.outbox',
          path: 'events/cw/outbox',
          label: 'CW outbox',
          service: 'CW'
        }
      ],
      sourceErrors: []
    })

    const { $ } = await visit(tokensPath)

    expect(hiddenNames($, 'a[href^="/dev-ops/events/"]')).toEqual([
      ['Grant Application Service', 'Outbox'],
      ['Caseworking', 'Outbox']
    ])
  })

  test.each([
    ['local', 'gpa-badge-neutral'],
    ['prod', 'gpa-badge-danger']
  ])('badges the %s environment', async (label, tone) => {
    vi.mocked(config.set)(
      'environmentLabel',
      label as Parameters<typeof config.set>[1]
    )

    const { $ } = await visit(tokensPath)
    const badge = part($, 'shell-environment')

    expect(flatten(badge.text())).toBe(label)
    expect(badge.attr('class')).toContain(tone)
    expect(badge.attr('title')).toBe(`This is the ${label} environment`)
  })

  test('keeps only the access tokens in the sidebar when the catalogue is down', async () => {
    vi.mocked(getCatalogueUseCase).mockResolvedValue(null)

    const { $ } = await visit(tokensPath)

    expect(
      part($, 'shell-nav')
        .find('a')
        .toArray()
        .map((link) => $(link).attr('href'))
    ).toEqual(['/dev-ops/clients/gas', '/dev-ops/clients/cw'])
  })

  test('names the user in Title Case, then Times and Dark theme in one group, then Sign out', async () => {
    const { $ } = await visit(tokensPath)

    expect(
      accountMenu($).find('button[aria-haspopup="menu"]').attr('aria-label')
    ).toBe('Account: Ada Lovelace')
    expect(accountMenu($).find('.gpa-menu-who strong').text()).toBe(
      'Ada Lovelace'
    )
    expect(accountMenu($).find('.gpa-menu-who span').text()).toBe(
      'ada.lovelace@example.gov.uk'
    )
    expect(menuItems($)).toEqual(['Times UTC', 'Dark theme', 'Sign out'])
    expect(accountMenu($).find('.gpa-divider')).toHaveLength(2)
    expect(accountMenu($).find('.gpa-menuitem').last().attr('href')).toBe(
      '/auth/logout?next=%2Fdev-ops%2Fsigned-out'
    )
  })

  test('says UK time in the menu once that is the choice', async () => {
    const { $ } = await visit(tokensPath, { cookie: 'dev-ops-times=uk' })

    expect(menuItems($)[0]).toBe('Times UK time')
  })

  test.each([
    ['dark', 'dark', 'true'],
    ['light', 'light', 'false'],
    ['none', undefined, 'false']
  ])(
    'draws the %s theme the cookie keeps, ticked in the menu if dark',
    async (theme, attribute, checked) => {
      const { $ } = await visit(tokensPath, {
        cookie: `dev-ops-theme=${theme}`
      })

      expect($('html').attr('data-theme')).toBe(attribute)
      expect(accountMenu($).find('gpa-theme-toggle').attr('data-cookie')).toBe(
        'dev-ops-theme'
      )
      expect(
        accountMenu($).find('[role="menuitemcheckbox"]').attr('aria-checked')
      ).toBe(checked)
    }
  )

  test('every Dev Ops page loads the design system’s stylesheet and script, and nothing else', async () => {
    vi.mocked(queryBucketUseCase).mockResolvedValue({
      page: null,
      unavailable: true,
      refused: false,
      refusal: null,
      timedOut: false,
      errored: false
    })
    const pages = [
      tokensPath,
      `${tokensPath}?times=open`,
      '/dev-ops/events',
      '/dev-ops/events/gas/outbox',
      applicationPath,
      '/dev-ops/no-such-page',
      '/dev-ops/signed-out'
    ]

    for (const path of pages) {
      const { $ } = await visit(path)

      expect(stylesheets($)).toEqual([
        '/public/src/dev-ops/views/components/index.css'
      ])
      expect(
        $('script[src]')
          .toArray()
          .map((script) => $(script).attr('src'))
      ).toEqual(['/public/src/dev-ops/views/components/index.ts'])
    }
  })
})

describe('the Times dialog', () => {
  test('is closed until the address asks for it, and its link asks for it over this page', async () => {
    const page = `${applicationPath}?back=${encodeURIComponent('/dev-ops/applications?grant=frps-private-beta')}`
    const { $ } = await visit(page)

    expect(isOpenWithoutScript($, 'times-dialog')).toBe(false)
    expect($('#times-dialog').attr('open')).toBeUndefined()
    expect(part($, 'times-item').attr('href')).toBe(`${page}&times=open`)
    expect(part($, 'times-item').attr('data-gpa-open')).toBe('times-dialog')
    expect(resetsOnOpen($, 'times-dialog')).toBe(true)
  })

  test('is drawn open when the address asks for it, offering UTC first and saving back to this page', async () => {
    const { $ } = await visit(`${tokensPath}?times=open`)
    const dialog = $('#times-dialog')

    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect(flatten(dialog.find('h2').text())).toBe('Times')
    expect(flatten(dialog.find('legend').text())).toBe('Show times in')
    expect(
      dialog
        .find('label.gpa-check')
        .toArray()
        .map((option) => [
          $(option).find('.gpa-check-text > span').first().text(),
          $(option).find('.gpa-check-hint').text()
        ])
    ).toEqual([
      ['UTC', 'The same as the logs, queues and the other services.'],
      ['UK time', 'GMT in winter, BST in summer.']
    ])
    expect(dialog.find('input[value="utc"]').is(':checked')).toBe(true)
    expect($('#times-form').attr('action')).toBe(
      `/dev-ops/times?back=${encodeURIComponent(tokensPath)}`
    )
    expect(dialog.find('.gpa-dialog-close').attr('href')).toBe(tokensPath)
    expect(part($, 'times-done').attr('form')).toBe('times-form')
  })

  test('ticks UK time when that is the choice', async () => {
    const { $ } = await visit(`${tokensPath}?times=open`, {
      cookie: 'dev-ops-times=uk'
    })

    expect($('#times-dialog input[value="uk"]').is(':checked')).toBe(true)
  })
})

describe('Times over a record page', () => {
  const back = '/dev-ops/applications?grant=frps-private-beta'
  const page = `${applicationPath}?back=${encodeURIComponent(back)}`

  test('opens from the address, keeping the page’s own params', async () => {
    const { $, statusCode } = await visit(`${page}&times=open`)

    expect(statusCode).not.toBe(statusCodes.badRequest)
    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect(closeHrefOf($, 'times-dialog')).toBe(page)
  })
})

describe('the Times address', () => {
  test('goes back to the page it names, with the dialog open', async () => {
    const { statusCode, headers } = await visit(
      `/dev-ops/times?back=${encodeURIComponent(`${tokensPath}?status=active`)}`
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(`${tokensPath}?status=active&times=open`)
  })

  test('goes to Dev Ops itself for a page elsewhere', async () => {
    const { headers } = await visit(
      '/dev-ops/times?back=https%3A%2F%2Fexample.com'
    )

    expect(headers.location).toBe('/dev-ops?times=open')
  })
})

describe('saving Times', () => {
  const save = (
    payload: string,
    url = `/dev-ops/times?back=${encodeURIComponent(tokensPath)}`,
    headers: Record<string, string> = sameOrigin()
  ) =>
    server.inject({
      method: 'POST',
      url,
      payload,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...headers
      },
      auth: { strategy: 'session', credentials: operator }
    })

  test.each(['uk', 'utc'])(
    'keeps %s in a cookie and goes back to the page it was chosen on',
    async (choice) => {
      const { statusCode, headers } = await save(`times=${choice}`)

      expect(statusCode).toBe(statusCodes.seeOther)
      expect(headers.location).toBe(tokensPath)
      expect(String(headers['set-cookie'])).toMatch(
        new RegExp(
          `^dev-ops-times=${choice}; Max-Age=31536000;.*HttpOnly; SameSite=Strict; Path=/`
        )
      )
    }
  )

  test('goes back to Dev Ops itself rather than to a page elsewhere', async () => {
    const { headers } = await save(
      'times=uk',
      '/dev-ops/times?back=https%3A%2F%2Fexample.com%2F'
    )

    expect(headers.location).toBe('/dev-ops')
  })

  test('refuses a choice it does not offer', async () => {
    const { statusCode, payload } = await save('times=mars')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(part(load(payload), 'status-bad-request')).toHaveLength(1)
  })

  test('refuses a save another site sent, saying so on its own page', async () => {
    const { statusCode, payload } = await save('times=uk', undefined, {
      origin: 'https://example.com',
      'sec-fetch-site': 'cross-site'
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(
      flatten(part(load(payload), 'status-refused').find('h1').text())
    ).toBe('This request was refused')
  })
})

describe("Dev Ops' status pages", () => {
  test('answers an address it has no page for with its own not found page, in its shell', async () => {
    const { $, statusCode } = await visit('/dev-ops/events', {
      headers: { referer: `${appOrigin()}${tokensPath}` }
    })
    const page = part($, 'status-not-found')

    expect(statusCode).toBe(statusCodes.notFound)
    expect($('title').text()).toBe('Page not found – Grants Platform')
    expect(flatten(page.find('h1').text())).toBe('Page not found')
    expect(flatten(page.find('.gpa-statuspage-body').text())).toBe(
      'Check the address. A link to an event, application or case may have the wrong ID or service in it; search for it from its list instead.'
    )
    expect(flatten(part($, 'status-home').text())).toBe('Go to GAS outbox')
    expect(part($, 'status-home').attr('class')).toContain('gpa-btn-primary')
    expect(part($, 'status-back').attr('href')).toBe(tokensPath)
    expect(part($, 'shell-nav').find('a')).toHaveLength(7)
    expect($('.govuk-header, .govuk-template')).toHaveLength(0)
  })

  test('leaves Back out when the browser came from somewhere else', async () => {
    const { $ } = await visit('/dev-ops/events', {
      headers: { referer: 'https://example.com/dev-ops/clients/gas' }
    })

    expect(part($, 'status-back')).toHaveLength(0)
  })

  test('says a link it cannot read does not work, and changed nothing', async () => {
    const { $, statusCode } = await visit(`${applicationPath}?tab=answers`)
    const page = part($, 'status-bad-request')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(flatten(page.find('.gpa-statuspage-code').text())).toBe('400')
    expect(flatten(page.find('h1').text())).toBe('This link doesn’t work')
    expect(flatten(page.find('.gpa-statuspage-body').text())).toBe(
      'Part of the address isn’t something Dev Ops understands, so it showed nothing. Nothing was changed.'
    )
  })

  test('tells someone without the role what to ask for, with nothing in the sidebar to use', async () => {
    const { $, statusCode } = await visit(tokensPath, {
      credentials: applicationsAdmin
    })
    const page = part($, 'status-no-role')

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(flatten(page.find('h1').text())).toBe(
      'You don’t have access to Dev Ops'
    )
    expect(flatten(page.find('.gpa-statuspage-body').text())).toBe(
      'Dev Ops needs the FCP.GrantOperationsAdmin role. Ask your Entra ID admin to add it, then sign out and sign in again.'
    )
    expect(page.find('code').text()).toBe('FCP.GrantOperationsAdmin')
    expect(part($, 'status-sign-out').attr('href')).toBe(
      '/auth/logout?next=%2Fdev-ops%2Fsigned-out'
    )
    expect(part($, 'shell-nav').find('a')).toHaveLength(0)
    expect(menuItems($)).toEqual(['Dark theme', 'Sign out'])
    expect($('#times-dialog')).toHaveLength(0)
  })

  test('says something went wrong, with the reference the logs carry and a way to try again', async () => {
    vi.mocked(getApplicationPageUseCase).mockRejectedValue(new Error('boom'))

    const { $, statusCode } = await visit(applicationPath, {
      headers: { 'x-cdp-request-id': '4bf92f3577b34da6a3ce929d0e0e4736' }
    })
    const page = part($, 'status-error')

    expect(statusCode).toBe(statusCodes.internalServerError)
    expect(flatten(page.find('h1').text())).toBe('Something went wrong')
    expect(flatten(page.find('.gpa-statuspage-body').text())).toBe(
      'Dev Ops hit an error it didn’t expect. If you were saving a change, check whether it was made before you try again. If it keeps happening, quote the reference below.'
    )
    expect(flatten(page.find('.gpa-statuspage-ref').text())).toBe(
      'Reference: 4bf92f3577b34da6a3ce929d0e0e4736'
    )
    expect(part($, 'status-retry').attr('href')).toBe(applicationPath)
    expect(flatten(part($, 'status-home').text())).toBe('Go to GAS outbox')
  })

  test('asks for no reference when the request carried none', async () => {
    vi.mocked(getApplicationPageUseCase).mockRejectedValue(new Error('boom'))

    const { $ } = await visit(applicationPath)

    expect(part($, 'status-error').find('.gpa-statuspage-ref')).toHaveLength(0)
    expect(
      flatten(part($, 'status-error').find('.gpa-statuspage-body').text())
    ).not.toContain('reference')
  })

  test('says it could not read its lists when the catalogue is down, keeping the access tokens in reach', async () => {
    vi.mocked(getCatalogueUseCase).mockResolvedValue(null)

    const { $, statusCode } = await visit('/dev-ops')
    const page = part($, 'status-catalogue')

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(flatten(page.find('h1').text())).toBe(
      'Dev Ops couldn’t read its lists'
    )
    expect(page.find('.gpa-statuspage-code')).toHaveLength(0)
    expect(part($, 'status-retry').attr('href')).toBe('/dev-ops')
    expect(part($, 'status-tokens').attr('href')).toBe(tokensPath)
    expect(
      part($, 'shell-nav')
        .find('a')
        .toArray()
        .map((link) => $(link).attr('href'))
    ).toEqual(['/dev-ops/clients/gas', '/dev-ops/clients/cw'])
  })
})

describe("Dev Ops' status pages' Content-Security-Policy", () => {
  /** The policy is the same on every page but for its style nonce, which is new on each response. */
  const withoutNonce = (policy: unknown) =>
    String(policy).replace(/'nonce-[0-9a-f]+'/, "'nonce'")

  const policy = async () =>
    withoutNonce(
      (await server.inject({ method: 'GET', url: '/health' })).headers[
        'content-security-policy'
      ]
    )

  /** Any style the page draws carries the nonce its own header allows. */
  const expectPolicy = async (
    $: CheerioAPI,
    headers: Record<string, unknown>
  ) => {
    const header = String(headers['content-security-policy'])
    const nonce = /'nonce-([0-9a-f]+)'/.exec(header)?.[1]

    expect(withoutNonce(header)).toBe(await policy())
    expect(
      $('style')
        .toArray()
        .filter((style) => $(style).attr('nonce') !== nonce)
    ).toHaveLength(0)
  }

  test.each([
    ['400', `${applicationPath}?tab=answers`, statusCodes.badRequest],
    ['404', '/dev-ops/events', statusCodes.notFound],
    ['an unknown address', '/dev-ops/no-such-page', statusCodes.notFound]
  ])(
    'sends the same policy as any page on its %s page',
    async (_name, url, status) => {
      const { $, statusCode, headers } = await visit(url)

      expect(statusCode).toBe(status)
      await expectPolicy($, headers)
    }
  )

  test('sends it on the 403 page', async () => {
    const { $, statusCode, headers } = await visit(tokensPath, {
      credentials: applicationsAdmin
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    await expectPolicy($, headers)
  })

  test('sends it on the 500 page', async () => {
    vi.mocked(getApplicationPageUseCase).mockRejectedValue(new Error('boom'))

    const { $, statusCode, headers } = await visit(applicationPath)

    expect(statusCode).toBe(statusCodes.internalServerError)
    await expectPolicy($, headers)
  })

  test('sends it on the 503 page for lists it couldn’t read', async () => {
    vi.mocked(getCatalogueUseCase).mockResolvedValue(null)

    const { $, statusCode, headers } = await visit('/dev-ops')

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    await expectPolicy($, headers)
  })

  test('sends it on the signed out page', async () => {
    const { statusCode, headers, payload } = await server.inject(
      '/dev-ops/signed-out'
    )

    expect(statusCode).toBe(statusCodes.ok)
    await expectPolicy(load(payload), headers)
  })
})

describe("Dev Ops' signed out page", () => {
  test('stands alone, with the product and its environment, and a way to sign in', async () => {
    const response = await server.inject('/dev-ops/signed-out')
    const $ = load(response.payload)

    expect(response.statusCode).toBe(statusCodes.ok)
    expect(response.headers['clear-site-data']).toBe('"cache"')
    expect($('title').text()).toBe('Signed out – Grants Platform')
    expect($('.gpa-sidebar, .gpa-account')).toHaveLength(0)
    expect(flatten($('.gpa-shell-bare-brand .heading-sm').text())).toBe(
      'Grants Platform'
    )
    expect(flatten($('.gpa-shell-bare-brand .gpa-badge').text())).toBe('local')
    expect($('#times-dialog')).toHaveLength(0)
    expect(stylesheets($)).toEqual([
      '/public/src/dev-ops/views/components/index.css'
    ])
    expect(flatten(part($, 'signed-out').find('h1').text())).toBe(
      'You’re signed out'
    )
    expect(part($, 'signed-out').find('.gpa-statuspage-code')).toHaveLength(0)
    expect(part($, 'signed-out-sign-in').attr('href')).toBe('/auth/login')
  })

  test('is where Dev Ops’ Sign out lands', async () => {
    const { headers } = await server.inject(
      '/auth/logout?next=%2Fdev-ops%2Fsigned-out'
    )

    expect(headers.location).toBe('/dev-ops/signed-out')
  })
})

describe('Grant Ops and the rest of the app', () => {
  test('keep the GOV.UK not found page', async () => {
    const { payload, statusCode } = await server.inject({
      method: 'GET',
      url: '/grant-ops/no-such-page',
      auth: { strategy: 'session', credentials: applicationsAdmin }
    })

    expect(statusCode).toBe(statusCodes.notFound)
    expect(payload).toContain('govuk-template')
    expect(payload).toContain('Page not found | Grants Platform Administration')
    expect(payload).not.toContain('gpa-shell')
  })

  test('keep the GOV.UK refusal for someone with neither role at the front door', async () => {
    const { payload, statusCode } = await server.inject({
      method: 'GET',
      url: '/',
      auth: { strategy: 'session', credentials: { ...operator, scope: [] } }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(payload).toContain(
      'You do not have access to this part of the service'
    )
    expect(payload).not.toContain('gpa-shell')
  })
})
