import type {
  StoredCaseTab,
  StoredEndpoint,
  StoredExternalAction,
  StoredWorkflow,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../use-cases/test-fixtures.ts'
import { toWorkflowIntegrations } from './workflow-integrations.ts'
import type { Words } from './words.ts'

// The tab never reads phases, so a fixture may leave them out.
type AnyWorkflow = Omit<StoredWorkflow, 'phases'> &
  Partial<Pick<StoredWorkflow, 'phases'>>

const action = (
  code: string,
  overrides: Partial<StoredExternalAction> = {}
): StoredExternalAction => ({
  code,
  name: `Action ${code}`,
  display: false,
  endpoint: { code: 'parcels' },
  target: null,
  ...overrides
})

const endpoint = (
  code: string,
  overrides: Partial<StoredEndpoint> = {}
): StoredEndpoint => ({
  code,
  service: 'LAND_DATA',
  path: '/parcels',
  method: 'GET',
  ...overrides
})

const parcels = endpoint('parcels')

const withBanner = (tabs: Record<string, StoredCaseTab> = {}) => ({
  cases: { details: { banner: {}, tabs } }
})

const definitionOf = (
  workflow: AnyWorkflow,
  urls: (string | null)[] = []
): WorkflowDefinition => ({
  workflow: { phases: [], ...workflow },
  addresses: (workflow.endpoints ?? []).map(({ code, service }, index) => ({
    code,
    service,
    url: urls[index] ?? null
  }))
})

const integrationsOf = (workflow: AnyWorkflow, urls: (string | null)[] = []) =>
  toWorkflowIntegrations(definitionOf(workflow, urls))

const cardOf = (workflow: AnyWorkflow, index = 0) =>
  integrationsOf(workflow).cards[index]

/** Every write's words, as one line each. */
const writesOf = ({ writes }: { writes: Words[] }) =>
  writes.map((line) =>
    line
      .map((word) =>
        typeof word === 'string'
          ? word
          : `\`${'code' in word ? word.code : ''}\``
      )
      .join('')
  )

describe('toWorkflowIntegrations', () => {
  test("shows the prototype's two actions, each from its trigger to what it writes", () => {
    const { cards } = toWorkflowIntegrations(woodlandDefinition)

    expect(cards.map(({ writes, ...card }) => card)).toEqual([
      {
        name: 'Recalculate payment',
        description: 'Ask the land service for a new payment figure.',
        problems: [],
        apiOnly: false,
        triggers: [
          { kind: 'button', label: 'Recalculate payment', customLink: null }
        ],
        call: {
          kind: 'call',
          method: 'POST',
          url: '/api/v1/calculate',
          service: 'PAYMENT_CALC',
          hasUrl: false,
          endpoint: 'recalculate'
        },
        sends: [],
        headersService: null
      },
      {
        name: 'Refresh land parcels',
        description: null,
        problems: [],
        apiOnly: false,
        triggers: [{ kind: 'tab', label: 'Land', customLink: null }],
        call: {
          kind: 'call',
          method: 'GET',
          url: 'https://land-data.example/api/v2/parcels/{sbi}',
          service: 'LAND_DATA',
          hasUrl: true,
          endpoint: 'land-parcels'
        },
        sends: [
          {
            kind: 'PATH',
            name: 'sbi',
            source: 'case',
            text: '$.payload.identifiers.sbi'
          }
        ],
        headersService: null
      }
    ])
    expect(cards.map(writesOf)).toEqual([
      [
        'Writes to `supplementaryData.payment`: object with no key, which CW refuses to write',
        'Adds a timeline entry'
      ],
      [
        'Nothing stored. The result is shown on the Land tab as `actionData.parcels`.'
      ]
    ])
  })
})

describe('toWorkflowIntegrations warns', () => {
  test('of an endpoint given as a string, which CW cannot call', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A', { endpoint: 'parcels' })],
      pages: withBanner({ land: { action: { a: 'A' } } })
    })

    expect(card.problems).toEqual(['Endpoint — not defined'])
    expect(card.call).toBeNull()
  })

  test('of an endpoint code no endpoint has', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A', { endpoint: { code: 'nope' } })],
      pages: withBanner({ land: { action: { a: 'A' } } })
    })

    expect(card.problems).toEqual(['Endpoint nope not defined'])
    expect(card.call).toBeNull()
  })

  test('of nothing for an action no button or tab runs, which CW can still run by code', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A')]
    })

    expect(card.problems).toEqual([])
    expect(card.apiOnly).toBe(true)
  })
})

describe('toWorkflowIntegrations triggers', () => {
  test('a shown action is a banner button only when the case page has a banner', () => {
    const shown = action('A', { display: true })

    expect(
      cardOf({ endpoints: [parcels], externalActions: [shown] }).triggers
    ).toEqual([])
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [shown],
        pages: withBanner()
      }).triggers
    ).toEqual([
      {
        kind: 'button',
        label: 'Action A',
        customLink: null
      }
    ])
  })

  test('a display that is not true is not a banner button', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [
          action('A', { display: 'true' as unknown as boolean })
        ],
        pages: withBanner()
      }).triggers
    ).toEqual([])
  })

  test.each(['tasks', 'notes', 'timeline'])(
    'an action map on the built-in %s tab never fires',
    (key) => {
      expect(
        cardOf({
          endpoints: [parcels],
          externalActions: [action('A')],
          pages: withBanner({ [key]: { action: { a: 'A' } } })
        }).triggers
      ).toEqual([])
    }
  )

  test('an action map on Application fires, labelled as CW labels the tab', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A')],
        pages: withBanner({ 'case-details': { action: { a: 'A' } } })
      }).triggers
    ).toEqual([
      {
        kind: 'tab',
        label: 'Application',
        customLink: null
      }
    ])
  })

  test("says where a tab's link goes when the workflow sets it", () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A')],
        pages: withBanner({
          land: {
            link: { href: { urlTemplate: '/cases/{caseId}/notes' } },
            action: { a: 'A' }
          }
        })
      }).triggers
    ).toEqual([
      {
        kind: 'tab',
        label: 'Land',
        customLink: { address: '/cases/{caseId}/notes' }
      }
    ])
  })

  test('a tab with no link text is labelled by its key, title-cased', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A')],
        pages: withBanner({ 'land-parcels': { action: { a: 'A' } } })
      }).triggers
    ).toEqual([
      {
        kind: 'tab',
        label: 'Land Parcels',
        customLink: null
      }
    ])
  })

  test('lists the banner, then each tab in case-tab order, with what each writes', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A', { display: true })],
      pages: withBanner({
        later: { link: { text: 'Later', index: 9 }, action: { late: 'A' } },
        sooner: { link: { text: 'Sooner', index: 2 }, action: { soon: 'A' } }
      })
    })

    expect(card.triggers.map(({ label }) => label)).toEqual([
      'Action A',
      'Sooner',
      'Later'
    ])
    expect(writesOf(card)).toEqual([
      'When pressed: adds a timeline entry',
      'When a tab opens: nothing stored. The result is shown on the Sooner tab as `actionData.soon`.',
      'When a tab opens: nothing stored. The result is shown on the Later tab as `actionData.late`.'
    ])
  })

  test('a tab that maps two keys to the action fires it twice, in map order', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A')],
      pages: withBanner({
        land: { link: { text: 'Land' }, action: { first: 'A', second: 'A' } }
      })
    })

    expect(card.triggers.map(({ label }) => label)).toEqual(['Land', 'Land'])
    expect(writesOf(card)).toEqual([
      'Nothing stored. The result is shown on the Land tab as `actionData.first`.',
      'Nothing stored. The result is shown on the Land tab as `actionData.second`.'
    ])
  })

  test('two tabs keeping the answer under one key are one write, naming both tabs', () => {
    const card = cardOf({
      endpoints: [parcels],
      externalActions: [action('A')],
      pages: withBanner({
        check: { link: { text: 'Service check' }, action: { ping: 'A' } },
        history: { link: { text: 'Ping history' }, action: { ping: 'A' } }
      })
    })

    expect(writesOf(card)).toEqual([
      'Nothing stored. The result is shown on the Service check and Ping history tabs as `actionData.ping`.'
    ])
  })
})

describe('toWorkflowIntegrations writes', () => {
  test('says which trigger writes what, for an action that is both a button and a tab action', () => {
    const integrations = toWorkflowIntegrations(
      definitionOf({
        pages: withBanner({
          pings: {
            link: { text: 'Ping history' },
            action: { ping: 'QA_PING' }
          }
        }),
        endpoints: [parcels],
        externalActions: [
          action('QA_PING', {
            display: true,
            target: {
              targetNode: 'qaPings',
              dataType: 'ARRAY',
              position: null,
              place: 'append'
            }
          })
        ]
      })
    )

    expect(writesOf(integrations.cards[0])).toEqual([
      'When pressed: appends to `supplementaryData.qaPings` (list)',
      'When pressed: adds a timeline entry',
      'When a tab opens: nothing stored. The result is shown on the Ping history tab as `actionData.ping`.'
    ])
  })

  test('the target, when run, for an action reached only from a tab', () => {
    expect(
      writesOf(
        cardOf({
          endpoints: [parcels],
          externalActions: [
            action('A', {
              target: {
                targetNode: 'parcels',
                dataType: 'ARRAY',
                position: null,
                place: 'append'
              }
            })
          ],
          pages: withBanner({ land: { action: { got: 'A' } } })
        })
      )
    ).toEqual([
      'Appends to `supplementaryData.parcels` (list) when run',
      'Nothing stored. The result is shown on the Land tab as `actionData.got`.'
    ])
  })

  test.each([
    ['ARRAY', undefined, 'Appends to `supplementaryData.qaPings` (list)'],
    [
      'ARRAY',
      'message',
      'Writes to `supplementaryData.qaPings`: list, replaces the item with the same `message`, else appends'
    ],
    [
      'OBJECT',
      'message',
      'Writes to `supplementaryData.qaPings`: object, keyed by `message`'
    ]
  ] as const)('a %s target keyed by %s: %s', (dataType, key, words) => {
    const [write] = writesOf(
      cardOf({
        endpoints: [parcels],
        externalActions: [
          action('A', {
            display: true,
            target: {
              targetNode: 'qaPings',
              dataType,
              key,
              position: null,
              place: 'append'
            }
          })
        ],
        pages: withBanner()
      })
    )

    expect(write).toBe(words)
  })

  test('only a timeline event for a banner button with no target', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A', { display: true })],
        pages: withBanner()
      }).writes
    ).toEqual([['Adds a timeline entry']])
  })

  test('a timeline entry for a shown action, whatever runs it', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [action('A', { display: true })]
      }).writes
    ).toEqual([['Adds a timeline entry']])
  })

  test('nothing for an action with no target, not shown, that no tab runs', () => {
    expect(
      writesOf(cardOf({ endpoints: [parcels], externalActions: [action('A')] }))
    ).toEqual([])
  })
})

describe('toWorkflowIntegrations sends', () => {
  test('path, body and header parameters in definition order, never other kinds, each by where its value comes from', () => {
    expect(
      cardOf({
        endpoints: [parcels],
        externalActions: [
          action('A', {
            endpoint: {
              code: 'parcels',
              endpointParams: {
                BODY: { reason: '', count: 3 },
                HEADERS: { 'x-api-key': '$.secret' },
                QUERY: { page: '1' },
                PATH: {
                  sbi: '$.payload.identifiers.sbi',
                  year: 'jsonata:$substring($.createdAt, 0, 4)'
                }
              }
            }
          })
        ]
      }).sends
    ).toEqual([
      { kind: 'BODY', name: 'reason', source: 'fixed', text: '""' },
      { kind: 'BODY', name: 'count', source: 'fixed', text: '3' },
      { kind: 'HEADER', name: 'x-api-key', source: 'case', text: '$.secret' },
      {
        kind: 'PATH',
        name: 'sbi',
        source: 'case',
        text: '$.payload.identifiers.sbi'
      },
      {
        kind: 'PATH',
        name: 'year',
        source: 'computed',
        text: 'jsonata:$substring($.createdAt, 0, 4)'
      }
    ])
  })

  test.each([
    ['$5', 'fixed', '"$5"'],
    ['\\$.caseRef', 'fixed', '"$.caseRef"'],
    ['Case $.caseRef', 'case', 'Case $.caseRef'],
    ['@.id', 'case', '@.id'],
    [{ ref: '$.caseRef', count: 1 }, 'case', '{"ref":"$.caseRef","count":1}'],
    [['a', 'b'], 'fixed', '["a","b"]']
  ])(
    "reads %j as CW's resolver does: %s, shown as %s",
    (value, source, text) => {
      expect(
        cardOf({
          endpoints: [parcels],
          externalActions: [
            action('A', {
              endpoint: {
                code: 'parcels',
                endpointParams: { BODY: { v: value } }
              }
            })
          ]
        }).sends
      ).toEqual([{ kind: 'BODY', name: 'v', source, text }])
    }
  )

  test("names the service whose configured headers replace the action's own, only when it sends any", () => {
    const sending = (endpointParams: Record<string, Record<string, unknown>>) =>
      cardOf({
        endpoints: [parcels],
        externalActions: [
          action('A', { endpoint: { code: 'parcels', endpointParams } })
        ]
      }).headersService

    expect(sending({ HEADERS: { 'x-qa-case': '$.caseRef' } })).toBe('LAND_DATA')
    expect(sending({ PATH: { probe: 'health' } })).toBeNull()
  })
})

describe('toWorkflowIntegrations duplicate codes', () => {
  test('only the first action with a code runs, so a later one has no trigger or writes', () => {
    const integrations = integrationsOf({
      endpoints: [parcels],
      externalActions: [
        action('A', { display: true }),
        action('A', { display: true })
      ],
      pages: withBanner({ land: { action: { a: 'A' } } })
    })

    expect(integrations.cards[1]).toEqual(
      expect.objectContaining({
        triggers: [],
        writes: [],
        apiOnly: false,
        problems: [
          'CW runs only the first action with code A, so this one never runs'
        ]
      })
    )
  })

  test("a later shown duplicate's button runs the first action, with the first action's writes", () => {
    const integrations = integrationsOf({
      endpoints: [parcels],
      externalActions: [
        action('A', {
          display: false,
          target: {
            targetNode: 'payment',
            dataType: 'OBJECT',
            position: null,
            key: 'id',
            place: 'append'
          }
        }),
        action('A', { display: true })
      ],
      pages: withBanner()
    })

    expect(integrations.cards[0].triggers).toEqual([
      {
        kind: 'button',
        label: 'Action A',
        customLink: null
      }
    ])
    expect(writesOf(integrations.cards[0])).toEqual([
      'Writes to `supplementaryData.payment`: object, keyed by `id`'
    ])
    expect(integrations.cards[1].problems).toEqual([
      'CW runs only the first action with code A, so this one never runs'
    ])
  })

  test('a later duplicate still shows its own endpoint', () => {
    const other = endpoint('other', { service: 'OTHER', method: 'PUT' })
    const integrations = integrationsOf(
      {
        endpoints: [parcels, other],
        externalActions: [
          action('A', { display: true }),
          action('A', { endpoint: { code: 'other' } })
        ],
        pages: withBanner()
      },
      [null, 'https://other.example/parcels']
    )

    expect(integrations.cards[1].call).toEqual({
      kind: 'call',
      method: 'PUT',
      url: 'https://other.example/parcels',
      service: 'OTHER',
      hasUrl: true,
      endpoint: 'other'
    })
  })
})

describe('toWorkflowIntegrations with no external actions', () => {
  test.each([
    ['absent', undefined],
    ['empty', []]
  ])('%s, there is nothing to show', (_, externalActions) => {
    expect(integrationsOf({ endpoints: [parcels], externalActions })).toEqual({
      cards: []
    })
  })
})
