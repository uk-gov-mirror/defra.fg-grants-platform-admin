import type { MappingRow, MappingValue } from './mapping-table.ts'

/** Where a value comes from, as a table's Value column leads with it. */
export type ValueHow = 'Fixed' | 'From' | 'Calculated' | 'For each' | 'List'

export interface ValueCell {
  how: ValueHow
  /** As written; an expression without its prefix. Null for an empty list. */
  value: string | null
  calculated: boolean
}

export interface ValueRow extends ValueCell {
  /** Dotted from the top of the mapping: `parcels.(each).id`. */
  field: string
}

const hows: Record<MappingValue['comesFrom'], ValueHow> = {
  fixed: 'Fixed',
  empty: 'Fixed',
  copied: 'From',
  calculated: 'Calculated',
  list: 'List',
  'for each': 'For each'
}

export const toValueCell = ({
  comesFrom,
  text,
  empty
}: MappingValue): ValueCell => ({
  how: hows[comesFrom],
  value: empty ? '""' : text,
  calculated: comesFrom === 'calculated'
})

const rowCells: {
  [K in MappingRow['kind']]: (
    row: Extract<MappingRow, { kind: K }>
  ) => ValueCell | null
} = {
  value: ({ value }) => toValueCell(value),
  each: ({ forEach }) => ({
    how: 'For each',
    value: forEach,
    calculated: false
  }),
  list: ({ empty }) =>
    empty ? { how: 'List', value: null, calculated: false } : null,
  group: () => null
}

const toRowCell = (row: MappingRow): ValueCell | null =>
  (rowCells[row.kind] as (row: MappingRow) => ValueCell | null)(row)

/** Every field that has a value of its own, named by its whole path; a heading over nested fields is left out. */
export const toValueRows = (rows: MappingRow[]): ValueRow[] => {
  const path: string[] = []

  return rows.flatMap((row) => {
    path.length = row.depth
    path.push(row.field)
    const cell = toRowCell(row)

    return cell ? [{ field: path.join('.'), ...cell }] : []
  })
}
