import { render } from '../../../test-utils.ts'
import type { WorkflowDefinition } from '../../../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../../../use-cases/test-fixtures.ts'
import { toWorkflowPagesTab } from '../../../view-models/workflow-pages-tab.ts'

const testId = 'workflow-pages'
const integrationsHref =
  '/dev-ops/workflows/woodland-creation/1.2.0?tab=integrations&back=%2Fdev-ops%2Fworkflows'

const renderTab = (definition: WorkflowDefinition = woodlandDefinition) =>
  render('workflow-pages', {
    tab: toWorkflowPagesTab(definition, integrationsHref),
    environment: 'dev',
    testId
  })

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = (name: string, definition?: WorkflowDefinition) =>
  renderTab(definition)(`[data-testid="${testId}-${name}"]`)

const withWorkflow = (
  workflow: Partial<WorkflowDefinition['workflow']>
): WorkflowDefinition => ({
  workflow: { ...woodlandDefinition.workflow, ...workflow },
  addresses: woodlandDefinition.addresses
})

describe('workflow-pages component', () => {
  test("says where a tab's link goes when the workflow sets it", () => {
    const workflow = structuredClone(woodlandDefinition.workflow)
    const tab = workflow.pages!.cases!.details!.tabs!['land-parcels']

    tab.link = {
      ...tab.link,
      href: { urlTemplate: '/cases/{caseId}/notes?x=1' }
    }

    const $ = renderTab(withWorkflow(workflow))

    expect(flatten($('#tab-land-parcels').text())).toBe(
      '3 Land link goes to /cases/{caseId}/notes Always Refresh land parcels GET https://land-data.example/api/v2/parcels/{sbi} LAND_DATA every time the tab opens · result not stored 1 component'
    )
  })

  test('anchors the banner and every case tab', () => {
    const $ = renderTab()

    expect($('#banner')).toHaveLength(1)
    expect($('#tab-land-parcels')).toHaveLength(1)
    expect($('#tab-tasks')).toHaveLength(1)
  })

  test('shows the banner title path and each button by name, linked to its Integrations card, with the endpoint it calls', () => {
    expect(flatten(part('title').text())).toBe('$.payload.answers.businessName')
    expect(part('title').find('span').attr('class')).toContain('font-mono')

    const $button = part('button')

    expect($button).toHaveLength(1)
    expect($button.children('a').text()).toBe('Recalculate payment')
    expect($button.children('a').attr('href')).toBe(
      `${integrationsHref}#action-RECALCULATE`
    )
    expect($button.children('a').attr('class')).toBe('link')
    expect(flatten($button.text())).toBe(
      'Recalculate payment POST /api/v1/calculate PAYMENT_CALC · no usable URL in CW on dev (PAYMENT_CALC_URL unset or invalid)'
    )
    expect(flatten(part('buttons-who').text())).toBe(
      "Shown to caseworkers with ReadWrite and the workflow's roles."
    )
  })

  test('lists the summary fields with their value paths and types', () => {
    const $ = renderTab()

    expect(
      $(`[data-testid="${testId}-summary-row"]`)
        .toArray()
        .map((row) =>
          $(row)
            .find('td')
            .toArray()
            .map((cell) => $(cell).text())
        )
    ).toEqual([
      ['sbi', 'SBI', '$.payload.identifiers.sbi', 'string'],
      ['reference', 'Reference', '$.caseRef', 'string'],
      ['hectares', 'Area (ha)', '$.payload.answers.hectares', 'number'],
      ['submitted', 'Submitted', '$.payload.submittedAt', 'date (dd MMM yyyy)']
    ])
  })

  test('fits the summary table to the card, in fixed columns, with each label in the table text size', () => {
    const $ = renderTab()
    const table = $(`[data-testid="${testId}-summary"]`)

    expect(table.attr('class')).toContain('table-fixed')
    expect(table.attr('class')).toContain('w-full')
    expect(table.find('col')).toHaveLength(4)
    expect(
      $(`[data-testid="${testId}-summary-row"]`)
        .first()
        .find('td')
        .eq(1)
        .attr('class')
    ).toBe('text-sm')
  })

  test('says a jsonata: value is calculated, without its prefix, and shows any other path as stored', () => {
    const definition = withWorkflow({
      pages: {
        cases: {
          details: {
            banner: {
              title: { text: 'jsonata:$.payload.answers.name', type: 'string' },
              summary: {
                applicationId: {
                  label: 'Application',
                  text: 'jsonata:($task := $.tasks[0]; $task.id)',
                  type: 'string'
                },
                sbi: {
                  label: 'SBI',
                  text: '$.payload.identifiers.sbi',
                  type: 'string'
                }
              }
            }
          }
        }
      }
    })
    const $ = renderTab(definition)
    const cells = $(`[data-testid="${testId}-summary-row"]`)
      .toArray()
      .map((row) => flatten($(row).find('td').eq(2).text()))

    expect(cells).toEqual([
      '($task := $.tasks[0]; $task.id) calculated',
      '$.payload.identifiers.sbi'
    ])
    expect(flatten(part('title', definition).text())).toBe(
      '$.payload.answers.name calculated'
    )
    expect($.text()).not.toContain('jsonata:')
  })

  test('draws no summary table when the banner has no fields', () => {
    const definition = withWorkflow({
      pages: { cases: { details: { banner: { title: { type: 'string' } } } } }
    })

    expect(part('summary', definition)).toHaveLength(0)
    expect(flatten(part('title', definition).text())).toBe('—')
    expect(flatten(part('buttons', definition).text())).toContain(
      'Recalculate payment'
    )
  })

  test('marks no buttons with a dash', () => {
    const definition = withWorkflow({ externalActions: [] })

    expect(
      flatten(part('buttons', definition).children('span').first().text())
    ).toBe('—')
    expect(part('buttons-who', definition)).toHaveLength(0)
  })

  test('lists the case tabs in order, with when each shows, what it fires and its components', () => {
    const $ = renderTab()

    expect(
      part('tab-row')
        .toArray()
        .map((row) => flatten($(row).text()))
    ).toEqual([
      '1 Tasks built in Always — —',
      '2 Application built in Always — 1 component',
      '3 Land Always Refresh land parcels GET https://land-data.example/api/v2/parcels/{sbi} LAND_DATA every time the tab opens · result not stored 1 component',
      '4 Timeline built in Always — —',
      '5 Notes built in Always — —',
      '6 Agreement when $.supplementaryData.agreements is set and not null, false, 0 or "" (an empty list or object counts as set) — 1 component'
    ])
    expect(
      $('#tab-land-parcels [data-testid="workflow-pages-built-in"]')
    ).toHaveLength(0)
    expect(
      $('#tab-tasks [data-testid="workflow-pages-built-in"]')
    ).toHaveLength(1)
  })

  test('says a jsonata: tab condition is calculated, without its prefix, and when CW shows the tab', () => {
    const workflow = structuredClone(woodlandDefinition.workflow)
    workflow.pages!.cases!.details!.tabs!['land-parcels'].renderIf =
      'jsonata:$count($.supplementaryData.parcels) > 0'
    const $ = renderTab(withWorkflow(workflow))
    const cell = $(
      '#tab-land-parcels [data-testid="workflow-pages-shown-when"]'
    )

    expect(flatten(cell.text())).toBe(
      'when $count($.supplementaryData.parcels) > 0 calculated gives a result that is not null, false, 0 or "" (an empty list or object counts as a result)'
    )
    expect(cell.find('[data-comes-from]').text()).toBe('calculated')
    expect($.text()).not.toContain('jsonata:')
  })

  test('lets a long Value from path wrap only after a dot', () => {
    const definition = withWorkflow({
      pages: {
        cases: {
          details: {
            banner: {
              summary: {
                hectares: {
                  label: 'Hectares',
                  text: '$.payload.answers.landUse.totalHectares',
                  type: 'number'
                }
              }
            }
          }
        }
      }
    })
    const $ = renderTab(definition)

    expect(
      $(`[data-testid="${testId}-summary-row"] td`).eq(2).find('span').html()
    ).toBe('$.<wbr>payload.<wbr>answers.<wbr>landUse.<wbr>totalHectares')
  })

  test('writes paths in mono through the code break, and Always in sans', () => {
    const $ = renderTab()

    expect(
      $('[data-testid="workflow-pages-shown-when"] .font-mono').first().text()
    ).toBe('$.supplementaryData.agreements')
    expect(
      $('#tab-land-parcels [data-testid="workflow-pages-shown-when"] span')
    ).toHaveLength(0)
    expect(
      $('#tab-tasks [data-testid="workflow-pages-built-in"]').attr('class')
    ).toBe('badge badge-ghost badge-sm ml-1.5')
  })

  test('counts components, listing them in a title', () => {
    const definition = withWorkflow({
      pages: {
        cases: {
          details: {
            tabs: { land: { content: [{ component: 'table' }, {}] } }
          }
        }
      }
    })
    const $count = renderTab(definition)(
      '#tab-land [data-testid="workflow-pages-components"] span'
    )

    expect($count.text()).toBe('2 components')
    expect($count.attr('title')).toBe('table, text')
  })

  test('heads the banner Heading from, Buttons and Summary', () => {
    const $ = renderTab()

    expect(
      $('#banner dt')
        .toArray()
        .map((dt) => $(dt).text())
    ).toEqual(['Heading from', 'Buttons', 'Summary'])
  })

  test('warns of an action that is not defined, and of one with no endpoint', () => {
    const definition = withWorkflow({
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
          details: { tabs: { land: { action: { a: 'MISSING', b: 'BARE' } } } }
        }
      }
    })
    const $actions = part('action', definition)

    expect(flatten($actions.eq(0).text())).toBe('MISSING Not defined')
    expect(flatten($actions.eq(1).text())).toBe('Bare action No endpoint')
    expect($actions.eq(0).find('a')).toHaveLength(0)
    expect($actions.eq(1).children('a').attr('href')).toBe(
      `${integrationsHref}#action-BARE`
    )
    expect(
      $actions.eq(1).find('[data-testid="do-status-dot"]').attr('class')
    ).toContain('status-warning')
  })
})
