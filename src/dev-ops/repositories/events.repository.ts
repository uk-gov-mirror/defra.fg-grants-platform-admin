import { getFromGas, postToGas } from '../../common/gas.ts'
import type { BadgeRole } from '../view-models/event-formats.ts'

export type EventService = 'gas' | 'caseworking'
export type EventBox = 'inbox' | 'outbox'

export interface EventLastError {
  name: string
  message: string
  at: string | null
}

export interface StatusDisplay {
  statusLabel: string
  statusRole: BadgeRole
  statusRetrying: boolean
}

export interface Event extends StatusDisplay {
  service: EventService
  box: EventBox
  id: string
  eventId: string
  type: string
  status: string
  createdAt: string
}

export interface EventRow extends Event {
  latency: string | null
  latencyTitle: string
}

export interface EventWithAttempts extends Event {
  attempts: string
  targetTopic: string | null
  lastError: EventLastError | null
}

export interface EventsPagination {
  endCursor: string | null
  hasNextPage: boolean
}

export interface SourceError {
  hop: string
}

export interface StatusFilter {
  value: string
  label: string
  explainer: string
}

export interface ServiceFilter {
  value: string
  label: string
}

export interface EventsPage {
  events: EventRow[]
  pagination: EventsPagination
  sourceErrors: SourceError[]
}

export interface EventsQuery {
  cursor?: string
  status?: string
  service?: string
  q?: string
  from?: string
  to?: string
  error?: string
  audit?: string
}

const toSearchString = <T extends object>(query: T): string => {
  const params = new URLSearchParams(
    Object.entries(query).filter(([, value]) => value !== undefined) as [
      string,
      string
    ][]
  )

  return params.size ? `?${params}` : ''
}

export interface SectionError {
  section: string
  message: string
}

export interface EventsPageResponse extends EventsPage {
  statuses: StatusFilter[]
  services: ServiceFilter[]
  counts: EventCounts | null
  breakdown: EventBreakdownPage | null
  sectionErrors: SectionError[]
}

export const findEventsPage = async (
  query: EventsQuery
): Promise<EventsPageResponse> =>
  getFromGas<EventsPageResponse>(
    `/grant-admin/events/page${toSearchString(query)}`
  )

export interface EventCounts {
  PUBLISHED: number
  PROCESSING: number
  FAILED: number
  RESUBMITTED: number
  COMPLETED: number
  DEAD_LETTER: number
  PURGED?: number
}

export interface EventFacets {
  counts: EventCounts
}

export interface EventAttempt {
  at: string | null
  name: string
  message: string
  stack: string | null
}

export interface EventDetail extends EventWithAttempts {
  attemptHistory: EventAttempt[]
  payload: unknown
  segregationRef?: string | null
  traceId?: string | null
  completionDate: string | null
  /** Only a row the database is scheduled to delete has one. */
  expiresAt?: string | null
  /** Sent only on a dead letter the owning service is willing to purge, so its presence gates the Purge button. */
  purgeDeletionDate?: string | null
  lastResubmissionDate: string | null
  lastRedrive: EventLastRedrive | null
  /** The one purge this row remembers, kept through a later redrive. */
  lastPurge?: EventLastPurge | null
  /** Sent only by an owning service that can edit the payload, so its presence gates the Edit button. */
  payloadRevision?: number | null
  lastEdit?: EventLastEdit | null
  /** The payload as it was before the first edit, kept for as long as the row is. */
  originalPayload?: unknown
}

export interface EventLastRedrive {
  at: string | null
  by: string
}

export interface EventLastPurge extends EventLastRedrive {
  reasonCode: string
  note: string | null
}

export interface EventLastEdit extends EventLastRedrive {
  note: string | null
}

export interface EventKey {
  service: EventService
  box: EventBox
  id: string
}

export const toEventKeyPath = ({ service, box, id }: EventKey): string =>
  `${encodeURIComponent(service)}/${encodeURIComponent(box)}/${encodeURIComponent(id)}`

const toPath = (key: EventKey): string =>
  `/grant-admin/events/${toEventKeyPath(key)}`

export const findEvent = async (key: EventKey): Promise<EventDetail> =>
  getFromGas<EventDetail>(toPath(key))

/** GAS answers an accepted redrive with 204 and no body. */
export const redriveEvent = async (
  key: EventKey,
  actor?: string
): Promise<void> => {
  await postToGas(`${toPath(key)}/redrive`, { actor })
}

export interface PurgeReason {
  reasonCode: string
  /** Empty where none was typed, which is only allowed for a coded reason. */
  note: string
}

/** An empty note is left out rather than sent as `""`: the backends type it as optional, and a blank note is no note. */
export const purgeEvent = async (
  key: EventKey,
  { reasonCode, note }: PurgeReason,
  actor?: string
): Promise<void> => {
  await postToGas(`${toPath(key)}/purge`, {
    payload: { reasonCode, ...(note === '' ? {} : { note }) },
    actor
  })
}

export interface EventBreakdownGroup {
  error: string | null
  type: string
  count: number
  firstAt: string | null
  lastAt: string | null
}

export interface EventBreakdownPage {
  groups: EventBreakdownGroup[]
}
