import { getFromGas } from '../../common/gas.ts'
import type { ApiToken } from './clients.repository.ts'

/** Who didn't answer for a part: GAS's own read, or CW behind it. */
export type OverviewHop = 'GAS' | 'CW-BE'

export type OverviewReason =
  | 'UNREACHABLE'
  | 'TIMED_OUT'
  | 'ERRORED'
  /** CW has no such read yet: a bare 404 behind GAS. */
  | 'NOT_OFFERED'

export interface OverviewSourceError {
  hop: OverviewHop
  reason: OverviewReason
}

/** Each service's part is read on its own, so one can fail while the other answers. */
export type OverviewPart<T> =
  | { data: T; sourceError: null }
  | { data: null; sourceError: OverviewSourceError }

export interface PerService<T> {
  gas: OverviewPart<T>
  cw: OverviewPart<T>
}

/** `capped`: there were more than the overview's `countCap`. */
export interface OverviewCount {
  count: number
  capped: boolean
}

/** A catalogue list and its URL query, keyed by the facts' declared params, values as stored. */
export interface ListLink {
  path: string
  query: Record<string, string>
}

export interface DeadLetterBar extends OverviewCount {
  from: string
  to: string
}

/** By when each event was created, outbox and inbox together, audit events counted as the list counts them. */
export interface DeadLetters extends OverviewCount {
  /** Twelve two-hour windows back to back over the overview's window, oldest first. */
  bars: DeadLetterBar[]
  /** One per box, outbox then inbox, each with its own count, so a link opens what its count counted. */
  lists: DeadLetterList[]
}

/** A box's dead letters over the window, and its list filtered to them: Dead letter, from and to. */
export interface DeadLetterList extends OverviewCount {
  box: 'outbox' | 'inbox'
  list: ListLink
}

export interface TopError extends OverviewCount {
  /** The error as GAS groups it; `No error recorded` for the dead letters that recorded none, null for a row neither service has keyed. */
  errorKey: string | null
  event: { value: string; label: string } | null
  lastAt: string | null
  /** The list this group's dead letters are in, filtered to them, with no time range. */
  list: ListLink
}

/** The service's outbox and inbox errors summaries of the dead letters there are now, merged, most first: no time window. */
export interface TopErrors {
  entries: TopError[]
  /** More groups than were sent. */
  more: boolean
  /** False when a summary met more distinct values than it counts. */
  complete: boolean
}

export type FailedDefinition = 'permanent_error' | 'transient_error'

export interface FailedVersion {
  code: string
  version: string
  definition: FailedDefinition
  receivedAt: string | null
}

/** Active versions whose definition is Failed or Fetch error: GAS's grants, CW's workflows. */
export interface ConfigFailed {
  versions: FailedVersion[]
  more: boolean
}

/** Active tokens expiring within `withinDays`, and expired ones; revoked ones left out. */
export interface TokensExpiring {
  withinDays: number
  tokens: ApiToken[]
}

export interface Overview {
  /** When GAS worked this out. */
  at: string
  /** The 24 hours the dead-letter figures and bars cover. */
  window: { from: string; to: string }
  countCap: number
  deadLetters: PerService<DeadLetters>
  topErrors: PerService<TopErrors>
  configFailed: PerService<ConfigFailed>
  tokensExpiring: PerService<TokensExpiring>
}

/** One call: GAS reads both services' parts, CW's through its actuators. */
export const getOverview = async (): Promise<Overview> =>
  getFromGas<Overview>('/grant-admin/overview')
