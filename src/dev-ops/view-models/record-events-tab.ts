import type {
  EventRow as EventRowResponse,
  SourceError
} from '../use-cases/get-event.use-case.ts'
import type {
  RecordEvents,
  RecordSectionError
} from '../use-cases/record-reads.ts'
import { backKey } from './bucket-links.ts'
import { toTone } from './catalogue-presentation.ts'
import type { Tone } from './catalogue-presentation.ts'
import { toUrlService } from './event-address.ts'
import { toEventHref } from './event-formats.ts'
import { toFittingBack } from './record-filters.ts'
import { toRecordTime } from './record-times.ts'
import type { RecordTime } from './record-times.ts'
import type { Times } from './times.ts'

export interface Message {
  title: string
  text: string
}

export interface EventsTabRow {
  type: string
  href: string
  queue: string
  status: { text: string; tone: Tone }
  created: RecordTime | null
}

/** A tab whose read failed shows why, with the tab's own address to try again. */
export interface TabError extends Message {
  retryHref: string
}

/** A tab with nothing to show: its read failed, or the source sent nothing and didn't say why. */
export type TabNotice =
  | { kind: 'error'; error: TabError }
  | { kind: 'nothing'; title: string }

export type EventsTab =
  | TabNotice
  | {
      kind: 'table'
      unavailable: string | null
      rows: EventsTabRow[]
      empty: Message
      more: string | null
    }

export interface EventsCopy {
  error: Message
  nothing: string
  /** What the table says with no rows. */
  empty: Message
  /** The service whose queues the tab reads, each giving its newest. */
  source: string
  /** The hop that means the service holding the events didn't answer at all, so there is nothing to show. */
  unreachable: { hop: string; message: Message } | null
}

const queues = { inbox: 'Inbox', outbox: 'Outbox' }

const toRow =
  (from: string, times: Times) =>
  (event: EventRowResponse): EventsTabRow => ({
    type: event.type,
    href: `${toEventHref(event)}?${backKey}=${encodeURIComponent(toFittingBack(from))}`,
    queue: queues[event.box],
    status: {
      text: event.statusLabel,
      tone: toTone(
        { id: `${toUrlService(event.service)}.${event.box}` },
        'status',
        event.status,
        event.statusRole
      )
    },
    created: toRecordTime(event.createdAt, times)
  })

/** A section error other than GAS's own "too large", which only Raw has. */
export const toSectionError = (
  sectionErrors: RecordSectionError[],
  section: string
): RecordSectionError | null =>
  sectionErrors.find(
    (error) => error.section === section && error.message !== tooLarge
  ) ?? null

export const tooLarge = 'too large to show'

interface EventsSection {
  events?: RecordEvents | null
  sourceErrors: SourceError[]
  sectionErrors: RecordSectionError[]
}

/** CW-BE missing from a case's events means CW didn't answer at all, so there's nothing to show. */
const isUnreachable = (
  { unreachable }: EventsCopy,
  sourceErrors: SourceError[]
): boolean =>
  unreachable !== null &&
  sourceErrors.some(({ hop }) => hop === unreachable.hop)

const toFailure = (
  { sourceErrors, sectionErrors }: EventsSection,
  copy: EventsCopy,
  tabHref: string
): TabNotice | null => {
  if (isUnreachable(copy, sourceErrors)) {
    return {
      kind: 'error',
      error: { ...copy.unreachable!.message, retryHref: tabHref }
    }
  }

  return toSectionError(sectionErrors, 'events')
    ? { kind: 'error', error: { ...copy.error, retryHref: tabHref } }
    : null
}

/** Other sources that failed are named, and the rows that came are still shown. */
const toTable = (
  events: RecordEvents,
  sourceErrors: SourceError[],
  copy: EventsCopy,
  tabHref: string,
  times: Times
): EventsTab => ({
  kind: 'table',
  unavailable: sourceErrors.length
    ? sourceErrors.map(({ hop }) => hop).join(', ')
    : null,
  rows: events.rows.map(toRow(tabHref, times)),
  empty: copy.empty,
  more: events.more
    ? `Showing the newest 50 from each ${copy.source} queue.`
    : null
})

/** `tabHref` is this tab's address: where Try again reloads, and where each event page's Back returns. */
export const toEventsTab = (
  section: EventsSection,
  copy: EventsCopy,
  tabHref: string,
  times: Times
): EventsTab => {
  const failure = toFailure(section, copy, tabHref)

  if (failure) {
    return failure
  }

  return section.events
    ? toTable(section.events, section.sourceErrors, copy, tabHref, times)
    : { kind: 'nothing', title: copy.nothing }
}
