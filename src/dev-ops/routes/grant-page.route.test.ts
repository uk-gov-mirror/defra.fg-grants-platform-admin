import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { GrantVersionPage } from '../use-cases/get-grant-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import { getGrantVersionsUseCase } from '../use-cases/get-grant-versions.use-case.ts'
import {
  configEvent,
  fetchedFile,
  grantVersionHeader as header,
  grantVersionOverview as overview,
  pendingFile
} from '../use-cases/test-fixtures.ts'
import { expectTablesStyled } from '../test-utils.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-grant-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-grant-page.use-case.ts')
  >('../use-cases/get-grant-page.use-case.ts')),
  getGrantPageUseCase: vi.fn()
}))
vi.mock(import('../use-cases/get-grant-versions.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const path = '/dev-ops/grants/woodland-creation/1.2.0'
const listed = '/dev-ops/grants?status=active'

const failed = {
  stored: false,
  fetchStatus: 'permanent_error',
  fetchError: 'Definition file is not valid JSON'
} as const

const givenGrant = (overrides: Partial<GrantVersionPage> = {}) =>
  vi.mocked(getGrantPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header,
      overview,
      events: { rows: [configEvent('gas')], more: false },
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

const withFiles = (files: GrantVersionPage['header']['files']) => ({
  header: { ...header, files }
})

let server: Server

const viewPage = async (url = path) => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    headers: { cookie: 'dev-ops-times=uk' },
    auth: { strategy: 'session', credentials }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return { $, statusCode, headers }
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).text())

/** Each alert under the header: its tone, title and text, and its button. */
const alertsOf = ($: CheerioAPI) =>
  part($, 'version-alert')
    .toArray()
    .map((alert) => {
      const title = $(alert).find('.gpa-alert-title')

      return {
        tone: /gpa-alert-(\w+)/.exec($(alert).attr('class') ?? '')?.[1],
        title: flatten(title.text()),
        text: flatten(title.next().text()),
        action: flatten($(alert).find('.gpa-alert-actions').text())
      }
    })

/** Label and value of each Details row. */
const factsOf = ($: CheerioAPI) =>
  part($, 'version-details')
    .find('dt')
    .toArray()
    .map((dt) => [flatten($(dt).text()), flatten($(dt).next('dd').text())])

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-30T15:17:31.000Z'))

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenGrant()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('the grant version page', () => {
  test('reads the Overview of the version in the URL', async () => {
    const { statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(getGrantPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'overview'
    )
  })

  test('heads the page with the code in mono and the status alone', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'version-title')).toBe('woodland-creation')
    expect(part($, 'version-title').hasClass('gpa-mono')).toBe(true)
    expect(flatten($('.gpa-pageheader-meta').text())).toBe('Active')
    expect(part($, 'version-status').find('.gpa-dot-success')).toHaveLength(1)
  })

  test('shows a draft as such', async () => {
    givenGrant({ header: { ...header, status: 'draft' } })

    const { $ } = await viewPage()

    expect(textOf($, 'version-status')).toBe('Draft')
    expect(part($, 'version-status').find('.gpa-dot-neutral')).toHaveLength(1)
  })

  test('titles the browser tab with the tab and code@version', async () => {
    const { $ } = await viewPage(`${path}?tab=raw`)

    expect($('title').text()).toMatch(/^Raw – woodland-creation@1\.2\.0 – /)
  })

  test('switches version from a menu of links, the current one ticked, keeping the tab and the list', async () => {
    const { $ } = await viewPage(
      `${path}?tab=raw&back=${encodeURIComponent(listed)}`
    )
    const items = part($, 'version-switcher-menu').find('a.gpa-menuitem')

    expect(textOf($, 'version-switcher')).toBe('Version 1.2.0')
    expect(part($, 'version-switcher').attr('aria-label')).toBe(
      'Version 1.2.0, switch version'
    )
    expect(
      items.toArray().map((item) => ({
        text: flatten($(item).text()),
        href: $(item).attr('href'),
        checked: $(item).attr('aria-checked')
      }))
    ).toEqual([
      {
        text: 'Version 2.0.0',
        href: `/dev-ops/grants/woodland-creation/2.0.0?tab=raw&back=${encodeURIComponent(listed)}`,
        checked: 'false'
      },
      {
        text: 'Version 1.2.0',
        href: `${path}?tab=raw&back=${encodeURIComponent(listed)}`,
        checked: 'true'
      }
    ])
    expect($('form select, select')).toHaveLength(0)
  })

  test('offers every tab in order, one address each, with no Events tab', async () => {
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(listed)}`)
    const tabs = $('nav.gpa-tabs a.gpa-tab')

    expect(tabs.toArray().map((tab) => flatten($(tab).text()))).toEqual([
      'Overview',
      'Phases',
      'Questions',
      'Actions',
      'Entitlements',
      'Agreement',
      'Payment',
      'Raw'
    ])
    expect($(tabs[0]).attr('aria-current')).toBe('page')
    expect($(tabs[7]).attr('href')).toBe(
      `${path}?tab=raw&back=${encodeURIComponent(listed)}`
    )
  })

  test('offers no tab for a file the version has not got', async () => {
    givenGrant(withFiles({ grant: fetchedFile }))

    const { $ } = await viewPage()

    expect(
      $('nav.gpa-tabs a.gpa-tab')
        .toArray()
        .map((tab) => flatten($(tab).text()))
    ).toEqual([
      'Overview',
      'Phases',
      'Questions',
      'Actions',
      'Entitlements',
      'Raw'
    ])
  })

  test.each([
    [`${path}?tab=events`, path],
    [
      `${path}?tab=events&back=${encodeURIComponent(listed)}`,
      `${path}?back=${encodeURIComponent(listed)}`
    ]
  ])(
    'sends an old link to the Events tab, %s, to the Overview',
    async (url, location) => {
      const { statusCode, headers } = await viewPage(url)

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe(location)
      expect(getGrantPageUseCase).not.toHaveBeenCalled()
    }
  )

  test("sends an old link to a code's Events tab to its current version's Overview", async () => {
    vi.mocked(getGrantVersionsUseCase).mockResolvedValue({
      outcome: 'found',
      page: { code: 'woodland-creation', current: '1.2.0', versions: [] }
    })

    const first = await viewPage('/dev-ops/grants/woodland-creation?tab=events')

    expect(first.statusCode).toBe(statusCodes.found)
    expect(first.headers.location).toBe('/dev-ops/grants/woodland-creation')
  })

  test('goes back to the grants list, and sits under it in the navigation', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'version-back')).toBe('Back to Grants')
    expect(part($, 'version-back').attr('href')).toBe('/dev-ops/grants')
    expect(
      $('[aria-current="page"].gpa-navitem, .gpa-navitem[aria-current]').text()
    ).toMatch(/Grants/)
  })

  test('goes back to the list it was opened from', async () => {
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(listed)}`)

    expect(part($, 'version-back').attr('href')).toBe(listed)
  })

  test('loads only the design system, never the old stylesheet', async () => {
    const { $ } = await viewPage()

    expect($('link[href*="dev-ops.css"]')).toHaveLength(0)
    expect($('script[src*="views/legacy"]')).toHaveLength(0)
  })

  test('is never stored', async () => {
    const { headers } = await viewPage()

    expect(headers['cache-control']).toBe('no-store')
  })
})

describe('the grant Overview', () => {
  test('lists Received and the event the version arrived as, nothing else', async () => {
    const { $ } = await viewPage()

    expect(factsOf($)).toEqual([
      ['Received', '10 Sep 2026 16:25'],
      ['Event', '5208709c-e2d5-4870-b6ae-ff168bf65726']
    ])
    expect(part($, 'version-details').find('time').attr('title')).toBe(
      '10 Sep 2026 16:25:00 BST'
    )
  })

  test('links the event to its page, which leads back here', async () => {
    const { $ } = await viewPage()

    expect(part($, 'version-event').closest('a').attr('href')).toBe(
      `/dev-ops/events/gas/inbox/6716a9c2e4b0a1f2c3d4e5f6?back=${encodeURIComponent(path)}`
    )
  })

  test('says when the event is past its deletion date', async () => {
    givenGrant({ events: { rows: [], more: false } })

    const { $ } = await viewPage()

    expect(textOf($, 'version-event')).toBe(
      'No longer held: past its deletion date'
    )
    expect(part($, 'version-event').hasClass('gpa-text-subtle')).toBe(true)
  })

  test("says when GAS's inbox could not be read", async () => {
    givenGrant({ events: null })

    const { $ } = await viewPage()

    expect(textOf($, 'version-event')).toBe(
      'Couldn’t be read from GAS’s inbox.'
    )
  })

  test('lists each file with where it is and whether it is stored', async () => {
    givenGrant(
      withFiles({
        grant: header.files.grant,
        agreement: { ...pendingFile, s3Key: null },
        payment: failed
      })
    )

    const { $ } = await viewPage()

    expect(
      part($, 'version-file')
        .toArray()
        .map((row) =>
          $(row)
            .find('td')
            .toArray()
            .map((cell) => flatten($(cell).text()))
        )
    ).toEqual([
      [
        'Grant definition',
        'grants-config-dev/woodland-creation/1.2.0/grant.json',
        'Stored'
      ],
      ['Agreement definition', '—', 'Not stored yet'],
      ['Payment definition', '—', 'Failed']
    ])
    expect(part($, 'version-files').find('.gpa-dot-danger')).toHaveLength(1)
  })
})

describe('the grant alerts', () => {
  test('say nothing while every file is stored and loaded', async () => {
    const { $ } = await viewPage()

    expect(alertsOf($)).toEqual([])
    expect($('form#fetch-definitions')).toHaveLength(0)
  })

  test('name only the agreement and payment definitions while the grant definition is stored', async () => {
    givenGrant(
      withFiles({
        grant: fetchedFile,
        agreement: pendingFile,
        payment: pendingFile
      })
    )

    const { $ } = await viewPage()

    expect(alertsOf($)).toEqual([
      {
        tone: 'info',
        title: 'The agreement and payment definitions aren’t stored yet.',
        text: 'GAS stores them when it first creates an agreement or resolves a payment for this version. Until then the Agreement and Payment tabs wait for them; everything else is shown.',
        action: 'Fetch them now'
      }
    ])
    expect(part($, 'alert-fetch').attr('form')).toBe('fetch-definitions')
  })

  test('offer to fetch the definitions not stored yet, with one form for the page', async () => {
    givenGrant(withFiles({ grant: pendingFile, payment: fetchedFile }))

    const { $ } = await viewPage(
      `${path}?tab=overview&back=${encodeURIComponent(listed)}`
    )
    const form = $('form#fetch-definitions')
    const button = part($, 'alert-fetch')

    expect(alertsOf($)).toEqual([
      {
        tone: 'info',
        title: 'GAS fetches each definition from S3 when it first needs it.',
        text: 'Fetch them now to see the phases, questions and the rest. The Files list below shows which are stored.',
        action: 'Fetch definitions'
      }
    ])
    expect(form.attr('action')).toBe(`${path}/fetch`)
    expect(form.attr('method')).toBe('post')
    expect(form.attr('hidden')).toBeDefined()
    expect(
      form
        .find('input[type="hidden"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toEqual([
      ['tab', 'overview'],
      ['back', listed]
    ])
    expect(button.attr('form')).toBe('fetch-definitions')
    expect(button.attr('type')).toBe('submit')
    expect(button.attr('data-gpa-loading-on-submit')).toBeDefined()
    expect(button.hasClass('gpa-btn-primary')).toBe(true)
  })

  test("name GAS's error after a failed fetch, and offer to try again", async () => {
    givenGrant(
      withFiles({
        grant: {
          stored: false,
          fetchStatus: 'transient_error',
          fetchError: 'S3 timed out'
        }
      })
    )

    const { $ } = await viewPage()

    expect(alertsOf($)).toEqual([
      {
        tone: 'warning',
        title: 'GAS’s last fetch from S3 failed.',
        text: 'S3 timed out. GAS tries again the next time it needs the file; after 5 failed fetches it marks it Failed.',
        action: 'Try again'
      }
    ])
    expect(part($, 'version-alert').find('code').text()).toBe('S3 timed out')
  })

  test('say GAS won’t use a version whose grant file failed, with nothing to press', async () => {
    givenGrant(withFiles({ grant: failed }))

    const { $ } = await viewPage()

    expect(alertsOf($)).toEqual([
      {
        tone: 'danger',
        title: 'GAS won’t use this version.',
        text: 'It couldn’t fetch or read the grant definition: Definition file is not valid JSON. Publish a fixed version.',
        action: ''
      }
    ])
    expect($('form#fetch-definitions')).toHaveLength(0)
  })

  test('keep the Fetch under a failed file while another file can still be fetched', async () => {
    givenGrant(withFiles({ grant: pendingFile, payment: failed }))

    const { $ } = await viewPage()

    expect(alertsOf($).map(({ tone, action }) => [tone, action])).toEqual([
      ['danger', ''],
      ['info', 'Fetch definitions']
    ])
    expect(part($, 'alert-fetch').attr('form')).toBe('fetch-definitions')
  })

  test('say what a failed payment file stops', async () => {
    givenGrant(withFiles({ grant: fetchedFile, payment: failed }))

    const { $ } = await viewPage()

    expect(alertsOf($)).toEqual([
      {
        tone: 'danger',
        title: 'Payment definition failed: Definition file is not valid JSON.',
        text: 'Payments for this version will fail: GAS has no fallback for a payment definition. Publish a fixed version.',
        action: ''
      }
    ])
  })

  test('say when every file is stored but GAS has not loaded them', async () => {
    givenGrant(
      withFiles({
        grant: { stored: true, fetchStatus: 'pending' },
        payment: fetchedFile
      })
    )

    const { $ } = await viewPage()

    expect(alertsOf($)).toEqual([
      {
        tone: 'info',
        title: 'Stored, not loaded by GAS yet.',
        text: 'Every file is stored. GAS loads them the next time it needs this version.',
        action: ''
      }
    ])
  })

  test('say the current version has no admin role, above any file alert, on the Overview', async () => {
    givenGrant({
      ...withFiles({ grant: fetchedFile, payment: pendingFile }),
      overview: { ...overview, adminRole: ' ' }
    })

    const { $ } = await viewPage()

    expect(alertsOf($)).toEqual([
      {
        tone: 'warning',
        title:
          'This grant has no admin role, so GAS refuses administration to everyone.',
        text: 'Administration needs an admin role in the grant definition (admin.role, such as ROLE_WMP_ADMIN). Publish a version that sets one.',
        action: ''
      },
      expect.objectContaining({ tone: 'info' })
    ])
    expect(
      $('.gpa-alert')
        .first()
        .find('code')
        .toArray()
        .map((code) => $(code).text())
    ).toEqual(['admin.role', 'ROLE_WMP_ADMIN'])
  })

  test.each([
    [
      'an older version',
      {
        header: {
          ...header,
          versions: [
            {
              version: '1.3.0',
              status: 'active' as const,
              receivedAt: header.receivedAt
            },
            ...header.versions
          ]
        }
      }
    ],
    ['a grant file not stored', withFiles({ grant: pendingFile })]
  ] satisfies [string, Partial<GrantVersionPage>][])(
    'say nothing of the admin role for %s',
    async (_name, overrides) => {
      givenGrant({ ...overrides, overview: { ...overview, adminRole: null } })

      const { $ } = await viewPage()

      expect(alertsOf($).map(({ title }) => title)).not.toContain(
        'This grant has no admin role, so GAS refuses administration to everyone.'
      )
    }
  )
})

describe('a grant tab with nothing of its own to show', () => {
  test.each([
    [
      'phases',
      'The phases and statuses appear once the grant definition is stored.'
    ],
    ['questions', 'The questions appear once the grant definition is stored.'],
    ['actions', 'The actions appear once the grant definition is stored.'],
    [
      'entitlements',
      'The entitlement templates appear once the grant definition is stored.'
    ],
    ['agreement', 'The agreement definition appears once it is stored.'],
    ['payment', 'The payment definition appears once it is stored.'],
    ['raw', 'The stored grant definition appears here once it is stored.']
  ])(
    'waits on %s for its file, the fetch offered once, in the alert above',
    async (tab, text) => {
      givenGrant(
        withFiles({
          grant: pendingFile,
          agreement: pendingFile,
          payment: pendingFile
        })
      )

      const { $ } = await viewPage(`${path}?tab=${tab}`)
      const waiting = part($, 'tab-waiting')

      expect(flatten(waiting.find('.gpa-empty-title').text())).toBe(
        'Waiting for the definition'
      )
      expect(flatten(waiting.find('.gpa-empty-body').text())).toBe(text)
      expect(part($, 'tab-fetch')).toHaveLength(0)
      expect(part($, 'alert-fetch').attr('form')).toBe('fetch-definitions')
      expect($('button[form="fetch-definitions"]')).toHaveLength(1)
    }
  )

  test('says a failed file’s tab can’t be shown', async () => {
    givenGrant(withFiles({ grant: fetchedFile, payment: failed }))

    const { $ } = await viewPage(`${path}?tab=payment`)

    expect(flatten(part($, 'tab-failed').find('.gpa-alert-title').text())).toBe(
      'The payment definition failed, so this tab can’t be shown.'
    )
  })

  test("says a tab couldn't be read, keeping the rest of the page, with Try again", async () => {
    givenGrant({
      sectionErrors: [{ section: 'definition', message: 'GAS timed out' }]
    })

    const { $ } = await viewPage(`${path}?tab=questions`)
    const error = part($, 'tab-error')

    expect(error.hasClass('gpa-alert-danger')).toBe(true)
    expect(flatten(error.find('.gpa-alert-title').text())).toBe(
      'The grant definition couldn’t be read: GAS timed out.'
    )
    expect(flatten(error.find('.gpa-alert-title').next().text())).toBe(
      'The rest of the page is unaffected — refresh to try again.'
    )
    expect(error.find('.gpa-alert-actions a').attr('href')).toBe(
      `${path}?tab=questions`
    )
  })

  test('says a document over GAS’s cap is too large to show', async () => {
    givenGrant({
      definition: null,
      sectionErrors: [{ section: 'definition', message: 'too large to show' }]
    })

    const { $ } = await viewPage(`${path}?tab=raw`)
    const tooLarge = part($, 'tab-too-large')

    expect(flatten(tooLarge.find('.gpa-empty-title').text())).toBe(
      'Too large to show'
    )
    expect(flatten(tooLarge.find('.gpa-empty-body').text())).toBe(
      'The stored grant definition is larger than 1 MiB, the most this page shows.'
    )
  })
})

describe('the grant Raw tab', () => {
  test('shows the stored grant definition as code', async () => {
    const definition = {
      code: 'woodland-creation',
      version: '1.2.0',
      actions: []
    }
    givenGrant({ definition })

    const { $ } = await viewPage(`${path}?tab=raw`)
    const raw = part($, 'version-raw')

    expect(flatten(raw.find('.gpa-card-head').text())).toBe('grant.json')
    expect(raw.find('pre.gpa-code-pre').attr('aria-label')).toBe('grant.json')
    expect(
      raw
        .find('pre.gpa-code-pre > div')
        .toArray()
        .map((line) => $(line).text())
        .join('\n')
    ).toBe(JSON.stringify(definition, null, 2))
  })
})

describe('a grant version that could not be shown', () => {
  test('is not found, with a search of GAS’s inbox for the code', async () => {
    vi.mocked(getGrantPageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.notFound)
    expect(textOf($, 'record-missing-not-found')).toContain(
      'GAS has no record of woodland-creation@1.2.0.'
    )
    expect(textOf($, 'record-missing-search')).toBe('Search GAS’s inbox')
  })

  test.each([
    [
      'unavailable',
      statusCodes.serviceUnavailable,
      'This grant could not be loaded from GAS.'
    ],
    [
      'timed-out',
      statusCodes.gatewayTimeout,
      'This grant could not be loaded: GAS timed out waiting for it.'
    ]
  ] as const)('says GAS was %s', async (outcome, status, title) => {
    vi.mocked(getGrantPageUseCase).mockResolvedValue({ outcome, page: null })

    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(status)
    expect(
      flatten(
        part($, `record-missing-${outcome}`).find('.gpa-alert-title').text()
      )
    ).toBe(title)
  })
})
