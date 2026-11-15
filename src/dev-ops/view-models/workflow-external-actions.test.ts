import type {
  StoredCaseTab,
  StoredEndpoint,
  StoredExternalAction,
  StoredWorkflow,
  WorkflowDefinition
} from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandDefinition } from '../use-cases/test-fixtures.ts'
import {
  findEndpoint,
  findExternalAction,
  toActionCall,
  toCallCell,
  toBannerButtons,
  toCaseTabs
} from './workflow-external-actions.ts'

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

const withTabs = (tabs: Record<string, StoredCaseTab>): StoredWorkflow => ({
  phases: [],
  pages: { cases: { details: { tabs } } }
})

const keysOf = (workflow: StoredWorkflow) =>
  toCaseTabs(workflow).map(({ key }) => key)

const tabOf = (workflow: StoredWorkflow, key: string) =>
  toCaseTabs(workflow).find((tab) => tab.key === key)

describe('toCaseTabs', () => {
  test("lists the woodland tabs in CW's case view order", () => {
    expect(
      toCaseTabs(woodlandDefinition.workflow).map(({ key, label, builtIn }) => [
        key,
        label,
        builtIn
      ])
    ).toEqual([
      ['tasks', 'Tasks', true],
      ['case-details', 'Application', true],
      ['land-parcels', 'Land', false],
      ['timeline', 'Timeline', true],
      ['notes', 'Notes', true],
      ['agreements', 'Agreement', false]
    ])
  })

  test('puts a tab with no index last, and one tied with Application after it', () => {
    expect(
      keysOf(
        withTabs({
          unindexed: {},
          tied: { link: { index: 1 } }
        })
      )
    ).toEqual([
      'tasks',
      'case-details',
      'tied',
      'timeline',
      'notes',
      'unindexed'
    ])
  })

  test('names a tab with no link text from its key, never from its title', () => {
    const workflow = withTabs({
      'land-parcels': { title: 'Parcels' } as StoredCaseTab
    })

    expect(tabOf(workflow, 'land-parcels')?.label).toBe('Land Parcels')
  })

  test("keeps the built-ins' own labels and order whatever the definition says", () => {
    const workflow = withTabs({
      notes: { link: { text: 'Comments', index: 0 }, renderIf: '$.x' }
    })

    expect(tabOf(workflow, 'notes')).toMatchObject({
      label: 'Notes',
      renderIf: null
    })
    expect(keysOf(workflow)).toEqual([
      'tasks',
      'case-details',
      'timeline',
      'notes'
    ])
  })

  test('fires the Application tab’s actions, with the keys they are kept under', () => {
    const workflow = withTabs({
      'case-details': {
        action: { parcels: 'REFRESH_PARCELS', total: 'RECALCULATE' },
        content: [{ component: 'summary-list' }]
      }
    })

    expect(tabOf(workflow, 'case-details')).toMatchObject({
      fires: [
        { key: 'parcels', actionCode: 'REFRESH_PARCELS' },
        { key: 'total', actionCode: 'RECALCULATE' }
      ],
      components: ['summary-list']
    })
  })

  test.each(['tasks', 'notes', 'timeline'])(
    'fires nothing and shows no components on %s, which CW never loads as a tab',
    (key) => {
      const workflow = withTabs({
        [key]: {
          action: { parcels: 'REFRESH_PARCELS' },
          content: [{ component: 'table' }]
        }
      })

      expect(tabOf(workflow, key)).toMatchObject({ fires: [], components: [] })
    }
  )

  test('keeps when a definition tab shows', () => {
    expect(tabOf(woodlandDefinition.workflow, 'agreements')?.renderIf).toBe(
      '$.supplementaryData.agreements'
    )
    expect(
      tabOf(woodlandDefinition.workflow, 'land-parcels')?.renderIf
    ).toBeNull()
  })

  test('shows a content entry with no component as the text CW draws it with', () => {
    const workflow = withTabs({
      notices: { content: [{ id: 'intro' }, { component: 'table' }] }
    })

    expect(tabOf(workflow, 'notices')?.components).toEqual(['text', 'table'])
  })

  test('shows no components on a tab with no content', () => {
    expect(tabOf(withTabs({ empty: {} }), 'empty')?.components).toEqual([])
  })

  test.each([
    [
      { urlTemplate: '/cases/{caseId}/notes?from=land#top' },
      '/cases/{caseId}/notes'
    ],
    [
      { urlTemplate: 'https://user:secret@land.example/%ENVIRONMENT%/parcels' },
      'https://land.example/%ENVIRONMENT%/parcels'
    ],
    [{ urlTemplate: '\\$.notAPath' }, '$.notAPath'],
    [{ urlTemplate: '$.supplementaryData.landUrl' }, null],
    [{ urlTemplate: 'jsonata:$.links.land' }, null]
  ])('takes a tab whose link is set to %j, shown as %j', (href, address) => {
    expect(
      tabOf(withTabs({ land: { link: { href } } }), 'land')?.customLink
    ).toEqual({ address })
  })

  test.each([
    [{ link: {} }],
    [{ link: { href: {} } }],
    [{ link: { href: { urlTemplate: '' } } }]
  ])('takes a tab with %j to its own page, as CW does', (tab) => {
    expect(tabOf(withTabs({ land: tab }), 'land')?.customLink).toBeNull()
  })

  test("ignores a built-in tab's link, as CW does", () => {
    expect(
      tabOf(
        withTabs({ 'case-details': { link: { href: { urlTemplate: '/x' } } } }),
        'case-details'
      )?.customLink
    ).toBeNull()
  })

  test('reads a stored null link, action and content as absent, as CW does', () => {
    const workflow = withTabs({
      land: { link: null, renderIf: null, action: null, content: null }
    })

    expect(tabOf(workflow, 'land')).toEqual({
      key: 'land',
      label: 'Land',
      builtIn: false,
      renderIf: null,
      fires: [],
      components: [],
      customLink: null
    })
  })

  test.each([
    ['no pages', { phases: [] }],
    ['no tabs', { phases: [], pages: { cases: { details: {} } } }]
  ])('lists the built-ins alone with %s', (_name, workflow) => {
    expect(keysOf(workflow)).toEqual([
      'tasks',
      'case-details',
      'timeline',
      'notes'
    ])
  })
})

describe('toBannerButtons', () => {
  const banner = { phases: [], pages: { cases: { details: { banner: {} } } } }

  test('lists the actions shown on the banner, in definition order', () => {
    const workflow: StoredWorkflow = {
      ...banner,
      externalActions: [
        action('B', { display: true }),
        action('HIDDEN'),
        action('A', { display: true })
      ]
    }

    expect(toBannerButtons(workflow).map(({ code }) => code)).toEqual([
      'B',
      'A'
    ])
  })

  test('takes only a true display, not the word', () => {
    const workflow = {
      ...banner,
      externalActions: [action('A', { display: 'true' as unknown as boolean })]
    }

    expect(toBannerButtons(workflow)).toEqual([])
  })

  test('has none without a banner, where CW adds no buttons', () => {
    expect(
      toBannerButtons({
        phases: [],
        externalActions: [action('A', { display: true })]
      })
    ).toEqual([])
  })

  test('has none without external actions', () => {
    expect(toBannerButtons(banner)).toEqual([])
  })
})

describe('findExternalAction and findEndpoint', () => {
  test('take the first of a duplicated code, as CW does', () => {
    const first = action('A', { name: 'First', endpoint: { code: 'e' } })
    const workflow: StoredWorkflow = {
      phases: [],
      externalActions: [first, action('A', { name: 'Second' })],
      endpoints: [endpoint('e', { path: '/first' }), endpoint('e')]
    }

    expect(findExternalAction(workflow, 'A')).toBe(first)
    expect(findEndpoint(workflow, first)?.path).toBe('/first')
  })
})

describe('toActionCall', () => {
  const definitionOf = (
    workflow: StoredWorkflow,
    addresses: WorkflowDefinition['addresses'] = []
  ): WorkflowDefinition => ({ workflow, addresses })

  test('calls the endpoint at the address its service resolves to', () => {
    expect(toActionCall(woodlandDefinition, 'REFRESH_PARCELS')).toEqual({
      kind: 'call',
      action: woodlandDefinition.workflow.externalActions?.[1],
      endpoint: woodlandDefinition.workflow.endpoints?.[0],
      address: woodlandDefinition.addresses[0]
    })
  })

  test('calls an endpoint whose service has no URL, with no address to show', () => {
    expect(toActionCall(woodlandDefinition, 'RECALCULATE')).toMatchObject({
      kind: 'call',
      address: { code: 'recalculate', url: null }
    })
  })

  test('says an unknown code is not defined', () => {
    expect(toActionCall(woodlandDefinition, 'MISSING')).toEqual({
      kind: 'not-defined',
      code: 'MISSING'
    })
  })

  test('says a stored value that is not a code is not defined, as it is stored', () => {
    expect(toActionCall(woodlandDefinition, { code: 'A' })).toEqual({
      kind: 'not-defined',
      code: '{"code":"A"}'
    })
  })

  test.each([
    ['an endpoint named by a string', { endpoint: 'e' }, [endpoint('e')]],
    ['a null endpoint', { endpoint: null }, [endpoint('e')]],
    [
      'an endpoint code no endpoint has',
      { endpoint: { code: 'x' } },
      [endpoint('e')]
    ],
    ['no endpoints at all', { endpoint: { code: 'e' } }, undefined]
  ])('has no endpoint with %s', (_name, overrides, endpoints) => {
    const workflow: StoredWorkflow = {
      phases: [],
      externalActions: [action('A', overrides)],
      ...(endpoints && { endpoints })
    }

    expect(toActionCall(definitionOf(workflow), 'A')).toMatchObject({
      kind: 'no-endpoint',
      action: { code: 'A' }
    })
  })

  test('finds the address by position, so endpoints sharing a code keep their own', () => {
    const workflow: StoredWorkflow = {
      phases: [],
      externalActions: [action('A', { endpoint: { code: 'e' } })],
      endpoints: [
        endpoint('e', { service: 'FIRST' }),
        endpoint('e', { service: 'SECOND' })
      ]
    }
    const addresses = [
      { code: 'e', service: 'FIRST', url: 'https://first.example/parcels' },
      { code: 'e', service: 'SECOND', url: 'https://second.example/parcels' }
    ]

    expect(toActionCall(definitionOf(workflow, addresses), 'A')).toMatchObject({
      kind: 'call',
      address: addresses[0]
    })
  })
})

describe('toCallCell', () => {
  test("shows the method and CW's resolved address", () => {
    expect(
      toCallCell(toActionCall(woodlandDefinition, 'REFRESH_PARCELS'))
    ).toEqual({
      kind: 'call',
      method: 'GET',
      url: 'https://land-data.example/api/v2/parcels/{sbi}',
      service: 'LAND_DATA',
      hasUrl: true
    })
  })

  test('shows the path when the service has no usable URL', () => {
    expect(toCallCell(toActionCall(woodlandDefinition, 'RECALCULATE'))).toEqual(
      {
        kind: 'call',
        method: 'POST',
        url: '/api/v1/calculate',
        service: 'PAYMENT_CALC',
        hasUrl: false
      }
    )
  })

  test('says an action is not defined, or has no endpoint', () => {
    expect(toCallCell(toActionCall(woodlandDefinition, 'MISSING'))).toEqual({
      kind: 'not-defined',
      code: 'MISSING'
    })
    expect(
      toCallCell({ kind: 'no-endpoint', action: action('A', {}) })
    ).toEqual({ kind: 'no-endpoint' })
  })
})
