import { getFromGas, postToGas } from '../../common/gas.ts'

/** Named by meaning: the tone a page draws the status in. */
export type BadgeRole = 'neutral' | 'info' | 'warning' | 'success' | 'error'

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

export interface SourceError {
  hop: string
}

export interface EventAttempt {
  at: string | null
  name: string
  message: string
  stack: string | null
}

/** The one record an event belongs to, named by the service that stored the row. */
export interface EventRecord {
  kind: 'application' | 'case'
  code: string
  ref: string
}

export interface EventDetail extends EventWithAttempts {
  /** The name stamped on the row, as its list shows it; null on a row not yet stamped. */
  eventType: string | null
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
  /** False when a JSON round trip would change a stored value; null when the service can't tell. */
  payloadIsPlainJson?: boolean | null
  /** Sent only where the owning service has the record. */
  record?: EventRecord | null
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

export interface PayloadEdit {
  payload: Record<string, unknown>
  /** Already normalised and trimmed. */
  note: string
  /** The revision the edit was made against, so a save over someone else's is refused. */
  revision: number
}

/** GAS answers a saved edit with the new revision and the changed paths; the page reads the event again instead. */
export const editPayload = async (
  key: EventKey,
  { payload, note, revision }: PayloadEdit,
  actor: string
): Promise<void> => {
  await postToGas(`${toPath(key)}/payload`, {
    payload: { payload, note, revision },
    actor
  })
}
