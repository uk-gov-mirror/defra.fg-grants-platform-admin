import type {
  StoredInput,
  StoredTask,
  StoredValueOption,
  StoredWorkflowPhase
} from '../use-cases/get-workflow-page.use-case.ts'
import { woodlandPhases } from '../use-cases/test-fixtures.ts'
import { toStageAnchor, toTaskGroups } from './workflow-tasks.view-model.ts'

type Stage = StoredWorkflowPhase['stages'][number]

const stage = (code: string, ...groups: [string, StoredTask[]][]): Stage => ({
  code,
  name: `Stage ${code}`,
  statuses: [],
  taskGroups: groups.map(([name, tasks]) => ({ code: 'GROUP', name, tasks }))
})

const onePhase = (
  ...stages: StoredWorkflowPhase['stages']
): StoredWorkflowPhase[] => [{ code: 'P', name: 'Phase', stages }]

type TaskFields = Partial<Omit<StoredTask, 'input' | 'valueOptions'>>

const task = (
  overrides: TaskFields & { valueOptions?: StoredValueOption[] } = {}
): StoredTask => ({
  code: 'TASK',
  name: 'Task',
  mandatory: true,
  valueOptions: [{ code: 'DONE', name: 'Done', completes: true }],
  ...overrides
})

const inputTask = (
  input: StoredInput,
  overrides: TaskFields = {}
): StoredTask => ({
  code: 'TASK',
  name: 'Task',
  mandatory: true,
  ...overrides,
  input
})

const answersOf = (stored: StoredTask) =>
  toTaskGroups(onePhase(stage('S', ['Group', [stored]])))[0].tasks[0].answers

describe('toTaskGroups', () => {
  test('gives a card per task group, in phase, stage and group order, with its stage name', () => {
    const phases: StoredWorkflowPhase[] = [
      {
        code: 'ONE',
        name: 'One',
        stages: [
          stage('A', ['First', [task()]], ['Second', [task()]]),
          stage('EMPTY')
        ]
      },
      { code: 'TWO', name: 'Two', stages: [stage('B', ['First', [task()]])] }
    ]

    expect(
      toTaskGroups(phases).map(({ name, stageName }) => [name, stageName])
    ).toEqual([
      ['First', 'Stage A'],
      ['Second', 'Stage A'],
      ['First', 'Stage B']
    ])
  })

  test("anchors a stage's first card only, so a link to the stage lands on it", () => {
    const cards = toTaskGroups(
      onePhase(
        stage('A', ['First', [task()]], ['Second', [task()]]),
        stage('B', ['Third', [task()]])
      )
    )

    expect(cards.map(({ anchor }) => anchor)).toEqual([
      'stage-P:A',
      null,
      'stage-P:B'
    ])
  })

  test('keeps hyphenated phase and stage codes apart, and safe in a fragment', () => {
    expect(toStageAnchor('PRE-AWARD', 'REVIEW')).not.toBe(
      toStageAnchor('PRE', 'AWARD-REVIEW')
    )
    expect(toStageAnchor('A:B', 'C D')).toBe('stage-A%3AB:C%20D')
  })

  test('gives no cards for a workflow without task groups', () => {
    expect(toTaskGroups(onePhase(stage('S')))).toEqual([])
  })

  test('keeps tasks in order, with whether each is mandatory', () => {
    const [card] = toTaskGroups(
      onePhase(
        stage('S', [
          'Group',
          [
            task({ name: 'First', mandatory: true }),
            task({ name: 'Second', mandatory: false })
          ]
        ])
      )
    )

    expect(card.tasks.map(({ name, mandatory }) => [name, mandatory])).toEqual([
      ['First', true],
      ['Second', false]
    ])
  })

  test('names each answer by its option, in order', () => {
    expect(
      answersOf(
        task({
          valueOptions: [
            { code: 'YES', name: 'Eligible', completes: true },
            { code: 'NO', name: 'Not eligible', completes: false }
          ]
        })
      )
    ).toEqual(['Eligible', 'Not eligible'])
  })

  test("names an input task's one answer by its type and label", () => {
    expect(
      answersOf(inputTask({ type: 'number', label: { text: 'Area' } }))
    ).toEqual(['Number: Area'])
    expect(answersOf(inputTask({ type: 'text', label: 'Notes' }))).toEqual([
      'Text: Notes'
    ])
  })

  test('gives a task with no options no answers', () => {
    expect(answersOf(task({ valueOptions: [] }))).toEqual([])
  })
})

describe('toTaskGroups: the moves a card must be complete before', () => {
  const reviewStage: Stage = {
    ...stage('REVIEW_APPLICATION', ['Eligibility checks', [task()]]),
    statuses: [
      {
        code: 'IN_REVIEW',
        name: 'In review',
        theme: 'INFO',
        interactive: true,
        hideTaskGroups: false,
        transitions: [
          {
            targetPosition: 'PRE_AWARD:FINAL_REVIEW:APPLICATION_APPROVED',
            checkTasks: false,
            action: {
              code: 'APPROVE',
              name: 'Approve',
              checkTasks: true,
              comment: null
            }
          },
          {
            targetPosition: 'PRE_AWARD:REVIEW_APPLICATION:ON_HOLD',
            checkTasks: false,
            action: {
              code: 'PUT_ON_HOLD',
              name: 'Put on hold',
              checkTasks: false,
              comment: null
            }
          }
        ]
      },
      {
        code: 'AGREEMENT_OFFERED',
        name: 'Agreement offered',
        theme: 'INFO',
        interactive: true,
        hideTaskGroups: false,
        transitions: [
          {
            targetPosition: 'P:REVIEW_APPLICATION:AGREEMENT_ACCEPTED',
            checkTasks: true,
            action: null
          },
          {
            targetPosition: 'PRE_AWARD:FINAL_REVIEW:APPLICATION_APPROVED',
            checkTasks: false,
            action: {
              code: 'APPROVE',
              name: 'Approve',
              checkTasks: true,
              comment: null
            }
          }
        ]
      },
      {
        code: 'AGREEMENT_ACCEPTED',
        name: 'Agreement accepted',
        theme: 'SUCCESS',
        interactive: true,
        hideTaskGroups: false,
        transitions: []
      }
    ]
  }

  test("names each action and GAS move of the card's stage that checks tasks, once each", () => {
    const [card] = toTaskGroups(onePhase(reviewStage))

    expect(card.completesWith).toEqual([
      'Approve',
      'GAS move to Agreement accepted'
    ])
  })

  test('leaves out an action whose own checkTasks is off, whatever its transition says, as CW does', () => {
    const [card] = toTaskGroups(
      onePhase({
        ...reviewStage,
        statuses: [
          {
            ...reviewStage.statuses[0],
            transitions: [
              {
                targetPosition: 'PRE_AWARD:FINAL_REVIEW:APPLICATION_APPROVED',
                checkTasks: true,
                action: {
                  code: 'APPROVE',
                  name: 'Approve',
                  checkTasks: false,
                  comment: null
                }
              }
            ]
          }
        ]
      })
    )

    expect(card.completesWith).toEqual([])
  })

  test("names a GAS move's target by its position when the workflow has no such status", () => {
    const [card] = toTaskGroups(
      onePhase({
        ...reviewStage,
        statuses: [
          {
            ...reviewStage.statuses[0],
            transitions: [
              { targetPosition: 'X:Y:Z', checkTasks: true, action: null }
            ]
          }
        ]
      })
    )

    expect(card.completesWith).toEqual(['GAS move to X:Y:Z'])
  })

  test('names none on a card with no mandatory task, which holds nothing up', () => {
    const [card] = toTaskGroups(
      onePhase({
        ...reviewStage,
        taskGroups: [
          {
            code: 'G',
            name: 'Optional',
            tasks: [task({ mandatory: false })]
          }
        ]
      })
    )

    expect(card.completesWith).toEqual([])
  })
})

describe('toTaskGroups on the prototype', () => {
  test("reads the prototype's woodland-creation 1.2.0", () => {
    const cards = toTaskGroups(woodlandPhases)

    expect(
      cards.map(({ name, stageName, anchor, tasks }) => ({
        name,
        stageName,
        anchor,
        tasks: tasks.map(({ name: taskName }) => taskName)
      }))
    ).toEqual([
      {
        name: 'Application checks',
        stageName: 'Review application',
        anchor: 'stage-PRE_AWARD:REVIEW',
        tasks: [
          'Check eligibility',
          'Check land parcels',
          'Record site visit date'
        ]
      },
      {
        name: 'Approval',
        stageName: 'Review application',
        anchor: null,
        tasks: ['Second check']
      }
    ])
  })
})
