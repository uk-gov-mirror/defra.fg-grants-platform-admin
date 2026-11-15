import type {
  GrantQuestionsCard,
  GrantQuestionsTab,
  PhaseTitle,
  SchemaField,
  SchemaTreeRow
} from './grant-questions.ts'
import type { Word, Words } from './words.ts'

export interface QuestionRow {
  /** Dotted from the root: `applicant.business.name`, an array as `parcels[]`. */
  path: string
  type: string
  required: boolean
  closed: boolean
  constraints: string[]
}

/** What a phase's section holds in place of a table. */
type QuestionsNotice =
  | { kind: 'empty' }
  | { kind: 'any' }
  | { kind: 'problem'; text: string }

export interface QuestionsSection {
  title: string
  /** GAS runs only the first phase's questions on submission. */
  checked: boolean
  body: { kind: 'table'; rows: QuestionRow[] } | QuestionsNotice
}

export type QuestionsView =
  | { kind: 'sections'; sections: QuestionsSection[] }
  | { kind: 'no-phases' }

/** A word's text alone, whatever draws it. */
const wordText = (word: Word): string =>
  typeof word === 'string' ? word : Object.values(word)[0]

const textOf = (words: Words): string => words.map(wordText).join('')

/** A name, else the code nothing names, else its place. */
const toTitle = (title: PhaseTitle): string =>
  'code' in title ? (title.name ?? title.code) : `Phase ${title.index}`

interface Condition {
  indent: number
  text: string
}

interface Walk {
  parents: string[]
  conditions: Condition[]
  rows: QuestionRow[]
}

/** A group's rows sit one deeper than its heading; a row back at its depth has left it. */
const inScope = (conditions: Condition[], indent: number): Condition[] =>
  conditions.filter((condition) => condition.indent < indent)

const toRow = (field: SchemaField, walk: Walk): QuestionRow => {
  const conditions = inScope(walk.conditions, field.indent)

  return {
    path: [...walk.parents, field.name].join('.'),
    type: textOf(field.type),
    required: field.required,
    closed: field.closed,
    constraints: [
      ...conditions.map(({ text }) => `only ${text.toLowerCase()}`),
      ...field.constraints.map(textOf)
    ]
  }
}

const steps: {
  [K in SchemaTreeRow['kind']]: (
    row: Extract<SchemaTreeRow, { kind: K }>,
    walk: Walk
  ) => Walk
} = {
  open: (row, walk) => ({
    ...walk,
    rows: [...walk.rows, toRow(row.field, walk)],
    parents: [...walk.parents, row.field.name]
  }),
  field: (row, walk) => ({
    ...walk,
    rows: [...walk.rows, toRow(row.field, walk)]
  }),
  end: (_row, walk) => ({ ...walk, parents: walk.parents.slice(0, -1) }),
  group: (row, walk) => ({
    ...walk,
    conditions: [
      ...inScope(walk.conditions, row.indent + 1),
      { indent: row.indent, text: textOf(row.heading) }
    ]
  })
}

/** The tree as one row per property, each named by its whole path. */
export const toQuestionRows = (tree: SchemaTreeRow[]): QuestionRow[] =>
  tree.reduce<Walk>(
    (walk, row) =>
      (steps[row.kind] as (row: SchemaTreeRow, walk: Walk) => Walk)(row, walk),
    { parents: [], conditions: [], rows: [] }
  ).rows

const problems: Partial<Record<GrantQuestionsCard['kind'], string>> = {
  missing: 'This phase has no questions: every submission throws.',
  'rejects-all': 'These questions reject every answer.',
  'not-a-schema': 'These questions aren’t a JSON Schema object.',
  'not-an-object': 'This phase isn’t an object.'
}

const toSchemaBody = (rows: SchemaTreeRow[]): QuestionsSection['body'] => {
  const table = toQuestionRows(rows)

  return table.length ? { kind: 'table', rows: table } : { kind: 'empty' }
}

const toBody = (card: GrantQuestionsCard): QuestionsSection['body'] => {
  if (card.kind === 'schema') {
    return toSchemaBody(card.rows)
  }

  const problem = problems[card.kind]

  if (problem) {
    return { kind: 'problem', text: problem }
  }

  return card.kind === 'accepts-any' ? { kind: 'any' } : { kind: 'empty' }
}

/** One section per phase, as the tab draws it. */
export const toQuestionsView = (tab: GrantQuestionsTab): QuestionsView =>
  tab.kind === 'no-phases'
    ? tab
    : {
        kind: 'sections',
        sections: tab.cards.map((card) => ({
          title: toTitle(card.title),
          checked: card.usedByGas,
          body: toBody(card)
        }))
      }
