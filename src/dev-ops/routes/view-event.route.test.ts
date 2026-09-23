import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'

vi.mock(import('../use-cases/get-event.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const traceId = '4bf92f3577b34da6a3ce929d0e0e4736'
const logsBase = 'https://logs.dev.cdp-int.defra.cloud'

const givenLogsExplorer = (base: string = logsBase) => {
  config.set('logs.explorerBaseUrl', base)
}

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`
const inboxPath = `/dev-ops/events/gas/inbox/${id}`

const detail = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  targetTopic: 'gas__sns__update_case_status_fifo',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-06-16T10:00:00.000Z',
  lastError: {
    name: 'MongoServerError',
    message: 'E11000 duplicate key error collection: gas.events index: id_1',
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
  payload: { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2', stage: 'assess' } },
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
    traceId,
    ...overrides
  })

const givenEvent = (event: EventDetail = detail()) =>
  vi.mocked(getEventUseCase).mockResolvedValue({ outcome: 'found', event })

const givenOutcome = (outcome: 'not-found' | 'timed-out' | 'unavailable') =>
  vi.mocked(getEventUseCase).mockResolvedValue({ outcome, event: null })

const xss = '<script>alert(1)</script>'

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const viewPage = async (url = path) => {
  const { result, statusCode } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode }
}

const valueOf = ($: CheerioAPI, testId: string) =>
  flatten($(`[data-testid="${testId}"]`).text())

const labelsOf = ($: CheerioAPI) =>
  $('[data-testid="event-facts"] dt')
    .toArray()
    .map((label) => flatten($(label).text()))

let server: Server

const now = new Date('2026-06-16T10:20:00.000Z')

const identicalAttempts = [
  {
    at: '2026-06-16T10:08:00.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key',
    stack: null
  },
  {
    at: '2026-06-16T10:16:05.000Z',
    name: 'MongoServerError',
    message: 'E11000 duplicate key',
    stack: null
  }
]

const lastRedrive = { at: '2026-06-16T10:10:00.000Z', by: 'Ada Lovelace' }

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenEvent()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('viewEventRoute', () => {
  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'GET',
      url: path
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: path,
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
  })

  test('renders the page for the operations admin role', async () => {
    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="event-header"]')).toHaveLength(1)
  })

  test('asks the use case for the event at this address', async () => {
    await viewPage()

    expect(getEventUseCase).toHaveBeenCalledTimes(1)
    expect(getEventUseCase).toHaveBeenCalledWith({
      service: 'gas',
      box: 'outbox',
      id
    })
  })

  test.each([
    ['a service it does not know', `/dev-ops/events/other/outbox/${id}`],
    ['a box it does not know', `/dev-ops/events/gas/sideways/${id}`],
    ['an id that is not an object id', '/dev-ops/events/gas/outbox/nope'],
    ['an id of the wrong length', `/dev-ops/events/gas/outbox/${id}00`],
    ['an id carrying markup', '/dev-ops/events/gas/outbox/%3Cscript%3E']
  ])('refuses %s', async (_name, url) => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(getEventUseCase).not.toHaveBeenCalled()
  })

  test('accepts a caseworking inbox address', async () => {
    const { statusCode } = await viewPage(
      `/dev-ops/events/caseworking/inbox/${id}`
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(getEventUseCase).toHaveBeenCalledWith({
      service: 'caseworking',
      box: 'inbox',
      id
    })
  })

  test('titles the tab with the event name and the ends of its id', async () => {
    const { $ } = await viewPage()

    expect($('title').text()).toContain('CaseStatusUpdated 3f2c1a0e…6666 |')
  })

  test('writes no UTC label anywhere on the page', async () => {
    const { $ } = await viewPage()

    expect($('main').html()).not.toContain('UTC')
  })

  test('writes none on the confirm panels either', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('main').html()).not.toContain('UTC')
  })

  test('heads the page with the event name, the status straight under it', async () => {
    const { $ } = await viewPage()

    const title = $('[data-testid="event-title"]')

    expect(title.is('h1')).toBe(true)
    expect(title.attr('class')).toContain('text-xl')
    expect(title.attr('class')).not.toContain('font-mono')
    expect(title.find('[data-testid="event-type-name"]').text()).toBe(
      'CaseStatusUpdated'
    )
    expect(title.attr('title')).toBe('case.status.updated')
    expect(title.next().attr('data-testid')).toBe('event-id')
  })

  test('speaks the name spaced, and shows it in PascalCase', async () => {
    const { $ } = await viewPage()

    const title = $('[data-testid="event-title"]')

    expect(
      title.find('[data-testid="event-type-name"]').attr('aria-hidden')
    ).toBe('true')
    expect(title.find('[data-testid="event-type-spoken"]').text()).toBe(
      'Case status updated'
    )
    expect(
      title.find('[data-testid="event-type-spoken"]').hasClass('sr-only')
    ).toBe(true)
  })

  test('draws no summary line under the heading', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-failure"]')).toHaveLength(0)
    expect($('[data-testid="event-header"]').text()).not.toContain('attempts')
    expect(flatten($('[data-testid="event-header-status"]').text())).toBe(
      'Dead letter'
    )
  })

  test('heads an audit record with its name, and keeps its id', async () => {
    givenEvent(detail({ type: 'audit' }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-type-name"]').text()).toBe('AuditRecord')
    expect($('[data-testid="event-title"]').attr('title')).toBe('audit')
    expect($('[data-testid="event-id"]').text()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
    expect($('[data-testid="event-header"]').text()).not.toContain('n/a')
  })

  test('heads an event with no type at all by its id', async () => {
    givenEvent(detail({ type: '' }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-title"]').text()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
  })

  test('names the unknown label like any other type', async () => {
    givenEvent(detail({ type: 'unknown' }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-type-name"]').text()).toBe('NoTypeRecorded')
    expect($('[data-testid="event-title"]').attr('title')).toBe('unknown')
  })

  test('says the status as a solid badge in the header, never a soft one', async () => {
    const { $ } = await viewPage()

    const badge = $(
      '[data-testid="event-header-status"] [data-testid="do-status-badge"]'
    )

    expect(badge).toHaveLength(1)
    expect(badge.attr('class')).toBe('badge badge-error')
    expect(badge.attr('title')).toBe('DEAD_LETTER')
    expect(badge.find('[data-testid="do-status-label"]').text()).toBe(
      'Dead letter'
    )
    expect(badge.find('[data-testid="do-status-dot"]')).toHaveLength(0)
    expect($('main').html()).not.toContain('badge-soft')
  })

  test('shows the whole event id under the name, as plain selectable text', async () => {
    const { $ } = await viewPage()

    const line = $('[data-testid="event-id"]')

    expect(line.text()).toBe('3f2c1a0e-1111-2222-3333-444455556666')
    expect(line.is('p')).toBe(true)
    expect(line.attr('class')).toContain('select-all')
    expect(line.attr('class')).toContain('break-all')
    expect(line.prev().attr('data-testid')).toBe('event-title')
  })

  test('prints the event id once at the top of the page', async () => {
    const { $ } = await viewPage()

    const top =
      $('[data-testid="event-back-nav"]').text() +
      $('[data-testid="event-header"]').text()
    const id = '3f2c1a0e-1111-2222-3333-444455556666'

    expect(top.split(id)).toHaveLength(2)
  })

  test('says the service, the box and the topic, as the list says them', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-service')).toBe('GAS')
    expect(valueOf($, 'event-box')).toBe('Outbox')
    expect(valueOf($, 'event-queue-value')).toBe(
      'gas__sns__update_case_status_fifo'
    )
    expect($('[data-testid="event-fact-transport"] dt').text()).toBe('Topic')
  })

  test('says a caseworking row as CW-BE', async () => {
    givenEvent(inboxDetail({ service: 'caseworking' }))

    const { $ } = await viewPage(inboxPath)

    expect(valueOf($, 'event-service')).toBe('CW-BE')
    expect(valueOf($, 'event-box')).toBe('Inbox')
  })

  test('draws the service and the box as plain text, linking nowhere', async () => {
    const { $ } = await viewPage()

    for (const testId of ['event-service', 'event-box']) {
      const value = $(`[data-testid="${testId}"]`)

      expect(value.is('a')).toBe(false)
      expect(value.find('a')).toHaveLength(0)
    }
  })

  test('draws no transport fact where the row has none', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    expect($('[data-testid="event-fact-transport"]')).toHaveLength(0)
  })

  test('links the segregation ref at every event about the same thing', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    const ref = $('[data-testid="event-segregation-ref"]')

    expect(ref.is('a')).toBe(true)
    expect(ref.attr('href')).toBe('/dev-ops/events?q=GLD-9B2-BWS-grasslands')
    expect(ref.text()).toBe('GLD-9B2-BWS-grasslands')
  })

  test('draws no Message id row, the heading already carrying that id', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    expect($('[data-testid="event-fact-message-id"]')).toHaveLength(0)
    expect($('[data-testid="event-message-id"]')).toHaveLength(0)
    expect($('[data-testid="event-id"]').text()).toBe(
      '3f2c1a0e-1111-2222-3333-444455556666'
    )
  })

  test('shows the trace id in mono, as the explorer link itself', async () => {
    givenLogsExplorer()
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    const trace = $('a[data-testid="event-trace-id"]')

    expect(trace.contents().first().text()).toBe(traceId)
    expect(trace.attr('class')).toContain('font-mono')
    expect(trace.attr('href')).toContain(logsBase)
    expect(trace.attr('href')).toContain(traceId)
    expect(trace.attr('target')).toBe('_blank')
    expect(trace.attr('rel')).toBe('noopener noreferrer')
    expect(trace.find('.sr-only').text()).toBe(' (opens in a new tab)')
    expect($('[data-testid="event-trace-link"]')).toHaveLength(0)
  })

  test('draws no explorer link when the event carries no trace', async () => {
    givenLogsExplorer()
    givenEvent(inboxDetail({ traceId: null }))

    const { $ } = await viewPage(inboxPath)

    expect($('a[data-testid="event-trace-id"]')).toHaveLength(0)
    expect($('[data-testid="event-trace-id-none"]').text()).toBe('—')
  })

  test('links an outbox row trace id at the explorer too', async () => {
    givenLogsExplorer()
    givenEvent(detail({ traceId }))

    const { $ } = await viewPage()

    const trace = $('a[data-testid="event-trace-id"]')

    expect(trace.contents().first().text()).toBe(traceId)
    expect(trace.attr('href')).toContain(traceId)
  })

  test('draws a dash for an outbox row that carries no trace', async () => {
    givenLogsExplorer()
    givenEvent(detail())

    const { $ } = await viewPage()

    expect($('a[data-testid="event-trace-id"]')).toHaveLength(0)
    expect($('[data-testid="event-trace-id-none"]').text()).toBe('—')
  })

  test('draws the inbox facts, common ones first', async () => {
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    expect(labelsOf($)).toEqual([
      'Service',
      'Queue',
      'Trace ID',
      'Segregation ref'
    ])
    expect(
      $('[data-testid="event-facts-box"] dt')
        .toArray()
        .map((label) => flatten($(label).text()))
    ).toEqual(['Segregation ref'])
  })

  test('keeps the left column first when there is a last redrive', async () => {
    givenEvent(
      detail({
        lastRedrive: { at: '2026-06-16T10:15:00.000Z', by: 'Ada Lovelace' }
      })
    )

    const { $ } = await viewPage()

    expect(labelsOf($)).toEqual([
      'Service',
      'Queue',
      'Trace ID',
      'Last redrive',
      'Segregation ref',
      'Topic'
    ])
  })

  test('draws the outbox facts, the segregation ref then the topic on the right', async () => {
    const { $ } = await viewPage()

    expect(labelsOf($)).toEqual([
      'Service',
      'Queue',
      'Trace ID',
      'Segregation ref',
      'Topic'
    ])
    expect(
      $('[data-testid="event-facts-box"] dt')
        .toArray()
        .map((label) => flatten($(label).text()))
    ).toEqual(['Segregation ref', 'Topic'])
    expect($('[data-testid="event-payload"]')).toHaveLength(1)
  })

  test('links an outbox segregation ref at every event that shares it', async () => {
    givenEvent(detail({ segregationRef: 'GLD-9B2-BWS-grasslands' }))

    const { $ } = await viewPage()

    const ref = $('[data-testid="event-segregation-ref"]')

    expect(ref.is('a')).toBe(true)
    expect(ref.attr('href')).toBe('/dev-ops/events?q=GLD-9B2-BWS-grasslands')
    expect(ref.attr('title')).toBe(
      'GLD-9B2-BWS-grasslands\nShow every event with this segregation ref'
    )
  })

  test('draws a dash for an outbox row with no segregation ref', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-segregation-ref-none"]').text()).toBe('—')
  })

  test('draws a dash for an outbox row with no topic', async () => {
    givenEvent(detail({ targetTopic: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-queue-value-none"]').text()).toBe('—')
  })

  test('measures an outbox attempt from the moment it was queued', async () => {
    givenEvent(
      detail({
        createdAt: '2026-06-16T10:00:00.000Z',
        attemptHistory: [
          {
            at: '2026-06-16T10:00:45.000Z',
            name: 'MongoServerError',
            message: 'boom',
            stack: null
          }
        ]
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempt-delta')).toBe('after 45.0s')
  })

  test.each([
    ['an inbox row', inboxPath, inboxDetail],
    ['an outbox row', path, detail]
  ])(
    'centres the trace window on when %s was created',
    async (_name, url, build) => {
      givenLogsExplorer()
      givenEvent(build({ createdAt: '2026-06-16T10:00:00.000Z', traceId }))

      const { $ } = await viewPage(url)

      expect($('a[data-testid="event-trace-id"]').attr('href')).toContain(
        "from:'2026-06-16T04:00:00.000Z'"
      )
    }
  )

  test('states every timestamp absolutely, never how long ago', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        completionDate: '2026-06-16T10:17:00.000Z',
        lastResubmissionDate: '2026-06-16T10:16:30.000Z',
        lastRedrive: { at: '2026-06-16T10:15:00.000Z', by: 'Ada Lovelace' }
      })
    )

    const { $ } = await viewPage()

    const rows = [
      'event-fact-last-redrive',
      'event-attempt-when',
      'event-attempt-success-when'
    ]

    rows.forEach((testId) => {
      expect(valueOf($, testId)).not.toContain('ago')
    })
  })

  test('states every timestamp as text, behind no button', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        completionDate: '2026-06-16T10:17:00.000Z',
        lastRedrive: { at: '2026-06-16T10:15:00.000Z', by: 'Ada Lovelace' }
      })
    )

    const { $ } = await viewPage()

    const stated = (testId: string) =>
      flatten($(`[data-testid="${testId}"]`).text())

    expect(stated('event-last-redrive-at')).toBe('16 Jun 2026 11:15:00.000')
    expect($('[data-testid="event-facts"] button')).toHaveLength(0)
  })

  test('draws a dash for a segregation ref the event has not got', async () => {
    givenEvent(inboxDetail({ segregationRef: null }))

    const { $ } = await viewPage(inboxPath)

    expect($('[data-testid="event-segregation-ref-none"]').text()).toBe('—')
    expect($('[data-testid="event-segregation-ref"]')).toHaveLength(0)
  })

  test('prints the payload as pretty json, a line at a time', async () => {
    const { $ } = await viewPage()

    const payload = $('[data-testid="event-payload"]')
    const json = JSON.stringify(
      { id: '3f2c1a0e', data: { caseRef: 'GLD-9B2', stage: 'assess' } },
      null,
      2
    )

    expect(payload.attr('class')).not.toContain('mockup-code')
    expect(payload.attr('class')).toContain('border border-base-300')
    expect(payload.attr('class')).toContain('max-h-[30rem]')
    expect(payload.attr('class')).toContain('overflow-auto')
    expect(payload.find('pre > code')).toHaveLength(json.split('\n').length)
    expect(
      payload
        .find('code')
        .toArray()
        .map((line) => $(line).text())
        .join('\n')
    ).toBe(json)

    const gutter = payload.find('[data-testid="event-payload-line"] > span')
    const numbers = gutter.toArray().map((line) => $(line).attr('data-line'))

    expect(numbers.slice(0, 3)).toEqual(['1', '2', '3'])
    expect(numbers).toHaveLength(json.split('\n').length)
    expect(gutter.first().text()).toBe('')
    expect(gutter.first().attr('class')).toContain(
      'before:content-[attr(data-line)]'
    )
    expect(gutter.first().attr('aria-hidden')).toBe('true')
  })

  test('makes the payload a named region a keyboard can reach', async () => {
    const { $ } = await viewPage()

    const payload = $('[data-testid="event-payload"]')

    expect(payload.attr('tabindex')).toBe('0')
    expect(payload.attr('role')).toBe('region')
    expect(payload.attr('aria-label')).toBe('Payload')
    expect(payload.attr('class')).toContain('focus-visible:outline-2')
  })

  test('sets the facts as two lists side by side on a wide screen', async () => {
    const { $ } = await viewPage()

    const facts = $('[data-testid="event-facts"]')

    expect(facts.attr('class')).toContain('lg:grid-cols-2')
    expect($('[data-testid="event-facts-common"]').is('dl')).toBe(true)
    expect($('[data-testid="event-facts-box"]').is('dl')).toBe(true)
    expect($('[data-testid="event-facts-common"]').attr('class')).toContain(
      'sm:grid-cols-[8rem_minmax(0,1fr)]'
    )

    const pair = $('[data-testid="event-fact-route"]')

    expect(pair.attr('class')).toBe('contents')
    expect(pair.children('dt')).toHaveLength(1)
    expect(pair.children('dd')).toHaveLength(1)
  })

  test('heads the box fact with the word both surfaces use', async () => {
    const { $ } = await viewPage()

    const pair = $('[data-testid="event-fact-route"]')

    expect(pair.children('dt').text()).toBe('Queue')
    expect(pair.text()).not.toContain('Route')
    expect(
      $('main dt, main th')
        .toArray()
        .map((label) => $(label).text().trim())
    ).not.toContain('Source')
    expect(flatten(pair.find('[data-testid="event-box"]').text())).toBe(
      'Outbox'
    )
  })

  test('offers the payload as selectable text, behind no button', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-payload-card"] button')).toHaveLength(0)
    expect(flatten($('[data-testid="event-payload"]').text())).toContain(
      '"caseRef": "GLD-9B2"'
    )
  })

  test('renders a payload carrying a script tag as text', async () => {
    givenEvent(detail({ payload: { note: xss } }))

    const { $ } = await viewPage()

    const payload = $('[data-testid="event-payload"]')

    expect(payload.find('script')).toHaveLength(0)
    expect(payload.text()).toContain(xss)
    expect($('script')).toHaveLength(1)
  })

  test('renders a payload key carrying markup as text', async () => {
    givenEvent(detail({ payload: { [xss]: 'value' } }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-payload"]').find('script')).toHaveLength(0)
    expect($('script')).toHaveLength(1)
  })

  test('says so when the event carries no payload at all', async () => {
    givenEvent(detail({ payload: undefined }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-payload"]')).toHaveLength(0)
    expect($('[data-testid="event-payload-empty"]').text()).toContain(
      'no payload'
    )
  })

  test('links back to the plain list when the page was opened cold', async () => {
    const { $ } = await viewPage()

    const back = $('[data-testid="event-back"]')

    expect(back.attr('href')).toBe('/dev-ops/events')
    expect(back.text().trim()).toBe('Back to events')

    const nav = $('[data-testid="event-back-nav"]')

    expect(nav.is('nav')).toBe(true)
    expect(nav.attr('aria-label')).toBe('Events list')
    expect(back.closest('do-back')).toHaveLength(1)
    expect($('[data-testid="event-breadcrumb-id"]')).toHaveLength(0)
  })

  test('puts the operator back on the list they left', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=DEAD_LETTER&cursor=END')}`
    )

    expect($('[data-testid="event-back"]').attr('href')).toBe(
      '/dev-ops/events?status=DEAD_LETTER&cursor=END'
    )
  })

  test.each([
    ['an absolute url', 'https://example.com/phish'],
    ['a protocol-relative url', '//example.com/phish'],
    ['a path that is not a query', '/dev-ops/events?status=FAILED'],
    ['a query hiding a protocol-relative url', '?a=b//example.com'],
    ['an empty value', '']
  ])('drops %s from the back link', async (_name, from) => {
    const { statusCode, $ } = await viewPage(
      `${path}?from=${encodeURIComponent(from)}`
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="event-back"]').attr('href')).toBe('/dev-ops/events')
  })

  test('offers a redrive on the payload card of a dead-lettered event', async () => {
    const { $ } = await viewPage()

    const button = $('[data-testid="event-redrive"]')

    expect(button.is('a')).toBe(true)
    expect(button.attr('href')).toBe(`${path}?confirm=redrive#payload`)
    expect(button.hasClass('btn-error')).toBe(true)
    expect(button.hasClass('btn-outline')).toBe(false)
    expect(button.text().trim()).toBe('Redrive')
    expect(button.closest('[data-testid="event-payload-card"]')).toHaveLength(1)
    expect($('[data-testid="event-edit"]')).toHaveLength(0)
    expect($('[data-testid="event-actions"]')).toHaveLength(0)
  })

  test.each(['PUBLISHED', 'PROCESSING', 'FAILED', 'RESUBMITTED', 'COMPLETED'])(
    'offers no redrive on a %s event',
    async (status) => {
      givenEvent(detail({ status }))

      const { $ } = await viewPage()

      expect($('[data-testid="event-redrive"]')).toHaveLength(0)
      expect($('[data-testid="event-redrive-confirm"]')).toHaveLength(0)
    }
  )

  test('ignores a confirmation asked for on an event that cannot be redriven', async () => {
    givenEvent(detail({ status: 'COMPLETED', attempts: '2/5' }))

    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('[data-testid="event-redrive-confirm"]')).toHaveLength(0)
    expect($('[data-testid="event-redrive-form"]')).toHaveLength(0)
  })

  test('asks before it writes, and says what the write does', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect(valueOf($, 'event-redrive-heading')).toBe('Redrive this event?')
    expect(valueOf($, 'event-redrive-question')).toBe(
      'The poller will retry it up to its attempt limit. This action is audited.'
    )
    expect(valueOf($, 'event-redrive-question')).not.toMatch(/\d/)
    expect(valueOf($, 'event-redrive-submit')).toBe('Confirm redrive')
    expect($('[data-testid="event-redrive"]')).toHaveLength(0)
    expect(
      $('[data-testid="event-redrive-confirm"]').closest(
        '[data-testid="event-payload-card"]'
      )
    ).toHaveLength(1)
  })

  test('points focus at the question, and describes the panel by its sentence', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    const heading = $('[data-testid="event-redrive-heading"]')
    const panel = $('[data-testid="event-redrive-confirm"]')

    expect(heading.attr('tabindex')).toBe('-1')
    expect(heading.attr('data-focus-on-arrival')).toBeDefined()
    expect(heading.attr('class')).toContain('focus:outline-none')
    expect(panel.attr('aria-labelledby')).toBe('redrive-question')
    expect(panel.attr('aria-describedby')).toBe('redrive-explain')
    expect(heading.attr('id')).toBe('redrive-question')
    expect($('[data-testid="event-redrive-question"]').attr('id')).toBe(
      'redrive-explain'
    )
  })

  test('ties the futile warning to the question and the confirm button', async () => {
    givenEvent(detail({ attemptHistory: identicalAttempts, lastRedrive }))

    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect(
      $('[data-testid="event-redrive-confirm"]').attr('aria-describedby')
    ).toBe('redrive-futile redrive-explain')
    expect(
      $('[data-testid="event-redrive-submit"]').attr('aria-describedby')
    ).toBe('redrive-futile')
    expect(
      $(
        '[data-testid="event-redrive-confirm"] [data-testid="event-futile-warning"]'
      )
    ).toHaveLength(1)
    expect($('[data-testid="event-futile-warning"]')).toHaveLength(1)
  })

  test('posts the confirmation at the redrive route', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    const form = $('[data-testid="event-redrive-form"]')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(`${path}/redrive`)
    expect($('[data-testid="event-redrive-submit"]').attr('type')).toBe(
      'submit'
    )
  })

  test('carries the list query through the confirmation', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=DEAD_LETTER')}&confirm=redrive`
    )

    const hidden = $('[data-testid="event-redrive-from"]')

    expect(hidden.attr('name')).toBe('from')
    expect(hidden.attr('value')).toBe('?status=DEAD_LETTER')
    expect($('[data-testid="event-redrive-cancel"]').attr('href')).toBe(
      `${path}?from=%3Fstatus%3DDEAD_LETTER#redrive`
    )
  })

  test('cancels back to the page without the confirmation on it', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('[data-testid="event-redrive-cancel"]').attr('href')).toBe(
      `${path}#redrive`
    )
  })

  test('carries a hostile from no further than the form', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('//example.com')}&confirm=redrive`
    )

    expect($('[data-testid="event-redrive-from"]').attr('value')).toBe('')
  })

  test('carries the area name in the header, as every page does', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="do-brand-suffix"]').text().trim()).toBe('· Events')
  })

  test('shows no banner on a page nothing redirected to', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-banner"]')).toHaveLength(0)
  })

  // The banner is a session flash, so nothing in a url can put words in it.
  test('refuses a query parameter claiming a redrive outcome', async () => {
    const { statusCode } = await viewPage(
      `${path}?redrive_conflict=${encodeURIComponent(xss)}`
    )

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('renders a small page for an event that does not exist', async () => {
    givenOutcome('not-found')

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="event-not-found"]').text()).toBe('Event not found')
    expect($('[data-testid="do-brand-suffix"]').text().trim()).toBe('· Events')
    expect($('[data-testid="event-back"]').attr('href')).toBe('/dev-ops/events')
    expect($('[data-testid="event-payload-card"]')).toHaveLength(0)
  })

  test('keeps the list query on the way back from a page that is not there', async () => {
    givenOutcome('not-found')

    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=FAILED')}`
    )

    expect($('[data-testid="event-back"]').attr('href')).toBe(
      '/dev-ops/events?status=FAILED'
    )
  })

  test('drops a hostile from on the page that is not there either', async () => {
    givenOutcome('not-found')

    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('https://example.com')}`
    )

    expect($('[data-testid="event-back"]').attr('href')).toBe('/dev-ops/events')
  })

  test('shows an error alert when the event could not be read', async () => {
    givenOutcome('unavailable')

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect($('[data-testid="event-error"]')).toHaveLength(1)
    expect($('[data-testid="event-back"]')).toHaveLength(1)
    expect($('[data-testid="event-facts-card"]')).toHaveLength(0)
    expect($('[data-testid="event-payload-card"]')).toHaveLength(0)
    expect($('.govuk-heading-xl')).toHaveLength(0)
  })

  test('says the event read timed out', async () => {
    givenOutcome('timed-out')

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(flatten($('[data-testid="event-error"]').text())).toBe(
      'This event could not be loaded: GAS timed out waiting for it. Refresh to try again.'
    )
    expect($('[data-testid="event-facts-card"]')).toHaveLength(0)
  })

  test('names the row from the address when the event could not be read', async () => {
    givenOutcome('unavailable')

    const { $ } = await viewPage()

    const line = $('[data-testid="event-id"]')

    expect(line.text()).toBe(id)
    expect(line.is('p')).toBe(true)
    expect($('h1')).toHaveLength(1)
    expect(valueOf($, 'event-title')).toBe('Event')
    // A role="alert" should speak its sentence, not read out a uuid.
    expect($('[data-testid="event-error"]').text()).not.toContain(id)
  })

  test.each([
    ['a type', { type: xss }],
    ['a trace id', { traceId: xss }],
    ['a segregation ref', { segregationRef: xss }],
    ['a status label', { statusLabel: xss }],
    [
      'a failure reason',
      {
        attemptHistory: [],
        lastError: { name: xss, message: xss, at: null }
      }
    ]
  ])('renders %s carrying markup as text', async (_name, overrides) => {
    givenEvent(inboxDetail(overrides as Partial<EventDetail>))

    const { $ } = await viewPage(inboxPath)

    expect($('main script')).toHaveLength(0)
    expect($('script')).toHaveLength(1)
    expect($('main').text()).toContain(xss)
  })

  test('renders an outbox target topic carrying markup as text', async () => {
    givenEvent(detail({ targetTopic: xss }))

    const { $ } = await viewPage()

    expect($('main script')).toHaveLength(0)
    expect(valueOf($, 'event-queue-value')).toBe(xss)
  })

  test('renders a raw status carrying markup as an attribute and nothing else', async () => {
    givenEvent(detail({ status: xss }))

    const { $ } = await viewPage()

    expect($('main script')).toHaveLength(0)
    expect($('script')).toHaveLength(1)
    expect(
      $(
        '[data-testid="event-header-status"] [data-testid="do-status-badge"]'
      ).attr('title')
    ).toBe(xss)
  })

  test('never renders a script the endpoint sent, anywhere on the page', async () => {
    givenEvent(
      inboxDetail({
        type: xss,
        segregationRef: xss,
        payload: { [xss]: xss }
      })
    )

    const { $ } = await viewPage()

    expect($('script')).toHaveLength(1)
    expect($('main [onclick]')).toHaveLength(0)
    expect($('main script')).toHaveLength(0)
  })

  test('lists every attempt between the facts and the payload', async () => {
    const { $ } = await viewPage()

    const order = $('main section[data-testid], main div[data-testid]')
      .toArray()
      .map((node) => $(node).attr('data-testid'))
      .filter((id) =>
        [
          'event-facts-card',
          'event-attempts-card',
          'event-payload-card',
          'event-journey-card'
        ].includes(id ?? '')
      )

    expect(order).toEqual([
      'event-facts-card',
      'event-attempts-card',
      'event-payload-card'
    ])
  })

  test('heads the attempts with the count the endpoint reported', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts-heading')).toBe('Attempts 5 of 5')
    expect(valueOf($, 'event-attempts-value')).toBe('5 of 5')
  })

  test('heads the attempts with no count where the endpoint sent none', async () => {
    givenEvent(detail({ attempts: '-' }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts-heading')).toBe('Attempts')
    expect($('[data-testid="event-attempts-value"]')).toHaveLength(0)
  })

  test.each([
    ['omitted', undefined],
    ['a number', 5],
    ['a string with no count in it', 'unknown']
  ])(
    'draws the page with no count when attempts is %s',
    async (_name, attempts) => {
      givenEvent(detail({ attempts: attempts as unknown as string }))

      const { statusCode, $ } = await viewPage()

      expect(statusCode).toBe(statusCodes.ok)
      expect(valueOf($, 'event-attempts-heading')).toBe('Attempts')
      expect($('[data-testid="event-attempts-value"]')).toHaveLength(0)
      expect($('[data-testid="event-attempt"]')).toHaveLength(2)
      expect($('[data-testid="event-payload"]')).toHaveLength(1)
    }
  )

  test('says a resubmission that came after the last attempt', async () => {
    givenEvent(detail({ lastResubmissionDate: '2026-06-16T10:20:00.000Z' }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-resubmitted')).toBe(
      'Last resubmitted 16 Jun 2026 11:20:00.000 — nothing recorded since.'
    )
    const at = $('[data-testid="event-resubmitted-at"]')

    expect(at.attr('datetime')).toBe('2026-06-16T10:20:00Z')
    expect(at.attr('title')).toBeUndefined()
  })

  test('says nothing of a resubmission an attempt followed', async () => {
    givenEvent(detail({ lastResubmissionDate: '2026-06-16T10:10:00.000Z' }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-resubmitted"]')).toHaveLength(0)
  })

  test('carries the resubmission on the no-history entry', async () => {
    givenEvent(
      detail({
        attemptHistory: [],
        lastResubmissionDate: '2026-06-16T10:16:30.000Z'
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts-empty')).toBe(
      'No attempt details recorded (event predates attempt history). Last resubmitted 16 Jun 2026 11:16:30.000.'
    )
    const at = $('[data-testid="event-predated-resubmitted-at"]')

    expect(at.attr('datetime')).toBe('2026-06-16T10:16:30Z')
    expect(at.attr('title')).toBeUndefined()
  })

  test('says no resubmission under a completed event', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        attempts: '0/5',
        attemptHistory: [],
        lastError: null,
        completionDate: '2026-06-16T10:17:00.000Z',
        lastResubmissionDate: '2026-06-16T10:16:30.000Z'
      })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-attempt-success"]')).toHaveLength(1)
    expect($('[data-testid="event-resubmitted"]')).toHaveLength(0)
  })

  const redriven = (overrides: Partial<EventDetail> = {}) =>
    detail({
      status: 'RESUBMITTED',
      statusLabel: 'Resubmitted',
      statusRole: 'info',
      attempts: '0/5',
      attemptHistory: [],
      lastResubmissionDate: '2026-06-16T10:16:30.000Z',
      lastRedrive: { at: '2026-06-16T11:00:00.000Z', by: 'Ada Lovelace' },
      ...overrides
    })

  test('says a freshly redriven event has had no attempts since', async () => {
    givenEvent(redriven())

    const { $ } = await viewPage()

    expect(flatten(valueOf($, 'event-redriven-label'))).toBe(
      'Redriven 16 Jun 2026 12:00:00.000 by Ada Lovelace — no attempts since.'
    )
    expect(
      $('[data-testid="event-redriven-label"] time').attr('datetime')
    ).toBe('2026-06-16T11:00:00Z')
    expect(valueOf($, 'event-last-error-label')).toBe(
      'Last error before redrive'
    )
    expect(valueOf($, 'event-last-error-icon-name')).toBe('Failed')
    expect(flatten(valueOf($, 'event-error-message'))).toBe(
      'MongoServerError: E11000 duplicate key error collection: gas.events index: id_1'
    )
    expect($('main').text()).not.toContain('predates attempt history')
    expect($('main').text()).not.toContain('resubmitted')
  })

  test('says only the redrive when no error came before it', async () => {
    givenEvent(redriven({ lastError: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-redriven-label"]')).toHaveLength(1)
    expect($('[data-testid="event-last-error"]')).toHaveLength(0)
  })

  test('times the first attempt after a redrive from the redrive', async () => {
    givenEvent(
      redriven({
        status: 'FAILED',
        attempts: '1/5',
        attemptHistory: [
          {
            at: '2026-06-16T11:00:30.000Z',
            name: 'E',
            message: 'boom',
            stack: null
          }
        ]
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempt-delta')).toBe('after 30.0s')
  })

  test('leaves an attempt with no instant untitled and ungapped', async () => {
    givenEvent(
      detail({
        attemptHistory: [
          {
            at: '2026-06-16T10:08:00.000Z',
            name: 'E',
            message: 'a',
            stack: null
          },
          { at: null, name: 'E', message: 'b', stack: null },
          {
            at: '2026-06-16T10:10:00.000Z',
            name: 'E',
            message: 'c',
            stack: null
          }
        ]
      })
    )

    const { $ } = await viewPage()

    const entries = $('[data-testid="event-attempt"]')

    expect(
      flatten(entries.eq(1).find('[data-testid="event-attempt-when"]').text())
    ).toBe('—')
    expect(
      entries.eq(1).find('[data-testid="event-attempt-when"]').attr('datetime')
    ).toBeUndefined()
    expect(
      entries.eq(1).find('[data-testid="event-attempt-delta"]')
    ).toHaveLength(0)
    expect(
      flatten(entries.eq(2).find('[data-testid="event-attempt-delta"]').text())
    ).toBe('+2m 0s')
  })

  test('draws the final failure in its own shape, the retried ones as circles', async () => {
    const { $ } = await viewPage()

    const shapes = $('[data-testid="event-attempt"] .timeline-middle svg')
      .toArray()
      .map((svg) => $(svg).attr('data-testid'))

    expect(shapes).toEqual(['do-icon-circle-x', 'do-icon-octagon-x'])
    expect(
      $('[data-testid="event-attempt"] .timeline-middle svg')
        .last()
        .attr('class')
    ).toContain('size-4 text-error [&>path:first-child]:fill-current')
  })

  test('shows the whole failure the link searches for, and on its title', async () => {
    const whole = `E11000 duplicate key ${'x'.repeat(600)}`

    givenEvent(
      detail({
        attemptHistory: [
          {
            at: '2026-06-16T10:16:05.000Z',
            name: 'MongoServerError',
            message: whole.slice(0, 512),
            stack: null
          }
        ],
        lastError: {
          name: 'MongoServerError',
          message: whole,
          at: '2026-06-16T10:16:05.000Z'
        }
      })
    )

    const { $ } = await viewPage()

    const attempt = $('[data-testid="event-attempt-error"]')
    const searched = new URL(
      $('[data-testid="event-error-search"]').attr('href') ?? '',
      'http://dev-ops'
    ).searchParams.get('error')

    expect(flatten(attempt.text())).toContain(whole)
    expect(attempt.attr('title')).toBe(`MongoServerError: ${whole}`)
    expect(searched).toBe(whole)
  })

  test('offers the shared failure link under the most recent attempt', async () => {
    const { $ } = await viewPage()

    const link = $('[data-testid="event-error-search"]')
    const attempts = $('[data-testid="event-attempt"]')

    expect(link.text()).toContain('Show all events with this error')
    expect(link.closest('[data-testid="event-attempt"]')).toHaveLength(1)
    expect(
      attempts.last().find('[data-testid="event-error-search"]')
    ).toHaveLength(1)
    expect(
      $('[data-testid="event-attempts-heading"]').find(
        '[data-testid="event-error-search"]'
      )
    ).toHaveLength(0)
    expect(
      $('[data-testid="event-attempts-heading"]').nextAll(
        '[data-testid="event-error-search"]'
      )
    ).toHaveLength(0)
    expect(link.attr('class')).toBe('link text-sm')
    expect(link.parent().attr('class')).toBe('mt-1')
  })

  // `?error=` matches the whole message exactly: no truncating, ever.
  test('offers the link once, however many attempts failed the same way', async () => {
    givenEvent(detail({ attemptHistory: identicalAttempts }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-attempt"]')).toHaveLength(2)
    expect($('[data-testid="event-error-search"]')).toHaveLength(1)
    expect(
      $('[data-testid="event-attempt"]')
        .first()
        .find('[data-testid="event-error-search"]')
    ).toHaveLength(0)
  })

  test('offers no link when the failure recorded no message', async () => {
    givenEvent(
      detail({ lastError: { name: 'MongoServerError', message: '', at: null } })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-error-search"]')).toHaveLength(0)
  })

  test('offers the link under the no-history entry too', async () => {
    givenEvent(detail({ attemptHistory: [] }))

    const { $ } = await viewPage()

    const link = $('[data-testid="event-error-search"]')

    expect(link).toHaveLength(1)
    expect(link.closest('[data-testid="event-last-error"]')).toHaveLength(1)
    expect(link.parent().prev().attr('data-testid')).toBe('event-error-at')
  })

  test('draws no journey section', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-journey-card"]')).toHaveLength(0)
    expect($('[data-testid="event-journey"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('Journey')
  })

  test('writes an attempt instant to the millisecond, keeping a round one', async () => {
    const { $ } = await viewPage()

    const when = $('[data-testid="event-attempt-when"]').first()

    expect(when.text()).toBe('16 Jun 2026 11:08:00.000')
    expect(when.attr('datetime')).toBe('2026-06-16T10:08:00Z')
    expect(when.attr('title')).toBeUndefined()
  })

  // Every instant the page spells out carries the machine-readable one with it.
  test('carries the instant on each attempt and on the last redrive', async () => {
    givenEvent(detail({ lastRedrive }))

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-attempt-when"]').first().attr('datetime')
    ).toBe('2026-06-16T10:08:00Z')
    expect($('[data-testid="event-last-redrive-at"]').attr('datetime')).toBe(
      '2026-06-16T10:10:00Z'
    )
    expect($('[data-testid="event-attempt-when"]').first().is('time')).toBe(
      true
    )
  })

  test('says each attempt as a number, an instant, a gap and the error', async () => {
    const { $ } = await viewPage()

    const attempts = $('[data-testid="event-attempt"]')
      .toArray()
      .map((attempt) => ({
        number: flatten(
          $(attempt).find('[data-testid="event-attempt-number"]').text()
        ),
        when: flatten(
          $(attempt).find('[data-testid="event-attempt-when"]').text()
        ),
        delta: flatten(
          $(attempt).find('[data-testid="event-attempt-delta"]').text()
        ),
        error: flatten(
          $(attempt).find('[data-testid="event-attempt-error"]').text()
        )
      }))

    expect(attempts).toEqual([
      {
        number: '#1',
        when: '16 Jun 2026 11:08:00.000',
        delta: 'after 8m 0s',
        error: 'MongoNetworkTimeoutError: connection timed out after 30000ms'
      },
      {
        number: '#2',
        when: '16 Jun 2026 11:16:05.000',
        delta: '+8m 5s',
        error:
          'MongoServerError: E11000 duplicate key error collection: gas.events index: id_1'
      }
    ])
    expect($('[data-testid="event-attempt-list"]').text()).not.toContain('ago')
  })

  test('shows a missing backoff as a run of sub-second gaps', async () => {
    givenEvent(
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
          }
        ]
      })
    )

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-attempt-delta"]')
        .toArray()
        .map((delta) => $(delta).text())
    ).toEqual(['after 120ms', '+273ms', '+512ms'])
  })

  test('sets the attempt message in wrapping mono, in normal text', async () => {
    const { $ } = await viewPage()

    const error = $('[data-testid="event-attempt-error"]').first()

    expect(error.attr('class')).toContain('font-mono')
    expect(error.attr('class')).toContain('text-sm')
    expect(error.attr('class')).toContain('wrap-anywhere')
    expect(error.attr('class')).not.toContain('text-error')
    expect($('[data-testid="event-attempt-name"]').first().text()).toBe(
      'MongoNetworkTimeoutError'
    )
    expect(
      $('[data-testid="event-attempt"]').first().find('.text-warning')
    ).toHaveLength(1)
    expect(
      $('[data-testid="event-attempt"]').first().find('.text-error')
    ).toHaveLength(0)
  })

  test('snaps every timeline marker to its own attempt', async () => {
    const { $ } = await viewPage()

    const list = $('[data-testid="event-attempt-list"]')

    expect(list.hasClass('timeline-snap-icon')).toBe(true)
    expect(list.attr('class')).toContain('[&>li]:[--timeline-col-start:0]')
  })

  const withStack = (stack: string | null) =>
    givenEvent(
      detail({
        attemptHistory: [
          {
            at: '2026-06-16T10:08:00.000Z',
            name: 'MongoServerError',
            message: 'boom',
            stack
          }
        ]
      })
    )

  const STACK =
    'MongoServerError: boom\n    at handler (/app/src/x.js:1:1)\n    at run (/app/src/y.js:2:2)'

  test('reveals the stack behind a collapsed expander, at its frames', async () => {
    withStack(STACK)

    const { $ } = await viewPage()

    const details = $('[data-testid="event-attempt-details"]')
    const stack = $('[data-testid="event-attempt-stack"]')

    expect(details.is('details')).toBe(true)
    expect(details.attr('open')).toBeUndefined()
    expect(stack.text()).toBe(
      'at handler (/app/src/x.js:1:1)\nat run (/app/src/y.js:2:2)'
    )
  })

  test('keeps a stack whose header says more than the attempt line', async () => {
    const whole = `MongoServerError: boom and the rest of it\n    at handler (/app/src/x.js:1:1)`

    withStack(whole)

    const { $ } = await viewPage()

    expect($('[data-testid="event-attempt-stack"]').text()).toBe(whole)
  })

  test('gives the disclosure chevron a colour of its own', async () => {
    withStack(STACK)

    const { $ } = await viewPage()

    const chevron = $(
      '[data-testid="event-attempt-error"] [data-testid="do-icon-chevron-down"]'
    )

    expect(chevron.attr('class')).toContain('text-base-content/70')
    expect(chevron.attr('class')).not.toContain('opacity-60')
  })

  test('sets the stack in muted, wrapping monospace inside its own scroller', async () => {
    withStack(STACK)

    const { $ } = await viewPage()

    const stack = $('[data-testid="event-attempt-stack"]')

    expect(stack.is('pre')).toBe(true)
    expect(stack.attr('class')).toContain('font-mono')
    expect(stack.attr('class')).toContain('whitespace-pre-wrap')
    expect(stack.attr('class')).toContain('text-base-content/70')
    expect(stack.parent().attr('class')).toContain('overflow-x-auto')
  })

  test.each([[null], ['']])(
    'draws no expander on an attempt whose stack is %p',
    async (stack) => {
      withStack(stack)

      const { $ } = await viewPage()

      expect($('[data-testid="event-attempt-details"]')).toHaveLength(0)
      expect($('[data-testid="event-attempt-stack"]')).toHaveLength(0)
      expect($('[data-testid="event-attempt-error"]').text()).toContain('boom')
    }
  )

  test('names the expander for a screen reader', async () => {
    withStack(STACK)

    const { $ } = await viewPage()

    const summary = $('[data-testid="event-attempt-error"]')

    expect(summary.is('summary')).toBe(true)
    expect(summary.closest('details')).toHaveLength(1)
    expect(flatten(summary.text())).toContain('MongoServerError: boom')
    expect(flatten(summary.text())).toContain('stacktrace')
    expect(summary.find('.sr-only').text()).toBe('stacktrace')
  })

  test('renders a stack carrying markup as text', async () => {
    withStack(`${xss}\n    at handler (/app/src/x.js:1:1)`)

    const { $ } = await viewPage()

    const stack = $('[data-testid="event-attempt-stack"]')

    expect(stack.find('script')).toHaveLength(0)
    expect($('main script')).toHaveLength(0)
    expect(stack.text()).toContain(xss)
  })

  test("draws a completed event's success as the last attempt", async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        attempts: '2/5',
        statusLabel: 'Completed',
        statusRole: 'success',
        completionDate: '2026-06-16T10:17:00.000Z'
      })
    )

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-attempt-list"] > li').last().attr('data-testid')
    ).toBe('event-attempt-success')
    expect(valueOf($, 'event-attempt-success-number')).toBe('#3')
    expect(valueOf($, 'event-attempt-success-when')).toBe(
      '16 Jun 2026 11:17:00.000'
    )
    expect(valueOf($, 'event-attempt-success-delta')).toBe('+55.0s')
    expect(valueOf($, 'event-attempts-value')).toBe('3 of 5')
  })

  const tenFailures = Array.from({ length: 10 }, (_, index) => ({
    at: `2026-06-16T10:0${index}:00.000Z`,
    name: 'E',
    message: 'boom',
    stack: null
  }))

  test.each([
    ['after two failures', { attempts: '2/5' }, '#3', '3 of 5'],
    [
      'first time',
      { attempts: '0/5', attemptHistory: [], lastError: null },
      '#1',
      '1 of 5'
    ],
    [
      'on a legacy row whose count included the success',
      { attempts: '1/5', attemptHistory: [], lastError: null },
      '#1',
      '1 of 5'
    ],
    [
      'past the capped history',
      { attempts: '12/5', attemptHistory: tenFailures },
      '#13',
      '13 of 5'
    ]
  ])(
    'counts a completed event %s as its success is numbered',
    async (_name, overrides, number, count) => {
      givenEvent(
        detail({
          status: 'COMPLETED',
          attempts: '2/5',
          completionDate: '2026-06-16T10:17:00.000Z',
          ...(overrides as Partial<EventDetail>)
        })
      )

      const { $ } = await viewPage()

      expect(valueOf($, 'event-attempt-success-number')).toBe(number)
      expect(valueOf($, 'event-attempts-value')).toBe(count)
      expect(`#${valueOf($, 'event-attempts-value').split(' ')[0]}`).toBe(
        valueOf($, 'event-attempt-success-number')
      )
    }
  )

  test('draws a first-time success as the only attempt', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        attempts: '0/5',
        attemptHistory: [],
        lastError: null,
        completionDate: '2026-06-16T10:00:00.207Z'
      })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-attempt"]')).toHaveLength(0)
    expect(valueOf($, 'event-attempt-success-number')).toBe('#1')
    expect(valueOf($, 'event-attempt-success-delta')).toBe('after 207ms')
    expect($('[data-testid="event-attempts-empty"]')).toHaveLength(0)
  })

  test('leaves a dead-lettered event with its count', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-attempt-success"]')).toHaveLength(0)
    expect(valueOf($, 'event-attempts-value')).toBe('5 of 5')
  })

  test('names each attempt icon by what the attempt led to', async () => {
    const { $ } = await viewPage()

    const names = () =>
      $('[data-testid="event-attempt-list"] > li')
        .toArray()
        .map((li) =>
          flatten($(li).find('[data-testid="event-attempt-icon-name"]').text())
        )

    expect(names()).toEqual(['Failed', 'Failed, final attempt'])
    expect(
      $('[data-testid="event-attempt"] .timeline-middle svg')
        .first()
        .attr('aria-hidden')
    ).toBe('true')

    givenEvent(
      detail({
        status: 'COMPLETED',
        attempts: '2/5',
        completionDate: '2026-06-16T10:17:00.000Z'
      })
    )
    const { $: done } = await viewPage()

    expect(
      done('[data-testid="event-attempt-list"] > li')
        .toArray()
        .map((li) =>
          flatten(
            done(li).find('[data-testid="event-attempt-icon-name"]').text()
          )
        )
    ).toEqual(['Failed', 'Failed', 'Succeeded'])
  })

  test('says an undated completion has no recorded instant, and draws no gap', async () => {
    givenEvent(
      detail({ status: 'COMPLETED', attempts: '2/5', completionDate: null })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempt-success-number')).toBe('#3')
    expect(valueOf($, 'event-attempt-success-when')).toBe(
      'completion time not recorded'
    )
    expect($('[data-testid="event-attempt-success-delta"]')).toHaveLength(0)
  })

  test('says a never-attempted event has no attempts recorded yet', async () => {
    givenEvent(
      detail({
        status: 'PUBLISHED',
        attempts: '0/5',
        attemptHistory: [],
        lastError: null
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts-empty')).toBe('No attempts recorded yet.')
  })

  test('colours the failure that ended a dead letter apart from the retried ones', async () => {
    const { $ } = await viewPage()

    const entries = $('[data-testid="event-attempt"]')

    expect(entries.eq(0).find('.timeline-middle svg').attr('class')).toContain(
      'text-warning'
    )
    expect(entries.eq(1).find('.timeline-middle svg').attr('class')).toContain(
      'text-error'
    )
    expect(
      flatten(
        entries.eq(1).find('[data-testid="event-attempt-icon-name"]').text()
      )
    ).toBe('Failed, final attempt')
  })

  test('calls no failure final on an event that went on to complete', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        attempts: '2/5',
        completionDate: '2026-06-16T10:17:00.000Z'
      })
    )

    const { $ } = await viewPage()

    expect(
      $('[data-testid="event-attempt"] .timeline-middle svg')
        .toArray()
        .map((svg) => $(svg).attr('class'))
    ).toEqual(['size-4 text-warning', 'size-4 text-warning'])
  })

  test('says an old dead letter predates the history, then its last error', async () => {
    givenEvent(detail({ attemptHistory: [] }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-attempt-list"]')).toHaveLength(0)
    expect(valueOf($, 'event-attempts-empty')).toBe(
      'No attempt details recorded (event predates attempt history).'
    )
    expect(valueOf($, 'event-last-error-label')).toBe('Last error')
    expect($('[data-testid="event-error-search"]')).toHaveLength(1)
    expect(flatten(valueOf($, 'event-error-message'))).toBe(
      'MongoServerError: E11000 duplicate key error collection: gas.events index: id_1'
    )
    expect(valueOf($, 'event-error-at')).toBe('at 16 Jun 2026 11:16:05.000')
    expect($('[data-testid="event-error-at"] time').attr('datetime')).toBe(
      '2026-06-16T10:16:05Z'
    )
  })

  test('says an old retrying event predates the history, then its last error', async () => {
    givenEvent(
      detail({ status: 'FAILED', statusLabel: 'Failed', attemptHistory: [] })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts-empty')).toBe(
      'No attempt details recorded (event predates attempt history).'
    )
    expect(valueOf($, 'event-last-error-label')).toBe('Last error')
    expect(valueOf($, 'event-last-error-icon-name')).toBe('Failed')
    expect($('[data-testid="event-error-search"]')).toHaveLength(0)
  })

  test.each([
    ['DEAD_LETTER', 'do-icon-octagon-x', 'text-error', 'Failed, final attempt'],
    ['FAILED', 'do-icon-circle-x', 'text-warning', 'Failed']
  ])(
    'marks the last error of a %s event with no history as the timeline would',
    async (status, shape, colour, name) => {
      givenEvent(detail({ status, attemptHistory: [] }))

      const { $ } = await viewPage()

      const svg = $('[data-testid="event-last-error"] svg').first()

      expect(svg.attr('data-testid')).toBe(shape)
      expect(svg.attr('class')).toContain(colour)
      expect(valueOf($, 'event-last-error-icon-name')).toBe(name)
    }
  )

  test('titles the instant of a last error from before a redrive', async () => {
    givenEvent(
      detail({
        status: 'RESUBMITTED',
        attempts: '0/5',
        attemptHistory: [],
        lastRedrive: { at: '2026-06-16T11:00:00.000Z', by: 'Ada Lovelace' }
      })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-error-at"] time').attr('datetime')).toBe(
      '2026-06-16T10:16:05Z'
    )
  })

  test('draws an old completed event as predating the history, then its success', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        attempts: '1/5',
        attemptHistory: [],
        completionDate: '2026-06-16T10:17:00.000Z'
      })
    )

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts-empty')).toBe(
      'No attempt details recorded (event predates attempt history).'
    )
    expect(valueOf($, 'event-attempt-success-number')).toBe('#1')
    expect(valueOf($, 'event-attempts-value')).toBe('1 of 5')
    expect($('[data-testid="event-last-error"]')).toHaveLength(0)
  })

  test('says an old dead letter at a count of 0 predates the history', async () => {
    givenEvent(detail({ attempts: '0/5', attemptHistory: [], lastError: null }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-attempts-empty')).toBe(
      'No attempt details recorded (event predates attempt history).'
    )
  })

  test('says in words that an old event with no failure has no history', async () => {
    givenEvent(detail({ attemptHistory: [], lastError: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-attempt-list"]')).toHaveLength(0)
    expect($('[data-testid="event-last-error"]')).toHaveLength(0)
    expect(valueOf($, 'event-attempts-empty')).toBe(
      'No attempt details recorded (event predates attempt history).'
    )
    const empty = $('[data-testid="event-attempts-empty"]')

    expect(empty.attr('class')).not.toContain('text-center')
    expect(empty.attr('class')).not.toContain('py-6')
  })

  test('escapes an attempt message containing markup', async () => {
    givenEvent(
      detail({
        attemptHistory: [
          {
            at: '2026-06-16T10:08:00.000Z',
            name: xss,
            message: xss,
            stack: null
          }
        ]
      })
    )

    const { $ } = await viewPage()

    const attempt = $('[data-testid="event-attempt-error"]')

    expect(attempt.find('script')).toHaveLength(0)
    expect(attempt.text()).toContain(xss)
  })

  test('renders no logs link beside the trace id', async () => {
    givenLogsExplorer()

    const { $ } = await viewPage()

    expect($('[data-testid="event-logs-link"]')).toHaveLength(0)
    expect($('[data-testid="event-fact-trace-id"]').text()).not.toContain(
      'logs'
    )
  })

  test('renders no link at all on an event carrying no trace', async () => {
    givenLogsExplorer()
    givenEvent(inboxDetail({ traceId: null }))

    const { $ } = await viewPage(inboxPath)

    expect($('a[data-testid="event-trace-id"]')).toHaveLength(0)
    expect($('[data-testid="event-logs-link"]')).toHaveLength(0)
    expect($('[data-testid="event-trace-id-none"]').text()).toBe('—')
  })

  test('keeps the way into the logs on the trace id value itself', async () => {
    givenLogsExplorer()
    givenEvent(inboxDetail())

    const { $ } = await viewPage(inboxPath)

    const trace = $('a[data-testid="event-trace-id"]')

    expect(trace).toHaveLength(1)
    expect(trace.contents().first().text()).toBe(traceId)
    expect(trace.attr('target')).toBe('_blank')
    expect(trace.attr('rel')).toBe('noopener noreferrer')
    expect(trace.closest('[data-testid="event-fact-trace-id"]')).toHaveLength(1)
  })

  test.each([['COMPLETED'], ['PUBLISHED']])(
    'offers no redrive on the payload card of a %s event',
    async (status) => {
      givenEvent(detail({ status }))

      const { $ } = await viewPage()

      expect($('[data-testid="event-redrive"]')).toHaveLength(0)
      expect($('[data-testid="event-payload-card"]').text()).not.toContain(
        'Redrive'
      )
    }
  )

  test('opens the redrive confirmation in place of the toolbar button', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('[data-testid="event-redrive-confirm"]')).toHaveLength(1)
    expect($('[data-testid="event-redrive"]')).toHaveLength(0)
    expect($('[data-testid="event-park-confirm"]')).toHaveLength(0)
    expect($('[data-testid="event-unpark-confirm"]')).toHaveLength(0)
  })

  test('says nothing about parking anywhere on the page', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-fact-parked"]')).toHaveLength(0)
    expect($('main').text()).not.toContain('Park')
    expect($('main').html()).not.toContain('/park')
    expect($('main').html()).not.toContain('/unpark')
  })

  test.each([
    'parked=1',
    'unparked=1',
    'park_conflict=COMPLETED',
    'park_error=missing'
  ])('refuses the leftover %s parameter', async (query) => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: `${path}?${query}`,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('warns beside the redrive when one already failed the same way', async () => {
    givenEvent(detail({ attemptHistory: identicalAttempts, lastRedrive }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-futile-warning')).toBe(
      'The last two attempts since the redrive (by Ada Lovelace, 16 Jun 2026 11:10:00.000) failed with the identical error — redriving again is unlikely to succeed until the underlying cause is fixed.'
    )
    expect(
      $('[data-testid="event-futile-warning"]').hasClass('alert-soft')
    ).toBe(false)
    expect($('[data-testid="event-redrive"]')).toHaveLength(1)
    expect(
      $('[data-testid="event-futile-warning"]').closest(
        '[data-testid="event-payload-card"]'
      )
    ).toHaveLength(1)
  })

  test('warns about no futile redrive when the last two attempts failed differently', async () => {
    givenEvent(detail({ lastRedrive }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-futile-warning"]')).toHaveLength(0)
  })

  test('warns about no futile redrive when nobody has redriven it', async () => {
    givenEvent(detail({ attemptHistory: identicalAttempts }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-futile-warning"]')).toHaveLength(0)
  })

  test('names when an event was last redriven and who by', async () => {
    givenEvent(detail({ lastRedrive }))

    const { $ } = await viewPage()

    expect(valueOf($, 'event-last-redrive')).toBe(
      '16 Jun 2026 11:10:00.000 · by Ada Lovelace'
    )
    const at = $('[data-testid="event-last-redrive-at"]')

    expect(at.attr('datetime')).toBe('2026-06-16T10:10:00Z')
    expect(at.attr('title')).toBeUndefined()
  })

  test('says nothing about a redrive on an event nobody has redriven', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-fact-last-redrive"]')).toHaveLength(0)
  })

  test('names the date a completed event will be deleted, in UK time', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        completionDate: '2026-06-16T10:17:00.000Z',
        expiresAt: '2026-09-14T10:17:00.000Z'
      })
    )

    const { $ } = await viewPage()
    const at = $('[data-testid="event-deletion-date"]')

    expect(valueOf($, 'event-fact-deletion-date')).toBe(
      'Deletion date 14 Sep 2026 11:17:00.000'
    )
    expect(at.attr('datetime')).toBe('2026-09-14T10:17:00Z')
    expect(at.attr('title')).toBeUndefined()
  })

  test('puts the deletion date straight after the trace id', async () => {
    givenEvent(
      inboxDetail({
        status: 'COMPLETED',
        expiresAt: '2026-09-14T10:17:00.000Z'
      })
    )

    const { $ } = await viewPage(inboxPath)

    expect(
      $('[data-testid="event-facts-common"] > [data-testid]')
        .map((_, row) => $(row).attr('data-testid'))
        .get()
    ).toEqual([
      'event-fact-service',
      'event-fact-route',
      'event-fact-trace-id',
      'event-fact-deletion-date'
    ])
  })

  test('says nothing about deletion on a dead letter nothing will delete', async () => {
    givenEvent(detail({ expiresAt: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-fact-deletion-date"]')).toHaveLength(0)
  })

  test('says nothing about deletion when the backend sends no date', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-fact-deletion-date"]')).toHaveLength(0)
  })

  test('offers every other dead letter with this error', async () => {
    const { $ } = await viewPage()
    const link = $('[data-testid="event-error-search"]')

    expect(flatten(link.text())).toBe('Show all events with this error')
    expect(link.text()).not.toContain('→')
    expect(
      link.find('[data-testid="do-icon-arrow-right"]').attr('aria-hidden')
    ).toBe('true')
    expect(link.attr('href')).toBe(
      '/dev-ops/events?error=E11000+duplicate+key+error+collection%3A+gas.events+index%3A+id_1'
    )
  })

  test('escapes a hostile message into the shared failure href rather than out of it', async () => {
    givenEvent(
      detail({
        attemptHistory: [
          {
            at: '2026-06-16T10:16:05.000Z',
            name: 'Error',
            message: xss,
            stack: null
          }
        ],
        lastError: { name: 'Error', message: xss, at: null }
      })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-error-search"]').attr('href')).toBe(
      `/dev-ops/events?${new URLSearchParams({ error: xss })}`
    )
  })

  test('offers no shared failure link on an event with no failure recorded', async () => {
    givenEvent(detail({ lastError: null }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-error-search"]')).toHaveLength(0)
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

const purgedDetail = (overrides: Partial<EventDetail> = {}) =>
  detail({
    status: 'PURGED',
    statusLabel: 'Purged',
    statusRole: 'neutral',
    lastPurge,
    expiresAt: purgeDeletionDate,
    ...overrides
  })

const confirmPath = `${path}?confirm=purge`

describe('the purge button', () => {
  beforeEach(() => {
    givenEvent(purgeable())
  })

  test('offers a purge left of the redrive on the payload card', async () => {
    const { $ } = await viewPage()

    const button = $('[data-testid="event-purge"]')

    expect(button.is('a')).toBe(true)
    expect(button.attr('href')).toBe(`${path}?confirm=purge#payload`)
    expect(button.hasClass('btn-outline')).toBe(true)
    expect(button.hasClass('btn-error')).toBe(false)
    expect(button.text().trim()).toBe('Purge')
    expect(button.closest('[data-testid="event-payload-card"]')).toHaveLength(1)
    expect(button.next().attr('data-testid')).toBe('event-redrive')
  })

  test('offers none on a dead letter the owning service sent no deletion date for', async () => {
    givenEvent(detail())

    const { $ } = await viewPage()

    expect($('[data-testid="event-purge"]')).toHaveLength(0)
    expect($('[data-testid="event-redrive"]')).toHaveLength(1)
  })

  test.each(['PUBLISHED', 'PROCESSING', 'FAILED', 'RESUBMITTED', 'COMPLETED'])(
    'offers no purge on a %s event, however it is dated',
    async (status) => {
      givenEvent(purgeable({ status }))

      const { $ } = await viewPage()

      expect($('[data-testid="event-purge"]')).toHaveLength(0)
      expect($('[data-testid="event-purge-confirm"]')).toHaveLength(0)
    }
  )

  test('ignores a confirmation asked for on an event that cannot be purged', async () => {
    givenEvent(detail())

    const { $ } = await viewPage(confirmPath)

    expect($('[data-testid="event-purge-confirm"]')).toHaveLength(0)
    expect($('[data-testid="event-purge-form"]')).toHaveLength(0)
  })

  test('takes both buttons away while the purge is being confirmed', async () => {
    const { $ } = await viewPage(confirmPath)

    expect($('[data-testid="event-purge"]')).toHaveLength(0)
    expect($('[data-testid="event-redrive"]')).toHaveLength(0)
  })

  test('takes both buttons away while the redrive is being confirmed', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect($('[data-testid="event-purge"]')).toHaveLength(0)
    expect($('[data-testid="event-redrive"]')).toHaveLength(0)
  })
})

describe('the purge confirmation', () => {
  beforeEach(() => {
    givenEvent(purgeable())
  })

  test('asks before it writes, and says what the write does', async () => {
    const { $ } = await viewPage(confirmPath)

    expect(valueOf($, 'event-purge-heading')).toBe('Purge this event?')
    expect(valueOf($, 'event-purge-question')).toBe(
      "It won't be processed or retried, and it leaves the dead-letter list. " +
        'It will be deleted on 14 Sep 2026 10:00:00.000. You can redrive it until then. ' +
        'This action is audited.'
    )
    expect(valueOf($, 'event-purge-submit')).toBe('Confirm purge')
    expect(valueOf($, 'event-purge-cancel')).toBe('Cancel')
  })

  test('says the action is audited, and warns of no audit row', async () => {
    const { $ } = await viewPage(confirmPath)

    const panel = flatten($('[data-testid="event-purge-confirm"]').text())

    expect(panel).toContain('This action is audited.')
    expect(panel).not.toContain('FCP Audit')
  })

  test('carries the deletion instant for machines beside the words', async () => {
    const { $ } = await viewPage(confirmPath)

    expect(
      $('[data-testid="event-purge-deletion-date"]').attr('datetime')
    ).toBe('2026-09-14T09:00:00Z')
  })

  test('points focus at the question, and describes the panel by its sentence', async () => {
    const { $ } = await viewPage(confirmPath)

    const heading = $('[data-testid="event-purge-heading"]')
    const panel = $('[data-testid="event-purge-confirm"]')

    expect(heading.attr('tabindex')).toBe('-1')
    expect(heading.attr('data-focus-on-arrival')).toBeDefined()
    expect(heading.attr('id')).toBe('purge-question')
    expect(panel.attr('aria-labelledby')).toBe('purge-question')
    expect(panel.attr('aria-describedby')).toBe('purge-explain')
    expect($('[data-focus-on-arrival]')).toHaveLength(1)
  })

  test('offers the three reasons as radios in a named fieldset', async () => {
    const { $ } = await viewPage(confirmPath)

    const fieldset = $('[data-testid="event-purge-reasons"]')

    expect(fieldset.is('fieldset')).toBe(true)
    expect(valueOf($, 'event-purge-reasons-legend')).toBe('Reason')
    expect(
      $('[data-testid="event-purge-reason-input"]')
        .toArray()
        .map((input) => $(input).attr('value'))
    ).toEqual(['BROKEN_PAYLOAD', 'SENT_IN_ERROR', 'OTHER'])
    expect(
      $('[data-testid="event-purge-reason-label"]')
        .toArray()
        .map((label) => $(label).text())
    ).toEqual(['Payload is broken', 'Sent in error', 'Other'])
    expect(
      $('[data-testid="event-purge-reason-input"]')
        .toArray()
        .map((input) => $(input).attr('name'))
    ).toEqual(['reasonCode', 'reasonCode', 'reasonCode'])
    expect($('[data-testid="event-purge-reason-input"][checked]')).toHaveLength(
      0
    )
  })

  test('wraps each radio in its own label, so the words are the target', async () => {
    const { $ } = await viewPage(confirmPath)

    const first = $('[data-testid="event-purge-reason"]').first()

    expect(first.is('label')).toBe(true)
    expect(first.find('input').attr('id')).toBe('purge-reason-BROKEN_PAYLOAD')
  })

  test('offers a note, badged as required for Other, warned about and counted', async () => {
    const { $ } = await viewPage(confirmPath)

    expect(valueOf($, 'event-purge-note-legend')).toBe(
      'Note Required for Other'
    )
    expect(valueOf($, 'event-purge-note-badge')).toBe('Required for Other')
    expect(valueOf($, 'event-purge-note-field-hint')).toBe(
      "Don't include personal data."
    )
    expect(valueOf($, 'event-purge-note-field-count')).toBe('0 / 500')
    expect($('[data-testid="event-purge-note-field"]').attr('name')).toBe(
      'note'
    )
    expect($('#purge-note').is('textarea')).toBe(true)
  })

  test('names the note textarea Note, not its placeholder', async () => {
    const { $ } = await viewPage(confirmPath)

    const label = $('label[for="purge-note"]')
    const note = $('#purge-note')

    expect(label).toHaveLength(1)
    expect(label.text()).toBe('Note')
    expect(note.attr('aria-label')).toBeUndefined()
    expect(note.attr('aria-labelledby')).toBeUndefined()
    expect(note.attr('placeholder')).toBe(
      'Why will this event never be processed?'
    )
    expect($('[data-testid="event-purge-note"]').is('fieldset')).toBe(false)
    expect(label.find('[data-testid="event-purge-note-badge"]')).toHaveLength(0)
  })

  // A note the box would not let them type cannot be told it is too long.
  test('sets no maxlength on the note', async () => {
    const { $ } = await viewPage(confirmPath)

    expect($('#purge-note').attr('maxlength')).toBeUndefined()
  })

  test('describes the note by the help line alone while nothing is wrong', async () => {
    const { $ } = await viewPage(confirmPath)

    expect($('#purge-note').attr('aria-describedby')).toBe('purge-note-help')
    expect($('#purge-note').attr('aria-invalid')).toBeUndefined()
    expect($('[data-testid="event-purge-error"]')).toHaveLength(0)
  })

  test('posts the confirmation at the purge route', async () => {
    const { $ } = await viewPage(confirmPath)

    const form = $('[data-testid="event-purge-form"]')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(`${path}/purge`)
    expect($('[data-testid="event-purge-submit"]').attr('type')).toBe('submit')
    expect(
      $('[data-testid="event-purge-submit"]').hasClass('btn-neutral')
    ).toBe(true)
    expect($('[data-testid="event-purge-cancel"]').hasClass('btn-ghost')).toBe(
      true
    )
  })

  test('carries the list query through the confirmation', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=DEAD_LETTER')}&confirm=purge`
    )

    const hidden = $('[data-testid="event-purge-from"]')

    expect(hidden.attr('name')).toBe('from')
    expect(hidden.attr('value')).toBe('?status=DEAD_LETTER')
    expect($('[data-testid="event-purge-cancel"]').attr('href')).toBe(
      `${path}?from=%3Fstatus%3DDEAD_LETTER#purge`
    )
  })

  test('cancels back to the page without the confirmation on it', async () => {
    const { $ } = await viewPage(confirmPath)

    expect($('[data-testid="event-purge-cancel"]').attr('href')).toBe(
      `${path}#purge`
    )
  })

  test('carries a hostile from no further than the form', async () => {
    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('//example.com')}&confirm=purge`
    )

    expect($('[data-testid="event-purge-from"]').attr('value')).toBe('')
  })

  test('writes no UTC label on the confirm panel', async () => {
    const { $ } = await viewPage(confirmPath)

    expect($('main').html()).not.toContain('UTC')
  })
})

describe('a purged event', () => {
  beforeEach(() => {
    givenEvent(purgedDetail())
  })

  test('says the deletion date, then who purged it and why', async () => {
    const { $ } = await viewPage()

    expect(labelsOf($)).toEqual([
      'Service',
      'Queue',
      'Trace ID',
      'Deletion date',
      'Segregation ref',
      'Topic',
      'Purged'
    ])
    expect(valueOf($, 'event-purged-reason')).toBe('Payload is broken')
    expect(valueOf($, 'event-purged-by')).toBe(
      '· by Ada Lovelace on 16 Jun 2026 11:18:00.000'
    )
    expect($('[data-testid="event-purged-at"]').attr('datetime')).toBe(
      '2026-06-16T10:18:00Z'
    )
    expect(valueOf($, 'event-purged-note')).toBe(
      '"sheetId arrives as a number"'
    )
  })

  test('sets the purge across both lists, since neither column fits it', async () => {
    const { $ } = await viewPage()

    const list = $('[data-testid="event-facts-purged"]')

    expect(list.is('dl')).toBe(true)
    expect(list.attr('class')).toContain('lg:col-span-2')
    expect(list.attr('class')).toContain('sm:grid-cols-[8rem_minmax(0,1fr)]')
    expect(list.parent().attr('data-testid')).toBe('event-facts')
  })

  test('sets the purge time in the type the other times on the card are in', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-purged-at"]').attr('class')).toBe(
      $('[data-testid="event-deletion-date"]').attr('class')
    )
  })

  test('leaves the note line out where none was recorded', async () => {
    givenEvent(purgedDetail({ lastPurge: { ...lastPurge, note: null } }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-purged-note"]')).toHaveLength(0)
    expect($('[data-testid="event-purged-reason"]')).toHaveLength(1)
  })

  test('keeps the redrive and takes the purge away', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-redrive"]')).toHaveLength(1)
    expect($('[data-testid="event-purge"]')).toHaveLength(0)
  })

  test('says what the redrive would reverse, and that the date goes with it', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect(valueOf($, 'event-redrive-question')).toBe(
      'The poller will retry it up to its attempt limit. ' +
        "It was purged as 'Payload is broken'; if the payload is broken, it will fail again. " +
        'Its deletion date is cleared. This action is audited.'
    )
  })

  test('says previously purged once the event has been redriven out of it', async () => {
    givenEvent(
      detail({
        status: 'RESUBMITTED',
        statusLabel: 'Resubmitted',
        statusRole: 'info',
        lastPurge,
        expiresAt: null
      })
    )

    const { $ } = await viewPage()

    expect(labelsOf($)).toContain('Previously purged')
    expect(labelsOf($)).not.toContain('Purged')
    expect(labelsOf($)).not.toContain('Deletion date')
  })

  test('leaves the redrive confirm alone on an event that is no longer purged', async () => {
    givenEvent(
      detail({
        lastPurge,
        expiresAt: null
      })
    )

    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect(valueOf($, 'event-redrive-question')).toBe(
      'The poller will retry it up to its attempt limit. This action is audited.'
    )
  })

  test('writes no UTC label anywhere on the page', async () => {
    const { $ } = await viewPage()

    expect($('main').html()).not.toContain('UTC')
  })

  test('renders a purge note carrying markup as text', async () => {
    givenEvent(purgedDetail({ lastPurge: { ...lastPurge, note: xss } }))

    const { $ } = await viewPage()

    expect($('main script')).toHaveLength(0)
    expect($('script')).toHaveLength(1)
    expect(valueOf($, 'event-purged-note')).toContain(xss)
  })
})

// After the detail's two attempts, which ran at 10:08 and 10:16:05.
const lastEdit = {
  at: '2026-06-16T10:18:00.000Z',
  by: 'Grace Hopper',
  note: 'sheetId arrives as a number'
}

const editedDetail = (overrides: Partial<EventDetail> = {}) =>
  detail({
    lastEdit,
    originalPayload: { sheetId: 12345 },
    payload: { sheetId: '12345' },
    ...overrides
  })

describe('an edited event', () => {
  beforeEach(() => {
    givenEvent(editedDetail({ lastRedrive }))
  })

  test('says who edited the payload and when, just before the last redrive', async () => {
    const { $ } = await viewPage()

    expect(labelsOf($)).toEqual([
      'Service',
      'Queue',
      'Trace ID',
      'Payload edited',
      'Last redrive',
      'Segregation ref',
      'Topic'
    ])
    expect(valueOf($, 'event-edited-by')).toBe(
      'by Grace Hopper on 16 Jun 2026 11:18:00.000'
    )
    expect($('[data-testid="event-edited-at"]').attr('datetime')).toBe(
      '2026-06-16T10:18:00Z'
    )
    expect(valueOf($, 'event-edited-note')).toBe(
      '"sheetId arrives as a number"'
    )
  })

  test('sets the edit time in the type the other times on the card are in', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid="event-edited-at"]').attr('class')).toBe(
      $('[data-testid="event-last-redrive-at"]').attr('class')
    )
  })

  test('keeps each time on the card whole rather than breaking it mid-number', async () => {
    givenEvent(
      editedDetail({ lastRedrive, expiresAt: '2026-09-14T10:17:00.000Z' })
    )

    const { $ } = await viewPage()

    const times = $('[data-testid="event-facts"] time')

    expect(times.toArray().map((time) => $(time).attr('data-testid'))).toEqual([
      'event-deletion-date',
      'event-edited-at',
      'event-last-redrive-at'
    ])
    times.each((_, time) => {
      expect($(time).attr('class')).toContain('whitespace-nowrap')
      expect($(time).attr('class')).not.toContain('break-all')
    })
  })

  test('leaves the note line out where none was recorded', async () => {
    givenEvent(editedDetail({ lastEdit: { ...lastEdit, note: null } }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-edited-note"]')).toHaveLength(0)
    expect($('[data-testid="event-edited-by"]')).toHaveLength(1)
  })

  test('renders an edit note carrying markup as text', async () => {
    givenEvent(editedDetail({ lastEdit: { ...lastEdit, note: xss } }))

    const { $ } = await viewPage()

    expect($('main script')).toHaveLength(0)
    expect(valueOf($, 'event-edited-note')).toContain(xss)
  })

  test('puts nothing beside the status for an edit: the facts say it', async () => {
    const { $ } = await viewPage()

    expect(flatten($('[data-testid="event-header-status"]').text())).toBe(
      'Dead letter'
    )
    expect($('[data-testid="event-header-status"] .badge')).toHaveLength(1)
  })

  test('keeps the fact, and drops the note on attempts, once the edit is redriven', async () => {
    givenEvent(
      editedDetail({
        status: 'RESUBMITTED',
        statusLabel: 'Resubmitted',
        statusRole: 'info',
        attemptHistory: [],
        lastRedrive: { at: '2026-06-16T10:19:00.000Z', by: 'Ada Lovelace' }
      })
    )

    const { $ } = await viewPage()

    expect(labelsOf($)).toContain('Payload edited')
    expect($('[data-testid="event-no-attempts-since-edit"]')).toHaveLength(0)
  })

  test('says no attempt has run since the edit', async () => {
    const { $ } = await viewPage()

    expect(valueOf($, 'event-no-attempts-since-edit')).toBe(
      'No attempts since the payload was edited.'
    )
    expect(
      $(
        '[data-testid="event-attempts-card"] [data-testid="event-no-attempts-since-edit"]'
      )
    ).toHaveLength(1)
  })

  test('keeps the futile warning away from a payload nothing has run on', async () => {
    givenEvent(editedDetail({ attemptHistory: identicalAttempts, lastRedrive }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-futile-warning"]')).toHaveLength(0)
  })

  test('keeps the payload before the first edit below the payload, closed', async () => {
    const { $ } = await viewPage()

    const original = $('[data-testid="event-original-payload"]')

    expect(original.is('details')).toBe(true)
    expect(original.attr('open')).toBeUndefined()
    expect(original.prev().attr('data-testid')).toBe('event-payload')
    expect(valueOf($, 'event-original-payload-summary')).toBe(
      'Payload before the first edit'
    )
    expect(
      original
        .find('[data-testid="event-original-payload-lines-line"] code')
        .toArray()
        .map((line) => $(line).text())
    ).toEqual(['{', '  "sheetId": 12345', '}'])
    expect(
      original
        .find('[data-testid="event-original-payload-lines"]')
        .attr('aria-label')
    ).toBe('Payload before the first edit')
  })

  test('says in the redrive confirm that the edit has not been retried', async () => {
    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect(valueOf($, 'event-redrive-question')).toBe(
      'The poller will retry it up to its attempt limit. ' +
        "The payload was edited on 16 Jun 2026 11:18:00.000 and hasn't been retried since. " +
        'This action is audited.'
    )
  })

  test('does not warn that a purged payload will fail again once it has been edited', async () => {
    givenEvent(purgedDetail({ lastEdit, lastRedrive }))

    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect(valueOf($, 'event-redrive-question')).toBe(
      'The poller will retry it up to its attempt limit. ' +
        "It was purged as 'Payload is broken'. Its deletion date is cleared. " +
        "The payload was edited on 16 Jun 2026 11:18:00.000 and hasn't been retried since. " +
        'This action is audited.'
    )
  })

  test('says nothing of an edit on an event nobody has edited', async () => {
    givenEvent(detail({ lastRedrive }))

    const { $ } = await viewPage(`${path}?confirm=redrive`)

    expect(labelsOf($)).not.toContain('Payload edited')
    expect($('[data-testid="event-no-attempts-since-edit"]')).toHaveLength(0)
    expect($('[data-testid="event-original-payload"]')).toHaveLength(0)
    expect($('[data-testid="event-redrive-edited"]')).toHaveLength(0)
  })
})

describe('the edit button', () => {
  test('offers an edit left of the purge and the redrive', async () => {
    givenEvent(
      detail({ payloadRevision: 0, purgeDeletionDate: '2026-09-14T09:00:00Z' })
    )

    const { $ } = await viewPage(
      `${path}?from=${encodeURIComponent('?status=DEAD_LETTER')}`
    )

    const actions = $('[data-testid="event-payload-actions"] a')
      .toArray()
      .map((action) => flatten($(action).text()))

    expect(actions).toEqual(['Edit payload', 'Purge', 'Redrive'])
    expect(
      flatten(
        $('[data-testid="event-edit"]')
          .clone()
          .find('.sr-only')
          .remove()
          .end()
          .text()
      )
    ).toBe('Edit')
    expect($('[data-testid="event-edit"] .sr-only').text()).toBe(' payload')
    expect($('[data-testid="event-edit"]').attr('class')).toBe(
      'btn btn-outline scroll-mt-4'
    )
    expect($('[data-testid="event-edit"]').attr('href')).toBe(
      `${path}?from=%3Fstatus%3DDEAD_LETTER&edit=payload#payload`
    )
  })

  test('offers one on an audit row, since nothing is locked', async () => {
    givenEvent(detail({ type: 'audit', payloadRevision: 1 }))

    const { $ } = await viewPage()

    expect($('[data-testid="event-edit"]')).toHaveLength(1)
  })

  test.each([
    ['absent', {}],
    ['null', { payloadRevision: null }]
  ])('offers none when the revision is %s', async (_name, overrides) => {
    givenEvent(detail(overrides))

    const { $ } = await viewPage()

    expect($('[data-testid="event-edit"]')).toHaveLength(0)
    expect($('[data-testid="event-redrive"]')).toHaveLength(1)
  })

  test('offers none on a completed event', async () => {
    givenEvent(
      detail({
        status: 'COMPLETED',
        statusLabel: 'Completed',
        statusRole: 'success',
        payloadRevision: 2
      })
    )

    const { $ } = await viewPage()

    expect($('[data-testid="event-edit"]')).toHaveLength(0)
  })
})

describe('the payload editor', () => {
  beforeEach(() => {
    givenEvent(detail({ payloadRevision: 2 }))
  })

  test('accepts the edit query rather than refusing it', async () => {
    const { statusCode } = await viewPage(`${path}?edit=payload`)

    expect(statusCode).toBe(statusCodes.ok)
  })

  test('swaps the payload for a form holding it, pretty-printed, and renames the card', async () => {
    const { $ } = await viewPage(`${path}?edit=payload`)

    expect(valueOf($, 'event-payload-heading')).toBe('Edit payload')
    expect($('[data-testid="event-payload"]')).toHaveLength(0)
    expect($('[data-testid="event-payload-actions"]')).toHaveLength(0)
    expect($('[data-testid="event-payload-editor-text"]').text()).toBe(
      JSON.stringify(detail().payload, null, 2)
    )
  })

  test('is never stored, so Back after a save reads the event again rather than showing a spent editor', async () => {
    const { headers } = await server.inject({
      method: 'GET',
      url: `${path}?edit=payload`,
      auth: { strategy: 'session', credentials }
    })

    expect(headers['cache-control']).toBe('no-store')
  })

  test('frames gutter and text as one daisyUI textarea, so focus and an error look as daisyUI draws them', async () => {
    const { $ } = await viewPage(`${path}?edit=payload`)
    const frame = $('[data-testid="event-payload-editor-frame"]')

    expect(frame.attr('class')?.split(' ')).toEqual(
      expect.arrayContaining(['textarea', 'validator', 'p-0'])
    )
    expect(
      frame.find('[data-testid="event-payload-editor-gutter"]')
    ).toHaveLength(1)
    expect(frame.find('textarea').attr('class')).not.toContain('textarea')
  })

  test('marks the text invalid for the validator when it could not be read', async () => {
    givenEvent(detail({ payloadRevision: 2 }))

    const { $ } = await server
      .inject({
        method: 'POST',
        url: `${path}/payload/review`,
        payload: 'text=%7B&revision=2&from=',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        auth: { strategy: 'session', credentials }
      })
      .then(({ result }) => ({ $: load(result as unknown as string) }))

    expect(
      $('[data-testid="event-payload-editor-frame"] textarea').attr(
        'aria-invalid'
      )
    ).toBe('true')
  })

  test('holds the heading row at the height the buttons gave it, unseen', async () => {
    const view = (await viewPage()).$
    const buttonsInView = view('[data-testid="event-payload-actions"] a')
      .map((_, button) => view(button).contents().first().text())
      .get()
    const { $ } = await viewPage(`${path}?edit=payload`)
    const placeholder = $('[data-testid="event-payload-actions-placeholder"]')

    expect(placeholder.attr('class')).toContain('invisible')
    expect(placeholder.attr('aria-hidden')).toBe('true')
    expect(placeholder.find('a, button')).toHaveLength(0)
    expect(
      placeholder
        .children()
        .map((_, button) => $(button).text())
        .get()
    ).toEqual(buttonsInView)
  })

  test('posts the text, the revision and the list query to the review', async () => {
    const { $ } = await viewPage(
      `${path}?edit=payload&from=${encodeURIComponent('?status=DEAD_LETTER')}`
    )

    const form = $('[data-testid="event-payload-editor-form"]')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(`${path}/payload/review#payload`)
    expect(form.find('textarea').attr('name')).toBe('text')
    expect(
      $('[data-testid="event-payload-editor-revision"]').attr('value')
    ).toBe('2')
    expect($('[data-testid="event-payload-editor-from"]').attr('value')).toBe(
      '?status=DEAD_LETTER'
    )
  })

  test('names the textarea by the card heading and puts focus in it', async () => {
    const { $ } = await viewPage(`${path}?edit=payload`)

    const text = $('[data-testid="event-payload-editor-text"]')

    expect(text.attr('aria-labelledby')).toBe('payload-heading')
    expect(text.is('[data-focus-on-arrival]')).toBe(true)
    expect(text.attr('wrap')).toBe('off')
    expect(text.attr('spellcheck')).toBe('false')
  })

  test('reviews with a neutral button and discards with a link back to the page', async () => {
    const { $ } = await viewPage(`${path}?edit=payload`)

    expect(
      flatten($('[data-testid="event-payload-editor-review"]').text())
    ).toBe('Review changes')
    expect($('[data-testid="event-payload-editor-review"]').attr('class')).toBe(
      'btn btn-neutral'
    )
    expect($('[data-testid="event-payload-editor-discard"]').attr('href')).toBe(
      `${path}#payload`
    )
    expect(
      $('[data-testid="event-payload-editor-discard"]')
        .contents()
        .first()
        .text()
    ).toBe('Discard')
    expect(
      flatten($('[data-testid="event-payload-editor-discard"]').text())
    ).toBe('Discard changes')
    expect(
      $('[data-testid="event-payload-editor-discard"] .sr-only').text()
    ).toBe(' changes')
  })

  test('leaves the gutter for the element to draw, hidden from assistive technology', async () => {
    const { $ } = await viewPage(`${path}?edit=payload`)

    const gutter = $('[data-testid="event-payload-editor-gutter"]')

    expect(gutter.attr('aria-hidden')).toBe('true')
    expect(gutter.attr('hidden')).toBeDefined()
  })

  test('opens no editor on an event the service cannot edit', async () => {
    givenEvent(detail())

    const { $ } = await viewPage(`${path}?edit=payload`)

    expect($('[data-testid="event-payload-editor"]')).toHaveLength(0)
    expect($('[data-testid="event-payload"]')).toHaveLength(1)
  })

  test('warns in the editor when the stored payload is not plain JSON, and nowhere else', async () => {
    givenEvent(detail({ payloadRevision: 2, payloadIsPlainJson: false }))

    const editing = await viewPage(`${path}?edit=payload`)
    const reading = await viewPage()

    expect(
      editing.$(
        '[data-testid="event-payload-editor"] [data-testid="event-plain-json-warning"]'
      )
    ).toHaveLength(1)
    expect(
      editing.$('[data-testid="event-plain-json-warning"]').next().is('form')
    ).toBe(true)
    expect(reading.$('[data-testid="event-plain-json-warning"]')).toHaveLength(
      0
    )
  })

  test('renders a payload carrying markup as text inside the textarea', async () => {
    givenEvent(
      detail({
        payloadRevision: 2,
        payload: { note: `</textarea>${xss}` }
      })
    )

    const { $ } = await viewPage(`${path}?edit=payload`)

    expect($('main script')).toHaveLength(0)
    expect($('[data-testid="event-payload-editor-text"]').text()).toContain(
      `</textarea>${xss}`
    )
  })
})
