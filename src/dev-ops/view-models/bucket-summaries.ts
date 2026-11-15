import type {
  BucketEntry,
  BucketSummary,
  FactValue
} from '../use-cases/get-catalogue.use-case.ts'
import type {
  SummaryEntry,
  SummaryRead,
  SummaryResult
} from '../use-cases/summarise-bucket.use-case.ts'
import { toBucketHref } from './bucket-links.ts'
import type { BucketFilters } from './bucket-links.ts'
import { showKey } from './bucket-toggles.ts'
import { none, toTimestamp } from './event-formats.ts'
import type { Timestamp, Zone } from './event-formats.ts'

/** One summary a list declares, and what was read for it. */
export interface SummarySource {
  summary: BucketSummary
  read: SummaryRead
}

interface Cell {
  text: string
  /** The rows that hold no value: named by the declaration, and no filter can ask for them. */
  missing: boolean
}

interface Entry {
  cells: Cell[]
  /** The list narrowed to the entry; none when one of its values is missing. */
  href: string | null
  countLabel: string
  first: Timestamp
  last: Timestamp
}

export interface SummarySection {
  id: string
  title: string
  /** One heading per `by` fact, in order. */
  valueLabels: string[]
  firstLabel: string
  lastLabel: string
  unavailable: boolean
  entries: Entry[]
  /** Said in place of the entries when there are none, so the section is not taken for missing. */
  emptyText: string
  notes: string[]
}

const counted = new Intl.NumberFormat('en-GB')

/** A summary is drawn only while the list's own filters do not rule out the rows it counts among. */
export const drawnSummaries = (
  { summaries }: BucketEntry,
  filters: BucketFilters
): BucketSummary[] =>
  summaries.filter(({ among }) =>
    Object.entries(among).every(
      ([fact, value]) => !filters[fact] || filters[fact] === value
    )
  )

type Values = SummaryEntry['values']

const isComplete = (values: Values): boolean =>
  Object.values(values).every((value) => value !== null)

/** The list narrowed to one entry: what the summary counts among, its values, and the range and shown facts it was read with. */
const toEntryHref = (
  bucket: BucketEntry,
  summary: BucketSummary,
  values: Values,
  { from, to, range, [showKey]: show }: BucketFilters
): string | null =>
  isComplete(values)
    ? toBucketHref(bucket, {
        ...summary.among,
        ...Object.fromEntries(
          Object.entries(values).map(([fact, value]) => [fact, String(value)])
        ),
        [showKey]: show,
        from,
        to,
        range
      })
    : null

const optionsOf = ({ facts }: BucketEntry, fact: string) =>
  facts.find(({ name }) => name === fact)?.values ?? []

const labelOf = (bucket: BucketEntry, fact: string, value: FactValue) =>
  optionsOf(bucket, fact).find((option) => option.value === value)?.label ??
  String(value)

const missingText = (summary: BucketSummary, index: number): string =>
  index === 0 ? summary.none : none

/** A value as its fact labels it; a missing first value as the declaration names it. */
const toCell =
  (bucket: BucketEntry, summary: BucketSummary, values: Values) =>
  (fact: string, index: number): Cell => {
    const value = values[fact] ?? null

    return value === null
      ? { text: missingText(summary, index), missing: true }
      : { text: labelOf(bucket, fact, value), missing: false }
  }

const toEntry =
  (
    bucket: BucketEntry,
    summary: BucketSummary,
    filters: BucketFilters,
    now: Date,
    zone: Zone
  ) =>
  ({ values, count, capped, firstAt, lastAt }: SummaryEntry): Entry => ({
    cells: summary.by.map(toCell(bucket, summary, values)),
    href: toEntryHref(bucket, summary, values, filters),
    countLabel: `${counted.format(count)}${capped ? '+' : ''}`,
    first: toTimestamp(firstAt, now, zone),
    last: toTimestamp(lastAt, now, zone)
  })

const toNotes = (top: number, { more, complete }: SummaryResult): string[] => [
  ...(more ? [`Showing the ${top} most frequent.`] : []),
  ...(complete ? [] : ['There are more distinct values than were counted.'])
]

const factLabelOf = ({ facts }: BucketEntry, name: string): string =>
  facts.find((fact) => fact.name === name)?.label ?? name

/** What the summary counts among, in the list's own words: "No dead letter events in this time range." */
const toEmptyText = (
  bucket: BucketEntry,
  { among }: BucketSummary,
  { from, to }: BucketFilters
): string => {
  const kinds = Object.entries(among).map(([fact, value]) =>
    labelOf(bucket, fact, value).toLowerCase()
  )
  const within = from || to ? ' in this time range' : ''

  return `No ${[...kinds, bucket.noun.many].join(' ')}${within}.`
}

/** With nothing found the line says so after the label, so no count of groups. */
const toTitle = (label: string, groups: number): string => {
  if (groups === 0) {
    return label
  }

  return `${label} (${groups} group${groups === 1 ? '' : 's'})`
}

const toRead = (
  bucket: BucketEntry,
  { summary, read }: SummarySource,
  filters: BucketFilters,
  now: Date,
  zone: Zone
): Pick<
  SummarySection,
  'title' | 'unavailable' | 'entries' | 'emptyText' | 'notes'
> => {
  const { page } = read

  return page === null
    ? {
        title: summary.label,
        unavailable: true,
        entries: [],
        emptyText: '',
        notes: []
      }
    : {
        title: toTitle(summary.label, page.entries.length),
        unavailable: false,
        entries: page.entries.map(toEntry(bucket, summary, filters, now, zone)),
        emptyText: toEmptyText(bucket, summary, filters),
        notes: toNotes(summary.top, page)
      }
}

/** One section per summary drawn: its entries, that it found none, or that it could not be read. */
export const toSummarySections = (
  bucket: BucketEntry,
  sources: SummarySource[],
  filters: BucketFilters,
  zone: Zone,
  now: Date = new Date()
): SummarySection[] =>
  sources.map((source) => ({
    id: source.summary.id,
    valueLabels: source.summary.by.map((fact) => factLabelOf(bucket, fact)),
    firstLabel: 'First seen',
    lastLabel: 'Last seen',
    ...toRead(bucket, source, filters, now, zone)
  }))
