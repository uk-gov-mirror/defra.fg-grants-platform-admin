import { toHumanCode, toPositionTrail } from './position.ts'

describe('toHumanCode', () => {
  test.each([
    ['STATUS_OFFER_ACCEPTED', 'Offer accepted'],
    ['PHASE_PRE_AWARD', 'Pre award'],
    ['STAGE_ASSESSMENT', 'Assessment'],
    ['APPLICATION_RECEIVED', 'Application received']
  ])('reads %s as %s', (code, label) => {
    expect(toHumanCode(code)).toBe(label)
  })
})

describe('toPositionTrail', () => {
  test('runs phase, stage and status, the status current', () => {
    expect(
      toPositionTrail({
        phase: 'PHASE_PRE_AWARD',
        stage: 'STAGE_ASSESSMENT',
        status: 'STATUS_IN_REVIEW'
      })
    ).toEqual([
      { label: 'Pre award', current: false },
      { label: 'Assessment', current: false },
      { label: 'In review', current: true }
    ])
  })

  test('leaves out a step the record has not got', () => {
    expect(
      toPositionTrail({ phase: null, stage: null, status: 'STATUS_NEW' })
    ).toEqual([{ label: 'New', current: true }])
  })
})
