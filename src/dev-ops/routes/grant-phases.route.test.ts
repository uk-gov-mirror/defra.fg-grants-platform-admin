import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  GrantLifecycle,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import { grantVersionHeader as header } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-grant-page.use-case.ts'), async () => ({
  ...(await vi.importActual<
    typeof import('../use-cases/get-grant-page.use-case.ts')
  >('../use-cases/get-grant-page.use-case.ts')),
  getGrantPageUseCase: vi.fn()
}))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const path = '/dev-ops/grants/woodland-creation/1.2.0?tab=phases'

const lifecycle: GrantLifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre-award',
      stages: [
        {
          code: 'REVIEW',
          name: 'Review application',
          statuses: [
            { code: 'RECEIVED', name: 'Application received' },
            { code: 'IN_REVIEW', name: 'In review' }
          ]
        },
        {
          code: 'AGREEMENT',
          name: 'Agreement',
          statuses: [{ code: 'GENERATING', name: 'Agreement generating' }]
        }
      ]
    }
  ],
  initialPosition: 'PRE_AWARD:REVIEW:RECEIVED',
  amendablePositions: [],
  waysIn: [
    { to: 'PRE_AWARD:REVIEW:RECEIVED', kind: 'any', processes: [] },
    {
      to: 'PRE_AWARD:REVIEW:IN_REVIEW',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:RECEIVED',
      processes: []
    },
    {
      to: 'PRE_AWARD:AGREEMENT:GENERATING',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      processes: ['GENERATE_OFFER']
    }
  ],
  externalMappings: [
    {
      source: 'CW',
      code: 'PRE_AWARD:REVIEWING:IN_REVIEW',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::IN_REVIEW',
      to: 'PRE_AWARD:REVIEW:IN_REVIEW'
    },
    {
      source: 'DUMMY',
      code: 'DUMMY_EXTERNAL_STATUS',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::GENERATING',
      to: 'PRE_AWARD:AGREEMENT:GENERATING'
    }
  ],
  claimApproval: null
}

const givenGrant = (overrides: Partial<GrantVersionPage> = {}) =>
  vi.mocked(getGrantPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header,
      lifecycle,
      problem: null,
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

let server: Server

const viewPage = async (url = path) => {
  const { result } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  return load(result as unknown as string)
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

/** The panel the page shows: the others are drawn hidden, for the map to show in place. */
const shownPanel = ($: CheerioAPI) =>
  part($, 'grant-status-panel').not('[hidden]')

type Node = ReturnType<CheerioAPI>[number]

const textsOf = (node: Node): string[] =>
  node.type === 'text'
    ? [node.data]
    : 'children' in node
      ? (node.children as Node[]).flatMap(textsOf)
      : []

/** Every piece of text in turn, so items laid out side by side read apart. */
const wordsOf = (node: ReturnType<CheerioAPI>) =>
  flatten(node.toArray().flatMap(textsOf).join(' ')).replace(/ ([.,):])/g, '$1')

const factsOf = ($: CheerioAPI) =>
  shownPanel($)
    .find('dt')
    .toArray()
    .map((dt) => [flatten($(dt).text()), wordsOf($(dt).next('dd'))])

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenGrant()
})

afterAll(async () => {
  await server.stop()
})

describe('the grant Phases tab', () => {
  test('says what the arrows mean above the map', async () => {
    const $ = await viewPage()

    expect(flatten($('p.gpa-text-muted').text())).toBe(
      'Arrows show the moves GAS allows. A move happens only when CW or Agreements sends a status, when the last claim is submitted, or when a GAS process sets a status itself.'
    )
  })

  test('maps the statuses by stage, by name, keyed by what entering each runs', async () => {
    const $ = await viewPage()
    const map = part($, 'grant-phases-map')

    expect(map.attr('aria-label')).toBe('Grant statuses')
    expect(
      map
        .find('.gpa-statemap-legend li')
        .toArray()
        .map((item) => flatten($(item).text()))
    ).toStrictEqual(['Runs a GAS process', 'Move only'])
    expect(
      map
        .find('.gpa-statemap-stage-title')
        .toArray()
        .map((title) => $(title).text())
    ).toStrictEqual(['Review application', 'Agreement'])
    expect(
      map
        .find('.gpa-statemap-state')
        .toArray()
        .map((state) => [
          $(state).attr('data-value'),
          $(state).attr('class'),
          flatten($(state).find('.gpa-statemap-label').text())
        ])
    ).toStrictEqual([
      [
        'PRE_AWARD:REVIEW:RECEIVED',
        'gpa-statemap-state is-selected is-move',
        'Application received, Move only'
      ],
      [
        'PRE_AWARD:REVIEW:IN_REVIEW',
        'gpa-statemap-state is-move',
        'In review, Move only'
      ],
      [
        'PRE_AWARD:AGREEMENT:GENERATING',
        'gpa-statemap-state is-process',
        'Agreement generating, Runs a GAS process'
      ]
    ])
    expect(
      map.find('[data-value="PRE_AWARD:REVIEW:RECEIVED"] .gpa-badge').text()
    ).toBe('initial')
    expect(
      map
        .find(
          '[data-value="PRE_AWARD:AGREEMENT:GENERATING"] svg[data-icon="cog"]'
        )
        .attr('aria-label')
    ).toBe('Runs GENERATE_OFFER')
  })

  test('picks a status without a script by sending this tab with it, keeping back', async () => {
    const $ = await viewPage(`${path}&back=%2Fdev-ops%2Fgrants`)
    const form = $('form#phases-pick')

    expect(form.attr('method')).toBe('get')
    expect(form.attr('action')).toBe('/dev-ops/grants/woodland-creation/1.2.0')
    expect(form.is('[hidden]')).toBe(true)
    expect(
      form
        .find('input[type="hidden"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toStrictEqual([
      ['tab', 'phases'],
      ['back', '/dev-ops/grants']
    ])
    expect(
      part($, 'grant-phases-map')
        .find('button')
        .toArray()
        .every(
          (button) =>
            $(button).attr('form') === 'phases-pick' &&
            $(button).attr('name') === 'status' &&
            $(button).attr('type') === 'submit'
        )
    ).toBe(true)
    expect($('gpa-state-map').attr('data-panels')).toBe('grant-phase-panels')
  })

  test('draws a panel per status, showing the initial one unasked', async () => {
    const $ = await viewPage()

    expect(
      $('#grant-phase-panels > [data-state]')
        .toArray()
        .map((panel) => [$(panel).attr('data-state'), $(panel).is('[hidden]')])
    ).toStrictEqual([
      ['PRE_AWARD:REVIEW:RECEIVED', false],
      ['PRE_AWARD:REVIEW:IN_REVIEW', true],
      ['PRE_AWARD:AGREEMENT:GENERATING', true]
    ])
    expect(flatten(shownPanel($).find('.gpa-card-head').text())).toBe(
      'Selected status'
    )
    expect(flatten(shownPanel($).find('h3').text())).toBe(
      'Application received'
    )
    expect(flatten(shownPanel($).find('.gpa-badge').text())).toBe('initial')
    expect(factsOf($)).toStrictEqual([
      ['Phase', 'Pre-award'],
      ['Stage', 'Review application'],
      ['Runs', 'Nothing: move only'],
      [
        'Ways in',
        'Any status: GAS accepts this move from every position (no validFrom).'
      ],
      ['Ways out', 'In review'],
      ['Triggered by', 'Set when the application is submitted.']
    ])
  })

  test('shows the status asked for, with what it runs, its ways, and what triggers it', async () => {
    const $ = await viewPage(`${path}&status=GENERATING`)

    expect(flatten(shownPanel($).find('h3').text())).toBe(
      'Agreement generating'
    )
    expect(factsOf($)).toStrictEqual([
      ['Phase', 'Pre-award'],
      ['Stage', 'Agreement'],
      ['Runs', 'GENERATE_OFFER'],
      ['Ways in', 'In review'],
      ['Ways out', 'None. Applications stay here.'],
      [
        'Triggered by',
        'unknown source DUMMY DUMMY_EXTERNAL_STATUS while the application is in Review application'
      ]
    ])
    expect(shownPanel($).find('.gpa-badge-warning').text()).toBe(
      'unknown source DUMMY'
    )
    expect(
      shownPanel($)
        .find('a')
        .toArray()
        .map((link) => [$(link).text(), $(link).attr('href')])
    ).toStrictEqual([
      [
        'In review',
        '/dev-ops/grants/woodland-creation/1.2.0?tab=phases&status=PRE_AWARD%3AREVIEW%3AIN_REVIEW'
      ]
    ])
  })

  test('says a status reached by a move alone runs nothing, and links a CW trigger to its workflow status', async () => {
    const $ = await viewPage(`${path}&status=PRE_AWARD:REVIEW:IN_REVIEW`)

    expect(factsOf($)).toContainEqual(['Runs', 'Nothing: move only'])
    expect(factsOf($)).toContainEqual([
      'Triggered by',
      'CW PRE_AWARD:REVIEWING:IN_REVIEW while the application is in Review application'
    ])
    expect(shownPanel($).find('a:has(code)').attr('href')).toBe(
      '/dev-ops/workflows/woodland-creation/1.2.0?tab=phases&back=%2Fdev-ops%2Fgrants%2Fwoodland-creation%2F1.2.0%3Ftab%3Dphases%26status%3DPRE_AWARD%253AREVIEW%253AIN_REVIEW&status=PRE_AWARD%3AREVIEWING%3AIN_REVIEW'
    )
  })

  test('says GAS cannot load the definition, with its reason, when it is unreadable', async () => {
    givenGrant({
      lifecycle: null,
      problem: 'phases[0].stages[1].statuses[0].code must be unique'
    })

    const $ = await viewPage()
    const alert = part($, 'grant-phases-unreadable')

    expect(alert.hasClass('gpa-alert-danger')).toBe(true)
    expect(flatten(alert.find('.gpa-alert-title').text())).toBe(
      'GAS cannot load this grant definition, so its phases cannot be shown.'
    )
    expect(flatten(alert.find('.gpa-alert-title').next().text())).toBe(
      'phases[0].stages[1].statuses[0].code must be unique. Publish a fixed version.'
    )
    expect(part($, 'grant-phases-map')).toHaveLength(0)
  })
})
