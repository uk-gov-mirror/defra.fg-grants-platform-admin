import { statusCodes } from '../../common/status-codes.ts'
import type { ListTotal, Position } from '../use-cases/record-reads.ts'
import type {
  BucketEntry,
  BucketFact,
  BucketFactValue
} from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketCell,
  BucketListResult,
  BucketResult,
  BucketRow
} from '../use-cases/query-bucket.use-case.ts'
import { toBucketHref, toRowHref } from './bucket-links.ts'
import type { BucketFilters } from './bucket-links.ts'
import { toBucketPath } from './bucket-nav.ts'
import { pageMates, toPageHead } from './bucket-tabs.ts'
import { toUrlQuery } from './bucket-urls.ts'
import {
  presentationOf,
  toFactLabel,
  toListColumns,
  toTimeLabel,
  toTone,
  toVersionColumn
} from './catalogue-presentation.ts'
import type { ListColumn, Tone } from './catalogue-presentation.ts'
import { isIsoInstant } from './event-formats.ts'
import { toFields } from './list-filters.ts'
import type { FilterField } from './list-filters.ts'
import { toPositionLabel } from './position.ts'
import { toServiceName } from './shell.ts'
import { toRangeChip } from './time-range.view-model.ts'
import type { TimeRangeQuery } from './time-range.view-model.ts'
import { toTime } from './times.ts'
import type { TimeText, Times } from './times.ts'

/** A search box that was refused: what was typed, handed back with the reason. */
export interface SearchAttempt {
  kind: string
  value: string
  error: string
}

/** Why the page shows a refusal, and what was refused. */
export type ListRefusal =
  /** The address names a filter the list doesn't declare: nothing was read. */
  | { kind: 'address' }
  /** The service refused the search, which is cleared: the rows are the list without it. */
  | { kind: 'search'; message: string | null }

export interface ListPageInput {
  bucket: BucketEntry
  read: BucketListResult
  filters: BucketFilters
  /** Every list of the catalogue, for the ones that share this one's page. */
  buckets: BucketEntry[]
  times: Times
  /** The search the page ran, and the id its later pages name it by; none for a browse. */
  search: { q: string; id: string } | null
  /** A later page, loaded from this cursor. */
  cursor?: string
  attempt?: SearchAttempt
  refusal?: ListRefusal
  now?: Date
}

interface ChipItem {
  text: string
  href: string
  checked: boolean
}

interface FilterChipModel {
  fact: string
  label: string
  /** The one value chosen, "2 selected", or All. */
  value: string
  items: ChipItem[]
}

interface SearchKind {
  text: string
  value: string
  checked: boolean
}

interface SearchModel {
  action: string
  value: string
  error: string | null
  noun: string
  hidden: FilterField[]
  kinds: SearchKind[]
}

/** A removable tag: a link for a filter in the address, a submit for the search the session holds. */
export type Applied = {
  key: string
  label: string
  value: string
  mono: boolean
} & (
  | { removeHref: string }
  | { removeName: string; removeValue: string; removeForm: string }
)

interface RangeModel {
  label: string
  text: string
  isSet: boolean
  start: string | undefined
  end: string | undefined
  presets: { text: string; href: string; checked: boolean }[]
  action: string
  hidden: FilterField[]
  max: string
}

interface ClearSearchForm {
  id: string
  action: string
  hidden: FilterField[]
}

export type Cell =
  | {
      kind: 'link'
      text: string
      href: string
      mono: boolean
      /** The row's subtitle, under the title, where no column of its own draws it. */
      subtitle: string | null
    }
  | { kind: 'text'; text: string; mono: boolean }
  | { kind: 'status'; text: string; tone: Tone; hint: string | null }
  | { kind: 'time'; time: TimeText }
  | { kind: 'none' }

interface RowModel {
  href: string | null
  cells: (Cell & { align: 'start' | 'right' })[]
}

export type Footer =
  | { state: 'more'; nextHref: string; noun: string }
  | {
      state: 'searched'
      searchedTo: TimeText
      keepLookingHref: string
      noun: string
    }
  | { state: 'end'; text: string; noun: string }
  | { state: 'error'; text: string; retryHref: string; noun: string }

interface EmptyModel {
  title: string
  text: string
  icon: string
}

interface TableModel {
  label: string
  columns: Pick<ListColumn, 'key' | 'label' | 'width' | 'mono' | 'align'>[]
  rows: RowModel[]
  empty: EmptyModel | null
  footer: Footer | null
}

export interface ListAlert {
  tone: 'warning' | 'danger'
  title: string
  /** Shown in code, before the text: the service's own words. */
  code: string | null
  text: string
  retryHref: string | null
  startHref: string | null
}

export interface ListPageModel {
  pageTitle: string
  navActive: string
  title: string
  meta: string[]
  tabs: {
    label: string
    items: { text: string; href: string; current: boolean }[]
  } | null
  filterLabel: string
  chips: FilterChipModel[]
  /** Null where no filters can be drawn. */
  range: RangeModel | null
  searchField: SearchModel | null
  /** One tag per value a filter is set to, each removing it. */
  applied: Applied[]
  filtered: boolean
  /** How many records the filters find, "12,481 events"; null where the read was bounded or the list couldn't be read. */
  total: string | null
  clearAllHref: string
  clearSearchForm: ClearSearchForm | null
  alert: ListAlert | null
  table: TableModel | null
}

interface Context {
  bucket: BucketEntry
  filters: BucketFilters
  result: BucketResult | null
  times: Times
  now: Date
  searched: Searched | null
  searchId: string | null
}

interface Searched {
  kind: string
  value: string
}

/** The form a search tag clears the session's search with. */
export const clearSearchFormId = 'list-search-clear'

/** The address Clear all goes to while a search is held: it drops the search too. */
export const clearParam = 'clear'

const counted = new Intl.NumberFormat('en-GB')

const totalText = ({ count, capped }: ListTotal, noun: BucketEntry['noun']) =>
  `${counted.format(count)}${capped ? '+' : ''} ${count === 1 ? noun.one : noun.many}`

const toTotal = ({ bucket, result }: Context): string | null =>
  result?.total ? totalText(result.total, bucket.noun) : null

const capitalise = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`

/** "Reference" reads "reference" in a sentence; "Event ID" and "SBI" keep their capitals. */
const inSentence = (label: string): string =>
  /^[A-Z][a-z]/.test(label)
    ? `${label.charAt(0).toLowerCase()}${label.slice(1)}`
    : label

/** The values a fact is filtered by: none, one, or several. */
const chosenOf = ({ filters }: Context, fact: string): string[] =>
  [filters[fact] ?? []].flat()

/** A fact's values mean nothing under another choice of the fact they are within, so that choice drops them. */
const hrefWith = (
  { bucket, filters }: Context,
  fact: string,
  values: string[] | undefined
): string => {
  const cleared = bucket.facts
    .filter(({ within }) => within === fact)
    .map(({ name }) => [name, undefined])

  return toBucketHref(bucket, {
    ...filters,
    ...Object.fromEntries(cleared),
    [fact]: values?.length ? values : undefined
  })
}

const hasValues = (
  fact: BucketFact
): fact is BucketFact & { values: BucketFactValue[] } => fact.values !== null

/** The catalogue's values, those the list names last moved to the end. */
const inListOrder = (
  bucket: BucketEntry,
  fact: BucketFact & { values: BucketFactValue[] }
): BucketFactValue[] => {
  const last = presentationOf(bucket).lastValues?.[fact.name] ?? []
  const isLast = (option: BucketFactValue) =>
    last.includes(String(option.value))

  return [
    ...fact.values.filter((option) => !isLast(option)),
    ...fact.values.filter(isLast)
  ]
}

/** A chosen value the menu lacks (a code with no rows yet) is kept in it all the same. */
const withChosen = (
  bucket: BucketEntry,
  fact: BucketFact & { values: BucketFactValue[] },
  chosen: string[]
): BucketFactValue[] => [
  ...inListOrder(bucket, fact),
  ...chosen
    .filter(
      (value) => !fact.values.some((option) => String(option.value) === value)
    )
    .map((value) => ({ value, label: value }))
]

const labelOf = (fact: BucketFact, value: string): string =>
  fact.values?.find((option) => String(option.value) === value)?.label ?? value

/** The chosen values with one ticked on or off, in the order the menu lists them. */
const toggled = (
  options: BucketFactValue[],
  chosen: string[],
  value: string
): string[] => {
  const next = chosen.includes(value)
    ? chosen.filter((one) => one !== value)
    : [...chosen, value]

  return options
    .map((option) => String(option.value))
    .filter((one) => next.includes(one))
}

/** The chosen values in the order the chip's menu lists them. */
const inMenuOrder = (
  bucket: BucketEntry,
  fact: BucketFact,
  chosen: string[]
): string[] =>
  hasValues(fact)
    ? withChosen(bucket, fact, chosen)
        .map((option) => String(option.value))
        .filter((value) => chosen.includes(value))
    : chosen

const chipText = (fact: BucketFact, chosen: string[]): string => {
  if (chosen.length > 1) {
    return `${chosen.length} selected`
  }

  return chosen.length ? labelOf(fact, chosen[0]) : 'All'
}

/** Each value ticks on and off; All clears them. */
const toChip =
  (context: Context) =>
  (fact: BucketFact & { values: BucketFactValue[] }): FilterChipModel => {
    const chosen = chosenOf(context, fact.name)
    const options = withChosen(context.bucket, fact, chosen)

    return {
      fact: fact.name,
      label: toFactLabel(context.bucket, fact),
      value: chipText(fact, chosen),
      items: [
        {
          text: 'All',
          href: hrefWith(context, fact.name, undefined),
          checked: chosen.length === 0
        },
        ...options.map((option) => {
          const value = String(option.value)

          return {
            text: option.label,
            href: hrefWith(context, fact.name, toggled(options, chosen, value)),
            checked: chosen.includes(value)
          }
        })
      ]
    }
  }

/** The filters a form carries with it, under the keys the list's URL spells them by. */
const toUrlFields = (
  bucket: BucketEntry,
  filters: BucketFilters
): FilterField[] => {
  const query = toUrlQuery(bucket, filters)

  return toFields(query, Object.keys(query))
}

const rangeKeys = ['from', 'to', 'range']

const withoutRange = (filters: BucketFilters): BucketFilters =>
  Object.fromEntries(
    Object.entries(filters).filter(([key]) => !rangeKeys.includes(key))
  )

const toRange = (context: Context): RangeModel => {
  const { bucket, filters, now, times } = context
  const chip = toRangeChip(
    filters as TimeRangeQuery,
    (window) => toBucketHref(bucket, { ...withoutRange(filters), ...window }),
    now,
    times.zone
  )

  return {
    label: toTimeLabel(bucket),
    ...chip,
    action: toBucketPath(bucket),
    hidden: toUrlFields(bucket, withoutRange(filters)),
    max: chip.max
  }
}

/** A stored search is one `kind:value`; the value may hold colons of its own. */
const toSearched = (q: string): Searched | null => {
  const [kind, ...value] = q.split(':')

  return value.length === 0 ? null : { kind, value: value.join(':') }
}

const toSearchField = (
  { bucket, filters, searched }: Context,
  attempt?: SearchAttempt
): SearchModel | null => {
  const shown = { kind: '', value: '', error: null, ...searched, ...attempt }

  return bucket.refs.length === 0
    ? null
    : {
        action: toBucketPath(bucket),
        value: shown.value,
        error: shown.error,
        noun: bucket.noun.many,
        hidden: toUrlFields(bucket, filters),
        kinds: bucket.refs.map(({ kind, label }, index) => ({
          text: label,
          value: kind,
          checked: shown.kind ? kind === shown.kind : index === 0
        }))
      }
}

const kindLabel = ({ refs }: BucketEntry, kind: string): string | null =>
  refs.find((ref) => ref.kind === kind)?.label ?? null

const timeTags = (
  { bucket, filters }: Context,
  range: RangeModel
): Applied[] =>
  range.isSet
    ? [
        {
          key: 'time',
          label: range.label,
          value: range.text,
          mono: false,
          removeHref: toBucketHref(bucket, withoutRange(filters))
        }
      ]
    : []

const searchTags = ({ bucket, searched }: Context): Applied[] => {
  const label = searched && kindLabel(bucket, searched.kind)

  return searched && label
    ? [
        {
          key: 'search',
          label,
          value: searched.value,
          mono: true,
          removeName: 'ref-value',
          removeValue: '',
          removeForm: clearSearchFormId
        }
      ]
    : []
}

/** Every filter set: the chosen values, the time, the search, then the open facts. */
const toSetFilters = (context: Context, range: RangeModel): Applied[] => {
  const { bucket } = context
  const valueTag =
    (fact: BucketFact, chosen: string[]) =>
    (value: string): Applied => ({
      key: fact.name,
      label: toFactLabel(bucket, fact),
      value: labelOf(fact, value),
      mono: !hasValues(fact),
      removeHref: hrefWith(
        context,
        fact.name,
        chosen.filter((one) => one !== value)
      )
    })
  const tagsOf = (fact: BucketFact) => {
    const chosen = chosenOf(context, fact.name)

    return inMenuOrder(bucket, fact, chosen).map(valueTag(fact, chosen))
  }

  return [
    ...bucket.facts.filter(hasValues).flatMap(tagsOf),
    ...timeTags(context, range),
    ...searchTags(context),
    ...bucket.facts.filter((fact) => !hasValues(fact)).flatMap(tagsOf)
  ]
}

const toTimeOrText = (value: string, times: Times): Cell =>
  isIsoInstant(value)
    ? { kind: 'time', time: toTime(new Date(value), times) }
    : { kind: 'text', text: value, mono: false }

type CellValue = NonNullable<BucketCell>

const factOf = ({ bucket }: Context, column: ListColumn) =>
  bucket.facts.find(({ name }) => name === column.fact)

const valueOf = (
  context: Context,
  column: ListColumn,
  value: CellValue
): BucketFactValue =>
  factOf(context, column)?.values?.find(
    (option) => String(option.value) === String(value)
  ) ?? { value: String(value), label: String(value) }

const hintOf = (column: ListColumn, option: BucketFactValue): string | null =>
  column.tooltip ? (option.hint ?? null) : null

const toStatus = (
  context: Context,
  column: ListColumn,
  value: CellValue
): Cell => {
  const option = valueOf(context, column, value)

  return {
    kind: 'status',
    text: option.label,
    tone: toTone(
      context.bucket,
      String(column.fact),
      option.value,
      option.tone
    ),
    hint: hintOf(column, option)
  }
}

const toPositionText = (value: CellValue): Cell =>
  typeof value === 'object'
    ? { kind: 'text', text: toPositionLabel(value as Position), mono: false }
    : { kind: 'text', text: String(value), mono: false }

type Draw = (context: Context, column: ListColumn, value: CellValue) => Cell

/** A format this page has not heard of is drawn as text, so a new one never breaks a list. */
const draws: Record<string, Draw> = {
  badge: toStatus,
  time: (context, _column, value) => toTimeOrText(String(value), context.times),
  position: (_context, _column, value) => toPositionText(value)
}

const asText: Draw = (_context, column, value) => ({
  kind: 'text',
  text: String(value),
  mono: column.mono
})

const isEmpty = (
  value: BucketCell | undefined
): value is null | undefined | '' =>
  value === null || value === undefined || value === ''

const toCatalogueCell = (
  context: Context,
  column: ListColumn,
  value: BucketCell | undefined
): Cell =>
  isEmpty(value)
    ? { kind: 'none' }
    : (draws[column.format] ?? asText)(context, column, value)

const versionOf = ({ bucket }: Context, row: BucketRow): string | null => {
  const column = toVersionColumn(bucket)
  const version = column && row.cells[column]

  return typeof version === 'string' && version !== '' ? version : null
}

/** `woodland@1.4.2`, or the code alone for a row with no version. */
const toTitle = (context: Context, row: BucketRow): string | null => {
  const version = versionOf(context, row)

  return row.title !== null && version ? `${row.title}@${version}` : row.title
}

/** A subtitle the catalogue sends for a list GPA gives no subtitle column is drawn under the title, so none is lost. */
const subtitleUnder = ({ bucket }: Context, row: BucketRow): string | null =>
  presentationOf(bucket).subtitle ? null : row.subtitle

const toTitleCell = (
  context: Context,
  column: ListColumn,
  row: BucketRow,
  href: string | null
): Cell => {
  const text = toTitle(context, row)

  if (text === null) {
    return { kind: 'none' }
  }

  return href === null
    ? { kind: 'text', text, mono: column.mono }
    : {
        kind: 'link',
        text,
        href,
        mono: column.mono,
        subtitle: subtitleUnder(context, row)
      }
}

type CellOf = (
  context: Context,
  column: ListColumn,
  row: BucketRow,
  href: string | null
) => Cell

const cells: Record<ListColumn['kind'], CellOf> = {
  title: toTitleCell,
  subtitle: (context, column, row) =>
    toCatalogueCell(context, { ...column, format: 'text' }, row.subtitle),
  time: (context, _column, row) => toTimeOrText(row.time, context.times),
  cell: (context, column, row) =>
    toCatalogueCell(context, column, row.cells[column.key])
}

const toRow =
  (context: Context, columns: ListColumn[], from: string) =>
  (row: BucketRow): RowModel => {
    const href = toRowHref(row.link, from)

    return {
      href,
      cells: columns.map((column) => ({
        ...cells[column.kind](context, column, row, href),
        align: column.align
      }))
    }
  }

/** A later page of a search names it, so it is read with the search its first page ran and no other. */
const toCursorHref = (
  { bucket, filters, searchId }: Context,
  cursor: string
): string =>
  toBucketHref(
    bucket,
    filters,
    new URLSearchParams({
      cursor,
      ...(searchId ? { searched: searchId } : {})
    })
  )

/** Only a bounded read can have looked at less than everything, so only it says when it has. */
const searchedEverything = ({ plan, page }: BucketResult): boolean =>
  plan.kind !== 'exact' && page.complete

/** Where a bounded read stopped, and the way on from there. */
const toKeepLooking = (
  context: Context,
  { keepLooking, searchedTo }: BucketResult['page']
): Footer | null =>
  keepLooking && searchedTo && isIsoInstant(searchedTo)
    ? {
        state: 'searched',
        searchedTo: toTime(new Date(searchedTo), context.times),
        keepLookingHref: toCursorHref(context, keepLooking),
        noun: context.bucket.noun.many
      }
    : null

const toEnd = (context: Context, result: BucketResult): Footer | null =>
  searchedEverything(result)
    ? {
        state: 'end',
        text: 'Searched everything.',
        noun: context.bucket.noun.many
      }
    : null

/** A next page first, as it carries its own footer; else where a search stopped, or that it reached the end. */
const toFooter = (context: Context, result: BucketResult): Footer | null => {
  const { next } = result.page

  return next
    ? {
        state: 'more',
        nextHref: toCursorHref(context, next),
        noun: context.bucket.noun.many
      }
    : (toKeepLooking(context, result.page) ?? toEnd(context, result))
}

const soFar: EmptyModel = {
  title: 'No matches so far',
  text: 'Keep looking to search further back.',
  icon: 'search'
}

/** Nothing on: what would be here, and how it gets here. */
const toNothingYet = ({ bucket }: Context): EmptyModel => ({
  title: `No ${bucket.noun.many} yet`,
  text:
    presentationOf(bucket).emptyText?.(bucket.service) ??
    `${capitalise(bucket.noun.many)} ${bucket.service} keeps appear here.`,
  icon: 'inbox'
})

const isOnlySearch = (applied: Applied[]): boolean =>
  applied.length === 1 && applied[0].key === 'search'

/** Only a search on: the search names what had no match. */
const searchMiss = ({ bucket, searched }: Context): string | null => {
  const label = searched && kindLabel(bucket, searched.kind)

  return label && `No ${bucket.noun.many} have this ${inSentence(label)}.`
}

const toNoMatch = (context: Context, applied: Applied[]): EmptyModel => ({
  title: `No ${context.bucket.noun.many} match`,
  text:
    (isOnlySearch(applied) && searchMiss(context)) ||
    (presentationOf(context.bucket).noMatchText ??
      'Nothing matches these filters.'),
  icon: 'search'
})

const toEmpty = (
  context: Context,
  applied: Applied[],
  footer: Footer | null
): EmptyModel => {
  if (footer?.state === 'searched') {
    return soFar
  }

  return applied.length ? toNoMatch(context, applied) : toNothingYet(context)
}

const toAddressRefusal = (startHref: string): ListAlert => ({
  tone: 'warning',
  title: 'This address has a filter the list doesn’t have.',
  code: null,
  text: 'Nothing was read. Start again to see the list.',
  retryHref: null,
  startHref
})

const toSearchRefusal = (
  bucket: BucketEntry,
  message: string | null,
  startHref: string
): ListAlert => ({
  tone: 'warning',
  title: `${bucket.service} refused this search.`,
  code: message,
  text: 'The search has been cleared.',
  retryHref: null,
  startHref
})

const toFilterRefusal = (
  bucket: BucketEntry,
  message: string | null,
  startHref: string
): ListAlert => ({
  tone: 'warning',
  title: `${bucket.service} refused these filters.`,
  code: message,
  text: 'Start again to clear them.',
  retryHref: null,
  startHref
})

/** The app reads every list from GAS, so an error, a failed connection or GAS sending nothing is GAS's whichever service owns the list; GAS's 504 is the list's own service not answering it. */
const unavailableReason = (
  { timedOut, errored, gasSilent }: BucketListResult,
  service: string
): string => {
  if (timedOut) {
    return `${gasSilent ? 'GAS' : service} didn’t answer in time. Nothing has changed — try again in a moment.`
  }

  return errored
    ? 'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.'
    : 'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
}

/** What a list that couldn't be read says: it timed out, GAS answered with an error, or GAS couldn't be reached; nothing has changed. */
export const toUnavailableAlert = (
  bucket: BucketEntry,
  read: BucketListResult,
  retryHref: string
): ListAlert => ({
  tone: 'danger',
  title: `The ${bucket.noun.many} list couldn’t be loaded.`,
  code: null,
  text: unavailableReason(read, bucket.service),
  retryHref,
  startHref: null
})

/** The first that applies is the page's alert; a later page's failure is said in its footer instead. */
const alertRules: [
  (input: ListPageInput) => boolean,
  (input: ListPageInput, startHref: string, retryHref: string) => ListAlert
][] = [
  [
    ({ refusal }) => refusal?.kind === 'address',
    (_input, start) => toAddressRefusal(start)
  ],
  [
    ({ refusal }) => refusal?.kind === 'search',
    ({ bucket, refusal }, start) =>
      toSearchRefusal(
        bucket,
        refusal?.kind === 'search' ? refusal.message : null,
        start
      )
  ],
  [
    ({ read }) => read.refused,
    ({ bucket, read }, start) => toFilterRefusal(bucket, read.refusal, start)
  ],
  [
    ({ read, cursor }) => read.unavailable && !cursor,
    ({ bucket, read }, _start, retry) => toUnavailableAlert(bucket, read, retry)
  ]
]

const toAlert = (input: ListPageInput, retryHref: string): ListAlert | null => {
  const rule = alertRules.find(([applies]) => applies(input))

  return rule ? rule[1](input, toBucketPath(input.bucket), retryHref) : null
}

const toLoadMoreFailed = (bucket: BucketEntry, retryHref: string): Footer => ({
  state: 'error',
  text: `Couldn’t load more ${bucket.noun.many} — ${bucket.service} didn’t answer.`,
  retryHref,
  noun: bucket.noun.many
})

const toHead = (bucket: BucketEntry) => ({
  label: capitalise(bucket.noun.many),
  columns: toListColumns(bucket).map(({ key, label, width, mono, align }) => ({
    key,
    label,
    width,
    mono,
    align
  }))
})

/** A later page that couldn't be read: no rows, and a retry of that page. */
const isLoadMoreFailed = ({ read, cursor }: ListPageInput): boolean =>
  read.unavailable && Boolean(cursor)

const toRows = (
  context: Context,
  input: ListPageInput,
  applied: Applied[],
  result: BucketResult
) => {
  const from = toBucketHref(context.bucket, context.filters)
  const rows = result.rows.map(
    toRow(context, toListColumns(context.bucket), from)
  )
  const footer = toFooter(context, result)
  const empty =
    rows.length || input.cursor ? null : toEmpty(context, applied, footer)

  return { rows, empty, footer }
}

const toTable = (
  context: Context,
  input: ListPageInput,
  applied: Applied[],
  retryHref: string
): TableModel | null => {
  const head = toHead(context.bucket)

  if (isLoadMoreFailed(input)) {
    return {
      ...head,
      rows: [],
      empty: null,
      footer: toLoadMoreFailed(context.bucket, retryHref)
    }
  }

  return (
    context.result && {
      ...head,
      ...toRows(context, input, applied, context.result)
    }
  )
}

/** The page a list is drawn on: the service's events, with a tab per queue, or the list itself. */
const tabsLabelOf = (bucket: BucketEntry): string =>
  presentationOf(bucket).tabsLabel ?? bucket.page?.label ?? ''

const toTabs = (bucket: BucketEntry, buckets: BucketEntry[]) => {
  const { tabs } = toPageHead(bucket, pageMates(bucket, buckets))

  return tabs.length
    ? {
        label: tabsLabelOf(bucket),
        items: tabs.map(({ label, href, active }) => ({
          text: label,
          href,
          current: active
        }))
      }
    : null
}

/** Every list names its service under the title. */
const toMeta = (bucket: BucketEntry): string[] => [
  toServiceName(bucket.service)
]

const searchOf = (search: ListPageInput['search']) => {
  const searched = search ? toSearched(search.q) : null

  return { searched, searchId: searched && search ? search.id : null }
}

const toClearSearchForm = ({
  bucket,
  filters,
  searched
}: Context): ClearSearchForm | null =>
  searched
    ? {
        id: clearSearchFormId,
        action: toBucketPath(bucket),
        hidden: toUrlFields(bucket, filters)
      }
    : null

const toContext = (input: ListPageInput): Context => ({
  bucket: input.bucket,
  filters: input.filters,
  result: input.read.page,
  times: input.times,
  now: input.now ?? new Date(),
  ...searchOf(input.search)
})

/** This very page again: a later page by its cursor. */
const toRetryHref = (context: Context, { cursor }: ListPageInput): string =>
  cursor
    ? toCursorHref(context, cursor)
    : toBucketHref(context.bucket, context.filters)

/** A held search is dropped by Clear all too, which a bare link can't do. */
const toClearAllHref = ({ bucket, searched }: Context): string =>
  searched ? `${toBucketPath(bucket)}?${clearParam}=all` : toBucketPath(bucket)

export const toListPage = (input: ListPageInput): ListPageModel => {
  const { bucket, buckets } = input
  const context = toContext(input)
  const retryHref = toRetryHref(context, input)
  const range = toRange(context)
  const set = toSetFilters(context, range)
  const title = bucket.page?.shortLabel ?? bucket.shortLabel

  return {
    pageTitle: bucket.label,
    navActive: bucket.id,
    title,
    meta: toMeta(bucket),
    tabs: toTabs(bucket, buckets),
    filterLabel: `Filter ${bucket.noun.many}`,
    chips: bucket.facts.filter(hasValues).map(toChip(context)),
    range,
    searchField: toSearchField(context, input.attempt),
    applied: set,
    filtered: set.length > 0,
    total: toTotal(context),
    clearAllHref: toClearAllHref(context),
    clearSearchForm: toClearSearchForm(context),
    alert: toAlert(input, retryHref),
    table: toTable(context, input, set, retryHref)
  }
}

/**
 * CW's lists are missing from the catalogue because GAS couldn't reach CW:
 * the page says so in place of the list. Its tabs and filters come from the
 * missing entries, so none can be drawn.
 */
export const toCaseworkingUnreachable = (
  navActive: string,
  retryHref: string
): ListPageModel => ({
  pageTitle: 'CW events',
  navActive,
  title: 'Events',
  meta: [toServiceName('CW')],
  tabs: null,
  filterLabel: 'Filter events',
  chips: [],
  range: null,
  searchField: null,
  applied: [],
  filtered: false,
  total: null,
  clearAllHref: '',
  clearSearchForm: null,
  alert: {
    tone: 'danger',
    title: 'Caseworking can’t be reached.',
    code: null,
    text: 'GAS is up, but its calls to CW are failing, so CW’s events can’t be listed. Nothing has changed.',
    retryHref,
    startHref: null
  },
  table: null
})

export const badRequest = statusCodes.badRequest

/** GAS answered, but without CW's lists: the page can only say so. */
export const caseworkingUnreachableCode = statusCodes.serviceUnavailable

const readCode = ({ unavailable, timedOut }: BucketListResult): number => {
  if (!unavailable) {
    return statusCodes.ok
  }

  return timedOut ? statusCodes.gatewayTimeout : statusCodes.serviceUnavailable
}

/** A list that couldn't be read is no list: the status says why. */
export const toListStatusCode = ({ read, refusal }: ListPageInput): number =>
  refusal?.kind === 'address' || read.refused ? badRequest : readCode(read)
