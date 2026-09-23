import { diffLines } from 'diff'
import type { ChangeObject } from 'diff'

export type DiffOp = 'same' | 'removed' | 'added' | 'skipped'

/** `a` and `b` are the line's number before and after; a skipped run carries neither. */
export interface DiffRow {
  op: DiffOp
  a: number | null
  b: number | null
  text: string
}

export interface PayloadDiff {
  rows: DiffRow[]
  /** jsdiff gave up: the page shows the whole payload instead. */
  tooLong: boolean
}

const context = 3

/** Myers is O((N+M)·D), so the number of changed lines is what is bounded. */
export const maxEditLength = 1000

const linesOf = (change: ChangeObject<string>): string[] =>
  change.value.split('\n').slice(0, change.count)

const opOf = (change: ChangeObject<string>): DiffOp => {
  if (change.added) {
    return 'added'
  }

  return change.removed ? 'removed' : 'same'
}

interface Numbering {
  a: number
  b: number
}

const advances: Record<DiffOp, [number, number]> = {
  same: [1, 1],
  removed: [1, 0],
  added: [0, 1],
  skipped: [0, 0]
}

const toRow = (op: DiffOp, text: string, next: Numbering): DiffRow => {
  const [a, b] = advances[op]

  next.a += a
  next.b += b

  return { op, a: a ? next.a : null, b: b ? next.b : null, text }
}

const toRows = (changes: ChangeObject<string>[]): DiffRow[] => {
  const next = { a: 0, b: 0 }

  return changes.flatMap((change) =>
    linesOf(change).map((text) => toRow(opOf(change), text, next))
  )
}

const isNearChange = (rows: DiffRow[], index: number): boolean =>
  rows
    .slice(Math.max(0, index - context), index + context + 1)
    .some((row) => row.op !== 'same')

const skipped = (count: number): DiffRow => ({
  op: 'skipped',
  a: null,
  b: null,
  text: `${count} unchanged ${count === 1 ? 'line' : 'lines'}`
})

/** Runs of unchanged lines further than three from a change fold into one row saying how many. */
const collapse = (rows: DiffRow[]): DiffRow[] => {
  const shown: DiffRow[] = []
  let hidden = 0

  rows.forEach((row, index) => {
    if (!isNearChange(rows, index)) {
      hidden++

      return
    }

    shown.push(...(hidden ? [skipped(hidden)] : []), row)
    hidden = 0
  })

  return hidden ? [...shown, skipped(hidden)] : shown
}

/** Both texts end in a line break, so a change to the last line is a changed line and not a missing newline. */
export const toPayloadDiff = (before: string, after: string): PayloadDiff => {
  const changes = diffLines(`${before}\n`, `${after}\n`, { maxEditLength })

  return changes === undefined
    ? { rows: [], tooLong: true }
    : { rows: collapse(toRows(changes)), tooLong: false }
}
