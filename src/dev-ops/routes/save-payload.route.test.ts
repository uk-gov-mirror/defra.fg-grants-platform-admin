import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { logger } from '../../common/logger.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type { EditResult } from '../use-cases/edit-payload.use-case.ts'
import { editPayloadUseCase } from '../use-cases/edit-payload.use-case.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'

vi.mock(import('../use-cases/edit-payload.use-case.ts'))
vi.mock(import('../use-cases/get-event.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}/payload`
const page = `/dev-ops/events/gas/outbox/${id}`

const secret = 'SBI-106284736'
const secretNote = 'Jane Doe rang to say the sheet id was typed as a number'

const stored = { data: { sbi: secret, sheetId: 12345 } }

const event: EventDetail = {
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
  lastError: null,
  attemptHistory: [],
  payload: stored,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  payloadRevision: 3
}

const edited = JSON.stringify(stored, null, 2).replace('12345', '"12345"')

const good = { text: edited, revision: '3', note: secretNote }

const givenEvent = (overrides: Partial<EventDetail> = {}) =>
  vi
    .mocked(getEventUseCase)
    .mockResolvedValue({ outcome: 'found', event: { ...event, ...overrides } })

const givenOutcome = (
  outcome: EditResult['outcome'],
  extra: Partial<EditResult> = {}
) =>
  vi
    .mocked(editPayloadUseCase)
    .mockResolvedValue({ outcome, status: null, reason: null, ...extra })

/** Sent the way a browser sends the form: url-encoded, with every line break as CRLF. */
const save = async (fields: Record<string, string>) =>
  server.inject({
    method: 'POST',
    url: path,
    payload: new URLSearchParams(
      Object.entries({ from: '', ...fields }).map(([name, value]) => [
        name,
        value.replace(/\n/g, '\r\n')
      ])
    ).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    auth: { strategy: 'session', credentials }
  })

const savePage = async (fields: Record<string, string>) => {
  const response = await save(fields)

  return { ...response, $: load(response.result as unknown as string) }
}

const sessionCookie = (response: { headers: Record<string, unknown> }) =>
  (response.headers['set-cookie'] as string[])[0].split(';')[0]

const saveAndFollow = async (fields: Record<string, string> = good) => {
  const written = await save(fields)
  const { result } = await server.inject({
    method: 'GET',
    // A browser never sends the fragment.
    url: (written.headers.location as string).split('#')[0],
    headers: { cookie: sessionCookie(written) },
    auth: { strategy: 'session', credentials }
  })

  return load(result as unknown as string)
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

const valueOf = ($: CheerioAPI, testId: string) =>
  flatten($(`[data-testid="${testId}"]`).text())

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const logged = (['debug', 'info', 'warn', 'error'] as const).map((level) =>
  vi.spyOn(logger, level)
)

const everythingLogged = () =>
  JSON.stringify(logged.map((spy) => spy.mock.calls))

let server: Server

beforeAll(async () => {
  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  givenEvent()
  givenOutcome('saved')
})

afterAll(async () => {
  await server.stop()
})

describe('savePayloadRoute', () => {
  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: path,
      payload: good
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
    expect(editPayloadUseCase).not.toHaveBeenCalled()
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
    expect(editPayloadUseCase).not.toHaveBeenCalled()
  })

  test('saves the payload read from the text, the trimmed note and the revision, naming the operator', async () => {
    await save({ ...good, note: `  ${secretNote}\n` })

    expect(editPayloadUseCase).toHaveBeenCalledTimes(1)
    expect(editPayloadUseCase).toHaveBeenCalledWith(
      { service: 'gas', box: 'outbox', id },
      {
        payload: { data: { sbi: secret, sheetId: '12345' } },
        note: secretNote,
        revision: 3
      },
      'Ada Lovelace'
    )
  })

  test('saves without reading the event first: the backend fences the write', async () => {
    await save(good)

    expect(getEventUseCase).not.toHaveBeenCalled()
  })

  test('redirects back to the event and its banner, saying nothing in the url', async () => {
    const { statusCode, headers } = await save(good)

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(`${page}#event-banner`)
  })

  test('carries the list query through the write', async () => {
    const { headers } = await save({ ...good, from: '?status=DEAD_LETTER' })

    expect(headers.location).toBe(
      `${page}?from=%3Fstatus%3DDEAD_LETTER#event-banner`
    )
  })

  test('drops a from that is not a query string rather than redirecting through it', async () => {
    const { headers } = await save({ ...good, from: '//example.com' })

    expect(headers.location).toBe(`${page}#event-banner`)
  })

  test('says on the page it lands on that the payload was saved, and focuses that', async () => {
    const $ = await saveAndFollow()

    const banner = part($, 'event-banner')

    expect(flatten(banner.text())).toBe(
      "Payload saved. The event is still a dead letter and hasn't been retried."
    )
    expect(banner.is('[data-focus-on-arrival]')).toBe(true)
    expect(banner.attr('id')).toBe('event-banner')
  })

  test.each([
    [
      'conflict',
      { status: 'Completed' },
      "Not saved — this event can't be edited. Its status is now Completed."
    ],
    [
      'refused',
      { reason: 'DOLLAR_KEY' },
      "Not saved — a key starts with $, which can't be stored. Nothing has changed."
    ],
    [
      'timed-out',
      {},
      'Save status unknown — refresh to check whether your change went through.'
    ]
  ] as const)(
    'says what happened to a %s save on the page it lands on',
    async (outcome, extra, said) => {
      givenOutcome(outcome, extra)

      const $ = await saveAndFollow()

      expect(valueOf($, 'event-banner')).toBe(said)
    }
  )

  test('re-renders the review when the note is missing, alert focused and linked to the note', async () => {
    const { $, statusCode, headers } = await savePage({ ...good, note: ' ' })

    const alert = part($, 'event-edit-error')

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers.location).toBeUndefined()
    expect(flatten(alert.text())).toBe(
      "Couldn't save. Enter a note saying why you are changing it."
    )
    expect(alert.is('[data-focus-on-arrival]')).toBe(true)
    expect(part($, 'event-edit-error-link').attr('href')).toBe('#edit-note')
    expect($('#edit-note').attr('aria-invalid')).toBe('true')
    expect($('[data-focus-on-arrival]')).toHaveLength(1)
    expect(editPayloadUseCase).not.toHaveBeenCalled()
  })

  test('keeps a note that is too long, and the text, on the re-rendered review', async () => {
    const long = 'a'.repeat(501)
    const { $ } = await savePage({ ...good, note: long })

    expect(valueOf($, 'event-edit-note-field-message')).toBe(
      'Shorten the note to 500 characters or fewer.'
    )
    expect($('#edit-note').text()).toBe(long)
    expect(part($, 'event-edit-text').attr('value')).toBe(edited)
    expect(part($, 'event-payload-diff-added')).toHaveLength(1)
  })

  test('takes a note of exactly 500 counted characters sent with CRLF breaks', async () => {
    const note = `${'a'.repeat(249)}\n${'b'.repeat(250)}`

    const { statusCode } = await save({ ...good, note })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(editPayloadUseCase).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ note }),
      'Ada Lovelace'
    )
  })

  test('keeps the plain JSON warning on a review re-rendered for its note', async () => {
    givenEvent({ payloadIsPlainJson: false })

    const { $ } = await savePage({ ...good, note: '' })

    expect(part($, 'event-plain-json-warning')).toHaveLength(1)
    expect(part($, 'event-edit-error')).toHaveLength(1)
  })

  test('reads the hidden text again, and sends a broken one back to the editor', async () => {
    const broken = edited.replace('"12345"', '"12345",')
    const { $ } = await savePage({ ...good, text: broken })

    expect(valueOf($, 'event-payload-heading')).toBe('Edit payload')
    expect(valueOf($, 'event-payload-editor-alert')).toContain(
      "Couldn't read the payload. Expected a property name in double quotes at line 5, column 3."
    )
    expect(part($, 'event-payload-editor-text').text()).toBe(broken)
    expect(editPayloadUseCase).not.toHaveBeenCalled()
  })

  test('says straight away, on a re-render, that the payload changed since the editor opened', async () => {
    givenEvent({ payloadRevision: 4 })

    const { $ } = await savePage({ ...good, note: '' })

    expect(valueOf($, 'event-payload-editor-alert')).toContain(
      'the payload changed while you were editing'
    )
    expect(part($, 'event-payload-editor-text').text()).toBe(edited)
  })

  test('puts a save the service calls stale back in the editor, text kept, against the payload as it is now', async () => {
    givenOutcome('stale')
    const current = { data: { sbi: secret, sheetId: 12345, parcelId: '0001' } }
    givenEvent({ payloadRevision: 4, payload: current })

    const { $, statusCode, headers } = await savePage(good)
    const alert = part($, 'event-payload-editor-alert')

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers.location).toBeUndefined()
    expect(flatten(alert.text())).toMatch(
      /^Not saved — the payload changed while you were editing\. /
    )
    expect(alert.is('[data-focus-on-arrival]')).toBe(true)
    expect($('[data-focus-on-arrival]')).toHaveLength(1)
    expect(flatten(alert.text())).not.toContain('Reload the page')
    expect(part($, 'event-payload-editor-text').text()).toBe(edited)
    expect(part($, 'event-payload-editor-revision').attr('value')).toBe('4')
    expect(part($, 'event-payload-current')).toHaveLength(1)
    expect(part($, 'event-payload-editor-form').attr('action')).toBe(
      `${page}/payload/review#payload`
    )
  })

  test('calls a save stale on the word of the service, even where the page reads the same revision', async () => {
    givenOutcome('stale')

    const { $ } = await savePage(good)

    expect(part($, 'event-payload-editor-alert')).toHaveLength(1)
    expect(part($, 'event-payload-editor-text').text()).toBe(edited)
  })

  test('answers every re-render with no-store', async () => {
    const { headers } = await save({ ...good, note: '' })

    expect(headers['cache-control']).toBe('no-store')
  })

  test('refuses a form with no revision', async () => {
    const { statusCode } = await save({ text: edited, note: secretNote })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(editPayloadUseCase).not.toHaveBeenCalled()
  })

  test('writes neither the payload nor the note to the log, whatever happens', async () => {
    await save(good)
    await save({ ...good, note: '' })
    await save({ ...good, text: edited.replace('"12345"', '"12345",') })

    expect(everythingLogged()).not.toContain(secret)
    expect(everythingLogged()).not.toContain('Jane Doe')
    expect(everythingLogged()).not.toContain('sheetId')
  })

  test('renders a note carrying markup as text on the re-rendered review', async () => {
    const note = `</textarea><script>alert(1)</script>${'x'.repeat(500)}`
    const { $ } = await savePage({ ...good, note })

    expect($('main script')).toHaveLength(0)
    expect($('#edit-note').text()).toBe(note)
  })
})
