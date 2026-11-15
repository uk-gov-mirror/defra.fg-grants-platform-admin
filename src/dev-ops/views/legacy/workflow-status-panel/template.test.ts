import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import type {
  GrantStatusMap,
  StoredWorkflowPhase
} from '../../../use-cases/get-workflow-page.use-case.ts'
import { woodlandPhases } from '../../../use-cases/test-fixtures.ts'
import { toWorkflowPhases } from '../../../view-models/workflow-phases.view-model.ts'

const lifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: null,
      stages: [{ code: 'REVIEW', name: null, statuses: [{ code: 'APPROVED' }] }]
    }
  ],
  initialPosition: 'PRE_AWARD:REVIEW:APPROVED',
  amendablePositions: [],
  waysIn: [],
  externalMappings: [
    {
      source: 'CW',
      code: 'PRE_AWARD:REVIEW:APPROVED',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::APPROVED',
      to: 'PRE_AWARD:REVIEW:APPROVED'
    },
    {
      source: 'CW',
      code: 'PRE_AWARD:REVIEW:IN_REVIEW',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: 'P::X',
      to: 'P::X'
    }
  ],
  claimApproval: null
}

const found: GrantStatusMap = { outcome: 'found', lifecycle }

const toPanelModel = (
  status: string,
  grant: GrantStatusMap = found,
  phases: StoredWorkflowPhase[] = woodlandPhases
) =>
  toWorkflowPhases(
    phases,
    grant,
    status,
    {
      status: (position) => `/status/${position}`,
      grantStatus: (position) => `/grant/${position}`,
      grant: () => '/grant',
      tasks: (phase, stage) => `/tasks#stage-${phase}:${stage}`
    },
    '1.2.0'
  ).panel ?? {}

const renderPanel = (
  status: string,
  grant: GrantStatusMap = found,
  phases: StoredWorkflowPhase[] = woodlandPhases
) => render('workflow-status-panel', toPanelModel(status, grant, phases))

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="workflow-status-panel-${name}"]`)

const lines = ($: CheerioAPI, name: string) =>
  part($, name)
    .find('[data-testid="workflow-status-panel-way"]')
    .toArray()
    .map((line) => flatten($(line).text()))

/** A stage whose Go needs its mandatory task done, and a move GAS sends that checks it too. */
const withTasks: StoredWorkflowPhase[] = [
  {
    code: 'P',
    name: 'Phase',
    stages: [
      {
        code: 'S',
        name: 'Checks',
        statuses: [
          {
            code: 'A',
            name: 'Ready',
            theme: 'INFO',
            interactive: true,
            hideTaskGroups: false,
            transitions: [
              {
                targetPosition: 'P:S:B',
                checkTasks: false,
                action: {
                  code: 'GO',
                  name: 'Go',
                  checkTasks: true,
                  comment: null
                }
              },
              { targetPosition: 'P:S:B', checkTasks: true, action: null }
            ]
          },
          {
            code: 'B',
            name: 'Done',
            theme: 'SUCCESS',
            interactive: true,
            hideTaskGroups: false,
            closes: true,
            transitions: []
          }
        ],
        taskGroups: [
          {
            code: 'G',
            name: 'Group',
            tasks: [
              {
                code: 'T',
                name: 'Task',
                mandatory: true,
                valueOptions: [{ code: 'Y', name: 'Yes', completes: true }]
              }
            ]
          }
        ]
      }
    ]
  }
]

describe('workflow-status-panel component', () => {
  test('badges the name in its theme, then the flags in order, each explained', () => {
    const $ = renderPanel('WITHDRAWN')
    const $badges = part($, 'badges')
    const flags = $badges.find('[data-testid="workflow-status-panel-flag"]')

    expect($badges.find('[data-testid="do-status-label"]').text()).toBe(
      'Withdrawn'
    )
    expect(flatten(part($, 'theme').text())).toBe(
      'CW shows it as Withdrawn NEUTRAL'
    )
    expect(part($, 'theme').find('.font-mono').text()).toBe('NEUTRAL')
    expect($badges.find('[data-testid="do-status-dot"]').attr('class')).toBe(
      'status bg-base-content/80'
    )
    expect(
      flags.toArray().map((badge) => $(badge).contents().first().text())
    ).toEqual(['tasks read-only', 'closes case', 'hides tasks'])
    expect(flags.eq(1).attr('title')).toBe('CW marks the case closed here')
    expect(flags.eq(1).find('.sr-only').text()).toBe(
      ': CW marks the case closed here'
    )
    expect(flags.first().attr('class')).toBe('badge badge-ghost badge-sm')
  })

  test('shows the phase and stage, each name first', () => {
    expect(flatten(part(renderPanel('IN_REVIEW'), 'stage').text())).toBe(
      'Phase Pre-award PRE_AWARD Stage Review application REVIEW'
    )
  })

  test('raises one warning alert per finding, in its own words', () => {
    const $alert = part(renderPanel('AWAITING_ACCEPTANCE'), 'finding')

    expect($alert).toHaveLength(1)
    expect($alert.attr('role')).toBe('alert')
    expect($alert.attr('class')).toContain('alert-warning')
    expect(flatten($alert.text())).toBe(
      "Dead end: no action or GAS message moves a case out of this status, and it doesn't close the case. Cases here stay open."
    )
    expect(
      $alert.find('[data-testid="do-icon-exclamation-triangle"]')
    ).toHaveLength(1)
    expect(flatten(part(renderPanel('WITHDRAWN'), 'finding').text())).toBe(
      "Unreachable: no action or GAS move leads here, and it isn't the starting status. A case can only be here if a data fix or migration moved it."
    )
    expect(part(renderPanel('IN_REVIEW'), 'finding')).toHaveLength(0)
  })

  test('leaves out the ways in of an unreachable status, and says new cases start at the first', () => {
    expect(part(renderPanel('WITHDRAWN'), 'ways-in')).toHaveLength(0)
    expect(
      flatten(part(renderPanel('AWAITING_REVIEW'), 'ways-in').text())
    ).toBe('Ways in New cases start here')
  })

  test('lists the ways in, each naming its source and the action, codes beneath', () => {
    const $ = renderPanel('IN_REVIEW')

    expect(lines($, 'ways-in')).toEqual([
      'Awaiting review AWAITING_REVIEW Start review START_REVIEW',
      'On hold ON_HOLD Resume review RESUME',
      'Information requested RFI_SENT GAS move'
    ])
    expect(part($, 'ways-in').find('a').first().attr('href')).toBe(
      '/status/PRE_AWARD:REVIEW:AWAITING_REVIEW#panel'
    )
    expect(part($, 'ways-in').find('a').first().attr('title')).toBe(
      'PRE_AWARD:REVIEW:AWAITING_REVIEW'
    )
  })

  test('lists the ways out with their action and badges, the stage named outside this one', () => {
    const $ = renderPanel('IN_REVIEW')

    expect(lines($, 'ways-out')).toEqual([
      '→ Approved APPROVED Approve APPROVE comment confirm',
      '→ Rejected REJECTED Reject REJECT comment required confirm',
      '→ On hold ON_HOLD Put on hold PUT_ON_HOLD comment required',
      '→ Information requested RFI_SENT Request information SEND_RFI comment required'
    ])
    expect(lines(renderPanel('APPROVED'), 'ways-out')).toEqual([
      '→ Awaiting acceptance · Agreement POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE GAS may send'
    ])
  })

  test('badges an action that needs the tasks, and says what holds back a move GAS sends', () => {
    const $ = renderPanel('A', found, withTasks)
    const [go, gas] = lines($, 'ways-out')

    expect(go).toBe(
      '→ Done B Go GO needs tasks Hidden from caseworkers until all mandatory tasks in Checks are complete · see tasks ›'
    )
    expect(part($, 'needs-tasks').attr('class')).toBe(
      'badge badge-warning badge-soft badge-sm'
    )
    expect(part($, 'tasks').first().find('a').attr('href')).toBe(
      '/tasks#stage-P:S'
    )
    expect(gas).toBe(
      "→ Done B GAS may send CW rejects GAS's message while mandatory tasks in Checks (the case's current stage) are open. After its retries the message goes to CW's inbox as a dead letter, and nothing re-applies it: redrive it once the tasks are done ›"
    )
    expect(part($, 'tasks').last().find('a').attr('href')).toBe(
      '/dev-ops/events/cw/inbox?status=DEAD_LETTER'
    )
  })

  test('says a status with no way out closes the case, or shows —', () => {
    expect(flatten(part(renderPanel('REJECTED'), 'ways-out').text())).toBe(
      'Ways out Closes case'
    )
    expect(
      flatten(part(renderPanel('AWAITING_ACCEPTANCE'), 'ways-out').text())
    ).toBe('Ways out —')
  })

  test('says in words what GAS does with the status, naming its stage, phase and status', () => {
    const $ = renderPanel('APPROVED')

    expect(flatten(part($, 'tells-gas').text())).toBe(
      'Tells GAS CW tells GAS. If the application is at GAS stage Review REVIEW in Pre award PRE_AWARD, and in a status that move allows, GAS moves it to Approved (PRE_AWARD:REVIEW:APPROVED). Otherwise GAS ignores it.'
    )
    expect(part($, 'tells-gas').find('a').attr('href')).toBe(
      '/grant/PRE_AWARD:REVIEW:APPROVED'
    )
  })

  test('names a target off the grant map with no link', () => {
    const $ = renderPanel('IN_REVIEW')

    expect(lines($, 'tells-gas')).toEqual([
      'If the application is at GAS stage Review REVIEW in Pre award PRE_AWARD, and in a status that move allows, GAS moves it to X (P::X).'
    ])
    expect(part($, 'tells-gas').find('a')).toHaveLength(0)
  })

  test('says GAS ignores a status whose target it cannot read, never that it moves the application', () => {
    const unreadable: GrantStatusMap = {
      outcome: 'found',
      lifecycle: {
        ...lifecycle,
        externalMappings: [
          {
            source: 'CW',
            code: 'PRE_AWARD:REVIEW:APPROVED',
            whileIn: 'PRE_AWARD:REVIEW',
            mappedTo: 'NOT A POSITION',
            to: null
          }
        ]
      }
    }

    expect(lines(renderPanel('APPROVED', unreadable), 'tells-gas')).toEqual([
      'If the application is at GAS stage Review REVIEW in Pre award PRE_AWARD, GAS ignores it: the target NOT A POSITION is not a PHASE:STAGE:STATUS.'
    ])
  })

  test('badges a status GAS has no mapping for as GAS ignores this, explained', () => {
    const $ignored = part(renderPanel('ON_HOLD'), 'ignored')

    expect($ignored.text()).toBe('GAS ignores this')
    expect($ignored.attr('title')).toBe(
      "The grant has no mapping for this status, so the application doesn't move."
    )
    expect($ignored.attr('class')).toBe('badge badge-ghost badge-sm')
  })

  test('links to the grant version while its definition is not stored', () => {
    const $tells = part(
      renderPanel('IN_REVIEW', { outcome: 'not-stored' }),
      'not-stored'
    )

    expect(flatten($tells.text())).toBe(
      'Grant definition not stored · open grant 1.2.0 ›'
    )
    expect($tells.find('a').attr('href')).toBe('/grant')
  })

  test.each([
    ['WITHDRAWN', found, 'GAS ignores this'],
    [
      'AWAITING_ACCEPTANCE',
      found,
      'Not sent. Cases only arrive here when GAS moves them, and CW tells GAS only about caseworker actions.'
    ],
    ['AWAITING_REVIEW', found, 'Not sent (cases start here)'],
    ['APPROVED', { outcome: 'no-grant' } as const, 'No grant'],
    [
      'APPROVED',
      { outcome: 'unreadable' } as const,
      'Grant definition cannot be read'
    ],
    [
      'APPROVED',
      { outcome: 'timed-out' } as const,
      'fg-gas-backend did not answer in time'
    ]
  ])('tells GAS, for %s, %j', (status, grant, text) => {
    expect(flatten(part(renderPanel(status, grant), 'tells-gas').text())).toBe(
      `Tells GAS ${text}`
    )
  })

  test('says a mismatch with what GAS will next send and when, and a conditional one only quietly', () => {
    const $ = render('workflow-status-panel', {
      ...toPanelModel('APPROVED'),
      findings: [
        {
          kind: 'mismatch',
          version: '1.0.0',
          at: { name: 'Generating offer', position: 'P:S:GENERATING' },
          sends: { name: 'Offer drafted', position: 'P:S:DRAFTED' },
          when: { kind: 'sends', source: 'Agreements', code: 'offered' }
        }
      ],
      maySend: [
        {
          onlyWhen: 'no agreement is on offer',
          sends: {
            name: 'Application withdrawn',
            position: 'P:S:APPLICATION_WITHDRAWN',
            defined: false
          }
        },
        {
          onlyWhen: 'the claim is rejected',
          sends: { name: 'Rejected', position: 'P:S:REJECTED', defined: true }
        }
      ]
    })

    expect(flatten(part($, 'finding').text())).toBe(
      'If GAS is on grant 1.0.0 too, after this message GAS is at Generating offer and will next send Offer drafted (P:S:DRAFTED) when Agreements sends offered. This status has no move to it, so CW would dead-letter that message.'
    )
    expect(
      part($, 'may-send')
        .toArray()
        .map((line) => flatten($(line).text()))
    ).toEqual([
      "If no agreement is on offer, GAS may also send Application withdrawn (P:S:APPLICATION_WITHDRAWN), which the grant doesn't define; no move from this status takes that message.",
      'If the claim is rejected, GAS may also send Rejected (P:S:REJECTED); no move from this status takes that message.'
    ])
    expect(part($, 'may-send').first().attr('class')).toBe(
      'text-sm text-base-content/70'
    )
  })

  test('sets no inline style', () => {
    expect(renderPanel('IN_REVIEW')('[style]')).toHaveLength(0)
  })
})
