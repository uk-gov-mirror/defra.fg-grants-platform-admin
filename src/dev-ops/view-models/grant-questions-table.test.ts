import { toGrantQuestions } from './grant-questions.ts'
import { toQuestionRows, toQuestionsView } from './grant-questions-table.ts'
import type { SchemaField } from './grant-questions.ts'

const field = (name: string, indent: number): SchemaField => ({
  name,
  title: null,
  description: null,
  required: false,
  type: [{ code: 'string' }],
  constraints: [],
  defaultValue: null,
  closed: false,
  from: null,
  indent
})

describe('toQuestionRows', () => {
  test('names each property by its whole path, arrays with their brackets', () => {
    expect(
      toQuestionRows([
        { kind: 'open', field: { ...field('parcels[]', 0), closed: true } },
        { kind: 'field', field: field('id', 1) },
        { kind: 'end' },
        { kind: 'field', field: field('name', 0) }
      ]).map(({ path, closed }) => [path, closed])
    ).toEqual([
      ['parcels[]', true],
      ['parcels[].id', false],
      ['name', false]
    ])
  })

  test("says a branch's rows apply only under its condition, until a row is back at the condition's depth", () => {
    const rows = toQuestionRows([
      { kind: 'field', field: field('kind', 0) },
      {
        kind: 'group',
        heading: ['If ', { code: 'kind' }, ' is company'],
        indent: 0
      },
      {
        kind: 'field',
        field: { ...field('companyNumber', 1), constraints: [['length ', '8']] }
      },
      { kind: 'field', field: field('notes', 0) }
    ])

    expect(rows.map(({ path, constraints }) => [path, constraints])).toEqual([
      ['kind', []],
      ['companyNumber', ['only if kind is company', 'length 8']],
      ['notes', []]
    ])
  })
})

describe('toQuestionsView', () => {
  test('heads each phase by its name, its code when it has none, else its place', () => {
    const view = toQuestionsView(
      toGrantQuestions({
        phases: [
          {
            code: 'PRE_AWARD',
            name: 'Pre-award',
            questions: { type: 'object' }
          },
          { code: 'POST_AWARD' },
          {}
        ]
      })
    )

    expect(view).toEqual({
      kind: 'sections',
      sections: [
        { title: 'Pre-award', checked: true, body: { kind: 'empty' } },
        { title: 'POST_AWARD', checked: false, body: { kind: 'empty' } },
        { title: 'Phase 3', checked: false, body: { kind: 'empty' } }
      ]
    })
  })

  test.each([
    [undefined, 'This phase has no questions: every submission throws.'],
    [false, 'These questions reject every answer.'],
    ['text', 'These questions aren’t a JSON Schema object.']
  ])(
    'says what is wrong with first-phase questions of %s',
    (questions, text) => {
      expect(
        toQuestionsView(
          toGrantQuestions({ phases: [{ code: 'A', questions }] })
        )
      ).toEqual({
        kind: 'sections',
        sections: [
          { title: 'A', checked: true, body: { kind: 'problem', text } }
        ]
      })
    }
  )

  test('says any answer is accepted for questions of true', () => {
    expect(
      toQuestionsView(
        toGrantQuestions({ phases: [{ code: 'A', questions: true }] })
      )
    ).toMatchObject({ sections: [{ body: { kind: 'any' } }] })
  })

  test('says a phase that is not an object is not one', () => {
    expect(toQuestionsView(toGrantQuestions({ phases: ['x'] }))).toMatchObject({
      sections: [
        {
          title: 'Phase 1',
          body: { kind: 'problem', text: 'This phase isn’t an object.' }
        }
      ]
    })
  })

  test('passes no phases on', () => {
    expect(toQuestionsView(toGrantQuestions({ phases: [] }))).toEqual({
      kind: 'no-phases'
    })
  })
})
