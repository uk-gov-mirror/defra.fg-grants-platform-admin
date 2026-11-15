import { findWorkflowVersionPage } from '../repositories/workflows.repository.ts'
import type { WorkflowVersionPage } from '../repositories/workflows.repository.ts'
import { readGrantStatusMap } from './grant-status-map.ts'
import type { GrantLifecycle } from '../repositories/grants.repository.ts'
import {
  forgetPositionNames,
  namesBudgetMs,
  readApplicationPositionNames,
  readCasePositionNames,
  toPositionNames,
  withPositionNames
} from './read-position-names.use-case.ts'
import { woodlandPhases } from './test-fixtures.ts'

vi.mock(import('../repositories/workflows.repository.ts'))
vi.mock(import('./grant-status-map.ts'))
vi.mock(import('../../common/logger.ts'))

const lifecycle = {
  phases: [
    {
      code: 'PHASE_PRE_AWARD',
      name: 'Pre-award',
      stages: [
        {
          code: 'STAGE_REVIEW',
          name: null,
          statuses: [{ code: 'STATUS_RECEIVED' }]
        }
      ]
    }
  ],
  initialPosition: 'PHASE_PRE_AWARD:STAGE_REVIEW:STATUS_RECEIVED'
} as GrantLifecycle

const names = {
  phases: [
    {
      code: 'PHASE_PRE_AWARD',
      name: 'Pre-award',
      stages: [
        {
          code: 'STAGE_REVIEW',
          name: null,
          statuses: [{ code: 'STATUS_RECEIVED', name: null }]
        }
      ]
    }
  ]
}

const workflowWith = (phases: unknown) =>
  ({
    definition: { workflow: { phases }, addresses: [] }
  }) as unknown as WorkflowVersionPage

const ref = { code: 'woodland', version: '1.43.2' }

const at = (time: string) => vi.setSystemTime(new Date(`2026-10-13T${time}Z`))

const found = () =>
  vi
    .mocked(readGrantStatusMap)
    .mockResolvedValue({ outcome: 'found', lifecycle })

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
  at('15:00:00.000')
  forgetPositionNames()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('readApplicationPositionNames', () => {
  test("keeps only the codes and names of the grant version's phases", async () => {
    found()

    expect(await readApplicationPositionNames(ref)).toEqual(names)
    expect(readGrantStatusMap).toHaveBeenCalledWith(ref)
  })

  test('keeps what it read for a minute, then reads again', async () => {
    found()

    await readApplicationPositionNames(ref)
    at('15:00:59.000')
    await readApplicationPositionNames(ref)
    expect(readGrantStatusMap).toHaveBeenCalledTimes(1)

    at('15:01:00.000')
    await readApplicationPositionNames(ref)
    expect(readGrantStatusMap).toHaveBeenCalledTimes(2)
  })

  test('keeps each version apart', async () => {
    found()

    await readApplicationPositionNames(ref)
    await readApplicationPositionNames({ ...ref, version: '1.43.3' })

    expect(readGrantStatusMap).toHaveBeenCalledTimes(2)
  })

  test('reads a version once while one read of it is under way', async () => {
    found()

    await Promise.all([
      readApplicationPositionNames(ref),
      readApplicationPositionNames(ref),
      readApplicationPositionNames(ref)
    ])

    expect(readGrantStatusMap).toHaveBeenCalledTimes(1)
  })

  test.each([
    'no-grant',
    'not-stored',
    'unreadable',
    'unavailable',
    'timed-out'
  ] as const)(
    'has no names when the grant is %s, and tries again only after a few seconds',
    async (outcome) => {
      vi.mocked(readGrantStatusMap).mockResolvedValue({ outcome })

      expect(await readApplicationPositionNames(ref)).toBeNull()
      at('15:00:09.000')
      await readApplicationPositionNames(ref)
      expect(readGrantStatusMap).toHaveBeenCalledTimes(1)

      at('15:00:10.000')
      await readApplicationPositionNames(ref)
      expect(readGrantStatusMap).toHaveBeenCalledTimes(2)
    }
  )

  test('has no names, and keeps that no longer than a miss, when the read throws', async () => {
    vi.mocked(readGrantStatusMap).mockRejectedValue(new Error('boom'))

    expect(await readApplicationPositionNames(ref)).toBeNull()
    at('15:00:10.000')
    found()
    expect(await readApplicationPositionNames(ref)).toEqual(names)
  })

  test('drops what it kept once expired, and the oldest past 200 versions', async () => {
    found()

    for (let n = 0; n < 201; n++) {
      await readApplicationPositionNames({ ...ref, version: `1.0.${n}` })
    }
    await readApplicationPositionNames({ ...ref, version: '1.0.200' })
    expect(readGrantStatusMap).toHaveBeenCalledTimes(201)

    await readApplicationPositionNames({ ...ref, version: '1.0.0' })
    expect(readGrantStatusMap).toHaveBeenCalledTimes(202)

    at('15:01:00.000')
    await readApplicationPositionNames({ ...ref, version: '1.0.200' })
    expect(readGrantStatusMap).toHaveBeenCalledTimes(203)
  })

  test('reads nothing for an application with no version', async () => {
    expect(
      await readApplicationPositionNames({ code: 'woodland', version: null })
    ).toBeNull()
    expect(readGrantStatusMap).not.toHaveBeenCalled()
  })
})

describe('readCasePositionNames', () => {
  test("keeps only the codes and names of the workflow version's phases", async () => {
    vi.mocked(findWorkflowVersionPage).mockResolvedValue(
      workflowWith(woodlandPhases)
    )

    const read = await readCasePositionNames(ref)

    expect(findWorkflowVersionPage).toHaveBeenCalledWith(ref, 'definition')
    expect(read?.phases.map(({ code }) => code)).toEqual(
      woodlandPhases.map(({ code }) => code)
    )
    expect(Object.keys(read!.phases[0].stages[0])).toEqual([
      'code',
      'name',
      'statuses'
    ])
    expect(Object.keys(read!.phases[0].stages[0].statuses[0])).toEqual([
      'code',
      'name'
    ])
  })

  test.each([
    ['no phases', undefined],
    ['phases that are not a list', { PRE_AWARD: {} }],
    ['a phase with no code', [{ name: 'Pre-award', stages: [] }]],
    ['a phase with no stages', [{ code: 'PRE_AWARD', name: 'Pre-award' }]],
    [
      'a stage with no statuses',
      [{ code: 'PRE_AWARD', name: 'Pre-award', stages: [{ code: 'REVIEW' }] }]
    ],
    [
      'a status that is not an object',
      [{ code: 'A', stages: [{ code: 'B', statuses: ['IN_REVIEW'] }] }]
    ]
  ])(
    'has no names, and keeps that only as a miss, for a definition with %s',
    async (_, phases) => {
      vi.mocked(findWorkflowVersionPage).mockResolvedValue(workflowWith(phases))

      expect(await readCasePositionNames(ref)).toBeNull()
      at('15:00:10.000')
      await readCasePositionNames(ref)
      expect(findWorkflowVersionPage).toHaveBeenCalledTimes(2)
    }
  )

  test('has no names when the definition is not stored or too large', async () => {
    vi.mocked(findWorkflowVersionPage).mockResolvedValue({
      ...workflowWith(woodlandPhases),
      definition: null
    })

    expect(await readCasePositionNames(ref)).toBeNull()
  })

  test('has no names when GAS could not read the workflow', async () => {
    vi.mocked(findWorkflowVersionPage).mockRejectedValue(new Error('boom'))

    expect(await readCasePositionNames(ref)).toBeNull()
  })
})

describe('toPositionNames', () => {
  test('reads a name that is not text as none', () => {
    expect(toPositionNames([{ code: 'A', name: 7, stages: [] }])).toEqual({
      phases: [{ code: 'A', name: null, stages: [] }]
    })
  })
})

describe('withPositionNames', () => {
  const read = vi.fn(async () => names)

  test('adds the names of the version the page names', async () => {
    expect(
      await withPositionNames(
        { outcome: 'found', page: { ref: 'a' } },
        () => ref,
        read
      )
    ).toEqual({ outcome: 'found', page: { ref: 'a', names } })
  })

  test('draws the page without names once the budget is spent', async () => {
    const slow = vi.fn(
      () =>
        new Promise<typeof names>((resolve) => {
          setTimeout(() => resolve(names), namesBudgetMs + 1000)
        })
    )

    const page = withPositionNames(
      { outcome: 'found', page: { ref: 'a' } },
      () => ref,
      slow
    )
    await vi.advanceTimersByTimeAsync(namesBudgetMs)

    expect(await page).toEqual({
      outcome: 'found',
      page: { ref: 'a', names: null }
    })
  })

  test.each([
    ['names no version', () => null],
    ['has no version', () => ({ code: 'woodland', version: null })]
  ])('reads no names for a page that %s', async (_, versionOf) => {
    expect(
      await withPositionNames(
        { outcome: 'found', page: { ref: 'a' } },
        versionOf,
        read
      )
    ).toEqual({ outcome: 'found', page: { ref: 'a', names: null } })
    expect(read).not.toHaveBeenCalled()
  })

  test('leaves a record the service could not show as it is', async () => {
    expect(
      await withPositionNames(
        { outcome: 'timed-out', page: null },
        () => null,
        read
      )
    ).toEqual({ outcome: 'timed-out', page: null })
  })
})
