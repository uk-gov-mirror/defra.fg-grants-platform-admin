import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { logger } from '../../common/logger.ts'
import { createServer } from '../../server/index.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { devOps } from '../index.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'

vi.mock(import('../use-cases/get-event.use-case.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}/payload/review`
const page = `/dev-ops/events/gas/outbox/${id}`

const secret = 'SBI-106284736'

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

const storedText = JSON.stringify(stored, null, 2)

const edited = storedText.replace('12345', '"12345"')

const givenEvent = (overrides: Partial<EventDetail> = {}) =>
  vi
    .mocked(getEventUseCase)
    .mockResolvedValue({ outcome: 'found', event: { ...event, ...overrides } })

/** Sent the way a browser sends the form: url-encoded, with every line break as CRLF. */
const review = async (fields: Record<string, string>, url = path) =>
  server.inject({
    method: 'POST',
    url,
    payload: new URLSearchParams(
      Object.entries({ revision: '3', from: '', ...fields }).map(
        ([name, value]) => [name, value.replace(/\n/g, '\r\n')]
      )
    ).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    auth: { strategy: 'session', credentials }
  })

const reviewPage = async (fields: Record<string, string>) => {
  const response = await review(fields)

  return { ...response, $: load(response.result as unknown as string) }
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
})

afterAll(async () => {
  await server.stop()
})

describe('reviewPayloadRoute', () => {
  test('redirects an anonymous user to login', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: path,
      payload: { text: edited, revision: 3 }
    })

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe('/auth/login')
  })

  test('forbids a signed in user without the operations admin role', async () => {
    const { statusCode } = await server.inject({
      method: 'POST',
      url: path,
      payload: { text: edited, revision: 3 },
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

  test.each([
    ['no revision', { revision: '' }],
    ['a revision that is not a count', { revision: '-1' }]
  ])('refuses a form with %s', async (_name, fields) => {
    const { statusCode } = await review({ text: edited, ...fields })

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('answers with the page itself, never a redirect', async () => {
    const { statusCode, headers } = await review({ text: edited })

    expect(statusCode).toBe(statusCodes.ok)
    expect(headers.location).toBeUndefined()
  })

  test('renames the card and puts focus on its heading', async () => {
    const { $ } = await reviewPage({ text: edited })

    const heading = part($, 'event-payload-heading')

    expect(flatten(heading.text())).toBe('Review your changes')
    expect(heading.attr('tabindex')).toBe('-1')
    expect(heading.is('[data-focus-on-arrival]')).toBe(true)
    expect($('[data-focus-on-arrival]')).toHaveLength(1)
  })

  test('shows the changed line as removed and added, and says so in words', async () => {
    const { $ } = await reviewPage({ text: edited })

    expect(part($, 'event-payload-diff-removed').find('code').text()).toBe(
      'Removed line 4:     "sheetId": 12345'
    )
    expect(part($, 'event-payload-diff-added').find('code').text()).toBe(
      'Added line 4:     "sheetId": "12345"'
    )
    expect(part($, 'event-payload-diff-removed').find('.sr-only').text()).toBe(
      'Removed line 4: '
    )
    expect(part($, 'event-payload-diff').attr('aria-label')).toBe(
      'What changed'
    )
  })

  test('folds unchanged lines far from the change', async () => {
    const long = JSON.stringify(
      {
        ...Object.fromEntries(
          Array.from({ length: 10 }, (_, index) => [`k${index}`, index])
        ),
        sheetId: 12345
      },
      null,
      2
    )

    givenEvent({ payload: JSON.parse(long) })

    const { $ } = await reviewPage({
      text: long.replace('12345', '"12345"')
    })

    expect(valueOf($, 'event-payload-diff-skipped')).toBe('8 unchanged lines')
  })

  test('formats the text before it is reviewed, and carries that in the page body', async () => {
    const compact = JSON.stringify({ data: { sbi: secret, sheetId: '1' } })
    const { $ } = await reviewPage({ text: compact })

    expect(part($, 'event-edit-text').attr('type')).toBe('hidden')
    expect(part($, 'event-edit-text').attr('value')).toBe(
      JSON.stringify(JSON.parse(compact), null, 2)
    )
    expect(part($, 'event-edit-revision').attr('value')).toBe('3')
    expect(part($, 'event-edit-form').attr('action')).toBe(
      `${page}/payload#payload`
    )
    expect(
      part($, 'event-payload-to-save-lines-line')
        .toArray()
        .map((line) => $(line).text())
    ).toHaveLength(6)
  })

  test('puts the text in neither a url nor the session', async () => {
    const { $, headers } = await reviewPage({ text: edited })

    const urls = $('[href], [action], [formaction]')
      .toArray()
      .flatMap((element) =>
        ['href', 'action', 'formaction'].map((name) => $(element).attr(name))
      )
      .join(' ')

    expect(urls).not.toContain('sheetId')
    expect(urls).not.toContain(secret)
    expect(headers['set-cookie']).toBeUndefined()
  })

  test('asks for a note, badged required, counted, with no personal-data hint', async () => {
    const { $ } = await reviewPage({ text: edited })

    expect(valueOf($, 'event-edit-heading')).toBe('Save these changes?')
    expect(valueOf($, 'event-edit-question')).toBe(
      'Your version replaces the stored payload. The edit is audited. The event stays a dead letter — nothing is retried until you redrive it.'
    )
    expect(valueOf($, 'event-edit-note-label')).toBe('Why are you changing it?')
    expect($('label[for="edit-note"]')).toHaveLength(1)
    expect(valueOf($, 'event-edit-note-badge')).toBe('Required')
    expect(valueOf($, 'event-edit-note-field-count')).toBe('0 / 500')
    expect(valueOf($, 'event-edit-note-field-hint')).toBe('')
    expect($('main').text()).not.toContain('personal data')
  })

  test('saves with a neutral button and goes back with a ghost one that posts here', async () => {
    const { $ } = await reviewPage({ text: edited })

    expect(part($, 'event-edit-submit').attr('class')).toBe('btn btn-neutral')
    expect(flatten(part($, 'event-edit-submit').text())).toBe('Confirm save')
    expect(part($, 'event-edit-back').attr('formaction')).toBe(
      `${page}/payload/review#payload`
    )
    expect(part($, 'event-edit-back').attr('name')).toBe('back')
    expect(part($, 'event-edit-back').attr('value')).toBe('edit')
  })

  test('takes the buttons off the card while the review is open', async () => {
    const { $ } = await reviewPage({ text: edited })

    expect(part($, 'event-payload-actions')).toHaveLength(0)
    expect(part($, 'event-payload')).toHaveLength(0)
  })

  test('says a purged event stays purged', async () => {
    givenEvent({ status: 'PURGED', statusLabel: 'Purged' })

    const { $ } = await reviewPage({ text: edited })

    expect(valueOf($, 'event-edit-question')).toContain(
      'The event stays purged'
    )
  })

  test('goes back to the editor with the text as it was sent', async () => {
    const { $ } = await reviewPage({
      text: edited,
      back: 'edit',
      note: 'half a note'
    })

    expect(valueOf($, 'event-payload-heading')).toBe('Edit payload')
    expect(part($, 'event-payload-editor-text').text()).toBe(`${edited}`)
    expect(part($, 'event-payload-editor-alert')).toHaveLength(0)
  })

  test('says where the text stopped being JSON, without quoting it, and links there', async () => {
    const broken = edited.replace('"12345"', '"12345",')
    const { $ } = await reviewPage({ text: broken })

    const alert = part($, 'event-payload-editor-alert')

    expect(flatten(alert.text())).toBe(
      "Couldn't read the payload. Expected a property name in double quotes at line 5, column 3. Go to line 5"
    )
    expect(alert.attr('role')).toBe('alert')
    expect(alert.is('[data-focus-on-arrival]')).toBe(true)
    expect(part($, 'event-payload-editor-go-to').attr('href')).toBe(
      '#payload-text'
    )
    expect(part($, 'event-payload-editor-go-to').attr('data-line')).toBe('5')
    expect(alert.text()).not.toContain(secret)
  })

  test('keeps the broken text in the editor, marked invalid', async () => {
    const broken = edited.replace('"12345"', '"12345",')
    const { $ } = await reviewPage({ text: broken })

    const text = part($, 'event-payload-editor-text')

    expect(text.text()).toBe(broken)
    expect(text.attr('aria-invalid')).toBe('true')
    expect(text.attr('id')).toBe('payload-text')
    expect(text.is('[data-focus-on-arrival]')).toBe(false)
    expect(valueOf($, 'event-payload-heading')).toBe('Edit payload')
  })

  test.each([
    [
      'a __proto__ key',
      '{"__proto__": {"admin": true}}',
      "Couldn't read the payload. It has a key named __proto__, which can't be saved."
    ],
    [
      'an array',
      '[1, 2]',
      "Couldn't use the payload. It must be a JSON object, in braces."
    ],
    [
      'a payload over the bound',
      JSON.stringify({ a: 'x'.repeat(256 * 1024) }),
      'The payload is too large. It must be 256 KiB or smaller once formatted.'
    ]
  ])('says it cannot take %s', async (_name, text, said) => {
    const { $ } = await reviewPage({ text })

    expect(valueOf($, 'event-payload-editor-alert')).toBe(said)
    expect(part($, 'event-payload-editor-go-to')).toHaveLength(0)
  })

  test('says there is nothing to review when the text changes nothing, as a note rather than an error', async () => {
    const { $ } = await reviewPage({ text: JSON.stringify(stored) })

    const alert = part($, 'event-payload-editor-alert')

    expect(flatten(alert.text())).toBe(
      'Nothing to review. The payload is unchanged. Edit it, or discard your changes to leave it as it is.'
    )
    expect(alert.attr('role')).toBe('status')
    expect(alert.attr('class')).not.toContain('alert-error')
    expect(
      part($, 'event-payload-editor-text').attr('aria-invalid')
    ).toBeUndefined()
  })

  test('says straight away when the payload changed since the editor opened, keeping the text', async () => {
    const current = { data: { sbi: secret, sheetId: 12345, parcelId: '0001' } }

    givenEvent({ payloadRevision: 4, payload: current })

    const { $ } = await reviewPage({ text: edited })
    const alert = part($, 'event-payload-editor-alert')

    expect(valueOf($, 'event-payload-editor-alert')).toBe(
      'Not saved — the payload changed while you were editing. ' +
        'Your version is still in the editor. Review it again to compare it with the payload as it is now, shown below it.'
    )
    expect(alert.attr('role')).toBe('alert')
    expect(alert.attr('data-focus-on-arrival')).toBeDefined()
    expect(part($, 'event-payload-editor-text').text()).toBe(edited)
    expect(part($, 'event-payload-editor-revision').attr('value')).toBe('4')
    expect(
      part($, 'event-payload-current-lines-line')
        .map((_, line) => $(line).text())
        .get()
    ).toEqual(JSON.stringify(current, null, 2).split('\n'))
    expect(part($, 'event-payload-current').attr('open')).toBeDefined()
    expect(part($, 'event-banner')).toHaveLength(0)
    expect(part($, 'event-payload-review')).toHaveLength(0)
  })

  test('keeps the text when Back to editing finds the payload has changed', async () => {
    givenEvent({ payloadRevision: 4 })

    const { $ } = await reviewPage({ text: edited, back: 'edit' })

    expect(part($, 'event-payload-editor-text').text()).toBe(edited)
    expect(valueOf($, 'event-payload-editor-alert')).toContain(
      'the payload changed while you were editing'
    )
  })

  test('shows no current payload beside an editor that is not stale', async () => {
    const { $ } = await reviewPage({ text: '{' })

    expect(part($, 'event-payload-current')).toHaveLength(0)
  })

  test.each([
    [
      'a key starting with $',
      '{\n  "data": {\n    "$set": 1\n  }\n}',
      "The key at line 3, column 5 starts with $, which can't be saved.",
      '3',
      '5'
    ],
    [
      'a key used twice in one object',
      '{\n  "sbi": 1,\n  "sbi": 2\n}',
      'The key at line 3, column 3 is already used earlier in the same object. Each key can appear only once.',
      '3',
      '3'
    ]
  ])(
    'refuses %s at review, and says where',
    async (_name, text, sentence, line, column) => {
      const { $ } = await reviewPage({ text })
      const goTo = part($, 'event-payload-editor-go-to')

      expect(valueOf($, 'event-payload-editor-alert')).toBe(
        `Couldn't use the payload. ${sentence} Go to line ${line}`
      )
      expect(goTo.attr('data-line')).toBe(line)
      expect(goTo.attr('data-column')).toBe(column)
      expect(part($, 'event-payload-editor-text').text()).toBe(text)
      expect(part($, 'event-payload-review')).toHaveLength(0)
    }
  )

  test('warns at review of a whole number too large to be saved exactly', async () => {
    const text = storedText.replace('12345', '12345678901234567890')

    const { $ } = await reviewPage({ text })
    const warning = part($, 'event-payload-number-warning')

    expect(flatten(warning.text())).toBe(
      'The number on line 4 is too large to be saved exactly, so it will be saved rounded, as shown. Put it in quotes if every digit matters.'
    )
    expect(warning.attr('role')).toBe('status')
    expect(part($, 'event-payload-review')).toHaveLength(1)
    expect(valueOf($, 'event-payload-diff')).toContain('12345678901234567000')
  })

  test('gives no number warning where every number is exact', async () => {
    const { $ } = await reviewPage({ text: edited })

    expect(part($, 'event-payload-number-warning')).toHaveLength(0)
  })

  test('is never stored, so Back after a save reads the event again', async () => {
    const { headers } = await reviewPage({ text: edited })

    expect(headers['cache-control']).toBe('no-store')
  })

  test('says straight away when the event can no longer be edited', async () => {
    givenEvent({
      status: 'COMPLETED',
      statusLabel: 'Completed',
      statusRole: 'success'
    })

    const { $ } = await reviewPage({ text: edited })

    expect(valueOf($, 'event-banner')).toBe(
      "Not saved — this event can't be edited. Its status is now Completed."
    )
    expect(part($, 'event-payload-review')).toHaveLength(0)
  })

  test('shows the page for an event the backend no longer has', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue({
      outcome: 'not-found',
      event: null
    })

    const response = await review({ text: edited, from: '?status=DEAD_LETTER' })
    const $ = load(response.result as unknown as string)

    expect($('h1').text()).toContain('Event not found')
    expect($('a[href="/dev-ops/events?status=DEAD_LETTER"]')).toHaveLength(1)
  })

  test('says the event could not be read when the backend is down', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue({
      outcome: 'unavailable',
      event: null
    })

    const { $ } = await reviewPage({ text: edited })

    expect(part($, 'event-error')).toHaveLength(1)
    expect(part($, 'event-payload-review')).toHaveLength(0)
  })

  test('keeps the list query on the way back and through the form', async () => {
    const { $ } = await reviewPage({
      text: edited,
      from: '?status=DEAD_LETTER'
    })

    expect(part($, 'event-edit-from').attr('value')).toBe('?status=DEAD_LETTER')
    expect(
      $('[data-testid="do-back"] a, a[href^="/dev-ops/events?"]')
        .first()
        .attr('href')
    ).toBe('/dev-ops/events?status=DEAD_LETTER')
  })

  test.each([
    ['in the editor', { text: edited, back: 'edit' }],
    ['on the review', { text: edited }]
  ])(
    'warns %s when the stored payload is not plain JSON',
    async (_name, fields) => {
      givenEvent({ payloadIsPlainJson: false })

      const { $ } = await reviewPage(fields)

      const warning = part($, 'event-plain-json-warning')

      expect(flatten(warning.text())).toBe(
        "Some values in this payload aren't plain JSON and will be saved as JSON text, for example dates as strings."
      )
      expect(warning.attr('role')).toBe('status')
      expect(warning.attr('class')).toBe(
        'alert alert-warning alert-soft text-sm'
      )
    }
  )

  test.each([true, null])(
    'does not warn when the service says plain JSON is %s',
    async (payloadIsPlainJson) => {
      givenEvent({ payloadIsPlainJson })

      const { $ } = await reviewPage({ text: edited })

      expect(part($, 'event-plain-json-warning')).toHaveLength(0)
    }
  )

  test('writes nothing about the payload to the log', async () => {
    await review({ text: edited })
    await review({ text: edited.replace('"12345"', '"12345",') })

    expect(everythingLogged()).not.toContain(secret)
    expect(everythingLogged()).not.toContain('sheetId')
  })

  test('escapes a payload carrying markup', async () => {
    const hostile = JSON.stringify(
      { data: { note: '</textarea><script>alert(1)</script>' } },
      null,
      2
    )
    const reviewed = await reviewPage({ text: hostile })
    const back = await reviewPage({ text: hostile, back: 'edit' })

    expect(reviewed.$('main script')).toHaveLength(0)
    expect(back.$('main script')).toHaveLength(0)
    expect(back.$('[data-testid="event-payload-editor-text"]').text()).toBe(
      hostile
    )
  })
})
