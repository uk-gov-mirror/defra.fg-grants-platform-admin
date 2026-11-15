import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import type {
  AgreementDefinition,
  GrantAgreement
} from '../../../use-cases/get-grant-page.use-case.ts'
import { agreementDefinition } from '../../../use-cases/test-fixtures.ts'
import { toAgreementTab } from '../../../view-models/grant-agreement.view-model.ts'
import type { AgreementContext } from '../../../view-models/grant-agreement.view-model.ts'

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

const tabOf = (
  overrides: Partial<GrantAgreement> = {},
  given: AgreementContext = context
) =>
  render('agreement-definition', {
    tab: toAgreementTab(
      {
        definition: agreementDefinition,
        addresses,
        problem: null,
        ...overrides
      },
      given
    ),
    environment: 'dev',
    testId: 'agreement'
  })

const withDefinition = (changes: Partial<AgreementDefinition>) =>
  tabOf({ definition: { ...agreementDefinition, ...changes } })

const part = ($: CheerioAPI, testId: string) =>
  $(`[data-testid="agreement-${testId}"]`)

const flatten = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

const textOf = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).text())

const headsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .find('thead th')
    .toArray()
    .map((head) => $(head).text())

const factText = ($: CheerioAPI, id: string) =>
  flatten(part($, `fact-${id}`).find('dd').text())

describe('agreement-definition component: facts', () => {
  test('starts with the facts card, under a visible heading', () => {
    const $ = tabOf()
    const card = part($, 'overview')

    expect(card.find('h2').text()).toBe('Agreement definition')
    expect(card.attr('aria-labelledby')).toBe(card.find('h2').attr('id'))
    expect(
      card
        .find('dt')
        .toArray()
        .map((label) => $(label).text())
    ).toEqual([
      'Code',
      'Number prefix',
      'Reads application answers from',
      'Created when',
      'Runs on create',
      'Text templates'
    ])
  })

  test('says agreements are created when the grant runs GENERATE_OFFER, linking to Phases', () => {
    const $ = tabOf()

    expect(factText($, 'created-when')).toBe(
      'the grant runs GENERATE_OFFER on a Phases move · see Phases ›'
    )
    expect(part($, 'fact-created-when').find('a').attr('href')).toBe('/phases')
  })

  test("titles each text template with its template's words", () => {
    const $ = withDefinition({
      templates: {
        capitalItems: {
          'QA-HEDGE': {
            content: [
              { component: 'paragraph', text: 'Hedgerow: @.quantity @.unit' }
            ]
          }
        }
      }
    })

    expect(part($, 'fact-templates').find('[title]').attr('title')).toBe(
      'Hedgerow: @.quantity @.unit'
    )
  })

  test('lists root endpoints, saying which service has no URL here', () => {
    const $ = tabOf({
      definition: {
        ...agreementDefinition,
        endpoints: [
          { code: 'qa-unset', method: 'POST', path: '/qa', service: 'QA_UNSET' }
        ]
      },
      endpointAddresses: [{ code: 'qa-unset', service: 'QA_UNSET', url: null }],
      missingServiceUrls: ['QA_UNSET_URL']
    })

    expect(textOf($, 'endpoint')).toBe(
      'qa-unset· POST /qa QA_UNSET · not configured in GAS on dev (QA_UNSET_URL unset)'
    )
  })

  test('says only that there is no usable URL when GAS lists the service as set', () => {
    const $ = tabOf({
      definition: {
        ...agreementDefinition,
        endpoints: [
          { code: 'qa-bad', method: 'POST', path: '/qa', service: 'QA_BAD' }
        ]
      },
      endpointAddresses: [{ code: 'qa-bad', service: 'QA_BAD', url: null }],
      missingServiceUrls: []
    })

    expect(textOf($, 'endpoint')).toBe(
      'qa-bad· POST /qa QA_BAD · no usable URL in GAS on dev (QA_BAD_URL unset or invalid)'
    )
  })

  test('lists root endpoints with no word on their URL from an older GAS', () => {
    const $ = withDefinition({
      endpoints: [
        { code: 'qa-unset', method: 'POST', path: '/qa', service: 'QA_UNSET' }
      ]
    })

    expect(textOf($, 'endpoint')).toBe('qa-unset· POST /qa QA_UNSET')
  })
})

describe('agreement-definition component: unset service URLs', () => {
  test('warns above States that GAS will not load the definition here', () => {
    const $ = tabOf({ missingServiceUrls: ['QA_COMPLEX_UNSET_URL'] })
    const alert = part($, 'missing-urls')

    expect(flatten(alert.text())).toBe(
      "QA_COMPLEX_UNSET_URL is unset in GAS here, and GAS won't load this agreement definition while any service it names has no URL. On this environment, agreements that resolve to it can't be created, and while it is the newest usable 3.x definition, actions on 3.x agreements before acceptance fail too (see the States caption)."
    )
    expect(alert.next().attr('data-testid')).toBe('agreement-states')
  })

  test('names every unset URL', () => {
    const $ = tabOf({ missingServiceUrls: ['A_URL', 'B_URL', 'C_URL'] })

    expect(textOf($, 'missing-urls')).toMatch(
      /^A_URL, B_URL and C_URL are unset in GAS here/
    )
  })

  test('says nothing when GAS does not say, even for an address with no URL', () => {
    expect(part(tabOf(), 'missing-urls')).toHaveLength(0)
  })
})

describe('agreement-definition component: States', () => {
  test('says which agreement definition GAS runs actions with', () => {
    const $ = tabOf()

    expect(textOf($, 'states-caption')).toBe(
      'Until an agreement is accepted, GAS runs its actions with the newest usable 3.x agreement definition, which may not be this one. From accepted on, it stays on the version it was accepted under.'
    )
  })

  test('heads the columns, with the page view column only when a state runs one', () => {
    expect(headsOf(tabOf(), 'states-table')).toEqual([
      'State',
      'Shows page',
      'Runs on each page view',
      'Action',
      'Moves to',
      'Requires',
      'Runs'
    ])
    expect(part(tabOf(), 'page-view-head').attr('title')).toBe(
      'Runs every time the customer opens any page while the agreement is in this state; outputs are not saved.'
    )
  })

  test('spans each state over its actions, with a rule between states', () => {
    const $ = tabOf()
    const [offered] = part($, 'state').toArray()
    const rows = $(offered).find('tr')

    expect($(offered).attr('class')).toBe('border-t border-base-300')
    expect(rows).toHaveLength(3)
    expect(rows.first().find('th').attr('rowspan')).toBe('3')
    expect(rows.eq(1).find('th')).toHaveLength(0)
  })

  test('marks the initial state and the one that locks the version with quiet badges', () => {
    const $ = tabOf()

    expect(part($, 'initial').attr('class')).toBe(
      'badge badge-ghost badge-sm ml-1.5'
    )
    expect(part($, 'locks-version').text()).toBe('locks version')
    expect(part($, 'locks-version').attr('title')).toBe(
      'Until an agreement is accepted, GAS runs its actions with the newest usable 3.x agreement definition, which may not be this one. From accepted on, it stays on the version it was accepted under.'
    )
  })

  test('links each shown page to its row, and says what an action requires', () => {
    const $ = tabOf()
    const first = part($, 'state-row').first()

    expect(first.find('a[href="#page-offered"]')).toHaveLength(1)
    expect(textOf($, 'rule')).toBe(
      'confirm = $.form.confirmConfirm you have read the terms'
    )
    expect(flatten(first.find('td').eq(2).text())).toBe(
      'acceptopens page accept'
    )
  })

  test('says a move to its own state stays, and what a move sets', () => {
    const $ = withDefinition({
      states: {
        offered: {
          on: {
            refresh: {
              target: 'offered',
              values: { totalAmountPence: '$.agreement.totalAmountPence' }
            }
          }
        }
      }
    })
    const cells = part($, 'state-row').find('td')

    expect(flatten(cells.eq(2).text())).toBe('stays offered')
    expect(textOf($, 'sets')).toBe('Sets totalAmountPence')
  })

  test('says a state with no actions has none', () => {
    const $ = tabOf()
    const cancelled = part($, 'state-row').eq(5)

    expect(flatten(cancelled.find('td').last().text())).toBe('No actions')
    expect(cancelled.find('td').last().attr('colspan')).toBe('4')
  })

  test('below sm, draws each state as a small block instead of the table', () => {
    const $ = tabOf()
    const blocks = part($, 'state-block')

    expect(part($, 'state-blocks').attr('class')).toContain('sm:hidden')
    expect(part($, 'states-table').parent().attr('class')).toContain(
      'hidden w-full overflow-x-auto sm:block'
    )
    expect(
      blocks
        .first()
        .children()
        .toArray()
        .map((line) => flatten($(line).text()))
    ).toEqual([
      'offered initial · shows offered',
      'accept → accepted · runs CREATE_AGREEMENT_PAYMENT',
      'withdraw → withdrawn',
      'cancel → cancelled'
    ])
  })
})

describe('agreement-definition component: Pages', () => {
  test('gives each page a row to link to, its title and what else it shows', () => {
    const $ = tabOf()
    const document = part($, 'page-row').filter('#page-document')

    expect(document).toHaveLength(1)
    expect(headsOf($, 'pages-table')).toEqual(['Page', 'Title'])
    expect(
      flatten(document.find('[data-testid="agreement-page-details"]').text())
    ).toBe('layout document · parties · actions · payments · terms')
    expect(
      flatten(document.find('[data-testid="agreement-page-components"]').text())
    ).toBe('Components: heading')
  })

  test('lists the buttons on a page, warning of one whose action has no page', () => {
    const $ = withDefinition({
      pages: {
        accepted: {
          title: 'Agreement accepted',
          components: [
            {
              component: 'button',
              text: 'End this agreement',
              action: 'terminate'
            }
          ]
        },
        offered: {
          title: 'Your offer',
          components: [
            { component: 'button', text: 'Review and accept', action: 'accept' }
          ]
        }
      }
    })
    const buttons = part($, 'page-button')

    expect(
      buttons.toArray().map((button) => flatten($(button).text()))
    ).toEqual([
      'Review and accept → accept (page accept)',
      '⚠ terminate has no page: this button returns an error'
    ])
    expect(buttons.last().attr('class')).toBe('text-warning')
  })
})

describe('agreement-definition component: Created with', () => {
  test('lists what the agreement is created with, as the Payment tab lists fields', () => {
    const $ = withDefinition({
      create: {
        target: 'offered',
        application: '$.input.answers',
        values: { schemeCode: 'QA-COMPLEX' }
      }
    })

    expect(part($, 'created-with').find('h2').text()).toBe('Created with')
    expect(
      $('[data-testid="agreement-created-with-fields-comes-from"]').text()
    ).toBe('fixed')
  })

  test('is left out when the definition creates with no values', () => {
    expect(part(tabOf(), 'created-with')).toHaveLength(0)
  })
})

describe('agreement-definition component: Processes', () => {
  test('names each type in words, linking the payment handler to the Payment tab', () => {
    const $ = tabOf()

    expect(
      part($, 'process-type')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    ).toEqual([
      'HTTP call',
      'HTTP call',
      'Built into GASrequests the agreement payment (see Payment ›)'
    ])
    expect(part($, 'process-type').last().find('a').attr('href')).toBe(
      '/payment'
    )
  })

  test('keeps the path of a call with no URL here, naming the unset variable', () => {
    const $ = tabOf({ missingServiceUrls: ['AGREEMENT_DOCS_URL'] })
    const terms = part($, 'process-row').eq(1)

    expect(flatten(terms.find('td').eq(2).text())).toBe(
      'GET /terms AGREEMENT_DOCS · not configured in GAS on dev (AGREEMENT_DOCS_URL unset)'
    )
  })

  test('says what a call sends, and where its outputs land', () => {
    const $ = withDefinition({
      processDefinitions: {
        LOOK_UP_SCHEME_NAME: {
          type: 'endpoint',
          endpoint: { method: 'GET', path: '/health', service: 'QA_HEALTH' },
          request: {
            body: {
              probe: 'qa-complex',
              farmType: '$.application.farmType',
              limit: 5,
              where: { sbi: '$.application.sbi' }
            }
          },
          output: { name: "jsonata:'QA (' & $.response.message & ')'" }
        }
      },
      create: {
        target: 'offered',
        application: '$.input.answers',
        processes: ['LOOK_UP_SCHEME_NAME']
      }
    })

    expect(textOf($, 'process-sends')).toBe(
      'Sends (body sent with a GET)probe = qa-complexfarmType ← $.application.farmTypelimit = 5wheresbi ← $.application.sbi'
    )
    expect(
      part($, 'process-sends')
        .find('div')
        .toArray()
        .map((row) => $(row).attr('class'))
    ).toEqual([
      'text-sm pl-0',
      'text-sm pl-0',
      'text-sm pl-0',
      'text-sm pl-0',
      'text-sm pl-4'
    ])
    expect(textOf($, 'process-output')).toBe(
      "name ← 'QA (' & $.response.message & ')'"
    )
    expect(textOf($, 'process-lands')).toBe('saved to the agreement')
  })

  test('lists the fields of a nested output, and says when a list is empty', () => {
    const $ = withDefinition({
      processDefinitions: {
        GENERATE_OFFER: {
          type: 'endpoint',
          endpoint: { method: 'POST', path: '/offer', service: 'LAND_DATA' },
          request: { body: {} },
          output: {
            actions: {
              itemsRef: 'jsonata:$.response.lines[quantity > 0]',
              items: { ref: '@.pigType', code: 'PIGS' }
            },
            items: []
          }
        }
      }
    })

    expect(
      part($, 'process-output')
        .toArray()
        .map((row) => [flatten($(row).text()), $(row).attr('class')])
    ).toEqual([
      ['actions for each $.response.lines[quantity > 0]', 'text-sm pl-0'],
      ['ref ← @.pigType', 'text-sm pl-4'],
      ['code = PIGS', 'text-sm pl-4'],
      ['items empty list', 'text-sm pl-0']
    ])
    expect(part($, 'processes').text()).not.toContain('jsonata:')
  })

  test('shows a long output expression in full, not cut to two lines', () => {
    const expression =
      "$fromMillis($toMillis($.application.agreementStartDate) + 3 * 365 * 86400000, '[Y0001]-[M01]-[D01]')"
    const $ = withDefinition({
      processDefinitions: {
        LOOK_UP_END_DATE: {
          type: 'endpoint',
          endpoint: { method: 'GET', path: '/health', service: 'QA_HEALTH' },
          request: { body: {} },
          output: { endDate: `jsonata:${expression}` }
        }
      },
      create: {
        target: 'offered',
        application: '$.input.answers',
        processes: ['LOOK_UP_END_DATE']
      }
    })
    const output = part($, 'process-output')

    expect(flatten(output.text())).toBe(`endDate ← ${expression}`)
    expect(output.find('[data-expression]')).toHaveLength(0)
    expect(output.find('[class*="line-clamp"]')).toHaveLength(0)
  })

  test("shows a section's condition without its jsonata: prefix", () => {
    const $ = withDefinition({
      pages: {
        document: {
          title: 'Agreement document',
          sections: [
            {
              id: 'acceptance',
              condition: "jsonata:$.agreement.state = 'accepted'"
            }
          ],
          components: [{ component: 'heading' }]
        }
      }
    })

    expect(textOf($, 'page-details')).toBe(
      "acceptance (shown when $.agreement.state = 'accepted')"
    )
  })

  test('says when there are no processes, with no table', () => {
    const $ = withDefinition({ processDefinitions: undefined })

    expect(textOf($, 'no-processes')).toBe('No processes.')
    expect(part($, 'processes-table')).toHaveLength(0)
  })

  test('scrolls each table inside its card, with headers that never wrap', () => {
    const $ = tabOf()

    for (const name of ['states-table', 'pages-table', 'processes-table']) {
      expect(part($, name).parent().attr('class')).toContain('overflow-x-auto')
      expect(part($, name).attr('class')).toMatch(/min-w-\[/)
      expect(part($, name).find('thead th').first().attr('class')).toBe(
        'whitespace-nowrap'
      )
    }
  })
})

describe('agreement-definition component: a definition GAS cannot load', () => {
  test('says why, what it stops and what to do, breaking the reason as a code', () => {
    const $ = tabOf({
      problem: 'Field "CREATE_AGREEMENT_PAYMENT.input" is unknown'
    })
    const alert = part($, 'problem')

    expect(flatten(alert.text())).toBe(
      'GAS can\'t load this agreement definition, so agreements that resolve to it can\'t be created or progressed. Reason: Field "CREATE_AGREEMENT_PAYMENT.input" is unknown. Publish a corrected version.'
    )
    expect(alert.find('span.break-words')).toHaveLength(1)
    expect(alert.find('wbr').length).toBeGreaterThan(0)
    expect(part($, 'overview')).toHaveLength(0)
    expect(part($, 'states')).toHaveLength(0)
  })

  test('says what GAS uses instead once it has marked the file unusable', () => {
    const $ = tabOf(
      { problem: 'bad' },
      { ...context, fetchStatus: 'permanent_error' }
    )

    expect(textOf($, 'problem-failed')).toBe(
      'GAS has marked this file unusable. New agreements use the newest usable 3.x agreement definition at or below 3.16.3; actions before acceptance use the newest usable 3.x one, which may be later.'
    )
  })

  test('treats an empty problem as a problem', () => {
    expect(part(tabOf({ problem: '' }), 'problem')).toHaveLength(1)
  })
})
