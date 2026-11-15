import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import { isOpenWithoutScript } from '../test-utils.ts'
import type { EventDetail } from '../repositories/events.repository.ts'
import {
  editPayload,
  findEvent,
  purgeEvent,
  redriveEvent
} from '../repositories/events.repository.ts'
import { getCatalogueUseCase } from '../use-cases/get-catalogue.use-case.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../repositories/events.repository.ts'), async (original) => ({
  ...(await original()),
  findEvent: vi.fn(),
  redriveEvent: vi.fn(),
  purgeEvent: vi.fn(),
  editPayload: vi.fn()
}))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`
const key = { service: 'gas', box: 'outbox', id }
const listPath = '/dev-ops/events/gas/outbox'

const responseError = (statusCode: number, body: object = {}) =>
  Object.assign(new Error(`Response Error: ${statusCode}`), {
    output: { statusCode },
    data: { payload: body, res: {} }
  })

const message = 'Application with clientRef "ref-e2e-005" not found'

const stored = {
  id: 'abc',
  data: { clientRef: 'ref-e2e-005', status: 'offered' }
}

const detail = (overrides: Partial<EventDetail> = {}): EventDetail => ({
  service: 'gas',
  box: 'outbox',
  id,
  eventId: '5208709c-e2d5-4870-b6ae-ff168bf65726',
  type: 'io.onsite.agreement.status.updated',
  eventType: 'AgreementStatusUpdated',
  targetTopic: null,
  status: 'DEAD_LETTER',
  statusLabel: 'Dead letter',
  statusRole: 'error',
  statusRetrying: false,
  attempts: '5/5',
  createdAt: '2026-10-13T14:53:22.397Z',
  expiresAt: '2027-02-02T00:00:00.000Z',
  purgeDeletionDate: '2027-02-02T00:00:00.000Z',
  lastError: { name: 'Error', message, at: '2026-10-13T14:53:24.011Z' },
  attemptHistory: [
    { at: '2026-10-13T14:53:23.177Z', name: 'Error', message, stack: null },
    { at: '2026-10-13T14:53:24.011Z', name: 'Error', message, stack: null }
  ],
  payload: stored,
  payloadRevision: 3,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  ...overrides
})

const edited = JSON.stringify(
  { id: 'abc', data: { clientRef: 'ref-e2e-005-r2', status: 'offered' } },
  null,
  2
)

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

const request = async (
  method: 'GET' | 'POST',
  url: string,
  payload?: object,
  cookie = ''
) => {
  const response = await server.inject({
    method,
    url,
    ...(payload ? { payload } : {}),
    headers: {
      cookie: ['dev-ops-times=utc', cookie].filter(Boolean).join('; '),
      'sec-fetch-site': 'same-origin'
    },
    auth: { strategy: 'session', credentials }
  })

  return {
    $: load(response.result as unknown as string),
    statusCode: response.statusCode,
    location: response.headers.location as string | undefined,
    cookie: cookieOf(response.headers['set-cookie']) || cookie
  }
}

/** Posts, then follows the 303 with the session it set, as a browser would. */
const postAndFollow = async (url: string, payload: object) => {
  const posted = await request('POST', url, payload)

  expect(posted.statusCode).toBe(statusCodes.seeOther)

  const page = await request('GET', posted.location!, undefined, posted.cookie)

  return { ...page, posted }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const bannerOf = ($: CheerioAPI) => {
  const banner = by($, 'event-banner')

  return {
    tone: (banner.attr('class') ?? '').match(/gpa-alert-(\w+)/)?.[1],
    title: flat(banner.find('.gpa-alert-title').text()),
    text: flat(banner.find('.gpa-alert-body > div').first().text())
  }
}

const toastsOf = ($: CheerioAPI) =>
  by($, 'toast')
    .toArray()
    .map((toast) => [
      ($(toast).attr('class') ?? '').match(/gpa-toast-(\w+)/)?.[1],
      flat($(toast).find('.gpa-toast-text').text())
    ])

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T15:20:00.000Z'))

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(getCatalogueUseCase).mockResolvedValue(fullCatalogue)
  vi.mocked(findEvent).mockReset().mockResolvedValue(detail())
  vi.mocked(redriveEvent).mockReset().mockResolvedValue(undefined)
  vi.mocked(purgeEvent).mockReset().mockResolvedValue(undefined)
  vi.mocked(editPayload).mockReset().mockResolvedValue(undefined)
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('Redrive', () => {
  test('asks GAS as the signed-in person, goes back to the event and its list, and says how it went once', async () => {
    const { $, posted } = await postAndFollow(`${path}/redrive`, {
      back: listPath
    })

    expect(redriveEvent).toHaveBeenCalledWith(key, 'Ada Lovelace')
    expect(posted.location).toBe(
      `${path}?back=${encodeURIComponent(listPath)}#event-banner`
    )
    expect(bannerOf($)).toEqual({
      tone: 'success',
      title: 'Redriven.',
      text: 'The poller will pick it up shortly and retry it up to 5 times.'
    })
    expect(by($, 'event-banner').attr('data-focus-on-arrival')).toBe('')
    expect(toastsOf($)).toEqual([['success', 'Event redriven']])

    const again = await request(
      'GET',
      posted.location!,
      undefined,
      posted.cookie
    )

    expect(by(again.$, 'event-banner')).toHaveLength(0)
    expect(toastsOf(again.$)).toEqual([])
  })

  test('a body-less post is a redrive that goes back to the event alone; a hostile back is dropped', async () => {
    const bare = await request('POST', `${path}/redrive`)

    expect(bare.statusCode).toBe(statusCodes.seeOther)
    expect(bare.location).toBe(`${path}#event-banner`)

    const hostile = await request('POST', `${path}/redrive`, {
      back: 'https://evil.example/dev-ops/x'
    })

    expect(hostile.location).toBe(`${path}#event-banner`)
  })

  test.each([
    [
      'the event moved on',
      responseError(409, { statusLabel: 'Resubmitted' }),
      {
        tone: 'warning',
        title: 'Not redriven.',
        text: 'This event is now Resubmitted, so it can’t be redriven. Nothing has changed.'
      }
    ],
    [
      'GAS no longer has it',
      responseError(404),
      {
        tone: 'danger',
        title: 'Not redriven.',
        text: 'GAS no longer has this event. Nothing has changed.'
      }
    ],
    [
      'Redrive times out',
      responseError(504),
      {
        tone: 'warning',
        title: 'Redrive status unknown.',
        text: 'GAS didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
      }
    ],
    [
      'GAS is down',
      responseError(502),
      {
        tone: 'danger',
        title: 'Not redriven.',
        text: 'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
      }
    ]
  ])('%s: its banner, and no toast', async (_name, error, banner) => {
    vi.mocked(redriveEvent).mockRejectedValue(error)

    const { $ } = await postAndFollow(`${path}/redrive`, {})

    expect(bannerOf($)).toEqual(banner)
    expect(toastsOf($)).toEqual([])
  })

  test('CW’s redrive that times out names CW, as the prototype does', async () => {
    vi.mocked(findEvent).mockResolvedValue(detail({ service: 'caseworking' }))
    vi.mocked(redriveEvent).mockRejectedValue(responseError(504))

    const { $ } = await postAndFollow(
      `/dev-ops/events/cw/outbox/${id}/redrive`,
      {}
    )

    expect(bannerOf($).text).toBe(
      'CW didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
    )
  })
})

describe('Purge', () => {
  test('a reason and a note: purged as the signed-in person, the banner gives the date it can still be redriven until', async () => {
    const { $ } = await postAndFollow(`${path}/purge`, {
      back: listPath,
      reasonCode: 'OTHER',
      note: '  Replaced by\r\nthe resubmission  '
    })

    expect(purgeEvent).toHaveBeenCalledWith(
      key,
      { reasonCode: 'OTHER', note: 'Replaced by\nthe resubmission' },
      'Ada Lovelace'
    )
    expect(bannerOf($)).toEqual({
      tone: 'info',
      title: 'Purged.',
      text: 'It won’t be retried. You can still redrive it until 2 Feb 2027.'
    })
    expect(toastsOf($)).toEqual([['info', 'Event purged']])
  })

  test('a coded reason needs no note, and an empty one is left out', async () => {
    await postAndFollow(`${path}/purge`, {
      reasonCode: 'SENT_IN_ERROR',
      note: ' '
    })

    expect(purgeEvent).toHaveBeenCalledWith(
      key,
      { reasonCode: 'SENT_IN_ERROR', note: '' },
      'Ada Lovelace'
    )
  })

  test('Purge with no reason: the dialog is handed back open, saying "Choose a reason"', async () => {
    const posted = await request('POST', `${path}/purge`, {
      back: listPath,
      note: 'typed'
    })

    expect(posted.location).toBe(
      `${path}?back=${encodeURIComponent(listPath)}&confirm=purge`
    )

    const { $ } = await request(
      'GET',
      posted.location!,
      undefined,
      posted.cookie
    )

    expect(isOpenWithoutScript($, 'purge-dialog')).toBe(true)
    expect(flat(by($, 'purge-reason-error').text())).toBe('Choose a reason')
    expect(by($, 'purge-note').val()).toBe('typed')
    expect(flat($('[data-gpa-count-for="purge-note"]').text())).toBe('5 / 500')
    expect(purgeEvent).not.toHaveBeenCalled()
  })

  test('Other with no note: "Say why: the reason is Other", the reason kept', async () => {
    const posted = await request('POST', `${path}/purge`, {
      reasonCode: 'OTHER'
    })
    const { $ } = await request(
      'GET',
      posted.location!,
      undefined,
      posted.cookie
    )

    expect(flat(by($, 'purge-note-error').text())).toBe(
      'Say why: the reason is Other'
    )
    expect($('input[name="reasonCode"][value="OTHER"]').is('[checked]')).toBe(
      true
    )
    expect(by($, 'purge-note').attr('aria-invalid')).toBe('true')
  })

  test('an event that is no longer a dead letter isn’t sent: it says what it is now', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      detail({
        status: 'RESUBMITTED',
        statusLabel: 'Resubmitted',
        purgeDeletionDate: null
      })
    )

    const { $ } = await postAndFollow(`${path}/purge`, {
      reasonCode: 'BROKEN_PAYLOAD'
    })

    expect(purgeEvent).not.toHaveBeenCalled()
    expect(bannerOf($)).toEqual({
      tone: 'warning',
      title: 'Not purged.',
      text: 'This event is now Resubmitted, so it can’t be purged. Nothing has changed.'
    })
  })

  test.each([
    [
      responseError(404),
      'danger',
      'Not purged.',
      'GAS no longer has this event. Nothing has changed.'
    ],
    [
      responseError(400),
      'danger',
      'Not purged.',
      'GAS refused the request. Nothing has changed.'
    ],
    [
      responseError(504),
      'warning',
      'Purge status unknown.',
      'GAS didn’t answer in time. Refresh to see whether the event was purged before trying again.'
    ],
    [
      responseError(503),
      'danger',
      'Not purged.',
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    ]
  ])('GAS answering %s gives its banner', async (error, tone, title, text) => {
    vi.mocked(purgeEvent).mockRejectedValue(error)

    const { $ } = await postAndFollow(`${path}/purge`, {
      reasonCode: 'BROKEN_PAYLOAD'
    })

    expect(bannerOf($)).toEqual({ tone, title, text })
  })
})

describe('Review', () => {
  const review = (text: string, extra: object = {}) =>
    request('POST', `${path}/payload/review`, {
      text,
      revision: '3',
      back: listPath,
      ...extra
    })

  test('a changed payload: the second step, the diff, the note with its count, and the three buttons', async () => {
    const { $, statusCode } = await review(edited)

    expect(statusCode).toBe(statusCodes.ok)

    const card = by($, 'event-payload-review')

    expect(card.find('.gpa-step.is-current').text()).toContain(
      'Review and save'
    )
    expect(flat(by($, 'event-diff').find('.gpa-diff-summary').text())).toBe(
      '1 line added1 line removed'
    )
    expect(by($, 'event-diff').attr('class')).toContain('gpa-maxh-360')
    expect(card.find('label[for="edit-note"]').text()).toBe(
      'Why are you changing it?'
    )
    expect(flat($('[data-gpa-count-for="edit-note"]').text())).toBe('0 / 500')
    expect(card.find('form').attr('action')).toBe(`${path}/payload#payload`)
    expect(card.find('input[name="text"]').val()).toBe(edited)
    expect(card.find('input[name="revision"]').val()).toBe('3')
    expect(by($, 'event-save-redrive').attr('name')).toBe('then')
    expect(by($, 'event-save-redrive').attr('value')).toBe('redrive')
    expect(by($, 'event-save').text()).toBe('Save')
    expect(by($, 'event-review-back').attr('formaction')).toBe(
      `${path}/payload/review#payload`
    )
    expect(by($, 'event-review-back').attr('name')).toBe('step')
  })

  test('JSON that can’t be read: the editor again, the text kept, the field saying where', async () => {
    const { $ } = await review('{ "a": 1,, }')

    expect(by($, 'event-payload-editor')).toHaveLength(1)
    expect(by($, 'event-payload-text').val()).toBe('{ "a": 1,, }')
    expect(flat(by($, 'event-payload-error').text())).toMatch(
      /^Couldn’t read the payload: expected .+ \(line 1, column 10\)\. Check the JSON — a comma, quote or brace is missing\.$/
    )
    expect(by($, 'event-payload-text').attr('aria-invalid')).toBe('true')
  })

  test('unchanged: Nothing to review', async () => {
    const { $ } = await review(JSON.stringify(stored, null, 2))

    expect(flat(by($, 'event-unchanged').find('.gpa-alert-title').text())).toBe(
      'Nothing to review.'
    )
  })

  test('Changed while editing: caught at review, the payload as it is now shown below the editor', async () => {
    vi.mocked(findEvent).mockResolvedValue(
      detail({
        payloadRevision: 4,
        lastEdit: { at: '2026-11-04T13:47:00.000Z', by: 'alex.k', note: 'x' }
      })
    )

    const { $ } = await review(edited)

    expect(flat(by($, 'event-stale').find('.gpa-alert-title').text())).toBe(
      'Not saved — the payload changed while you were editing.'
    )
    expect(by($, 'event-payload-text').val()).toBe(edited)
    expect(
      by($, 'event-payload-editor').find('input[name="revision"]').val()
    ).toBe('4')
    expect(flat(by($, 'event-payload-editor').text())).toContain(
      'Saved by alex.k at 4 Nov 2026 13:47'
    )
    expect(by($, 'event-current-payload').attr('class')).toContain(
      'gpa-maxh-240'
    )
  })

  test('numbers too large to keep: one warning per line', async () => {
    const big =
      '{\n  "a": 12345678901234567890,\n  "b": 98765432109876543210\n}'

    const { $ } = await review(big)

    expect(
      by($, 'event-rounded')
        .toArray()
        .map((alert) => flat($(alert).find('.gpa-alert-title').text()))
    ).toEqual([
      'Number on line 2 will be rounded.',
      'Number on line 3 will be rounded.'
    ])
  })

  test('Back: the editor with the text as it was', async () => {
    const { $ } = await review(edited, { step: 'edit', note: 'kept?' })

    expect(by($, 'event-payload-editor')).toHaveLength(1)
    expect(by($, 'event-payload-text').val()).toBe(edited)
  })

  test('an event that can’t be read: the reason, and the changes shown so nothing is lost', async () => {
    vi.mocked(findEvent).mockRejectedValue(responseError(503))

    const { $, statusCode } = await review(edited)

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(by($, 'event-kept').find('pre').text()).toContain('ref-e2e-005-r2')
  })
})

describe('Save', () => {
  const save = (extra: object = {}) =>
    request('POST', `${path}/payload`, {
      text: edited,
      revision: '3',
      back: listPath,
      note: 'Pointed at the resubmission',
      ...extra
    })

  test('saved: GAS gets the edit as the signed-in person, the banner offers Redrive now, and a toast', async () => {
    const posted = await save()

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(
      `${path}?back=${encodeURIComponent(listPath)}#event-banner`
    )
    expect(editPayload).toHaveBeenCalledWith(
      key,
      {
        payload: JSON.parse(edited),
        note: 'Pointed at the resubmission',
        revision: 3
      },
      'Ada Lovelace'
    )
    expect(redriveEvent).not.toHaveBeenCalled()

    const { $ } = await request(
      'GET',
      posted.location!,
      undefined,
      posted.cookie
    )

    expect(bannerOf($)).toEqual({
      tone: 'info',
      title: 'Payload saved.',
      text: 'It hasn’t been retried yet — redrive it to process the edited payload.'
    })
    expect(by($, 'event-banner-redrive').attr('data-gpa-open')).toBe(
      'redrive-dialog'
    )
    expect(by($, 'event-banner-redrive').attr('href')).toBe(
      `${path}?back=${encodeURIComponent(listPath)}&confirm=redrive`
    )
    expect(toastsOf($)).toEqual([['success', 'Payload saved']])
  })

  test('no note: the review again, saying why it’s needed, the text kept', async () => {
    const { $, statusCode } = await save({ note: '   ' })

    expect(statusCode).toBe(statusCodes.ok)
    expect(flat(by($, 'event-note-error').text())).toBe(
      'Say why you’re changing the payload'
    )
    expect(by($, 'event-payload-review').find('input[name="text"]').val()).toBe(
      edited
    )
    expect(editPayload).not.toHaveBeenCalled()
  })

  test('Changed while editing, caught by GAS: the editor again with the payload as it is now', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(412))

    const { $ } = await save()

    expect(by($, 'event-stale')).toHaveLength(1)
    expect(by($, 'event-payload-text').val()).toBe(edited)
  })

  test('Save times out: the changes held, with Try again and Cancel', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { $, statusCode } = await save()

    expect(statusCode).toBe(statusCodes.ok)

    const held = by($, 'event-payload-held')

    expect(flat(held.find('.gpa-card-head').text())).toBe('Your changes')
    expect(flat(by($, 'event-held').find('.gpa-alert-title').text())).toBe(
      'Not saved — GAS timed out.'
    )
    expect(flat(held.find('dd').text())).toBe('Pointed at the resubmission')
    expect(held.find('form').attr('action')).toBe(`${path}/payload#payload`)
    expect(held.find('input[name="text"]').val()).toBe(edited)
    expect(held.find('input[name="note"]').val()).toBe(
      'Pointed at the resubmission'
    )
    expect(by($, 'event-held-cancel').attr('href')).toBe(
      `${path}?back=${encodeURIComponent(listPath)}`
    )
  })

  test('held changes are compared line for line, whatever line breaks the form sent', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { $ } = await save({ text: edited.replace(/\n/g, '\r\n') })

    expect(
      flat(by($, 'event-payload-held').find('.gpa-diff-summary').text())
    ).toBe('1 line added1 line removed')
  })

  test('held Try again: the same save, which goes through', async () => {
    vi.mocked(editPayload).mockRejectedValueOnce(responseError(504))

    await save()

    const posted = await save()

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(editPayload).toHaveBeenCalledTimes(2)
  })

  test('GAS refuses the payload: the banner gives its reason', async () => {
    vi.mocked(editPayload).mockRejectedValue(
      responseError(422, { reason: 'TOO_LARGE' })
    )

    const { $ } = await postAndFollow(`${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'n'
    })

    expect(bannerOf($)).toEqual({
      tone: 'danger',
      title: 'Not saved.',
      text: 'The payload is over 256 KiB once formatted. Nothing has changed.'
    })
  })

  test('a session that names nobody: not saved, said above the review', async () => {
    const response = await server.inject({
      method: 'POST',
      url: `${path}/payload`,
      payload: { text: edited, revision: '3', note: 'n' },
      headers: { 'sec-fetch-site': 'same-origin' },
      auth: {
        strategy: 'session',
        credentials: { user: {}, scope: credentials.scope }
      }
    })
    const $ = load(response.result as unknown as string)

    expect(
      flat(by($, 'event-save-error').find('.gpa-alert-title').text())
    ).toBe(
      'Not saved — your account has no name or email to record against this change.'
    )
    expect(editPayload).not.toHaveBeenCalled()
  })
})

describe('Save and redrive', () => {
  const saveAndRedrive = () =>
    postAndFollow(`${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'Pointed at the resubmission',
      then: 'redrive'
    })

  test('both go through: one banner and one toast for both', async () => {
    const { $ } = await saveAndRedrive()

    expect(editPayload).toHaveBeenCalledTimes(1)
    expect(redriveEvent).toHaveBeenCalledWith(key, 'Ada Lovelace')
    expect(bannerOf($)).toEqual({
      tone: 'success',
      title: 'Payload saved and redriven.',
      text: 'The poller will retry it with the edited payload.'
    })
    expect(toastsOf($)).toEqual([['success', 'Payload saved and redriven']])
  })

  test('saved, but the redrive timed out: the redrive’s banner after the save', async () => {
    vi.mocked(redriveEvent).mockRejectedValue(responseError(504))

    const { $ } = await saveAndRedrive()

    expect(bannerOf($)).toEqual({
      tone: 'warning',
      title: 'Payload saved. Redrive status unknown.',
      text: 'GAS didn’t answer in time. Refresh to see whether the event was queued before redriving it again.'
    })
    expect(toastsOf($)).toEqual([['success', 'Payload saved']])
  })

  test('the save fails: nothing is redriven', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(412))

    await request('POST', `${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'n',
      then: 'redrive'
    })

    expect(redriveEvent).not.toHaveBeenCalled()
  })

  test('the save times out: held, and Try again keeps the redrive', async () => {
    vi.mocked(editPayload).mockRejectedValue(responseError(504))

    const { $ } = await request('POST', `${path}/payload`, {
      text: edited,
      revision: '3',
      note: 'n',
      then: 'redrive'
    })

    expect(by($, 'event-held-retry').attr('name')).toBe('then')
    expect(by($, 'event-held-retry').attr('value')).toBe('redrive')
    expect(redriveEvent).not.toHaveBeenCalled()
  })
})

describe('the writes are refused from another origin', () => {
  test.each([
    ['redrive', `${path}/redrive`, {}],
    ['purge', `${path}/purge`, { reasonCode: 'BROKEN_PAYLOAD' }],
    ['review', `${path}/payload/review`, { text: edited, revision: '3' }],
    ['save', `${path}/payload`, { text: edited, revision: '3', note: 'n' }]
  ])(
    '%s: 403 from a same-site frontend that isn’t this app, and GAS is never asked',
    async (_name, url, payload) => {
      const response = await server.inject({
        method: 'POST',
        url,
        payload,
        headers: {
          'sec-fetch-site': 'same-site',
          origin: 'https://other.cdp-int.defra.cloud'
        },
        auth: { strategy: 'session', credentials }
      })

      expect(response.statusCode).toBe(statusCodes.forbidden)
      expect(redriveEvent).not.toHaveBeenCalled()
      expect(purgeEvent).not.toHaveBeenCalled()
      expect(editPayload).not.toHaveBeenCalled()
      expect(findEvent).not.toHaveBeenCalled()
    }
  )
})

describe('the page to go back to', () => {
  test.each([
    ['a protocol-relative path', '//evil.example/dev-ops/x'],
    ['a backslash path', '/dev-ops\\evil.example'],
    ['a path outside Dev Ops', '/auth/logout']
  ])('%s is dropped from the redirect', async (_name, back) => {
    const posted = await request('POST', `${path}/redrive`, { back })

    expect(posted.location).toBe(`${path}#event-banner`)
  })

  test.each([
    ['a protocol-relative path', '//evil.example/dev-ops/x'],
    ['a backslash path', '/dev-ops\\evil.example']
  ])('%s is no Back link on the page', async (_name, back) => {
    const { $ } = await request(
      'GET',
      `${path}?back=${encodeURIComponent(back)}`
    )

    expect(by($, 'event-back').attr('href')).toBe(listPath)
  })
})

test('Back from Review keeps the note, and the next review shows it again', async () => {
  const back = await request('POST', `${path}/payload/review`, {
    text: edited,
    revision: '3',
    note: 'Pointed at the resubmission',
    step: 'edit'
  })

  expect(
    by(back.$, 'event-payload-editor').find('input[name="note"]').val()
  ).toBe('Pointed at the resubmission')

  const again = await request('POST', `${path}/payload/review`, {
    text: edited,
    revision: '3',
    note: 'Pointed at the resubmission'
  })

  expect(by(again.$, 'event-note').text().trim()).toBe(
    'Pointed at the resubmission'
  )
})
