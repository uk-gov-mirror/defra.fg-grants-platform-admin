import { toEventsTab } from './record-events-tab.ts'
import type { EventsCopy } from './record-events-tab.ts'
import { toTimes } from './times.ts'

const times = toTimes('utc')

const copy: EventsCopy = {
  error: { title: 'Failed.', text: 'Try later.' },
  nothing: 'Nothing.',
  empty: { title: 'None', text: 'No events.' },
  source: 'CW',
  unreachable: {
    hop: 'CW-BE',
    message: { title: 'Unreachable.', text: 'CW-BE didn’t answer.' }
  }
}

const tabHref = '/dev-ops/cases/woodland/a?tab=events'

const event = {
  service: 'caseworking' as const,
  box: 'inbox' as const,
  id: '6716a9c2e4b0a1f2c3d4e5f6',
  eventId: 'e1',
  type: 'CaseCreated',
  status: 'FAILED',
  statusLabel: 'Failed',
  statusRole: 'warning' as const,
  statusRetrying: true,
  createdAt: '2026-10-13T14:05:00.000Z',
  latency: null,
  latencyTitle: ''
}

const section = (overrides = {}) => ({
  events: { rows: [event], more: false },
  sourceErrors: [],
  sectionErrors: [],
  ...overrides
})

describe('toEventsTab', () => {
  test('draws each event as a row that opens it and comes back to this tab', () => {
    expect(toEventsTab(section(), copy, tabHref, times)).toEqual({
      kind: 'table',
      unavailable: null,
      rows: [
        {
          type: 'CaseCreated',
          href: `/dev-ops/events/cw/inbox/6716a9c2e4b0a1f2c3d4e5f6?back=${encodeURIComponent(tabHref)}`,
          queue: 'Inbox',
          status: { text: 'Failed', tone: 'danger' },
          created: {
            datetime: '2026-10-13T14:05:00Z',
            text: '13\u00a0Oct 2026 14:05',
            title: '13 Oct 2026 14:05:00 UTC'
          }
        }
      ],
      empty: copy.empty,
      more: null
    })
  })

  test.each([
    ['PUBLISHED', 'success', 'info'],
    ['QUEUED', 'neutral', 'neutral'],
    ['RETRYING', 'warning', 'warning']
  ] as const)(
    'tones a %s event with role %s as the Events list does: %s',
    (status, statusRole, tone) => {
      const tab = toEventsTab(
        section({
          events: { rows: [{ ...event, status, statusRole }], more: false }
        }),
        copy,
        tabHref,
        times
      )

      expect(tab.kind === 'table' && tab.rows[0].status.tone).toBe(tone)
    }
  )

  test('names every source it could not read', () => {
    const tab = toEventsTab(
      section({ sourceErrors: [{ hop: 'CW inbox' }, { hop: 'CW outbox' }] }),
      copy,
      tabHref,
      times
    )

    expect(tab.kind === 'table' && tab.unavailable).toBe('CW inbox, CW outbox')
  })

  test('says it shows only the newest from each queue when there are more', () => {
    const tab = toEventsTab(
      section({ events: { rows: [event], more: true } }),
      copy,
      tabHref,
      times
    )

    expect(tab.kind === 'table' && tab.more).toBe(
      'Showing the newest 50 from each CW queue.'
    )
  })

  test('has no table when the service holding the events did not answer', () => {
    expect(
      toEventsTab(
        section({ sourceErrors: [{ hop: 'CW-BE' }] }),
        copy,
        tabHref,
        times
      )
    ).toEqual({
      kind: 'error',
      error: {
        title: 'Unreachable.',
        text: 'CW-BE didn’t answer.',
        retryHref: tabHref
      }
    })
  })

  test("leaves CW-BE to the warning on a record whose events aren't CW's", () => {
    const tab = toEventsTab(
      section({ sourceErrors: [{ hop: 'CW-BE' }] }),
      { ...copy, unreachable: null },
      tabHref,
      times
    )

    expect(tab.kind === 'table' && tab.unavailable).toBe('CW-BE')
  })

  test('says the tab failed, never with GAS’s own message, when GAS failed it', () => {
    expect(
      toEventsTab(
        section({
          events: null,
          sectionErrors: [{ section: 'events', message: 'Mongo timed out' }]
        }),
        copy,
        tabHref,
        times
      )
    ).toEqual({
      kind: 'error',
      error: { title: 'Failed.', text: 'Try later.', retryHref: tabHref }
    })
  })

  test('says the source sent nothing when it sent no events and no reason', () => {
    expect(
      toEventsTab(section({ events: null }), copy, tabHref, times)
    ).toEqual({
      kind: 'nothing',
      title: 'Nothing.'
    })
  })
})
