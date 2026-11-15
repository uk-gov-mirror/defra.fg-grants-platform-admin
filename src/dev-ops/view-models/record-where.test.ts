import type { PositionNames } from '../use-cases/read-position-names.use-case.ts'
import { isEmptyPosition, toStatusName, toWhere } from './record-where.ts'

const names: PositionNames = {
  phases: [
    {
      code: 'PRE_AWARD',
      name: 'Pre award',
      stages: [
        {
          code: 'REVIEW',
          name: 'Review application',
          statuses: [
            { code: 'RECEIVED', name: 'Application received' },
            { code: 'ON_HOLD', name: null }
          ]
        },
        { code: 'AGREEMENT', name: null, statuses: [] }
      ]
    },
    { code: 'AWARD', name: null, stages: [] }
  ]
}

const at = (
  phase: string | null,
  stage: string | null,
  status: string | null
) => ({
  phase,
  stage,
  status
})

describe('toWhere', () => {
  test('steps through every phase, at the current one, with the stage by name', () => {
    expect(toWhere(at('PRE_AWARD', 'REVIEW', 'RECEIVED'), names)).toEqual({
      kind: 'stepper',
      steps: [{ label: 'Pre award' }, { label: 'Award' }],
      current: 0,
      stage: 'Review application'
    })
  })

  test('reads the code of a stage the definition does not name', () => {
    expect(toWhere(at('PRE_AWARD', 'AGREEMENT', null), names)).toMatchObject({
      stage: 'Agreement'
    })
  })

  test('says the phase and stage as facts, readable, without the names', () => {
    expect(toWhere(at('PHASE_PRE_AWARD', 'STAGE_REVIEW', null), null)).toEqual({
      kind: 'facts',
      facts: [
        { label: 'Phase', text: 'Pre award' },
        { label: 'Stage', text: 'Review' }
      ]
    })
  })

  test('says the facts when the phase is not one the definition has', () => {
    expect(toWhere(at('CLAIM', 'PAY', null), names)).toEqual({
      kind: 'facts',
      facts: [
        { label: 'Phase', text: 'Claim' },
        { label: 'Stage', text: 'Pay' }
      ]
    })
  })

  test('leaves the values out of a position the record has not got', () => {
    expect(toWhere(at(null, null, null), names)).toEqual({
      kind: 'facts',
      facts: [
        { label: 'Phase', text: null },
        { label: 'Stage', text: null }
      ]
    })
  })
})

describe('toStatusName', () => {
  test.each([
    [
      'named in its stage',
      at('PRE_AWARD', 'REVIEW', 'RECEIVED'),
      names,
      'Application received'
    ],
    [
      'unnamed in its stage',
      at('PRE_AWARD', 'REVIEW', 'ON_HOLD'),
      names,
      'On hold'
    ],
    [
      'in a stage it is not in',
      at('PRE_AWARD', 'AGREEMENT', 'RECEIVED'),
      names,
      'Received'
    ],
    [
      'without the names',
      at('PRE_AWARD', 'REVIEW', 'STATUS_RECEIVED'),
      null,
      'Received'
    ],
    ['with no status', at('PRE_AWARD', 'REVIEW', null), names, null]
  ])('is the status %s', (_, position, given, expected) => {
    expect(toStatusName(position, given)).toBe(expected)
  })
})

describe('isEmptyPosition', () => {
  test('is true only when nothing is set', () => {
    expect(isEmptyPosition(at(null, null, null))).toBe(true)
    expect(isEmptyPosition(at(null, null, 'CLOSED'))).toBe(false)
  })
})
