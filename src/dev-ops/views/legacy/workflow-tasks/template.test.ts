import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import { woodlandPhases } from '../../../use-cases/test-fixtures.ts'
import { toTaskGroups } from '../../../view-models/workflow-tasks.view-model.ts'
import type {
  AnswerRow,
  TaskGroupCard,
  TaskRow
} from '../../../view-models/workflow-tasks.view-model.ts'

const testId = 'workflow-tasks'

const renderGroups = (groups: TaskGroupCard[] = toTaskGroups(woodlandPhases)) =>
  render('workflow-tasks', { groups, testId })

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="${testId}-${name}"]`)

const answer = (overrides: Partial<AnswerRow> = {}): AnswerRow => ({
  name: 'Accepted',
  shownAs: null,
  rules: [],
  completes: true,
  comment: {
    label: 'Explain this outcome',
    required: true,
    source: 'default',
    apiRequires: false
  },
  commentRows: 1,
  ...overrides
})

const card = (
  tasks: TaskRow[],
  overrides: Partial<TaskGroupCard> = {}
): TaskGroupCard => ({
  anchor: 'stage-PRE_AWARD:REVIEW',
  code: 'CHECKS',
  name: 'Checks',
  stage: { code: 'REVIEW', name: 'Review' },
  description: null,
  gates: [],
  conditional: false,
  tasks,
  ...overrides
})

const taskRow = (overrides: Partial<TaskRow> = {}): TaskRow => ({
  code: 'CHECK',
  name: 'Check',
  description: null,
  mandatory: true,
  condition: null,
  answers: [answer()],
  roles: [],
  ...overrides
})

const oneTask = (overrides: Partial<TaskRow> = {}) =>
  renderGroups([card([taskRow(overrides)])])

const tableCellsOf = ($: CheerioAPI) =>
  part($, 'table')
    .find(`[data-testid="${testId}-answer"]`)
    .toArray()
    .map((row) =>
      $(row)
        .children('td')
        .toArray()
        .map((cell) => flatten($(cell).text()))
    )

describe('workflow-tasks component', () => {
  test('says once, above the cards, how mandatory tasks and completing answers combine', () => {
    const $ = renderGroups()

    expect(part($, 'intro')).toHaveLength(1)
    expect(flatten(part($, 'intro').text())).toBe(
      'Before a move that needs tasks, every mandatory task in the stage must have an answer that completes it. Other answers record progress but keep the task open.'
    )
  })

  test('titles a card by its group name, then its code muted, with the stage beneath, labelling the card', () => {
    const $ = renderGroups()
    const [first] = part($, 'group').toArray()

    expect(flatten(part($, 'group-title').first().text())).toBe(
      'Application checks CHECKS'
    )
    expect(flatten(part($, 'group-stage').first().text())).toBe(
      'Review application REVIEW'
    )
    expect($(first).attr('aria-labelledby')).toBe(
      part($, 'group-title').first().attr('id')
    )
    expect($(first).attr('id')).toBe('stage-PRE_AWARD:REVIEW')
    expect($(part($, 'group').toArray()[1]).attr('id')).toBeUndefined()
  })

  test('says which moves the card must be complete before', () => {
    const $ = renderGroups([
      card([taskRow()], {
        gates: [
          { kind: 'action', name: 'Approve', code: 'APPROVE_APPLICATION' },
          {
            kind: 'gas',
            statusName: 'Agreement accepted',
            position: 'POST_AGREEMENT:MONITORING:AGREEMENT_ACCEPTED'
          }
        ]
      })
    ])

    expect(flatten(part($, 'gates').text())).toBe(
      'Must be complete before: Approve (APPROVE_APPLICATION) · GAS move to Agreement accepted'
    )
    expect(part($, 'gates').find('[title]').attr('title')).toBe(
      'POST_AGREEMENT:MONITORING:AGREEMENT_ACCEPTED'
    )
  })

  test('says the moves wait only where a conditional task applies', () => {
    const $ = renderGroups([
      card([taskRow()], {
        gates: [{ kind: 'action', name: 'Approve', code: 'APPROVE' }],
        conditional: true
      })
    ])

    expect(flatten(part($, 'gates').text())).toBe(
      'Must be complete before: Approve (APPROVE) (when it applies)'
    )
    expect(part($, 'gates-conditional').attr('class')).toBe(
      'text-base-content/70'
    )
  })

  test('says nothing of moves when the card holds none up', () => {
    const $ = oneTask()

    expect(part($, 'gates')).toHaveLength(0)
  })

  test('shows a description under its group or task, and counts one made of parts', () => {
    const $ = renderGroups([
      card(
        [
          taskRow({
            description: {
              kind: 'parts',
              count: 3,
              text: 'Check applicant details Name matches'
            }
          })
        ],
        { description: { kind: 'text', text: 'Check the generated offer.' } }
      )
    ])

    expect(part($, 'group-description').text()).toBe(
      'Check the generated offer.'
    )
    expect(part($, 'task-description').text()).toBe(
      'Shows a 3-part description to caseworkers'
    )
    expect(part($, 'task-description').attr('title')).toBe(
      'Check applicant details Name matches'
    )
    expect(part($, 'task-description').attr('class')).toContain(
      'text-base-content/70'
    )
  })

  test('heads each table Task, Mandatory, Answer, Counts as done, Comment and Roles, scrolling from sm up', () => {
    const $ = renderGroups()
    const table = part($, 'table').first()

    expect(
      table
        .find('th')
        .toArray()
        .map((head) => $(head).text())
    ).toEqual([
      'Task',
      'Mandatory',
      'Answer',
      'Counts as done',
      'Comment',
      'Roles'
    ])
    expect(
      table
        .find('col')
        .toArray()
        .map((col) => $(col).attr('class'))
    ).toEqual(['w-[17%]', 'w-[9%]', 'w-[27%]', 'w-[13%]', 'w-[20%]', 'w-[14%]'])
    expect(table.parent().attr('class')).toBe(
      'hidden w-full overflow-x-auto sm:block'
    )
    expect(table.attr('class')).toContain('min-w-[56rem]')
  })

  test('gives a row per answer, the task, mandatory and roles spanning its answers, and a rule above each task', () => {
    const $ = oneTask({
      answers: [answer(), answer({ name: 'Rejected', completes: false })]
    })
    const rows = part($, 'table').find(`[data-testid="${testId}-answer"]`)

    expect(tableCellsOf($)).toEqual([
      [
        'Check',
        'Yes',
        'Accepted',
        'Yes',
        'required “Explain this outcome” (CW default, frontend check only)',
        'Any caseworker'
      ],
      [
        'Rejected',
        'No',
        'required “Explain this outcome” (CW default, frontend check only)'
      ]
    ])
    expect(rows.first().children('td').first().attr('rowspan')).toBe('2')
    expect(rows.first().attr('class')).toContain('border-t border-base-300')
    expect(rows.eq(1).attr('class')).not.toContain('border-t')
  })

  test('shows a comment asked the same way by every answer once, spanning them', () => {
    const $ = oneTask({
      answers: [
        answer({ commentRows: 2 }),
        answer({ name: 'Rejected', completes: false, commentRows: 0 })
      ]
    })

    expect(
      part($, 'table').find(`[data-testid="${testId}-comment"]`)
    ).toHaveLength(1)
    expect(
      part($, 'table').find(`[data-testid="${testId}-comment"]`).attr('rowspan')
    ).toBe('2')
  })

  test('puts Yes in counts as done in medium weight, and mutes No', () => {
    const $ = oneTask({
      mandatory: false,
      answers: [answer(), answer({ name: 'Rejected', completes: false })]
    })
    const completes = part($, 'table').find(
      `[data-testid="${testId}-completes"]`
    )

    expect(completes.first().find('span').attr('class')).toBe('font-medium')
    expect(completes.eq(1).find('span').attr('class')).toBe(
      'text-base-content/70'
    )
  })

  test("badges a comment's rule first, quotes its prompt, and says where it is checked", () => {
    const commentOf = (comment: AnswerRow['comment']) =>
      flatten(
        part(oneTask({ answers: [answer({ comment })] }), 'table')
          .find(`[data-testid="${testId}-comment"]`)
          .text()
      )

    expect(
      commentOf({
        label: 'Why',
        required: false,
        source: 'option',
        apiRequires: false
      })
    ).toBe('optional “Why” (frontend check only)')
    expect(
      commentOf({
        label: 'Explain this outcome',
        required: true,
        source: 'default',
        apiRequires: false
      })
    ).toBe('required “Explain this outcome” (CW default, frontend check only)')
    expect(
      commentOf({
        label: 'Why',
        required: true,
        source: 'option',
        apiRequires: true
      })
    ).toBe(
      "required “Why” (CW's API requires one: the task's comment is mandatory)"
    )
    expect(
      commentOf({
        label: 'Task note',
        required: true,
        source: 'task',
        apiRequires: true
      })
    ).toBe('required “Task note”')
    expect(commentOf(null)).toBe('—')
    expect(part(oneTask(), 'table').find('.badge').attr('class')).toBe(
      'badge badge-ghost badge-sm'
    )
  })

  test('says what the task list shows once an option is chosen, and an input its rules, under the answer', () => {
    const $ = oneTask({
      answers: [
        answer({ shownAs: 'Low risk' }),
        answer({
          name: 'Number: Area',
          rules: ['0 to 5000', 'whole number'],
          completes: null,
          comment: null
        })
      ]
    })

    expect(
      part($, 'table').find(`[data-testid="${testId}-shown-as"]`).text()
    ).toBe('task list shows: Low risk')
    expect(
      part($, 'table').find(`[data-testid="${testId}-rules"]`).text()
    ).toBe('0 to 5000, whole number')
    expect(tableCellsOf($)[1][1]).toBe('When filled in')
  })

  test('says a conditional task is given only where its condition was set when the case entered the stage, apart from Mandatory', () => {
    const $ = oneTask({
      mandatory: false,
      condition: '$.payload.answers.hasPreviousGrant'
    })
    const table = part($, 'table')

    expect(
      flatten(table.find(`[data-testid="${testId}-condition"]`).text())
    ).toBe(
      'Only on cases where $.payload.answers.hasPreviousGrant was set and not null, false, 0 or "" when the case entered this stage (an empty list or object counts as set)'
    )
    expect(
      table.find(`[data-testid="${testId}-condition"] .font-mono`).text()
    ).toBe('$.payload.answers.hasPreviousGrant')
    expect(
      flatten(table.find(`[data-testid="${testId}-mandatory"]`).text())
    ).toBe('No')
  })

  test('says which roles a task needs, all of or any of, breaking long codes', () => {
    const $ = oneTask({
      roles: [
        { label: 'all of', roles: ['ROLE_QA_COMPLEX_CASEWORKER'] },
        { label: 'any of', roles: ['ROLE_A', 'ROLE_B'] }
      ]
    })
    const roles = part($, 'table').find(`[data-testid="${testId}-roles"]`)

    expect(
      roles
        .children('div')
        .toArray()
        .map((line) => flatten($(line).text()))
    ).toEqual(['all of: ROLE_QA_COMPLEX_CASEWORKER', 'any of: ROLE_A, ROLE_B'])
    expect(roles.find('wbr').length).toBeGreaterThan(0)
  })

  test('gives each task a block below sm: its name, Mandatory, a line per answer, then roles', () => {
    const $ = oneTask({
      answers: [
        answer({
          comment: {
            label: 'Why',
            required: false,
            source: 'task',
            apiRequires: false
          }
        }),
        answer({ name: 'Rejected', completes: false, comment: null }),
        answer({ name: 'Date: Visit', completes: null, comment: null })
      ]
    })
    const block = part($, 'block')

    expect(part($, 'blocks').attr('class')).toContain('sm:hidden')
    expect(block).toHaveLength(1)
    expect(
      block
        .children('div')
        .toArray()
        .map((line) => flatten($(line).text()))
    ).toEqual([
      'Check',
      'Mandatory · Yes',
      'Accepted · counts as done · comment optional',
      "Rejected · doesn't count as done",
      'Date: Visit · counts as done when filled in',
      'Roles · Any caseworker'
    ])
  })

  test('draws a task with no answers with a dash in each answer cell', () => {
    const $ = oneTask({ answers: [] })

    expect(tableCellsOf($)).toEqual([
      ['Check', 'Yes', '—', '—', '—', 'Any caseworker']
    ])
  })

  test('says there are no task groups', () => {
    const $ = renderGroups([])

    expect(flatten(part($, 'empty').text())).toBe(
      'No task groups in this version.'
    )
    expect(part($, 'intro')).toHaveLength(0)
  })
})
