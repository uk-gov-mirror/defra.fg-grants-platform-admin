import type { BadgeRole } from '../use-cases/get-event.use-case.ts'
import type { Position } from '../use-cases/record-reads.ts'
import type {
  BucketColumn,
  BucketEntry,
  BucketFact,
  BucketFactValue,
  FactValue
} from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketCell,
  BucketGroupValue,
  BucketListResult,
  BucketPaging,
  BucketResult,
  BucketRow
} from '../use-cases/query-bucket.use-case.ts'
import { toBucketHref, toRowHref } from './bucket-links.ts'
import type { BucketFilters } from './bucket-links.ts'
import { toBucketPath } from './bucket-nav.ts'
import { shownFacts, withToggled } from './bucket-toggles.ts'
import { toUrlQuery } from './bucket-urls.ts'
import { none, toPreciseOrNone, toTimeCell } from './event-formats.ts'
import type { TimeCell, Zone } from './event-formats.ts'
import { toPageHead } from './bucket-tabs.ts'
import type { PageTab } from './bucket-tabs.ts'
import { toStampedEventName } from './event-names.ts'
import type { EventName } from './event-names.ts'
import { toFields } from './list-filters.ts'
import type { FilterField } from './list-filters.ts'
import { toPositionLabel, toStatusLabel } from './position.ts'
import { toTimeRange } from './time-range.view-model.ts'
import type { TimeRange } from './time-range.view-model.ts'

/** The URL's part of a list; a searched identifier is kept in the session instead. */
export interface BucketPageQuery {
  filters: BucketFilters
  /** The zone the person reads times in. */
  zone: Zone
  cursor?: string
  /** The lists that share this one's page, this one among them; none for a list with a page of its own. */
  mates?: BucketEntry[]
}

/** A search box that was refused: what was typed, handed back with the reason. */
export interface SearchAttempt {
  kind: string
  value: string
  error: string
}

interface Tile {
  value: string | null
  label: string
  href: string
  active: boolean
  countLabel: string | null
  zero: boolean
  alarming: boolean
}

interface Tiles {
  name: string
  items: Tile[]
}

interface MenuItem {
  value: string | null
  label: string
  href: string
  active: boolean
  hint: string | null
}

interface FilterMenu {
  fact: string
  name: string
  label: string
  items: MenuItem[]
}

interface Toggle {
  fact: string
  label: string
  checked: boolean
  href: string
}

interface FilterNote {
  fact: string
  label: string
  value: string
  clearHref: string
}

interface SearchKind {
  value: string
  label: string
  active: boolean
}

interface SearchNote {
  label: string
  value: string
}

interface SearchBox {
  kinds: SearchKind[]
  placeholder: string
  inputLabel: string
  value: string
  error: string | null
  hiddenFields: FilterField[]
  note: SearchNote | null
}

interface HeadColumn {
  key: string
  label: string
  /** Sets the column's width, the same for every column of that format. */
  format: string
  right: boolean
  /** Left out below `sm`. */
  phoneHidden: boolean
}

interface Head {
  title: string
  columns: HeadColumn[]
  time: string
  /** Columns share the width evenly; a list titled by event keeps the events tables' proportions. */
  even: boolean
  /** A layout of its own, drawn by name; null for the shared widths. */
  layout: string | null
}

export type Cell = { key: string; right: boolean; phoneHidden: boolean } & (
  | { kind: 'none' }
  | {
      kind: 'badge'
      status: string
      label: string
      role: BadgeRole
      /** The value's meaning, else its label. */
      title: string
    }
  | {
      kind: 'mono' | 'text'
      text: string
      /** Said beside it below `sm`, for a status hidden there. */
      phoneBadge?: string
    }
  | { kind: 'versioned'; text: string; code: string; version: string }
  | { kind: 'position'; statusLabel: string | null; positionLabel: string }
  | { kind: 'time'; time: TimeCell }
)

type Drawn<C = Cell> = C extends Cell
  ? Omit<C, 'key' | 'right' | 'phoneHidden'>
  : never

interface RowModel {
  href: string | null
  title: string
  /** An event type is drawn by its short name, with the spoken one for a screen reader. */
  eventName: EventName | null
  mono: boolean
  /** Said after the title to a screen reader, so links to versions of one code differ. */
  spokenVersion: string | null
  subtitle: string | null
  cells: Cell[]
  time: TimeCell
  alarming: boolean
}

interface KeepLooking {
  href: string
  searchedTo: string
}

interface Refusal {
  /** The service that refused, or none when this app refused before asking. */
  by: string | null
  message: string | null
  startHref: string
}

export interface BucketPageModel {
  navActive: string
  title: string
  tabs: PageTab[]
  bucket: { id: string; label: string; path: string; noun: BucketEntry['noun'] }
  tiles: Tiles | null
  menus: FilterMenu[]
  toggles: Toggle[]
  notes: FilterNote[]
  timeRange: TimeRange
  search: SearchBox | null
  head: Head
  rows: RowModel[]
  nextHref: string | null
  keepLooking: KeepLooking | null
  searchedEverything: boolean
  emptyText: string
  refused: Refusal | null
  unavailable: boolean
}

interface Counted {
  count: number
  capped: boolean
}

const counted = new Intl.NumberFormat('en-GB')

/** "48", or "10,000+" past the count GAS stops at. */
const toCountLabel = ({ count, capped }: Counted): string =>
  `${counted.format(count)}${capped ? '+' : ''}`

const capitalise = (text: string): string =>
  `${text.charAt(0).toUpperCase()}${text.slice(1)}`

interface Context {
  bucket: BucketEntry
  filters: BucketFilters
  result: BucketResult | null
  now: Date
  zone: Zone
}

/** A fact's values mean nothing under another choice of the fact they are within, so that choice drops them. */
const hrefWith = (
  { bucket, filters }: Context,
  fact: string,
  value: string | undefined
): string => {
  const cleared = bucket.facts
    .filter(({ within }) => within === fact)
    .map(({ name }) => [name, undefined])

  return toBucketHref(bucket, {
    ...filters,
    ...Object.fromEntries(cleared),
    [fact]: value
  })
}

const hasValues = (
  fact: BucketFact
): fact is BucketFact & { values: BucketFactValue[] } => fact.values !== null

/** The first grouping is the row of tiles; a bucket that groups by nothing has none. */
const tileFactOf = ({ facts, groupings }: BucketEntry) =>
  facts.filter(hasValues).find(({ name }) => name === groupings[0]) ?? null

const countsOf = (
  result: BucketResult | null,
  fact: string
): BucketGroupValue[] =>
  result?.groups.find(({ by }) => by === fact)?.values ?? []

const countOf = (
  counts: BucketGroupValue[],
  value: FactValue
): BucketGroupValue | null =>
  counts.find((group) => group.value === value) ?? null

const isAlarming = (
  { tone }: BucketFactValue,
  count: BucketGroupValue | null
): boolean => tone === 'error' && count !== null && count.count > 0

const toTile =
  (context: Context, fact: BucketFact, counts: BucketGroupValue[]) =>
  (option: BucketFactValue): Tile => {
    const value = String(option.value)
    const count = countOf(counts, option.value)

    return {
      value,
      label: option.label,
      href: hrefWith(context, fact.name, value),
      active: context.filters[fact.name] === value,
      countLabel: count === null ? null : toCountLabel(count),
      zero: count?.count === 0,
      alarming: isAlarming(option, count)
    }
  }

/** The list with the tile's own filter left out, so a chosen tile does not change what All counts. */
const toAllCount = ({ result }: Context, fact: string) =>
  result?.groups.find(({ by }) => by === fact)?.total ?? null

const toAllTile = (context: Context, fact: string): Tile => {
  const total = toAllCount(context, fact)

  return {
    value: null,
    label: 'All',
    href: hrefWith(context, fact, undefined),
    active: !context.filters[fact],
    countLabel: total === null ? null : toCountLabel(total),
    zero: total?.count === 0,
    alarming: false
  }
}

const toTiles = (context: Context): Tiles | null => {
  const fact = tileFactOf(context.bucket)

  if (fact === null) {
    return null
  }

  const counts = countsOf(context.result, fact.name)

  return {
    name: fact.label,
    items: [
      toAllTile(context, fact.name),
      ...fact.values.map(toTile(context, fact, counts))
    ]
  }
}

/** A later page carries no stored values, so the chosen one is kept in the menu all the same. */
const withChosen = (
  values: BucketFactValue[],
  chosen: string | undefined
): BucketFactValue[] =>
  !chosen || values.some(({ value }) => String(value) === chosen)
    ? values
    : [...values, { value: chosen, label: chosen }]

const toMenu =
  (context: Context) =>
  (fact: BucketFact & { values: BucketFactValue[] }): FilterMenu => {
    const chosen = context.filters[fact.name]
    const shown = shownFacts(context.filters).includes(fact.name)
    const offered = fact.values.filter(({ hidden }) => shown || !hidden)

    return {
      fact: fact.name,
      name: fact.label,
      label: `Filter by ${fact.label.toLowerCase()}`,
      items: [
        {
          value: null,
          label: 'All',
          href: hrefWith(context, fact.name, undefined),
          active: !chosen,
          hint: null
        },
        ...withChosen(offered, chosen).map((option) => ({
          value: String(option.value),
          label: option.label,
          href: hrefWith(context, fact.name, String(option.value)),
          active: chosen === String(option.value),
          hint: option.hint ?? null
        }))
      ]
    }
  }

const toMenus = (context: Context): FilterMenu[] => {
  const tileFact = tileFactOf(context.bucket)

  return context.bucket.facts
    .filter(hasValues)
    .filter((fact) => fact !== tileFact)
    .map(toMenu(context))
}

/** Off is the list a bare URL shows; on is said in the URL, so a link to it shows the same rows. */
const toToggles = ({ bucket, filters }: Context): Toggle[] =>
  bucket.facts.flatMap(({ name, toggle }) =>
    toggle
      ? [
          {
            fact: name,
            label: toggle.label,
            checked: shownFacts(filters).includes(name),
            href: toBucketHref(bucket, withToggled(bucket, filters, name))
          }
        ]
      : []
  )

const openFactsOf = ({ facts }: BucketEntry): BucketFact[] =>
  facts.filter((fact) => !hasValues(fact))

const toNotes = (context: Context): FilterNote[] =>
  openFactsOf(context.bucket).flatMap(({ name, label }) => {
    const value = context.filters[name]

    return value
      ? [
          {
            fact: name,
            label,
            value,
            clearHref: hrefWith(context, name, undefined)
          }
        ]
      : []
  })

const toBucketTimeRange = ({
  bucket,
  filters,
  now,
  zone
}: Context): TimeRange => {
  const query = toUrlQuery(bucket, filters)

  return toTimeRange(
    {
      basePath: toBucketPath(bucket),
      filterKeys: Object.keys(query),
      presetTitlePrefix: `${capitalise(bucket.noun.many)} from the last`
    },
    query,
    now,
    zone
  )
}

interface Searched {
  kind: string
  value: string
}

/** A stored search is one `kind:value`; the value may hold colons of its own. */
const toSearched = (q: string): Searched | null => {
  const [kind, ...value] = q.split(':')

  return value.length === 0 ? null : { kind, value: value.join(':') }
}

const toSearchNote = (
  { refs }: BucketEntry,
  searched: Searched | null
): SearchNote | null => {
  const label = refs.find(({ kind }) => kind === searched?.kind)?.label

  return searched && label ? { label, value: searched.value } : null
}

const noSearch = { kind: '', value: '', error: null }

/** With one kind there is no menu to name it, so the box does. */
const toSearchWording = (refs: BucketEntry['refs']) =>
  refs.length === 1
    ? { placeholder: `Exact ${refs[0].label}`, inputLabel: refs[0].label }
    : { placeholder: 'Exact identifier', inputLabel: 'Identifier' }

/** The filters a search carries with it, under the keys the list's URL spells them by. */
const toUrlFields = (
  bucket: BucketEntry,
  filters: BucketFilters
): FilterField[] => {
  const query = toUrlQuery(bucket, filters)

  return toFields(query, Object.keys(query))
}

/** A refused attempt is shown as typed; otherwise the box holds the search that ran. */
const toSearchBox = (
  { bucket, filters }: Context,
  searched: Searched | null,
  attempt?: SearchAttempt
): SearchBox | null => {
  const shown = { ...noSearch, ...searched, ...attempt }

  return bucket.refs.length === 0
    ? null
    : {
        kinds: bucket.refs.map(({ kind, label }) => ({
          value: kind,
          label,
          active: kind === shown.kind
        })),
        ...toSearchWording(bucket.refs),
        value: shown.value,
        error: shown.error,
        hiddenFields: toUrlFields(bucket, filters),
        note: toSearchNote(bucket, searched)
      }
}

const searchable = /^[A-Za-z0-9._:@-]{1,200}$/

/** A box GAS would refuse: said beside the box, and never stored. */
export const searchError =
  'Enter an identifier using only letters, numbers and . _ : @ -'

/** What is stored for a search, or null for a kind the bucket has not got or a value it could not hold. */
export const toSearchQuery = (
  { refs }: BucketEntry,
  kind: string,
  value: string
): string | null =>
  refs.some((ref) => ref.kind === kind) && searchable.test(value)
    ? `${kind}:${value}`
    : null

const exact = 'exact'

const rightAligned = new Set(['time'])

interface Layout {
  name: string
  /** Columns left out below `sm`, so the rest fit a phone without a sideways scroll. */
  phoneHidden: string[]
}

const versionListLayout: Layout = { name: 'versions', phoneHidden: ['status'] }

/** Presentation only, keyed by list: the widths themselves are in `table-head`. */
const layouts: Record<string, Layout> = {
  'gas.grants': versionListLayout,
  'cw.workflows': versionListLayout
}

const isPhoneHidden = ({ id }: BucketEntry, key: string): boolean =>
  layouts[id]?.phoneHidden.includes(key) ?? false

const toHead = (bucket: BucketEntry): Head => ({
  title: bucket.title.label,
  columns: bucket.columns.map(({ key, label, format }) => ({
    key,
    label,
    format,
    right: rightAligned.has(format),
    phoneHidden: isPhoneHidden(bucket, key)
  })),
  time: bucket.time.label,
  even: bucket.title.format !== 'eventType',
  layout: layouts[bucket.id]?.name ?? null
})

type Draw = (
  value: NonNullable<BucketCell>,
  column: BucketColumn,
  context: Context
) => Drawn

const toText: Draw = (value) => ({ kind: 'text', text: String(value) })

/** `code@1.4.2`, as GAS and CW write a record's config version. */
const versioned = /^(.+)@(\d+\.\d+\.\d+)$/

const toMono: Draw = (value) => {
  const text = String(value)
  const match = versioned.exec(text)

  return match
    ? { kind: 'versioned', text, code: match[1], version: match[2] }
    : { kind: 'mono', text }
}

const optionOf = (
  { facts }: BucketEntry,
  { fact }: BucketColumn,
  value: BucketCell
): BucketFactValue | undefined =>
  facts
    .find(({ name }) => name === fact)
    ?.values?.find((option) => option.value === value)

const toBadge: Draw = (value, column, { bucket }) => {
  const { label, tone, hint } = {
    label: String(value),
    tone: 'neutral' as const,
    ...optionOf(bucket, column, value)
  }

  return {
    kind: 'badge',
    status: String(value),
    label,
    role: tone,
    title: hint ?? label
  }
}

const toPosition: Draw = (value, column, context) =>
  typeof value === 'object'
    ? {
        kind: 'position',
        statusLabel: toStatusLabel(value as Position),
        positionLabel: toPositionLabel(value as Position)
      }
    : toText(value, column, context)

const toTime: Draw = (value, _column, { now, zone }) => ({
  kind: 'time',
  time: toTimeCell(String(value), now, zone)
})

/** A format this page has not heard of is drawn as text, so a new one never breaks a list. */
const draws = new Map<string, Draw>([
  ['badge', toBadge],
  ['mono', toMono],
  ['position', toPosition],
  ['time', toTime]
])

const toCell =
  (row: BucketRow, context: Context) =>
  (column: BucketColumn): Cell => {
    const value = row.cells[column.key] ?? null
    const draw = draws.get(column.format) ?? toText
    const cell = {
      key: column.key,
      right: rightAligned.has(column.format),
      phoneHidden: isPhoneHidden(context.bucket, column.key)
    }

    return value === null
      ? { ...cell, kind: 'none' }
      : ({ ...cell, ...draw(value, column, context) } as Cell)
  }

const titleNames = new Map<string, (title: string) => EventName>([
  ['eventType', toStampedEventName]
])

const toTitleName = (
  { title }: BucketEntry,
  text: string | null
): EventName | null =>
  text === null ? null : (titleNames.get(title.format)?.(text) ?? null)

const isError = (cell: Cell): boolean =>
  cell.kind === 'badge' && cell.role === 'error'

const versionLinks = new Set(['grant', 'workflow'])

const toSpokenVersion = ({ link, cells }: BucketRow): string | null =>
  link && versionLinks.has(link.kind) && typeof cells.version === 'string'
    ? cells.version
    : null

/** A value's hint cannot know the row is a draft, so the row says so on every other badge. */
const toDraftClause = (
  { bucket }: Context,
  { cells }: BucketRow
): string | null =>
  layouts[bucket.id] && cells.status === 'draft'
    ? `Draft: ${bucket.service} won't pick it for new work until it is published as active.`
    : null

const withDraftClause = (cells: Cell[], clause: string | null): Cell[] =>
  clause === null
    ? cells
    : cells.map((cell) =>
        cell.kind === 'badge' && cell.key !== 'status'
          ? { ...cell, title: `${cell.title} ${clause}` }
          : cell
      )

const isPhoneStatus = (cell: Cell): boolean =>
  cell.key === 'status' && cell.phoneHidden

/** The label of a status hidden on phones, unless it is Active. */
const phoneStatusOf = (cells: Cell[]): string | null => {
  const status = cells.find(isPhoneStatus)

  return status?.kind === 'badge' && status.status !== 'active'
    ? status.label
    : null
}

/** A status hidden on phones is said beside the version there, unless it is Active. */
const withPhoneStatus = (cells: Cell[]): Cell[] => {
  const label = phoneStatusOf(cells)

  return label === null
    ? cells
    : cells.map((cell) =>
        cell.key === 'version' && cell.kind === 'mono'
          ? { ...cell, phoneBadge: label }
          : cell
      )
}

const toRow =
  (context: Context, from: string) =>
  (row: BucketRow): RowModel => {
    const cells = withPhoneStatus(
      withDraftClause(
        context.bucket.columns.map(toCell(row, context)),
        toDraftClause(context, row)
      )
    )

    return {
      href: toRowHref(row.link, from),
      title: row.title ?? none,
      eventName: toTitleName(context.bucket, row.title),
      mono: context.bucket.title.format === 'mono',
      spokenVersion: toSpokenVersion(row),
      subtitle: row.subtitle,
      cells,
      time: toTimeCell(row.time, context.now, context.zone),
      alarming: cells.some(isError)
    }
  }

/** A later page of a search names it, so it is read with the search its first page ran and no other. */
const toCursorHref = (
  { bucket, filters }: Context,
  cursor: string | null,
  searchId: string | null
): string | null =>
  cursor === null
    ? null
    : toBucketHref(
        bucket,
        filters,
        new URLSearchParams({
          cursor,
          ...(searchId ? { searched: searchId } : {})
        })
      )

const toKeepLooking = (
  context: Context,
  { keepLooking, searchedTo }: BucketPaging,
  searchId: string | null
): KeepLooking | null => {
  const href = toCursorHref(context, keepLooking, searchId)

  return href === null
    ? null
    : { href, searchedTo: toPreciseOrNone(searchedTo, context.zone) }
}

const noPaging: BucketPaging = {
  next: null,
  keepLooking: null,
  searchedTo: null,
  complete: false
}

/** Only a bounded read can have looked at less than everything, so only it says when it has. */
const hasSearchedEverything = ({ plan, page }: BucketResult): boolean =>
  plan.kind !== exact && page.complete

const toChoiceText = ({ label, values }: BucketFact, value: string): string => {
  const option = values?.find((choice) => String(choice.value) === value)

  return `${label} is ${option ? option.label : `"${value}"`}`
}

/** "No grant versions whose Status is Draft", or the plain "No … found" with nothing chosen. */
const toNothingText = ({ bucket, filters }: Context): string => {
  const chosen = bucket.facts.filter(({ name }) => filters[name])

  return chosen.length
    ? `No ${bucket.noun.many} whose ${chosen.map((fact) => toChoiceText(fact, filters[fact.name]!)).join(' and ')}.`
    : `No ${bucket.noun.many} found.`
}

/** An empty read that searched the whole range says so on the same line, so the list ends in one place. */
const toEmptyText = (
  context: Context,
  keepLooking: KeepLooking | null,
  searchedEverything: boolean
): string => {
  if (keepLooking !== null) {
    return 'No matches so far.'
  }

  const nothing = toNothingText(context)

  return searchedEverything ? `${nothing} Searched everything.` : nothing
}

const toPaging = (context: Context, searchId: string | null) => {
  const { result } = context
  const page = result === null ? noPaging : result.page
  const keepLooking = toKeepLooking(context, page, searchId)
  const searchedEverything = result !== null && hasSearchedEverything(result)

  return {
    nextHref: toCursorHref(context, page.next, searchId),
    keepLooking,
    searchedEverything,
    emptyText: toEmptyText(context, keepLooking, searchedEverything)
  }
}

const toRefusal = (
  { bucket }: Context,
  { refused, refusal }: BucketListResult
): Refusal | null =>
  refused
    ? { by: 'GAS', message: refusal, startHref: toBucketPath(bucket) }
    : null

/** The search a page ran, and the id its later pages name it by; none for a browse. */
const searchOf = (
  search: { q: string; id: string } | null
): { searched: Searched | null; searchId: string | null } => {
  if (search === null) {
    return { searched: null, searchId: null }
  }

  const searched = toSearched(search.q)

  return { searched, searchId: searched === null ? null : search.id }
}

export const toBucketPage = (
  bucket: BucketEntry,
  read: BucketListResult,
  query: BucketPageQuery,
  search: { q: string; id: string } | null,
  now: Date = new Date(),
  attempt?: SearchAttempt
): BucketPageModel => {
  const { filters, mates, zone } = query
  const context = { bucket, filters, result: read.page, now, zone }
  const { searched, searchId } = searchOf(search)
  const rows = read.page === null ? [] : read.page.rows

  return {
    navActive: bucket.id,
    ...toPageHead(bucket, mates),
    bucket: {
      id: bucket.id,
      label: bucket.label,
      path: toBucketPath(bucket),
      noun: bucket.noun
    },
    tiles: toTiles(context),
    menus: toMenus(context),
    toggles: toToggles(context),
    notes: toNotes(context),
    timeRange: toBucketTimeRange(context),
    search: toSearchBox(context, searched, attempt),
    head: toHead(bucket),
    rows: rows.map(toRow(context, toBucketHref(bucket, filters))),
    ...toPaging(context, searchId),
    refused: toRefusal(context, read),
    unavailable: read.unavailable
  }
}
