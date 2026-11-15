import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import type {
  EntitlementTemplate,
  GrantEntitlements,
  GrantVersionPage
} from '../use-cases/get-grant-page.use-case.ts'
import { getGrantPageUseCase } from '../use-cases/get-grant-page.use-case.ts'
import { grantVersionHeader, pendingFile } from '../use-cases/test-fixtures.ts'
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

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

let server: Server

const viewTab = async (tab: string) => {
  const { result, headers } = await server.inject({
    method: 'GET',
    url: `${path}?tab=${tab}`,
    auth: { strategy: 'session', credentials }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return $
}

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const texts = ($: CheerioAPI, selector: string) =>
  $(selector)
    .toArray()
    .map((node) => flatten($(node).text()))

const givenGrant = (overrides: Partial<GrantVersionPage>) =>
  vi.mocked(getGrantPageUseCase).mockResolvedValue({
    outcome: 'found',
    page: {
      header: grantVersionHeader,
      sourceErrors: [],
      sectionErrors: [],
      ...overrides
    }
  })

const definition = (extra: object) => ({
  code: 'woodland-creation',
  version: '1.2.0',
  actions: [],
  ...extra
})

const preAward = {
  code: 'PRE_AWARD',
  name: 'Pre-award',
  questions: {
    type: 'object',
    additionalProperties: false,
    required: ['applicant'],
    properties: {
      applicant: {
        type: 'object',
        required: ['name'],
        properties: {
          name: { type: 'string', minLength: 1 },
          email: { type: 'string', format: 'email' }
        }
      }
    }
  }
}

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

afterAll(async () => {
  await server.stop()
})

describe('the grant Questions, Actions and Entitlements tabs', () => {
  test('Questions lists the first phase by name, each property by its whole path', async () => {
    givenGrant({ definition: definition({ phases: [preAward] }) })

    const $ = await viewTab('questions')
    const phase = part($, 'questions-phase')

    expect(phase.find('.gpa-section-head h2').text()).toBe('Pre-award')
    expect(flatten(phase.find('.gpa-section-desc').text())).toBe(
      'GAS checks every submission against these questions.'
    )
    expect(texts($, '[data-testid="questions-row"]')).toEqual([
      'applicant object Yes —',
      'applicant.name string Yes length ≥ 1',
      'applicant.email string (email) No —'
    ])
  })

  test('Questions marks a closed object with a badge whose tooltip takes focus', async () => {
    const closed = {
      ...preAward,
      questions: {
        type: 'object',
        properties: {
          applicant: {
            type: 'object',
            additionalProperties: false,
            properties: { name: { type: 'string' } }
          }
        }
      }
    }
    givenGrant({ definition: definition({ phases: [closed] }) })

    const $ = await viewTab('questions')
    const badge = part($, 'questions-closed')

    expect(badge.text()).toBe('closed')
    expect(badge.hasClass('gpa-badge-outline')).toBe(true)
    expect(badge.closest('.gpa-tooltip-trigger').attr('tabindex')).toBe('0')
    expect(badge.closest('gpa-tooltip').attr('text')).toBe(
      'Properties not listed under it are removed on submission.'
    )
  })

  test('Questions says a later phase is not checked, and draws one with no questions as empty', async () => {
    givenGrant({
      definition: definition({
        phases: [preAward, { code: 'POST_AWARD', name: 'Post-award' }]
      })
    })

    const $ = await viewTab('questions')
    const later = part($, 'questions-phase').eq(1)

    expect(later.find('.gpa-section-head h2').text()).toBe('Post-award')
    expect(later.find('[data-testid="questions-not-checked"]').text()).toBe(
      'Not checked on submission'
    )
    expect(
      later
        .find('[data-testid="questions-not-checked"]')
        .closest('gpa-tooltip')
        .attr('text')
    ).toBe(
      'GAS validates submissions against the first phase only. Later phases are kept for reference.'
    )
    expect(flatten(later.find('[data-testid="questions-empty"]').text())).toBe(
      'No questions in this phase.'
    )
  })

  test('Questions: no phases says every submission throws', async () => {
    givenGrant({ definition: definition({ phases: [] }) })

    const $ = await viewTab('questions')
    const alert = part($, 'questions-no-phases')

    expect(alert.hasClass('gpa-alert-danger')).toBe(true)
    expect(flatten(alert.text())).toBe(
      'The grant definition has no phases: every submission throws.GAS checks submissions against the first phase’s questions, and there is none. Publish a version with at least one phase.'
    )
  })

  test('Questions: a first phase without questions is an error', async () => {
    givenGrant({ definition: definition({ phases: [{ code: 'PRE_AWARD' }] }) })

    const $ = await viewTab('questions')

    expect(flatten(part($, 'questions-problem').text())).toBe(
      'This phase has no questions: every submission throws.'
    )
  })

  test('Actions lists each action with its method, and says how GAS fills in the environment', async () => {
    givenGrant({
      definition: definition({
        actions: [
          {
            name: 'validate-land-parcel-actions',
            method: 'POST',
            url: 'https://land-grants-api.%ENVIRONMENT%.cdp-int.defra.cloud/actions/validate'
          }
        ]
      })
    })

    const $ = await viewTab('actions')

    expect(texts($, '[data-testid="actions-row"]')).toEqual([
      'validate-land-parcel-actions POST https://land-grants-api.%ENVIRONMENT%.cdp-int.defra.cloud/actions/validate'
    ])
    expect(part($, 'actions-row').find('.gpa-badge').hasClass('gpa-mono')).toBe(
      true
    )
    expect(flatten(part($, 'actions-environment').text())).toBe(
      'When GAS calls an action, it replaces %ENVIRONMENT% with its environment name.'
    )
  })

  test('Actions: none says so', async () => {
    givenGrant({ definition: definition({ actions: [] }) })

    const $ = await viewTab('actions')

    expect(flatten(part($, 'actions-none').text())).toBe(
      'No actionsThis version defines no actions for GAS to call.'
    )
  })

  test('Entitlements: none says nothing can be claimed', async () => {
    givenGrant({
      entitlements: { entitlementTemplates: [], claims: null, payment: null }
    })

    const $ = await viewTab('entitlements')

    expect(flatten(part($, 'entitlements-none').text())).toBe(
      'No entitlement templatesNo entitlement templates in this version, so nothing can be claimed on it.'
    )
  })

  const capitalItem: EntitlementTemplate = {
    claimCode: 'CAPITAL',
    name: 'Capital item',
    materialised: false,
    maxEntitlements: 10,
    availableAt: [{ phase: 'POST_AWARD', stage: 'AGREEMENT' }],
    fields: {
      quantity: {
        input: true,
        label: 'Quantity installed',
        unitType: 'decimal',
        decimalPlaces: 0,
        minValue: 1
      },
      itemCode: {
        input: false,
        value: 'jsonata:$.item.code',
        unitType: 'string'
      }
    },
    help: {
      summary: 'What to claim and when',
      content: [{ text: 'Claim once installed.' }]
    },
    claim: {
      claimableAt: [
        { phase: 'POST_AWARD', stage: 'AGREEMENT', status: 'ACCEPTED' }
      ],
      limits: { maximumClaims: 1, allowsPartialClaims: false },
      requiresApproval: false,
      requiresEvidence: true
    }
  }

  const siteVisit: EntitlementTemplate = {
    ...capitalItem,
    claimCode: 'VISIT',
    name: 'Site visit',
    help: undefined,
    claim: { ...capitalItem.claim!, claimableAt: [] }
  }

  const entitlements: GrantEntitlements = {
    entitlementTemplates: [capitalItem, siteVisit],
    claims: {
      onClaimApproval: {
        currentPosition: {
          phase: 'POST_AWARD',
          stage: 'AGREEMENT',
          status: 'ACCEPTED'
        },
        targetPosition: {
          phase: 'POST_AWARD',
          stage: 'CLAIMS',
          status: 'COMPLETE'
        }
      }
    },
    payment: null,
    statusNames: {
      'POST_AWARD:AGREEMENT:ACCEPTED': 'Agreement accepted',
      'POST_AWARD:CLAIMS:COMPLETE': 'Claims complete'
    }
  }

  test('Entitlements: templates heads them with the claims for all of them', async () => {
    givenGrant({ entitlements })

    const $ = await viewTab('entitlements')

    expect(texts($, '[data-testid="entitlements-claims"] dt')).toEqual([
      'After the last claim',
      'Payment definition',
      'Claim roles'
    ])
    expect(texts($, '[data-testid="entitlements-claims"] dd')).toEqual([
      'Agreement acceptedClaims complete',
      'Payment definition',
      'Any operator'
    ])
    expect(
      part($, 'entitlements-claims').find('svg[aria-label="moves to"]')
    ).toHaveLength(1)
  })

  test('Entitlements: each template’s two Sections are level 4 headings, sized as the prototype’s (14px/20px)', async () => {
    givenGrant({ entitlements })

    const $ = await viewTab('entitlements')
    const headings = $('.gpa-section-titles h4')
      .toArray()
      .map((heading) => [$(heading).attr('class'), flatten($(heading).text())])

    expect(headings.slice(0, 2)).toEqual([
      ['gpa-heading heading-xs', 'How it’s created'],
      ['gpa-heading heading-xs', 'Claiming']
    ])
  })

  test('Entitlements: each template is an item, the first open, named not coded', async () => {
    givenGrant({ entitlements })

    const $ = await viewTab('entitlements')
    const [first, second] = part($, 'entitlements-template').toArray()

    expect($(first).attr('open')).toBe('open')
    expect($(second).attr('open')).toBeUndefined()
    expect(
      texts($, '[data-testid="entitlements-template"] .gpa-accordion-title')
    ).toEqual(['Capital item', 'Site visit'])
    expect(flatten($(first).find('.gpa-accordion-meta').text())).toBe(
      'On submit: Requests payment'
    )
    expect(
      $(first)
        .find('[data-testid="entitlements-field"]')
        .toArray()
        .map((row) => flatten($(row).text()))
    ).toEqual([
      'quantity Entered Quantity installed decimal min 1, 0 dp',
      'itemCode From agreement $.item.code string —'
    ])
    expect(flatten(part($, 'entitlements-help').find('summary').text())).toBe(
      'Help: What to claim and when'
    )
  })

  test("Entitlements: a template that can't be claimed is marked and says why", async () => {
    givenGrant({ entitlements })

    const $ = await viewTab('entitlements')
    const visit = part($, 'entitlements-template').eq(1)

    expect(
      visit.find('.gpa-accordion-leading .gpa-mark-warning').attr('title')
    ).toBe('Can’t be claimed')
    expect(visit.find('.gpa-accordion-meta .gpa-badge-danger').text()).toBe(
      'Can’t be claimed'
    )
    expect(
      flatten(visit.find('[data-testid="entitlements-problem"]').text())
    ).toBe(
      'Site visit can’t be claimed.Its claim rules list no “Claimable at” status, so GAS rejects every claim (WRONG_POSITION). Publish a version that sets claim.claimableAt.'
    )
  })

  test('each tab waits for a grant definition not stored', async () => {
    givenGrant({
      header: {
        ...grantVersionHeader,
        files: { ...grantVersionHeader.files, grant: pendingFile }
      }
    })

    const $ = await viewTab('entitlements')

    expect(flatten(part($, 'tab-waiting').text())).toContain(
      'The entitlement templates appear once the grant definition is stored.'
    )
  })
})
