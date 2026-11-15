import { getFromGas, postToGas } from '../../common/gas.ts'
import type { BadgeRole, SourceError } from './events.repository.ts'
import type { ListTotal, Position } from './record-page.ts'
import { toRepeatOptions } from './record-page.ts'

export type FactValue = string

export interface BucketFactValue {
  value: FactValue
  label: string
  tone?: BadgeRole
  /** What the value means, for a badge's title and under it in a menu. */
  hint?: string
}

export interface BucketFact {
  name: string
  /** Its key in this admin's URLs. */
  param: string
  label: string
  /** Null for an open fact: one with no list to choose from. */
  values: BucketFactValue[] | null
  /** The fact this one is scoped to, as a version is to its grant; choosing that fact clears this one. */
  within: string | null
}

export interface BucketRefKind {
  kind: string
  label: string
}

export interface BucketColumn {
  key: string
  label: string
  format: string
  /** On a `badge` column only: the fact whose values label and colour it. */
  fact?: string
}

/** A ranked count a list declares: the values of `by` among the rows `among` picks out. */
export interface BucketSummary {
  id: string
  label: string
  /** The facts each entry is one combination of, in the order they are drawn. */
  by: string[]
  among: Record<string, string>
  top: number
  /** What the rows that hold no value are called. */
  none: string
}

/** A page several lists of one service share, each as a tab of it. */
export interface BucketPage {
  id: string
  label: string
  /** The label less the service, for where the service is already said. */
  shortLabel: string
}

/** One list, as the service that owns it declares it. */
export interface BucketEntry {
  id: string
  /** Where its list is drawn, below this admin's root, as `events/gas/outbox`. */
  path: string
  label: string
  /** The owning service, by the name the navigation heads its lists with. */
  service: string
  /** The label less the service, for where the service is already said. */
  shortLabel: string
  /** The icon its link is drawn with; null for a list that declares none. */
  icon: string | null
  order: number
  noun: { one: string; many: string }
  time: { label: string }
  facts: BucketFact[]
  refs: BucketRefKind[]
  indexes: string[][]
  groupings: string[]
  title: { label: string; format: string }
  columns: BucketColumn[]
  audited: boolean
  timeline: boolean
  summaries: BucketSummary[]
  /** The page it is a tab of, and its label there; null for a list with a page of its own. */
  page: BucketPage | null
  tab: string | null
}

export interface Catalogue {
  buckets: BucketEntry[]
  sourceErrors: SourceError[]
}

export interface BucketQuery {
  /** One value, or several of a fact whose values are offered. */
  where?: Record<string, string | string[]>
  /** One `kind:value`. */
  ref?: string
  from?: string
  to?: string
  cursor?: string
  limit?: number
  /** Asks for the list's total. */
  count?: boolean
}

export interface BucketPlan {
  kind: string
  index: string[]
  bound: string[]
  filled: string[]
  residual: string[]
  scans: number
}

export type BucketCell = string | number | boolean | Position | null

export interface BucketLink {
  kind: string
  [key: string]: unknown
}

export interface BucketRow {
  id: string
  time: string
  title: string | null
  subtitle: string | null
  cells: Record<string, BucketCell>
  link: BucketLink | null
}

export interface BucketPaging {
  next: string | null
  /** Set when a bounded read stopped at its scan budget: where the next one starts. */
  keepLooking: string | null
  searchedTo: string | null
  complete: boolean
}

export interface BucketResult {
  bucket: string
  plan: BucketPlan
  rows: BucketRow[]
  page: BucketPaging
  /** Counts by fact, which GAS answers only when asked; nothing asks. */
  groups: unknown[]
  /** The list counted with every filter; null when not counted, absent from a service that doesn't count yet. */
  total?: ListTotal | null
}

export const findBuckets = async (): Promise<Catalogue> =>
  getFromGas<Catalogue>('/grant-admin/buckets')

/** A POST, so a searched ref travels in the body and never in a logged URL. */
export const queryBucket = async (
  bucketId: string,
  query: BucketQuery,
  repeat: boolean
): Promise<BucketResult> =>
  postToGas<BucketResult>(
    `/grant-admin/buckets/${encodeURIComponent(bucketId)}/query`,
    { payload: query, ...toRepeatOptions(repeat) }
  )
