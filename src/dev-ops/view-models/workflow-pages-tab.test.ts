import type { WorkflowDefinition } from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../use-cases/test-fixtures.ts'
import { toWorkflowPagesTab } from './workflow-pages-tab.ts'

const withWorkflow = (
  workflow: Omit<WorkflowDefinition['workflow'], 'phases'>
): WorkflowDefinition => ({
  workflow: { phases: [], ...workflow },
  addresses: []
})

const woodland = toWorkflowPagesTab(woodlandDefinition)

describe('toWorkflowPagesTab', () => {
  test('says what CW calls for each button and each action a tab fires', () => {
    expect(woodland.banner.buttons).toEqual([
      {
        name: 'Recalculate payment',
        call: {
          kind: 'call',
          method: 'POST',
          url: '/api/v1/calculate',
          service: 'PAYMENT_CALC',
          hasUrl: false
        }
      }
    ])
    expect(woodland.tabs.find(({ label }) => label === 'Land')?.calls).toEqual([
      {
        kind: 'call',
        method: 'GET',
        url: 'https://land-data.example/api/v2/parcels/{sbi}',
        service: 'LAND_DATA',
        hasUrl: true
      }
    ])
  })

  test('keeps each shown action when two share a code', () => {
    const [action] = woodlandDefinition.workflow.externalActions ?? []

    const tab = toWorkflowPagesTab({
      ...woodlandDefinition,
      workflow: {
        ...woodlandDefinition.workflow,
        externalActions: [
          { ...action, display: true },
          { ...action, name: 'Recalculate again', display: true }
        ]
      }
    })

    expect(tab.banner.buttons.map(({ name }) => name)).toEqual([
      'Recalculate payment',
      'Recalculate again'
    ])
  })

  test('says a tab calls an action that is not defined, or one with no endpoint', () => {
    const tab = toWorkflowPagesTab(
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
                  link: { text: 'Land', index: 2 },
                  action: { a: 'MISSING', b: 'BARE' }
                }
              }
            }
          }
        }
      })
    )

    expect(tab.tabs.find(({ label }) => label === 'Land')?.calls).toEqual([
      { kind: 'not-defined', code: 'MISSING' },
      { kind: 'no-endpoint' }
    ])
  })

  test('reads the banner heading and summary fields in key order', () => {
    expect(woodland.banner.heading).toEqual({
      text: '$.payload.answers.businessName',
      calculated: false
    })
    expect(woodland.banner.summary).toEqual([
      {
        label: 'SBI',
        valueFrom: { text: '$.payload.identifiers.sbi', calculated: false },
        type: 'string'
      },
      {
        label: 'Reference',
        valueFrom: { text: '$.caseRef', calculated: false },
        type: 'string'
      },
      {
        label: 'Area (ha)',
        valueFrom: { text: '$.payload.answers.hectares', calculated: false },
        type: 'number'
      },
      {
        label: 'Submitted',
        valueFrom: { text: '$.payload.submittedAt', calculated: false },
        type: 'date (dd MMM yyyy)'
      }
    ])
  })

  test('tells a stored empty path from one that is not there', () => {
    const tab = toWorkflowPagesTab(
      withWorkflow({
        pages: {
          cases: {
            details: {
              banner: {
                title: { text: '', type: 'string' },
                summary: { sbi: { label: 'SBI', type: 'string' } }
              }
            }
          }
        }
      })
    )

    expect(tab.banner.heading).toEqual({ text: '""', calculated: false })
    expect(tab.banner.summary[0].valueFrom).toBeNull()
  })

  test('marks a jsonata: path as calculated, without its prefix', () => {
    const tab = toWorkflowPagesTab(
      withWorkflow({
        pages: {
          cases: {
            details: {
              banner: {
                summary: {
                  id: {
                    label: 'ID',
                    text: 'jsonata:$.a & $.b',
                    type: 'string'
                  },
                  both: { label: 'Both', text: '$.a $.b', type: 'string' }
                }
              }
            }
          }
        }
      })
    )

    expect(tab.banner.summary.map(({ valueFrom }) => valueFrom)).toEqual([
      { text: '$.a & $.b', calculated: true },
      { text: '$.a $.b', calculated: false }
    ])
  })

  test('has no heading, buttons or fields without a banner', () => {
    const tab = toWorkflowPagesTab(
      withWorkflow({
        externalActions: woodlandDefinition.workflow.externalActions
      })
    )

    expect(tab.banner).toEqual({ heading: null, buttons: [], summary: [] })
  })

  test('numbers the case tabs from one, with when each shows and where its link goes', () => {
    expect(
      woodland.tabs.map(({ order, label, builtIn, shownWhen, link }) => ({
        order,
        label,
        builtIn,
        shownWhen,
        link
      }))
    ).toEqual([
      { order: 1, label: 'Tasks', builtIn: true, shownWhen: null, link: null },
      {
        order: 2,
        label: 'Application',
        builtIn: true,
        shownWhen: null,
        link: null
      },
      { order: 3, label: 'Land', builtIn: false, shownWhen: null, link: null },
      {
        order: 4,
        label: 'Timeline',
        builtIn: true,
        shownWhen: null,
        link: null
      },
      { order: 5, label: 'Notes', builtIn: true, shownWhen: null, link: null },
      {
        order: 6,
        label: 'Agreement',
        builtIn: false,
        shownWhen: {
          text: '$.supplementaryData.agreements',
          calculated: false
        },
        link: null
      }
    ])
  })

  test('lists the components each tab draws', () => {
    expect(woodland.tabs.map(({ components }) => components)).toEqual([
      [],
      ['summary-list'],
      ['table'],
      [],
      [],
      ['table']
    ])
  })
})
