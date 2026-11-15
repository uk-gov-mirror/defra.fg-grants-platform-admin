import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { expectTablesStyled, isOpenWithoutScript } from '../test-utils.ts'
import type { DefinitionFetchResult } from '../use-cases/definition-fetches.ts'
import { fetchWorkflowDefinitionUseCase } from '../use-cases/fetch-workflow-definition.use-case.ts'
import type { WorkflowVersionPage } from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowPageUseCase } from '../use-cases/get-workflow-page.use-case.ts'
import {
  configEvent,
  pendingFile,
  workflowVersionHeader as header,
  workflowVersionOverview as overview
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

const givenWorkflow = (overrides: Partial<WorkflowVersionPage> = {}) =>
  vi.mocked(getWorkflowPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header,
      overview,
      events: { rows: [configEvent('caseworking')], more: false },
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

const withFile = (
  workflow: WorkflowVersionPage['header']['files']['workflow']
) => ({
  header: { ...header, files: { workflow } }
})

let server: Server

const viewPage = async (url = path, cookie?: string) => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    headers: {
      cookie: [cookie, 'dev-ops-times=uk'].filter(Boolean).join('; ')
    },
    auth: { strategy: 'session', credentials }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return { $, statusCode, headers }
}

/** The fetch, then the page it lands on, as a browser does it. */
const fetchAndFollow = async (result: DefinitionFetchResult<'workflow'>) => {
  vi.mocked(fetchWorkflowDefinitionUseCase).mockResolvedValue(result)
  const written = await server.inject({
    method: 'POST',
    url: `${path}/fetch`,
    payload: {},
    auth: { strategy: 'session', credentials },
    headers: { 'sec-fetch-site': 'same-origin' }
  })
  const cookie = (written.headers['set-cookie'] as string[])[0].split(';')[0]

  return viewPage(written.headers.location as string, cookie)
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).text())

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

const factsOf = ($: CheerioAPI) =>
  part($, 'version-details')
    .find('dt')
    .toArray()
    .map((dt) => [flatten($(dt).text()), flatten($(dt).next('dd').text())])

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-30T15:17:31.000Z'))

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

describe('the workflow version page', () => {
  test('heads the page with the code in mono, the status, and the version switcher', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'version-title')).toBe('woodland-creation')
    expect(flatten($('.gpa-pageheader-meta').text())).toBe('Active')
    expect(textOf($, 'version-switcher')).toBe('Version 1.2.0')
    expect(
      part($, 'version-switcher-menu')
        .find('a.gpa-menuitem')
        .toArray()
        .map((item) => [flatten($(item).text()), $(item).attr('aria-checked')])
    ).toEqual([
      ['Version 2.0.0', 'false'],
      ['Version 1.2.0', 'true']
    ])
  })

  test('offers Overview, Phases, Tasks, Pages, Integrations and Raw, with no Events tab', async () => {
    const { $ } = await viewPage()

    expect(
      $('nav.gpa-tabs a.gpa-tab')
        .toArray()
        .map((tab) => flatten($(tab).text()))
    ).toEqual(['Overview', 'Phases', 'Tasks', 'Pages', 'Integrations', 'Raw'])
    expect($('nav.gpa-tabs').attr('aria-label')).toBe('Workflow version')
  })

  test('opens Times from the address, keeping the tab and the list it goes back to', async () => {
    const back = '/dev-ops/workflows?workflow=woodland-creation'
    const page = `${path}?tab=raw&back=${encodeURIComponent(back)}`
    const { $, statusCode } = await viewPage(`${page}&times=open`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect($('#times-dialog .gpa-dialog-close').attr('href')).toBe(page)
    expect(part($, 'version-back').attr('href')).toBe(back)
    expect($('nav.gpa-tabs [aria-current="page"]').text()).toBe('Raw')
  })

  test('sends an old link to the Events tab to the Overview', async () => {
    const { statusCode, headers } = await viewPage(`${path}?tab=events`)

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(path)
  })

  test('goes back to the workflows list, and loads no old stylesheet', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'version-back')).toBe('Back to Workflows')
    expect(part($, 'version-back').attr('href')).toBe('/dev-ops/workflows')
    expect(
      $('link[rel="stylesheet"]')
        .map((_i, link) => $(link).attr('href'))
        .get()
    ).toEqual(['/public/src/dev-ops/views/components/index.css'])
  })
})

const fileRows = ($: CheerioAPI) =>
  part($, 'version-file')
    .toArray()
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    )

describe('the workflow Details', () => {
  test('lists the grant version, who can work cases, Received and the event', async () => {
    const { $ } = await viewPage()

    expect(factsOf($)).toEqual([
      ['Grant', 'woodland-creation@1.2.0'],
      ['Who can work cases', 'All of: ROLE_SFI_REFORM'],
      ['Received', '10 Oct 2026 17:25'],
      ['Event', '5208709c-e2d5-4870-b6ae-ff168bf65726']
    ])
  })

  test('lists the definition in Files, as a grant version lists its own: where it is and whether it is stored', async () => {
    const { $ } = await viewPage()

    expect(fileRows($)).toEqual([
      [
        'Workflow definition',
        'cw-config-dev/woodland-creation/1.2.0/workflow.json',
        'Stored'
      ]
    ])
    expect(
      part($, 'version-files')
        .find('th')
        .toArray()
        .map((th) => flatten($(th).text()))
    ).toEqual(['File', 'Location', 'Stored'])
  })

  test('links the grant version, which leads back here', async () => {
    const { $ } = await viewPage()

    expect(part($, 'workflow-grant').closest('a').attr('href')).toBe(
      `/dev-ops/grants/woodland-creation/1.2.0?back=${encodeURIComponent(path)}`
    )
  })

  test("links the event to CW's inbox", async () => {
    const { $ } = await viewPage()

    expect(part($, 'version-event').closest('a').attr('href')).toMatch(
      /^\/dev-ops\/events\/cw\/inbox\/6716a9c2e4b0a1f2c3d4e5f6\?back=/
    )
  })

  test.each([
    [
      { exists: false },
      'None: GAS has no grant version woodland-creation@1.2.0'
    ],
    [null, 'Couldn’t be checked: GAS didn’t answer.']
  ] as const)(
    'says so when the grant version is %o',
    async (counterpart, text) => {
      givenWorkflow({ header: { ...header, counterpart } })

      const { $ } = await viewPage()

      expect(textOf($, 'workflow-grant')).toBe(text)
      expect(part($, 'workflow-grant').hasClass('gpa-text-subtle')).toBe(true)
    }
  )

  test.each([
    [{ allOf: ['A'], anyOf: ['B', 'C'] }, ['All of: A', 'Any of: B, C']],
    [{ allOf: [], anyOf: ['B'] }, ['Any of: B']],
    [{ allOf: [], anyOf: [] }, ['Any caseworker (no roles set)']]
  ])('says who can work cases from %o', async (requiredRoles, lines) => {
    givenWorkflow({ overview: { ...overview, requiredRoles } })

    const { $ } = await viewPage()

    expect(
      part($, 'workflow-roles')
        .children()
        .toArray()
        .map((line) => flatten($(line).text()))
    ).toEqual(lines)
  })

  test('draws a dash for the roles while the workflow is not stored', async () => {
    givenWorkflow({
      ...withFile(pendingFile),
      overview: { schemeName: null, requiredRoles: null, storedBytes: null }
    })

    const { $ } = await viewPage()

    expect(factsOf($)[1]).toEqual(['Who can work cases', '—'])
    expect(fileRows($)[0][2]).toBe('Not stored yet')
  })

  test('says when the event is past its deletion date', async () => {
    givenWorkflow({ events: { rows: [], more: false } })

    const { $ } = await viewPage()

    expect(textOf($, 'version-event')).toBe(
      'No longer held: past its deletion date'
    )
  })
})

describe('the workflow alerts', () => {
  test.each([
    [
      pendingFile,
      {
        tone: 'info',
        title: 'CW fetches this definition from S3 when it first needs it.',
        text: 'Fetch it now to see its phases, tasks, pages and integrations.',
        action: 'Fetch definition'
      }
    ],
    [
      {
        stored: false,
        fetchStatus: 'transient_error',
        fetchError: 'S3 timed out'
      },
      {
        tone: 'warning',
        title: 'CW’s last fetch from S3 failed.',
        text: 'S3 timed out. CW tries again the next time it needs it.',
        action: 'Try again'
      }
    ],
    [
      {
        stored: false,
        fetchStatus: 'permanent_error',
        fetchError: 'Unexpected token'
      },
      {
        tone: 'danger',
        title: 'CW won’t use this definition.',
        text: 'Unexpected token. Publish a fixed version.',
        action: ''
      }
    ],
    [
      { stored: true, fetchStatus: 'pending' },
      {
        tone: 'info',
        title: 'Stored, not loaded by CW yet.',
        text: 'CW loads it the next time it needs this version.',
        action: ''
      }
    ]
  ] as const)('say what a %o definition needs', async (file, alert) => {
    givenWorkflow(withFile(file))

    const { $ } = await viewPage()

    expect(alertsOf($)).toEqual([alert])
  })

  test('toast the definition stored after a fetch', async () => {
    const { $ } = await fetchAndFollow({
      outcome: 'fetched',
      files: [{ file: 'workflow', outcome: 'stored' }]
    })

    expect(textOf($, 'toast')).toBe(
      'Definition stored for woodland-creation@1.2.0'
    )
    expect(part($, 'toast').hasClass('gpa-toast-success')).toBe(true)
  })

  test('toast a fetch GAS did not answer in time, keeping the definition’s own alert', async () => {
    givenWorkflow(withFile(pendingFile))

    const { $ } = await fetchAndFollow({ outcome: 'timed-out', files: [] })

    expect(textOf($, 'toast')).toBe(
      'GAS didn’t answer in time — refresh to check'
    )
    expect(part($, 'toast').hasClass('gpa-toast-warning')).toBe(true)
    expect(alertsOf($).map(({ tone }) => tone)).toEqual(['info'])
  })

  test('say why the definition could not be fetched, offering it again', async () => {
    givenWorkflow(withFile(pendingFile))

    const { $ } = await fetchAndFollow({
      outcome: 'fetched',
      files: [
        {
          file: 'workflow',
          outcome: 'failed',
          reason: 'unparseable',
          message: null
        }
      ]
    })

    expect(alertsOf($)).toEqual([
      {
        tone: 'danger',
        title:
          'The workflow definition couldn’t be fetched: the file isn’t valid JSON.',
        text: 'Publish a fixed version. Nothing has changed.',
        action: 'Try again'
      }
    ])
  })
})

describe('a workflow tab with nothing of its own to show', () => {
  test.each([
    [
      'phases',
      'The statuses and moves appear once the workflow definition is stored.'
    ],
    ['tasks', 'The task groups appear once the workflow definition is stored.'],
    ['pages', 'The case pages appear once the workflow definition is stored.'],
    [
      'integrations',
      'The external actions appear once the workflow definition is stored.'
    ],
    ['raw', 'The stored workflow definition appears here once it is stored.']
  ])(
    'waits on %s for the definition, the fetch offered once, in the alert above',
    async (tab, text) => {
      givenWorkflow(withFile(pendingFile))

      const { $ } = await viewPage(`${path}?tab=${tab}`)

      expect(
        flatten(part($, 'tab-waiting').find('.gpa-empty-body').text())
      ).toBe(text)
      expect(part($, 'tab-fetch')).toHaveLength(0)
      expect($('button[form="fetch-definitions"]').text()).toContain(
        'Fetch definition'
      )
      expect($('button[form="fetch-definitions"]')).toHaveLength(1)
    }
  )

  test('says the tab can’t be shown after the definition failed', async () => {
    givenWorkflow(withFile({ stored: false, fetchStatus: 'permanent_error' }))

    const { $ } = await viewPage(`${path}?tab=phases`)
    const failed = part($, 'tab-failed')

    expect(flatten(failed.find('.gpa-alert-title').text())).toBe(
      'The workflow definition failed, so this tab can’t be shown.'
    )
    expect(flatten(failed.find('.gpa-alert-title').next().text())).toBe(
      'CW won’t use this definition. Publish a fixed version.'
    )
  })

  test("says the tab couldn't be read", async () => {
    givenWorkflow({
      sectionErrors: [
        {
          section: 'definition',
          message: 'CW timed out reading config_versions'
        }
      ]
    })

    const { $ } = await viewPage(`${path}?tab=tasks`)

    expect(flatten(part($, 'tab-error').find('.gpa-alert-title').text())).toBe(
      'The workflow definition couldn’t be read: CW timed out reading config_versions.'
    )
  })

  test('says Raw is too large to show', async () => {
    givenWorkflow({
      raw: null,
      sectionErrors: [{ section: 'raw', message: 'too large to show' }]
    })

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(
      flatten(part($, 'tab-too-large').find('.gpa-empty-body').text())
    ).toBe('The stored workflow definition is too large to show here.')
  })
})

describe('the workflow Raw tab', () => {
  test('shows the stored workflow as code', async () => {
    const raw = { code: 'woodland-creation', version: '1.2.0', phases: [] }
    givenWorkflow({ raw })

    const { $ } = await viewPage(`${path}?tab=raw`)

    expect(flatten(part($, 'version-raw').find('.gpa-card-head').text())).toBe(
      'workflow.json'
    )
    expect(part($, 'version-raw').find('pre.gpa-code-pre > div')).toHaveLength(
      JSON.stringify(raw, null, 2).split('\n').length
    )
  })
})

describe('a workflow version that could not be shown', () => {
  test('is not found, with a search of CW’s inbox for the code', async () => {
    vi.mocked(getWorkflowPageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.notFound)
    expect(textOf($, 'record-missing-not-found')).toContain(
      'CW has no record of woodland-creation@1.2.0.'
    )
    expect(textOf($, 'record-missing-search')).toBe(
      'Search CW’s inbox for woodland-creation'
    )
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
  ] as const)('says CW was %s', async (outcome, status, title) => {
    vi.mocked(getWorkflowPageUseCase).mockResolvedValue({ outcome, page: null })

    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(status)
    expect(
      flatten(
        part($, `record-missing-${outcome}`).find('.gpa-alert-title').text()
      )
    ).toBe(title)
  })
})
