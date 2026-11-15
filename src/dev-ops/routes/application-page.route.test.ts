import { load, type CheerioAPI } from 'cheerio'
import type { Element } from 'domhandler'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { expectTablesStyled, isOpenWithoutScript } from '../test-utils.ts'
import type { ApplicationPage } from '../use-cases/get-application-page.use-case.ts'
import { getApplicationPageUseCase } from '../use-cases/get-application-page.use-case.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import type { PositionNames } from '../use-cases/read-position-names.use-case.ts'
import { readApplicationPositionNames } from '../use-cases/read-position-names.use-case.ts'
import { catalogue, outboxBucket } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-application-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-application-page.use-case.ts')
  >('../use-cases/get-application-page.use-case.ts')),
  getApplicationPageUseCase: vi.fn()
}))
vi.mock(import('../use-cases/read-position-names.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/read-position-names.use-case.ts')
  >('../use-cases/read-position-names.use-case.ts')),
  readApplicationPositionNames: vi.fn()
}))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-10-13T15:17:31.000Z')

const path = '/dev-ops/applications/woodland/gld-ssp-x9v'
const listed = '/dev-ops/applications?grant=woodland'

const header: ApplicationPage['header'] = {
  clientRef: 'gld-ssp-x9v',
  code: 'woodland',
  position: {
    phase: 'PHASE_PRE_AWARD',
    stage: 'STAGE_REVIEW',
    status: 'STATUS_RECEIVED'
  },
  counterpart: { exists: true },
  fetchedAt: now.toISOString()
}

const overview: NonNullable<ApplicationPage['overview']> = {
  code: 'woodland',
  originalConfigVersion: '1.43.0',
  currentConfigVersion: '1.43.2',
  submittedAt: '2026-10-13T14:04:09.000Z',
  createdAt: '2026-10-13T14:04:09.000Z',
  updatedAt: '2026-10-13T14:04:51.000Z',
  identifiers: { sbi: '107214733', frn: '1101072393', crn: '1103171356' },
  series: {
    latestRef: 'gld-ssp-x9v',
    refs: ['gld-ssp-a1', 'gld-ssp-b7', 'gld-ssp-x9v'],
    members: [
      {
        clientRef: 'gld-ssp-a1',
        position: { phase: null, stage: null, status: 'STATUS_WITHDRAWN' },
        createdAt: '2026-10-08T10:12:00.000Z'
      },
      {
        clientRef: 'gld-ssp-b7',
        position: { phase: null, stage: null, status: 'STATUS_WITHDRAWN' },
        createdAt: '2026-10-10T16:40:00.000Z'
      },
      {
        clientRef: 'gld-ssp-x9v',
        position: header.position,
        createdAt: '2026-10-13T14:04:09.000Z'
      }
    ]
  },
  storedBytes: 2458
}

const names: PositionNames = {
  phases: [
    {
      code: 'PHASE_PRE_AWARD',
      name: 'Pre award',
      stages: [
        {
          code: 'STAGE_REVIEW',
          name: 'Review application',
          statuses: [{ code: 'STATUS_RECEIVED', name: 'Application received' }]
        }
      ]
    },
    { code: 'PHASE_AWARD', name: 'Award', stages: [] },
    { code: 'PHASE_POST_AWARD', name: null, stages: [] }
  ]
}

const outboxEvent = {
  service: 'gas' as const,
  box: 'outbox' as const,
  id: '6716a9c2e4b0a1f2c3d4e5f6',
  eventId: '7c1e0bd2-5f0a-4c4e-9b1d-0000174876e8',
  type: 'CreateCase',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error' as const,
  statusRetrying: false,
  createdAt: '2026-10-13T14:05:00.000Z',
  latency: null,
  latencyTitle: 'Published'
}

const inboxEvent = {
  ...outboxEvent,
  box: 'inbox' as const,
  id: '6716a9c2e4b0a1f2c3d4e5f7',
  type: 'UpdateApplicationStatus',
  status: 'COMPLETED',
  statusLabel: 'Completed',
  statusRole: 'success' as const,
  createdAt: '2026-10-13T14:06:00.000Z'
}

const givenPage = (overrides: Partial<ApplicationPage> = {}) =>
  vi.mocked(getApplicationPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header,
      overview,
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

const givenTab = (overrides: Partial<ApplicationPage>) =>
  givenPage({ overview: undefined, ...overrides })

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

const textOf = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).text())

/** An alert's title, then its text, without its buttons. */
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

/** Each fact of a FactsCard as label, then value. */
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

/** A cell's text, with a space between the parts an Inline lays side by side. */
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
  givenPage()
  vi.mocked(getCatalogueUseCase).mockResolvedValue(catalogue)
  vi.mocked(readApplicationPositionNames).mockResolvedValue(names)
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('the application page, loaded (A1)', () => {
  test("reads the application's Overview, and the names of its grant version", async () => {
    const { statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(getApplicationPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland', clientRef: 'gld-ssp-x9v' },
      'overview'
    )
    expect(readApplicationPositionNames).toHaveBeenCalledWith({
      code: 'woodland',
      version: '1.43.2'
    })
  })

  test('heads the page with the reference in mono, the status by name and a Copy reference button', async () => {
    const { $ } = await viewPage()

    expect($('title').text()).toBe('Application gld-ssp-x9v – Grants Platform')
    expect(textOf($, 'record-title')).toBe('gld-ssp-x9v')
    expect(part($, 'record-title').hasClass('gpa-mono')).toBe(true)
    expect(flatten($('.gpa-pageheader .gpa-status').text())).toBe(
      'Application received'
    )
    expect($('.gpa-pageheader .gpa-dot').hasClass('gpa-dot-neutral')).toBe(true)
    expect($('.gpa-pageheader gpa-copy').attr('data-value')).toBe('gld-ssp-x9v')
    expect(flatten($('.gpa-pageheader gpa-copy').text())).toBe('Copy reference')
    expect($('.gpa-pageheader [data-gpa-copy]').is('[hidden]')).toBe(false)
  })

  test('has no grant version in the header', async () => {
    const { $ } = await viewPage()

    expect($('.gpa-pageheader').text()).not.toContain('1.43.2')
  })

  test('goes back to the list it was opened from, and keeps it on every tab', async () => {
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(listed)}`)
    const back = encodeURIComponent(listed)

    expect(part($, 'record-back').attr('href')).toBe(listed)
    expect(textOf($, 'record-back')).toBe('Back to Applications')
    expect(
      $('nav.gpa-tabs a')
        .toArray()
        .map((a) => [flatten($(a).text()), $(a).attr('href')])
    ).toEqual([
      ['Overview', `${path}?back=${back}`],
      ['Events', `${path}?tab=events&back=${back}`],
      ['Raw', `${path}?tab=raw&back=${back}`]
    ])
    expect($('nav.gpa-tabs [aria-current="page"]').text()).toBe('Overview')
  })

  test('opens Times from the address, keeping the tab and the list it goes back to', async () => {
    const page = `${path}?tab=raw&back=${encodeURIComponent(listed)}`
    const { $, statusCode } = await viewPage(`${page}&times=open`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect($('#times-dialog .gpa-dialog-close').attr('href')).toBe(page)
    expect(part($, 'record-back').attr('href')).toBe(listed)
    expect($('nav.gpa-tabs [aria-current="page"]').text()).toBe('Raw')
  })

  test('goes back to, and sits under, Applications when opened from no list', async () => {
    const { $ } = await viewPage()

    expect(part($, 'record-back').attr('href')).toBe('/dev-ops/applications')
    expect(
      part($, 'shell-nav').find('[aria-current="page"]').attr('href')
    ).toBe('/dev-ops/applications')
  })

  test('shows where the application is: the phases as steps, at its own, then the stage', async () => {
    const { $ } = await viewPage()
    const where = part($, 'record-where')

    expect(flatten(where.find('.gpa-card-head').text())).toBe(
      'Where the application is'
    )
    expect(
      where
        .find('.gpa-step-label')
        .toArray()
        .map((label) => $(label).contents().first().text())
    ).toEqual(['Pre award', 'Award', 'Post award'])
    expect(
      flatten(where.find('[aria-current="step"] .gpa-step-label').text())
    ).toBe('Pre award — Current')
    expect(factsOf($, 'record-where')).toEqual([
      ['Stage', 'Review application']
    ])
  })

  test('offers to open the case, which comes back to this application', async () => {
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(listed)}`)
    const card = part($, 'record-counterpart')

    expect(flatten(card.find('.gpa-card-head').text())).toBe('Case')
    expect(flatten(card.find('.gpa-card-body .gpa-text-default').text())).toBe(
      'Caseworking holds the case for this application.'
    )
    expect(flatten(card.find('a.gpa-btn').text())).toBe('Open case')
    expect(card.find('a.gpa-btn').attr('href')).toBe(
      `/dev-ops/cases/woodland/gld-ssp-x9v?back=${encodeURIComponent(`${path}?back=${encodeURIComponent(listed)}`)}`
    )
  })

  test('says the grant version, linked back to this application, and when it was submitted', async () => {
    const { $ } = await viewPage()
    const link = part($, 'application-details').find('a.gpa-link')

    expect(factsOf($, 'application-details')).toEqual([
      ['Grant', 'woodland@1.43.2'],
      ['Submitted', '13 Oct 2026 15:04']
    ])
    expect(link.find('.gpa-mono').text()).toBe('woodland@1.43.2')
    expect(link.attr('href')).toBe(
      `/dev-ops/grants/woodland/1.43.2?back=${encodeURIComponent(path)}`
    )
  })

  test('writes times with no zone, and the seconds and zone in their title', async () => {
    const { $ } = await viewPage()
    const time = part($, 'application-details').find('time')

    expect(time.text()).toBe('13\u00a0Oct 2026 15:04')
    expect(time.attr('title')).toBe('13 Oct 2026 15:04:09 BST')
    expect(time.attr('datetime')).toBe('2026-10-13T14:04:09Z')
  })

  test('has no Created, Reference, Size or starting version rows', async () => {
    const { $ } = await viewPage()
    const labels = factsOf($, 'application-details').map(([label]) => label)

    expect(labels).not.toContain('Created')
    expect(labels).not.toContain('Reference')
    expect(labels).not.toContain('Size')
    expect(part($, 'application-details').text()).not.toContain('1.43.0')
  })

  test('lists the identifiers in mono, each with a copy button', async () => {
    const { $ } = await viewPage()
    const card = part($, 'application-identifiers')

    expect(factsOf($, 'application-identifiers')).toEqual([
      ['SBI', '107214733'],
      ['FRN', '1101072393'],
      ['CRN', '1103171356']
    ])
    expect(card.find('dd.gpa-dd-id')).toHaveLength(3)
    expect(
      card
        .find('gpa-copy')
        .toArray()
        .map((copy) => $(copy).attr('data-value'))
    ).toEqual(['107214733', '1101072393', '1103171356'])
  })

  test('shows the series, oldest first, viewing this one and the older ones replaced', async () => {
    const { $ } = await viewPage(`${path}?back=${encodeURIComponent(listed)}`)
    const series = part($, 'record-series')

    expect(flatten(series.find('h2').text())).toBe('Series')
    expect(flatten(series.find('.gpa-section-desc').text())).toBe(
      'Oldest first. Each one replaces the one before it; GAS only acts on the newest.'
    )
    expect(columnsOf($, 'record-series')).toEqual(['Reference', 'Created'])
    expect(rowsOf($, 'record-series')).toEqual([
      ['gld-ssp-a1 Replaced', '8 Oct 2026 11:12'],
      ['gld-ssp-b7 Replaced', '10 Oct 2026 17:40'],
      ['gld-ssp-x9v Viewing', '13 Oct 2026 15:04']
    ])
    expect(series.find('tr.is-selected').text()).toContain('gld-ssp-x9v')
    expect(series.find('tr.is-selected a')).toHaveLength(0)
    expect(series.find('a').first().attr('href')).toBe(
      `/dev-ops/applications/woodland/gld-ssp-a1?back=${encodeURIComponent(listed)}`
    )
  })

  test('has no replaced alert on the newest in its series', async () => {
    const { $ } = await viewPage()

    expect(part($, 'record-alert')).toHaveLength(0)
  })

  test('draws only design-system markup, with no inline styles and none of the old stylesheet', async () => {
    const { $ } = await viewPage()

    expect($('[style]')).toHaveLength(0)
    expect($('[class*="do-"], do-tab-strip, do-back')).toHaveLength(0)
    expect($('link[rel="stylesheet"]').attr('href')).toBe(
      '/public/src/dev-ops/views/components/index.css'
    )
    expect($('link[rel="stylesheet"]')).toHaveLength(1)
  })
})

describe('the Case card', () => {
  const outboxWithCreateCase = {
    ...outboxBucket,
    facts: outboxBucket.facts.map((fact) =>
      fact.name === 'eventType'
        ? {
            ...fact,
            values: [
              ...(fact.values ?? []),
              { value: 'CreateCase', label: 'CreateCase' }
            ]
          }
        : fact
    )
  }

  test('says Caseworking has no case, and finds its CreateCase event in the outbox (A2)', async () => {
    vi.mocked(getCatalogueUseCase).mockResolvedValue({
      ...catalogue,
      buckets: [outboxWithCreateCase, ...catalogue.buckets.slice(1)]
    })
    givenPage({ header: { ...header, counterpart: { exists: false } } })

    const { $ } = await viewPage()
    const card = part($, 'record-counterpart')

    expect(flatten(card.find('.gpa-empty-title').text())).toBe(
      'No case for this application'
    )
    expect(flatten(card.find('.gpa-empty-body').text())).toBe(
      'Caseworking holds no case with this reference. GAS sends CreateCase when the application arrives; check the outbox for it.'
    )
    expect(flatten(card.find('a.gpa-btn').text())).toBe(
      'Find its CreateCase event'
    )
    expect(card.find('a.gpa-btn').attr('href')).toBe(
      '/dev-ops/events/gas/outbox?event=CreateCase'
    )
    expect(card.find('[data-icon="briefcase"]')).toHaveLength(1)
  })

  test('leaves the button out when no GAS list declares CreateCase', async () => {
    givenPage({ header: { ...header, counterpart: { exists: false } } })

    const { $ } = await viewPage()

    expect(part($, 'record-counterpart').find('a')).toHaveLength(0)
  })

  test("says Caseworking didn't say, and still opens the case its ref names (R1)", async () => {
    givenPage({ header: { ...header, counterpart: null } })

    const { $ } = await viewPage()
    const card = part($, 'record-counterpart')

    expect(flatten(card.find('.gpa-card-body .gpa-text-default').text())).toBe(
      'Caseworking didn’t say whether it holds a case for this application.'
    )
    expect(card.find('a.gpa-btn').attr('href')).toBe(
      `/dev-ops/cases/woodland/gld-ssp-x9v?back=${encodeURIComponent(path)}`
    )
  })
})

describe('the series', () => {
  test('says this one was replaced, with a way to the newest, when viewing a replaced one (A3)', async () => {
    givenPage({
      overview: {
        ...overview,
        series: {
          ...overview.series!,
          latestRef: 'gld-ssp-c4',
          refs: ['gld-ssp-a1', 'gld-ssp-x9v', 'gld-ssp-c4'],
          members: [
            overview.series!.members![0],
            overview.series!.members![2],
            {
              clientRef: 'gld-ssp-c4',
              position: header.position,
              createdAt: '2026-10-14T09:00:00.000Z'
            }
          ]
        }
      }
    })

    const { $ } = await viewPage()

    expect(alertOf($, 'record-alert')).toEqual({
      title: 'This application was replaced by gld-ssp-c4.',
      text: 'GAS only acts on the newest in the series. This one is kept for its history.',
      buttons: [
        {
          text: 'Open gld-ssp-c4',
          href: '/dev-ops/applications/woodland/gld-ssp-c4'
        }
      ]
    })
    expect(part($, 'record-alert').hasClass('gpa-alert-info')).toBe(true)
    expect(rowsOf($, 'record-series').map(([ref]) => ref)).toEqual([
      'gld-ssp-a1 Replaced',
      'gld-ssp-x9v Viewing',
      'gld-ssp-c4'
    ])
  })

  test('lists the references alone when GAS sent only those (A4)', async () => {
    givenPage({
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
      'Oldest first. GAS sent only the references, so their dates aren’t shown. Open one to see it.'
    )
    expect(rowsOf($, 'record-series')).toEqual([
      ['gld-ssp-a1 Replaced'],
      ['gld-ssp-x9v Viewing']
    ])
  })

  test.each([
    ['one member', { latestRef: 'gld-ssp-x9v', refs: ['gld-ssp-x9v'] }],
    ['none', null]
  ])('has no series section with %s (A5)', async (_, series) => {
    givenPage({ overview: { ...overview, series } })

    const { $ } = await viewPage()

    expect(part($, 'record-series')).toHaveLength(0)
    expect(part($, 'record-alert')).toHaveLength(0)
  })
})

describe('Details', () => {
  test('shows Updated when it differs from Submitted to the minute', async () => {
    givenPage({
      overview: { ...overview, updatedAt: '2026-10-13T14:09:00.000Z' }
    })

    const { $ } = await viewPage()

    expect(factsOf($, 'application-details')).toEqual([
      ['Grant', 'woodland@1.43.2'],
      ['Submitted', '13 Oct 2026 15:04'],
      ['Updated', '13 Oct 2026 15:09']
    ])
  })

  test('says the code alone, with no link, when no version was recorded, and reads no names', async () => {
    givenPage({ overview: { ...overview, currentConfigVersion: null } })

    const { $ } = await viewPage()
    const version = part($, 'application-details').find('dd').first()

    expect(flatten(version.text())).toBe('woodland, version not recorded')
    expect(version.find('a')).toHaveLength(0)
    expect(version.find('.gpa-text-subtle')).toHaveLength(1)
    expect(readApplicationPositionNames).not.toHaveBeenCalled()
  })

  test('draws the sign for a missing value, with no copy button, for an identifier GAS has not got', async () => {
    givenPage({
      overview: {
        ...overview,
        identifiers: { sbi: '107214733', frn: null, crn: null }
      }
    })

    const { $ } = await viewPage()
    const card = part($, 'application-identifiers')

    expect(card.find('.gpa-fact-empty')).toHaveLength(2)
    expect(card.find('gpa-copy')).toHaveLength(1)
  })

  test('shows a submitted date GAS stored as something else as it is', async () => {
    givenPage({ overview: { ...overview, submittedAt: '13/10/2026' } })

    const { $ } = await viewPage()

    expect(factsOf($, 'application-details')[1]).toEqual([
      'Submitted',
      '13/10/2026'
    ])
  })
})

describe('without the names of its phases (R3)', () => {
  beforeEach(() => {
    vi.mocked(readApplicationPositionNames).mockResolvedValue(null)
  })

  test('says the phase and stage, readable, with no stepper', async () => {
    const { $ } = await viewPage()

    expect(part($, 'record-where').find('.gpa-stepper')).toHaveLength(0)
    expect(factsOf($, 'record-where')).toEqual([
      ['Phase', 'Pre award'],
      ['Stage', 'Review']
    ])
    expect(flatten($('.gpa-pageheader .gpa-status').text())).toBe('Received')
  })

  test('draws the sign for a missing value for a position the application has not got', async () => {
    givenPage({
      header: {
        ...header,
        position: { phase: null, stage: null, status: null }
      }
    })

    const { $ } = await viewPage()

    expect(factsOf($, 'record-where')).toEqual([
      ['Phase', '—'],
      ['Stage', '—']
    ])
    expect($('.gpa-pageheader .gpa-status')).toHaveLength(0)
  })

  test('places the application by the names it has when its phase is not among them', async () => {
    vi.mocked(readApplicationPositionNames).mockResolvedValue({
      phases: [{ code: 'PHASE_CLAIM', name: 'Claim', stages: [] }]
    })

    const { $ } = await viewPage()

    expect(part($, 'record-where').find('.gpa-stepper')).toHaveLength(0)
    expect(factsOf($, 'record-where')).toEqual([
      ['Phase', 'Pre award'],
      ['Stage', 'Review']
    ])
  })
})

describe('an Overview with nothing to show', () => {
  test('says the tab could not be read, with Try again, when GAS failed it (R5)', async () => {
    givenPage({
      overview: null,
      sectionErrors: [{ section: 'overview', message: 'GAS timed out' }]
    })

    const { $ } = await viewPage()

    expect(alertOf($, 'record-tab-error')).toEqual({
      title: 'This tab couldn’t be read.',
      text: 'GAS returned an unexpected answer for this application’s details. The rest of the page is unaffected.',
      buttons: [{ text: 'Try again', href: path }]
    })
    expect($('.gpa-columns-aside')).toHaveLength(0)
    expect($.html()).not.toContain('GAS timed out')
  })

  test('says GAS returned no data when it sent none (R2)', async () => {
    givenPage({ overview: null })

    const { $ } = await viewPage()

    expect(alertOf($, 'record-tab-nothing').title).toBe(
      'GAS returned no data for this tab.'
    )
    expect(part($, 'record-where')).toHaveLength(0)
  })
})

describe('the Events tab', () => {
  const eventsPath = `${path}?tab=events`

  test('reads the Events tab, and no names: only Overview carries the version', async () => {
    givenTab({ events: { rows: [outboxEvent], more: false } })

    const { $ } = await viewPage(eventsPath)

    expect(getApplicationPageUseCase).toHaveBeenCalledWith(
      { code: 'woodland', clientRef: 'gld-ssp-x9v' },
      'events'
    )
    expect(readApplicationPositionNames).not.toHaveBeenCalled()
    expect(flatten($('.gpa-pageheader .gpa-status').text())).toBe('Received')
    expect($('.gpa-columns-aside')).toHaveLength(0)
  })

  test("lists GAS's events, each opening its page and coming back to this tab", async () => {
    givenTab({ events: { rows: [inboxEvent, outboxEvent], more: false } })

    const { $ } = await viewPage(eventsPath)
    const table = part($, 'record-events')

    expect(columnsOf($, 'record-events')).toEqual([
      'Event',
      'Queue',
      'Status',
      'Created'
    ])
    expect(rowsOf($, 'record-events')).toEqual([
      ['UpdateApplicationStatus', 'Inbox', 'Completed', '13 Oct 2026 15:06'],
      ['CreateCase', 'Outbox', 'Dead letter', '13 Oct 2026 15:05']
    ])
    expect(table.find('a.gpa-rowlink').last().attr('href')).toBe(
      `/dev-ops/events/gas/outbox/6716a9c2e4b0a1f2c3d4e5f6?back=${encodeURIComponent(eventsPath)}`
    )
    expect(table.find('.gpa-dot-danger')).toHaveLength(1)
    expect(table.find('.gpa-dot-success')).toHaveLength(1)
    expect(table.find('tr.is-link')).toHaveLength(2)
  })

  test('says it shows only the newest 50 from each queue when there are more (A6)', async () => {
    givenTab({ events: { rows: [outboxEvent], more: true } })

    const { $ } = await viewPage(eventsPath)

    expect(flatten(part($, 'record-events').find('.gpa-listfoot').text())).toBe(
      'Showing the newest 50 from each GAS queue.'
    )
  })

  test('says GAS holds no events for the application (A7)', async () => {
    givenTab({ events: { rows: [], more: false } })

    const { $ } = await viewPage(eventsPath)
    const empty = part($, 'record-events').find('.gpa-empty')

    expect(flatten(empty.find('.gpa-empty-title').text())).toBe(
      'No events found'
    )
    expect(flatten(empty.find('.gpa-empty-body').text())).toBe(
      'GAS holds no events for this application. Events past their deletion date aren’t listed.'
    )
    expect(part($, 'record-events').find('.gpa-listfoot')).toHaveLength(0)
  })

  test('names the sources it could not read, and still shows the rest (A8)', async () => {
    givenTab({
      events: { rows: [outboxEvent], more: false },
      sourceErrors: [{ hop: 'GAS inbox' }]
    })

    const { $ } = await viewPage(eventsPath)

    expect(alertOf($, 'record-events-partial')).toEqual({
      title: 'Some event sources are unavailable: GAS inbox.',
      text: 'Showing the rest.',
      buttons: []
    })
    expect(part($, 'record-events-partial').hasClass('gpa-alert-warning')).toBe(
      true
    )
    expect(rowsOf($, 'record-events')).toHaveLength(1)
  })

  test('says the tab could not be read, with Try again and no table (A9)', async () => {
    givenTab({
      events: null,
      sectionErrors: [{ section: 'events', message: 'GAS timed out' }]
    })

    const { $ } = await viewPage(eventsPath)

    expect(alertOf($, 'record-tab-error')).toEqual({
      title: 'This tab couldn’t be read.',
      text: 'GAS returned an unexpected answer for this application’s events. The rest of the page is unaffected.',
      buttons: [{ text: 'Try again', href: eventsPath }]
    })
    expect(part($, 'record-tab-error').hasClass('gpa-alert-danger')).toBe(true)
    expect(part($, 'record-events')).toHaveLength(0)
    expect($.html()).not.toContain('GAS timed out')
  })
})

describe('the Raw tab', () => {
  const rawPath = `${path}?tab=raw`
  const document = { clientRef: 'gld-ssp-x9v', answers: { hectares: 12.5 } }

  test('shows the stored document, with Copy', async () => {
    givenTab({ raw: document, storedBytes: 2458 })

    const { $ } = await viewPage(rawPath)
    const card = part($, 'record-raw')
    const json = JSON.stringify(document, null, 2)

    expect(flatten(card.find('.gpa-card-head h2').text())).toBe(
      'Stored document'
    )
    expect(card.find('gpa-copy').attr('data-value')).toBe(json)
    expect(card.find('pre').attr('aria-label')).toBe('Stored document')
    expect(
      card
        .find('pre > div')
        .toArray()
        .map((line) => $(line).text())
        .join('\n')
    ).toBe(json)
  })

  test('says the document is too large, with its size (A10)', async () => {
    givenTab({
      raw: null,
      storedBytes: 2516582,
      sectionErrors: [{ section: 'raw', message: 'too large to show' }]
    })

    const { $ } = await viewPage(rawPath)
    const card = part($, 'record-raw')

    expect(flatten(card.find('.gpa-empty-title').text())).toBe(
      'Too large to show'
    )
    expect(flatten(card.find('.gpa-empty-body').text())).toBe(
      'The stored application is 2.4 MiB, too large for this page.'
    )
    expect(card.find('[data-icon="file-exclamation-point"]')).toHaveLength(1)
  })

  test('says it is too large without a size when GAS sent none (R8)', async () => {
    givenTab({
      raw: null,
      storedBytes: null,
      sectionErrors: [{ section: 'raw', message: 'too large to show' }]
    })

    const { $ } = await viewPage(rawPath)

    expect(flatten(part($, 'record-raw').find('.gpa-empty-body').text())).toBe(
      'The stored application is too large to show on this page.'
    )
  })

  test('says the tab could not be read when GAS failed it (R4)', async () => {
    givenTab({
      raw: null,
      sectionErrors: [{ section: 'raw', message: 'GAS timed out' }]
    })

    const { $ } = await viewPage(rawPath)

    expect(alertOf($, 'record-tab-error')).toEqual({
      title: 'This tab couldn’t be read.',
      text: 'GAS returned an unexpected answer for this application’s stored document. The rest of the page is unaffected.',
      buttons: [{ text: 'Try again', href: rawPath }]
    })
  })

  test('says GAS returned no data when it sent none', async () => {
    givenTab({ raw: null })

    const { $ } = await viewPage(rawPath)

    expect(alertOf($, 'record-tab-nothing').title).toBe(
      'GAS returned no data for this tab.'
    )
  })
})

describe('an application GAS could not show', () => {
  test.each([
    [
      'unavailable (A11)',
      'unavailable',
      statusCodes.serviceUnavailable,
      'This application couldn’t be loaded from GAS.',
      'GAS answered with an error. Nothing has changed — try again in a moment.'
    ],
    [
      'timed out (A12)',
      'timed-out',
      statusCodes.gatewayTimeout,
      'This application couldn’t be loaded: GAS timed out waiting for it.',
      'Nothing has changed. Try again in a moment.'
    ]
  ] as const)(
    'says why when GAS is %s, with Try again and the way back',
    async (_, outcome, code, title, text) => {
      vi.mocked(getApplicationPageUseCase).mockResolvedValue({
        outcome,
        page: null
      })

      const { $, statusCode } = await viewPage(
        `${path}?back=${encodeURIComponent(listed)}`
      )

      expect(statusCode).toBe(code)
      expect(alertOf($, `record-missing-${outcome}`)).toEqual({
        title,
        text,
        buttons: [
          {
            text: 'Try again',
            href: `${path}?back=${encodeURIComponent(listed)}`
          },
          { text: 'Back to Applications', href: listed }
        ]
      })
      expect(textOf($, 'record-missing-title')).toBe('gld-ssp-x9v')
      expect(readApplicationPositionNames).not.toHaveBeenCalled()
    }
  )

  test('says GAS has no such application for the grant (A13)', async () => {
    vi.mocked(getApplicationPageUseCase).mockResolvedValue({
      outcome: 'not-found',
      page: null
    })

    const { $, statusCode } = await viewPage()
    const notFound = part($, 'record-missing-not-found')

    expect(statusCode).toBe(statusCodes.notFound)
    expect(flatten(notFound.find('.gpa-empty-title').text())).toBe(
      'GAS has no application gld-ssp-x9v for woodland.'
    )
    expect(flatten(notFound.find('.gpa-empty-body').text())).toBe(
      'Check the reference and the grant — a reference belongs to one grant. Search for it from Applications.'
    )
    expect(notFound.find('a.gpa-btn').attr('href')).toBe(
      '/dev-ops/applications'
    )
  })

  test('refuses a tab the application page has not got', async () => {
    const { statusCode } = await viewPage(`${path}?tab=answers`)

    expect(statusCode).toBe(statusCodes.badRequest)
  })
})
