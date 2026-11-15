import type { BadgeRole, SourceError } from '../use-cases/get-event.use-case.ts'
import type {
  Counterpart,
  Position,
  RecordEvents,
  RecordSectionError,
  RecordSeries,
  RecordTab,
  StoredDate
} from '../use-cases/record-reads.ts'
import {
  isIsoInstant,
  toAbsolute,
  toPreciseInstant,
  toStoredTimeCell
} from './event-formats.ts'
import type { TimeCell, Zone } from './event-formats.ts'
import { formatIn } from './zoned-clock.ts'
import { backKey } from './bucket-links.ts'
import { toEventRow, toUnavailableSources } from './event-row.ts'
import type { EventRow } from './event-row.ts'
import { toJsonView } from './json-viewer.view-model.ts'
import type { JsonView } from './json-viewer.view-model.ts'
import { toPositionLabel, toPositionTrail, toStatusLabel } from './position.ts'
import type { PositionStep } from './position.ts'
import { toFittingBack } from './record-filters.ts'
import type { RecordType } from './record-type.ts'

interface FactBase {
  id: string
  label: string
}

export type Fact = FactBase &
  (
    | { kind: 'mono'; text: string; from: string | null; href: string | null }
    | { kind: 'date'; text: string; instant: string | null }
    | { kind: 'text'; text: string; note?: string }
    | { kind: 'link'; text: string; href: string }
    | { kind: 'codes'; codes: string[] }
    | { kind: 'lines'; lines: FactLine[] }
    | { kind: 'none' }
  )

interface FactBadge {
  status: string
  role: BadgeRole
  title?: string
}

/** One line of a fact that holds several: a label, then codes, badges or a muted note, each optional. */
export interface FactLine {
  label: string
  codes?: string[]
  badges?: FactBadge[]
  note?: string | null
}

/** One member of the record's series. */
export interface SeriesMember {
  ref: string
  position: Position
  createdAt: StoredDate
  closedAt: StoredDate
}

interface SeriesData {
  latestRef: string | null
  members: (SeriesMember & { href: string })[]
  /** GAS sent the members' facts, not only their refs. */
  detailed: boolean
}

interface SeriesRow {
  ref: string
  /** Null on the page's own record. */
  href: string | null
  replaced: boolean
  statusLabel: string | null
  positionLabel: string
  /** Null where nothing is stored. */
  created: TimeCell | null
  closed: TimeCell | null
}

interface SectionTab {
  id: string
  label: string
  href: string
  active: boolean
}

interface EventsTab {
  rows: EventRow[]
  /** More matched than are shown: each queue gives only its newest. */
  more: boolean
}

export interface RawTab {
  view: JsonView | null
  tooLarge: boolean
}

/** One record's page, as the service-specific view model reads it out of GAS's answer. */
export interface RecordPageData {
  ref: string
  href: string
  position: Position
  facts: Fact[][] | null
  series?: SeriesData | null
  events?: RecordEvents | null
  raw?: object | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

export interface RecordPageModel {
  record: RecordType
  ref: string
  /** Empty when opened from no list: the layout's first list stands in. */
  backHref: string
  /** The bucket the page was opened from, which is where it sits in the navigation. */
  navActive: string | null
  trail: PositionStep[]
  tabs: SectionTab[]
  tab: string
  facts: Fact[][] | null
  /** Two or more members, or none at all. */
  series: SeriesRow[] | null
  seriesDetailed: boolean
  events: EventsTab | null
  raw: RawTab | null
  sectionError: string | null
  /** The tab's document is over GAS's cap; Raw says so itself. */
  tooLarge: boolean
  unavailableSources: string
}

/** Every tab keeps the list the record was opened from, so Back still returns to it. */
export const toTabHref = (
  href: string,
  tab: string,
  from: string,
  extra?: Record<string, string>
): string => {
  const params = new URLSearchParams({
    ...(tab === 'overview' ? {} : { tab }),
    ...(from === '' ? {} : { [backKey]: toFittingBack(from) }),
    ...extra
  })

  return params.size ? `${href}?${params}` : href
}

/** A version's page, told to come back to this record's Overview; null without a version to link to. */
export const toVersionLinkOf = (
  toVersionHref: (ref: { code: string; version: string }) => string,
  code: string,
  version: string | null,
  recordHref: string,
  from: string
): string | null =>
  version
    ? `${toVersionHref({ code, version })}?${backKey}=${encodeURIComponent(toFittingBack(toTabHref(recordHref, 'overview', from)))}`
    : null

export const toTabs = (
  { tabs }: RecordType,
  href: string,
  active: string,
  from: string
): SectionTab[] =>
  tabs.map(({ id, label }) => ({
    id,
    label,
    href: toTabHref(href, id, from),
    active: id === active
  }))

const kib = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 })

const bytesPerKib = 1024

/** A fact with no value, drawn as the one sign for a missing value. */
export const toNoneFact = (id: string, label: string): Fact => ({
  id,
  label,
  kind: 'none'
})

export const toSizeFact = (
  bytes: number | null,
  label: string = 'Size'
): Fact =>
  bytes === null
    ? toNoneFact('size', label)
    : {
        id: 'size',
        label,
        kind: 'text',
        text: `${kib.format(bytes / bytesPerKib)} KiB`
      }

/** Anything but an ISO instant is shown as stored, so a malformed date is never read as another. */
const toDateText = (value: string, zone: Zone) =>
  isIsoInstant(value)
    ? {
        text: toPreciseInstant(new Date(value), zone),
        instant: toAbsolute(value)
      }
    : { text: value, instant: null }

const dayOptions: Intl.DateTimeFormatOptions = {
  day: 'numeric',
  month: 'short',
  year: 'numeric'
}

/** "1 Jan 2100", with a muted note after it; anything but an ISO instant is shown as stored. */
export const toDayFact = (
  id: string,
  label: string,
  value: StoredDate,
  note: string,
  zone: Zone
): Fact => {
  if (value === null) {
    return toNoneFact(id, label)
  }

  return {
    id,
    label,
    kind: 'text',
    text: isIsoInstant(value)
      ? formatIn(zone, 'en-GB', dayOptions).format(new Date(value))
      : value,
    note
  }
}

export const toDateFact = (
  id: string,
  label: string,
  value: StoredDate,
  zone: Zone
): Fact =>
  value === null
    ? toNoneFact(id, label)
    : { id, label, kind: 'date', ...toDateText(value, zone) }

export const toTextFact = (
  id: string,
  label: string,
  value: string | null
): Fact =>
  value === null
    ? toNoneFact(id, label)
    : { id, label, kind: 'text', text: value }

export const toCodesFact = (
  id: string,
  label: string,
  codes: string[] | null
): Fact =>
  codes?.length ? { id, label, kind: 'codes', codes } : toNoneFact(id, label)

export const toLinkFact = (
  id: string,
  label: string,
  text: string,
  href: string | null
): Fact =>
  href ? { id, label, kind: 'link', text, href } : toNoneFact(id, label)

export const toMonoFact = (
  id: string,
  label: string,
  value: string | null
): Fact =>
  value === null
    ? toNoneFact(id, label)
    : { id, label, kind: 'mono', text: value, from: null, href: null }

interface Versions {
  code: string
  currentConfigVersion: string | null
  originalConfigVersion: string | null
}

/** `frps-private-beta@1.4.2`, and where it started when that was another version. */
export const toVersionedFact = (
  id: string,
  label: string,
  { code, currentConfigVersion, originalConfigVersion }: Versions,
  href: string | null
): Fact => ({
  id,
  label,
  kind: 'mono',
  text: currentConfigVersion ? `${code}@${currentConfigVersion}` : code,
  from:
    originalConfigVersion && originalConfigVersion !== currentConfigVersion
      ? originalConfigVersion
      : null,
  href
})

/** The other record as a fact named for its type; no row at all when there is no link to follow. */
export const toCounterpartFacts = (
  { itemId, title, linkLabel }: RecordType,
  href: string | null
): Fact[] =>
  href
    ? [{ id: itemId, label: title, kind: 'link', text: linkLabel, href }]
    : []

/** A version's counterpart: a link, "None" when the other service has no such version, no row when it could not say. */
export const toReleaseCounterpartFacts = (
  type: RecordType,
  counterpart: Counterpart,
  href: string
): Fact[] => {
  if (!counterpart) {
    return []
  }

  return counterpart.exists
    ? toCounterpartFacts(type, href)
    : [toTextFact(type.itemId, type.title, 'None')]
}

const noFacts = {
  position: { phase: null, stage: null, status: null },
  createdAt: null,
  closedAt: null
}

/** Every ref in the series is a row, oldest first, with whatever GAS sent of its member. */
export const toSeriesData = <Member>(
  series: RecordSeries<Member> | null,
  toMember: (member: Member) => SeriesMember,
  hrefOf: (ref: string) => string
): SeriesData | null => {
  if (series === null) {
    return null
  }

  const byRef = new Map(
    (series.members ?? []).map((member) => {
      const known = toMember(member)

      return [known.ref, known]
    })
  )

  return {
    latestRef: series.latestRef,
    members: series.refs.map((ref) => ({
      ...noFacts,
      ...byRef.get(ref),
      ref,
      href: hrefOf(ref)
    })),
    detailed: series.members !== undefined
  }
}

const toSeriesRow =
  (ref: string, latestRef: string | null, now: Date, zone: Zone) =>
  (member: SeriesData['members'][number]): SeriesRow => ({
    ref: member.ref,
    href: member.ref === ref ? null : member.href,
    replaced: latestRef !== null && member.ref !== latestRef,
    statusLabel: toStatusLabel(member.position),
    positionLabel: toPositionLabel(member.position),
    created: toStoredTimeCell(member.createdAt, now, zone),
    closed: toStoredTimeCell(member.closedAt, now, zone)
  })

const minSeriesLength = 2

const toSeries = (
  { ref, series }: RecordPageData,
  now: Date,
  zone: Zone
): SeriesRow[] | null =>
  series && series.members.length >= minSeriesLength
    ? series.members.map(toSeriesRow(ref, series.latestRef, now, zone))
    : null

const isDetailed = ({ series }: RecordPageData): boolean =>
  series?.detailed ?? false

export const toEvents = (
  events: RecordEvents | null | undefined,
  now: Date,
  zone: Zone,
  from: string
): EventsTab | null =>
  events
    ? { rows: events.rows.map(toEventRow(now, zone, from)), more: events.more }
    : null

/** GAS's own words for a document it will not show; any other Raw failure is an error like any tab's. */
const tooLargeToShow = 'too large to show'

const isTooLarge = ({ message }: RecordSectionError): boolean =>
  message === tooLargeToShow

/** @param section The GAS read the tab shows, which names its errors. */
export const toTooLarge = (
  sectionErrors: RecordSectionError[],
  section: string
): boolean =>
  sectionErrors.some((error) => error.section === section && isTooLarge(error))

export const toRaw = (
  document: object | null | undefined,
  sectionErrors: RecordSectionError[],
  section: string
): RawTab => ({
  view: document ? toJsonView(document) : null,
  tooLarge: toTooLarge(sectionErrors, section)
})

/** Never too large to show: that is a warning of its own, not an error. */
export const toSectionError = (
  sectionErrors: RecordSectionError[],
  section: string
): string | null =>
  sectionErrors.find((error) => error.section === section && !isTooLarge(error))
    ?.message ?? null

/** Raw draws its own document and its own too large; every other tab has the shared warning. */
export const toTabSection = (
  document: object | null | undefined,
  sectionErrors: RecordSectionError[],
  tab: string,
  section: string
): Pick<RecordPageModel, 'raw' | 'sectionError' | 'tooLarge'> => ({
  raw: tab === 'raw' ? toRaw(document, sectionErrors, section) : null,
  sectionError: toSectionError(sectionErrors, section),
  tooLarge: tab !== 'raw' && toTooLarge(sectionErrors, section)
})

export const toRecordPage = (
  record: RecordType,
  data: RecordPageData,
  tab: RecordTab,
  zone: Zone,
  from: string = '',
  now: Date = new Date()
): RecordPageModel => ({
  record,
  ref: data.ref,
  backHref: from,
  navActive: null,
  trail: toPositionTrail(data.position),
  tabs: toTabs(record, data.href, tab, from),
  tab,
  facts: data.facts,
  series: toSeries(data, now, zone),
  seriesDetailed: isDetailed(data),
  events: toEvents(
    data.events,
    now,
    zone,
    toTabHref(data.href, 'events', from)
  ),
  ...toTabSection(data.raw, data.sectionErrors, tab, tab),
  unavailableSources: toUnavailableSources(data.sourceErrors)
})
