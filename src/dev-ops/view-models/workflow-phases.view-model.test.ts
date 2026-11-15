import type {
  ExternalStatusMapping,
  GrantLifecycle,
  GrantStatusMap,
  StoredTaskGroup,
  StoredTransition,
  StoredWorkflowPhase,
  StoredWorkflowStatus
} from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandPhases } from '../use-cases/test-fixtures.ts'
import { toWorkflowPhases } from './workflow-phases.view-model.ts'

const links = {
  status: (position: string) => `status:${position}`,
  grantStatus: (position: string, selected: string) =>
    `grant:${position}<${selected}`,
  grant: (selected: string) => `grant-page<${selected}`,
  tasks: (phase: string, stage: string) => `tasks#stage-${phase}:${stage}`
}

const cwMapping = (
  code: string,
  whileIn: string,
  to: string | null,
  mappedTo = to ?? 'A:B'
): ExternalStatusMapping => ({ source: 'CW', code, whileIn, mappedTo, to })

/** The woodland grant as GAS describes it, with its map keyed by full CW position as real maps are. */
const lifecycle: GrantLifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: null,
      stages: [
        {
          code: 'APPLICATION',
          name: null,
          statuses: [{ code: 'RECEIVED' }, { code: 'AMEND' }]
        },
        {
          code: 'REVIEW',
          name: null,
          statuses: [
            { code: 'IN_REVIEW' },
            { code: 'ON_HOLD' },
            { code: 'APPROVED' },
            { code: 'REJECTED' }
          ]
        }
      ]
    },
    {
      code: 'POST_AWARD',
      name: null,
      stages: [
        {
          code: 'AGREEMENT',
          name: null,
          statuses: [{ code: 'OFFERED' }, { code: 'ACCEPTED' }]
        }
      ]
    }
  ],
  initialPosition: 'PRE_AWARD:APPLICATION:RECEIVED',
  amendablePositions: [],
  waysIn: [],
  externalMappings: [
    cwMapping(
      'PRE_AWARD:REVIEW:IN_REVIEW',
      'PRE_AWARD:REVIEW',
      'PRE_AWARD:REVIEW:IN_REVIEW',
      '::IN_REVIEW'
    ),
    cwMapping(
      'PRE_AWARD:REVIEW:APPROVED',
      'PRE_AWARD:REVIEW',
      'PRE_AWARD:REVIEW:APPROVED',
      '::APPROVED'
    ),
    cwMapping(
      'PRE_AWARD:REVIEW:RFI_SENT',
      'PRE_AWARD:REVIEW',
      'PRE_AWARD:APPLICATION:AMEND'
    ),
    {
      source: 'AS',
      code: 'PRE_AWARD:REVIEW:REJECTED',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::REJECTED',
      to: 'PRE_AWARD:REVIEW:REJECTED'
    }
  ],
  claimApproval: null
}

const found: GrantStatusMap = { outcome: 'found', lifecycle }

const withMappings = (externalMappings: ExternalStatusMapping[]) =>
  ({
    outcome: 'found',
    lifecycle: { ...lifecycle, externalMappings }
  }) as const

const tabFor = (
  asked: string | undefined,
  grant: GrantStatusMap = found,
  phases: StoredWorkflowPhase[] = woodlandPhases
) =>
  toWorkflowPhases(
    phases,
    grant,
    asked,
    links,
    { code: 'woodland-creation', version: '1.2.0' },
    { href: '/dev-ops/workflows/woodland-creation/1.2.0', from: '' }
  )

const panelFor = (
  asked: string,
  grant?: GrantStatusMap,
  phases?: StoredWorkflowPhase[]
) => {
  const { panels, selected } = tabFor(asked, grant, phases)
  const panel = panels.find(({ id }) => id === selected)

  if (!panel) {
    throw new Error('no panel')
  }

  return panel
}

const statesOf = (asked?: string, phases?: StoredWorkflowPhase[]) =>
  tabFor(asked, found, phases).phases.flatMap(({ stages }) =>
    stages.flatMap(({ states }) => states)
  )

const status = (
  code: string,
  transitions: StoredTransition[] = [],
  overrides: Partial<StoredWorkflowStatus> = {}
): StoredWorkflowStatus => ({
  code,
  name: code,
  theme: 'NEUTRAL',
  interactive: true,
  hideTaskGroups: false,
  transitions,
  ...overrides
})

const gas = (targetPosition: string, checkTasks = false): StoredTransition => ({
  targetPosition,
  checkTasks,
  action: null
})

const action = (
  targetPosition: string,
  code: string,
  checkTasks = false
): StoredTransition => ({
  targetPosition,
  checkTasks: false,
  action: { code, name: code, checkTasks, comment: null }
})

const onePhase = (
  ...stages: [string, StoredWorkflowStatus[], StoredTaskGroup[]?][]
): StoredWorkflowPhase[] => [
  {
    code: 'P',
    name: 'Phase',
    stages: stages.map(([code, statuses, taskGroups = []]) => ({
      code,
      name: code,
      statuses,
      taskGroups
    }))
  }
]

const tasksOf = (mandatory: boolean): StoredTaskGroup[] => [
  {
    code: 'G',
    name: 'Group',
    tasks: [
      {
        code: 'T',
        name: 'Task',
        mandatory,
        valueOptions: [{ code: 'Y', name: 'Yes', completes: true }]
      }
    ]
  }
]

const ref = (
  name: string,
  position: string,
  code: string,
  stageName: string | null = null
) => ({ name, stageName, code, position, href: `status:${position}` })

/** GAS-16's read of the grant: what each process does on a move. */
const withEffects = (
  waysIn: GrantLifecycle['waysIn'],
  externalMappings = lifecycle.externalMappings
): GrantStatusMap => ({
  outcome: 'found',
  lifecycle: { ...lifecycle, waysIn, externalMappings }
})

describe('toWorkflowPhases', () => {
  test('finds the statuses nothing reaches, and those a case never leaves', () => {
    expect(panelFor('WITHDRAWN').findings).toEqual([{ kind: 'unreachable' }])
    expect(panelFor('ACCEPTED').findings).toEqual([{ kind: 'unreachable' }])
    expect(panelFor('AWAITING_ACCEPTANCE').findings).toEqual([
      { kind: 'dead end' }
    ])
    expect(panelFor('AWAITING_REVIEW').findings).toEqual([])
    expect(panelFor('REJECTED').findings).toEqual([])
  })

  test('marks each status with a finding on the map', () => {
    expect(
      statesOf('IN_REVIEW')
        .filter(({ icon }) => icon === 'triangle-alert')
        .map(({ id }) => id)
    ).toEqual([
      'PRE_AWARD:REVIEW:WITHDRAWN',
      'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE',
      'POST_AWARD:AGREEMENT:ACCEPTED'
    ])
    expect(statesOf().find(({ id }) => id.endsWith('WITHDRAWN'))).toMatchObject(
      {
        label: 'Withdrawn',
        iconTone: 'warning',
        iconLabel: 'Has findings',
        badge: 'closes'
      }
    )
  })

  test('sums up the findings, each status once by its first, linking to it, and says nothing without one', () => {
    expect(tabFor(undefined).findings).toEqual({
      count: 3,
      statuses: [
        {
          name: 'Withdrawn',
          href: 'status:PRE_AWARD:REVIEW:WITHDRAWN',
          lead: 'unreachable'
        },
        {
          name: 'Awaiting acceptance',
          href: 'status:POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE',
          lead: 'dead end'
        },
        {
          name: 'Agreement accepted',
          href: 'status:POST_AWARD:AGREEMENT:ACCEPTED',
          lead: 'unreachable'
        }
      ]
    })

    const phases = onePhase([
      'S',
      [status('A', [action('P:S:B', 'GO')]), status('B', [], { closes: true })]
    ])

    expect(tabFor(undefined, found, phases).findings).toBeNull()
  })

  test('counts each status with findings once', () => {
    const phases = onePhase(
      [
        'S1',
        [
          status('A', [action('P:S1:B', 'GO')]),
          status('B', [], { closes: true })
        ]
      ],
      ['S2', [status('B')]]
    )

    expect(tabFor(undefined, found, phases).findings).toEqual({
      count: 1,
      statuses: [{ name: 'B', href: 'status:P:S2:B', lead: 'dead end' }]
    })
  })

  test('colours each status as CW shows it', () => {
    const phases = onePhase([
      'S',
      [
        status('A', [action('P:S:B', 'GO')], { theme: 'WARN' }),
        status('B', [], { closes: true, theme: 'NONE' })
      ]
    ])

    expect(statesOf(undefined, phases).map(({ tone }) => tone)).toEqual([
      'warning',
      'neutral'
    ])
    expect(panelFor('A', found, phases).tone).toBe('warning')
  })

  test('marks the starting status on the graph and in the panel, and leaves out the ways in of an unreachable one', () => {
    expect(statesOf()[0]).toMatchObject({
      id: 'PRE_AWARD:REVIEW:AWAITING_REVIEW',
      badge: 'start'
    })
    expect(panelFor('AWAITING_REVIEW')).toMatchObject({
      startsHere: true,
      waysIn: [],
      flags: [
        { label: 'start', title: 'New cases start here' },
        {
          label: 'tasks read-only',
          title:
            'Caseworkers can’t change tasks in this status (interactive: false)'
        }
      ],
      tellsGas: { kind: 'text', text: 'start' }
    })
    expect(panelFor('WITHDRAWN').waysIn).toBeNull()
  })

  test('has no initial status when the first stage is empty, as CW cannot start a case', () => {
    const phases = onePhase(
      ['EMPTY', []],
      [
        'S',
        [
          status('A', [action('P:S:B', 'GO')]),
          status('B', [], { closes: true })
        ]
      ]
    )

    expect(panelFor('A', found, phases).findings).toEqual([
      { kind: 'unreachable' }
    ])
    expect(panelFor('B', found, phases).findings).toEqual([])
  })

  test('lists a target not on the map as it is stored, with no link', () => {
    const phases = onePhase([
      'S',
      [
        status('A', [gas('P:S:GONE'), gas('::B')]),
        status('B', [], { closes: true })
      ]
    ])
    expect(panelFor('A', found, phases).waysOut.map(({ to }) => to)).toEqual([
      {
        name: 'P:S:GONE',
        stageName: null,
        code: 'P:S:GONE',
        position: 'P:S:GONE',
        href: null
      },
      { name: '::B', stageName: null, code: '::B', position: '::B', href: null }
    ])
  })

  test('names the moves out of a status, with their action and its badges', () => {
    expect(panelFor('IN_REVIEW').waysOut).toEqual([
      {
        to: ref('Approved', 'PRE_AWARD:REVIEW:APPROVED', 'APPROVED'),
        move: {
          kind: 'action',
          name: 'Approve',
          code: 'APPROVE',
          badges: ['comment', 'confirm']
        },
        tasks: null
      },
      {
        to: ref('Rejected', 'PRE_AWARD:REVIEW:REJECTED', 'REJECTED'),
        move: {
          kind: 'action',
          name: 'Reject',
          code: 'REJECT',
          badges: ['comment required', 'confirm']
        },
        tasks: null
      },
      {
        to: ref('On hold', 'PRE_AWARD:REVIEW:ON_HOLD', 'ON_HOLD'),
        move: {
          kind: 'action',
          name: 'Put on hold',
          code: 'PUT_ON_HOLD',
          badges: ['comment required']
        },
        tasks: null
      },
      {
        to: ref(
          'Information requested',
          'PRE_AWARD:REVIEW:RFI_SENT',
          'RFI_SENT'
        ),
        move: {
          kind: 'action',
          name: 'Request information',
          code: 'SEND_RFI',
          badges: ['comment required']
        },
        tasks: null
      }
    ])
  })

  test('says an action waits for the mandatory tasks, and a move GAS sends dead-letters while they are open', () => {
    const phases = onePhase([
      'S',
      [
        status('A', [action('P:S:B', 'GO', true), gas('P:S:B', true)]),
        status('B', [], { closes: true })
      ],
      tasksOf(true)
    ])

    expect(
      panelFor('A', found, phases).waysOut.map(({ tasks }) => tasks)
    ).toEqual([
      { kind: 'needs-tasks', stageName: 'S', href: 'tasks#stage-P:S' },
      {
        kind: 'gas-blocked',
        stageName: 'S',
        href: '/dev-ops/events/cw/inbox?status=DEAD_LETTER'
      }
    ])
  })

  test('says a move that checks tasks never blocks in a stage with no mandatory task', () => {
    const phases = onePhase([
      'S',
      [
        status('A', [action('P:S:B', 'GO', true)]),
        status('B', [], { closes: true })
      ],
      tasksOf(false)
    ])

    expect(panelFor('A', found, phases).waysOut[0].tasks).toEqual({
      kind: 'none-in-stage'
    })
  })

  test('says a status with no way out closes the case', () => {
    expect(panelFor('REJECTED')).toMatchObject({ waysOut: [], closes: true })
    expect(panelFor('AWAITING_ACCEPTANCE')).toMatchObject({
      waysOut: [],
      closes: false
    })
  })

  test('names each way in by its status, naming the stage outside this one, and its action', () => {
    expect(panelFor('IN_REVIEW').waysIn).toEqual([
      {
        from: ref(
          'Awaiting review',
          'PRE_AWARD:REVIEW:AWAITING_REVIEW',
          'AWAITING_REVIEW'
        ),
        via: { kind: 'action', name: 'Start review', code: 'START_REVIEW' }
      },
      {
        from: ref('On hold', 'PRE_AWARD:REVIEW:ON_HOLD', 'ON_HOLD'),
        via: { kind: 'action', name: 'Resume review', code: 'RESUME' }
      },
      {
        from: ref(
          'Information requested',
          'PRE_AWARD:REVIEW:RFI_SENT',
          'RFI_SENT'
        ),
        via: { kind: 'gas' }
      }
    ])
    expect(panelFor('APPROVED').waysOut[0].to).toEqual(
      ref(
        'Awaiting acceptance',
        'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE',
        'POST_AWARD:AGREEMENT:AWAITING_ACCEPTANCE',
        'Agreement'
      )
    )
  })

  test('names the status, its theme and phase and stage, and its flags in order, each explained', () => {
    expect(panelFor('WITHDRAWN')).toMatchObject({
      id: 'PRE_AWARD:REVIEW:WITHDRAWN',
      name: 'Withdrawn',
      tone: 'neutral',
      flags: [
        { label: 'tasks read-only' },
        { label: 'closes case', title: 'CW marks the case closed here' },
        {
          label: 'hides tasks',
          title: 'The case page hides the task list in this status'
        }
      ],
      phase: { code: 'PRE_AWARD', name: 'Pre-award' },
      stage: { code: 'REVIEW', name: 'Review application' }
    })
    expect(panelFor('ON_HOLD')).toMatchObject({ tone: 'warning', flags: [] })
  })

  test('Tells GAS what it does for an unreachable status too', () => {
    expect(panelFor('WITHDRAWN').tellsGas).toEqual({ kind: 'ignored' })
  })

  test('Tells GAS it sends nothing when only GAS moves into the status', () => {
    expect(panelFor('AWAITING_ACCEPTANCE').tellsGas).toEqual({
      kind: 'text',
      text: 'gas-only'
    })
  })

  test.each([
    'no-grant',
    'not-stored',
    'unreadable',
    'unavailable',
    'timed-out'
  ] as const)(
    'Tells GAS, for a grant read that is %s, so, naming and linking the grant version',
    (outcome) => {
      expect(panelFor('IN_REVIEW', { outcome }).tellsGas).toEqual({
        kind: 'grant',
        outcome,
        name: 'woodland-creation@1.2.0',
        href: 'grant-page<PRE_AWARD:REVIEW:IN_REVIEW'
      })
    }
  )

  test('Tells GAS it ignores a status no CW mapping names by its full position', () => {
    expect(panelFor('REJECTED').tellsGas).toEqual({ kind: 'ignored' })
    expect(
      panelFor(
        'IN_REVIEW',
        withMappings([
          cwMapping(
            'IN_REVIEW',
            'PRE_AWARD:REVIEW',
            'PRE_AWARD:REVIEW:IN_REVIEW'
          )
        ])
      ).tellsGas
    ).toEqual({ kind: 'ignored' })
  })

  test('Tells GAS the grant status it moves to, named, with the keyed stage and phase', () => {
    expect(
      panelFor(
        'ON_HOLD',
        withMappings([
          cwMapping(
            'PRE_AWARD:REVIEW:ON_HOLD',
            'PRE_AWARD:REVIEW',
            'PRE_AWARD:APPLICATION:AMEND'
          )
        ])
      ).tellsGas
    ).toEqual({
      kind: 'mapped',
      lines: [
        {
          stage: { code: 'REVIEW', name: 'Review' },
          phase: { code: 'PRE_AWARD', name: 'Pre award' },
          mappedTo: 'PRE_AWARD:APPLICATION:AMEND',
          to: {
            name: 'Amend',
            position: 'PRE_AWARD:APPLICATION:AMEND',
            href: 'grant:PRE_AWARD:APPLICATION:AMEND<PRE_AWARD:REVIEW:ON_HOLD'
          }
        }
      ]
    })
  })

  test('Tells GAS a target off the grant map as text, and one GAS cannot read as ignored', () => {
    const offMap = withMappings([
      cwMapping('PRE_AWARD:REVIEW:ON_HOLD', 'PRE_AWARD:REVIEW', 'P::X', 'P::X'),
      cwMapping('PRE_AWARD:REVIEW:ON_HOLD', 'POST_AWARD:AGREEMENT', null, 'A:B')
    ])

    expect(panelFor('ON_HOLD', offMap).tellsGas).toMatchObject({
      kind: 'mapped',
      lines: [
        { to: { name: 'X', position: 'P::X', href: null } },
        { mappedTo: 'A:B', to: null }
      ]
    })
  })

  test('counts only the first copy of a status held twice', () => {
    const phases = onePhase([
      'S',
      [
        status('A', [action('P:S:B', 'FIRST')]),
        status('B', [], { closes: true }),
        status('A', [action('P:S:B', 'SECOND')])
      ]
    ])
    expect(statesOf('A', phases).map(({ id }) => id)).toEqual([
      'P:S:A',
      'P:S:B'
    ])
    expect(
      panelFor('A', found, phases).waysOut.map(({ move }) => move)
    ).toMatchObject([{ code: 'FIRST' }])
    expect(panelFor('B', found, phases).waysIn).toEqual([
      {
        from: ref('A', 'P:S:A', 'A'),
        via: { kind: 'action', name: 'FIRST', code: 'FIRST' }
      }
    ])
  })

  test('has no panel without statuses', () => {
    expect(tabFor(undefined, found, onePhase(['S', []]))).toMatchObject({
      selected: '',
      panels: []
    })
  })

  test('selects by full position or bare code, and the first status otherwise', () => {
    expect(panelFor('PRE_AWARD:REVIEW:ON_HOLD').id).toBe(
      'PRE_AWARD:REVIEW:ON_HOLD'
    )
    expect(panelFor('ON_HOLD').id).toBe('PRE_AWARD:REVIEW:ON_HOLD')
    expect(panelFor('junk').id).toBe('PRE_AWARD:REVIEW:AWAITING_REVIEW')
  })

  test('draws a panel for every status, and submits a pick to this tab', () => {
    const tab = tabFor(undefined)

    expect(tab.panels).toHaveLength(statesOf().length)
    expect(tab.form).toStrictEqual({
      id: 'phases-pick',
      action: '/dev-ops/workflows/woodland-creation/1.2.0',
      hidden: [{ name: 'tab', value: 'phases' }]
    })
  })
})

describe('toWorkflowPhases: a status GAS may send that CW has no move to', () => {
  const generating = 'PRE_AWARD:REVIEW:APPROVED'
  const drafted = 'POST_AWARD:AGREEMENT:OFFERED'
  const withdrawn = 'PRE_AWARD:REVIEW:WITHDRAWN'

  const tellsCw = (
    process: string,
    setsStatus: string | null = null,
    onlyWhen: string | null = null
  ) => ({ process, setsStatus, tellsCw: true, onlyWhen })

  const into = (
    effects: ReturnType<typeof tellsCw>[] = []
  ): GrantLifecycle['waysIn'][number] => ({
    to: generating,
    kind: 'move',
    from: 'PRE_AWARD:REVIEW:IN_REVIEW',
    processes: effects.map(({ process }) => process),
    processEffects: effects
  })

  const storeCase: GrantLifecycle['waysIn'][number] = {
    to: drafted,
    kind: 'move',
    from: generating,
    processes: ['STORE_AGREEMENT_CASE'],
    processEffects: [tellsCw('STORE_AGREEMENT_CASE')]
  }

  const agreementsOffered: ExternalStatusMapping = {
    source: 'AS',
    code: 'offered',
    whileIn: 'PRE_AWARD:REVIEW',
    mappedTo: drafted,
    to: drafted
  }

  const mismatchOf = (
    sends: { name: string; position: string; defined: boolean },
    when: object
  ) => ({
    kind: 'mismatch',
    version: '1.2.0',
    at: { name: 'Approved', position: generating, defined: true },
    sends,
    when
  })

  test('is found when another service then moves GAS on through a process that tells CW', () => {
    const grant = withEffects(
      [into(), storeCase],
      [...lifecycle.externalMappings, agreementsOffered]
    )

    expect(panelFor('IN_REVIEW', grant).findings).toEqual([])
    expect(panelFor('APPROVED', grant).findings).toEqual([
      mismatchOf(
        { name: 'Offered', position: drafted, defined: true },
        { kind: 'sends', source: 'Agreements', code: 'offered' }
      )
    ])
    expect(tabFor(undefined, grant).findings?.statuses).toContainEqual({
      name: 'Approved',
      href: 'status:PRE_AWARD:REVIEW:APPROVED',
      lead: 'mismatch'
    })
  })

  test('is not found for a way out CW triggers, or one nothing in this version triggers', () => {
    const byCw: ExternalStatusMapping = {
      ...agreementsOffered,
      source: 'CW',
      code: 'PRE_AWARD:REVIEW:ON_HOLD'
    }

    expect(
      panelFor(
        'APPROVED',
        withEffects([into(), storeCase], [...lifecycle.externalMappings, byCw])
      ).findings
    ).toEqual([])
    expect(
      panelFor('APPROVED', withEffects([into(), storeCase])).findings
    ).toEqual([])
  })

  test("is found for what the move CW's message makes tells CW itself", () => {
    expect(
      panelFor(
        'APPROVED',
        withEffects([into([tellsCw('REQUEST_WITHDRAWAL', 'WITHDRAWN')])])
      ).findings
    ).toEqual([
      mismatchOf(
        { name: 'Withdrawn', position: withdrawn, defined: false },
        { kind: 'move' }
      )
    ])
  })

  test("is not found for a move into the status from outside the stage CW's message is keyed on", () => {
    const fromElsewhere = {
      ...into([tellsCw('REQUEST_WITHDRAWAL', 'WITHDRAWN')]),
      from: 'PRE_AWARD:APPLICATION:RECEIVED'
    }

    expect(panelFor('APPROVED', withEffects([fromElsewhere])).findings).toEqual(
      []
    )
  })

  test('is found for a move into the status from any status', () => {
    const fromAny: GrantLifecycle['waysIn'][number] = {
      to: generating,
      kind: 'any',
      processes: ['REQUEST_WITHDRAWAL'],
      processEffects: [tellsCw('REQUEST_WITHDRAWAL', 'WITHDRAWN')]
    }

    expect(panelFor('APPROVED', withEffects([fromAny])).findings).toEqual([
      mismatchOf(
        { name: 'Withdrawn', position: withdrawn, defined: false },
        { kind: 'move' }
      )
    ])
  })

  test('is found when another service moves GAS on by a way from any status', () => {
    const storeFromAny: GrantLifecycle['waysIn'][number] = {
      to: drafted,
      kind: 'any',
      processes: ['STORE_AGREEMENT_CASE'],
      processEffects: [tellsCw('STORE_AGREEMENT_CASE')]
    }
    const grant = withEffects(
      [into(), storeFromAny],
      [...lifecycle.externalMappings, agreementsOffered]
    )

    expect(panelFor('APPROVED', grant).findings).toEqual([
      mismatchOf(
        { name: 'Offered', position: drafted, defined: true },
        { kind: 'sends', source: 'Agreements', code: 'offered' }
      )
    ])
  })

  test('is found for the claim move GAS tells CW about', () => {
    const grant: GrantStatusMap = {
      outcome: 'found',
      lifecycle: {
        ...lifecycle,
        waysIn: [into()],
        claimApproval: { from: generating, to: drafted, tellsCw: true }
      }
    }

    expect(panelFor('APPROVED', grant).findings).toEqual([
      mismatchOf(
        { name: 'Offered', position: drafted, defined: true },
        { kind: 'claim' }
      )
    ])
  })

  test('says only quietly what GAS sends under a condition it cannot decide here', () => {
    const panel = panelFor(
      'APPROVED',
      withEffects([
        into([
          tellsCw(
            'REQUEST_APPLICATION_WITHDRAWAL',
            'WITHDRAWN',
            'no agreement is on offer'
          )
        ])
      ])
    )

    expect(panel.findings).toEqual([])
    expect(panel.maySend).toEqual([
      {
        onlyWhen: 'no agreement is on offer',
        sends: { name: 'Withdrawn', position: withdrawn, defined: false }
      }
    ])
  })

  test('is not looked for without what GAS processes do', () => {
    expect(
      panelFor(
        'ON_HOLD',
        withMappings([
          cwMapping('PRE_AWARD:REVIEW:ON_HOLD', 'PRE_AWARD:REVIEW', generating)
        ])
      ).findings
    ).toEqual([])
  })
})
