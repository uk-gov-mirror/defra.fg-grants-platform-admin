import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import type { StatusPanel } from '../../../view-models/grant-phases.view-model.ts'

const ref = (name: string, code: string, stageName: string | null = null) => ({
  name,
  stageName,
  code,
  position: `P:S:${code}`,
  href: `/s/${code}#panel`
})

const panel: StatusPanel = {
  badges: [{ label: 'amendable', title: 'Means amendable' }],
  phase: { code: 'PRE_AWARD', name: 'Pre-award' },
  stage: { code: 'REVIEW', name: 'Review' },
  undefinedTargets: [
    {
      position: 'PRE_AWARD:REVIEW:APPLICATION_WITHDRAWN',
      onlyWhen: 'no agreement is on offer'
    }
  ],
  waysIn: [
    {
      kind: 'move',
      from: ref('Received', 'RECEIVED'),
      processes: ['NOTIFY'],
      bareCode: null
    },
    {
      kind: 'code',
      code: 'ON_HOLD',
      processes: [],
      bareCode: { code: 'ON_HOLD', said: false }
    },
    { kind: 'any', processes: [] }
  ],
  waysOut: [
    {
      to: ref('Agreement ready for applicant', 'READY', 'Offer'),
      processes: ['STORE_AGREEMENT_CASE'],
      triggers: [{ kind: 'sends', source: 'Agreements', code: 'offered' }],
      untriggered: false,
      bareCode: null
    },
    {
      to: ref('Awaiting claim', 'AWAITING'),
      processes: [],
      triggers: [],
      untriggered: true,
      bareCode: { code: 'WITHDRAWAL_REQUESTED', said: true }
    }
  ],
  triggeredBy: [
    {
      kind: 'external',
      source: 'CW',
      code: 'RFI_SENT',
      href: '/workflow',
      stageName: 'Review',
      missingStage: null
    },
    {
      kind: 'external',
      source: 'CW',
      code: 'TRIAGED',
      href: null,
      stageName: 'Legacy triage',
      missingStage: 'LEGACY_TRIAGE'
    },
    {
      kind: 'gas',
      process: 'REQUEST_APPLICATION_WITHDRAWAL',
      onEntering: 'Withdrawal requested',
      onlyWhen: 'no agreement is on offer'
    },
    {
      kind: 'claim',
      at: {
        ...ref('Claim submitted', 'CLAIM_SUBMITTED'),
        stageName: 'Monitoring'
      },
      href: '/entitlements'
    }
  ],
  noTrigger: null
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const renderPanel = (overrides: Partial<StatusPanel> = {}) =>
  render('grant-status-panel', {
    panel: { ...panel, ...overrides },
    testId: 'g'
  })

const rows = ($: CheerioAPI, testId: string) =>
  $(`[data-testid="g-${testId}"]`)
    .toArray()
    .map((row) => flatten($(row).text()))

describe('grant-status-panel component', () => {
  test('badges the status quietly, saying what each badge means', () => {
    const $ = renderPanel()
    const badge = $('[data-testid="g-badge"]')

    expect(badge.attr('class')).toBe('badge badge-ghost badge-sm')
    expect(badge.attr('title')).toBe('Means amendable')
    expect(badge.find('.sr-only').text()).toBe(': Means amendable')
  })

  test('warns of a status GAS sets that the grant does not define', () => {
    const $ = renderPanel()

    expect(rows($, 'undefined-target')).toEqual([
      "When no agreement is on offer, GAS moves the application to PRE_AWARD:REVIEW:APPLICATION_WITHDRAWN, which this grant doesn't define."
    ])
  })

  test('lists the ways in by name with the code beneath, a bare code, and any status', () => {
    const $ = renderPanel()

    expect(rows($, 'way-in')).toEqual([
      'Received RECEIVED · runs NOTIFY',
      'ON_HOLD',
      'Any status: GAS accepts this move from every position (no validFrom)'
    ])
    expect($('[data-testid="g-way-in"] a').attr('title')).toBe('P:S:RECEIVED')
  })

  test('inlines what triggers each way out, and warns of one nothing triggers', () => {
    const $ = renderPanel()

    expect(rows($, 'way-out')).toEqual([
      '→ Agreement ready for applicant · Offer READY · when Agreements sends offered · runs STORE_AGREEMENT_CASE',
      '→ Awaiting claim AWAITING · ⚠ nothing in this version triggers this move matched by status code only (WITHDRAWAL_REQUESTED in any stage of any phase)'
    ])
    expect($('[data-testid="g-bare-code"]').first().attr('class')).toBe(
      'block text-xs text-base-content/70'
    )
    expect($('[data-testid="g-way-out"]').last().attr('title')).toBe(
      'matched by status code only'
    )
    expect($('[data-testid="g-way-in"]').eq(1).attr('title')).toBe(
      'matched by status code only'
    )
    expect(
      $('[data-testid="g-way-in"] [data-testid="g-bare-code"]')
    ).toHaveLength(0)
    expect($('[data-testid="g-untriggered"]').attr('class')).toBe(
      'text-warning'
    )
  })

  test("leaves out a stage's name where it repeats the status's name", () => {
    const $ = renderPanel({
      waysOut: [
        {
          to: ref('Awaiting claim', 'AWAITING', 'Awaiting claim'),
          processes: [],
          triggers: [],
          untriggered: false,
          bareCode: null
        }
      ],
      triggeredBy: [
        {
          kind: 'claim',
          at: ref('Claim submitted', 'CLAIM_SUBMITTED', 'Claim submitted'),
          href: '/entitlements'
        }
      ]
    })

    expect(rows($, 'way-out')).toEqual(['→ Awaiting claim AWAITING'])
    expect(rows($, 'trigger')).toEqual([
      'Claim Last claim submitted — while the application is at Claim submitted'
    ])
  })

  test('gives each trigger its source badge, what it is and the stage it is keyed on', () => {
    const $ = renderPanel()

    expect(rows($, 'trigger')).toEqual([
      'CW RFI_SENT — while the application is in Review',
      'CW TRIAGED — while the application is in Legacy triage⚠ applies only to applications still in LEGACY_TRIAGE from an earlier version: this version has no such stage.',
      'GAS REQUEST_APPLICATION_WITHDRAWAL — on entering Withdrawal requested, when no agreement is on offer',
      'Claim Last claim submitted — while the application is at Claim submitted · Monitoring'
    ])
    expect($('[data-testid="g-trigger"]').eq(1).attr('class')).toContain(
      'text-base-content/70'
    )
    expect($('[data-testid="g-trigger"] a').first().attr('class')).toBe(
      'link underline-offset-4 decoration-dotted'
    )
  })

  test.each([
    ['initial', 'Set on submission (initial status)', 'g-no-trigger'],
    ['nothing', 'Nothing in this version sets this status.', 'g-no-trigger']
  ] as const)(
    'says why Triggered by is empty: %s',
    (noTrigger, text, testId) => {
      const $ = renderPanel({ triggeredBy: [], noTrigger })

      expect(flatten($(`[data-testid="${testId}"]`).text())).toBe(text)
    }
  )

  test('shows a dash for an empty Triggered by when it cannot say why', () => {
    const $ = renderPanel({ triggeredBy: [], noTrigger: null })

    expect(flatten($('[data-testid="g-triggered-by"]').text())).toBe(
      'Triggered by —'
    )
  })
})
