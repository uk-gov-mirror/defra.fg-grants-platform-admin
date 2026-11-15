/** Longer arrays start folded; objects and the document itself always start open. */
const arrayOpenMax = 12

const indentWidth = 2

interface JsonLine {
  kind: 'line'
  number: number
  text: string
}

interface JsonOpen {
  kind: 'open'
  number: number
  text: string
  open: boolean
  /** What a folded node shows after its opening bracket. */
  size: string
  closing: string
}

interface JsonEnd {
  kind: 'end'
}

export type JsonRow = JsonLine | JsonOpen | JsonEnd

export interface JsonView {
  rows: JsonRow[]
}

type Entry = [string | null, unknown]

const plural = (count: number, noun: string) =>
  `${count} ${noun}${count === 1 ? '' : 's'}`

const isContainer = (value: unknown): value is object =>
  typeof value === 'object' && value !== null

const shapeOf = (value: object) =>
  Array.isArray(value)
    ? {
        opening: '[',
        closing: ']',
        noun: 'item',
        folds: true,
        entries: value.map((item): Entry => [null, item])
      }
    : {
        opening: '{',
        closing: '}',
        noun: 'key',
        folds: false,
        entries: Object.entries(value)
      }

const startsOpen = (depth: number, folds: boolean, count: number): boolean =>
  depth === 0 || !folds || count <= arrayOpenMax

const commaAfter = (index: number, count: number): string =>
  index === count - 1 ? '' : ','

const indent = (depth: number): string => ' '.repeat(depth * indentWidth)

/** Where a value sits: under which key, how deep, and whether a comma follows it. */
interface Place {
  key: string | null
  depth: number
  comma: string
}

class Walk {
  readonly rows: JsonRow[] = []
  #number = 0

  #next(): number {
    this.#number += 1
    return this.#number
  }

  #line(text: string) {
    this.rows.push({ kind: 'line', number: this.#next(), text })
  }

  visit(value: unknown, place: Place) {
    const lead = `${indent(place.depth)}${place.key === null ? '' : `${JSON.stringify(place.key)}: `}`

    if (!isContainer(value)) {
      this.#line(`${lead}${JSON.stringify(value)}${place.comma}`)
      return
    }

    this.#container(value, lead, place)
  }

  #container(value: object, lead: string, { depth, comma }: Place) {
    const { opening, closing, noun, folds, entries } = shapeOf(value)

    if (entries.length === 0) {
      this.#line(`${lead}${opening}${closing}${comma}`)
      return
    }

    this.rows.push({
      kind: 'open',
      number: this.#next(),
      text: `${lead}${opening}`,
      open: startsOpen(depth, folds, entries.length),
      size: plural(entries.length, noun),
      closing: `${closing}${comma}`
    })
    entries.forEach(([key, item], index) =>
      this.visit(item, {
        key,
        depth: depth + 1,
        comma: commaAfter(index, entries.length)
      })
    )
    this.#line(`${indent(depth)}${closing}${comma}`)
    this.rows.push({ kind: 'end' })
  }
}

const viewOf = (parsed: unknown): JsonView => {
  const walk = new Walk()

  walk.visit(parsed, { key: null, depth: 0, comma: '' })

  return { rows: walk.rows }
}

/** A JSON text, drawn as `JSON.stringify(JSON.parse(text), null, 2)` prints it. */
/** Read through a JSON round trip first, so what is drawn is exactly what `JSON.stringify` would print. */
export const toJsonView = (value: unknown): JsonView =>
  viewOf(JSON.parse(JSON.stringify(value)))
