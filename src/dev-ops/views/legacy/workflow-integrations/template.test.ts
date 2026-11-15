import { load } from 'cheerio'
import type { Cheerio } from 'cheerio'
import type { AnyNode } from 'domhandler'

import { render } from '../../../test-utils.ts'
import type {
  StoredExternalAction,
  WorkflowDefinition
} from '../../../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../../../use-cases/test-fixtures.ts'
import { toWorkflowIntegrations } from '../../../view-models/workflow-integrations.ts'

const testId = 'workflow-integrations'
const pagesHref =
  '/dev-ops/workflows/woodland-creation/1.2.0?tab=pages&back=%2Fdev-ops%2Fworkflows'

const renderTab = (definition: WorkflowDefinition = woodlandDefinition) =>
  render('workflow-integrations', {
    integrations: toWorkflowIntegrations(definition, pagesHref),
    environment: 'dev',
    testId
  })

const withWorkflow = (
  workflow: Partial<WorkflowDefinition['workflow']>
): WorkflowDefinition => ({
  workflow: { ...woodlandDefinition.workflow, ...workflow },
  addresses: woodlandDefinition.addresses
})

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const words = ($element: Cheerio<AnyNode>) =>
  flatten(load(($element.html() ?? '').replaceAll(/<(?!wbr)/g, ' <')).text())

const stepTexts = ($: ReturnType<typeof renderTab>, card: number) =>
  ['trigger', 'call', 'sends', 'writes'].map((step) =>
    words(
      $(`[data-testid="${testId}"]`)
        .eq(card)
        .find(`[data-testid="${testId}-${step}"]`)
    )
  )

/** QA_PING from the qa-complex workflow 1.1.0: path and header params, appended to a list. */
const qaPing: StoredExternalAction = {
  code: 'QA_PING',
  name: 'Ping the health service',
  display: true,
  endpoint: {
    code: 'recalculate',
    endpointParams: {
      PATH: { probe: 'health' },
      HEADERS: { 'x-qa-case': '$.caseRef' },
      BODY: { year: 'jsonata:$substring($.createdAt, 0, 4)' }
    }
  },
  target: {
    targetNode: 'qaPings',
    dataType: 'ARRAY',
    position: null,
    place: 'append'
  }
}

describe('workflow-integrations component', () => {
  test('shows one card per external action, anchored by its code, titled by name then code muted', () => {
    const $ = renderTab()
    const $cards = $(`[data-testid="${testId}"]`)

    expect($cards.toArray().map((card) => $(card).attr('id'))).toEqual([
      'action-RECALCULATE',
      'action-REFRESH_PARCELS'
    ])
    expect($cards.eq(0).attr('class')).toContain('scroll-mt-4')
    expect(flatten($cards.eq(0).find('h2').text())).toBe(
      'Recalculate payment RECALCULATE'
    )
    expect($cards.eq(0).find('h2 [data-name]').text()).toBe(
      'Recalculate payment'
    )
    expect($cards.eq(0).find('h2').attr('class')).toContain('flex-wrap')
    expect($cards.eq(0).find('p').text()).toBe(
      'Ask the land service for a new payment figure.'
    )
    expect($cards.eq(1).find('p')).toHaveLength(0)
  })

  test('labels each card by its title', () => {
    const $ = renderTab()

    expect(
      $(`[data-testid="${testId}"]`)
        .toArray()
        .map((card) => $(`#${$(card).attr('aria-labelledby')}`).text())
        .map(flatten)
    ).toEqual([
      'Recalculate payment RECALCULATE',
      'Refresh land parcels REFRESH_PARCELS'
    ])
  })

  test('reads each action from who triggers it, through its call and what it sends, to what it writes', () => {
    const $ = renderTab()

    expect(stepTexts($, 0)).toEqual([
      'Trigger Caseworker presses Recalculate payment in the case banner',
      'Calls POST /api/v1/calculate PAYMENT_CALC · no usable URL in CW on dev ( PAYMENT_CALC_URL unset or invalid) recalculate',
      'Sends —',
      'Writes Writes to supplementaryData.payment : object with no key, which CW refuses to write Adds a timeline entry'
    ])
    expect(stepTexts($, 1)).toEqual([
      'Trigger Every time a caseworker opens the Land tab',
      'Calls GET https://land-data.example/api/v2/parcels/{sbi} LAND_DATA land-parcels',
      'Sends PATH sbi ← $.payload.identifiers.sbi from case',
      'Writes Nothing stored. The result is shown on the Land tab as actionData.parcels .'
    ])
  })

  test.each([
    [
      '/cases/{caseId}/notes',
      'Trigger Every time a caseworker opens the Land tab. Its link in the case view goes to /cases/{caseId}/notes .'
    ],
    [
      '$.supplementaryData.landUrl',
      'Trigger Every time a caseworker opens the Land tab. Its link in the case view goes to an address worked out from the case.'
    ]
  ])(
    "says where a tab's link goes when the workflow sets it to %s",
    (urlTemplate, text) => {
      const workflow = structuredClone(woodlandDefinition.workflow)
      const tab = workflow.pages!.cases!.details!.tabs!['land-parcels']

      tab.link = { ...tab.link, href: { urlTemplate } }

      expect(stepTexts(renderTab(withWorkflow(workflow)), 1)[0]).toBe(text)
    }
  )

  test('links each trigger back to the Pages tab', () => {
    const $ = renderTab()

    expect(
      $(`[data-testid="${testId}-trigger"] a`)
        .toArray()
        .map((link) => [$(link).text(), $(link).attr('href')])
    ).toEqual([
      ['Recalculate payment', `${pagesHref}#banner`],
      ['Land', `${pagesHref}#tab-land-parcels`]
    ])
  })

  test('labels each parameter by where its value comes from, quoting a fixed one and folding a computed one away', () => {
    const $ = renderTab(withWorkflow({ externalActions: [qaPing] }))
    const sends = $(`[data-testid="${testId}-send"]`)
      .toArray()
      .map((send) => words($(send)))

    expect(sends).toEqual([
      'PATH probe ← "health" fixed',
      'HEADER x-qa-case ← $.caseRef from case',
      'BODY year ← computed Show expression jsonata:$substring($.createdAt, 0, 4)'
    ])
    expect($(`[data-testid="${testId}-expression"]`).is('details')).toBe(true)
    expect(
      $(`[data-testid="${testId}-expression"] pre`).attr('class')
    ).toContain('whitespace-pre-wrap')
  })

  test("says configured headers replace an action's own, only when it sends headers", () => {
    const $ = renderTab(withWorkflow({ externalActions: [qaPing] }))

    expect(words($(`[data-testid="${testId}-headers-note"]`))).toBe(
      "Headers set in CW's PAYMENT_CALC_HEADERS replace same-named ones."
    )
    expect(renderTab()(`[data-testid="${testId}-headers-note"]`)).toHaveLength(
      0
    )
  })

  test('says how a target keeps the answer, and when it is written', () => {
    const keyed = (
      dataType: 'ARRAY' | 'OBJECT',
      key?: string
    ): StoredExternalAction => ({
      ...qaPing,
      code: `${dataType}-${key}`,
      display: false,
      endpoint: { code: 'recalculate' },
      target: { ...qaPing.target!, dataType, key }
    })
    const $ = renderTab(
      withWorkflow({
        externalActions: [
          qaPing,
          keyed('ARRAY', 'message'),
          keyed('OBJECT', 'message')
        ]
      })
    )

    expect(
      $(`[data-testid="${testId}-write"]`)
        .toArray()
        .map((write) => words($(write)))
    ).toEqual([
      'Appends to supplementaryData.qaPings (list)',
      'Adds a timeline entry',
      'Writes to supplementaryData.qaPings when run : list, replaces the item with the same message , else appends',
      'Writes to supplementaryData.qaPings when run : object, keyed by message'
    ])
  })

  test('prefixes each write by its trigger for an action both a button and a tab runs', () => {
    const $ = renderTab(
      withWorkflow({
        externalActions: [qaPing],
        pages: {
          cases: {
            details: {
              banner: {},
              tabs: {
                pings: {
                  link: { text: 'Ping history' },
                  action: { ping: 'QA_PING' }
                }
              }
            }
          }
        }
      })
    )

    expect(
      $(`[data-testid="${testId}-write"]`)
        .toArray()
        .map((write) => flatten($(write).text()))
    ).toEqual([
      'When pressed: appends to supplementaryData.qaPings (list) · adds a timeline entry',
      'When a tab opens: nothing stored; shown as actionData.ping'
    ])
  })

  test('says CW can still run an action no button or tab runs, with no warning', () => {
    const $ = renderTab(
      withWorkflow({
        externalActions: [
          { ...qaPing, display: false, endpoint: { code: 'recalculate' } }
        ]
      })
    )

    expect(flatten($(`[data-testid="${testId}-api-only"]`).text())).toBe(
      "No button or tab runs this in the case view. CW's page-action API can still run it."
    )
    expect($(`[data-testid="${testId}-problems"]`)).toHaveLength(0)
  })

  test('shows an empty fixed value as two quotes', () => {
    const $ = renderTab(
      withWorkflow({
        externalActions: [
          {
            code: 'A',
            name: 'A',
            display: true,
            endpoint: {
              code: 'recalculate',
              endpointParams: { BODY: { x: '' } }
            },
            target: null
          }
        ]
      })
    )

    expect(words($(`[data-testid="${testId}-send"]`))).toBe('BODY x ← "" fixed')
  })

  test('warns of an endpoint that is not defined', () => {
    const $ = renderTab(
      withWorkflow({
        externalActions: [
          {
            code: 'LOST',
            name: 'Lost',
            display: false,
            endpoint: { code: 'nope' },
            target: null
          },
          ...(woodlandDefinition.workflow.externalActions ?? [])
        ]
      })
    )
    const $problems = $(`[data-testid="${testId}-problems"]`)

    expect($problems).toHaveLength(1)
    expect($problems.attr('class')).toBe(
      'alert alert-warning alert-soft text-sm'
    )
    expect(flatten($problems.text())).toBe('Endpoint nope not defined')
    expect(flatten($('#action-LOST [data-testid$="-call"]').text())).toBe(
      'Calls —'
    )
  })

  test('gives no anchor to a later action with a used code, and says it never runs', () => {
    const [first] = woodlandDefinition.workflow.externalActions ?? []
    const $ = renderTab(
      withWorkflow({ externalActions: [first, { ...first }] })
    )

    expect($('[id="action-RECALCULATE"]')).toHaveLength(1)
    expect($(`[data-testid="${testId}"]`).eq(1).attr('id')).toBeUndefined()
    expect(flatten($(`[data-testid="${testId}-problems"]`).text())).toBe(
      'CW runs only the first action with code RECALCULATE, so this one never runs'
    )
  })

  test('stacks the steps at phone width, in uneven columns from lg up, top-aligned', () => {
    const $ = renderTab()

    expect($(`[data-testid="${testId}-steps"]`).first().attr('class')).toBe(
      'grid grid-cols-1 items-start gap-2 lg:grid-cols-[1fr_1.4fr_2fr_1.4fr]'
    )
    expect(
      $(`[data-testid="${testId}-trigger"]`).first().attr('class')
    ).toContain('border-base-300')
  })

  test('lists the endpoints used by nothing last, only when there are some', () => {
    expect(renderTab()(`[data-testid="${testId}-unused"]`)).toHaveLength(0)

    const $ = renderTab(
      withWorkflow({
        externalActions: woodlandDefinition.workflow.externalActions?.slice(
          0,
          1
        )
      })
    )
    const $unused = $(`[data-testid="${testId}-unused"]`)

    expect($unused.find('h2').text()).toBe('Endpoints used by nothing')
    expect(
      $unused
        .find('thead th')
        .toArray()
        .map((th) => $(th).text())
    ).toEqual(['Code', 'Calls'])
    expect(
      $unused
        .find('tbody td')
        .toArray()
        .map((td) => words($(td)))
    ).toEqual([
      'land-parcels',
      'GET https://land-data.example/api/v2/parcels/{sbi} LAND_DATA'
    ])
    expect($unused.prevAll(`[data-testid="${testId}"]`)).toHaveLength(1)
  })

  test('says there are no external actions, then lists every endpoint as used by nothing', () => {
    const $ = renderTab(withWorkflow({ externalActions: [] }))

    expect(flatten($(`[data-testid="${testId}-empty"]`).text())).toBe(
      'No integrations (external actions) in this version.'
    )
    expect($(`[data-testid="${testId}-unused"] tbody tr`)).toHaveLength(2)
  })

  test('says only that there are no external actions when there are no endpoints either', () => {
    const $ = renderTab({ workflow: { phases: [] }, addresses: [] })

    expect($(`[data-testid="${testId}-empty"]`)).toHaveLength(1)
    expect($(`[data-testid="${testId}-unused"]`)).toHaveLength(0)
  })
})
