import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import type { PurgeResult } from '../use-cases/purge-event.use-case.ts'
import { purgeEventUseCase } from '../use-cases/purge-event.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/purge-event.use-case.ts'))
vi.mock(import('../use-cases/get-event.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}/purge`
const page = `/dev-ops/events/gas/outbox/${id}`
const anotherPage = '/dev-ops/events/gas/outbox/665f1c2e9a1b2c3d4e5f6a7c'

const xss = '<script>alert(1)</script>'

const event: EventDetail = {
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '3f2c1a0e-1111-2222-3333-444455556666',
  type: 'case.status.updated',
  eventType: 'CaseStatusUpdated',
  targetTopic: 'gas__sns__update_case_status_fifo',
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-06-16T10:00:00.000Z',
  lastError: null,
  attemptHistory: [],
  payload: { id: '3f2c1a0e' },
  completionDate: null,
  purgeDeletionDate: '2026-09-14T09:00:00.000Z',
  lastResubmissionDate: null,
  lastRedrive: null
}

const givenOutcome = (
  outcome: PurgeResult['outcome'],
  status: PurgeResult['status'] = null
) => vi.mocked(purgeEventUseCase).mockResolvedValue({ outcome, status })

const givenEvent = (overrides: Partial<EventDetail> = {}) =>
  vi
    .mocked(getEventUseCase)
    .mockResolvedValue({ outcome: 'found', event: { ...event, ...overrides } })

/** The write re-reads the event before it purges, so that read and the page's own can differ. */
const givenPurgeableOnce = () =>
  vi.mocked(getEventUseCase).mockResolvedValueOnce({ outcome: 'found', event })

const purge = async (payload: Record<string, string> = {}, url = path) =>
  server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials }
  })

const good = { reasonCode: 'BROKEN_PAYLOAD', note: 'sheetId is a number' }

/** Five lines and four breaks: 500 characters as the page counts them. */
const multiLineNote = [
  'a'.repeat(100),
  'b'.repeat(100),
  'c'.repeat(100),
  'd'.repeat(100),
  'e'.repeat(96)
].join('\n')

const asSubmitted = multiLineNote.replace(/\n/g, '\r\n')

const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  (response.headers['set-cookie'] as string[])[0].split(';')[0]

const follow = async (cookie: string, url = page): Promise<CheerioAPI> => {
  const { result } = await server.inject({
    method: 'GET',
    url,
    // UK time, the setting these expectations are written in.
    headers: { cookie: `${cookie}; dev-ops-times=uk` },
    auth: { strategy: 'session', credentials }
  })

  return load(result as unknown as string)
}

const purgeAndFollow = async (payload: Record<string, string> = good) => {
  const written = await purge(payload)
  const cookie = sessionCookie(written)
  const location = written.headers.location as string

  return { cookie, location, $: await follow(cookie, location.split('#')[0]) }
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const valueOf = ($: CheerioAPI, testId: string) =>
  flatten($(`[data-testid="${testId}"]`).text())

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenOutcome('purged')
  givenEvent()
})

afterAll(async () => {
  await server.stop()
})

describe('purgeEventRoute', () => {
  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: path,
      payload: good
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(purgeEventUseCase).not.toHaveBeenCalled()
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: path,
      payload: good,
      auth: {
        strategy: 'session',
        credentials: {
          user: { name: 'Ada Lovelace' },
          scope: ['FCP.GrantApplicationsAdmin']
        }
      }
    })

    expect(statusCode).toBe(statusCodes.forbidden)
    expect(purgeEventUseCase).not.toHaveBeenCalled()
  })

  test('asks the use case to purge the event at this address, naming the operator', async () => {
    await purge(good)

    expect(purgeEventUseCase).toHaveBeenCalledTimes(1)
    expect(purgeEventUseCase).toHaveBeenCalledWith(
      { service: 'gas', box: 'outbox', id },
      good,
      'Ada Lovelace'
    )
  })

  test('sends a coded reason with no note as an empty one', async () => {
    await purge({ reasonCode: 'SENT_IN_ERROR' })

    expect(purgeEventUseCase).toHaveBeenCalledWith(
      expect.any(Object),
      { reasonCode: 'SENT_IN_ERROR', note: '' },
      'Ada Lovelace'
    )
  })

  test('trims the note before it judges it or sends it', async () => {
    await purge({ reasonCode: 'BROKEN_PAYLOAD', note: '  spaced  ' })

    expect(purgeEventUseCase).toHaveBeenCalledWith(
      expect.any(Object),
      { reasonCode: 'BROKEN_PAYLOAD', note: 'spaced' },
      'Ada Lovelace'
    )
  })

  test('accepts a note of exactly 500 counted characters sent with CRLF breaks', async () => {
    expect(multiLineNote).toHaveLength(500)
    expect(asSubmitted).toHaveLength(504)

    const { statusCode, headers } = await purge({
      reasonCode: 'BROKEN_PAYLOAD',
      note: asSubmitted
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(page)
    expect(purgeEventUseCase).toHaveBeenCalledWith(
      expect.any(Object),
      { reasonCode: 'BROKEN_PAYLOAD', note: multiLineNote },
      'Ada Lovelace'
    )
  })

  test.each([
    ['a service it does not know', `/dev-ops/events/other/outbox/${id}/purge`],
    ['a box it does not know', `/dev-ops/events/gas/sideways/${id}/purge`],
    ['an id that is not an object id', '/dev-ops/events/gas/outbox/x/purge']
  ])('refuses %s', async (_name, url) => {
    const { statusCode } = await purge(good, url)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(purgeEventUseCase).not.toHaveBeenCalled()
  })

  test('redirects back to the event and says nothing in the url', async () => {
    const { statusCode, headers } = await purge(good)

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(page)
  })

  test('carries the list query through the write', async () => {
    const { headers } = await purge({
      ...good,
      back: '/dev-ops/events/gas/outbox?status=DEAD_LETTER&cursor=END'
    })

    expect(headers.location).toBe(
      `${page}?back=%2Fdev-ops%2Fevents%2Fgas%2Foutbox%3Fstatus%3DDEAD_LETTER%26cursor%3DEND`
    )
  })

  test.each([
    ['an absolute url', 'https://example.com/phish'],
    ['a protocol-relative url', '//example.com'],
    ['a path outside the admin', '/grant-ops']
  ])('drops %s rather than redirecting through it', async (_name, from) => {
    const { headers } = await purge({ ...good, back: from })

    expect(headers.location).toBe(page)
  })

  test('accepts a post with no body at all, and reports the missing reason', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: path,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}?confirm=purge#payload`)
    expect(purgeEventUseCase).not.toHaveBeenCalled()
  })

  test('refuses a back link longer than any query this app writes', async () => {
    const { statusCode } = await purge({
      ...good,
      back: `?q=${'x'.repeat(2100)}`
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(purgeEventUseCase).not.toHaveBeenCalled()
  })

  test('cuts a note far past the limit at the bound the session stores', async () => {
    const { location, $ } = await purgeAndFollow({
      ...good,
      note: 'x'.repeat(9000)
    })

    expect(location).toBe(`${page}?confirm=purge#payload`)
    expect(purgeEventUseCase).not.toHaveBeenCalled()
    expect(valueOf($, 'event-purge-error')).toContain(
      'Shorten the note to 500 characters or fewer.'
    )
    expect($('#purge-note').text()).toBe('x'.repeat(2000))
    expect(valueOf($, 'event-purge-note-field-count')).toBe('2000 / 500')
    expect(
      $('[data-testid="event-purge-reason-input"][checked]').attr('value')
    ).toBe('BROKEN_PAYLOAD')
  })

  test('refuses a field the form does not have', async () => {
    const { statusCode } = await purge({ ...good, confirm: 'yes' })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(purgeEventUseCase).not.toHaveBeenCalled()
  })

  test('answers no GET at the purge address', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: path,
      auth: { strategy: 'session', credentials }
    })

    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('a purge form the admin refused', () => {
  test.each([
    ['no reason at all', {}, 'Choose a reason.'],
    [
      'a reason it does not know',
      { reasonCode: 'SUPERSEDED' },
      'Choose a reason.'
    ],
    [
      'Other with no note',
      { reasonCode: 'OTHER' },
      "Enter a note. It's required when the reason is Other."
    ],
    [
      'Other with a note of spaces',
      { reasonCode: 'OTHER', note: '   ' },
      "Enter a note. It's required when the reason is Other."
    ],
    [
      'a note past the limit',
      { reasonCode: 'BROKEN_PAYLOAD', note: 'x'.repeat(501) },
      'Shorten the note to 500 characters or fewer.'
    ]
  ])(
    'sends %s back to the panel it came from',
    async (_name, payload, said) => {
      const { location, $ } = await purgeAndFollow(
        payload as Record<string, string>
      )

      expect(location).toBe(`${page}?confirm=purge#payload`)
      expect(purgeEventUseCase).not.toHaveBeenCalled()
      expect($('[data-testid="event-purge-confirm"]')).toHaveLength(1)
      expect(valueOf($, 'event-purge-error')).toContain(said)
    }
  )

  test('keeps the reason and the note the operator typed', async () => {
    const { $ } = await purgeAndFollow({
      reasonCode: 'OTHER',
      note: 'x'.repeat(501)
    })

    expect(
      $('[data-testid="event-purge-reason-input"][checked]').attr('value')
    ).toBe('OTHER')
    expect($('#purge-note').text()).toBe('x'.repeat(501))
    expect(valueOf($, 'event-purge-note-field-count')).toBe('501 / 500')
  })

  test('marks the note invalid and sends the alert at it', async () => {
    const { $ } = await purgeAndFollow({ reasonCode: 'OTHER' })

    const alert = $('[data-testid="event-purge-error"]')

    expect(alert.attr('role')).toBe('alert')
    expect(alert.attr('tabindex')).toBe('-1')
    expect(alert.attr('data-focus-on-arrival')).toBeDefined()
    expect($('[data-testid="event-purge-error-link"]').attr('href')).toBe(
      '#purge-note'
    )
    expect($('#purge-note').attr('aria-invalid')).toBe('true')
    expect($('#purge-note').attr('aria-describedby')).toBe(
      'purge-note-hint purge-note-help'
    )
  })

  test('sends the alert at the first radio when no reason was chosen', async () => {
    const { $ } = await purgeAndFollow({})

    expect($('[data-testid="event-purge-error-link"]').attr('href')).toBe(
      '#purge-reason-BROKEN_PAYLOAD'
    )
    expect($('#purge-note').attr('aria-invalid')).toBeUndefined()
  })

  test('says under the legend what is wrong with the reason', async () => {
    const { $ } = await purgeAndFollow({})

    const fieldset = $('[data-testid="event-purge-reasons"]')
    const message = $('[data-testid="event-purge-reasons-message"]')

    expect(message.text()).toBe('Choose a reason.')
    expect(message.attr('id')).toBe('purge-reason-hint')
    expect(fieldset.attr('aria-describedby')).toBe('purge-reason-hint')
    expect(message.prev().is('legend')).toBe(true)
    expect(valueOf($, 'event-purge-error')).toContain('Choose a reason.')
  })

  test('says nothing under the legend when the reason was fine', async () => {
    const { $ } = await purgeAndFollow({ reasonCode: 'OTHER' })

    expect($('[data-testid="event-purge-reasons-message"]')).toHaveLength(0)
    expect(
      $('[data-testid="event-purge-reasons"]').attr('aria-describedby')
    ).toBeUndefined()
  })

  test('counts a CRLF note back the way the page counted it', async () => {
    const { $ } = await purgeAndFollow({ reasonCode: '', note: asSubmitted })

    expect(valueOf($, 'event-purge-note-field-count')).toBe('500 / 500')
    expect($('#purge-note').text()).toBe(multiLineNote)
  })

  test('leaves exactly one thing to focus on arrival', async () => {
    const { $ } = await purgeAndFollow({ reasonCode: 'OTHER' })

    expect($('[data-focus-on-arrival]')).toHaveLength(1)
    expect(
      $('[data-testid="event-purge-heading"]').attr('data-focus-on-arrival')
    ).toBeUndefined()
  })

  test('keeps the way back to the list the operator came from', async () => {
    const { location } = await purgeAndFollow({
      reasonCode: 'OTHER',
      back: '/dev-ops/events/gas/outbox?status=DEAD_LETTER'
    })

    expect(location).toBe(
      `${page}?back=%2Fdev-ops%2Fevents%2Fgas%2Foutbox%3Fstatus%3DDEAD_LETTER&confirm=purge#payload`
    )
  })

  test('is gone by the next refresh of the page', async () => {
    const { cookie } = await purgeAndFollow({ reasonCode: 'OTHER' })
    const $ = await follow(cookie, `${page}?confirm=purge`)

    expect($('[data-testid="event-purge-error"]')).toHaveLength(0)
    expect($('#purge-note').text()).toBe('')
  })

  test('is dropped, not moved, when another event is opened first', async () => {
    const cookie = sessionCookie(await purge({ reasonCode: 'OTHER' }))

    await follow(cookie, `${anotherPage}?confirm=purge`)

    expect(
      (await follow(cookie, `${page}?confirm=purge`))(
        '[data-testid="event-purge-error"]'
      )
    ).toHaveLength(0)
  })

  test('renders a note carrying markup as text', async () => {
    const { $ } = await purgeAndFollow({ reasonCode: '', note: xss })

    expect($('#purge-note').text()).toBe(xss)
    expect($('main script')).toHaveLength(0)
    expect($('script:not([src^="/public/"])')).toHaveLength(0)
  })
})

describe('the message a purge leaves behind', () => {
  test.each([
    ['purged', null, 'alert-success', 'Purged.'],
    [
      'conflict',
      'Resubmitted',
      'alert-warning',
      'Not purged — this event is no longer dead-lettered. Its status is now Resubmitted.'
    ],
    ['not-found', null, 'alert-error', 'no longer has this event'],
    ['rejected', null, 'alert-error', 'refused the request'],
    ['timed-out', null, 'alert-warning', 'Purge status unknown'],
    ['unavailable', null, 'alert-error', 'could not be reached']
  ] as const)('says a %s outcome', async (outcome, status, role, said) => {
    givenOutcome(outcome, status)

    const { $ } = await purgeAndFollow()
    const banner = $('[data-testid="event-banner"]')

    expect(banner.attr('class')).toContain(role)
    expect(flatten(banner.text())).toContain(said)
  })

  test('says a rejected purge was refused, not that the backend was unreachable', async () => {
    givenOutcome('rejected', null)

    const { $ } = await purgeAndFollow()
    const said = flatten($('[data-testid="event-banner"]').text())

    expect(said).toBe(
      'Not purged — fg-gas-backend refused the request. Nothing has changed.'
    )
    expect(said).not.toContain('could not be reached')
  })

  test('reads the deletion date off the event, not off the answer to the write', async () => {
    givenEvent({
      status: 'PURGED',
      statusLabel: 'Purged',
      statusRole: 'neutral',
      purgeDeletionDate: null,
      expiresAt: '2026-09-14T09:00:00.000Z'
    })
    givenPurgeableOnce()

    const { $ } = await purgeAndFollow()

    expect(flatten($('[data-testid="event-banner"]').text())).toBe(
      'Purged. It will be deleted on 14 Sep 2026 10:00:00.000.'
    )
  })

  test('draws the success banner solid, with the check icon', async () => {
    const { $ } = await purgeAndFollow()
    const banner = $('[data-testid="event-banner"]')

    expect(banner.attr('class')).not.toContain('alert-soft')
    expect(banner.find('[data-testid="do-icon-circle-check"]')).toHaveLength(1)
    expect(
      banner.find('[data-testid="do-icon-exclamation-triangle"]')
    ).toHaveLength(0)
  })

  test('escapes a conflicting status carrying markup', async () => {
    givenOutcome('conflict', xss)

    const { $ } = await purgeAndFollow()
    const banner = $('[data-testid="event-banner"]')

    expect(banner.find('script')).toHaveLength(0)
    expect(banner.text()).toContain(xss)
  })

  test('is gone by the next refresh of the page', async () => {
    const { cookie } = await purgeAndFollow()

    expect((await follow(cookie))('[data-testid="event-banner"]')).toHaveLength(
      0
    )
  })

  test('is dropped, not moved, when another event is opened first', async () => {
    const cookie = sessionCookie(await purge(good))

    await follow(cookie, anotherPage)

    expect((await follow(cookie))('[data-testid="event-banner"]')).toHaveLength(
      0
    )
  })
})

/**
 * The page draws the button behind a gate, but the tab it drew it in may have
 * been open for an hour. The backend fences the write; this is about what the
 * operator is told.
 */
describe('a purge of an event that has moved on since the page was drawn', () => {
  test('reads the event back before it writes', async () => {
    await purge(good)

    expect(getEventUseCase).toHaveBeenCalledWith({
      service: 'gas',
      box: 'outbox',
      id
    })
  })

  test.each([
    ['is no longer dead-lettered', { status: 'PURGED', statusLabel: 'Purged' }],
    [
      'the owning service no longer offers for purge',
      { purgeDeletionDate: null }
    ]
  ])('does not purge one that %s', async (_name, overrides) => {
    givenEvent(overrides)

    const { location } = await purgeAndFollow()

    expect(purgeEventUseCase).not.toHaveBeenCalled()
    expect(location).toBe(page)
  })

  test('says what the event is now rather than that it has gone', async () => {
    givenEvent({
      status: 'RESUBMITTED',
      statusLabel: 'Resubmitted',
      statusRole: 'info',
      purgeDeletionDate: null
    })

    const { $ } = await purgeAndFollow()
    const banner = $('[data-testid="event-banner"]')

    expect(banner.attr('class')).toContain('alert-warning')
    expect(flatten(banner.text())).toBe(
      'Not purged — this event is no longer dead-lettered. Its status is now Resubmitted.'
    )
  })

  test('purges all the same when the event cannot be read back', async () => {
    vi.mocked(getEventUseCase).mockResolvedValueOnce({
      outcome: 'unavailable',
      event: null
    })

    await purge(good)

    expect(purgeEventUseCase).toHaveBeenCalledTimes(1)
  })

  test('keeps the operator out of the use case when the form is wrong anyway', async () => {
    givenEvent({ status: 'PURGED', statusLabel: 'Purged' })

    await purge({ reasonCode: 'OTHER' })

    expect(getEventUseCase).not.toHaveBeenCalled()
    expect(purgeEventUseCase).not.toHaveBeenCalled()
  })
})
