import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'
import type { AnyNode } from 'domhandler'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  GrantAgreement,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import {
  agreementDefinition,
  grantVersionHeader as header
} from '../use-cases/test-fixtures.ts'
import { expectTablesStyled } from '../test-utils.ts'

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

const path = '/dev-ops/grants/woodland-creation/1.2.0'

const agreement = (
  overrides: Partial<GrantAgreement> = {}
): GrantAgreement => ({
  definition: {
    ...agreementDefinition,
    endpoints: [
      {
        code: 'CALCULATE',
        method: 'POST',
        service: 'LAND_GRANTS',
        path: '/payments/calculate'
      }
    ]
  },
  addresses: [
    {
      process: 'GENERATE_OFFER',
      service: 'LAND_DATA',
      url: 'https://land-data.example/api/v2/parcels/{sbi}'
    },
    { process: 'FETCH_TERMS', service: 'AGREEMENT_DOCS', url: null }
  ],
  problem: null,
  missingServiceUrls: [],
  endpointAddresses: [
    {
      code: 'CALCULATE',
      service: 'LAND_GRANTS',
      url: 'https://land-grants.example/payments/calculate'
    }
  ],
  ...overrides
})

/** GAS `compose/seed/woodland/1.39.1/gas/payment.json`. */
const payment = {
  code: 'woodland',
  sbi: '$.claim.sbi',
  currency: 'GBP',
  marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)',
  payments: [
    {
      dueDate: '@.dueDate',
      totalAmountPence: '$.claim.totalAmountPence',
      invoiceLines: [
        {
          schemeCode: 'WMP',
          description: 'jsonata:@.description',
          amountPence: '$.claim.totalAmountPence'
        }
      ]
    }
  ]
}

const givenGrant = (overrides: Partial<GrantVersionPage> = {}) =>
  vi.mocked(getGrantPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: { header, sourceErrors: [], sectionErrors: [], ...overrides }
  })

let server: Server

const viewTab = async (tab: string) => {
  const { result, headers } = await server.inject({
    method: 'GET',
    url: `${path}?tab=${tab}`,
    headers: { cookie: 'dev-ops-times=uk' },
    auth: { strategy: 'session', credentials }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return $
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const textsOf = ($: CheerioAPI, node: AnyNode): string[] =>
  $(node)
    .contents()
    .toArray()
    .flatMap((child) =>
      child.type === 'text' ? [$(child).text()] : textsOf($, child)
    )

/** The words of an element whose markup has no spaces between its parts, in document order. */
const wordsOf = ($: CheerioAPI, node: Parameters<CheerioAPI>[0]) =>
  flatten(
    $(node)
      .toArray()
      .flatMap((element) => textsOf($, element))
      .join(' ')
  ).replace(/ ([.,])/g, '$1')

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).text())

/** Each row of a table, its cells' text. */
const rowsOf = ($: CheerioAPI, scope: string) =>
  part($, scope)
    .find('tbody tr')
    .toArray()
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((cell) => wordsOf($, cell))
    )

/** A FactsCard's facts, label to value. */
const factsOf = ($: CheerioAPI, testId: string) =>
  Object.fromEntries(
    part($, testId)
      .find('dt')
      .toArray()
      .map((term) => [flatten($(term).text()), wordsOf($, $(term).next())])
  )

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

describe('the grant Agreement tab', () => {
  test('heads a usable definition with its facts, codes as written', async () => {
    givenGrant({ agreement: agreement() })

    const $ = await viewTab('agreement')

    expect(factsOf($, 'agreement-facts')).toEqual({
      Code: 'woodland-creation',
      'Number prefix': 'WC',
      'Reads answers from': '$.input.answers',
      'Created when':
        'the grant runs GENERATE_OFFER on a Phases move. See Phases',
      'Runs on create': 'GENERATE_OFFER',
      'Text templates': 'terms.standard, terms.welsh',
      Endpoints: 'CALCULATE POST https://land-grants.example/payments/calculate'
    })
    expect(
      part($, 'agreement-facts').find('a:contains("See Phases")').attr('href')
    ).toBe(`${path}?tab=phases`)
    expect(part($, 'agreement-missing-urls')).toHaveLength(0)
  })

  test('gives each state action a row, linking the payment it requests to Payment', async () => {
    givenGrant({ agreement: agreement() })

    const $ = await viewTab('agreement')

    expect(textOf($, 'agreement-states')).toContain(
      'Until an agreement is accepted, GAS runs its actions with the newest usable 1.x agreement definition, which may not be this one.'
    )
    expect(rowsOf($, 'agreement-states').slice(0, 2)).toEqual([
      [
        'offered initial',
        'offered',
        'accept',
        'accepted',
        'confirm = $.form.confirm Confirm you have read the terms',
        'CREATE_AGREEMENT_PAYMENT'
      ],
      ['offered', 'offered', 'withdraw', 'withdrawn', '—', '—']
    ])
    expect(rowsOf($, 'agreement-states')).toContainEqual([
      'cancelled',
      '—',
      'No actions',
      '—',
      '—',
      '—'
    ])
    expect(
      part($, 'agreement-states')
        .find('a:contains("CREATE_AGREEMENT_PAYMENT")')
        .attr('href')
    ).toBe(`${path}?tab=payment`)
  })

  test('lists the pages and the processes, each process with its call and outputs', async () => {
    givenGrant({ agreement: agreement() })

    const $ = await viewTab('agreement')

    expect(rowsOf($, 'agreement-pages')).toEqual([
      ['offered', 'Review your agreement offer', 'summary-list, button', '—'],
      ['accept', 'Accept your agreement offer', 'form', '—'],
      [
        'document',
        'Agreement document',
        'document layout, parties, actions, payments, terms, heading',
        '—'
      ]
    ])
    expect(rowsOf($, 'agreement-processes')).toEqual([
      [
        'GENERATE_OFFER',
        'HTTP call',
        'POST https://land-data.example/api/v2/parcels/{sbi}',
        'offer From $.response.offer totalAmountPence From $.response.totalAmountPence'
      ],
      [
        'FETCH_TERMS',
        'HTTP call',
        'GET AGREEMENT_DOCS/terms No URL',
        'terms From $.response.terms'
      ],
      [
        'CREATE_AGREEMENT_PAYMENT',
        'Built into GAS requests the agreement payment See Payment',
        '—',
        '—'
      ]
    ])
  })

  test('shows the raw definition behind a disclosure', async () => {
    givenGrant({ agreement: agreement() })

    const $ = await viewTab('agreement')
    const raw = part($, 'agreement-raw')

    expect(raw.attr('data-show')).toBe('Show raw agreement definition (JSON)')
    expect(raw.attr('data-hide')).toBe('Hide raw agreement definition')
    expect(raw.find('.gpa-code.gpa-code-framed pre').text()).toContain(
      '"agreementNumberPrefix": "WC"'
    )
  })

  test('warns when a service it names has no URL, and marks the endpoint', async () => {
    givenGrant({
      agreement: agreement({
        missingServiceUrls: ['LAND_GRANTS_URL'],
        endpointAddresses: [
          { code: 'CALCULATE', service: 'LAND_GRANTS', url: null }
        ]
      })
    })

    const $ = await viewTab('agreement')
    const alert = part($, 'agreement-missing-urls')

    expect(alert.hasClass('gpa-alert-warning')).toBe(true)
    expect(flatten(alert.find('.gpa-alert-title').text())).toBe(
      'LAND_GRANTS has no URL in GAS here.'
    )
    expect(flatten(alert.find('.gpa-alert-body > div').text())).toBe(
      'GAS won’t load this agreement definition while any service it names has no URL. On this environment, agreements that resolve to it can’t be created, and while it’s the newest usable 1.x definition, actions on 1.x agreements before acceptance fail too.'
    )
    expect(wordsOf($, part($, 'agreement-endpoint'))).toBe(
      'CALCULATE POST LAND_GRANTS/payments/calculate No URL'
    )
    expect(
      part($, 'agreement-endpoint').find('.gpa-badge-warning').text()
    ).toBe('No URL')
  })

  test('says GAS can’t load a definition, with its reason, and shows it raw', async () => {
    givenGrant({
      header: {
        ...header,
        files: {
          ...header.files,
          agreement: {
            stored: true,
            fetchStatus: 'permanent_error',
            fetchError: 'bad target'
          }
        }
      },
      agreement: agreement({
        problem: 'states.accepted.on.terminate.target: unknown state ended'
      })
    })

    const $ = await viewTab('agreement')
    const alert = part($, 'agreement-problem')

    expect(alert.hasClass('gpa-alert-danger')).toBe(true)
    expect(flatten(alert.find('.gpa-alert-title').text())).toBe(
      'GAS can’t load this agreement definition.'
    )
    expect(flatten(alert.find('.gpa-alert-body > div').text())).toBe(
      'Agreements that resolve to it can’t be created or progressed. Reason: states.accepted.on.terminate.target: unknown state ended. Publish a corrected version.'
    )
    expect(alert.find('code').text()).toBe(
      'states.accepted.on.terminate.target: unknown state ended'
    )
    expect(textOf($, 'agreement-fallback')).toBe(
      'GAS has marked this file unusable. New agreements use the newest usable 1.x agreement definition at or below 1.2.0; actions before acceptance use the newest usable 1.x one, which may be later.'
    )
    expect(
      part($, 'agreement-raw-card').find('.gpa-card-head').text()
    ).toContain('Raw agreement definition (JSON)')
    expect(part($, 'agreement-facts')).toHaveLength(0)
  })

  test('says nothing of a fallback while GAS has not marked the file unusable', async () => {
    givenGrant({ agreement: agreement({ problem: 'bad' }) })

    const $ = await viewTab('agreement')

    expect(part($, 'agreement-fallback')).toHaveLength(0)
  })
})

describe('the grant Payment tab', () => {
  test('says when GAS requests the payment, what it reads and what it is used for', async () => {
    givenGrant({ payment })

    const $ = await viewTab('payment')

    expect(factsOf($, 'payment-when')).toEqual({
      'Requested when': 'a claim is submitted (claim payments) Entitlements',
      Reads:
        '$.claim the submitted claim, $.execution.executedAt when GAS ran it and @. the current row of a For each',
      'Used for':
        'Agreement payments whose agreement is on 1.2.0 (the version it was created or accepted under), and claims on applications currently on 1.2.0. GAS has no fallback: if this file can’t load, those payments fail.'
    })
    expect(part($, 'payment-row-ids')).toHaveLength(0)
  })

  test('lists the request, each due payment and its invoice lines, pointing calculated values to one table', async () => {
    givenGrant({ payment })

    const $ = await viewTab('payment')

    expect(rowsOf($, 'payment-request')).toEqual([
      ['sbi', 'From $.claim.sbi'],
      ['currency', 'Fixed GBP'],
      ['marketingYear', 'Calculated see Calculated fields']
    ])
    expect(textOf($, 'payment-due-description')).toBe(
      'Each has a due date @.dueDate and a total $.claim.totalAmountPence.'
    )
    expect(rowsOf($, 'payment-lines')).toEqual([
      ['Scheme', 'Fixed WMP'],
      ['Description', 'Calculated see Calculated fields'],
      ['Amount (pence)', 'From $.claim.totalAmountPence'],
      ['Account', '—'],
      ['Fund', '—'],
      ['Delivery body', '—'],
      ['Marketing year', '—']
    ])
    expect(rowsOf($, 'payment-calculated')).toEqual([
      ['marketingYear', '$substring($.execution.executedAt, 0, 4)'],
      ['Description (invoice line)', '@.description']
    ])
  })

  test('says what GAS checks, and shows the raw definition behind a disclosure', async () => {
    givenGrant({ payment })

    const $ = await viewTab('payment')

    expect(
      flatten(part($, 'payment-checks').find('.gpa-alert-title').text())
    ).toBe('GAS checks the request after resolving it.')
    expect(part($, 'payment-checks').hasClass('gpa-alert-info')).toBe(true)
    expect(part($, 'payment-raw').attr('data-show')).toBe(
      'Show raw payment definition (JSON)'
    )
    expect(part($, 'payment-raw').find('pre').text()).toContain(
      '"code": "woodland"'
    )
  })

  test('says the agreement rows it reads carry stable ids, and links the agreement action', async () => {
    givenGrant({
      payment: {
        code: 'pigs',
        sbi: '$.agreement.identifiers.sbi',
        payments: [
          {
            dueDate: '@.dueDate',
            totalAmountPence: '@.total',
            invoiceLines: {
              itemsRef: '$.agreement.actions',
              items: { amountPence: '@.p' }
            }
          }
        ]
      }
    })

    const $ = await viewTab('payment')

    expect(factsOf($, 'payment-when')['Requested when']).toBe(
      'an agreement action runs CREATE_AGREEMENT_PAYMENT Agreement'
    )
    expect(textOf($, 'payment-row-ids')).toBe(
      'Reads the stored agreement, where GAS has replaced actionRef, itemRef and ref with stable ids: actionId, itemId, id (action:1, item:1).'
    )
    expect(textOf($, 'payment-due-description')).toBe(
      'Each has a due date @.dueDate and a total @.total, and one invoice line per row of $.agreement.actions.'
    )
  })

  test('warns when it has no due payments, or a due payment no invoice lines', async () => {
    givenGrant({ payment: { code: 'woodland', payments: [] } })

    const none = await viewTab('payment')

    expect(part(none, 'payment-no-due').hasClass('gpa-alert-warning')).toBe(
      true
    )

    givenGrant({
      payment: {
        code: 'woodland',
        payments: [
          { dueDate: '@.d', totalAmountPence: '@.t', invoiceLines: [] }
        ]
      }
    })

    const empty = await viewTab('payment')

    expect(wordsOf(empty, part(empty, 'payment-no-lines'))).toBe(
      'No invoice lines. GAS needs at least one on each due payment, so every payment for this version fails.'
    )
  })

  test('warns that claim payments find no agreement when it reads both', async () => {
    givenGrant({
      payment: {
        code: 'woodland',
        sbi: '$.claim.sbi',
        frn: '$.agreement.frn',
        payments: []
      }
    })

    const $ = await viewTab('payment')

    expect(
      flatten(part($, 'payment-mixed').find('.gpa-alert-title').text())
    ).toBe('Claim payments find no agreement.')
  })
})
