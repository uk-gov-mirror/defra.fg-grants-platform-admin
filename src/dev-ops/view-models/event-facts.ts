import type {
  EventLastRedrive,
  EventRecord
} from '../use-cases/get-event.use-case.ts'
import { timeOf, toRecordLink } from './event-context.ts'
import type { EventContext } from './event-context.ts'
import { toTraceHref } from './event-formats.ts'
import { toPurgeReasonLabel } from './purge-form.ts'
import { toDayTime } from './times.ts'
import type { TimeText, Times } from './times.ts'

export type FactValue =
  | { kind: 'text'; text: string }
  | { kind: 'time'; time: TimeText }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'logs'; href: string | null; traceId: string }
  | {
      kind: 'byline'
      time: TimeText | null
      by: string
      /** Said after the name: the purge's reason. */
      after: string
      /** In quotes, under it. */
      note: string | null
    }

export interface Fact {
  label: string
  value: FactValue
}

type FactOf = (context: EventContext) => Fact | null

const quoted = (note: string | null | undefined): string | null =>
  note ? `“${note}”` : null

const byline = (
  { at, by }: EventLastRedrive,
  times: Times,
  after = '',
  note: string | null = null
): FactValue => ({ kind: 'byline', time: timeOf(at, times), by, after, note })

const time = (label: string, value: TimeText | null): Fact | null =>
  value && { label, value: { kind: 'time', time: value } }

const queue: FactOf = ({ key }) => ({
  label: 'Queue',
  value: { kind: 'text', text: key.box === 'inbox' ? 'Inbox' : 'Outbox' }
})

const created: FactOf = ({ event, times }) =>
  time('Created', timeOf(event.createdAt, times))

/** Opens the logs filtered to this trace, from the environment's logs address. */
const logs: FactOf = ({ event: { traceId, createdAt } }) =>
  traceId
    ? {
        label: 'Logs',
        value: {
          kind: 'logs',
          href: toTraceHref({ traceId, createdAt }),
          traceId
        }
      }
    : null

const record = (value: EventRecord | null | undefined): Fact | null => {
  const link = toRecordLink(value)

  return link && { label: link.title, value: { kind: 'link', ...link } }
}

const deletion: FactOf = ({ event, times }) =>
  time('Deletion date', timeOf(event.expiresAt, times, toDayTime))

const lastRedrive: FactOf = ({ event, times }) =>
  event.lastRedrive && {
    label: 'Last redrive',
    value: byline(event.lastRedrive, times)
  }

const edited: FactOf = ({ event, times }) =>
  event.lastEdit
    ? {
        label: 'Payload edited',
        value: byline(event.lastEdit, times, '', quoted(event.lastEdit.note))
      }
    : null

/** The row keeps one purge, and keeps it through a redrive, so the label moves rather than the fact. */
const purged: FactOf = ({ event, state, times }) => {
  const purge = event.lastPurge

  return purge
    ? {
        label: state.purged ? 'Purged' : 'Previously purged',
        value: byline(
          purge,
          times,
          `: ${toPurgeReasonLabel(purge.reasonCode)}`,
          quoted(purge.note)
        )
      }
    : null
}

/** In a fixed order; a fact with nothing to say is left out. */
export const toFacts = (context: EventContext): Fact[] =>
  [
    queue,
    created,
    logs,
    ({ event }: EventContext) => record(event.record),
    deletion,
    lastRedrive,
    edited,
    purged
  ]
    .map((fact) => fact(context))
    .filter((fact): fact is Fact => fact !== null)
