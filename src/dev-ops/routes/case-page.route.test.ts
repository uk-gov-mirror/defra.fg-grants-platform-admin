import { load, type CheerioAPI } from 'cheerio'
import type { Element } from 'domhandler'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type { CasePage } from '../use-cases/get-case-page.use-case.ts'
import { getCasePageUseCase } from '../use-cases/get-case-page.use-case.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import type { PositionNames } from '../use-cases/read-position-names.use-case.ts'
import { readCasePositionNames } from '../use-cases/read-position-names.use-case.ts'
import { catalogue } from '../use-cases/test-fixtures.ts'
import { expectTablesStyled } from '../test-utils.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-case-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-case-page.use-case.ts')
  >('../use-cases/get-case-page.use-case.ts')),
  getCasePageUseCase: vi.fn()
}))
vi.mock(import('../use-cases/read-position-names.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/read-position-names.use-case.ts')
  >('../use-cases/read-position-names.use-case.ts')),
  readCasePositionNames: vi.fn()
}))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-10-13T15:17:31.000Z')

const path = '/dev-ops/cases/woodland/gld-ssp-x9v'
const listed = '/dev-ops/cases?workflow=woodland'

const position = {
  phase: 'PRE_AWARD',
  stage: 'REVIEW',
  status: 'IN_REVIEW'
}

const header: CasePage['header'] = {
  caseRef: 'gld-ssp-x9v',
  workflowCode: 'woodland',
  position,
  closed: false,
  closedAt: null,
  counterpart: { exists: true },
  fetchedAt: now.toISOString()
}

const overview: NonNullable<CasePage['overview']> = {
  workflowCode: 'woodland',
  originalConfigVersion: '1.43.0',
  currentConfigVersion: '1.43.2',
  createdAt: '2026-10-13T14:04:09.000Z',
  closed: false,
  closedAt: null,
  series: {
    latestRef: 'gld-ssp-x9v',
    refs: ['gld-ssp-a1', 'gld-ssp-x9v'],
    members: [
      {
        caseRef: 'gld-ssp-a1',
        position: { phase: null, stage: null, status: 'CLOSED' },
        createdAt: '2026-10-08T10:12:00.000Z',
        closedAt: '2026-10-13T14:04:00.000Z'
      },
      {
        caseRef: 'gld-ssp-x9v',
        position,
        createdAt: '2026-10-13T14:04:09.000Z',
        closedAt: null
      }
    ]
  },
  storedBytes: 4096
}

const names: PositionNames = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre award',
      stages: [
        {
          code: 'REVIEW',
          name: 'Review application',
          statuses: [{ code: 'IN_REVIEW', name: 'In review' }]
        }
      ]
    },
    { code: 'AWARD', name: 'Award', stages: [] },
    { code: 'POST_AWARD', name: 'Post award', stages: [] }
  ]
}

const cwEvent = {
  service: 'caseworking' as const,
  box: 'outbox' as const,
  id: '6716a9c2e4b0a1f2c3d4e5f6',
  eventId: '7c1e0bd2-5f0a-4c4e-9b1d-0000174876e8',
  type: 'CaseStatusUpdated',
  status: 'COMPLETED',
  statusLabel: 'Completed',
  statusRole: 'success' as const,
  statusRetrying: false,
  createdAt: '2026-10-13T14:05:00.000Z',
  latency: null,
  latencyTitle: 'Published'
}

const givenCase = (overrides: Partial<CasePage> = {}) =>
  vi.mocked(getCasePageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header,
      overview,
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

const givenTab = (overrides: Partial<CasePage>) =>
  givenCase({ overview: undefined, ...overrides })

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

  return { $, statusCode }
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const alertOf = ($: CheerioAPI, testId: string) => {
  const alert = part($, testId)

  return {
    title: flatten(alert.find('.gpa-alert-title').text()),
    text: flatten(alert.find('.gpa-alert-title').next().text()),
    buttons: alert
      .find('.gpa-alert-actions a')
      .toArray()
      .map((a) => ({ text: flatten($(a).text()), href: $(a).attr('href') }))
  }
}

const factsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .find('dt')
    .toArray()
    .map((dt) => [flatten($(dt).text()), flatten($(dt).next('dd').text())])

const columnsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .find('thead th')
    .toArray()
    .map((th) => flatten($(th).text()))

const cellText = ($: CheerioAPI, td: Element) => {
  const parts = $(td).find('.gpa-inline').children()

  return parts.length
    ? parts
        .toArray()
        .map((child) => flatten($(child).text()))
        .join(' ')
    : flatten($(td).text())
}

const rowsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .find('tbody tr')
    .toArray()
    .map((tr) =>
      $(tr)
        .find('td[role="cell"]')
        .toArray()
        .map((td) => cellText($, td))
    )

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenCase()
  vi.mocked(getCatalogueUseCase).mockResolvedValue(catalogue)
  vi.mocked(readCasePositionNames).mockResolvedValue(names)
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('the case page, loaded (C1)', () => {
  test("reads the case's Overview, and the names of its workflow version", async () => {
    const { statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(getCasePageUseCase).toHaveBeenCalledWith(
      { workflowCode: 'woodland', caseRef: 'gld-ssp-x9v' },
      'overview'
    )
    expect(readCasePositionNames).toHaveBeenCalledWith({
      code: 'woodland',
      version: '1.43.2'
    })
  })

  test('heads the page with the reference, the status by name and Copy reference', async () => {
    const { $ } = await viewPage()

    expect($('title').text()).toBe('Case gld-ssp-x9v – Grants Platform')
    expect(flatten(part($, 'record-title').text())).toBe('gld-ssp-x9v')
    expect(flatten($('.gpa-pageheader .gpa-status').text())).toBe('In review')
    expect($('.gpa-pageheader gpa-copy').attr('data-value')).toBe('gld-ssp-x9v')
    expect(
      $('nav.gpa-tabs a')
        .toArray()
        .map((a) => flatten($(a).text()))
    ).toEqual(['Overview', 'Events', 'Raw'])
    expect($('nav.gpa-tabs').attr('aria-label')).toBe('Case')
  })

  test('goes back to Cases, and sits under it, when opened from no list', async () => {
    const { $ } = await viewPage()

    expect(part($, 'record-back').attr('href')).toBe('/dev-ops/cases')
    expect(flatten(part($, 'record-back').text())).toBe('Back to Cases')
    expect(
      part($, 'shell-nav').find('[aria-current="page"]').attr('href')
    ).toBe('/dev-ops/cases')
  })

  test('shows where the case is: the phases as steps, then the stage', async () => {
    const { $ } = await viewPage()
    const where = part($, 'record-where')

    expect(flatten(where.find('.gpa-card-head').text())).toBe(
      'Where the case is'
    )
    expect(where.find('.gpa-step')).toHaveLength(3)
    expect(
      flatten(where.find('[aria-current="step"] .gpa-step-label').text())
    ).toBe('Pre award — Current')
    expect(factsOf($, 'record-where')).toEqual([
      ['Stage', 'Review application']
    ])
  })

  test('offers to open the application, which comes back to this case', async () => {
    const { $ } = await viewPage()
    const card = part($, 'record-counterpart')

    expect(flatten(card.find('.gpa-card-head').text())).toBe('Application')
    expect(flatten(card.find('.gpa-card-body .gpa-text-default').text())).toBe(
      'GAS holds the application for this case.'
    )
    expect(flatten(card.find('a.gpa-btn').text())).toBe('Open application')
    expect(card.find('a.gpa-btn').attr('href')).toBe(
      `/dev-ops/applications/woodland/gld-ssp-x9v?back=${encodeURIComponent(path)}`
    )
  })

  test('says the grant version, linked to its workflow version, when it was created and that it is still open', async () => {
    const { $ } = await viewPage()

    expect(factsOf($, 'case-details')).toEqual([
      ['Grant', 'woodland@1.43.2'],
      ['Created', '13 Oct 2026 15:04'],
      ['Closed', 'Still open']
    ])
    expect(part($, 'case-details').find('a').attr('href')).toBe(
      `/dev-ops/workflows/woodland/1.43.2?back=${encodeURIComponent(path)}`
    )
    expect(part($, 'case-details').find('time').attr('title')).toBe(
      '13 Oct 2026 15:04:09 BST'
    )
  })

  test('has no Identifiers card', async () => {
    const { $ } = await viewPage()

    expect(part($, 'application-identifiers')).toHaveLength(0)
    expect($('.gpa-columns-aside .gpa-card')).toHaveLength(1)
  })

  test('shows the series with when each closed', async () => {
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(listed)}`)

    expect(columnsOf($, 'record-series')).toEqual([
      'Reference',
      'Created',
      'Closed'
    ])
    expect(rowsOf($, 'record-series')).toEqual([
      ['gld-ssp-a1 Replaced', '8 Oct 2026 11:12', '13 Oct 2026 15:04'],
      ['gld-ssp-x9v Viewing', '13 Oct 2026 15:04', 'Still open']
    ])
    expect(
      flatten(part($, 'record-series').find('.gpa-section-desc').text())
    ).toBe(
      'Oldest first. Each one replaces the one before it; CW only acts on the newest.'
    )
    expect(part($, 'record-series').find('a').attr('href')).toBe(
      `/dev-ops/cases/woodland/gld-ssp-a1?back=${encodeURIComponent(listed)}`
    )
  })

  test('draws no inline styles and none of the old stylesheet', async () => {
    const { $ } = await viewPage()

    expect($('[style]')).toHaveLength(0)
    expect($('link[rel="stylesheet"]')).toHaveLength(1)
  })
})

describe('the Application card', () => {
  test('says GAS has no application, and searches the applications of its grant (C2)', async () => {
    givenCase({ header: { ...header, counterpart: { exists: false } } })

    const { $ } = await viewPage()
    const card = part($, 'record-counterpart')

    expect(flatten(card.find('.gpa-empty-title').text())).toBe(
      'No application found'
    )
    expect(flatten(card.find('.gpa-empty-body').text())).toBe(
      'GAS has no application with this reference. The case may have been created from a test event.'
    )
    expect(flatten(card.find('a.gpa-btn').text())).toBe('Search applications')
    expect(card.find('a.gpa-btn').attr('href')).toBe(
      '/dev-ops/applications?grant=woodland'
    )
    expect(card.find('[data-icon="file-question-mark"]')).toHaveLength(1)
  })

  test("says GAS didn't say, and still opens the application its ref names (R1)", async () => {
    givenCase({ header: { ...header, counterpart: null } })

    const { $ } = await viewPage()
    const card = part($, 'record-counterpart')

    expect(flatten(card.find('.gpa-card-body .gpa-text-default').text())).toBe(
      'GAS didn’t say whether it holds the application for this case.'
    )
    expect(flatten(card.find('a.gpa-btn').text())).toBe('Open application')
  })
})

describe('a case CW returned no data for (C3)', () => {
  const noData = {
    header: {
      ...header,
      position: { phase: null, stage: null, status: null },
      closed: null
    },
    overview: { ...overview, createdAt: null, closed: null }
  }

  test.each([
    ['empty', noData],
    ['missing', { ...noData, overview: null }]
  ])(
    'says so, with every value not set, when its overview is %s',
    async (_, page) => {
      givenCase(page)

      const { $ } = await viewPage()

      expect(alertOf($, 'record-alert')).toEqual({
        title: 'CW returned no data for this case.',
        text: 'The case exists, but its position and dates are empty. Values below show as not set.',
        buttons: []
      })
      expect($('.gpa-pageheader .gpa-status')).toHaveLength(0)
      expect(part($, 'record-where').find('.gpa-stepper')).toHaveLength(0)
      expect(factsOf($, 'record-where')).toEqual([
        ['Phase', '—'],
        ['Stage', '—'],
        ['Status', '—']
      ])
      expect(part($, 'record-counterpart')).toHaveLength(0)
      expect(part($, 'record-series')).toHaveLength(0)
      expect(factsOf($, 'case-details').slice(1)).toEqual([
        ['Created', '—'],
        ['Closed', '—']
      ])
    }
  )

  test('still says the version when CW sent it', async () => {
    givenCase(noData)

    const { $ } = await viewPage()

    expect(factsOf($, 'case-details')[0]).toEqual(['Grant', 'woodland@1.43.2'])
  })

  test('draws the version as not set when CW sent no overview at all', async () => {
    givenCase({ ...noData, overview: null })

    const { $ } = await viewPage()

    expect(factsOf($, 'case-details')[0]).toEqual(['Grant', '—'])
  })
})

describe('Closed', () => {
  test('says when a closed case closed', async () => {
    givenCase({
      overview: {
        ...overview,
        closed: true,
        closedAt: '2026-10-13T15:00:00.000Z'
      }
    })

    const { $ } = await viewPage()

    expect(factsOf($, 'case-details')[2]).toEqual([
      'Closed',
      '13 Oct 2026 16:00'
    ])
  })

  test("draws the sign for a missing value when CW didn't say", async () => {
    givenCase({ overview: { ...overview, closed: null } })

    const { $ } = await viewPage()

    expect(factsOf($, 'case-details')[2]).toEqual(['Closed', '—'])
  })
})

describe('the series', () => {
  test('says this case was replaced, the replaced alert before anything else (C4)', async () => {
    givenCase({
      overview: {
        ...overview,
        series: {
          latestRef: 'gld-ssp-c4',
          refs: ['gld-ssp-x9v', 'gld-ssp-c4'],
          members: [
            overview.series!.members![1],
            {
              caseRef: 'gld-ssp-c4',
              position,
              createdAt: '2026-10-14T09:00:00.000Z',
              closedAt: null
            }
          ]
        }
      }
    })

    const { $ } = await viewPage()

    expect(alertOf($, 'record-alert')).toEqual({
      title: 'This case was replaced by gld-ssp-c4.',
      text: 'CW only acts on the newest in the series. This one is kept for its history.',
      buttons: [
        { text: 'Open gld-ssp-c4', href: '/dev-ops/cases/woodland/gld-ssp-c4' }
      ]
    })
    expect(part($, 'record-alert')).toHaveLength(1)
  })

  test('draws Closed as not set, not Still open, for a member CW sent nothing for', async () => {
    givenCase({
      overview: {
        ...overview,
        series: {
          ...overview.series!,
          members: [overview.series!.members![1]]
        }
      }
    })

    const { $ } = await viewPage()

    expect(rowsOf($, 'record-series')).toEqual([
      ['gld-ssp-a1 Replaced', '—', '—'],
      ['gld-ssp-x9v Viewing', '13 Oct 2026 15:04', 'Still open']
    ])
  })

  test('lists the references alone when CW sent only those (C5)', async () => {
    givenCase({
      overview: {
        ...overview,
        series: {
          latestRef: 'gld-ssp-x9v',
          refs: ['gld-ssp-a1', 'gld-ssp-x9v']
        }
      }
    })

    const { $ } = await viewPage()

    expect(columnsOf($, 'record-series')).toEqual(['Reference'])
    expect(
      flatten(part($, 'record-series').find('.gpa-section-desc').text())
    ).toBe(
      'Oldest first. CW sent only the references, so their dates aren’t shown. Open one to see it.'
    )
  })

  test('has no series section for a case on its own (C6)', async () => {
    givenCase({
      overview: {
        ...overview,
        series: { latestRef: 'gld-ssp-x9v', refs: ['gld-ssp-x9v'], members: [] }
      }
    })

    const { $ } = await viewPage()

    expect(part($, 'record-series')).toHaveLength(0)
  })
})

describe('the Events tab', () => {
  const eventsPath = `${path}?tab=events`

  test("lists CW's events for the case, each coming back to this tab", async () => {
    givenTab({ events: { rows: [cwEvent], more: false } })

    const { $ } = await viewPage(eventsPath)

    expect(rowsOf($, 'record-events')).toEqual([
      ['CaseStatusUpdated', 'Outbox', 'Completed', '13 Oct 2026 15:05']
    ])
    expect(part($, 'record-events').find('a.gpa-rowlink').attr('href')).toBe(
      `/dev-ops/events/cw/outbox/6716a9c2e4b0a1f2c3d4e5f6?back=${encodeURIComponent(eventsPath)}`
    )
    expect(readCasePositionNames).not.toHaveBeenCalled()
  })

  test('names the queue it could not read, and still shows the rest (C7)', async () => {
    givenTab({
      events: { rows: [{ ...cwEvent, box: 'inbox' }], more: false },
      sourceErrors: [{ hop: 'CW outbox' }]
    })

    const { $ } = await viewPage(eventsPath)

    expect(alertOf($, 'record-events-partial').title).toBe(
      'Some event sources are unavailable: CW outbox.'
    )
    expect(rowsOf($, 'record-events')).toHaveLength(1)
  })

  test("says Caseworking's events couldn't be read, with no table, when CW-BE didn't answer (C8)", async () => {
    givenTab({
      events: { rows: [], more: false },
      sourceErrors: [{ hop: 'CW-BE' }]
    })

    const { $ } = await viewPage(eventsPath)

    expect(alertOf($, 'record-tab-error')).toEqual({
      title: 'Caseworking’s events couldn’t be read.',
      text: 'CW-BE didn’t answer. Refresh to try again.',
      buttons: [{ text: 'Try again', href: eventsPath }]
    })
    expect(part($, 'record-tab-error').hasClass('gpa-alert-danger')).toBe(true)
    expect(part($, 'record-events')).toHaveLength(0)
  })

  test('says no events were found for the case (C9)', async () => {
    givenTab({ events: { rows: [], more: false } })

    const { $ } = await viewPage(eventsPath)
    const empty = part($, 'record-events').find('.gpa-empty')

    expect(flatten(empty.find('.gpa-empty-title').text())).toBe(
      'No events found for this case'
    )
    expect(flatten(empty.find('.gpa-empty-body').text())).toBe(
      'Events past their deletion date aren’t listed.'
    )
  })

  test('says case events could not be read when GAS failed the tab (C10)', async () => {
    givenTab({
      events: null,
      sectionErrors: [{ section: 'events', message: 'GAS timed out' }]
    })

    const { $ } = await viewPage(eventsPath)

    expect(alertOf($, 'record-tab-error')).toEqual({
      title: 'Case events could not be read.',
      text: 'Caseworking returned an unexpected answer. The rest of the page is unaffected.',
      buttons: [{ text: 'Try again', href: eventsPath }]
    })
  })

  test('says it shows only the newest 50 from each CW queue when there are more (R7)', async () => {
    givenTab({ events: { rows: [cwEvent], more: true } })

    const { $ } = await viewPage(eventsPath)

    expect(flatten(part($, 'record-events').find('.gpa-listfoot').text())).toBe(
      'Showing the newest 50 from each CW queue.'
    )
  })
})

describe('the Raw tab', () => {
  const rawPath = `${path}?tab=raw`

  test('shows the stored case', async () => {
    givenTab({ raw: { caseRef: 'gld-ssp-x9v' }, storedBytes: 4096 })

    const { $ } = await viewPage(rawPath)

    expect(part($, 'record-raw').find('gpa-copy').attr('data-value')).toBe(
      JSON.stringify({ caseRef: 'gld-ssp-x9v' }, null, 2)
    )
  })

  test('says the stored case is too large, with its size (C11)', async () => {
    givenTab({
      raw: null,
      storedBytes: 1887437,
      sectionErrors: [{ section: 'raw', message: 'too large to show' }]
    })

    const { $ } = await viewPage(rawPath)

    expect(flatten(part($, 'record-raw').find('.gpa-empty-body').text())).toBe(
      'The stored case is 1.8 MiB, too large for this page.'
    )
  })

  test('says the stored case is too large without a size when GAS sent none (R8)', async () => {
    givenTab({
      raw: null,
      storedBytes: null,
      sectionErrors: [{ section: 'raw', message: 'too large to show' }]
    })

    const { $ } = await viewPage(rawPath)

    expect(flatten(part($, 'record-raw').find('.gpa-empty-body').text())).toBe(
      'The stored case is too large to show on this page.'
    )
  })

  test('says the tab could not be read when GAS failed it (R4)', async () => {
    givenTab({
      raw: null,
      sectionErrors: [{ section: 'raw', message: 'GAS timed out' }]
    })

    const { $ } = await viewPage(rawPath)

    expect(alertOf($, 'record-tab-error').title).toBe(
      'This tab couldn’t be read.'
    )
  })
})

describe('an Overview GAS failed (R5)', () => {
  test('says the tab could not be read, with no no-data alert', async () => {
    givenCase({
      overview: null,
      sectionErrors: [{ section: 'overview', message: 'GAS timed out' }]
    })

    const { $ } = await viewPage()

    expect(alertOf($, 'record-tab-error')).toEqual({
      title: 'This tab couldn’t be read.',
      text: 'Caseworking returned an unexpected answer. The rest of the page is unaffected.',
      buttons: [{ text: 'Try again', href: path }]
    })
    expect(part($, 'record-alert')).toHaveLength(0)
  })
})

describe('a case CW could not show', () => {
  test.each([
    [
      'unavailable (C12)',
      'unavailable',
      statusCodes.serviceUnavailable,
      'This case could not be loaded from CW.',
      'CW answered with an error. Nothing has changed — try again in a moment.'
    ],
    [
      'timed out (C13)',
      'timed-out',
      statusCodes.gatewayTimeout,
      'This case could not be loaded: CW timed out waiting for it.',
      'Nothing has changed. Refresh to try again.'
    ]
  ] as const)(
    'says why when CW is %s',
    async (_, outcome, code, title, text) => {
      vi.mocked(getCasePageUseCase).mockResolvedValue({ outcome, page: null })

      const { $, statusCode } = await viewPage()

      expect(statusCode).toBe(code)
      expect(alertOf($, `record-missing-${outcome}`)).toEqual({
        title,
        text,
        buttons: [
          { text: 'Try again', href: path },
          { text: 'Back to Cases', href: '/dev-ops/cases' }
        ]
      })
    }
  )

  test('says CW has no such case (C14)', async () => {
    vi.mocked(getCasePageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { $, statusCode } = await viewPage()
    const notFound = part($, 'record-missing-not-found')

    expect(statusCode).toBe(statusCodes.notFound)
    expect(flatten(notFound.find('.gpa-empty-title').text())).toBe(
      'CW has no case gld-ssp-x9v.'
    )
    expect(flatten(notFound.find('.gpa-empty-body').text())).toBe(
      'Check the reference — it may belong to a case that was closed and replaced. Search for it from Cases.'
    )
  })
})
