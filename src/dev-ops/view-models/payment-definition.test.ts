import { toValueCell } from './mapping-rows.ts'
import { toMappingValue } from './mapping-table.ts'
import { toPaymentDefinition } from './payment-definition.ts'
import type { PaymentContext } from './payment-definition.ts'

/** GAS `compose/seed/woodland/1.39.1/gas/payment.json`. */
const woodland = {
  code: 'woodland',
  sbi: '$.claim.sbi',
  frn: '$.claim.frn',
  scheme: 'WMP',
  sourceSystem: 'WMP',
  deliveryBody: 'RP10',
  fesCode: 'FALS_WMP',
  originalInvoiceNumber: '',
  ledger: 'AP',
  totalAmountPence: '$.claim.totalAmountPence',
  currency: 'GBP',
  marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)',
  payments: [
    {
      dueDate: 'jsonata:$substring($.execution.executedAt, 0, 10)',
      totalAmountPence: '$.claim.totalAmountPence',
      invoiceLines: [
        {
          schemeCode: 'WMP',
          description: 'Woodland Management Plan Payment',
          amountPence: '$.claim.totalAmountPence',
          accountCode: 'SOS710',
          fundCode: 'DRD10',
          deliveryBody: 'RP10',
          marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)'
        }
      ]
    }
  ]
}

const pmfDescription =
  'jsonata:@.description ?? $.agreement.actions[id = @.actionId].description ?? $.agreement.items[id = @.itemId].description'

/** GAS `compose/seed/pigs-might-fly/1.0.0/gas/payment.json`. */
const pigsMightFly = {
  code: 'pigs-might-fly',
  sbi: '$.agreement.identifiers.sbi',
  frn: '$.agreement.identifiers.frn',
  originalInvoiceNumber: '',
  scheme: 'SFI',
  sourceSystem: 'FPTT',
  deliveryBody: 'RP00',
  fesCode: 'FALS_FPTT',
  ledger: 'AP',
  totalAmountPence: '$.agreement.totalAmountPence',
  currency: 'GBP',
  marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)',
  payments: {
    itemsRef: '$.agreement.paymentSchedule.instalments',
    items: {
      dueDate: '@.dueDate',
      totalAmountPence: '@.totalAmountPence',
      invoiceLines: {
        itemsRef: '@.lineItems',
        items: {
          schemeCode: 'CMOR1',
          description: pmfDescription,
          amountPence: '@.amountPence',
          accountCode: 'SOS710',
          fundCode: 'DRD10',
          deliveryBody: 'RP00',
          marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)'
        }
      }
    }
  }
}

const context: PaymentContext = {
  version: '1.0.1',
  hrefs: { entitlements: '/entitlements', agreement: '/agreement' }
}

const viewOf = (definition: Record<string, unknown>) =>
  toPaymentDefinition(definition, context)

const value = (mapped: unknown) => toValueCell(toMappingValue(mapped))

const cells = (line: Record<string, unknown>) =>
  lineLabels.map(([key, label]) => ({
    label,
    cell: Object.hasOwn(line, key) ? value(line[key]) : null
  }))

const lineLabels = [
  ['schemeCode', 'Scheme'],
  ['description', 'Description'],
  ['amountPence', 'Amount (pence)'],
  ['accountCode', 'Account'],
  ['fundCode', 'Fund'],
  ['deliveryBody', 'Delivery body'],
  ['marketingYear', 'Marketing year']
]

const duePayment = (overrides: object = {}) => ({
  dueDate: '@.dueDate',
  totalAmountPence: '@.totalAmountPence',
  invoiceLines: [],
  ...overrides
})

const withPayments = (payments: unknown) =>
  viewOf({ code: 'woodland', payments })

describe('toPaymentDefinition: when GAS requests it', () => {
  test('says a claim payment is requested when a claim is submitted, reading the claim and when GAS ran it', () => {
    const view = viewOf(woodland)

    expect(view.requestedWhen).toEqual({ claim: true, agreement: false })
    expect(view.reads).toEqual(['claim', 'execution'])
    expect(view.mixed).toBe(false)
    expect(view.hrefs).toEqual(context.hrefs)
    expect(view.version).toBe('1.0.1')
  })

  test('says an agreement payment is requested by an agreement action, reading its rows', () => {
    const view = viewOf(pigsMightFly)

    expect(view.requestedWhen).toEqual({ claim: false, agreement: true })
    expect(view.reads).toEqual(['agreement', 'execution', 'row'])
    expect(view.readsAgreementRows).toBe(true)
  })

  test('says both, and that claims find no agreement, when it reads both', () => {
    const view = viewOf({
      code: 'qa-complex',
      sbi: 'jsonata:$.claim.sbi ?? $.agreement.identifiers.sbi'
    })

    expect(view.requestedWhen).toEqual({ claim: true, agreement: true })
    expect(view.mixed).toBe(true)
  })

  test('says either may request one that reads neither', () => {
    const view = viewOf({ code: 'qa-complex', scheme: 'QA' })

    expect(view.requestedWhen).toEqual({ claim: true, agreement: true })
    expect(view.reads).toEqual([])
    expect(view.mixed).toBe(false)
    expect(view.readsAgreementRows).toBe(false)
  })
})

describe('toPaymentDefinition', () => {
  test('lists every request field in stored order, without code or payments', () => {
    const { request } = viewOf(woodland)

    expect(request.map(({ field }) => field)).toEqual([
      'sbi',
      'frn',
      'scheme',
      'sourceSystem',
      'deliveryBody',
      'fesCode',
      'originalInvoiceNumber',
      'ledger',
      'totalAmountPence',
      'currency',
      'marketingYear'
    ])
    expect(request[0]).toEqual({
      field: 'sbi',
      how: 'From',
      value: '$.claim.sbi',
      calculated: false
    })
  })

  test('titles the one due payment of an array, with its invoice lines', () => {
    expect(viewOf(woodland).duePayments).toEqual([
      {
        kind: 'due',
        title: { text: 'Due payment', forEach: null },
        dueDate: value('jsonata:$substring($.execution.executedAt, 0, 10)'),
        totalAmountPence: value('$.claim.totalAmountPence'),
        lines: {
          kind: 'lines',
          forEach: null,
          rows: [
            { kind: 'line', cells: cells(woodland.payments[0].invoiceLines[0]) }
          ]
        }
      }
    ])
  })

  test('lists every value GAS calculates once, by where it is', () => {
    expect(viewOf(woodland).calculated).toEqual([
      {
        field: 'marketingYear',
        expression: '$substring($.execution.executedAt, 0, 4)'
      },
      {
        field: 'Due date',
        expression: '$substring($.execution.executedAt, 0, 10)'
      },
      {
        field: 'Marketing year (invoice line)',
        expression: '$substring($.execution.executedAt, 0, 4)'
      }
    ])
  })

  test('gives the stored definition as Raw shows it', () => {
    expect(viewOf(woodland).raw).toBe(JSON.stringify(woodland, null, 2))
  })

  test('numbers each due payment of an array out of how many there are', () => {
    expect(
      withPayments([duePayment(), duePayment(), duePayment()]).duePayments.map(
        ({ title }) => title.text
      )
    ).toEqual([
      'Due payment 1 of 3',
      'Due payment 2 of 3',
      'Due payment 3 of 3'
    ])
  })

  test('gives a collection of due payments one card, titled by what it repeats for', () => {
    const [due] = viewOf(pigsMightFly).duePayments

    expect(due).toMatchObject({
      kind: 'due',
      title: {
        text: 'Due payments',
        forEach: '$.agreement.paymentSchedule.instalments'
      },
      dueDate: value('@.dueDate'),
      lines: { kind: 'lines', forEach: '@.lineItems' }
    })
    expect(due).toHaveProperty('lines.rows', [
      {
        kind: 'line',
        cells: cells(pigsMightFly.payments.items.invoiceLines.items)
      }
    ])
  })

  test('leaves a calculated list out of the title, as too long for one', () => {
    const [due] = withPayments({
      itemsRef: 'jsonata:$exists($.claim) ? [$.claim] : $.agreement.rows',
      items: duePayment()
    }).duePayments

    expect(due.title).toEqual({
      text: 'Due payments (one per item of the list it calculates)',
      forEach: null
    })
  })

  test('shows due payments given as one mapping as where they come from', () => {
    expect(withPayments('$.agreement.payments').duePayments).toEqual([
      {
        kind: 'from',
        title: { text: 'Due payments', forEach: null },
        value: value('$.agreement.payments')
      }
    ])
  })

  test('shows a collection whose rows are each a mapping as where they come from', () => {
    expect(
      withPayments({ itemsRef: '$.agreement.rows', items: '@.payment' })
        .duePayments
    ).toEqual([
      {
        kind: 'from',
        title: { text: 'Due payments', forEach: '$.agreement.rows' },
        value: value('@.payment')
      }
    ])
  })

  test('gives each key a due payment or invoice line has not got as null', () => {
    const [due] = withPayments([
      { totalAmountPence: '@.total', invoiceLines: [{ schemeCode: 'WMP' }] }
    ]).duePayments

    expect(due).toMatchObject({ kind: 'due', dueDate: null })
    expect(due).toHaveProperty('lines.rows', [
      { kind: 'line', cells: cells({ schemeCode: 'WMP' }) }
    ])
  })

  test.each([
    ['null', null, value(null)],
    ['one mapping', '@.lines', value('@.lines')]
  ])(
    'shows invoice lines given as %s as where they come from',
    (_name, lines, from) => {
      const [due] = withPayments([
        duePayment({ invoiceLines: lines })
      ]).duePayments

      expect(due).toHaveProperty('lines', { kind: 'from', value: from })
    }
  )

  test('shows an invoice line given as a mapping as where it comes from', () => {
    const [due] = withPayments([
      duePayment({ invoiceLines: ['@.line'] })
    ]).duePayments

    expect(due).toHaveProperty('lines.rows', [
      { kind: 'from', value: value('@.line') }
    ])
  })

  test.each([
    ['an empty array', []],
    ['nothing at all', undefined]
  ])('gives no due payments for %s', (_name, payments) => {
    expect(withPayments(payments).duePayments).toEqual([])
  })

  test.each([
    [
      'a collection inside the array',
      [{ itemsRef: '$.agreement.rows', items: duePayment() }]
    ],
    ['an array inside the array', [[duePayment()]]],
    ['a collection whose items are a list', { itemsRef: '$.rows', items: [] }]
  ])(
    'shows %s as where it comes from, since GAS resolves it to a nested list it rejects',
    (_name, payments) => {
      const [due] = withPayments(payments).duePayments

      expect(due).toMatchObject({ kind: 'from' })
    }
  )

  test('shows a collection inside the invoice lines as where its line comes from, not as a line', () => {
    const nested = { itemsRef: '@.rows', items: { amountPence: '@.p' } }
    const [due] = withPayments([
      duePayment({ invoiceLines: [nested] })
    ]).duePayments

    expect(due).toHaveProperty('lines.rows', [
      { kind: 'from', value: value(nested) }
    ])
  })
})
