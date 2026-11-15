import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'
import type { AnyNode, Element, Text } from 'domhandler'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  StoredWorkflow,
  WorkflowDefinition,
  WorkflowPage
} from '../use-cases/get-workflow-page.use-case.ts'
import { getWorkflowPageUseCase } from '../use-cases/get-workflow-page.use-case.ts'
import {
  woodlandDefinition,
  workflowVersionHeader
} from '../use-cases/test-fixtures.ts'
import { expectTablesStyled } from '../test-utils.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-workflow-page.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const path = '/dev-ops/workflows/woodland-creation/1.2.0'

const givenDefinition = (definition: WorkflowDefinition) =>
  vi.mocked(getWorkflowPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header: workflowVersionHeader,
      definition,
      sourceErrors: [],
      sectionErrors: []
    } satisfies WorkflowPage
  })

const withWorkflow = (
  workflow: Partial<StoredWorkflow>,
  addresses: WorkflowDefinition['addresses'] = woodlandDefinition.addresses
): WorkflowDefinition => ({
  workflow: { ...woodlandDefinition.workflow, ...workflow },
  addresses
})

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Text nodes in document order. */
const textsIn = (node: AnyNode): string[] =>
  node.type === 'text'
    ? [(node as Text).data]
    : 'children' in node
      ? (node as Element).children.flatMap(textsIn)
      : []

/** An element's text, its parts spaced as a reader sees them: the markup between them carries no whitespace. */
const spaced = ($: CheerioAPI, node: Parameters<CheerioAPI>[0]) =>
  flatten($(node).toArray().flatMap(textsIn).join(' ')).replace(
    / ([.,:)])/g,
    '$1'
  )

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) => spaced($, part($, testId))

/** Each row's cells, as text. */
const rowsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .toArray()
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((cell) => spaced($, cell))
    )

const headsOf = ($: CheerioAPI, scope: string) =>
  part($, scope)
    .find('th')
    .toArray()
    .map((head) => spaced($, head))

let server: Server

const viewTab = async (tab: string) => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url: `${path}?tab=${tab}`,
    auth: { strategy: 'session', credentials }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return { $, statusCode }
}

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenDefinition(woodlandDefinition)
})

afterAll(async () => {
  await server.stop()
})

describe('the workflow Tasks tab', () => {
  test('draws a framed accordion of task groups, named, the first open, with no count or code', async () => {
    const { $, statusCode } = await viewTab('tasks')
    const groups = part($, 'workflow-task-group')

    expect(statusCode).toBe(200)
    expect(part($, 'workflow-tasks').hasClass('gpa-accordion-framed')).toBe(
      true
    )
    expect(
      groups
        .find('.gpa-accordion-title')
        .toArray()
        .map((title) => $(title).text())
    ).toEqual(['Application checks', 'Approval'])
    expect(groups.toArray().map((group) => $(group).is('[open]'))).toEqual([
      true,
      false
    ])
    expect(groups.find('.gpa-accordion-meta')).toHaveLength(0)
    expect(groups.first().attr('id')).toBe('stage-PRE_AWARD:REVIEW')
  })

  test("says each group's stage and the moves it completes with, then its tasks", async () => {
    const { $ } = await viewTab('tasks')
    const first = part($, 'workflow-task-group').first()

    expect(
      first
        .find('dt')
        .toArray()
        .map((label) => $(label).text())
    ).toEqual(['Stage', 'Completes with'])
    expect(flatten(first.find('dd').first().text())).toBe('Review application')
    expect(
      first
        .find('th')
        .toArray()
        .map((head) => spaced($, head))
    ).toEqual(['Task', 'Required', 'Answers'])
  })

  test('lists each task with whether it is required and its answers as outline badges', async () => {
    const { $ } = await viewTab('tasks')

    expect(rowsOf($, 'workflow-task').slice(0, 3)).toEqual([
      [
        'Check eligibility',
        'Yes',
        'Accepted Information needed Cannot complete'
      ],
      ['Check land parcels', 'Yes', 'Accepted Not accepted'],
      ['Record site visit date', 'No', 'Date: Site visit date']
    ])
    expect(
      part($, 'workflow-task').first().find('.gpa-badge.gpa-badge-outline')
    ).toHaveLength(3)
  })

  test('says there are no tasks when the version defines no task groups', async () => {
    givenDefinition(
      withWorkflow({
        phases: woodlandDefinition.workflow.phases.map((phase) => ({
          ...phase,
          stages: phase.stages.map((stage) => ({ ...stage, taskGroups: [] }))
        }))
      })
    )
    const { $ } = await viewTab('tasks')

    expect(part($, 'workflow-tasks')).toHaveLength(0)
    expect(textOf($, 'workflow-tasks-none')).toBe(
      'No tasks This workflow version defines no task groups, so caseworkers have nothing to complete.'
    )
  })
})

describe('the workflow Pages tab', () => {
  test("says where the case banner's heading comes from, and who sees it", async () => {
    const { $ } = await viewTab('pages')
    const banner = part($, 'workflow-pages-banner')

    expect(spaced($, banner.find('.gpa-section-head'))).toBe(
      'Case banner Shown to caseworkers with ReadWrite and the workflow’s roles.'
    )
    expect(flatten(banner.find('dt').text())).toBe('Heading from')
    expect(banner.find('dd').hasClass('gpa-dd-id')).toBe(true)
    expect(flatten(banner.find('dd').text())).toBe(
      '$.payload.answers.businessName'
    )
  })

  test('says what each banner button calls, warning when its service has no usable URL', async () => {
    const { $ } = await viewTab('pages')
    const [name, calls] = part($, 'workflow-pages-button').find('td').toArray()

    expect(spaced($, name)).toBe('Recalculate payment')
    expect($(calls).find('.gpa-badge.gpa-mono').text()).toBe('POST')
    expect(spaced($, calls)).toBe(
      'POST /api/v1/calculate PAYMENT_CALC: no usable URL in CW on local (PAYMENT_CALC_URL unset or invalid)'
    )
    expect($(calls).find('.gpa-text-warning')).toHaveLength(1)
  })

  test('lists the summary rows with a count, and no Key column', async () => {
    const { $ } = await viewTab('pages')

    expect(
      flatten(
        part($, 'workflow-pages-summary').find('.gpa-badge').first().text()
      )
    ).toBe('4 rows')
    expect(headsOf($, 'workflow-pages-summary')).toEqual([
      'Label',
      'Value from',
      'Type'
    ])
    expect(rowsOf($, 'workflow-pages-summary-row')[3]).toEqual([
      'Submitted',
      '$.payload.submittedAt',
      'date (dd MMM yyyy)'
    ])
  })

  test('marks a calculated summary value, without its jsonata prefix', async () => {
    givenDefinition(
      withWorkflow({
        pages: {
          cases: {
            details: {
              banner: {
                summary: {
                  id: { label: 'ID', text: 'jsonata:$.a & $.b', type: 'string' }
                }
              }
            }
          }
        }
      })
    )
    const { $ } = await viewTab('pages')

    expect(rowsOf($, 'workflow-pages-summary-row')).toEqual([
      ['ID', '$.a & $.b calculated', 'string']
    ])
    expect(
      textOf($, 'workflow-pages-summary').startsWith('Summary 1 row')
    ).toBe(true)
  })

  test('lists the case tabs in order, with when each shows, what it calls and its components', async () => {
    const { $ } = await viewTab('pages')

    expect(headsOf($, 'workflow-pages-tabs')).toEqual([
      'Order',
      'Tab',
      'Shown when',
      'Calls when opened',
      'Components'
    ])
    expect(rowsOf($, 'workflow-pages-tab')).toEqual([
      ['1', 'Tasks built in', 'Always', '—', '—'],
      ['2', 'Application built in', 'Always', '—', '1 component summary-list'],
      [
        '3',
        'Land',
        'Always',
        'GET https://land-data.example/api/v2/parcels/{sbi} LAND_DATA',
        '1 component table'
      ],
      ['4', 'Timeline built in', 'Always', '—', '—'],
      ['5', 'Notes built in', 'Always', '—', '—'],
      [
        '6',
        'Agreement',
        '$.supplementaryData.agreements is set',
        '—',
        '1 component table'
      ]
    ])
  })

  test('names the components in a tooltip that takes focus', async () => {
    const { $ } = await viewTab('pages')
    const tooltip = part($, 'workflow-pages-tab').eq(2).find('gpa-tooltip')

    expect(tooltip.attr('text')).toBe('table')
    expect(tooltip.find('[tabindex="0"]')).toHaveLength(1)
  })

  test('says a tab calls an action that is not defined, or one with no endpoint, and where its link goes', async () => {
    givenDefinition(
      withWorkflow({
        externalActions: [
          {
            code: 'BARE',
            name: 'Bare action',
            display: false,
            endpoint: 'nowhere',
            target: null
          }
        ],
        pages: {
          cases: {
            details: {
              tabs: {
                land: {
                  link: {
                    text: 'Land',
                    index: 2,
                    href: { urlTemplate: '/cases/{caseId}/land' }
                  },
                  action: { a: 'FETCH_LAND_PARCELS', b: 'BARE' }
                }
              }
            }
          }
        }
      })
    )
    const { $ } = await viewTab('pages')
    const land = part($, 'workflow-pages-tab').eq(2)

    expect(spaced($, land.find('td').eq(1))).toBe(
      'Land link goes to /cases/{caseId}/land'
    )
    expect(spaced($, land.find('td').eq(3))).toBe(
      'FETCH_LAND_PARCELS Not defined No endpoint'
    )
    expect(land.find('code').text()).toBe('FETCH_LAND_PARCELS')
    expect(land.find('.gpa-badge-danger').text()).toBe('Not defined')
  })

  test('says when the banner has no buttons and no summary', async () => {
    givenDefinition(withWorkflow({ pages: { cases: { details: {} } } }, []))
    const { $ } = await viewTab('pages')

    expect(part($, 'workflow-pages-button')).toHaveLength(0)
    expect(spaced($, part($, 'workflow-pages-banner'))).toContain(
      'No buttons CW shows no action buttons in this workflow’s case banner.'
    )
    expect(textOf($, 'workflow-pages-summary')).toContain(
      'No summary rows The case banner shows no summary.'
    )
  })
})

describe('the workflow Integrations tab', () => {
  test('draws a framed accordion of actions, by name, the first open, several may be', async () => {
    const { $ } = await viewTab('integrations')
    const items = part($, 'workflow-integration')

    expect(
      part($, 'workflow-integrations').hasClass('gpa-accordion-framed')
    ).toBe(true)
    expect(
      part($, 'workflow-integrations')
        .closest('gpa-accordion')
        .is('[data-single]')
    ).toBe(false)
    expect(
      items
        .find('.gpa-accordion-title')
        .toArray()
        .map((title) => $(title).text())
    ).toEqual(['Recalculate payment', 'Refresh land parcels'])
    expect(items.toArray().map((item) => $(item).is('[open]'))).toEqual([
      true,
      false
    ])
  })

  test('says what triggers each action, what it calls and what it writes', async () => {
    const { $ } = await viewTab('integrations')
    const [first, second] = part($, 'workflow-integration').toArray()
    const facts = (item: typeof first) =>
      $(item)
        .find('dd')
        .toArray()
        .map((value) => spaced($, value))

    expect(
      flatten(
        $(first)
          .find('.gpa-accordion-panel > .gpa-stack > .gpa-text-default')
          .first()
          .text()
      )
    ).toBe('Ask the land service for a new payment figure.')
    expect(facts(first)).toEqual([
      'Caseworker presses Recalculate payment in the case banner',
      'POST /api/v1/calculate PAYMENT_CALC: no usable URL in CW on local (PAYMENT_CALC_URL unset or invalid), endpoint recalculate',
      'Writes to supplementaryData.payment: object with no key, which CW refuses to write Adds a timeline entry'
    ])
    expect(facts(second)).toEqual([
      'Every time a caseworker opens the Land tab.',
      'GET https://land-data.example/api/v2/parcels/{sbi} LAND_DATA, endpoint land-parcels',
      'Nothing stored. The result is shown on the Land tab as actionData.parcels.'
    ])
  })

  test('lists what an action sends, each by where its value comes from', async () => {
    const { $ } = await viewTab('integrations')

    expect(rowsOf($, 'workflow-integration-send')).toEqual([
      ['PATH', 'sbi', '$.payload.identifiers.sbi from case']
    ])
  })

  test('marks an action with a problem, says it, and marks one only the API runs', async () => {
    givenDefinition(
      withWorkflow({
        pages: { cases: { details: {} } },
        externalActions: [
          {
            code: 'BROKEN',
            name: 'Broken action',
            display: false,
            endpoint: { code: 'nowhere' },
            target: null
          }
        ]
      })
    )
    const { $ } = await viewTab('integrations')
    const item = part($, 'workflow-integration')

    expect(
      item.find('.gpa-accordion-leading .gpa-mark-warning').attr('title')
    ).toBe('Has a problem')
    expect(textOf($, 'workflow-integration-problem')).toBe(
      'Endpoint nowhere not defined'
    )
    expect(flatten(item.find('.gpa-accordion-meta').text())).toBe('API only')
    expect(flatten(item.find('dd').first().text())).toBe(
      'No button or tab runs this in the case view. CW’s page-action API can still run it.'
    )
  })

  test('shows a computed value behind Show expression, and names the headers CW adds', async () => {
    givenDefinition(
      withWorkflow({
        externalActions: [
          {
            code: 'REFRESH_PARCELS',
            name: 'Refresh land parcels',
            display: false,
            endpoint: {
              code: 'land-parcels',
              endpointParams: {
                BODY: { parcels: 'jsonata:$map($.payload.parcels, $string)' },
                HEADERS: { 'x-api-version': '2' }
              }
            },
            target: null
          }
        ]
      })
    )
    const { $ } = await viewTab('integrations')
    const [computed, header] = part($, 'workflow-integration-send').toArray()

    expect($(computed).find('.gpa-badge-info').text()).toBe('computed')
    expect($(computed).find('gpa-disclosure').attr('data-show')).toBe(
      'Show expression'
    )
    expect($(computed).find('gpa-disclosure').attr('data-hide')).toBe(
      'Hide expression'
    )
    expect(
      $(computed).find('.gpa-code.gpa-code-framed.gpa-code-plain').text().trim()
    ).toBe('jsonata:$map($.payload.parcels, $string)')
    expect(spaced($, header)).toBe('HEADER x-api-version "2" fixed')
    expect(
      flatten(part($, 'workflow-integration').find('.gpa-text-muted').text())
    ).toBe('Headers set in CW’s LAND_DATA_HEADERS replace same-named ones.')
  })

  test('says there are no integrations when the version defines no external actions', async () => {
    givenDefinition(withWorkflow({ externalActions: [] }))
    const { $ } = await viewTab('integrations')

    expect(part($, 'workflow-integrations')).toHaveLength(0)
    expect(textOf($, 'workflow-integrations-none')).toBe(
      'No integrations This workflow version defines no actions that call another service.'
    )
  })
})
