import type { GrantLifecycle } from '../use-cases/get-grant-page.use-case.ts'
import { toGrantPhases } from './grant-phases.view-model.ts'

const href = '/dev-ops/grants/woodland-creation/1.2.0'
const from = '/dev-ops/grants'

const lifecycle: GrantLifecycle = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre award',
      stages: [
        {
          code: 'APPLICATION',
          name: 'Application',
          statuses: [
            { code: 'RECEIVED', name: 'Application received' },
            { code: 'AMEND' }
          ]
        },
        {
          code: 'REVIEW',
          name: null,
          statuses: [{ code: 'IN_REVIEW', name: null }, { code: 'APPROVED' }]
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
          statuses: [{ code: 'OFFERED' }, { code: 'CLAIMS_COMPLETE' }]
        }
      ]
    }
  ],
  initialPosition: 'PRE_AWARD:APPLICATION:RECEIVED',
  amendablePositions: ['PRE_AWARD:APPLICATION:AMEND'],
  waysIn: [
    { to: 'PRE_AWARD:APPLICATION:RECEIVED', kind: 'any', processes: [] },
    {
      to: 'PRE_AWARD:APPLICATION:AMEND',
      kind: 'move',
      from: 'PRE_AWARD:APPLICATION:RECEIVED',
      processes: []
    },
    {
      to: 'PRE_AWARD:APPLICATION:AMEND',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      processes: ['NOTIFY']
    },
    {
      to: 'PRE_AWARD:APPLICATION:AMEND',
      kind: 'unmatched',
      code: 'PRE_AWARD:REVIEW:ON_HOLD',
      processes: ['HOLD', 'NOTIFY']
    },
    {
      to: 'PRE_AWARD:REVIEW:IN_REVIEW',
      kind: 'move',
      from: 'PRE_AWARD:APPLICATION:RECEIVED',
      processes: []
    },
    {
      to: 'PRE_AWARD:REVIEW:APPROVED',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:IN_REVIEW',
      processes: ['GENERATE_AGREEMENT']
    },
    {
      to: 'POST_AWARD:AGREEMENT:OFFERED',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:APPROVED',
      processes: []
    },
    {
      to: 'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE',
      kind: 'any',
      processes: ['PAY']
    }
  ],
  externalMappings: [
    {
      source: 'CW',
      code: 'PRE_AWARD:REVIEW_APPLICATION:RFI_SENT',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: '::AMEND',
      to: 'PRE_AWARD:APPLICATION:AMEND'
    },
    {
      source: 'AS',
      code: 'offered',
      whileIn: 'POST_AWARD:AGREEMENT',
      mappedTo: 'OFFERED',
      to: 'POST_AWARD:AGREEMENT:OFFERED'
    },
    {
      source: 'XX',
      code: 'odd',
      whileIn: 'POST_AWARD:AGREEMENT',
      mappedTo: 'OFFERED',
      to: 'POST_AWARD:AGREEMENT:OFFERED'
    },
    {
      source: 'CW',
      code: 'BROKEN',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: 'S:X',
      to: null
    },
    {
      source: 'CW',
      code: 'OFF_MAP',
      whileIn: 'PRE_AWARD:REVIEW',
      mappedTo: 'P::X',
      to: 'P::X'
    }
  ],
  claimApproval: {
    from: 'POST_AWARD:AGREEMENT:OFFERED',
    to: 'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
  }
}

type MapTab = Extract<ReturnType<typeof toGrantPhases>, { kind: 'map' }>

const phasesOf = (
  status: string | undefined,
  workflowHref: ((code: string, back: string) => string) | null = null,
  read: GrantLifecycle = lifecycle
): MapTab =>
  toGrantPhases(
    { lifecycle: read, problem: null },
    { status, href, from, workflowHref }
  ) as MapTab

const panelOf = (
  position: string,
  read: GrantLifecycle = lifecycle,
  workflowHref: ((code: string, back: string) => string) | null = null
) =>
  phasesOf(position, workflowHref, read).panels.find(
    ({ id }) => id === position
  )

const statusHref = (position: string) =>
  `${href}?tab=phases&back=%2Fdev-ops%2Fgrants&status=${encodeURIComponent(position)}`

const stateOf = (tab: MapTab, position: string) =>
  tab.phases
    .flatMap(({ stages }) => stages.flatMap(({ states }) => states))
    .find(({ id }) => id === position)

/** GAS-16's read: what each process does, and that the claim move tells CW. */
const withEffects: GrantLifecycle = {
  ...lifecycle,
  waysIn: [
    ...lifecycle.waysIn.map((wayIn) => ({ ...wayIn, processEffects: [] })),
    {
      to: 'PRE_AWARD:REVIEW:IN_REVIEW',
      kind: 'move',
      from: 'PRE_AWARD:REVIEW:APPROVED',
      processes: ['REQUEST_APPLICATION_WITHDRAWAL'],
      processEffects: [
        {
          process: 'REQUEST_APPLICATION_WITHDRAWAL',
          setsStatus: 'APPROVED',
          tellsCw: true,
          onlyWhen: 'no agreement is on offer'
        },
        {
          process: 'REQUEST_APPLICATION_WITHDRAWAL',
          setsStatus: 'WITHDRAWN',
          tellsCw: true,
          onlyWhen: null
        }
      ]
    }
  ],
  claimApproval: { ...lifecycle.claimApproval!, tellsCw: true }
}

describe('toGrantPhases', () => {
  test('is nothing when GAS sent neither a lifecycle nor a problem', () => {
    expect(
      toGrantPhases(
        { lifecycle: null, problem: null },
        { status: undefined, href, from, workflowHref: null }
      )
    ).toBeNull()
  })

  test("says why GAS cannot read the grant's lifecycle", () => {
    expect(
      toGrantPhases(
        { lifecycle: null, problem: '"phases" must contain at least 1 items' },
        { status: undefined, href, from, workflowHref: null }
      )
    ).toStrictEqual({
      kind: 'unreadable',
      problem: '"phases" must contain at least 1 items'
    })
  })

  test('maps each status by phase and stage, by name, with no tone of its own', () => {
    const { phases } = phasesOf(undefined)

    expect(phases[0]).toMatchObject({
      id: 'PRE_AWARD',
      label: 'Pre award',
      stages: [
        {
          id: 'PRE_AWARD:APPLICATION',
          label: 'Application',
          states: [
            {
              id: 'PRE_AWARD:APPLICATION:RECEIVED',
              label: 'Application received',
              tone: 'neutral',
              badge: 'initial'
            },
            { id: 'PRE_AWARD:APPLICATION:AMEND', label: 'Amend' }
          ]
        },
        { id: 'PRE_AWARD:REVIEW', label: 'Review' }
      ]
    })
    expect(phases[1].label).toBe('Post award')
  })

  test('marks a status entered by a GAS process with its cog, and one entered by a move alone', () => {
    const tab = phasesOf(undefined)

    expect(stateOf(tab, 'PRE_AWARD:REVIEW:APPROVED')).toMatchObject({
      kind: 'process',
      icon: 'cog',
      iconLabel: 'Runs GENERATE_AGREEMENT'
    })
    expect(stateOf(tab, 'PRE_AWARD:REVIEW:IN_REVIEW')).toMatchObject({
      kind: 'move'
    })
    expect(stateOf(tab, 'PRE_AWARD:REVIEW:IN_REVIEW')?.icon).toBeUndefined()
  })

  test('picks the initial status when none is asked for, and the asked one by position or bare code', () => {
    expect(phasesOf(undefined).selected).toBe('PRE_AWARD:APPLICATION:RECEIVED')
    expect(phasesOf('PRE_AWARD:REVIEW:IN_REVIEW').selected).toBe(
      'PRE_AWARD:REVIEW:IN_REVIEW'
    )
    expect(phasesOf('APPROVED').selected).toBe('PRE_AWARD:REVIEW:APPROVED')
    expect(phasesOf('NOPE').selected).toBe('PRE_AWARD:APPLICATION:RECEIVED')
  })

  test('draws a panel for every status, so a pick shows its own in place', () => {
    expect(phasesOf(undefined).panels.map(({ id }) => id)).toStrictEqual([
      'PRE_AWARD:APPLICATION:RECEIVED',
      'PRE_AWARD:APPLICATION:AMEND',
      'PRE_AWARD:REVIEW:IN_REVIEW',
      'PRE_AWARD:REVIEW:APPROVED',
      'POST_AWARD:AGREEMENT:OFFERED',
      'POST_AWARD:AGREEMENT:CLAIMS_COMPLETE'
    ])
  })

  test('submits a pick to this tab, keeping back', () => {
    expect(phasesOf(undefined).form).toStrictEqual({
      id: 'phases-pick',
      action: href,
      hidden: [
        { name: 'tab', value: 'phases' },
        { name: 'back', value: from }
      ]
    })
  })

  test('names the phase and stage, badges the initial and amendable statuses', () => {
    expect(panelOf('PRE_AWARD:APPLICATION:RECEIVED')).toMatchObject({
      name: 'Application received',
      badges: ['initial'],
      phase: 'Pre award',
      stage: 'Application'
    })
    expect(panelOf('PRE_AWARD:APPLICATION:AMEND')?.badges).toStrictEqual([
      'amendable'
    ])
  })

  test('says what a status runs, or that it is a move only', () => {
    expect(panelOf('PRE_AWARD:APPLICATION:AMEND')?.runs).toStrictEqual({
      kind: 'processes',
      processes: ['NOTIFY']
    })
    expect(panelOf('PRE_AWARD:REVIEW:IN_REVIEW')?.runs).toStrictEqual({
      kind: 'move-only'
    })
  })

  test('lists the ways in by link, a code nothing matches, and from any status', () => {
    expect(panelOf('PRE_AWARD:APPLICATION:AMEND')?.waysIn).toMatchObject([
      {
        kind: 'move',
        from: {
          name: 'Application received',
          href: statusHref('PRE_AWARD:APPLICATION:RECEIVED')
        }
      },
      { kind: 'move', from: { name: 'In review' } },
      { kind: 'code', code: 'PRE_AWARD:REVIEW:ON_HOLD' }
    ])
    expect(panelOf('PRE_AWARD:APPLICATION:RECEIVED')?.waysIn).toStrictEqual([
      { kind: 'any' }
    ])
  })

  test('lists the ways out by link', () => {
    expect(
      panelOf('PRE_AWARD:APPLICATION:RECEIVED')?.waysOut.map(({ name }) => name)
    ).toStrictEqual(['Amend', 'In review'])
  })

  test('names each trigger by its source and the stage it is keyed on, warning of a source GAS does not name', () => {
    expect(panelOf('POST_AWARD:AGREEMENT:OFFERED')?.triggeredBy).toMatchObject([
      {
        kind: 'external',
        source: 'Agreements',
        unknown: false,
        code: 'offered',
        stageName: 'Agreement'
      },
      {
        kind: 'external',
        source: 'unknown source XX',
        unknown: true,
        code: 'odd'
      }
    ])
  })

  test("links a CW trigger to the workflow's status, coming back to this one", () => {
    const [trigger] =
      panelOf(
        'PRE_AWARD:APPLICATION:AMEND',
        lifecycle,
        (code, back) => `/wf?status=${code}&back=${back}`
      )?.triggeredBy ?? []

    expect(trigger).toMatchObject({
      kind: 'external',
      source: 'CW',
      href: `/wf?status=PRE_AWARD:REVIEW_APPLICATION:RFI_SENT&back=${statusHref('PRE_AWARD:APPLICATION:AMEND')}`,
      missingStage: null
    })
  })

  test('says the last claim triggers its move, linking Entitlements', () => {
    expect(
      panelOf('POST_AWARD:AGREEMENT:CLAIMS_COMPLETE')?.triggeredBy
    ).toMatchObject([
      {
        kind: 'claim',
        at: { name: 'Offered' },
        href: `${href}?tab=entitlements&back=%2Fdev-ops%2Fgrants`
      }
    ])
  })

  test('says the initial status is set on submission when nothing else sets it', () => {
    expect(panelOf('PRE_AWARD:APPLICATION:RECEIVED')?.noTrigger).toBe('initial')
  })
})

describe('toGrantPhases with what GAS processes do', () => {
  test('lists a status a GAS process sets itself under Triggered by', () => {
    expect(
      panelOf('PRE_AWARD:REVIEW:APPROVED', withEffects)?.triggeredBy
    ).toStrictEqual([
      {
        kind: 'gas',
        process: 'REQUEST_APPLICATION_WITHDRAWAL',
        onEntering: 'In review',
        onlyWhen: 'no agreement is on offer'
      }
    ])
  })

  test('warns of a status GAS sets that the grant does not define', () => {
    expect(
      panelOf('PRE_AWARD:REVIEW:IN_REVIEW', withEffects)?.undefinedTargets
    ).toStrictEqual([
      { position: 'PRE_AWARD:REVIEW:WITHDRAWN', onlyWhen: null }
    ])
  })

  test('counts only the processes GAS has a handler for', () => {
    expect(
      panelOf('PRE_AWARD:REVIEW:IN_REVIEW', withEffects)?.runs
    ).toStrictEqual({
      kind: 'processes',
      processes: ['REQUEST_APPLICATION_WITHDRAWAL']
    })
  })

  test('says nothing sets a status nothing triggers, and marks it on the map', () => {
    const withClosure: GrantLifecycle = {
      ...withEffects,
      phases: [
        ...withEffects.phases,
        {
          code: 'CLOSURE',
          name: null,
          stages: [{ code: 'END', name: null, statuses: [{ code: 'CLOSED' }] }]
        }
      ]
    }

    expect(panelOf('CLOSURE:END:CLOSED', withClosure)?.noTrigger).toBe(
      'nothing'
    )
    expect(
      stateOf(phasesOf(undefined, null, withClosure), 'CLOSURE:END:CLOSED')
    ).toMatchObject({
      icon: 'triangle-alert',
      iconTone: 'warning',
      iconLabel: 'Nothing in this version sets it'
    })
  })

  test('never flags a status or says nothing sets it while GAS does not say what its processes do', () => {
    const tab = phasesOf(undefined)

    expect(panelOf('PRE_AWARD:REVIEW:APPROVED')?.noTrigger).toBeNull()
    expect(
      tab.phases
        .flatMap(({ stages }) => stages.flatMap(({ states }) => states))
        .some(({ iconTone }) => iconTone === 'warning')
    ).toBe(false)
  })
})
