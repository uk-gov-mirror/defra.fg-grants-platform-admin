import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { DefinitionFetchResult } from '../use-cases/definition-fetches.ts'
import { fetchWorkflowDefinitionUseCase } from '../use-cases/fetch-workflow-definition.use-case.ts'
import type {
  GrantStatusMap,
  WorkflowPage,
  WorkflowVersionPage
} from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowPageUseCase } from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowVersionsUseCase } from '../use-cases/get-workflow-versions.use-case.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import {
  casesBucket,
  catalogue,
  woodlandDefinition,
  woodlandPhases
} from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-workflow-page.use-case.ts'))
vi.mock(import('../use-cases/get-workflow-versions.use-case.ts'))
vi.mock(import('../use-cases/fetch-workflow-definition.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const path = '/dev-ops/workflows/woodland-creation/1.2.0'
const listed = '/dev-ops/workflows?workflow=woodland-creation'

const fetched = { stored: true, fetchStatus: 'fetched' } as const
const pending = { stored: false, fetchStatus: 'pending' } as const

const header: WorkflowVersionPage['header'] = {
  code: 'woodland-creation',
  version: '1.2.0',
  status: 'active',
  receivedAt: '2026-10-10T16:25:00.000Z',
  files: { workflow: fetched },
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
  counterpart: { exists: true }
}

const notStored = {
  ...header,
  status: 'draft',
  files: { workflow: pending }
} as const

const overview: NonNullable<WorkflowVersionPage['overview']> = {
  schemeName: 'Woodland Creation Offer',
  requiredRoles: {
    allOf: ['Casework.Read'],
    anyOf: ['Casework.ReadWrite', 'Casework.Admin']
  },
  storedBytes: 14540
}

const blankOverview = {
  schemeName: null,
  requiredRoles: null,
  storedBytes: null
}

const document = {
  _id: '6710c4a2e1b3f40012ab34cd',
  code: 'woodland-creation',
  schemeName: 'Woodland Creation Offer',
  version: '1.2.0',
  phases: [{ code: 'PRE_AWARD', stages: [] }],
  requiredRoles: overview.requiredRoles,
  endpoints: [
    {
      code: 'land-parcels',
      service: 'LAND_DATA',
      path: '/parcels/{sbi}',
      method: 'GET'
    }
  ]
}

/** Whatever version the URL names, with the same files and facts. */
const givenWorkflow = (overrides: Partial<WorkflowPage> = {}) =>
  vi
    .mocked(getWorkflowPageUseCase)
    .mockImplementation(async ({ code, version }) => ({
      outcome: 'found',
      page: {
        header: { ...header, code, version },
        overview,
        sourceErrors: [],
        sectionErrors: [],
        ...overrides
      }
    }))

const givenRaw = (overrides: Partial<WorkflowVersionPage> = {}) =>
  givenWorkflow({
    overview: undefined,
    raw: document,
    storedBytes: 14540,
    ...overrides
  })

const givenDefinition = (overrides: Partial<WorkflowPage> = {}) =>
  givenWorkflow({
    overview: undefined,
    definition: woodlandDefinition,
    ...overrides
  })

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).text())

let server: Server

const viewPage = async (url = path, cookie?: string) => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    // UK time, the setting these expectations are written in.
    headers: {
      cookie: [cookie, 'dev-ops-times=uk'].filter(Boolean).join('; ')
    },
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode, headers }
}

const post = async (payload: object | undefined = {}, url = `${path}/fetch`) =>
  server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials }
  })

const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  (response.headers['set-cookie'] as string[])[0].split(';')[0]

const noticesOf = ($: CheerioAPI) =>
  part($, 'workflow-notice')
    .toArray()
    .map((notice) => ({
      role: $(notice).attr('role'),
      className: $(notice).attr('class'),
      text: flatten($(notice).text()),
      mono: $(notice).find('.font-mono').text(),
      icon: $(notice).find('[data-testid^="do-icon-"]').attr('data-testid')
    }))

/** The write, then the page it redirects to, exactly as a browser does it. */
const fetchAndFollow = async (payload: object = {}) => {
  const written = await post(payload)
  const cookie = sessionCookie(written)
  const { $ } = await viewPage(written.headers.location as string, cookie)

  return { cookie, $ }
}

const givenOutcome = (result: DefinitionFetchResult<'workflow'>) =>
  vi.mocked(fetchWorkflowDefinitionUseCase).mockResolvedValue(result)

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-21T12:00:00.000Z'))

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenWorkflow()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('the workflow page', () => {
  test('reads the Overview tab of the workflow version in the URL', async () => {
    const { statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkflowPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'overview'
    )
  })

  test('opens a workflow whose code has capitals, as CW spells it', async () => {
    const { statusCode, $ } = await viewPage(
      '/dev-ops/workflows/Casework-Smoke/1.0.0'
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'workflow-title')).toBe('Workflow Casework-Smoke')
  })

  test('heads the page with Workflow and the code in mono', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'workflow-title')).toBe('Workflow woodland-creation')
    expect(part($, 'workflow-ref').attr('class')).toContain('font-mono')
    expect($('title').text()).toContain('Workflow woodland-creation')
  })

  test.each([
    { tab: 'Overview', query: '' },
    { tab: 'Tasks', query: '?tab=tasks' }
  ])(
    'titles the document with the open tab, $tab, and the version',
    async ({ tab, query }) => {
      const { $ } = await viewPage(`${path}${query}`)

      expect($('title').text()).toBe(
        `${tab} – Workflow woodland-creation 1.2.0 – Grants Platform`
      )
    }
  )

  test('titles a version CW has not got as not found, with its version', async () => {
    vi.mocked(getWorkflowPageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { $ } = await viewPage('/dev-ops/workflows/woodland-creation/9.9.9')

    expect($('title').text()).toBe(
      'Not found – Workflow woodland-creation@9.9.9 – Grants Platform'
    )
  })

  test('shows the status, then the version switcher, under the title', async () => {
    const { $ } = await viewPage()
    const line = part($, 'workflow-version')

    expect(line.find('[data-testid="do-status-label"]').first().text()).toBe(
      'Active'
    )
    expect(flatten(part($, 'workflow-switcher-button').text())).toBe(
      'Version: 1.2.0'
    )
    expect(part($, 'workflow-switcher-button').hasClass('btn-sm')).toBe(true)
  })

  test('lists every version newest first, ticking this one, each opening the same tab and list', async () => {
    const { $ } = await viewPage(
      `${path}?tab=raw&back=${encodeURIComponent(listed)}`
    )
    const chips = part($, 'workflow-switcher-chip').toArray()

    expect(
      chips.map((chip) => [
        $(chip)
          .children('span')
          .toArray()
          .map((piece) => flatten($(piece).text()))
          .join(' | '),
        $(chip).attr('href'),
        $(chip).attr('aria-current')
      ])
    ).toEqual([
      [
        '2.0.0 | Draft | 15 Oct 11:04',
        `/dev-ops/workflows/woodland-creation/2.0.0?tab=raw&back=${encodeURIComponent(listed)}`,
        undefined
      ],
      [
        '1.2.0 | Active | 10 Oct 17:25',
        `${path}?tab=raw&back=${encodeURIComponent(listed)}`,
        'page'
      ]
    ])
  })

  test('offers every tab in order, keeping the list it was opened from', async () => {
    const { $ } = await viewPage(
      `${path}?tab=raw&back=${encodeURIComponent(listed)}`
    )

    expect(
      part($, 'workflow-tab')
        .toArray()
        .map((tab) => `${$(tab).text()} ${$(tab).attr('href')}`)
    ).toEqual([
      `Overview ${path}?back=${encodeURIComponent(listed)}`,
      `Phases ${path}?tab=phases&back=${encodeURIComponent(listed)}`,
      `Tasks ${path}?tab=tasks&back=${encodeURIComponent(listed)}`,
      `Pages ${path}?tab=pages&back=${encodeURIComponent(listed)}`,
      `Integrations ${path}?tab=integrations&back=${encodeURIComponent(listed)}`,
      `Events ${path}?tab=events&back=${encodeURIComponent(listed)}`,
      `Raw ${path}?tab=raw&back=${encodeURIComponent(listed)}`
    ])
    expect(part($, 'workflow-tabs').find('[aria-current="page"]').text()).toBe(
      'Raw'
    )
  })

  test('goes back to the workflows list, and sits under it in the navigation', async () => {
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(listed)}`)

    expect(part($, 'workflow-back').attr('href')).toBe(listed)
    expect(textOf($, 'workflow-back')).toBe('Back to Workflows')
    expect(
      $('[data-testid="shell-nav"] [aria-current="page"]').text().trim()
    ).toBe('Workflows')
  })

  test.each([
    ['a tab it has not got', `${path}?tab=questions`],
    ['a version with no patch', '/dev-ops/workflows/woodland-creation/1.2'],
    [
      'a code CW would never store',
      '/dev-ops/workflows/woodland_creation/1.2.0'
    ],
    [
      'a code longer than GAS allows',
      `/dev-ops/workflows/${'w'.repeat(129)}/1.2.0`
    ]
  ])('refuses %s', async (_name, url) => {
    const { statusCode } = await viewPage(url)

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('opens a code as long as GAS allows', async () => {
    const { statusCode } = await viewPage(
      `/dev-ops/workflows/${'w'.repeat(128)}/1.2.0`
    )

    expect(statusCode).toBe(statusCodes.ok)
  })

  test("answers GPA's own 404 page for a version GAS does not have", async () => {
    vi.mocked(getWorkflowPageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test.each([
    [
      'unavailable',
      statusCodes.serviceUnavailable,
      'This workflow couldn’t be loaded from CW.'
    ],
    [
      'timed-out',
      statusCodes.gatewayTimeout,
      'This workflow couldn’t be loaded: CW timed out waiting for it.'
    ]
  ] as const)(
    'says so, as a case page does, when CW is %s',
    async (outcome, code, message) => {
      vi.mocked(getWorkflowPageUseCase).mockResolvedValue({
        outcome,
        page: null
      })

      const { statusCode, $ } = await viewPage()

      expect(statusCode).toBe(code)
      expect(
        flatten(
          part($, `record-missing-${outcome}`).find('.gpa-alert-title').text()
        )
      ).toBe(message)
      expect(textOf($, 'record-missing-title')).toBe('woodland-creation')
      expect(part($, 'workflow-tabs')).toHaveLength(0)
    }
  )

  test('is never stored', async () => {
    const { headers } = await viewPage()

    expect(headers['cache-control']).toBe('no-store')
  })
})

describe('the workflow not-stored banner', () => {
  test('is absent while the workflow is stored', async () => {
    const { $ } = await viewPage()

    expect(part($, 'workflow-banner')).toHaveLength(0)
  })

  test('says the workflow is not stored, above the tabs, on every tab', async () => {
    givenWorkflow({ header: notStored, overview: blankOverview, raw: null })

    for (const query of ['', '?tab=raw']) {
      const { $ } = await viewPage(`${path}${query}`)
      const banner = part($, 'workflow-banner')

      expect(flatten(part($, 'workflow-banner-line').last().text())).toBe(
        'Workflow definition not stored yet.'
      )
      expect(banner.attr('role')).toBe('status')
      expect(banner.attr('class')).toContain('alert-soft')
      expect(banner.find('[data-testid="do-icon-info"]')).toHaveLength(1)
      expect(part($, 'workflow-banner-region').next().attr('data-testid')).toBe(
        'workflow-tabs'
      )
    }
  })

  test('says what a Failed workflow file stops, with the error CW kept', async () => {
    givenWorkflow({
      header: {
        ...notStored,
        files: {
          workflow: {
            stored: false,
            fetchStatus: 'permanent_error',
            fetchError: 'Unexpected token'
          }
        }
      }
    })

    const { $ } = await viewPage()

    expect(flatten(part($, 'workflow-banner-line').last().text())).toBe(
      "Workflow definition failed: Unexpected token. CW won't roll forward to this version: cases on 1.x use the newest usable 1.x version instead. Publish a fixed version."
    )
    expect(part($, 'workflow-banner').attr('class')).toContain('alert-error')
    expect(
      part($, 'workflow-banner-line').last().find('.font-mono').text()
    ).toBe('Unexpected token')
  })

  test('offers Fetch definition, posting back to the same tab and list', async () => {
    givenWorkflow({ header: notStored, raw: null })

    const { $ } = await viewPage(
      `${path}?tab=raw&back=${encodeURIComponent(listed)}`
    )
    const form = part($, 'workflow-banner').find('form')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(`${path}/fetch`)
    expect(
      form
        .find('input[type="hidden"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toEqual([
      ['back', listed],
      ['tab', 'raw']
    ])
    expect(textOf($, 'workflow-fetch')).toBe('Fetch definition')
    expect(part($, 'workflow-fetch').attr('class')).toBe('btn btn-sm')
  })
})

describe('the workflow Overview tab', () => {
  test('lists the definition facts, then the release facts', async () => {
    const { $ } = await viewPage()

    expect(
      part($, 'workflow-facts')
        .find('dl')
        .toArray()
        .map((column) =>
          $(column)
            .find('dt')
            .toArray()
            .map((label) => $(label).text())
        )
    ).toEqual([
      ['Scheme name', 'Received', 'Who can work cases', 'Definition'],
      ['Grant', 'Cases', 'Versions', 'Definition size']
    ])
    expect(textOf($, 'workflow-scheme-name')).toBe('Woodland Creation Offer')
    expect(part($, 'workflow-received').attr('datetime')).toBe(
      '2026-10-10T16:25:00Z'
    )
    expect(textOf($, 'workflow-versions')).toBe('2')
    expect(textOf($, 'workflow-size')).toBe('14.2 KiB')
  })

  test('says who can work cases, all of and any of, each role in mono', async () => {
    const { $ } = await viewPage()
    const lines = part($, 'workflow-roles-line')

    expect(lines.toArray().map((line) => flatten($(line).text()))).toEqual([
      'all of: Casework.Read',
      'any of: Casework.ReadWrite, Casework.Admin'
    ])
    expect(
      lines
        .eq(1)
        .find('.font-mono')
        .toArray()
        .map((role) => $(role).text())
    ).toEqual(['Casework.ReadWrite', 'Casework.Admin'])
  })

  test('leaves out a role list the workflow leaves empty, and dashes no scheme name', async () => {
    givenWorkflow({
      overview: {
        ...overview,
        schemeName: null,
        requiredRoles: { allOf: [], anyOf: ['Casework.Admin'] }
      }
    })

    const { $ } = await viewPage()

    expect(
      part($, 'workflow-roles-line')
        .toArray()
        .map((line) => flatten($(line).text()))
    ).toEqual(['any of: Casework.Admin'])
    expect(textOf($, 'workflow-scheme-name-none')).toBe('—')
  })

  test('says any caseworker can work cases when the workflow names no role', async () => {
    givenWorkflow({
      overview: { ...overview, requiredRoles: { allOf: [], anyOf: [] } }
    })

    const { $ } = await viewPage()

    expect(textOf($, 'workflow-roles')).toBe('Any caseworker')
  })

  test('links to the grant of the same code and version, in a new tab', async () => {
    const { $ } = await viewPage()
    const link = part($, 'workflow-grant')

    expect(link.attr('href')).toBe('/dev-ops/grants/woodland-creation/1.2.0')
    expect(link.attr('target')).toBe('_blank')
    expect(flatten(link.text())).toBe('View grant (opens in a new tab)')
  })

  test('leaves the Grant fact out when GAS could not say', async () => {
    givenWorkflow({ header: { ...header, counterpart: null } })

    const { $ } = await viewPage()

    expect(part($, 'workflow-fact-grant')).toHaveLength(0)
    expect(part($, 'workflow-fact-cases')).toHaveLength(1)
  })

  test("links to the cases on this version, as the catalogue spells the list's filters", async () => {
    const { $ } = await viewPage('/dev-ops/workflows/Casework-Smoke/1.0.0')

    expect(part($, 'workflow-cases').attr('href')).toBe(
      '/dev-ops/cases?workflow=Casework-Smoke&version=1.0.0'
    )
    expect(textOf($, 'workflow-cases')).toBe('View cases (opens in a new tab)')
  })

  test.each([
    [
      'does not filter cases by version',
      {
        ...catalogue,
        buckets: [
          {
            ...casesBucket,
            facts: casesBucket.facts.filter(
              ({ name }) => name !== 'currentConfigVersion'
            )
          }
        ]
      }
    ],
    ['has no cases list', { ...catalogue, buckets: [] }],
    ['could not be read', null]
  ])('reads a dash for Cases when the catalogue %s', async (_, answer) => {
    vi.mocked(getCatalogueUseCase).mockResolvedValueOnce(answer)

    const { $ } = await viewPage()

    expect(textOf($, 'workflow-cases-none')).toBe('—')
    expect(part($, 'workflow-cases').attr('href')).toBeUndefined()
  })

  test('shows the version facts, and a dash for each definition fact, while the workflow is not stored', async () => {
    givenWorkflow({ header: notStored, overview: blankOverview })

    const { $ } = await viewPage()

    expect(part($, 'workflow-not-stored')).toHaveLength(0)
    expect(
      ['scheme-name', 'roles', 'size'].map((id) =>
        textOf($, `workflow-${id}-none`)
      )
    ).toEqual(['—', '—', '—'])
    expect(flatten(textOf($, 'workflow-definition-line'))).toBe(
      'Workflow · Not stored yet'
    )
    expect(part($, 'workflow-received').attr('datetime')).toBe(
      '2026-10-10T16:25:00Z'
    )
    expect(
      ['grant', 'cases'].map((id) => part($, `workflow-${id}`).attr('href'))
    ).toEqual([
      '/dev-ops/grants/woodland-creation/1.2.0',
      '/dev-ops/cases?workflow=woodland-creation&version=1.2.0'
    ])
  })

  test('says None for a workflow with no grant', async () => {
    givenWorkflow({
      header: {
        ...header,
        code: 'casework-smoke-test',
        version: '0.0.0',
        counterpart: { exists: false }
      }
    })

    const { statusCode, $ } = await viewPage(
      '/dev-ops/workflows/casework-smoke-test/0.0.0'
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'workflow-grant')).toBe('None')
    expect(part($, 'workflow-grant').attr('href')).toBeUndefined()
  })

  test('says the overview could not be read in place of the facts', async () => {
    givenWorkflow({
      overview: null,
      sectionErrors: [
        { section: 'overview', message: 'Overview could not be loaded' }
      ]
    })

    const { $ } = await viewPage()

    expect(textOf($, 'workflow-section-error')).toBe(
      'Overview could not be loaded'
    )
    expect(part($, 'workflow-facts')).toHaveLength(0)
  })
})

describe('the workflow Raw tab', () => {
  test("reads GAS's raw read", async () => {
    givenRaw()

    await viewPage(`${path}?tab=raw`)

    expect(getWorkflowPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'raw'
    )
  })

  test('shows the stored workflow document whole, in the folding viewer', async () => {
    givenRaw()

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(part($, 'workflow-raw').attr('aria-label')).toBe('Workflow document')
    expect(
      part($, 'workflow-raw-line')
        .toArray()
        .map((line) => $(line).find('code').text())
    ).toEqual(JSON.stringify(document, null, 2).split('\n'))
  })

  test('says the workflow definition is not stored, under the banner, and nothing else', async () => {
    givenRaw({ header: notStored, raw: null, storedBytes: null })

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(textOf($, 'workflow-not-stored')).toBe(
      'The stored workflow definition appears here once it is stored.'
    )
    expect(part($, 'workflow-banner')).toHaveLength(1)
    expect(part($, 'workflow-raw')).toHaveLength(0)
    expect(part($, 'workflow-section-error')).toHaveLength(0)
    expect(part($, 'workflow-no-data')).toHaveLength(0)
  })

  test("says a stored document over GAS's cap is too large to show", async () => {
    givenRaw({
      raw: null,
      sectionErrors: [{ section: 'raw', message: 'too large to show' }]
    })

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(textOf($, 'workflow-raw-too-large')).toBe('Too large to show')
    expect(part($, 'workflow-raw')).toHaveLength(0)
    expect(part($, 'workflow-section-error')).toHaveLength(0)
    expect(part($, 'workflow-too-large')).toHaveLength(0)
  })

  test('says the document could not be read on any other failure', async () => {
    givenRaw({
      raw: null,
      sectionErrors: [{ section: 'raw', message: 'Raw could not be loaded' }]
    })

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(textOf($, 'workflow-section-error')).toBe('Raw could not be loaded')
    expect(part($, 'workflow-raw-too-large')).toHaveLength(0)
  })

  test('says CW returned nothing for a stored workflow it sent no document for', async () => {
    givenRaw({ raw: null })

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(textOf($, 'workflow-no-data')).toBe(
      'CW returned no data for this tab'
    )
  })
})

describe('the workflow Tasks tab', () => {
  test('reads the Tasks tab of the workflow version in the URL', async () => {
    givenDefinition()

    await viewPage(`${path}?tab=tasks`)

    expect(getWorkflowPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'tasks'
    )
  })

  test('shows a card per task group, with a row per answer', async () => {
    givenDefinition()

    const { $ } = await viewPage(`${path}?tab=tasks`)

    expect(
      part($, 'workflow-tasks-group-title')
        .toArray()
        .map((title) => flatten($(title).text()))
    ).toEqual(['Application checks CHECKS', 'Approval APPROVAL'])
    expect($('[id="stage-PRE_AWARD:REVIEW"]')).toHaveLength(1)
    expect(part($, 'workflow-tasks-answer')).toHaveLength(8)
    expect(part($, 'workflow-tasks-block')).toHaveLength(4)
    expect(part($, 'workflow-tabs').find('[aria-current="page"]').text()).toBe(
      'Tasks'
    )
  })

  test('says a workflow without task groups has none', async () => {
    givenDefinition({
      definition: {
        workflow: {
          phases: [
            {
              code: 'PRE_AWARD',
              name: 'Pre-award',
              stages: [
                { code: 'REVIEW', name: 'Review', statuses: [], taskGroups: [] }
              ]
            }
          ]
        },
        addresses: []
      }
    })

    const { $ } = await viewPage(`${path}?tab=tasks`)

    expect(textOf($, 'workflow-tasks-empty')).toBe(
      'No task groups in this version.'
    )
  })

  test('says the workflow definition is not stored, under the banner, and nothing else', async () => {
    givenDefinition({ header: notStored, definition: null })

    const { $ } = await viewPage(`${path}?tab=tasks`)

    expect(textOf($, 'workflow-not-stored')).toBe(
      'The task groups appear once the workflow definition is stored.'
    )
    expect(part($, 'workflow-banner')).toHaveLength(1)
    expect(part($, 'workflow-tasks')).toHaveLength(0)
  })

  test('says the definition could not be read, and draws no tasks', async () => {
    givenDefinition({
      definition: null,
      sectionErrors: [
        { section: 'definition', message: 'Definition could not be loaded' }
      ]
    })

    const { $ } = await viewPage(`${path}?tab=tasks`)

    expect(textOf($, 'workflow-section-error')).toBe(
      'Definition could not be loaded'
    )
    expect(part($, 'workflow-tasks')).toHaveLength(0)
  })
})

describe('the workflow Pages tab', () => {
  test('reads the Pages tab of the workflow version in the URL', async () => {
    givenDefinition()

    await viewPage(`${path}?tab=pages`)

    expect(getWorkflowPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'pages'
    )
  })

  test('shows the case banner, then the case tabs', async () => {
    givenDefinition()

    const { $ } = await viewPage(`${path}?tab=pages`)

    expect(
      part($, 'workflow-pages')
        .children()
        .toArray()
        .map((card) => $(card).find('h2').text())
    ).toEqual(['Case banner', 'Case tabs'])
    expect(part($, 'workflow-pages-tab-row')).toHaveLength(6)
  })

  test('links each action to its Integrations card, keeping the list it was opened from', async () => {
    givenDefinition()

    const { $ } = await viewPage(
      `${path}?tab=pages&back=${encodeURIComponent(listed)}`
    )

    expect(
      $('[data-testid="workflow-pages"] a')
        .toArray()
        .map((link) => [$(link).text(), $(link).attr('href')])
    ).toEqual([
      [
        'Recalculate payment',
        `${path}?tab=integrations&back=${encodeURIComponent(listed)}#action-RECALCULATE`
      ],
      [
        'Refresh land parcels',
        `${path}?tab=integrations&back=${encodeURIComponent(listed)}#action-REFRESH_PARCELS`
      ]
    ])
  })

  test('says the workflow definition is not stored, under the banner, and nothing else', async () => {
    givenDefinition({ header: notStored, definition: null })

    const { $ } = await viewPage(`${path}?tab=pages`)

    expect(textOf($, 'workflow-not-stored')).toBe(
      'The case pages appear once the workflow definition is stored.'
    )
    expect(part($, 'workflow-banner')).toHaveLength(1)
    expect(part($, 'workflow-pages')).toHaveLength(0)
    expect(part($, 'workflow-no-data')).toHaveLength(0)
  })

  test("says a stored definition over GAS's cap is too large to show", async () => {
    givenDefinition({
      definition: null,
      sectionErrors: [{ section: 'definition', message: 'too large to show' }]
    })

    const { $ } = await viewPage(`${path}?tab=pages`)

    expect(textOf($, 'workflow-too-large')).toBe('Too large to show')
    expect(part($, 'workflow-pages')).toHaveLength(0)
    expect(part($, 'workflow-section-error')).toHaveLength(0)
  })

  test('says the definition could not be read on any other failure', async () => {
    givenDefinition({
      definition: null,
      sectionErrors: [
        { section: 'definition', message: 'Definition could not be loaded' }
      ]
    })

    const { $ } = await viewPage(`${path}?tab=pages`)

    expect(textOf($, 'workflow-section-error')).toBe(
      'Definition could not be loaded'
    )
    expect(part($, 'workflow-pages')).toHaveLength(0)
  })
})

describe('the workflow Integrations tab', () => {
  test('reads the Integrations tab of the workflow version in the URL', async () => {
    givenDefinition()

    await viewPage(`${path}?tab=integrations`)

    expect(getWorkflowPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'integrations'
    )
  })

  test('shows a card per external action, its triggers linked back to the Pages tab', async () => {
    givenDefinition()

    const { $ } = await viewPage(
      `${path}?tab=integrations&back=${encodeURIComponent(listed)}`
    )

    expect(
      part($, 'workflow-integrations')
        .toArray()
        .map((card) => $(card).attr('id'))
    ).toEqual(['action-RECALCULATE', 'action-REFRESH_PARCELS'])
    expect(
      part($, 'workflow-integrations-trigger')
        .find('a')
        .toArray()
        .map((link) => $(link).attr('href'))
    ).toEqual([
      `${path}?tab=pages&back=${encodeURIComponent(listed)}#banner`,
      `${path}?tab=pages&back=${encodeURIComponent(listed)}#tab-land-parcels`
    ])
    expect(
      $('[data-testid="workflow-tabs"] [aria-current="page"]').text()
    ).toBe('Integrations')
  })

  test('says the workflow definition is not stored, and shows no cards', async () => {
    givenDefinition({ header: notStored, definition: null })

    const { $ } = await viewPage(`${path}?tab=integrations`)

    expect(textOf($, 'workflow-not-stored')).toBe(
      'The external actions appear once the workflow definition is stored.'
    )
    expect(part($, 'workflow-integrations')).toHaveLength(0)
    expect(part($, 'workflow-integrations-empty')).toHaveLength(0)
  })

  test('says the definition could not be read, and shows no cards', async () => {
    givenDefinition({
      definition: null,
      sectionErrors: [
        { section: 'definition', message: 'Definition could not be loaded' }
      ]
    })

    const { $ } = await viewPage(`${path}?tab=integrations`)

    expect(textOf($, 'workflow-section-error')).toBe(
      'Definition could not be loaded'
    )
    expect(part($, 'workflow-integrations')).toHaveLength(0)
  })
})

describe('the workflow Phases tab', () => {
  const phasesPath = `${path}?tab=phases`

  const grantMap: GrantStatusMap = {
    outcome: 'found',
    lifecycle: {
      phases: [
        {
          code: 'PRE_AWARD',
          name: null,
          stages: [
            { code: 'REVIEW', name: null, statuses: [{ code: 'APPROVED' }] }
          ]
        }
      ],
      initialPosition: 'PRE_AWARD:REVIEW:APPROVED',
      amendablePositions: [],
      waysIn: [],
      externalMappings: [
        {
          source: 'CW',
          code: 'PRE_AWARD:REVIEW:APPROVED',
          whileIn: 'PRE_AWARD:REVIEW',
          mappedTo: '::APPROVED',
          to: 'PRE_AWARD:REVIEW:APPROVED'
        }
      ],
      claimApproval: null
    }
  }

  const givenPhases = (overrides: Partial<WorkflowPage> = {}) =>
    givenDefinition({ grantStatusMap: grantMap, ...overrides })

  const selected = ($: CheerioAPI) =>
    part($, 'workflow-phases-node')
      .filter('[aria-current="true"]')
      .attr('data-position')

  test("reads the Phases tab from the workflow's definition read", async () => {
    givenPhases()

    const { statusCode } = await viewPage(phasesPath)

    expect(statusCode).toBe(statusCodes.ok)
    expect(getWorkflowPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland-creation', version: '1.2.0' },
      'phases'
    )
  })

  test('draws a graph per phase, the legend and the panel for the first status', async () => {
    givenPhases()

    const { $ } = await viewPage(phasesPath)

    expect(
      part($, 'workflow-phases-phase')
        .toArray()
        .map((phase) => $(phase).attr('data-phase'))
    ).toEqual(['PRE_AWARD', 'POST_AWARD'])
    expect(part($, 'workflow-phases-graph')).toHaveLength(2)
    expect(
      part($, 'workflow-phases-legend-item')
        .toArray()
        .map((item) => flatten($(item).text()))
    ).toEqual([
      'Action',
      'GAS may send',
      'Finding',
      'startStart',
      'colour = how CW shows the status to caseworkers',
      'Other phase'
    ])
    expect(
      part($, 'workflow-phases-panel-title').find('[data-code]').text()
    ).toBe('AWAITING_REVIEW')
    expect(
      part($, 'workflow-status-panel-flag')
        .toArray()
        .map((flag) => $(flag).contents().first().text())
    ).toEqual(['start', 'tasks read-only'])
  })

  test('sums up the findings above the graphs, each linking to its status', async () => {
    givenPhases()

    const { $ } = await viewPage(phasesPath)

    expect(textOf($, 'workflow-phases-findings')).toBe(
      '3 statuses with findings: dead end AWAITING_ACCEPTANCE · unreachable WITHDRAWN, ACCEPTED'
    )
    expect(part($, 'workflow-phases-finding-link').first().attr('href')).toBe(
      `${path}?tab=phases&status=${encodeURIComponent('POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE')}#panel`
    )
  })

  test.each([
    ['a full position', 'PRE_AWARD:REVIEW:APPROVED'],
    ['a bare CW code', 'APPROVED']
  ])('selects the status by %s', async (_name, status) => {
    givenPhases()

    const { $ } = await viewPage(`${phasesPath}&status=${status}`)

    expect(selected($)).toBe('PRE_AWARD:REVIEW:APPROVED')
    expect(
      part($, 'workflow-phases-panel-title').find('[data-code]').text()
    ).toBe('APPROVED')
  })

  test('selects the first status for a status it cannot place', async () => {
    givenPhases()

    const { $, statusCode } = await viewPage(`${phasesPath}&status=junk`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(selected($)).toBe('PRE_AWARD:REVIEW:AWAITING_REVIEW')
  })

  test('refuses a status longer than any position', async () => {
    const { statusCode } = await viewPage(
      `${phasesPath}&status=${'A'.repeat(513)}`
    )

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('links each status to this tab, keeping the list it was opened from', async () => {
    givenPhases()

    const { $ } = await viewPage(
      `${phasesPath}&back=${encodeURIComponent(listed)}`
    )

    expect(
      part($, 'workflow-phases-node')
        .filter('[data-position="PRE_AWARD:REVIEW:ON_HOLD"]')
        .attr('href')
    ).toBe(
      `${path}?tab=phases&back=${encodeURIComponent(listed)}&status=${encodeURIComponent('PRE_AWARD:REVIEW:ON_HOLD')}#panel`
    )
  })

  test("tells what GAS does, linking the grant's Phases tab, which comes back to the selected status without nesting back", async () => {
    givenPhases()

    const { $ } = await viewPage(
      `${phasesPath}&status=APPROVED&back=${encodeURIComponent(listed)}`
    )
    const self = `${path}?tab=phases&status=${encodeURIComponent('PRE_AWARD:REVIEW:APPROVED')}`

    expect(textOf($, 'workflow-status-panel-tells-gas')).toBe(
      'Tells GAS CW tells GAS. If the application is at GAS stage Review REVIEW in Pre award PRE_AWARD, and in a status that move allows, GAS moves it to Approved (PRE_AWARD:REVIEW:APPROVED). Otherwise GAS ignores it.'
    )
    expect(
      part($, 'workflow-status-panel-tells-gas').find('a').attr('href')
    ).toBe(
      `/dev-ops/grants/woodland-creation/1.2.0?tab=phases&back=${encodeURIComponent(self)}&status=${encodeURIComponent('PRE_AWARD:REVIEW:APPROVED')}`
    )
  })

  test('says the grant could not be read, and shows the rest of the tab', async () => {
    givenPhases({ grantStatusMap: { outcome: 'unavailable' } })

    const { $, statusCode } = await viewPage(`${phasesPath}&status=APPROVED`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'workflow-status-panel-tells-gas')).toBe(
      'Tells GAS Grant could not be read from fg-gas-backend'
    )
    expect(part($, 'workflow-phases-graph')).toHaveLength(2)
  })

  test('links to the grant version while its definition is not stored, coming back here', async () => {
    givenPhases({ grantStatusMap: { outcome: 'not-stored' } })

    const { $ } = await viewPage(`${phasesPath}&status=APPROVED`)

    expect(
      part($, 'workflow-status-panel-not-stored').find('a').attr('href')
    ).toBe(
      `/dev-ops/grants/woodland-creation/1.2.0?back=${encodeURIComponent(`${path}?tab=phases&status=${encodeURIComponent('PRE_AWARD:REVIEW:APPROVED')}`)}`
    )
  })

  test('says the workflow definition is not stored, and draws nothing', async () => {
    givenDefinition({ header: notStored, definition: null })

    const { $ } = await viewPage(phasesPath)

    expect(textOf($, 'workflow-not-stored')).toBe(
      'The statuses and moves appear once the workflow definition is stored.'
    )
    expect(part($, 'workflow-phases-panel')).toHaveLength(0)
  })

  test('names the stage of a finding whose code is in more than one stage', async () => {
    const [pre, ...rest] = woodlandPhases
    const withdrawn = pre.stages
      .flatMap(({ statuses }) => statuses)
      .find(({ code }) => code === 'WITHDRAWN')!

    givenPhases({
      definition: {
        ...woodlandDefinition,
        workflow: {
          ...woodlandDefinition.workflow,
          phases: [
            {
              ...pre,
              stages: [
                ...pre.stages,
                {
                  code: 'LATER',
                  name: 'Later',
                  statuses: [withdrawn],
                  taskGroups: []
                }
              ]
            },
            ...rest
          ]
        }
      }
    })

    const { $ } = await viewPage(phasesPath)

    expect(textOf($, 'workflow-phases-findings')).toBe(
      '4 statuses with findings: dead end AWAITING_ACCEPTANCE · unreachable WITHDRAWN (Review application), WITHDRAWN (Later), ACCEPTED'
    )
  })

  test('warns of a position held twice', async () => {
    const [phase] = woodlandPhases
    const [stage] = phase.stages

    givenPhases({
      definition: {
        ...woodlandDefinition,
        workflow: {
          ...woodlandDefinition.workflow,
          phases: [
            {
              ...phase,
              stages: [
                { ...stage, statuses: [...stage.statuses, stage.statuses[0]] }
              ]
            }
          ]
        }
      }
    })

    const { $, statusCode } = await viewPage(phasesPath)

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'workflow-phases-duplicates')).toContain(
      'PRE_AWARD:REVIEW:AWAITING_REVIEW appears more than once'
    )
  })

  test('says a workflow with no statuses has none', async () => {
    givenPhases({
      definition: {
        ...woodlandDefinition,
        workflow: {
          ...woodlandDefinition.workflow,
          phases: [{ code: 'PRE_AWARD', name: 'Pre-award', stages: [] }]
        }
      }
    })

    const { $ } = await viewPage(phasesPath)

    expect(textOf($, 'workflow-phases-no-statuses')).toBe('No statuses.')
    expect(part($, 'workflow-phases-panel-title')).toHaveLength(0)
  })
})

describe('the bare workflow URL', () => {
  const versions = {
    code: 'woodland-creation',
    current: '1.2.0',
    versions: header.versions
  }

  test('opens the current version on the tab asked for, keeping the list it came from', async () => {
    vi.mocked(getWorkflowVersionsUseCase).mockResolvedValue({
      outcome: 'found',
      page: versions
    })

    const { statusCode, headers } = await viewPage(
      '/dev-ops/workflows/woodland-creation?tab=raw&back=%2Fdev-ops%2Fworkflows'
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(`${path}?tab=raw&back=%2Fdev-ops%2Fworkflows`)
    expect(getWorkflowVersionsUseCase).toHaveBeenCalledWith('woodland-creation')
  })

  test('opens a code with capitals', async () => {
    vi.mocked(getWorkflowVersionsUseCase).mockResolvedValue({
      outcome: 'found',
      page: { ...versions, code: 'Casework-Smoke' }
    })

    const { headers } = await viewPage('/dev-ops/workflows/Casework-Smoke')

    expect(headers.location).toBe('/dev-ops/workflows/Casework-Smoke/1.2.0')
  })

  test.each([
    ['a code GAS has not got', { outcome: 'not-found', page: null }],
    [
      'a code with no active version',
      { outcome: 'found', page: { ...versions, current: null } }
    ]
  ] as const)("answers GPA's own 404 page for %s", async (_name, result) => {
    vi.mocked(getWorkflowVersionsUseCase).mockResolvedValue(result)

    const { statusCode } = await viewPage(
      '/dev-ops/workflows/woodland-creation'
    )

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('says CW is unavailable, naming the code', async () => {
    vi.mocked(getWorkflowVersionsUseCase).mockResolvedValue({
      outcome: 'unavailable',
      page: null
    })

    const { statusCode, $ } = await viewPage(
      '/dev-ops/workflows/woodland-creation'
    )

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(
      flatten(
        part($, 'record-missing-unavailable').find('.gpa-alert-title').text()
      )
    ).toBe('This workflow couldn’t be loaded from CW.')
  })
})

describe('fetchWorkflowDefinitionRoute', () => {
  beforeEach(() => {
    givenOutcome({
      outcome: 'fetched',
      files: [{ file: 'workflow', outcome: 'stored' }]
    })
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: `${path}/fetch`,
      payload: {},
      auth: {
        strategy: 'session',
        credentials: { ...credentials, scope: ['FCP.GrantApplicationsAdmin'] }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(fetchWorkflowDefinitionUseCase).not.toHaveBeenCalled()
  })

  test('fetches the version in the URL, for the signed in operator, capitals and all', async () => {
    await post({}, '/dev-ops/workflows/Casework-Smoke/1.0.0/fetch')

    expect(fetchWorkflowDefinitionUseCase).toHaveBeenCalledWith(
      { code: 'Casework-Smoke', version: '1.0.0' },
      'Ada Lovelace'
    )
  })

  test('goes back to the same tab of the version, and the list it was opened from', async () => {
    const { statusCode, headers } = await post({ back: listed, tab: 'raw' })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(
      `${path}?tab=raw&back=${encodeURIComponent(listed)}`
    )
  })

  test('refuses a tab the workflow page has not got', async () => {
    const { statusCode } = await post({ tab: 'questions' })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(fetchWorkflowDefinitionUseCase).not.toHaveBeenCalled()
  })

  test('says the workflow was stored, once, in a solid success notice with a ticked circle, and drops the banner', async () => {
    const { cookie, $ } = await fetchAndFollow()

    expect(noticesOf($)).toEqual([
      {
        role: 'status',
        className: expect.stringMatching(/^(?!.*alert-soft).*alert-success$/),
        text: 'Stored: workflow definition.',
        mono: '',
        icon: 'do-icon-circle-check'
      }
    ])
    expect(part($, 'workflow-banner')).toHaveLength(0)
    expect(noticesOf((await viewPage(path, cookie)).$)).toEqual([])
  })

  test('shows the stored document on Raw after a fetch, with the success notice once', async () => {
    givenRaw()

    const { cookie, $ } = await fetchAndFollow({ tab: 'raw' })

    expect(part($, 'workflow-raw')).toHaveLength(1)
    expect(noticesOf($).map(({ text }) => text)).toEqual([
      'Stored: workflow definition.'
    ])
    expect(noticesOf((await viewPage(`${path}?tab=raw`, cookie)).$)).toEqual([])
  })

  test('names the reason the workflow failed in mono, and keeps the banner as the retry', async () => {
    givenOutcome({
      outcome: 'fetched',
      files: [
        {
          file: 'workflow',
          outcome: 'failed',
          reason: 'invalid',
          message: 'phases[0].code is required'
        }
      ]
    })
    givenWorkflow({ header: notStored })

    const { cookie, $ } = await fetchAndFollow()

    expect(noticesOf($)).toEqual([
      {
        role: 'alert',
        className: expect.stringContaining('alert-soft alert-error'),
        text: "Couldn't fetch the workflow definition: phases[0].code is required. This version's file will never load; publish a fixed version. Nothing has changed.",
        mono: 'phases[0].code is required',
        icon: 'do-icon-exclamation-circle'
      }
    ])
    expect(textOf($, 'workflow-fetch')).toBe('Fetch definition')
    expect(noticesOf((await viewPage(path, cookie)).$)).toEqual([])
  })

  test('shows what GAS said even when the version still reads not stored', async () => {
    givenWorkflow({ header: notStored })

    const { $ } = await fetchAndFollow()

    expect(noticesOf($).map(({ text }) => text)).toEqual([
      'Stored: workflow definition.'
    ])
    expect(part($, 'workflow-banner')).toHaveLength(1)
  })

  test.each([
    [
      'not-found',
      'Not fetched: CW no longer has this version. Nothing has changed.'
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

    const { $ } = await fetchAndFollow()

    expect(noticesOf($).map(({ text: said }) => said)).toEqual([text])
  })
})
