import { config } from '../../common/config.ts'
import { logger } from '../../common/logger.ts'
import type {
  EventDetail,
  EventKey,
  EventResult
} from '../use-cases/get-event.use-case.ts'
import type {
  EventRow,
  ServiceFilter
} from '../use-cases/get-events.use-case.ts'
import { hoursPerDay, minutesPerHour, msPerMinute } from './event-formats.ts'
import { toEventPage, toSafeFrom } from './event-page.view-model.ts'
import { toEventsPage } from './events-page.view-model.ts'

vi.mock(import('../../common/config.ts'))
vi.mock(import('../../common/logger.ts'))

const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

const now = new Date('2026-06-16T10:20:00.000Z')

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const key: EventKey = { service: 'gas', box: 'outbox', id }

const inboxKey: EventKey = { service: 'gas', box: 'inbox', id }

const services: ServiceFilter[] = [
  { value: 'gas', label: 'GAS' },
  { value: 'caseworking', label: 'CW-BE' }
]

const deadLetter = {
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error' as const,
  statusRetrying: false,
  attempts: '5/5'
}

const completed = {
  status: 'COMPLETED',
  statusLabel: 'Completed',
  statusRole: 'success' as const,
  statusRetrying: false,
  attempts: '2/5'
}

const stateOf = (status: string, label = status) => ({
  status,
  statusLabel: label,
  statusRole: 'neutral' as const,
  statusRetrying: false,
  attempts: '1/5'
})

const base = {
  service: 'gas' as const,
  box: 'outbox' as const,
  id,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  ...deadLetter,
  createdAt: '2026-06-16T10:00:00.000Z'
}

const detail = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  ...base,
  targetTopic: 'gas__sns__update_case_status_fifo',
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key',
    at: '2026-06-16T10:16:05.000Z'
  },
  attemptHistory: [
    {
      at: '2026-06-16T10:08:00.000Z',
      name: 'MongoNetworkTimeoutError',
      message: 'connection timed out after 30000ms',
      stack: null
    },
    {
      at: '2026-06-16T10:16:05.000Z',
      name: 'MongoServerError',
      message: 'E11000 duplicate key error collection: gas.events index: id_1',
      stack: null
    }
  ],
  payload: { data: { caseRef: 'GLD-9B2' } },
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  ...overrides
})

const inboxDetail = (overrides: Partial<EventDetail> = {}): EventDetail =>
  detail({
    box: 'inbox',
    targetTopic: null,
    segregationRef: 'GLD-9B2-BWS-grasslands',
    traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
    ...overrides
  })

const found = (event: EventDetail = detail()): EventResult => ({
  outcome: 'found',
  event
})

const model = (
  result: EventResult = found(),
  query: Parameters<typeof toEventPage>[2] = {},
  notice?: Parameters<typeof toEventPage>[3]
) => toEventPage(result, key, query, notice)

const noticed = (
  notice: Omit<NonNullable<Parameters<typeof toEventPage>[3]>, 'page'>
) => model(found(), {}, { ...notice, page: `/dev-ops/events/gas/outbox/${id}` })

const inboxModel = (
  result: EventResult = found(inboxDetail()),
  query: Parameters<typeof toEventPage>[2] = {}
) => toEventPage(result, inboxKey, query)

describe('toSafeFrom', () => {
  test.each([
    ['?status=DEAD_LETTER', '?status=DEAD_LETTER'],
    ['?cursor=a%2Bb&direction=forward', '?cursor=a%2Bb&direction=forward'],
    ['?', '?']
  ])('keeps %s', (from, expected) => {
    expect(toSafeFrom(from)).toBe(expected)
  })

  test.each([
    ['an absolute url', 'https://example.com'],
    ['a protocol-relative url', '//example.com'],
    ['a query hiding one', '?next=//example.com'],
    ['a path', '/dev-ops/events'],
    ['a bare needle', 'status=FAILED'],
    ['an empty string', ''],
    ['nothing at all', undefined]
  ])('drops %s', (_name, from) => {
    expect(toSafeFrom(from)).toBe('')
  })
})

describe('toEventPage', () => {
  test('links back to the plain list when there is no query to keep', () => {
    expect(model().backHref).toBe('/dev-ops/events')
  })

  test('links back to the list the operator left', () => {
    expect(model(found(), { from: '?status=FAILED' }).backHref).toBe(
      '/dev-ops/events?status=FAILED'
    )
  })

  test('links back to the plain list when the query is not one', () => {
    expect(model(found(), { from: '//example.com' }).backHref).toBe(
      '/dev-ops/events'
    )
  })

  test('names the event and the state the endpoint says it is in', () => {
    const page = model()

    expect(page.type).toBe('case.status.updated')
    expect(page.status).toBe('DEAD_LETTER')
    expect(page.statusLabel).toBe('Dead letter')
    expect(page.statusRole).toBe('error')
    expect(page.statusRetrying).toBe(false)
    expect(page.attempts).toEqual({ made: 5, allowed: 5 })
  })

  test('carries no type fact, and no fuller spelling of one', () => {
    const page = model()

    expect(page).not.toHaveProperty('typeTitle')
    expect(page.eventName).toEqual({
      name: 'CaseStatusUpdated',
      spoken: 'Case status updated'
    })
  })

  test('says the service and the box as the list says them', () => {
    expect(model()).toMatchObject({ serviceLabel: 'GAS', boxLabel: 'Outbox' })
    expect(
      inboxModel(found(inboxDetail({ service: 'caseworking' })))
    ).toMatchObject({ serviceLabel: 'CW-BE', boxLabel: 'Inbox' })
  })

  test('says a service it has never heard of as it was sent', () => {
    expect(
      model(found(detail({ service: 'reporting' as unknown as 'gas' })))
        .serviceLabel
    ).toBe('reporting')
  })

  test('spells an instant out to the millisecond, day month year', () => {
    expect(
      model(
        found(
          detail({ lastRedrive: { at: '2026-06-16T10:10:00.042Z', by: 'Ada' } })
        )
      ).lastRedriveText
    ).toBe('16 Jun 2026 11:10:00.042')
  })

  test('states the year the event happened in, not this one', () => {
    expect(
      model(
        found(
          detail({
            attemptHistory: [
              {
                at: '2024-01-05T23:59:59.123Z',
                name: 'E',
                message: 'boom',
                stack: null
              }
            ]
          })
        )
      ).attemptHistory[0].precise
    ).toBe('5 Jan 2024 23:59:59.123')
  })

  test('spells September in three letters, as the list column does', () => {
    expect(
      model(
        found(
          detail({
            attemptHistory: [
              {
                at: '2026-09-30T00:00:00.007Z',
                name: 'E',
                message: 'boom',
                stack: null
              }
            ]
          })
        )
      ).attemptHistory[0].precise
    ).toBe('30 Sep 2026 01:00:00.007')
  })

  test('pretty-prints the payload at two spaces', () => {
    expect(model().payloadJson).toBe(
      '{\n  "data": {\n    "caseRef": "GLD-9B2"\n  }\n}'
    )
  })

  test('prints a stored null as a payload', () => {
    expect(model(found(detail({ payload: null }))).payloadJson).toBe('null')
  })

  test('has nothing to print when the endpoint sent no payload', () => {
    expect(model(found(detail({ payload: undefined }))).payloadJson).toBeNull()
  })

  test('reads the failure in full, class and instant apart', () => {
    const page = model()

    expect(page.errorName).toBe('MongoServerError')
    expect(page.errorMessage).toBe('E11000 duplicate key')
    expect(page.errorAt).toBe('16 Jun 2026 11:16:05.000')
    expect(page.errorAtInstant).toBe('2026-06-16T10:16:05Z')
  })

  test('reports no failure on an event that never had one', () => {
    const page = model(found(detail({ lastError: null })))

    expect(page.errorName).toBeNull()
    expect(page.errorMessage).toBeNull()
    expect(page.errorAt).toBeNull()
  })

  test('reads a failure the endpoint recorded without an instant', () => {
    const page = model(
      found(detail({ lastError: { name: 'Error', message: 'no', at: null } }))
    )

    expect(page.errorMessage).toBe('no')
    expect(page.errorAt).toBeNull()
  })

  test('calls the last error final only on a dead letter', () => {
    expect(model().errorRole).toBe('error')
    expect(model(found(detail(stateOf('FAILED', 'Failed')))).errorRole).toBe(
      'warning'
    )
  })

  test('offers a redrive only on a dead-lettered event', () => {
    expect(model().canRedrive).toBe(true)
    expect(model(found(detail(stateOf('FAILED', 'Failed')))).canRedrive).toBe(
      false
    )
  })

  test('confirms a redrive only when it is asked for and allowed', () => {
    expect(model(found(), { confirm: 'redrive' }).confirmRedrive).toBe(true)
    expect(model().confirmRedrive).toBe(false)
    expect(
      model(found(detail(completed)), { confirm: 'redrive' }).confirmRedrive
    ).toBe(false)
  })

  test('points the confirmation and the write at this same event', () => {
    const page = model(found(), { from: '?status=DEAD_LETTER' })

    expect(page.redriveHref).toBe(
      `/dev-ops/events/gas/outbox/${id}?from=%3Fstatus%3DDEAD_LETTER&confirm=redrive`
    )
    expect(page.cancelHref).toBe(
      `/dev-ops/events/gas/outbox/${id}?from=%3Fstatus%3DDEAD_LETTER`
    )
    expect(page.redriveAction).toBe(`/dev-ops/events/gas/outbox/${id}/redrive`)
  })

  test('says a redrive was requested', () => {
    expect(noticed({ outcome: 'redriven', status: null }).banner).toEqual({
      role: 'success',
      message:
        'Redrive requested — status is now Resubmitted; the poller will retry it. Refresh to follow the attempts.'
    })
  })

  test('names the status a conflict reported, in the words it arrived in', () => {
    const banner = noticed({ outcome: 'conflict', status: 'Completed' }).banner

    expect(banner?.role).toBe('warning')
    expect(banner?.message).toBe(
      "Not redriven — this event can't be redriven. Its status is now Completed."
    )
  })

  test('ends the sentence on a conflict whose body carried no status', () => {
    expect(noticed({ outcome: 'conflict', status: null }).banner?.message).toBe(
      "Not redriven — this event can't be redriven."
    )
  })

  test.each([
    ['not-found', 'error', 'no longer has this event'],
    ['unavailable', 'error', 'could not be reached'],
    ['timed-out', 'warning', 'Redrive status unknown']
  ] as const)(
    'says what went wrong for a %s redrive',
    (outcome, role, sentence) => {
      const banner = noticed({ outcome, status: null }).banner

      expect(banner?.role).toBe(role)
      expect(banner?.message).toContain(sentence)
    }
  )

  test('shows no banner on a page nothing redirected to', () => {
    expect(model().banner).toBeNull()
  })

  test('keeps the way back on a page whose event could not be read', () => {
    const page = model(
      { outcome: 'unavailable', event: null },
      { from: '?status=FAILED' }
    )

    expect(page.unavailable).toBe(true)
    expect(page.backHref).toBe('/dev-ops/events?status=FAILED')
    expect(page.payloadJson).toBeNull()
    expect(page.canRedrive).toBe(false)
  })

  test('lists every attempt, oldest first and numbered as it happened', () => {
    const { attemptHistory } = model()

    expect(attemptHistory).toHaveLength(2)
    expect(attemptHistory.map(({ number }) => number)).toEqual(['#1', '#2'])
    expect(attemptHistory[0]).toEqual({
      number: '#1',
      role: 'warning',
      precise: '16 Jun 2026 11:08:00.000',
      delta: 'after 8m 0s',
      name: 'MongoNetworkTimeoutError',
      message: 'connection timed out after 30000ms',
      stack: null,
      instant: '2026-06-16T10:08:00Z'
    })
  })

  test('drops a stack header that repeats the attempt line', () => {
    const { attemptHistory } = model(
      found(
        detail({
          attemptHistory: [
            {
              at: '2026-06-16T10:08:00.000Z',
              name: 'Error',
              message: 'boom',
              stack: 'Error: boom\n    at handler (/app/src/x.js:1:1)'
            }
          ]
        })
      )
    )

    expect(attemptHistory[0].stack).toBe('at handler (/app/src/x.js:1:1)')
  })

  test('keeps a stack whose header says more than the attempt line', () => {
    const stack =
      'Error: boom, and the half the message lost\n    at run (/x.js:1:1)'
    const { attemptHistory } = model(
      found(
        detail({
          attemptHistory: [
            {
              at: '2026-06-16T10:08:00.000Z',
              name: 'Error',
              message: 'boom',
              stack
            }
          ]
        })
      )
    )

    expect(attemptHistory[0].stack).toBe(stack)
  })

  test('carries a null stack as null, so the page draws no expander', () => {
    expect(model().attemptHistory[0].stack).toBeNull()
  })

  test('says each attempt to the millisecond, and never how long ago it was', () => {
    const { attemptHistory } = model()

    expect(attemptHistory[1]).toMatchObject({
      precise: '16 Jun 2026 11:16:05.000',
      delta: '+8m 5s'
    })
    expect(
      attemptHistory.map((entry) => entry.precise).join(' ')
    ).not.toContain('ago')
    expect(attemptHistory[0]).not.toHaveProperty('relative')
  })

  test('keeps a round millisecond on an attempt, and the instant beside it', () => {
    const { attemptHistory } = model(
      found(
        detail({
          attemptHistory: [
            {
              at: '2026-06-16T10:08:00.000Z',
              name: 'Error',
              message: 'boom',
              stack: null
            }
          ]
        })
      )
    )

    expect(attemptHistory[0].precise).toBe('16 Jun 2026 11:08:00.000')
    expect(attemptHistory[0].instant).toBe('2026-06-16T10:08:00Z')
  })

  test("draws a completed event's success as the attempt after its failures", () => {
    expect(
      model(
        found(
          detail({ ...completed, completionDate: '2026-06-16T10:17:00.000Z' })
        )
      ).attemptSuccess
    ).toEqual({
      number: '#3',
      precise: '16 Jun 2026 11:17:00.000',
      delta: '+55.0s',
      instant: '2026-06-16T10:17:00Z'
    })
  })

  test('numbers a first-time success #1, timed from creation', () => {
    expect(
      model(
        found(
          detail({
            ...completed,
            attempts: '0/5',
            attemptHistory: [],
            completionDate: '2026-06-16T10:00:00.207Z'
          })
        )
      ).attemptSuccess
    ).toMatchObject({ number: '#1', delta: 'after 207ms' })
  })

  const failures = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      at: `2026-06-16T10:0${index}:00.000Z`,
      name: 'E',
      message: 'boom',
      stack: null
    }))

  test.each([
    ['failures recorded', '2/5', 2, { made: 3, allowed: 5 }, '#3'],
    ['a first-time success', '0/5', 0, { made: 1, allowed: 5 }, '#1'],
    [
      'a legacy row that counted its success',
      '1/5',
      0,
      { made: 1, allowed: 5 },
      '#1'
    ],
    [
      'a legacy row with three failures and its success',
      '4/5',
      0,
      { made: 4, allowed: 5 },
      '#4'
    ],
    ['history capped at ten', '12/5', 10, { made: 13, allowed: 5 }, '#13']
  ])(
    'counts a completed event from its failure count: %s',
    (_name, attempts, recorded, label, number) => {
      const page = model(
        found(
          detail({
            ...completed,
            attempts,
            attemptHistory: failures(recorded),
            completionDate: '2026-06-16T10:17:00.000Z'
          })
        )
      )

      expect(page.attempts).toEqual(label)
      expect(page.attemptSuccess?.number).toBe(number)
    }
  )

  test('keeps the endpoint count on an event that has not completed', () => {
    expect(model().attempts).toEqual({ made: 5, allowed: 5 })
  })

  const rolesOf = (event: EventDetail) =>
    model(found(event)).attemptHistory.map(({ role }) => role)

  test('ends a dead letter in an error, every failure before it retried', () => {
    expect(rolesOf(detail())).toEqual(['warning', 'error'])
  })

  test('draws every failure before a completion as retried', () => {
    expect(
      rolesOf(
        detail({ ...completed, completionDate: '2026-06-16T10:17:00.000Z' })
      )
    ).toEqual(['warning', 'warning'])
  })

  test.each([['FAILED'], ['RESUBMITTED'], ['PROCESSING']])(
    'calls no failure final on a %s event still being retried',
    (status) => {
      expect(rolesOf(detail(stateOf(status)))).toEqual(['warning', 'warning'])
    }
  )

  test("counts a redriven dead letter's first final failure as retried once it is back in play", () => {
    const redrive = { at: '2026-06-16T10:10:00.000Z', by: 'Ada' }

    expect(
      rolesOf(detail({ ...stateOf('RESUBMITTED'), lastRedrive: redrive }))
    ).toEqual(['warning', 'warning'])
    expect(rolesOf(detail({ lastRedrive: redrive }))).toEqual([
      'warning',
      'error'
    ])
  })

  test('draws no success on an event that did not complete', () => {
    expect(model().attemptSuccess).toBeNull()
    expect(
      model(found(detail(stateOf('PROCESSING', 'Processing')))).attemptSuccess
    ).toBeNull()
  })

  test('ends an undated completion in its success, saying no instant rather than inventing one', () => {
    expect(
      model(found(detail({ ...completed, completionDate: null })))
        .attemptSuccess
    ).toEqual({ number: '#3', precise: null, delta: null, instant: null })
  })

  const noHistory = { attemptHistory: [], lastError: null }

  test.each([
    ['a history', {}, 'timeline'],
    ['a completed row with a history', { ...completed }, 'timeline'],
    [
      'a first-time success',
      { ...completed, ...noHistory, attempts: '0/5' },
      'timeline'
    ],
    [
      'an old completed row',
      { ...completed, ...noHistory, attempts: '1/5' },
      'predatedCompleted'
    ],
    [
      'an old dead letter at a count of 0 with no error',
      { ...noHistory, attempts: '0/5' },
      'predated'
    ],
    [
      'an old dead letter with no count and no error',
      { ...noHistory, attempts: '-' },
      'predated'
    ],
    ['an old dead letter with its error', { attemptHistory: [] }, 'predated'],
    [
      'a retrying row with attempts counted but no history',
      { ...stateOf('FAILED'), ...noHistory, attempts: '3/5' },
      'predated'
    ],
    [
      'a row in play with an error at a count of 0',
      { ...stateOf('RESUBMITTED'), attemptHistory: [], attempts: '0/5' },
      'predated'
    ],
    [
      'a queued row never tried',
      { ...stateOf('PUBLISHED'), ...noHistory, attempts: '0/5' },
      'notYet'
    ],
    [
      'a retrying row with no count and no error',
      { ...stateOf('FAILED'), ...noHistory, attempts: '-' },
      'notYet'
    ],
    [
      'a redriven row with no attempts since',
      {
        ...stateOf('RESUBMITTED'),
        ...noHistory,
        attempts: '0/5',
        lastRedrive: { at: '2026-06-16T11:00:00.000Z', by: 'Ada' }
      },
      'redriven'
    ]
  ])('picks the attempts block for %s', (_name, overrides, block) => {
    expect(
      model(found(detail(overrides as Partial<EventDetail>))).attemptsBlock
    ).toBe(block)
  })

  test('makes a missing backoff visible as four sub-second deltas', () => {
    const { attemptHistory } = model(
      found(
        detail({
          createdAt: '2026-06-16T10:08:00.000Z',
          attemptHistory: [
            {
              at: '2026-06-16T10:08:00.120Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T10:08:00.393Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T10:08:00.905Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T10:08:02.005Z',
              name: 'E',
              message: 'boom',
              stack: null
            }
          ]
        })
      )
    )

    expect(
      attemptHistory.map(({ number, precise, delta }) => [
        number,
        precise,
        delta
      ])
    ).toEqual([
      ['#1', '16 Jun 2026 11:08:00.120', 'after 120ms'],
      ['#2', '16 Jun 2026 11:08:00.393', '+273ms'],
      ['#3', '16 Jun 2026 11:08:00.905', '+512ms'],
      ['#4', '16 Jun 2026 11:08:02.005', '+1.1s']
    ])
  })

  test('reads a real backoff as a widening run of deltas', () => {
    const { attemptHistory } = model(
      found(
        detail({
          createdAt: '2026-06-16T04:00:00.000Z',
          attemptHistory: [
            {
              at: '2026-06-16T04:00:30.000Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T04:02:30.000Z',
              name: 'E',
              message: 'boom',
              stack: null
            },
            {
              at: '2026-06-16T09:36:30.000Z',
              name: 'E',
              message: 'boom',
              stack: null
            }
          ]
        })
      )
    )

    expect(attemptHistory.map(({ delta }) => delta)).toEqual([
      'after 30.0s',
      '+2m 0s',
      '+5h 34m'
    ])
  })

  test('states no delta for an instant it cannot read', () => {
    const { attemptHistory } = model(
      found(
        detail({
          attemptHistory: [
            { at: 'not a date', name: 'E', message: 'boom', stack: null },
            { at: 'nor this', name: 'E', message: 'boom', stack: null }
          ]
        })
      )
    )

    expect(
      attemptHistory.map(({ precise, delta }) => [precise, delta])
    ).toEqual([
      ['—', null],
      ['—', null]
    ])
  })

  test('reports no attempts at all on an event that predates the history', () => {
    const { attemptHistory } = model(found(detail({ attemptHistory: [] })))

    expect(attemptHistory).toEqual([])
  })

  test('links the trace at plain Discover on the shared index pattern', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel()

    expect(traceHref).toBe(
      `${logsBase}/_dashboards/app/data-explorer/discover/#` +
        `?_a=(discover:(columns:!(container_name,message,log.level,trace.id),isDirty:!f,sort:!('@timestamp',desc)),metadata:(indexPattern:e55f3890-5d4a-11ee-8f40-670c9b0b8093,view:discover))` +
        `&_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:'2026-06-16T04:00:00.000Z',to:'2026-06-16T16:00:00.000Z'))` +
        `&_q=(filters:!(),query:(language:kuery,query:'trace.id:%224bf92f3577b34da6a3ce929d0e0e4736%22'))`
    )
  })

  test('windows the search six hours either side of creation', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(inboxDetail({ createdAt: '2026-06-16T13:30:00.000Z' }))
    )

    expect(traceHref).toContain("time:(from:'2026-06-16T07:30:00.000Z'")
    expect(traceHref).toContain("to:'2026-06-16T19:30:00.000Z')")
  })

  test('windows across a date boundary without losing the day', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(inboxDetail({ createdAt: '2026-06-16T02:00:00.000Z' }))
    )

    expect(traceHref).toContain("time:(from:'2026-06-15T20:00:00.000Z'")
  })

  test('links nothing on a row with no trace at all', () => {
    givenLogsExplorer()

    expect(
      inboxModel(found(inboxDetail({ traceId: null }))).traceHref
    ).toBeNull()
  })

  test('reports no segregation ref and no trace on an outbox row without one', () => {
    givenLogsExplorer()

    expect(model()).toMatchObject({
      segregationRef: null,
      segregationRefHref: null,
      segregationRefTitle: null,
      traceId: null,
      traceHref: null
    })
  })

  test('links an outbox row trace id, centred on its creation', () => {
    givenLogsExplorer()

    const page = model(
      found(
        detail({
          createdAt: '2026-06-16T10:00:00.000Z',
          traceId: '4bf92f3577b34da6a3ce929d0e0e4736'
        })
      )
    )

    expect(page.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
    expect(page.traceHref).toContain("time:(from:'2026-06-16T04:00:00.000Z'")
    expect(page.traceHref).toContain(
      'trace.id:%224bf92f3577b34da6a3ce929d0e0e4736%22'
    )
  })

  test('links an inbox row segregation ref at every event that shares it', () => {
    expect(inboxModel()).toMatchObject({
      segregationRef: 'GLD-9B2-BWS-grasslands',
      segregationRefHref: '/dev-ops/events?q=GLD-9B2-BWS-grasslands',
      segregationRefTitle:
        'GLD-9B2-BWS-grasslands\nShow every event with this segregation ref',
      traceId: '4bf92f3577b34da6a3ce929d0e0e4736'
    })
  })

  test('keeps audit rows in the segregation ref search from an audit record', () => {
    expect(
      model(
        found(
          detail({ type: 'audit', segregationRef: 'GLD-9B2-BWS-grasslands' })
        )
      ).segregationRefHref
    ).toBe('/dev-ops/events?q=GLD-9B2-BWS-grasslands&audit=include')
  })

  // The id is there and the explorer is configured, so the plain span it falls
  // back to reads as a broken link: the reason has to reach the logs.
  test('links nothing, and says why, when the row has an unparseable created instant', () => {
    givenLogsExplorer()

    expect(
      inboxModel(found(inboxDetail({ createdAt: 'not-a-date' }))).traceHref
    ).toBeNull()
    expect(logger.warn).toHaveBeenCalledWith(
      'No trace link for 4bf92f3577b34da6a3ce929d0e0e4736: fg-gas-backend sent no usable createdAt (not-a-date)'
    )
  })

  test('says nothing about a row it could link', () => {
    givenLogsExplorer()

    expect(inboxModel().traceHref).not.toBeNull()
    expect(logger.warn).not.toHaveBeenCalled()
  })

  test('keeps a bare CDP request id as the trace id', () => {
    givenLogsExplorer()

    expect(
      inboxModel(found(inboxDetail({ traceId: 'cdp-request-id-1' }))).traceHref
    ).toContain("query:'trace.id:%22cdp-request-id-1%22'")
  })

  test('url-encodes a trace id that would otherwise escape the href', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(inboxDetail({ traceId: '" onmouseover=alert(1) x="' }))
    )

    expect(traceHref).not.toContain('"')
    expect(traceHref).not.toContain(' ')
  })

  test('escapes a rison quote in a trace id so it cannot close the query', () => {
    givenLogsExplorer()

    const { traceHref } = inboxModel(
      found(inboxDetail({ traceId: "a'),b:(c" }))
    )

    expect(traceHref).toContain("query:'trace.id:%22a!')%2Cb%3A(c%22'))")
  })

  test('doubles a rison escape character in a trace id', () => {
    givenLogsExplorer()

    expect(
      inboxModel(found(inboxDetail({ traceId: 'a!f' }))).traceHref
    ).toContain('trace.id:%22a!!f%22')
  })

  test('carries the trace id an inbox row names', () => {
    givenLogsExplorer()

    expect(inboxModel().traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736')
  })

  test('offers no logs link at all', () => {
    givenLogsExplorer()

    expect(model()).not.toHaveProperty('logsHref')
  })
})

const identicalAttempts = [
  {
    at: '2026-06-16T10:08:00.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events',
    stack: null
  },
  {
    at: '2026-06-16T10:16:05.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events',
    stack: null
  }
]

const lastRedrive = { at: '2026-06-16T10:10:00.000Z', by: 'Ada Lovelace' }

describe('a dead letter with the park removed', () => {
  test('offers the redrive alone', () => {
    const page = model()

    expect(page.canRedrive).toBe(true)
    expect(page).not.toHaveProperty('canPark')
    expect(page).not.toHaveProperty('canUnpark')
    expect(page).not.toHaveProperty('parkAction')
    expect(page).not.toHaveProperty('unparkAction')
    expect(page).not.toHaveProperty('parkedFact')
  })

  // A session written before the park was removed still carries its outcome.
  test('has no banner left for a parked outcome', () => {
    const parked = { outcome: 'parked', status: null }

    expect(
      noticed(parked as unknown as Parameters<typeof noticed>[0]).banner
    ).toBeNull()
  })
})

describe('the futile redrive warning', () => {
  test('warns when the last redrive produced the identical failure', () => {
    const page = model(
      found(detail({ attemptHistory: identicalAttempts, lastRedrive }))
    )

    expect(page.futileWarning).toBe(
      'The last two attempts since the redrive (by Ada Lovelace, 16 Jun 2026 11:10:00.000) failed with the identical error — ' +
        'redriving again is unlikely to succeed until the underlying cause is fixed.'
    )
  })

  test('says nothing when the last two attempts failed differently', () => {
    const page = model(found(detail({ lastRedrive })))

    expect(page.futileWarning).toBeNull()
  })

  test('says nothing when nobody has redriven it', () => {
    const page = model(
      found(detail({ attemptHistory: identicalAttempts, lastRedrive: null }))
    )

    expect(page.futileWarning).toBeNull()
  })

  test('says nothing on one attempt, however it failed', () => {
    const page = model(
      found(detail({ attemptHistory: [identicalAttempts[0]], lastRedrive }))
    )

    expect(page.futileWarning).toBeNull()
  })

  test('says nothing when there is no attempt history at all', () => {
    const page = model(found(detail({ attemptHistory: [], lastRedrive })))

    expect(page.futileWarning).toBeNull()
  })

  test.each([
    ['COMPLETED', 'Completed'],
    ['RESUBMITTED', 'Resubmitted'],
    ['PARKED', 'PARKED']
  ])('says nothing on a %s event', (status, label) => {
    const page = model(
      found(
        detail({
          ...stateOf(status, label),
          attemptHistory: identicalAttempts,
          lastRedrive
        })
      )
    )

    expect(page.futileWarning).toBeNull()
  })

  test('compares the last two attempts and not the ones before them', () => {
    const page = model(
      found(
        detail({
          attemptHistory: [
            {
              at: '2026-06-16T10:00:00.000Z',
              name: 'MongoNetworkTimeoutError',
              message: 'connection timed out',
              stack: null
            },
            ...identicalAttempts
          ],
          lastRedrive
        })
      )
    )

    expect(page.futileWarning).not.toBeNull()
  })
})

describe('the last redrive', () => {
  test('says the instant absolutely, and who asked, as two values', () => {
    const page = model(found(detail({ lastRedrive })))

    expect(page.lastRedriveInstant).toBe('2026-06-16T10:10:00Z')
    expect(page.lastRedriveInstant).not.toContain('ago')
    expect(page.lastRedriveBy).toBe('Ada Lovelace')
  })

  test('says nothing on an event nobody has redriven', () => {
    expect(model().lastRedriveInstant).toBeNull()
    expect(model().lastRedriveBy).toBeNull()
  })
})

describe('the deletion date', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  test('spells out when the database will delete a completed event', () => {
    const page = model(
      found(detail({ ...completed, expiresAt: '2026-09-14T10:00:00.000Z' }))
    )

    expect(page.expiresText).toBe('14 Sep 2026 11:00:00.000')
    expect(page.expiresInstant).toBe('2026-09-14T10:00:00Z')
  })

  test('says nothing on an event nothing is scheduled to delete', () => {
    const page = model(found(detail({ expiresAt: null })))

    expect(page.expiresText).toBeNull()
    expect(page.expiresInstant).toBeNull()
  })

  test('says nothing when the backend sends no deletion date at all', () => {
    expect(model().expiresText).toBeNull()
    expect(model().expiresInstant).toBeNull()
  })

  test('hides the fact rather than dashing it when the date will not parse', () => {
    const page = model(found(detail({ ...completed, expiresAt: 'soon' })))

    expect(page.expiresText).toBeNull()
    expect(page.expiresInstant).toBeNull()
  })

  test('reads the clocks going back over the retention period, not through them', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    // 11:00 by the British Summer Time clock these dates are read against.
    vi.setSystemTime(new Date('2026-09-21T10:00:00.000Z'))

    const expiring = (at: number) =>
      model(
        found(detail({ ...completed, expiresAt: new Date(at).toISOString() }))
      ).expiresText

    const retention = 90 * hoursPerDay * minutesPerHour * msPerMinute

    expect(expiring(Date.now())).toBe('21 Sep 2026 11:00:00.000')
    // The clocks have gone back by then, so the same span of days reads an
    // hour earlier on the wall clock.
    expect(expiring(Date.now() + retention)).toBe('20 Dec 2026 10:00:00.000')
  })
})

describe('the shared failure link', () => {
  test('offers every other dead letter with this error, whole', () => {
    expect(model().errorSearchHref).toBe(
      '/dev-ops/events?error=E11000+duplicate+key'
    )
  })

  test('keeps audit rows in the error search from an audit record', () => {
    expect(model(found(detail({ type: 'audit' }))).errorSearchHref).toBe(
      '/dev-ops/events?error=E11000+duplicate+key&audit=include'
    )
  })

  test('escapes a message that would otherwise be a query of its own', () => {
    const page = model(
      found(
        detail({
          attemptHistory: [
            {
              at: '2026-06-16T10:16:05.000Z',
              name: 'Error',
              message: 'a&b=c #1',
              stack: null
            }
          ],
          lastError: { name: 'Error', message: 'a&b=c #1', at: null }
        })
      )
    )

    expect(page.errorSearchHref).toBe('/dev-ops/events?error=a%26b%3Dc+%231')
  })

  test('is absent on an event with no failure recorded', () => {
    expect(model(found(detail({ lastError: null }))).errorSearchHref).toBeNull()
  })

  test.each([
    ['COMPLETED', 'Completed'],
    ['PARKED', 'PARKED']
  ])('is absent on a %s event', (status, label) => {
    expect(
      model(found(detail(stateOf(status, label)))).errorSearchHref
    ).toBeNull()
  })
})

const listRow = (event: EventRow) =>
  toEventsPage(
    {
      page: {
        events: [event],
        pagination: {
          endCursor: null,
          hasNextPage: false
        },
        sourceErrors: []
      },
      statuses: [],
      services,
      facets: null,
      breakdown: null,
      unavailable: false
    },
    {},
    now
  ).rows[0]

const row = (overrides: Partial<EventRow> = {}): EventRow => ({
  ...base,
  latency: null,
  latencyTitle: 'Queued to delivered to SNS',
  ...overrides
})

describe('the Queue cell, on the list and on this page', () => {
  test('says the service and the box the same way on both, and keeps no hop', () => {
    const page = model(found(detail()))
    const listed = listRow(row())

    expect(page).toMatchObject({ serviceLabel: 'GAS', boxLabel: 'Outbox' })
    expect(listed).toMatchObject({ serviceLabel: 'GAS', boxLabel: 'Outbox' })
    for (const surface of [page, listed]) {
      expect(surface).not.toHaveProperty('hop')
      expect(surface).not.toHaveProperty('queue')
    }
  })

  test('keeps the topic to this page', () => {
    expect(model(found(detail())).targetTopic).toBe(
      'gas__sns__update_case_status_fifo'
    )
    expect(listRow(row())).not.toHaveProperty('targetTopic')
  })
})

describe('the last attempt and the failure link', () => {
  const longMessage = `E11000 duplicate key ${'x'.repeat(600)}`
  const attemptAt = '2026-06-16T10:16:05.000Z'
  const truncated = (message: string) => ({
    at: attemptAt,
    name: 'MongoServerError',
    message,
    stack: null
  })

  test('draws the whole message the link searches for', () => {
    const page = model(
      found(
        detail({
          attemptHistory: [truncated(longMessage.slice(0, 512))],
          lastError: {
            name: 'MongoServerError',
            message: longMessage,
            at: attemptAt
          }
        })
      )
    )

    expect(page.attemptHistory[0].message).toBe(longMessage)
    expect(page.errorSearchHref).toBe(
      `/dev-ops/events?error=${encodeURIComponent(longMessage).replace(/%20/g, '+')}`
    )
    expect(
      new URL(page.errorSearchHref ?? '', 'http://dev-ops').searchParams.get(
        'error'
      )
    ).toBe(page.attemptHistory[0].message)
  })

  test('leaves a message the backend did not cut alone', () => {
    const page = model(
      found(
        detail({
          attemptHistory: [truncated('E11000 duplicate key')],
          lastError: {
            name: 'MongoServerError',
            message: 'E11000 duplicate key',
            at: attemptAt
          }
        })
      )
    )

    expect(page.attemptHistory[0].message).toBe('E11000 duplicate key')
  })

  test('leaves earlier attempts with the text that was stored for them', () => {
    const page = model(
      found(
        detail({
          attemptHistory: [
            truncated('connection timed out'),
            truncated(longMessage.slice(0, 512))
          ],
          lastError: {
            name: 'MongoServerError',
            message: longMessage,
            at: attemptAt
          }
        })
      )
    )

    expect(page.attemptHistory[0].message).toBe('connection timed out')
    expect(page.attemptHistory[1].message).toBe(longMessage)
  })

  test('leaves an attempt the failure does not describe alone', () => {
    const page = model(
      found(
        detail({
          attemptHistory: [truncated('claim expired before completion')],
          lastError: {
            name: 'MongoServerError',
            message: longMessage,
            at: attemptAt
          }
        })
      )
    )

    expect(page.attemptHistory[0].message).toBe(
      'claim expired before completion'
    )
    // The link would search the failure text, which this page never shows.
    expect(page.errorSearchHref).toBeNull()
  })

  test('still offers the lookup where no attempt disagrees with it', () => {
    const page = model(
      found(
        detail({
          attemptHistory: [],
          lastError: {
            name: 'MongoServerError',
            message: 'E11000 duplicate key',
            at: attemptAt
          }
        })
      )
    )

    expect(page.errorSearchHref).toBe(
      '/dev-ops/events?error=E11000+duplicate+key'
    )
  })

  test('says nothing of a failure on an event that has none', () => {
    const page = model(
      found(detail({ attemptHistory: [truncated('boom')], lastError: null }))
    )

    expect(page.attemptHistory[0].message).toBe('boom')
    expect(page.errorSearchHref).toBeNull()
  })
})

describe('an attempt or redrive with no instant', () => {
  const history = [
    { at: '2026-06-16T10:08:00.000Z', name: 'E', message: 'a', stack: null },
    { at: null, name: 'E', message: 'b', stack: null },
    { at: '2026-06-16T10:10:00.000Z', name: 'E', message: 'c', stack: null }
  ]

  test('dashes it, names no instant and gaps the next from the last known', () => {
    const { attemptHistory } = model(found(detail({ attemptHistory: history })))

    expect(
      attemptHistory.map(({ precise, instant, delta }) => [
        precise,
        instant,
        delta
      ])
    ).toEqual([
      ['16 Jun 2026 11:08:00.000', '2026-06-16T10:08:00Z', 'after 8m 0s'],
      ['—', null, null],
      ['16 Jun 2026 11:10:00.000', '2026-06-16T10:10:00Z', '+2m 0s']
    ])
  })

  test('gaps nothing after a first attempt with no instant', () => {
    const { attemptHistory } = model(
      found(detail({ attemptHistory: history.slice(1) }))
    )

    expect(attemptHistory.map(({ delta }) => delta)).toEqual([null, null])
  })

  test('dashes a redrive with no instant and names none', () => {
    const page = model(found(detail({ lastRedrive: { at: null, by: 'Ada' } })))

    expect(page.lastRedriveText).toBe('—')
    expect(page.lastRedriveInstant).toBeNull()
  })
})

describe('a redriven event', () => {
  const redrive = { at: '2026-06-16T11:00:00.000Z', by: 'Ada' }
  const redriven = (overrides: Partial<EventDetail> = {}) =>
    detail({
      ...stateOf('RESUBMITTED'),
      attempts: '0/5',
      attemptHistory: [],
      lastResubmissionDate: '2026-06-16T10:16:30.000Z',
      lastRedrive: redrive,
      ...overrides
    })

  test('says it was redriven with no attempts since, not a missing history', () => {
    const page = model(found(redriven()))

    expect(page.attemptsBlock).toBe('redriven')
    expect(page.resubmittedSinceLastAttempt).toBe(false)
    expect(page.lastResubmissionDate).toBeNull()
  })

  test('keeps the legacy reading on a row that was never redriven', () => {
    expect(model(found(redriven({ lastRedrive: null }))).attemptsBlock).toBe(
      'predated'
    )
  })

  test('is not waiting once it has completed', () => {
    expect(
      model(found(redriven({ ...completed, attempts: '0/5' }))).attemptsBlock
    ).toBe('timeline')
  })

  const attemptAt = (at: string) => [
    { at, name: 'E', message: 'boom', stack: null }
  ]

  test('times the first attempt after the redrive from the redrive', () => {
    expect(
      model(
        found(
          redriven({ attemptHistory: attemptAt('2026-06-16T11:00:30.000Z') })
        )
      ).attemptHistory[0].delta
    ).toBe('after 30.0s')
  })

  test('reads a redrive written in another offset as the instant it is', () => {
    expect(
      model(
        found(
          redriven({
            lastRedrive: { at: '2026-06-16T12:00:00+01:00', by: 'Ada' },
            attemptHistory: attemptAt('2026-06-16T11:00:30.000Z')
          })
        )
      ).attemptHistory[0].delta
    ).toBe('after 30.0s')
  })

  test('times an attempt that came before the redrive from creation', () => {
    expect(
      model(
        found(
          redriven({ attemptHistory: attemptAt('2026-06-16T10:00:30.000Z') })
        )
      ).attemptHistory[0].delta
    ).toBe('after 30.0s')
  })

  test('times a success straight after the redrive from the redrive', () => {
    expect(
      model(
        found(
          redriven({
            ...completed,
            attempts: '0/5',
            completionDate: '2026-06-16T11:00:00.500Z'
          })
        )
      ).attemptSuccess?.delta
    ).toBe('after 500ms')
  })
})

describe('the last resubmission', () => {
  test('states the instant to the millisecond, with the ISO beside it', () => {
    const page = model(
      found(detail({ lastResubmissionDate: '2026-06-16T10:16:30.000Z' }))
    )

    expect(page.lastResubmissionDate).toBe('16 Jun 2026 11:16:30.000')
    expect(page.lastResubmissionInstant).toBe('2026-06-16T10:16:30Z')
  })

  test('says nothing on an event nobody has resubmitted', () => {
    const page = model()

    expect(page.lastResubmissionDate).toBeNull()
    expect(page.resubmittedSinceLastAttempt).toBe(false)
  })

  test('marks a resubmission that came after the last attempt', () => {
    expect(
      model(found(detail({ lastResubmissionDate: '2026-06-16T10:20:00.000Z' })))
        .resubmittedSinceLastAttempt
    ).toBe(true)
  })

  test('marks nothing where an attempt followed the resubmission', () => {
    expect(
      model(found(detail({ lastResubmissionDate: '2026-06-16T10:10:00.000Z' })))
        .resubmittedSinceLastAttempt
    ).toBe(false)
  })

  test.each([
    ['the same instant without milliseconds', '2026-06-16T10:16:05Z', false],
    [
      'an earlier instant in another offset',
      '2026-06-16T11:10:00+01:00',
      false
    ],
    ['a later instant in another offset', '2026-06-16T11:20:00+01:00', true]
  ])(
    'compares a resubmission at %s as an instant, not as text',
    (_name, lastResubmissionDate, since) => {
      expect(
        model(found(detail({ lastResubmissionDate })))
          .resubmittedSinceLastAttempt
      ).toBe(since)
    }
  )

  test('marks no resubmission on a completed event', () => {
    expect(
      model(
        found(
          detail({
            ...completed,
            attemptHistory: [],
            attempts: '0/5',
            completionDate: '2026-06-16T10:17:00.000Z',
            lastResubmissionDate: '2026-06-16T10:16:30.000Z'
          })
        )
      ).resubmittedSinceLastAttempt
    ).toBe(false)
  })

  test('marks a resubmission on an event with no attempt history', () => {
    expect(
      model(
        found(
          detail({
            attemptHistory: [],
            lastResubmissionDate: '2026-06-16T10:16:30.000Z'
          })
        )
      ).resubmittedSinceLastAttempt
    ).toBe(true)
  })
})

const purgeDeletionDate = '2026-09-14T09:00:00.000Z'

const purgeable = (overrides: Partial<EventDetail> = {}) =>
  detail({ purgeDeletionDate, ...overrides })

const lastPurge = {
  at: '2026-06-16T10:18:00.000Z',
  by: 'Ada Lovelace',
  reasonCode: 'BROKEN_PAYLOAD',
  note: 'sheetId arrives as a number'
}

const purgedState = {
  status: 'PURGED',
  statusLabel: 'Purged',
  statusRole: 'neutral' as const,
  statusRetrying: false
}

const confirming = (
  event: EventDetail = purgeable(),
  form?: Parameters<typeof toEventPage>[4]
) => toEventPage(found(event), key, { confirm: 'purge' }, undefined, form)

const submitted = (
  reasonCode: string,
  note: string,
  error: NonNullable<Parameters<typeof toEventPage>[4]>['error']
) =>
  confirming(purgeable(), {
    page: `/dev-ops/events/gas/outbox/${id}`,
    reasonCode,
    note,
    error
  })

describe('the purge button', () => {
  test('offers a purge on a dead letter the owning service will purge', () => {
    expect(model(found(purgeable())).canPurge).toBe(true)
  })

  test('offers none on a dead letter that carries no projected deletion date', () => {
    expect(model().canPurge).toBe(false)
    expect(model(found(detail({ purgeDeletionDate: null }))).canPurge).toBe(
      false
    )
  })

  test.each(['PUBLISHED', 'PROCESSING', 'FAILED', 'RESUBMITTED', 'COMPLETED'])(
    'offers none on a %s event, however it is dated',
    (status) => {
      expect(model(found(purgeable(stateOf(status)))).canPurge).toBe(false)
    }
  )

  test('offers none on an event that is already purged', () => {
    expect(
      model(found(purgeable({ ...purgedState, lastPurge }))).canPurge
    ).toBe(false)
  })

  test('points the confirmation and the write at this same event', () => {
    const page = model(found(purgeable()), { from: '?status=DEAD_LETTER' })

    expect(page.purgeHref).toBe(
      `/dev-ops/events/gas/outbox/${id}?from=%3Fstatus%3DDEAD_LETTER&confirm=purge`
    )
    expect(page.purgeAction).toBe(`/dev-ops/events/gas/outbox/${id}/purge`)
  })
})

describe('the purge confirmation', () => {
  test('opens only when it is asked for and allowed', () => {
    expect(confirming().purgeConfirm).not.toBeNull()
    expect(model(found(purgeable())).purgeConfirm).toBeNull()
    expect(confirming(detail()).purgeConfirm).toBeNull()
  })

  test('says the date the row would be deleted, in UK time', () => {
    expect(confirming().purgeConfirm?.deletionText).toBe(
      '14 Sep 2026 10:00:00.000'
    )
    expect(confirming().purgeConfirm?.deletionInstant).toBe(
      '2026-09-14T09:00:00Z'
    )
  })

  test('offers the three reasons, none of them chosen', () => {
    expect(confirming().purgeConfirm?.reasons).toEqual([
      {
        value: 'BROKEN_PAYLOAD',
        label: 'Payload is broken',
        id: 'purge-reason-BROKEN_PAYLOAD',
        checked: false
      },
      {
        value: 'SENT_IN_ERROR',
        label: 'Sent in error',
        id: 'purge-reason-SENT_IN_ERROR',
        checked: false
      },
      {
        value: 'OTHER',
        label: 'Other',
        id: 'purge-reason-OTHER',
        checked: false
      }
    ])
  })

  test('starts with an empty note and a counter at nothing', () => {
    expect(confirming().purgeConfirm).toMatchObject({
      note: '',
      noteCount: '0 / 500',
      noteMax: 500,
      noteMessage: null,
      noteInvalid: false,
      error: null
    })
  })

  test('keeps the reason and the note a rejected form came back with', () => {
    const confirm = submitted('OTHER', 'a note', {
      field: 'note',
      message: 'Enter a note.'
    }).purgeConfirm

    expect(
      confirm?.reasons
        .filter(({ checked }) => checked)
        .map(({ value }) => value)
    ).toEqual(['OTHER'])
    expect(confirm?.note).toBe('a note')
    expect(confirm?.noteCount).toBe('6 / 500')
  })

  test('sends the alert at the note the server refused', () => {
    const confirm = submitted('OTHER', '', {
      field: 'note',
      message: "Enter a note. It's required when the reason is Other."
    }).purgeConfirm

    expect(confirm?.error).toEqual({
      message: "Enter a note. It's required when the reason is Other.",
      href: '#purge-note'
    })
    expect(confirm?.noteInvalid).toBe(true)
    expect(confirm?.noteMessage).toBe(
      "Enter a note. It's required when the reason is Other."
    )
  })

  test('describes the note by the hint only while the hint is shown', () => {
    expect(confirming().purgeConfirm?.noteDescribedBy).toBe('purge-note-help')
    expect(
      submitted('OTHER', '', { field: 'note', message: 'Enter a note.' })
        .purgeConfirm?.noteDescribedBy
    ).toBe('purge-note-hint purge-note-help')
  })

  test('sends the alert at the first radio when no reason was chosen', () => {
    const confirm = submitted('', '', {
      field: 'reason',
      message: 'Choose a reason.'
    }).purgeConfirm

    expect(confirm?.error).toEqual({
      message: 'Choose a reason.',
      href: '#purge-reason-BROKEN_PAYLOAD'
    })
    expect(confirm?.noteInvalid).toBe(false)
    expect(confirm?.noteMessage).toBeNull()
  })

  test('says beside the radios what is wrong with the reason', () => {
    const confirm = submitted('', '', {
      field: 'reason',
      message: 'Choose a reason.'
    }).purgeConfirm

    expect(confirm?.reasonMessage).toBe('Choose a reason.')
    expect(confirm?.reasonDescribedBy).toBe('purge-reason-hint')
  })

  test('says nothing beside the radios when the reason was fine', () => {
    expect(confirming().purgeConfirm?.reasonMessage).toBeNull()
    expect(
      submitted('OTHER', '', { field: 'note', message: 'Enter a note.' })
        .purgeConfirm?.reasonMessage
    ).toBeNull()
  })

  test('ignores a rejected form left over from another event', () => {
    const confirm = confirming(purgeable(), {
      page: '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7c',
      reasonCode: 'OTHER',
      note: 'not this one',
      error: { field: 'note', message: 'Enter a note.' }
    }).purgeConfirm

    expect(confirm?.note).toBe('')
    expect(confirm?.error).toBeNull()
  })
})

describe('the purged facts', () => {
  test('says who purged the event, why and when, with the note', () => {
    expect(
      model(found(detail({ ...purgedState, lastPurge }))).purgedFact
    ).toEqual({
      label: 'Purged',
      reason: 'Payload is broken',
      by: 'Ada Lovelace',
      at: '16 Jun 2026 11:18:00.000',
      atInstant: '2026-06-16T10:18:00Z',
      note: 'sheetId arrives as a number'
    })
  })

  test('says previously purged once the event has been redriven out of it', () => {
    expect(
      model(found(detail({ ...stateOf('RESUBMITTED'), lastPurge }))).purgedFact
        ?.label
    ).toBe('Previously purged')
  })

  test('says nothing on an event that was never purged', () => {
    expect(model().purgedFact).toBeNull()
    expect(model(found(detail({ lastPurge: null }))).purgedFact).toBeNull()
  })

  test.each([
    ['none was typed', null],
    ['it is empty', '']
  ])('leaves the note out when %s', (_name, note) => {
    expect(
      model(
        found(detail({ ...purgedState, lastPurge: { ...lastPurge, note } }))
      ).purgedFact?.note
    ).toBeNull()
  })

  test('shows a reason code it has no label for as it arrived', () => {
    expect(
      model(
        found(
          detail({
            ...purgedState,
            lastPurge: { ...lastPurge, reasonCode: 'SUPERSEDED' }
          })
        )
      ).purgedFact?.reason
    ).toBe('SUPERSEDED')
  })
})

describe('redriving a purged event', () => {
  test('keeps the redrive on a purged event, and hides the purge', () => {
    const page = model(found(purgeable({ ...purgedState, lastPurge })))

    expect(page.canRedrive).toBe(true)
    expect(page.canPurge).toBe(false)
  })

  test('names the decision the redrive would reverse', () => {
    expect(
      model(found(detail({ ...purgedState, lastPurge }))).redrivePurgedNote
    ).toBe(
      "It was purged as 'Payload is broken'; if the payload is broken, it will fail again. Its deletion date is cleared."
    )
  })

  test('says nothing of a purge on an event that is not purged now', () => {
    expect(
      model(found(detail({ ...stateOf('RESUBMITTED'), lastPurge })))
        .redrivePurgedNote
    ).toBeNull()
    expect(
      model(found(detail({ ...purgedState }))).redrivePurgedNote
    ).toBeNull()
    expect(model().redrivePurgedNote).toBeNull()
  })
})

describe('the message a purge leaves behind', () => {
  const afterPurge = (
    outcome: Parameters<typeof noticed>[0]['outcome'],
    status: string | null = null,
    event: EventDetail = detail({ ...purgedState, lastPurge })
  ) =>
    toEventPage(
      found(event),
      key,
      {},
      {
        outcome,
        status,
        action: 'purge',
        page: `/dev-ops/events/gas/outbox/${id}`
      }
    ).banner

  test('says when the database will delete the event it just purged', () => {
    expect(
      afterPurge(
        'purged',
        null,
        detail({
          ...purgedState,
          lastPurge,
          expiresAt: '2026-09-14T09:00:00.000Z'
        })
      )
    ).toEqual({
      role: 'success',
      message: 'Purged. It will be deleted on 14 Sep 2026 10:00:00.000.'
    })
  })

  test('says only that it was purged when the page could not read the date', () => {
    expect(afterPurge('purged')?.message).toBe('Purged.')
  })

  test('names the status a conflict reported', () => {
    expect(afterPurge('conflict', 'Resubmitted')).toEqual({
      role: 'warning',
      message:
        'Not purged — this event is no longer dead-lettered. Its status is now Resubmitted.'
    })
  })

  test('ends the sentence on a conflict whose body carried no status', () => {
    expect(afterPurge('conflict')?.message).toBe(
      'Not purged — this event is no longer dead-lettered.'
    )
  })

  test.each([
    [
      'not-found',
      'error',
      'Not purged — fg-gas-backend no longer has this event. Nothing has changed.'
    ],
    [
      'rejected',
      'error',
      'Not purged — fg-gas-backend refused the request. Nothing has changed.'
    ],
    ['timed-out', 'warning', 'Purge status unknown — refresh to check.'],
    [
      'unavailable',
      'error',
      'Not purged — fg-gas-backend could not be reached. Nothing has changed.'
    ]
  ] as const)('says what went wrong for a %s purge', (outcome, role, said) => {
    expect(afterPurge(outcome)).toEqual({ role, message: said })
  })

  test('reads the redrive words for a redrive and the purge words for a purge', () => {
    expect(
      noticed({ outcome: 'conflict', status: 'Completed' }).banner?.message
    ).toContain("can't be redriven")
    expect(afterPurge('conflict', 'Completed')?.message).toContain(
      'no longer dead-lettered'
    )
  })

  test('has no banner for an action a later release invented', () => {
    expect(
      noticed({
        outcome: 'purged',
        status: null,
        action: 'park'
      } as unknown as Parameters<typeof noticed>[0]).banner
    ).toBeNull()
  })
})

// The detail's two attempts ran at 10:08 and 10:16:05.
const lastEdit = {
  at: '2026-06-16T10:18:00.000Z',
  by: 'Grace Hopper',
  note: 'sheetId arrives as a number'
}

const editedBeforeAttempts = { ...lastEdit, at: '2026-06-16T10:12:00.000Z' }

const redrivenAfterEdit = { at: '2026-06-16T10:19:00.000Z', by: 'Ada Lovelace' }

describe('an edited payload', () => {
  test('says who edited the payload and when, with the note', () => {
    expect(model(found(detail({ lastEdit }))).editedFact).toEqual({
      by: 'Grace Hopper',
      at: '16 Jun 2026 11:18:00.000',
      atInstant: '2026-06-16T10:18:00Z',
      note: 'sheetId arrives as a number'
    })
  })

  test('says the edit in GMT once the clocks have gone back', () => {
    expect(
      model(
        found(detail({ lastEdit: { ...lastEdit, at: '2026-12-01T14:08:00Z' } }))
      ).editedFact?.at
    ).toBe('1 Dec 2026 14:08:00.000')
  })

  test.each([
    ['none was sent', null],
    ['it is empty', '']
  ])('leaves the note out when %s', (_name, note) => {
    expect(
      model(found(detail({ lastEdit: { ...lastEdit, note } }))).editedFact?.note
    ).toBeNull()
  })

  test.each([
    ['absent', {}],
    ['null', { lastEdit: null }]
  ])('says nothing of an edit when the field is %s', (_name, overrides) => {
    const page = model(found(detail(overrides)))

    expect(page.editedFact).toBeNull()
    expect(page.noAttemptsSinceEdit).toBe(false)
    expect(page.redriveEditedNote).toBeNull()
  })

  test('marks an edit nobody has redriven since', () => {
    const page = model(found(detail({ lastEdit, lastRedrive: null })))

    expect(page.noAttemptsSinceEdit).toBe(true)
    expect(page.redriveEditedNote).toBe(
      "The payload was edited on 16 Jun 2026 11:18:00.000 and hasn't been retried since."
    )
  })

  test('marks an edit made after the last redrive', () => {
    const page = model(found(detail({ lastEdit, lastRedrive })))

    expect(page.redriveEditedNote).not.toBeNull()
  })

  test('keeps the broken-payload warning off a purged event while its edit is untried', () => {
    const purged = { ...purgedState, lastPurge, lastEdit }

    expect(
      model(found(detail({ ...purged, lastRedrive: null }))).redrivePurgedNote
    ).toBe(
      "It was purged as 'Payload is broken'. Its deletion date is cleared."
    )
    expect(
      model(found(detail({ ...purged, lastRedrive: redrivenAfterEdit })))
        .redrivePurgedNote
    ).toBe(
      "It was purged as 'Payload is broken'; if the payload is broken, it will fail again. Its deletion date is cleared."
    )
  })

  test('drops the mark once the edit has been redriven', () => {
    const page = model(
      found(detail({ lastEdit, lastRedrive: redrivenAfterEdit }))
    )

    expect(page.noAttemptsSinceEdit).toBe(false)
    expect(page.redriveEditedNote).toBeNull()
    expect(page.editedFact?.by).toBe('Grace Hopper')
  })

  test('reads a redrive with no instant as older than the edit', () => {
    expect(
      model(found(detail({ lastEdit, lastRedrive: { at: null, by: 'Ada' } })))
        .redriveEditedNote
    ).not.toBeNull()
  })

  test('dashes an undated edit, and marks it only while nothing is known to be newer', () => {
    const undated = { ...lastEdit, at: null }

    expect(model(found(detail({ lastEdit: undated }))).editedFact).toEqual({
      by: 'Grace Hopper',
      at: '—',
      atInstant: null,
      note: 'sheetId arrives as a number'
    })
    expect(
      model(found(detail({ lastEdit: undated, lastRedrive }))).redriveEditedNote
    ).toBeNull()
  })

  test('says attempts have run since an edit that came before them', () => {
    expect(
      model(found(detail({ lastEdit: editedBeforeAttempts })))
        .noAttemptsSinceEdit
    ).toBe(false)
  })

  test('keeps the futile warning off while nothing has run on the edit', () => {
    expect(
      model(
        found(
          detail({ attemptHistory: identicalAttempts, lastRedrive, lastEdit })
        )
      ).futileWarning
    ).toBeNull()
  })

  test('warns again once attempts on the edited payload fail the same way', () => {
    expect(
      model(
        found(
          detail({
            attemptHistory: identicalAttempts,
            lastRedrive,
            lastEdit: { ...lastEdit, at: '2026-06-16T10:05:00.000Z' }
          })
        )
      ).futileWarning
    ).not.toBeNull()
  })

  test('prints the payload before the first edit as the payload is printed', () => {
    expect(
      model(found(detail({ originalPayload: { sheetId: 12345 } })))
        .originalPayloadJson
    ).toBe('{\n  "sheetId": 12345\n}')
  })

  test.each([
    ['absent', {}],
    ['null', { originalPayload: null }]
  ])('keeps no original when the field is %s', (_name, overrides) => {
    expect(model(found(detail(overrides))).originalPayloadJson).toBeNull()
  })
})
