import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  GrantStatusMap,
  WorkflowPage
} from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowPageUseCase } from '../use-cases/get-workflow-page.use-case.ts'
import {
  woodlandDefinition,
  workflowVersionHeader as header
} from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-workflow-page.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const path = '/dev-ops/workflows/woodland-creation/1.2.0?tab=phases'

/** The grant of the same version: CW's Approved moves GAS to its own Approved. */
const found: GrantStatusMap = {
  outcome: 'found',
  lifecycle: {
    phases: [
      {
        code: 'PRE_AWARD',
        name: 'Pre-award',
        stages: [
          {
            code: 'REVIEWING',
            name: 'Reviewing application',
            statuses: [{ code: 'APPROVED', name: 'Approved' }]
          }
        ]
      }
    ],
    initialPosition: 'PRE_AWARD:REVIEWING:APPROVED',
    amendablePositions: [],
    waysIn: [],
    externalMappings: [
      {
        source: 'CW',
        code: 'PRE_AWARD:REVIEW:APPROVED',
        whileIn: 'PRE_AWARD:REVIEWING',
        mappedTo: '::APPROVED',
        to: 'PRE_AWARD:REVIEWING:APPROVED'
      }
    ],
    claimApproval: null
  }
}

const givenWorkflow = (grantStatusMap: GrantStatusMap = found) =>
  vi.mocked(getWorkflowPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header,
      definition: woodlandDefinition,
      grantStatusMap,
      sourceErrors: [],
      sectionErrors: []
    } satisfies WorkflowPage
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

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const shownPanel = ($: CheerioAPI) =>
  part($, 'workflow-status-panel').not('[hidden]')

const factOf = ($: CheerioAPI, label: string) =>
  wordsOf(shownPanel($).find(`dt:contains("${label}")`).next('dd'))

const alertOf = (alert: ReturnType<CheerioAPI>) => ({
  title: flatten(alert.find('.gpa-alert-title').text()),
  text: wordsOf(alert.find('.gpa-alert-title').next())
})

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenWorkflow()
})

afterAll(async () => {
  await server.stop()
})

describe('the workflow Phases tab', () => {
  test('sums up the statuses with findings, each linked, with its first finding', async () => {
    const $ = await viewPage()
    const alert = part($, 'workflow-phases-findings')

    expect(alert.hasClass('gpa-alert-warning')).toBe(true)
    expect(alertOf(alert)).toStrictEqual({
      title: '3 statuses with findings',
      text: 'Withdrawn unreachable Awaiting acceptance dead end Agreement accepted unreachable'
    })
    expect(alert.find('a').first().attr('href')).toBe(
      '/dev-ops/workflows/woodland-creation/1.2.0?tab=phases&status=PRE_AWARD%3AREVIEW%3AWITHDRAWN'
    )
  })

  test('maps the statuses by full position, coloured as CW shows them, marking the start, the ends and the findings', async () => {
    const $ = await viewPage()
    const map = part($, 'workflow-phases-map')
    const state = (position: string) => map.find(`[data-value="${position}"]`)

    expect(map.attr('aria-label')).toBe('Workflow statuses')
    expect(map.find('.gpa-statemap-legend')).toHaveLength(0)
    expect(
      state('PRE_AWARD:REVIEW:AWAITING_REVIEW').find('.gpa-badge').text()
    ).toBe('start')
    expect(
      state('PRE_AWARD:REVIEW:AWAITING_REVIEW').hasClass('is-selected')
    ).toBe(true)
    expect(state('PRE_AWARD:REVIEW:REJECTED').find('.gpa-badge').text()).toBe(
      'closes'
    )
    expect(
      state('PRE_AWARD:REVIEW:REJECTED').find('.gpa-dot-danger')
    ).toHaveLength(1)
    expect(
      state('PRE_AWARD:REVIEW:WITHDRAWN')
        .find('svg[data-icon="triangle-alert"]')
        .attr('aria-label')
    ).toBe('Has findings')
  })

  test('picks a status without a script by sending this tab with it', async () => {
    const $ = await viewPage()

    expect($('form#phases-pick').attr('method')).toBe('get')
    expect($('gpa-state-map').attr('data-panels')).toBe('workflow-phase-panels')
    expect(
      $('#workflow-phase-panels > [data-state]:not([hidden])').attr(
        'data-state'
      )
    ).toBe('PRE_AWARD:REVIEW:AWAITING_REVIEW')
  })

  test('describes the first status unasked: how CW shows it, its flags, its ways and that it tells GAS nothing', async () => {
    const $ = await viewPage()
    const panel = shownPanel($)

    expect(flatten(panel.find('.gpa-card-head').text())).toBe('Status')
    expect(flatten(panel.find('h3').text())).toBe('Awaiting review')
    expect(
      panel
        .find('gpa-tooltip')
        .toArray()
        .map((tip) => [
          $(tip).attr('text'),
          flatten($(tip).find('.gpa-badge').text())
        ])
    ).toStrictEqual([
      ['New cases start here', 'start'],
      [
        'Caseworkers can’t change tasks in this status (interactive: false)',
        'tasks read-only'
      ]
    ])
    expect(
      panel.find('gpa-tooltip .gpa-tooltip-trigger').attr('tabindex')
    ).toBe('0')
    expect(factOf($, 'CW shows')).toBe('Awaiting review')
    expect(factOf($, 'Phase')).toBe('Pre-award')
    expect(factOf($, 'Stage')).toBe('Review application')
    expect(factOf($, 'Ways in')).toBe('New cases start here')
    expect(factOf($, 'Ways out')).toBe('In review by Start review')
    expect(factOf($, 'Tells GAS')).toBe('Not sent (cases start here)')
  })

  test('says a status with no way out closes the case', async () => {
    const $ = await viewPage(`${path}&status=REJECTED`)

    expect(factOf($, 'Ways out')).toBe('Closes case')
    expect(shownPanel($).find('.gpa-badge-warning').first().text()).toBe(
      'closes case'
    )
  })

  test('says what makes a dead end a finding', async () => {
    const $ = await viewPage(`${path}&status=AWAITING_ACCEPTANCE`)

    expect(
      alertOf(part($, 'workflow-status-finding').not('[hidden] *'))
    ).toStrictEqual({
      title: 'Dead end:',
      text: 'no action or GAS message moves a case out of this status, and it doesn’t close the case. Cases here stay open.'
    })
  })

  test('Tells GAS the grant status it moves to, by name, linking the grant’s Phases', async () => {
    const $ = await viewPage(`${path}&status=APPROVED`)

    expect(factOf($, 'Tells GAS')).toBe(
      'CW tells GAS. If the application is in a status that move allows: Pre-award, Reviewing application Approved Otherwise GAS ignores it.'
    )
    expect(shownPanel($).find('dd a:contains("Approved")').attr('href')).toBe(
      '/dev-ops/grants/woodland-creation/1.2.0?tab=phases&back=%2Fdev-ops%2Fworkflows%2Fwoodland-creation%2F1.2.0%3Ftab%3Dphases%26status%3DPRE_AWARD%253AREVIEW%253AAPPROVED&status=PRE_AWARD%3AREVIEWING%3AAPPROVED'
    )
  })

  test.each([
    ['not-stored', 'gpa-alert-info', 'Grant definition not stored.'],
    ['unreadable', 'gpa-alert-warning', 'GAS can’t read the grant definition.']
  ] as const)(
    'says what GAS does can’t be shown while the grant is %s, linking the grant version',
    async (outcome, tone, title) => {
      givenWorkflow({ outcome })

      const $ = await viewPage(`${path}&status=APPROVED`)
      const alert = shownPanel($).find('[data-testid="workflow-status-grant"]')

      expect(alert.hasClass(tone)).toBe(true)
      expect(alertOf(alert)).toStrictEqual({
        title,
        text: 'What GAS does with this message can’t be shown. Open woodland-creation@1.2.0'
      })
      expect(alert.find('a').attr('href')).toBe(
        '/dev-ops/grants/woodland-creation/1.2.0?back=%2Fdev-ops%2Fworkflows%2Fwoodland-creation%2F1.2.0%3Ftab%3Dphases%26status%3DPRE_AWARD%253AREVIEW%253AAPPROVED'
      )
    }
  )

  test('says when GAS has no grant of this version', async () => {
    givenWorkflow({ outcome: 'no-grant' })

    const $ = await viewPage(`${path}&status=APPROVED`)

    expect(factOf($, 'Tells GAS')).toBe(
      'No GAS grant has the version woodland-creation@1.2.0.'
    )
  })

  test.each(['unavailable', 'timed-out'] as const)(
    'says what GAS does can’t be shown when the grant read is %s',
    async (outcome) => {
      givenWorkflow({ outcome })

      const $ = await viewPage(`${path}&status=APPROVED`)
      const alert = shownPanel($).find('[data-testid="workflow-status-grant"]')

      expect(alert.hasClass('gpa-alert-warning')).toBe(true)
      expect(alertOf(alert).title).toBe(
        'What GAS does with this message can’t be shown: GAS didn’t answer.'
      )
    }
  )
})
