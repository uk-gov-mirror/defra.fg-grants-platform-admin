import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import { toPaymentDefinition } from '../../../view-models/payment-definition.ts'

const testId = 'payment'

const flatten = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="${testId}-${name}"]`)

const textOf = ($: CheerioAPI, name: string) => flatten(part($, name).text())

const viewOf = (
  definition: Record<string, unknown>,
  agreementHref: string | null = '/agreement'
) =>
  render('payment-definition', {
    view: toPaymentDefinition(definition, {
      version: '1.0.1',
      hrefs: { entitlements: '/entitlements', agreement: agreementHref }
    }),
    testId
  })

const claimPayment = {
  code: 'woodland',
  sbi: '$.claim.sbi',
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
          marketingYear: 'jsonata:$substring($.execution.executedAt, 0, 4)'
        }
      ]
    }
  ]
}

const agreementPayment = {
  code: 'pigs-might-fly',
  sbi: '$.agreement.identifiers.sbi',
  payments: {
    itemsRef: '$.agreement.paymentSchedule.instalments',
    items: {
      dueDate: '@.dueDate',
      totalAmountPence: '@.totalAmountPence',
      invoiceLines: {
        itemsRef: '@.lineItems',
        items: { schemeCode: 'CMOR1', amountPence: '@.amountPence' }
      }
    }
  }
}

describe('payment-definition component: when GAS requests it', () => {
  test('says a claim payment is requested on a claim, what it reads and which payments use it', () => {
    const $ = viewOf(claimPayment)

    expect(part($, 'when').find('h2').text()).toBe(
      'When GAS requests this payment'
    )
    expect(textOf($, 'requested-when')).toBe(
      'Requested when a claim is submitted (claim payments) Entitlements ›'
    )
    expect(part($, 'requested-when').find('a').attr('href')).toBe(
      '/entitlements'
    )
    expect(textOf($, 'reads')).toBe(
      'Reads $.claim the submitted claim · $.execution.executedAt when GAS ran it'
    )
    expect(textOf($, 'used-for')).toBe(
      "Used for agreement payments whose agreement is on 1.0.1 (the version it was created or accepted under, see the Agreement tab), and claims on applications currently on 1.0.1. GAS has no fallback: if this file can't load, those payments fail."
    )
    expect(part($, 'used-for').find('a').attr('href')).toBe('/agreement')
    expect(part($, 'mixed')).toHaveLength(0)
  })

  test('says an agreement payment is requested by an agreement action, unlinked when there is no Agreement tab', () => {
    const $ = viewOf(agreementPayment, null)

    expect(textOf($, 'requested-when')).toBe(
      'Requested when an agreement action runs CREATE_AGREEMENT_PAYMENT'
    )
    expect(part($, 'used-for').find('a')).toHaveLength(0)
    expect(part($, 'requested-when').find('a')).toHaveLength(0)
  })

  test('says both, and that claim payments find no agreement, when it reads both', () => {
    const $ = viewOf({
      code: 'qa-complex',
      sbi: 'jsonata:$.claim.sbi ?? $.agreement.identifiers.sbi'
    })

    expect(part($, 'requested-on-claim')).toHaveLength(1)
    expect(part($, 'requested-on-agreement')).toHaveLength(1)
    expect(textOf($, 'mixed')).toBe(
      'This definition reads $.agreement, but claim payments can only read $.claim and $.execution, so these fields resolve empty and GAS refuses the payment.'
    )
  })
})

describe('payment-definition component: due payments', () => {
  test('lists the request fields with where each comes from', () => {
    const $ = viewOf(claimPayment)

    expect(part($, 'request').find('h2').text()).toBe('Payment request')
    expect(
      part($, 'fields-comes-from')
        .toArray()
        .map((cell) => $(cell).text())
    ).toEqual(['copied', 'calculated'])
  })

  test('titles a lone due payment, marking where each value comes from', () => {
    const $ = viewOf(claimPayment)

    expect(textOf($, 'due-title')).toBe('Due payment')
    expect(textOf($, 'due-fact-total')).toBe(
      'Total (pence) $.claim.totalAmountPence copied'
    )
    expect(part($, 'due').find('section')).toHaveLength(0)
  })

  test('says calculated in an invoice line, opening the expression beneath the line', () => {
    const $ = viewOf(claimPayment)
    const cells = part($, 'line')
      .find('td')
      .toArray()
      .map((cell) => flatten($(cell).text()))

    expect(cells).toEqual([
      'WMP fixed',
      'Woodland Management Plan Payment fixed',
      '$.claim.totalAmountPence copied',
      '—',
      '—',
      '—',
      'calculated (see Calculated fields)'
    ])
    expect(flatten(part($, 'line-expressions').find('dl').text())).toBe(
      'Marketing year $substring($.execution.executedAt, 0, 4)'
    )
    expect(part($, 'lines').parent().attr('class')).toContain('overflow-x-auto')
  })

  test('titles a collection by what it repeats for, with For each on its own row', () => {
    const $ = viewOf(agreementPayment)

    expect(textOf($, 'due-title')).toBe(
      'Due payments (one per item of $.agreement.paymentSchedule.instalments)'
    )
    expect(textOf($, 'due-fact-for-each')).toBe(
      'For each $.agreement.paymentSchedule.instalments'
    )
    expect(textOf($, 'for-each')).toBe('One line per row of @.lineItems')
    expect(part($, 'row-ids')).toHaveLength(1)
    expect(
      part($, 'when').find('[data-testid="payment-row-ids"]')
    ).toHaveLength(1)
    expect(textOf($, 'row-ids')).toBe(
      'Reads the stored agreement, where GAS has replaced actionRef/itemRef/ref with stable ids: actionId, itemId, id (action:1, item:1).'
    )
  })

  test('says what GAS checks after resolving', () => {
    expect(textOf(viewOf(claimPayment), 'checks')).toBe(
      'GAS checks after resolving: every field is present, as text or whole pence; each due payment has at least one invoice line and its total equals its lines; the request total equals the due payments. A payment that fails is not created.'
    )
  })

  test('says when there are no due payments, with no checks', () => {
    const $ = viewOf({ code: 'woodland', payments: [] })

    expect(textOf($, 'no-due')).toBe(
      'No due payments: GAS needs at least one, so every payment for this version fails.'
    )
    expect(part($, 'no-due').attr('class')).toContain('alert-warning')
    expect(part($, 'checks')).toHaveLength(0)
  })

  test('says when a due payment has no invoice lines', () => {
    const $ = viewOf({ code: 'woodland', payments: [{ dueDate: '@.d' }] })

    expect(textOf($, 'no-lines')).toBe(
      'No invoice lines: GAS needs at least one on each due payment, so every payment for this version fails.'
    )
    expect(part($, 'no-lines').attr('class')).toContain('alert-warning')
  })
})
