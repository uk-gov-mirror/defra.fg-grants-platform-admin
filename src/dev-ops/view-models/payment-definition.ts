import {
  contextRootsOf,
  isCollection,
  isObject,
  reads,
  readsRows,
  toMappingRows,
  toMappingValue
} from './mapping-table.ts'
import type { Mapping, MappingValue } from './mapping-table.ts'
import { toValueCell, toValueRows } from './mapping-rows.ts'
import type { ValueCell, ValueRow } from './mapping-rows.ts'

/** One field of an invoice line, by the label the page gives it; null where the key is absent. */
export interface LineCell {
  label: string
  cell: ValueCell | null
}

type InvoiceLineRow =
  | { kind: 'line'; cells: LineCell[] }
  | { kind: 'from'; value: ValueCell }

type InvoiceLines =
  | { kind: 'lines'; forEach: string | null; rows: InvoiceLineRow[] }
  | { kind: 'from'; value: ValueCell }

/** `forEach` names what a collection of due payments walks. */
interface DueTitle {
  text: string
  forEach: string | null
}

type DuePayment =
  | {
      kind: 'due'
      title: DueTitle
      dueDate: ValueCell | null
      totalAmountPence: ValueCell | null
      lines: InvoiceLines
    }
  | { kind: 'from'; title: DueTitle; value: ValueCell }

/** A value GAS calculates, by where it is, with its whole expression. */
interface CalculatedField {
  field: string
  expression: string
}

/** The context a payment reads, as GAS hands it over. */
type Root = 'claim' | 'agreement' | 'execution' | 'row'

export interface PaymentDefinitionView {
  /** When GAS requests this payment. */
  requestedWhen: { claim: boolean; agreement: boolean }
  /** The tabs that say more; null where that tab is not offered. */
  hrefs: PaymentContext['hrefs']
  reads: Root[]
  /** Reads both a claim and an agreement: claim payments find no agreement. */
  mixed: boolean
  version: string
  /** Reads the agreement's own rows, whose refs GAS has replaced with ids. */
  readsAgreementRows: boolean
  request: ValueRow[]
  duePayments: DuePayment[]
  calculated: CalculatedField[]
  /** The stored definition, as Raw shows it. */
  raw: string
}

export interface PaymentContext {
  version: string
  hrefs: { entitlements: string; agreement: string | null }
}

interface Item {
  value: unknown
  forEach: MappingValue | null
}

const toField = (mapping: Mapping, key: string): ValueCell | null =>
  Object.hasOwn(mapping, key) ? toValueCell(toMappingValue(mapping[key])) : null

/**
 * A collection gives one item per row and an array its elements; a collection
 * or array inside one resolves to a nested list, which GAS rejects, so it
 * stays a single item.
 */
const toItems = (value: unknown): Item[] => {
  if (isCollection(value)) {
    return [{ value: value.items, forEach: toMappingValue(value.itemsRef) }]
  }

  return (Array.isArray(value) ? value : [value]).map((element) => ({
    value: element,
    forEach: null
  }))
}

/** A plain mapping of fields: neither a list nor a collection. */
const isFields = (value: unknown): value is Mapping =>
  isObject(value) && !isCollection(value)

const lineLabels: [string, string][] = [
  ['schemeCode', 'Scheme'],
  ['description', 'Description'],
  ['amountPence', 'Amount (pence)'],
  ['accountCode', 'Account'],
  ['fundCode', 'Fund'],
  ['deliveryBody', 'Delivery body'],
  ['marketingYear', 'Marketing year']
]

const toLine = (mapping: Mapping): InvoiceLineRow => ({
  kind: 'line',
  cells: lineLabels.map(([key, label]) => ({
    label,
    cell: toField(mapping, key)
  }))
})

const fromCell = (value: unknown): ValueCell =>
  toValueCell(toMappingValue(value))

const toInvoiceLineRow = ({ value }: Item): InvoiceLineRow =>
  isFields(value) ? toLine(value) : { kind: 'from', value: fromCell(value) }

const toLines = (value: unknown): InvoiceLines => ({
  kind: 'lines',
  forEach: isCollection(value) ? toMappingValue(value.itemsRef).text : null,
  rows: toItems(value).map(toInvoiceLineRow)
})

/** Absent is no lines; a string or other scalar is a mapping the lines come from. */
const toInvoiceLines = (value: unknown): InvoiceLines => {
  if (value === undefined) {
    return toLines([])
  }

  return value !== null && typeof value === 'object'
    ? toLines(value)
    : { kind: 'from', value: fromCell(value) }
}

/** A calculated list is too long for a title; its For each row gives it. */
const toCollectionTitle = ({ kind, text }: MappingValue): DueTitle =>
  kind === 'expression'
    ? {
        text: 'Due payments (one per item of the list it calculates)',
        forEach: null
      }
    : { text: 'Due payments', forEach: text }

/** "Due payment", "Due payment 2 of 3", or for a collection what it repeats for. */
const toArrayTitle = (index: number, count: number): DueTitle =>
  count > 1
    ? { text: `Due payment ${index + 1} of ${count}`, forEach: null }
    : { text: 'Due payment', forEach: null }

const toTitle = (payments: unknown, index: number, count: number): DueTitle => {
  if (isCollection(payments)) {
    return toCollectionTitle(toMappingValue(payments.itemsRef))
  }

  return Array.isArray(payments)
    ? toArrayTitle(index, count)
    : { text: 'Due payments', forEach: null }
}

const toDuePayment =
  (payments: unknown, count: number) =>
  ({ value }: Item, index: number): DuePayment => {
    const title = toTitle(payments, index, count)

    return isFields(value)
      ? {
          kind: 'due',
          title,
          dueDate: toField(value, 'dueDate'),
          totalAmountPence: toField(value, 'totalAmountPence'),
          lines: toInvoiceLines(value.invoiceLines)
        }
      : { kind: 'from', title, value: fromCell(value) }
  }

const calculatedOf = (
  field: string,
  cell: ValueCell | null
): CalculatedField[] =>
  cell?.calculated ? [{ field, expression: cell.value ?? '' }] : []

const lineCalculated = (lines: InvoiceLines): CalculatedField[] =>
  lines.kind === 'lines'
    ? lines.rows.flatMap((row) =>
        row.kind === 'line'
          ? row.cells.flatMap(({ label, cell }) =>
              calculatedOf(`${label} (invoice line)`, cell)
            )
          : []
      )
    : []

const dueCalculated = (due: DuePayment): CalculatedField[] =>
  due.kind === 'due'
    ? [
        ...calculatedOf('Due date', due.dueDate),
        ...calculatedOf('Total (pence)', due.totalAmountPence),
        ...lineCalculated(due.lines)
      ]
    : []

/** Every calculated value once, so each table can point here instead of carrying the expression. */
const toCalculated = (
  request: ValueRow[],
  due: DuePayment[]
): CalculatedField[] => {
  const all = [
    ...request.flatMap((row) => calculatedOf(row.field, row)),
    ...due.flatMap(dueCalculated)
  ]

  return all.filter(
    (field, at) =>
      all.findIndex(
        (other) =>
          other.field === field.field && other.expression === field.expression
      ) === at
  )
}

const knownRoots: Root[] = ['claim', 'agreement', 'execution']

const agreementRows =
  /\$\.agreement\.(?:actions|items|paymentSchedule\.instalments)/

/** Neither root read: either trigger may request it, so both are said. */
const toRequestedWhen = (
  roots: ReadonlySet<string>
): PaymentDefinitionView['requestedWhen'] => {
  const either = !roots.has('claim') && !roots.has('agreement')

  return {
    claim: either || roots.has('claim'),
    agreement: either || roots.has('agreement')
  }
}

/** Odd shapes show as they are, so the operator sees what GAS will resolve. */
export const toPaymentDefinition = (
  definition: Mapping,
  context: PaymentContext
): PaymentDefinitionView => {
  const { code: _code, payments, ...request } = definition
  const roots = contextRootsOf(definition)
  const items = toItems(payments === undefined ? [] : payments)
  const requestRows = toValueRows(toMappingRows(request))
  const duePayments = items.map(toDuePayment(payments, items.length))

  return {
    requestedWhen: toRequestedWhen(roots),
    hrefs: context.hrefs,
    reads: [
      ...knownRoots.filter((root) => roots.has(root)),
      ...(readsRows(definition) ? (['row'] as const) : [])
    ],
    mixed: roots.has('claim') && roots.has('agreement'),
    version: context.version,
    readsAgreementRows: reads(definition, agreementRows),
    request: requestRows,
    duePayments,
    calculated: toCalculated(requestRows, duePayments),
    raw: JSON.stringify(definition, null, 2)
  }
}
