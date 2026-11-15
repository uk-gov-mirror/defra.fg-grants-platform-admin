import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import type {
  Chip,
  EntitlementsTab
} from '../../../view-models/grant-entitlements.ts'

const testId = 'grant-entitlements'

const flatten = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="${testId}-${name}"]`)

const textOf = ($: CheerioAPI, name: string) => flatten(part($, name).text())

const offered: Chip = {
  label: 'OFFERED',
  code: 'POST_AWARD:AGREEMENT:OFFERED',
  any: null,
  href: '/phases?status=POST_AWARD:AGREEMENT:OFFERED'
}

const complete: Chip = {
  label: 'CLAIMS_COMPLETE',
  code: 'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE',
  any: null,
  href: '/phases?status=POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
}

const agreementStage: Chip = {
  label: 'POST_AWARD:AGREEMENT',
  code: 'POST_AWARD:AGREEMENT',
  any: 'status',
  href: '/phases#phase-POST_AWARD'
}

const claimPhase: Chip = {
  label: 'CLAIM',
  code: 'CLAIM',
  any: 'stage-and-status',
  href: '/phases#phase-CLAIM'
}

type TemplateCard = EntitlementsTab['templates'][number]

const template = (overrides: Partial<TemplateCard> = {}): TemplateCard => ({
  claimCode: 'MAINTENANCE',
  name: 'Maintenance payment',
  description: null,
  materialised: false,
  maxEntitlements: 10,
  availableAt: [offered],
  claim: {
    claimableAt: [agreementStage],
    maximumClaims: 10,
    partial: false,
    approval: false,
    evidence: true
  },
  onSubmit: { kind: 'requests-payment', payment: 'stored', move: null },
  onSubmitRole: 'success',
  warnings: [],
  fields: [],
  help: null,
  ...overrides
})

const tab = (overrides: Partial<EntitlementsTab> = {}): EntitlementsTab => ({
  nothing: false,
  claims: { move: null, paymentHref: null, paymentLink: null, roles: null },
  templates: [template()],
  ...overrides
})

const renderTab = (overrides: Partial<EntitlementsTab> = {}) =>
  render('grant-entitlements', { view: tab(overrides), testId })

const withTemplate = (overrides: Partial<TemplateCard>) =>
  renderTab({ templates: [template(overrides)] })

const factText = ($: CheerioAPI, id: string) =>
  flatten(part($, `fact-${id}`).find('dd').text())

describe('grantEntitlements: the Claims card', () => {
  test('is headed as applying to all templates', () => {
    const $ = renderTab()

    expect(part($, 'claims').find('h2').text()).toBe('Claims (all templates)')
    expect(part($, 'claims').attr('aria-labelledby')).toBe(
      part($, 'claims').find('h2').attr('id')
    )
  })

  test('shows the move after the last claim on one row, saying it moves to', () => {
    const $ = renderTab({
      claims: {
        move: { from: offered, to: complete },
        paymentHref: null,
        paymentLink: null,
        roles: null
      }
    })
    const move = part($, 'move')

    expect(move.find('dt').text()).toBe('After the last claim')
    expect(move.find('dd > span').attr('class')).toBe(
      'inline-flex flex-wrap items-center gap-1'
    )
    expect(move.find('.sr-only').first().text()).toBe(', open in Phases')
    expect(flatten(move.find('dd').text())).toBe(
      'OFFERED, open in Phases moves to CLAIMS_COMPLETE, open in Phases'
    )
  })

  test('shows a dash for no move and no payment definition, and any operator for no roles', () => {
    const $ = renderTab()

    expect(part($, 'move').find('dd').text().trim()).toBe('—')
    expect(part($, 'payment-file').find('dt').text()).toBe('Payment definition')
    expect(part($, 'payment-file').find('dd').text().trim()).toBe('—')
    expect(flatten(part($, 'roles').find('dd').text())).toBe('Any operator')
  })

  test('says all of and any of for the roles', () => {
    const $ = renderTab({
      claims: {
        move: null,
        paymentHref: '/payment',
        paymentLink: 'Not stored yet · Payment tab ›',
        roles: { allOf: ['ROLE_A'], anyOf: ['ROLE_B', 'ROLE_C'] }
      }
    })

    expect(part($, 'payment-file').find('a').text()).toBe(
      'Not stored yet · Payment tab ›'
    )
    expect(
      part($, 'roles')
        .find('dd > div')
        .toArray()
        .map((line) => flatten($(line).text()))
    ).toEqual(['all of: ROLE_A', 'any of: ROLE_B, ROLE_C'])
    expect(part($, 'payment-file').find('a').attr('href')).toBe('/payment')
  })

  test('is the only card, saying so, when nothing can be claimed', () => {
    const $ = renderTab({ nothing: true, templates: [] })

    expect(textOf($, 'nothing')).toBe(
      'No entitlement templates in this version, so nothing can be claimed on it.'
    )
    expect(part($, 'claims')).toHaveLength(0)
    expect(part($, 'empty')).toHaveLength(0)
  })

  test('says there are no templates, still showing the Claims card', () => {
    const $ = renderTab({ templates: [] })

    expect(textOf($, 'empty')).toBe('No entitlement templates.')
    expect(part($, 'claims')).toHaveLength(1)
  })
})

describe('grantEntitlements: a template card', () => {
  test('titles the card with its claim code, the name stacking beneath on a phone', () => {
    const $ = renderTab()
    const title = part($, 'template-title')

    expect(flatten(title.text())).toBe('MAINTENANCE Maintenance payment')
    expect(title.attr('class')).toContain('flex-wrap')
    expect(title.children('span').last().attr('class')).toContain(
      'basis-full font-normal sm:basis-auto'
    )
    expect(textOf($, 'grant-ops')).toBe(
      'Shown in Grant Ops as a claimable item.'
    )
  })

  test('says no claimable item of a materialised template', () => {
    const $ = withTemplate({ materialised: true })

    expect(part($, 'grant-ops')).toHaveLength(0)
    expect(factText($, 'created-by')).toBe(
      "materialised: projected from the application's position and past claims. GAS doesn't derive these yet, so nothing can be claimed against them"
    )
  })

  test('says how it is created, and where it can be claimed', () => {
    const $ = renderTab()

    expect(
      part($, 'template')
        .find('h3')
        .toArray()
        .map((head) => $(head).text())
    ).toEqual(["How it's created", 'Claiming'])
    expect(factText($, 'created-by')).toBe('an operator (claimable item)')
    expect(part($, 'fact-max-entitlements').find('dt').text()).toBe(
      'Max per application'
    )
    expect(part($, 'fact-available-at').find('dt').text()).toBe(
      'Can be created at'
    )
    expect(factText($, 'claimable-at')).toBe(
      'POST_AWARD:AGREEMENT any status, open in Phases'
    )
  })

  test('draws a chip as a quiet badge naming its position, opening it in Phases', () => {
    const $ = withTemplate({ availableAt: [offered, claimPhase] })
    const [full, phase] = part($, 'fact-available-at')
      .find('[data-testid="grant-entitlements-chip"]')
      .toArray()

    expect($(full).attr('class')).toContain('badge badge-ghost badge-sm')
    expect($(full).attr('class')).toContain('w-fit')
    expect($(full).attr('class')).toContain('border-base-300')
    expect($(full).attr('title')).toBe(
      'POST_AWARD:AGREEMENT:OFFERED: open in Phases'
    )
    expect($(full).attr('href')).toBe(offered.href)
    expect(flatten($(phase).text())).toBe(
      'CLAIM any stage, any status, open in Phases'
    )
    expect($(phase).attr('href')).toBe('/phases#phase-CLAIM')
  })

  test('shows a dash for every Claiming rule when there is no claim', () => {
    const $ = withTemplate({ claim: null })

    expect(
      ['claimable-at', 'max-claims', 'partial', 'approval', 'evidence'].map(
        (id) => factText($, id)
      )
    ).toEqual(['—', '—', '—', '—', '—'])
  })

  test.each([
    [
      { kind: 'cant-claim', reason: 'materialised' },
      "Can't be claimed (materialised: GAS doesn't derive these yet)"
    ],
    [
      { kind: 'cant-claim', reason: 'no-claimable-at' },
      "Can't be claimed (no Claimable at)"
    ],
    [
      { kind: 'waits-for-approval' },
      'Waits for approval · GAS has no approval step yet, so these claims stay awaiting: no payment, no move.'
    ],
    [
      { kind: 'requests-payment', payment: 'stored', move: null },
      'Requests payment'
    ],
    [{ kind: 'no-payment-file', move: null }, 'No payment file']
  ] as const)('says on submit %j', (onSubmit, text) => {
    const $ = withTemplate({ onSubmit })

    expect(textOf($, 'on-submit')).toBe(text)
    expect(part($, 'summary').find('dt').text()).toBe('On submit')
  })

  test('says a payment definition not stored yet is fetched when first needed', () => {
    const $ = withTemplate({
      onSubmit: { kind: 'requests-payment', payment: 'not-stored', move: null }
    })

    expect(textOf($, 'payment-not-stored')).toBe(
      'Payment definition not stored yet: GAS fetches it when it first needs it.'
    )
    expect(part($, 'payment-failed')).toHaveLength(0)
  })

  test('says claim payments fail when GAS has marked the payment definition failed', () => {
    const $ = withTemplate({
      onSubmit: { kind: 'requests-payment', payment: 'failed', move: null }
    })

    expect(textOf($, 'payment-failed')).toBe(
      'Payment definition failed: these claim payments fail.'
    )
    expect(part($, 'payment-not-stored')).toHaveLength(0)
  })

  test('draws the On submit outcome as a status badge in its role', () => {
    const $ = withTemplate({ onSubmitRole: 'warning' })

    expect(
      part($, 'on-submit').find('[data-testid="do-status-dot"]').attr('class')
    ).toBe('status status-warning')
  })

  test('says where the last claim moves the application', () => {
    const $ = withTemplate({
      onSubmit: {
        kind: 'requests-payment',
        payment: 'stored',
        move: { from: offered, to: complete }
      }
    })

    expect(textOf($, 'moves')).toBe(
      'Moves the application to CLAIMS_COMPLETE, open in Phases when the last claim is submitted at OFFERED, open in Phases'
    )
  })

  test.each([
    [
      { kind: 'materialised-claim', claimCode: 'CAPITAL' },
      "CAPITAL is materialised, which GAS doesn't derive yet, so its claim rules never apply."
    ],
    [
      { kind: 'no-claimable-at', claimCode: 'ENT_CS_CAPITAL_PA3' },
      'ENT_CS_CAPITAL_PA3 can\'t be claimed: its claim rules list no "Claimable at" status, so GAS rejects every claim (WRONG_POSITION). Publish a version that sets claim.claimableAt.'
    ],
    [
      {
        kind: 'claim-payment-reads-agreement',
        claimCode: 'MAINTENANCE',
        paymentHref: '/payment'
      },
      'MAINTENANCE requests payment on submit, but the payment definition reads $.agreement: claim payments can only read $.claim and $.execution, so these fields resolve empty and GAS refuses the payment.'
    ]
  ] as const)(
    'warns at the top of the card, with no alert role: %j',
    (warning, text) => {
      const $ = withTemplate({ warnings: [warning] })
      const shown = part($, 'warning')

      expect(textOf($, 'warning')).toBe(text)
      expect(shown.attr('role')).toBeUndefined()
      expect(
        shown.closest('[data-testid="grant-entitlements-template"]')
      ).toHaveLength(1)
    }
  )

  test('says where each field comes from, with a fixed value in a code block', () => {
    const $ = withTemplate({
      fields: [
        {
          name: 'hectares',
          source: 'Entered',
          text: 'Area maintained',
          unit: 'decimal (ha)',
          bounds: ['min 0.1', '2 dp']
        },
        {
          name: 'agreementRef',
          source: 'From agreement',
          text: '$.agreement.agreementNumber',
          unit: 'string',
          bounds: []
        }
      ]
    })
    const rows = part($, 'field')
      .toArray()
      .map((row) =>
        $(row)
          .children('td')
          .toArray()
          .map((cell) => flatten($(cell).text()))
      )

    expect(rows).toEqual([
      [
        'hectares',
        'Entered',
        'Area maintained',
        'decimal (ha)',
        'min 0.1, 2 dp'
      ],
      [
        'agreementRef',
        'From agreement',
        '$.agreement.agreementNumber',
        'string',
        '—'
      ]
    ])
    expect(part($, 'field').last().find('code')).toHaveLength(1)
    expect(part($, 'fields').find('table').attr('class')).toContain(
      'min-w-[40rem]'
    )
  })

  test('shows help closed, with its paragraphs and bullets', () => {
    const $ = withTemplate({
      help: {
        summary: 'What counts',
        content: [{ text: 'Mown once.' }, { items: ['Cut', 'Graze'] }]
      }
    })
    const help = part($, 'help')

    expect(help.attr('open')).toBeUndefined()
    expect(flatten(help.find('summary').text())).toBe('Help · What counts')
    expect(help.find('p').text()).toBe('Mown once.')
    expect(
      help
        .find('li')
        .toArray()
        .map((li) => $(li).text())
    ).toEqual(['Cut', 'Graze'])
  })
})
