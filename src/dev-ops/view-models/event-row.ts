import { backKey } from './bucket-links.ts'
import type {
  EventRow as EventRowResponse,
  SourceError
} from '../use-cases/get-event.use-case.ts'
import { toEventHref, toTimeCell } from './event-formats.ts'
import type { Zone } from './event-formats.ts'
import { toStampedEventName } from './event-names.ts'
import type { EventName } from './event-names.ts'
import { isDeadLetterStatus } from './event-state.ts'
import { toFittingBack } from './record-filters.ts'

export interface EventRow {
  eventHref: string
  eventId: string
  status: string
  statusLabel: string
  statusRole: EventRowResponse['statusRole']
  statusRetrying: boolean
  latency: string | null
  latencyTitle: string
  createdAt: string
  createdAtInstant: string
  createdAtPrecise: string
  createdAtClock: string
  eventName: EventName
  isDeadLetter: boolean
}

/** One row of a record's table of events; `from` is that table's page, where the event page's Back returns. */
export const toEventRow =
  (now: Date, zone: Zone, from: string) =>
  (event: EventRowResponse): EventRow => {
    const created = toTimeCell(event.createdAt, now, zone)

    return {
      eventHref: `${toEventHref(event)}?${backKey}=${encodeURIComponent(toFittingBack(from))}`,
      eventId: event.eventId,
      status: event.status,
      statusLabel: event.statusLabel,
      statusRole: event.statusRole,
      statusRetrying: event.statusRetrying,
      latency: event.latency,
      latencyTitle: event.latencyTitle,
      createdAt: created.text,
      createdAtInstant: created.instant,
      createdAtPrecise: created.precise,
      createdAtClock: created.clock,
      eventName: toStampedEventName(event.type),
      isDeadLetter: isDeadLetterStatus(event.status)
    }
  }

export const toUnavailableSources = (
  sourceErrors: SourceError[] = []
): string => sourceErrors.map((source) => source.hop).join(', ')
