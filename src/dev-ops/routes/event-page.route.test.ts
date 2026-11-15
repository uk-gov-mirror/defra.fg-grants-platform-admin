import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { config } from '../../common/config.ts'
import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  closeHrefOf,
  isOpenWithoutScript,
  resetsOnOpen
} from '../test-utils.ts'
import {
  getBucketAtUseCase,
  getCatalogueUseCase
} from '../use-cases/get-catalogue.use-case.ts'
import type { EventDetail } from '../use-cases/get-event.use-case.ts'
import { getEventUseCase } from '../use-cases/get-event.use-case.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/get-event.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const id = '665f1c2e9a1b2c3d4e5f6a7b'
const path = `/dev-ops/events/gas/outbox/${id}`
const listPath = '/dev-ops/events/gas/outbox'
const fromList = `${path}?back=${encodeURIComponent(listPath)}`

const message = 'Application with clientRef "ref-e2e-005" not found'
const stack = `Error: ${message}\n    at handle (/src/a.js:1:1)\n    at run (/src/b.js:2:2)`

const attempt = (at: string, overrides = {}) => ({
  at,
  name: 'Error',
  message,
  stack,
  ...overrides
})

const attempts = [
  attempt('2026-10-13T14:53:22.635Z'),
  attempt('2026-10-13T14:53:23.177Z'),
  attempt('2026-10-13T14:53:23.455Z'),
  attempt('2026-10-13T14:53:23.733Z'),
  attempt('2026-10-13T14:53:24.011Z')
]

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
  traceId: '80fb392b3aa416e9e7868fdd3e628dd5',
  expiresAt: '2027-02-02T00:00:00.000Z',
  purgeDeletionDate: '2027-02-02T00:00:00.000Z',
  lastError: { name: 'Error', message, at: '2026-10-13T14:53:24.011Z' },
  attemptHistory: attempts,
  payload: { id: 'abc', data: { clientRef: 'ref-e2e-005', status: 'offered' } },
  payloadRevision: 0,
  completionDate: null,
  lastResubmissionDate: null,
  lastRedrive: null,
  record: { kind: 'application', code: 'woodland', ref: 'ref-e2e-005' },
  ...overrides
})

/** The prototype's "Edited and previously purged": redriven after an edit, so nothing has run since. */
const editedAndPurged = () =>
  detail({
    status: 'RESUBMITTED',
    statusLabel: 'Resubmitted',
    statusRole: 'warning',
    attempts: '0/5',
    attemptHistory: [],
    payload: { id: 'abc', data: { clientRef: 'ref-e2e-005-r2' } },
    originalPayload: { id: 'abc', data: { clientRef: 'ref-e2e-005' } },
    lastEdit: {
      at: '2026-11-04T10:12:00.000Z',
      by: 'alex',
      note: 'clientRef pointed at the withdrawn application.'
    },
    lastPurge: {
      at: '2026-11-03T16:40:00.000Z',
      by: 'alex',
      reasonCode: 'BROKEN_PAYLOAD',
      note: null
    },
    lastRedrive: { at: '2026-11-04T10:13:00.000Z', by: 'alex' },
    purgeDeletionDate: null
  })

const given = (event: EventDetail = detail()) =>
  vi.mocked(getEventUseCase).mockResolvedValue({ outcome: 'found', event })

let server: Server

const view = async (url = fromList, times = 'utc') => {
  const { result, statusCode } = await server.inject({
    method: 'GET',
    url,
    headers: { cookie: `dev-ops-times=${times}` },
    auth: { strategy: 'session', credentials }
  })

  return { $: load(result as unknown as string), statusCode }
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

/** The text of an element as read: words in neighbouring elements stay apart. */
const spaced = (html: string | null) =>
  flat(load((html ?? '').replace(/></g, '> <')).text())

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) => flat(by($, testId).text())

const facts = ($: CheerioAPI) =>
  by($, 'event-details')
    .find('dt')
    .toArray()
    .map((dt) => [flat($(dt).text()), spaced($(dt).next('dd').html())])

const attemptRows = ($: CheerioAPI) =>
  by($, 'event-attempt')
    .toArray()
    .map((li) => ({
      title: flat($(li).find('.gpa-timeline-title').text()),
      meta: flat($(li).find('.gpa-timeline-meta').text()),
      tone: $(li).find('.gpa-timeline-mark').attr('class'),
      content: flat($(li).find('.gpa-timeline-content').text())
    }))

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-10-13T15:20:00.000Z'))

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(getCatalogueUseCase).mockResolvedValue(fullCatalogue)
  vi.mocked(getBucketAtUseCase).mockResolvedValue({
    available: true,
    bucket: null
  })
  config.set('environmentLabel', 'dev')
  given()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('Loaded: a dead letter, every attempt the same', () => {
  test('the header: name, status, id with copy, Purge and Redrive that open their dialogs', async () => {
    const { $, statusCode } = await view()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'event-title')).toBe('AgreementStatusUpdated')
    expect(textOf($, 'event-back')).toBe('Back to Events')
    expect(by($, 'event-back').attr('href')).toBe(listPath)
    expect(textOf($, 'event-status')).toBe('Dead letter')
    expect(by($, 'event-status').find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-danger'
    )
    expect(textOf($, 'event-id')).toBe('5208709c-e2d5-4870-b6ae-ff168bf65726')
    const copy = $(
      'gpa-copy[data-value="5208709c-e2d5-4870-b6ae-ff168bf65726"]'
    )
    expect(copy).toHaveLength(1)
    expect(copy.find('[data-gpa-copy]').is('[hidden]')).toBe(false)
    expect(by($, 'event-purge').attr('data-gpa-open')).toBe('purge-dialog')
    expect(by($, 'event-purge').attr('href')).toBe(`${fromList}&confirm=purge`)
    expect(by($, 'event-redrive').attr('data-gpa-open')).toBe('redrive-dialog')
    expect(by($, 'event-redrive').attr('href')).toBe(
      `${fromList}&confirm=redrive`
    )
    expect($('link[href*="dev-ops.css"]')).toHaveLength(0)
  })

  test('Details: the prototype’s facts, in its order', async () => {
    const { $ } = await view()

    expect(facts($)).toEqual([
      ['Queue', 'Outbox'],
      ['Created', '13 Oct 2026 14:53'],
      [
        'Logs',
        'OpenSearch (opens in a new tab) 80fb392b3aa416e9e7868fdd3e628dd5'
      ],
      ['Application', 'ref-e2e-005'],
      ['Deletion date', '2 Feb 2027']
    ])
    expect(by($, 'event-details').find('a').eq(1).attr('href')).toBe(
      '/dev-ops/applications/woodland/ref-e2e-005'
    )
    expect(by($, 'event-logs').attr('target')).toBe('_blank')
  })

  test('Attempts: 5 of 5, all failed with the same error, the error and its stack in one block', async () => {
    const { $ } = await view()

    expect(textOf($, 'event-attempts-count')).toBe('5 of 5')
    expect(textOf($, 'event-attempts-lead')).toBe(
      'All failed with the same error'
    )
    expect(
      spaced(by($, 'event-attempts').find('.gpa-inline').first().html())
    ).toBe('All failed with the same error the last at 13 Oct 2026 14:53:24')
    expect(by($, 'event-last-error').find('pre').text()).toBe(
      stack.split('\n').join('')
    )
    expect(by($, 'event-last-error').attr('class')).toContain('gpa-maxh-200')
    expect(by($, 'event-last-error').attr('class')).toContain('gpa-code-plain')
  })

  test('Events with this error: the queue’s dead letters with this error’s name', async () => {
    const { $ } = await view()

    expect(by($, 'event-errors-link').attr('href')).toBe(
      `${listPath}?status=DEAD_LETTER&errorname=Error`
    )
  })

  test('Show each attempt: "Attempt 1" … "Attempt 5, the last", each with the gap since the one before', async () => {
    const { $ } = await view()

    expect(textOf($, 'event-attempts-toggle')).toBe('Show each attempt')
    expect(attemptRows($)).toEqual([
      {
        title: 'Attempt 1',
        meta: '14:53:22.635, 238ms after it was created',
        tone: 'gpa-timeline-mark gpa-dot-warning',
        content: ''
      },
      {
        title: 'Attempt 2',
        meta: '14:53:23.177, 542ms after attempt 1',
        tone: 'gpa-timeline-mark gpa-dot-warning',
        content: ''
      },
      {
        title: 'Attempt 3',
        meta: '14:53:23.455, 278ms after attempt 2',
        tone: 'gpa-timeline-mark gpa-dot-warning',
        content: ''
      },
      {
        title: 'Attempt 4',
        meta: '14:53:23.733, 278ms after attempt 3',
        tone: 'gpa-timeline-mark gpa-dot-warning',
        content: ''
      },
      {
        title: 'Attempt 5, the last',
        meta: '14:53:24.011, 278ms after attempt 4',
        tone: 'gpa-timeline-mark gpa-dot-danger',
        content: ''
      }
    ])
  })

  test('the clock is the chosen zone’s', async () => {
    const { $ } = await view(fromList, 'uk')

    expect(attemptRows($)[0].meta).toBe(
      '15:53:22.635, 238ms after it was created'
    )
    expect(by($, 'event-attempt').first().find('time').attr('title')).toBe(
      '13 Oct 2026 15:53:22 BST'
    )
  })

  test('Payload: the stored JSON, Copy and Edit payload', async () => {
    const { $ } = await view()

    expect(by($, 'event-payload').find('pre').text()).toContain(
      '"clientRef": "ref-e2e-005"'
    )
    expect(by($, 'event-edit').attr('href')).toBe(
      `${fromList}&edit=payload#payload`
    )
    expect(by($, 'event-edited')).toHaveLength(0)
    expect(by($, 'event-original-toggle')).toHaveLength(0)
  })

  test('the dialogs are on the page, closed, for the buttons to open', async () => {
    const { $ } = await view()

    expect($('dialog#redrive-dialog')).toHaveLength(1)
    expect($('dialog#purge-dialog')).toHaveLength(1)
    expect(isOpenWithoutScript($, 'redrive-dialog')).toBe(false)
    expect(isOpenWithoutScript($, 'purge-dialog')).toBe(false)
  })
})

describe('Times from the address', () => {
  test('opens over the event, which keeps the list it goes back to', async () => {
    const { $, statusCode } = await view(`${fromList}&times=open`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect(closeHrefOf($, 'times-dialog')).toBe(fromList)
    expect(by($, 'event-back').attr('href')).toBe(listPath)
  })
})

describe('Attempts: different errors', () => {
  const mixed = () =>
    detail({
      attemptHistory: attempts.map((a, index) =>
        index < 3
          ? {
              ...a,
              message: 'Request failed with status code 503',
              stack:
                'Error: Request failed with status code 503\n    at x (/y.js:1:1)'
            }
          : a
      )
    })

  test('the last error, from attempt 5; each other error with its own stack; the rest the same as the last', async () => {
    given(mixed())

    const { $ } = await view()

    expect(textOf($, 'event-attempts-lead')).toBe(
      'The last error, from attempt 5'
    )

    const rows = attemptRows($)

    expect(
      flat(
        by($, 'event-attempt')
          .first()
          .find('.gpa-timeline-content > .gpa-stack > span')
          .text()
      )
    ).toBe('Error: Request failed with status code 503')
    expect(flat(by($, 'event-attempt').first().find('summary').text())).toBe(
      'Stack trace'
    )
    expect(rows[3].content).toBe('Same as the last error')
    expect(rows[4].content).toBe('')
    expect(
      by($, 'event-attempt').first().find('.gpa-text-danger.gpa-mono')
    ).toHaveLength(1)
    expect(
      by($, 'event-attempt').first().find('gpa-disclosure pre').text()
    ).toContain('at x (/y.js:1:1)')
  })

  test('Why it failed names the attempts that failed this way', async () => {
    given(mixed())

    const { $ } = await view(`${fromList}&edit=payload`)

    expect(textOf($, 'event-why-sentence')).toBe(
      'Attempts 4 and 5 failed with this error, last at 13 Oct 2026 14:53:24.'
    )
  })
})

describe('Edited and previously purged', () => {
  test('Resubmitted, no actions, 0 of 5 with the redrive waiting for the poller', async () => {
    given(editedAndPurged())

    const { $ } = await view()

    expect(textOf($, 'event-status')).toBe('Resubmitted')
    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(0)
    expect(textOf($, 'event-attempts-count')).toBe('0 of 5')
    expect(textOf($, 'event-redriven')).toBe(
      'Redriven 4 Nov 2026 10:13 by alex — waiting for GAS’s poller. No attempts since.'
    )
    expect(by($, 'event-attempts').text()).toContain(
      'Before the redrive, all 5 attempts failed with:'
    )
    expect(by($, 'event-errors-link')).toHaveLength(0)
    expect(by($, 'event-no-attempts-since-edit')).toHaveLength(0)
  })

  test('the Edited badge, the facts of the edit, the purge and the redrive, and the payload before the first edit', async () => {
    given(editedAndPurged())

    const { $ } = await view()

    expect(textOf($, 'event-edited')).toBe('Edited')
    expect(by($, 'event-edit')).toHaveLength(0)
    expect(facts($).slice(5)).toEqual([
      ['Last redrive', '4 Nov 2026 10:13 by alex'],
      [
        'Payload edited',
        '4 Nov 2026 10:12 by alex “clientRef pointed at the withdrawn application.”'
      ],
      ['Previously purged', '3 Nov 2026 16:40 by alex: Payload is broken']
    ])
    expect(textOf($, 'event-original-toggle')).toBe(
      'Show the payload before the first edit'
    )
    expect(by($, 'event-original').find('pre').text()).toContain(
      '"ref-e2e-005"'
    )
  })
})

describe('Purged', () => {
  const purged = () =>
    detail({
      status: 'PURGED',
      statusLabel: 'Purged',
      statusRole: 'neutral',
      purgeDeletionDate: null,
      lastPurge: {
        at: '2026-11-04T09:00:00.000Z',
        by: 'alex',
        reasonCode: 'SENT_IN_ERROR',
        note: 'Duplicate.'
      }
    })

  test('Redrive only; the purge is a fact; the redrive dialog says what redriving brings back', async () => {
    given(purged())

    const { $ } = await view()

    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(1)
    expect(facts($).at(-1)).toEqual([
      'Purged',
      '4 Nov 2026 09:00 by alex: Sent in error “Duplicate.”'
    ])
    expect(textOf($, 'redrive-purged')).toBe(
      'It was purged on 4 Nov 2026 by alex. Redriving brings it back to the queue; the purge stays in its history.'
    )
  })
})

describe('the states without actions', () => {
  test('Completed: no attempts card, no actions', async () => {
    given(
      detail({
        status: 'COMPLETED',
        statusLabel: 'Completed',
        statusRole: 'success',
        attemptHistory: [],
        lastError: null,
        purgeDeletionDate: null
      })
    )

    const { $ } = await view()

    expect(by($, 'event-attempts')).toHaveLength(0)
    expect(by($, 'event-purge')).toHaveLength(0)
    expect(by($, 'event-redrive')).toHaveLength(0)
    expect(by($, 'event-edit')).toHaveLength(0)
    expect($('#redrive-dialog, #purge-dialog')).toHaveLength(0)
  })

  test('Failed, still retrying: its attempts so far, none of them the last, and no actions (the service’s gate)', async () => {
    given(
      detail({
        status: 'FAILED',
        statusLabel: 'Failed',
        statusRole: 'warning',
        attempts: '2/5',
        attemptHistory: attempts.slice(0, 2),
        purgeDeletionDate: null
      })
    )

    const { $ } = await view()

    expect(textOf($, 'event-attempts-count')).toBe('2 of 5')
    expect(attemptRows($).map(({ title }) => title)).toEqual([
      'Attempt 1',
      'Attempt 2'
    ])
    expect(by($, 'event-status').find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-danger'
    )
    expect(by($, 'event-redrive')).toHaveLength(0)
  })

  test('no revision from the service: no Edit payload, and the futile warning has no edit action', async () => {
    given(detail({ payloadRevision: null }))

    const { $ } = await view()

    expect(by($, 'event-edit')).toHaveLength(0)
    expect(by($, 'redrive-futile')).toHaveLength(1)
    expect(by($, 'redrive-edit-instead')).toHaveLength(0)
  })

  test('no trace, no record, no deletion date: those facts are left out', async () => {
    given(detail({ traceId: null, record: null, expiresAt: null }))

    const { $ } = await view()

    expect(facts($).map(([label]) => label)).toEqual(['Queue', 'Created'])
  })

  test('CW’s inbox event: a case, and CW named', async () => {
    given(
      detail({
        service: 'caseworking',
        box: 'inbox',
        record: { kind: 'case', code: 'woodland', ref: 'ref-e2e-019' }
      })
    )

    const { $ } = await view(`/dev-ops/events/cw/inbox/${id}`)

    expect(textOf($, 'event-back')).toBe('Back to Events')
    expect(facts($)[0]).toEqual(['Queue', 'Inbox'])
    expect(facts($)[3]).toEqual(['Case', 'ref-e2e-019'])
    expect(textOf($, 'redrive-dialog')).toContain(
      'CW’s poller picks it up again'
    )
  })
})

describe('Unavailable, timed out, not found', () => {
  test.each([
    [
      'timed-out',
      statusCodes.gatewayTimeout,
      'GAS timed out waiting for it. Nothing has changed — try again in a moment.'
    ],
    [
      'unavailable',
      statusCodes.serviceUnavailable,
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    ]
  ] as const)(
    '%s: the id as the title, the reason, Try again and Back',
    async (outcome, code, body) => {
      vi.mocked(getEventUseCase).mockResolvedValue({ outcome, event: null })

      const { $, statusCode } = await view()

      expect(statusCode).toBe(code)
      expect(textOf($, 'event-title')).toBe(id)
      expect(by($, `event-${outcome}`).find('.gpa-alert-title').text()).toBe(
        'This event couldn’t be loaded.'
      )
      expect(
        flat(
          by($, `event-${outcome}`).find('.gpa-alert-body > div').first().text()
        )
      ).toBe(body)
      expect(by($, 'event-retry').attr('href')).toBe(fromList)
      expect(
        flat(by($, `event-${outcome}`).find('.gpa-alert-actions').text())
      ).toBe('Try again Back to Events')
    }
  )

  test('not found: the prototype’s empty state, naming the service', async () => {
    vi.mocked(getEventUseCase).mockResolvedValue({
      outcome: 'not-found',
      event: null
    })

    const { $, statusCode } = await view(`/dev-ops/events/cw/outbox/${id}`)

    expect(statusCode).toBe(statusCodes.notFound)
    expect(flat(by($, 'event-not-found').find('.gpa-empty-title').text())).toBe(
      'No CW event has this ID.'
    )
    expect(flat(by($, 'event-not-found').find('.gpa-empty-body').text())).toBe(
      'It may have passed its deletion date, or the ID may be from the other service. Check the ID, or search for it from Events.'
    )
    expect(by($, 'event-not-found').find('a').attr('href')).toBe(
      '/dev-ops/events/cw/outbox'
    )
  })
})

describe('the redrive dialog', () => {
  test('without a script, the address opens it: the name, short id, what happens, the futile warning', async () => {
    const { $ } = await view(`${fromList}&confirm=redrive`)

    expect(isOpenWithoutScript($, 'redrive-dialog')).toBe(true)
    expect(isOpenWithoutScript($, 'purge-dialog')).toBe(false)

    const dialog = by($, 'redrive-dialog')

    expect(flat(dialog.find('.gpa-dialog-head h2').text())).toBe(
      'Redrive this event?'
    )
    expect(spaced(dialog.find('.gpa-inline').first().html())).toBe(
      'AgreementStatusUpdated 5208709c…5726'
    )
    expect(dialog.find('.gpa-divider-v')).toHaveLength(1)
    expect(dialog.text()).toContain(
      'GAS’s poller picks it up again and retries it up to 5 times. The attempt count starts again. This is audited.'
    )
    expect(
      flat(by($, 'redrive-futile').find('.gpa-alert-body > div').first().text())
    ).toBe(
      'All 5 attempts failed with the same error and the payload hasn’t changed. Fix the cause first — in the payload or in the service it calls.'
    )
    expect(by($, 'redrive-edit-instead').attr('href')).toBe(
      `${fromList}&edit=payload#payload`
    )
    expect(dialog.find('.gpa-dialog-close').attr('href')).toBe(fromList)
  })

  test('the form posts the page to go back to, and Redrive submits it with a spinner', async () => {
    const { $ } = await view()

    const form = $('form#redrive-form')

    expect(form.attr('action')).toBe(`${path}/redrive`)
    expect(form.find('input[name="back"]').val()).toBe(listPath)
    expect(by($, 'redrive-submit').attr('form')).toBe('redrive-form')
    expect(by($, 'redrive-submit').is('[data-gpa-loading-on-submit]')).toBe(
      true
    )
  })

  test('an edit not yet redriven: it says the edited payload is used, and the futile warning goes', async () => {
    given(
      detail({
        lastEdit: { at: '2026-10-14T08:00:00.000Z', by: 'alex.k', note: 'fix' }
      })
    )

    const { $ } = await view()

    expect(textOf($, 'redrive-edited')).toBe(
      'It will use the payload edited by alex.k on 14 Oct 2026 08:00, not the original.'
    )
    expect(by($, 'redrive-futile')).toHaveLength(0)
  })

  test('in production, both dialogs say so first', async () => {
    config.set('environmentLabel', 'prod')

    const { $ } = await view()

    for (const dialog of ['redrive-dialog', 'purge-dialog']) {
      expect(flat(by($, dialog).find('.gpa-badge').first().text())).toBe('prod')
      expect(by($, dialog).text()).toContain('This changes production.')
    }
  })
})

describe('the purge dialog', () => {
  test('without a script, the address opens it: the reasons, the note with its count, the deletion date', async () => {
    const { $ } = await view(`${fromList}&confirm=purge`)

    expect(isOpenWithoutScript($, 'purge-dialog')).toBe(true)

    const dialog = by($, 'purge-dialog')

    expect(dialog.find('.gpa-dialog').attr('role')).toBe('alertdialog')
    expect(dialog.text()).toContain(
      'It won’t be processed or retried, and it leaves the dead-letter list. It’s deleted on 2\u00a0Feb 2027 — you can still redrive it until then. This is audited.'
    )
    expect(
      dialog
        .find('input[name="reasonCode"]')
        .toArray()
        .map((input) => [$(input).val(), flat($(input).parent().text())])
    ).toEqual([
      ['BROKEN_PAYLOAD', 'Payload is broken'],
      ['SENT_IN_ERROR', 'Sent in error'],
      ['OTHER', 'Other']
    ])
    expect(flat(dialog.find('#purge-note-hint').text())).toBe(
      'Required when the reason is Other. Shown on the event; don’t include personal data.'
    )
    expect(dialog.find('#purge-note').attr('maxlength')).toBe('500')
    expect(flat(dialog.find('[data-gpa-count-for="purge-note"]').text())).toBe(
      '0 / 500'
    )
    expect(by($, 'purge-submit').text()).toBe('Purge event')
    expect(by($, 'purge-submit').attr('class')).toContain(
      'gpa-btn-danger-solid'
    )
    expect(by($, 'purge-submit').is('[disabled]')).toBe(false)
  })
})

describe('a dialog the address opens', () => {
  test.each([
    ['redrive', fromList, fromList],
    ['purge', fromList, fromList],
    ['redrive', path, path],
    ['purge', path, path]
  ])(
    '%s over %s closes to the page without the opener',
    async (write, page, closed) => {
      const opened = `${page}${page.includes('?') ? '&' : '?'}confirm=${write}`
      const { $ } = await view(opened)

      expect(isOpenWithoutScript($, `${write}-dialog`)).toBe(true)
      expect(closeHrefOf($, `${write}-dialog`)).toBe(closed)
    }
  )
})

describe('reopening a dialog from the page', () => {
  test('starts Purge clean, its reason and note as the server drew them; Redrive has nothing to clear', async () => {
    const { $ } = await view()

    expect(resetsOnOpen($, 'purge-dialog')).toBe(true)
    expect(resetsOnOpen($, 'redrive-dialog')).toBe(false)
  })
})

describe('editing the payload', () => {
  test('Edit: the first step, the warning, Why it failed with its link, and the JSON in the editor', async () => {
    const { $ } = await view(`${fromList}&edit=payload`)

    const editor = by($, 'event-payload-editor')

    expect(editor.attr('id')).toBe('payload')
    expect(editor.find('.gpa-step.is-current').text()).toContain('Edit')
    expect(editor.text()).toContain('Nothing is saved until you confirm.')
    expect(flat(by($, 'event-why').find('.gpa-alert-title').text())).toBe(
      'Why it failed'
    )
    expect(textOf($, 'event-why-sentence')).toBe(
      'Same error on all 5 attempts, the last at 13 Oct 2026 14:53:24.'
    )
    expect(by($, 'event-why').find('time').attr('title')).toBe(
      '13 Oct 2026 14:53:24 UTC'
    )
    expect(textOf($, 'event-why-find')).toBe('Find application ref-e2e-005')
    expect(by($, 'event-payload-text').val()).toContain(
      '"clientRef": "ref-e2e-005"'
    )
    expect(by($, 'event-payload-text').attr('name')).toBe('text')
    expect(editor.find('form').attr('action')).toBe(
      `${path}/payload/review#payload`
    )
    expect(editor.find('input[name="revision"]').val()).toBe('0')
    expect(by($, 'event-discard').attr('href')).toBe(fromList)
    expect(by($, 'event-payload')).toHaveLength(0)
  })

  test('a service that says the payload isn’t plain JSON is warned of in the editor', async () => {
    given(detail({ payloadIsPlainJson: false }))

    const { $ } = await view(`${fromList}&edit=payload`)

    expect(
      flat(by($, 'event-not-plain-json').find('.gpa-alert-title').text())
    ).toBe('Some values in this payload aren’t plain JSON.')
  })

  test('the editor isn’t opened over a dialog the address asks for', async () => {
    const { $ } = await view(`${fromList}&edit=payload&confirm=redrive`)

    expect(by($, 'event-payload-editor')).toHaveLength(0)
  })
})

test('Try again on an event that couldn’t be loaded keeps the page it was opened from', async () => {
  vi.mocked(getEventUseCase).mockResolvedValue({
    outcome: 'timed-out',
    event: null
  })

  const { $ } = await view()

  expect(by($, 'event-retry').attr('href')).toBe(fromList)
})

test('an empty error message isn’t the same as another', async () => {
  given(
    detail({
      attemptHistory: [
        attempt('2026-10-13T14:53:22.635Z', { message: '' }),
        attempt('2026-10-13T14:53:24.011Z')
      ],
      attempts: '2/5'
    })
  )

  const { $ } = await view()

  expect(textOf($, 'event-attempts-lead')).toBe(
    'The last error, from attempt 2'
  )
  expect(by($, 'redrive-futile')).toHaveLength(0)
})
