import { ukZone } from './zoned-clock.ts'
import type { EventRow } from '../repositories/events.repository.ts'
import { toEventRow, toUnavailableSources } from './event-row.ts'
import { fromMax } from './record-filters.ts'

const now = new Date('2026-06-16T10:20:00.000Z')

const event = (overrides: Partial<EventRow> = {}): EventRow => ({
  service: 'caseworking',
  box: 'inbox',
  id: '665f1c2e9a1b2c3d4e5f6a7b',
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'UpdateCaseStatus',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  createdAt: '2026-06-16T10:00:00.000Z',
  latency: null,
  latencyTitle: 'Received to processed',
  ...overrides
})

const tab = '/dev-ops/cases/example-workflow/abc-123?tab=events'

describe('toEventRow', () => {
  test('draws an event as its name, where it sits, its status and when it was made', () => {
    expect(toEventRow(now, ukZone, tab)(event())).toEqual({
      eventHref: `/dev-ops/events/cw/inbox/665f1c2e9a1b2c3d4e5f6a7b?back=${encodeURIComponent(tab)}`,
      eventId: '3f2c1a0e-1111-2222-3333-444455556666',
      status: 'DEAD_LETTER',
      statusLabel: 'Dead letter',
      statusRole: 'error',
      statusRetrying: false,
      latency: null,
      latencyTitle: 'Received to processed',
      createdAt: '20m ago',
      createdAtInstant: '2026-06-16T10:00:00Z',
      createdAtPrecise: '16 Jun 2026 11:00:00.000',
      createdAtClock: '11:00:00',
      eventName: { name: 'UpdateCaseStatus', spoken: 'Update case status' },
      isDeadLetter: true
    })
  })

  test('shortens a way back too long for the event page to accept', () => {
    const long = `/dev-ops/cases/w/abc?tab=events&back=${encodeURIComponent(`/dev-ops/cases?q=${'a'.repeat(fromMax)}`)}`
    const back = new URL(
      toEventRow(now, ukZone, long)(event()).eventHref,
      'http://gpa'
    ).searchParams.get('back')

    expect(back).toBe('/dev-ops/cases/w/abc?tab=events')
  })

  test('marks only a dead letter as one', () => {
    expect(
      toEventRow(
        now,
        ukZone,
        tab
      )(event({ status: 'COMPLETED', statusLabel: 'Completed' })).isDeadLetter
    ).toBe(false)
  })
})

describe('toUnavailableSources', () => {
  test('names each source that could not be read', () => {
    expect(toUnavailableSources([{ hop: 'CW-BE' }, { hop: 'GAS inbox' }])).toBe(
      'CW-BE, GAS inbox'
    )
  })

  test('names none when all were read, or none were reported', () => {
    expect(toUnavailableSources([])).toBe('')
    expect(toUnavailableSources()).toBe('')
  })
})
