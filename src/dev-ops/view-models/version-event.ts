import type { RecordEvents } from '../use-cases/record-reads.ts'
import { toEventHref } from './event-formats.ts'
import { backKey } from './bucket-links.ts'
import { toFittingBack } from './record-filters.ts'

/**
 * The version's Details row for the ConfigVersionUpdated event it arrived as.
 * GAS and CW keep no event ID on a version, so the page reads the version's
 * events from the inbox and links the newest that completed. A version exists
 * only because its event arrived, so an inbox read whole that holds none means
 * it is past its deletion date. Retire this once the version header carries its event's ID (DATA-GAPS 6).
 */
export type VersionEvent =
  | { kind: 'held'; eventId: string; href: string }
  | { kind: 'gone'; text: string }
  | { kind: 'unread'; text: string }

const completed = 'COMPLETED'

type EventRow = RecordEvents['rows'][number]

/** The newest that completed; else the newest held, which may still be on its way to completing. */
const pickEvent = ({ rows }: RecordEvents): EventRow | undefined =>
  rows.find(({ status }) => status === completed) ?? rows[0]

const toHeld = (event: EventRow, back: string): VersionEvent => ({
  kind: 'held',
  eventId: event.eventId,
  href: `${toEventHref(event)}?${backKey}=${encodeURIComponent(toFittingBack(back))}`
})

/** Past its deletion date only when the inbox was read whole and holds none of the version's events. */
const toNoneHeld = ({ more }: RecordEvents, source: string): VersionEvent =>
  more
    ? {
        kind: 'unread',
        text: `Not among the newest events in ${source}’s inbox.`
      }
    : { kind: 'gone', text: 'No longer held: past its deletion date' }

/** @param events Newest first; null when the inbox couldn't be read. @param back This page, where the event page leads back to. */
export const toVersionEvent = (
  events: RecordEvents | null | undefined,
  source: string,
  back: string
): VersionEvent => {
  if (!events) {
    return { kind: 'unread', text: `Couldn’t be read from ${source}’s inbox.` }
  }

  const event = pickEvent(events)

  return event ? toHeld(event, back) : toNoneHeld(events, source)
}
