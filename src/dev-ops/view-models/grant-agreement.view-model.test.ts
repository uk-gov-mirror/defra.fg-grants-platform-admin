import type {
  AgreementDefinition,
  GrantAgreement
} from '../use-cases/get-grant-page.use-case.ts'
import { agreementDefinition } from '../use-cases/test-fixtures.ts'
import { toAgreementTab } from './grant-agreement.view-model.ts'
import type {
  AgreementContext,
  AgreementTab
} from './grant-agreement.view-model.ts'

const addresses = [
  {
    process: 'GENERATE_OFFER',
    service: 'LAND_DATA',
    url: 'https://land-data.example/api/v2/parcels/{sbi}'
  },
  { process: 'FETCH_TERMS', service: 'AGREEMENT_DOCS', url: null }
]

const context: AgreementContext = {
  version: '3.16.3',
  fetchStatus: 'fetched',
  hrefs: { phases: '/phases', payment: '/payment' }
}

const agreement = (
  overrides: Partial<GrantAgreement> = {}
): GrantAgreement => ({
  definition: agreementDefinition,
  addresses,
  problem: null,
  ...overrides
})

type Loadable = Extract<AgreementTab, { problem: null }>

const loadable = (
  overrides: Partial<GrantAgreement> = {},
  given: AgreementContext = context
): Loadable => {
  const tab = toAgreementTab(agreement(overrides), given)

  if (tab.problem !== null) {
    throw new Error(`expected a loadable agreement, got ${tab.problem}`)
  }

  return tab
}

const withDefinition = (changes: Partial<AgreementDefinition>): Loadable =>
  loadable({ definition: { ...agreementDefinition, ...changes } })

const factOf = (tab: Loadable, label: string) =>
  tab.facts.find((fact) => fact.label === label)

/** After qa-complex 1.1.0: a standalone button, a form, and a button whose action has no page. */
const qaStates: AgreementDefinition['states'] = {
  offered: {
    page: 'offered',
    processes: ['CHECK_TOTALS_ON_VIEW'],
    on: {
      accept: { target: 'accepted', page: 'accept' },
      withdraw: { target: 'withdrawn' },
      refresh: {
        target: 'offered',
        page: 'refresh',
        values: { totalAmountPence: '$.agreement.totalAmountPence' }
      }
    }
  },
  accepted: { page: 'accepted', on: { terminate: { target: 'terminated' } } },
  withdrawn: { page: 'withdrawn' },
  terminated: {}
}

const qaPages: AgreementDefinition['pages'] = {
  document: {
    title: 'Agreement document',
    layout: 'document',
    contents: true,
    print: true,
    watermarks: { offered: 'DRAFT - TEST DATA' },
    backLink: { href: { urlTemplate: '/agreements/{agreementNumber}' } },
    sections: [
      { id: 'parties' },
      { id: 'acceptance', condition: '$.agreement.acceptedAt' }
    ],
    components: [{ component: 'heading' }]
  },
  accepted: {
    title: 'Agreement accepted',
    components: [
      { component: 'panel' },
      { component: 'button', text: 'End this agreement', action: 'terminate' }
    ]
  },
  offered: {
    title: 'Your offer',
    backLink: { href: '/agreements/current' },
    components: [
      {
        component: 'grid-row',
        components: [
          {
            component: 'grid-column',
            components: [
              {
                component: 'button',
                text: 'Review and accept',
                action: 'accept'
              }
            ]
          }
        ]
      },
      { component: 'button', text: 'Withdraw this offer', action: 'withdraw' },
      { component: 'button', text: 'Archive', action: 'archive' }
    ]
  },
  accept: {
    title: 'Accept your offer',
    components: [
      {
        component: 'form',
        action: 'accept',
        components: [{ component: 'button', text: 'Accept offer' }]
      }
    ]
  },
  refresh: { title: 'Refresh your offer', components: [] },
  withdrawn: { title: 'Offer withdrawn', components: [] }
}

const qaComplex = (): Loadable =>
  withDefinition({ states: qaStates, pages: qaPages })

describe('toAgreementTab: facts', () => {
  test('names each fact as the page does, codes as written', () => {
    expect(loadable().facts).toEqual([
      { label: 'Code', kind: 'mono', text: 'woodland-creation' },
      { label: 'Number prefix', kind: 'mono', text: 'WC' },
      { label: 'Reads answers from', kind: 'mono', text: '$.input.answers' },
      { label: 'Created when', kind: 'created-when', href: '/phases' },
      { label: 'Runs on create', kind: 'mono', text: 'GENERATE_OFFER' },
      {
        label: 'Text templates',
        kind: 'mono',
        text: 'terms.standard, terms.welsh'
      }
    ])
  })

  test('shows application data that is not a string as one line of JSON', () => {
    const tab = withDefinition({
      create: { target: 'offered', application: { answers: '$.input' } }
    })

    expect(factOf(tab, 'Reads answers from')).toMatchObject({
      text: '{"answers":"$.input"}'
    })
  })

  test('lists the root endpoints with the URL GAS has for each, null where it has none', () => {
    const tab = loadable({
      definition: {
        ...agreementDefinition,
        endpoints: [
          {
            code: 'CALCULATE',
            method: 'POST',
            service: 'LAND_GRANTS',
            path: '/payments/calculate'
          },
          {
            code: 'TERMS',
            method: 'GET',
            service: 'AGREEMENT_DOCS',
            path: '/terms'
          }
        ]
      },
      endpointAddresses: [
        {
          code: 'CALCULATE',
          service: 'LAND_GRANTS',
          url: 'https://land-grants.example/payments/calculate'
        },
        { code: 'TERMS', service: 'AGREEMENT_DOCS', url: null }
      ]
    })

    expect(factOf(tab, 'Endpoints')).toEqual({
      label: 'Endpoints',
      kind: 'endpoints',
      endpoints: [
        {
          code: 'CALCULATE',
          method: 'POST',
          service: 'LAND_GRANTS',
          path: '/payments/calculate',
          url: 'https://land-grants.example/payments/calculate'
        },
        {
          code: 'TERMS',
          method: 'GET',
          service: 'AGREEMENT_DOCS',
          path: '/terms',
          url: null
        }
      ]
    })
  })

  test('has no Endpoints fact for a definition with no root endpoints', () => {
    expect(factOf(loadable(), 'Endpoints')).toBeUndefined()
  })
})

describe('toAgreementTab: unset service URLs', () => {
  test('names the services GAS has no URL for', () => {
    expect(
      loadable({ missingServiceUrls: ['AGREEMENT_DOCS_URL', 'LAND_DATA_URL'] })
        .missingServices
    ).toEqual(['AGREEMENT_DOCS', 'LAND_DATA'])
  })

  test('names none when an older GAS does not say', () => {
    expect(loadable().missingServices).toEqual([])
  })
})

describe('toAgreementTab: states', () => {
  test('gives each action a row, naming the state and its flags on its first', () => {
    const { states } = loadable()

    expect(states.slice(0, 3)).toEqual([
      {
        state: 'offered',
        flags: ['initial'],
        page: 'offered',
        action: 'accept',
        target: 'accepted',
        requires: [
          {
            name: 'confirm',
            value: '$.form.confirm',
            message: 'Confirm you have read the terms'
          }
        ],
        runs: [{ process: 'CREATE_AGREEMENT_PAYMENT', payment: true }]
      },
      {
        state: 'offered',
        flags: [],
        page: 'offered',
        action: 'withdraw',
        target: 'withdrawn',
        requires: [],
        runs: []
      },
      {
        state: 'offered',
        flags: [],
        page: 'offered',
        action: 'cancel',
        target: 'cancelled',
        requires: [],
        runs: []
      }
    ])
  })

  test('marks accepted as the state that locks the version', () => {
    expect(loadable().states[3]).toMatchObject({
      state: 'accepted',
      flags: ['locks version'],
      action: 'terminate'
    })
  })

  test('gives a state with no actions one row of its own, and no page as null', () => {
    expect(loadable().states.at(-2)).toEqual({
      state: 'cancelled',
      flags: [],
      page: null,
      action: null,
      target: null,
      requires: [],
      runs: []
    })
  })
})

describe('toAgreementTab: pages', () => {
  test('orders the pages as the states show them, then any no state shows', () => {
    expect(qaComplex().pages.map(({ id }) => id)).toEqual([
      'offered',
      'accept',
      'refresh',
      'accepted',
      'withdrawn',
      'document'
    ])
  })

  test('says in one line what the customer sees beyond the title', () => {
    const document = qaComplex().pages.find(({ id }) => id === 'document')

    expect(document).toMatchObject({
      title: 'Agreement document',
      shows:
        'document layout, DRAFT - TEST DATA watermark when offered, printable, contents list, back link to /agreements/{agreementNumber}, parties, acceptance (shown when $.agreement.acceptedAt), heading',
      buttons: []
    })
  })

  test('lists the buttons nested anywhere on a page, saying why one returns an error', () => {
    expect(qaComplex().pages[0].buttons).toEqual([
      { text: 'Review and accept', action: 'accept', problem: null },
      {
        text: 'Withdraw this offer',
        action: 'withdraw',
        problem: 'withdraw has no page: this button returns an error'
      },
      {
        text: 'Archive',
        action: 'archive',
        problem:
          'archive is not an action of offered: this button returns an error'
      }
    ])
  })

  test("names a form's button by its text, needing no page of its action", () => {
    expect(qaComplex().pages[1].buttons).toEqual([
      { text: 'Accept offer', action: 'accept', problem: null }
    ])
  })
})

describe('toAgreementTab: created with', () => {
  test('lists each value by its whole path and where it comes from', () => {
    const tab = withDefinition({
      create: {
        target: 'offered',
        application: '$.input.answers',
        values: {
          sbi: '$.application.identifiers.sbi',
          currency: 'GBP',
          total: 'jsonata:$sum($.parcels.amount)',
          parcels: { itemsRef: '$.answers.parcels', items: { id: '@.id' } }
        }
      }
    })

    expect(tab.createdWith).toEqual([
      {
        field: 'sbi',
        how: 'From',
        value: '$.application.identifiers.sbi',
        calculated: false
      },
      { field: 'currency', how: 'Fixed', value: 'GBP', calculated: false },
      {
        field: 'total',
        how: 'Calculated',
        value: '$sum($.parcels.amount)',
        calculated: true
      },
      {
        field: 'parcels',
        how: 'For each',
        value: '$.answers.parcels',
        calculated: false
      },
      { field: 'parcels.id', how: 'From', value: '@.id', calculated: false }
    ])
  })

  test('gives no rows when the definition creates with no values', () => {
    expect(loadable().createdWith).toEqual([])
  })
})

describe('toAgreementTab: processes', () => {
  test("gives each process its type in words, GAS's URL and its outputs", () => {
    expect(loadable().processes).toEqual([
      {
        name: 'GENERATE_OFFER',
        type: 'HTTP call',
        requestsPayment: false,
        call: {
          method: 'POST',
          service: 'LAND_DATA',
          path: '/api/v2/parcels/{sbi}',
          url: 'https://land-data.example/api/v2/parcels/{sbi}'
        },
        outputs: [
          {
            field: 'offer',
            how: 'From',
            value: '$.response.offer',
            calculated: false
          },
          {
            field: 'totalAmountPence',
            how: 'From',
            value: '$.response.totalAmountPence',
            calculated: false
          }
        ]
      },
      {
        name: 'FETCH_TERMS',
        type: 'HTTP call',
        requestsPayment: false,
        call: {
          method: 'GET',
          service: 'AGREEMENT_DOCS',
          path: '/terms',
          url: null
        },
        outputs: [
          {
            field: 'terms',
            how: 'From',
            value: '$.response.terms',
            calculated: false
          }
        ]
      },
      {
        name: 'CREATE_AGREEMENT_PAYMENT',
        type: 'Built into GAS',
        requestsPayment: true,
        call: null,
        outputs: []
      }
    ])
  })

  test('gives no processes for a definition that has none', () => {
    expect(withDefinition({ processDefinitions: undefined }).processes).toEqual(
      []
    )
  })
})

describe('toAgreementTab: a definition GAS cannot load', () => {
  test('gives the problem, the major and the definition as stored', () => {
    expect(
      toAgreementTab(agreement({ problem: 'states.x: unknown state' }), context)
    ).toEqual({
      problem: 'states.x: unknown state',
      failed: false,
      major: '3',
      version: '3.16.3',
      raw: JSON.stringify(agreementDefinition, null, 2)
    })
  })

  test('says GAS has marked the file unusable when its fetch failed for good', () => {
    const tab = toAgreementTab(agreement({ problem: 'bad' }), {
      ...context,
      fetchStatus: 'permanent_error'
    })

    expect(tab).toMatchObject({ failed: true })
  })

  test('gives a loadable definition its raw JSON too', () => {
    expect(loadable().raw).toBe(JSON.stringify(agreementDefinition, null, 2))
  })
})
