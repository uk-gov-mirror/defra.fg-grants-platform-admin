import type { RecordSeries, StoredDate } from '../use-cases/record-reads.ts'
import { toRecordTime } from './record-times.ts'
import type { RecordTime } from './record-times.ts'
import type { Times } from './times.ts'

/** What a series row shows of one member, whichever service stored it. */
export interface SeriesMember {
  ref: string
  /** False for a ref GAS sent no member for. */
  known?: boolean
  createdAt: StoredDate
  /** Always null on an application: only cases close. */
  closedAt: StoredDate
}

export interface SeriesRow {
  ref: string
  /** Null on the page's own record. */
  href: string | null
  current: boolean
  /** Neither the newest nor the one being viewed. */
  replaced: boolean
  created: RecordTime | null
  /** Null while the case is still open. */
  closed: RecordTime | null
  /** False for a ref GAS sent no member for: nothing about it is known, open or closed. */
  known: boolean
}

export interface SeriesModel {
  description: string
  /** GAS sent the members' dates, not only their refs. */
  detailed: boolean
  showClosed: boolean
  rows: SeriesRow[]
}

export interface ReplacedAlert {
  title: string
  text: string
  action: { text: string; href: string }
}

interface SeriesOptions {
  current: string
  /** The service that acts on the series: the one that stores it. */
  source: string
  showClosed: boolean
  hrefOf: (ref: string) => string
  times: Times
}

const minSeriesLength = 2

const toDescription = (detailed: boolean, source: string): string =>
  detailed
    ? `Oldest first. Each one replaces the one before it; ${source} only acts on the newest.`
    : `Oldest first. ${source} sent only the references, so their dates aren’t shown. Open one to see it.`

/** The newest is the one GAS names, else the last ref, oldest first as they are. */
export const latestOf = (series: RecordSeries<unknown>): string | undefined =>
  series.latestRef ?? series.refs.at(-1)

const byRefOf = <Member>(
  series: RecordSeries<Member>,
  toMember: (member: Member) => SeriesMember
): Map<string, SeriesMember> =>
  new Map(
    (series.members ?? []).map((member) => {
      const known = toMember(member)

      return [known.ref, known]
    })
  )

const unknownMember = (ref: string): SeriesMember => ({
  ref,
  known: false,
  createdAt: null,
  closedAt: null
})

const toRow =
  (latest: string | undefined, { current, hrefOf, times }: SeriesOptions) =>
  ({ ref, createdAt, closedAt, known = true }: SeriesMember): SeriesRow => ({
    ref,
    known,
    href: ref === current ? null : hrefOf(ref),
    current: ref === current,
    replaced: ref !== latest && ref !== current,
    created: toRecordTime(createdAt, times),
    closed: toRecordTime(closedAt, times)
  })

/** Every ref in the series is a row, oldest first; fewer than two is no series. Status is on each record's own page. */
export const toSeries = <Member>(
  series: RecordSeries<Member> | null,
  toMember: (member: Member) => SeriesMember,
  options: SeriesOptions
): SeriesModel | null => {
  if (series === null || series.refs.length < minSeriesLength) {
    return null
  }

  const byRef = byRefOf(series, toMember)
  const detailed = series.members !== undefined

  return {
    description: toDescription(detailed, options.source),
    detailed,
    showClosed: options.showClosed,
    rows: series.refs
      .map((ref) => byRef.get(ref) ?? unknownMember(ref))
      .map(toRow(latestOf(series), options))
  }
}

/** Only Overview carries the series, so only Overview knows the record was replaced. */
export const toReplacedAlert = (
  series: RecordSeries<unknown> | null,
  {
    current,
    noun,
    source,
    hrefOf
  }: {
    current: string
    noun: string
    source: string
    hrefOf: (ref: string) => string
  }
): ReplacedAlert | null => {
  const latest = series ? latestOf(series) : undefined

  if (!latest || latest === current) {
    return null
  }

  return {
    title: `This ${noun} was replaced by ${latest}.`,
    text: `${source} only acts on the newest in the series. This one is kept for its history.`,
    action: { text: `Open ${latest}`, href: hrefOf(latest) }
  }
}
