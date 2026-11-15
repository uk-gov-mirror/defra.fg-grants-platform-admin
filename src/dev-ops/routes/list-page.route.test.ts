import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  closeHrefOf,
  expectTablesStyled,
  isOpenWithoutScript,
  styleNonceOf,
  tableStyles
} from '../test-utils.ts'
import { fullCatalogue } from '../use-cases/test-fixtures.ts'
import {
  getBucketAtUseCase,
  getCatalogueUseCase
} from '../use-cases/get-catalogue.use-case.ts'
import type { Catalogue } from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketListResult,
  BucketResult,
  BucketRow
} from '../use-cases/query-bucket.use-case.ts'
import { queryBucketUseCase } from '../use-cases/query-bucket.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/query-bucket.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-10-13T15:20:00.000Z')

const outboxPath = '/dev-ops/events/gas/outbox'

const eventRow = (overrides: Partial<BucketRow> = {}): BucketRow => ({
  id: '66f000000000000000000001',
  time: '2026-10-13T14:53:00.000Z',
  title: 'UpdateCaseStatus',
  subtitle: '5208709c-e2d5-4870-b6ae-ff168bf65726',
  cells: { status: 'DEAD_LETTER', completedAt: null },
  link: {
    kind: 'event',
    service: 'gas',
    box: 'outbox',
    id: '66f000000000000000000001'
  },
  ...overrides
})

const exact = (overrides: Partial<BucketResult> = {}): BucketResult => ({
  bucket: 'gas.outbox',
  plan: {
    kind: 'exact',
    index: ['status'],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [eventRow()],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [
    {
      by: 'status',
      values: [
        { value: 'PUBLISHED', count: 3, capped: false },
        { value: 'DEAD_LETTER', count: 10000, capped: true }
      ],
      total: { count: 12456, capped: false }
    }
  ],
  ...overrides
})

const bounded = (page: Partial<BucketResult['page']>, rows: BucketRow[] = []) =>
  exact({
    plan: { ...exact().plan, kind: 'bounded' },
    rows,
    groups: [],
    page: {
      next: null,
      keepLooking: null,
      searchedTo: null,
      complete: false,
      ...page
    }
  })

const answered = (page: BucketResult | null = exact()): BucketListResult => ({
  page,
  unavailable: false,
  timedOut: false,
  errored: false,
  refused: false,
  refusal: null
})

const failed = (timedOut: boolean, errored = false): BucketListResult => ({
  page: null,
  unavailable: true,
  timedOut,
  errored,
  refused: false,
  refusal: null
})

const refused: BucketListResult = {
  page: null,
  unavailable: false,
  timedOut: false,
  errored: false,
  refused: true,
  refusal: '"ref-value" must be at most 100 characters'
}

const given = (...reads: BucketListResult[]) => {
  for (const read of reads) {
    vi.mocked(queryBucketUseCase).mockResolvedValueOnce(read)
  }
}

const withCatalogue = (held: Catalogue) => {
  vi.mocked(getCatalogueUseCase).mockResolvedValue(held)
  vi.mocked(getBucketAtUseCase).mockImplementation(async (path) => ({
    available: true,
    bucket: held.buckets.find((bucket) => bucket.path === path) ?? null
  }))
}

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

/** Times in UTC unless the test sets them. */
const withTimes = (cookie: string) =>
  cookie.includes('dev-ops-times')
    ? cookie
    : [cookie, 'dev-ops-times=utc'].filter(Boolean).join('; ')

const view = async (url = outboxPath, cookie = '') => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: { cookie: withTimes(cookie) }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return {
    $,
    statusCode,
    location: headers.location,
    cookie: cookieOf(headers['set-cookie']) || cookie,
    csp: headers['content-security-policy']
  }
}

const post = async (
  payload: Record<string, string>,
  cookie = '',
  url = outboxPath
) => {
  const { result, statusCode, headers } = await server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials },
    headers: { cookie, 'sec-fetch-site': 'same-origin' }
  })

  return {
    $: load(result as unknown as string),
    statusCode,
    location: headers.location,
    cookie: cookieOf(headers['set-cookie']) || cookie
  }
}

/** Searches, then opens the list it redirects to, with the session the search set. */
const searched = async (kind: string, value: string) => {
  const posted = await post({ 'ref-kind': kind, 'ref-value': value })

  return view(posted.location, posted.cookie)
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) => flat(by($, testId).text())

const headers = ($: CheerioAPI) =>
  by($, 'list-table')
    .find('th')
    .toArray()
    .map((th) => flat($(th).text()))

const firstRowCells = ($: CheerioAPI) =>
  by($, 'list-row')
    .first()
    .find('td')
    .toArray()
    .map((td) => flat($(td).text()))

const chipItems = ($: CheerioAPI, fact: string) =>
  by($, `list-chip-${fact}`)
    .find('.gpa-menuitem')
    .toArray()
    .map((item) => ({
      text: flat($(item).find('.gpa-menuitem-label').text()),
      href: $(item).attr('href')
    }))

const tags = ($: CheerioAPI) =>
  by($, 'list-applied')
    .find('.gpa-tag')
    .toArray()
    .map((tag) => flat($(tag).find('.gpa-tag-label').text()))

const alertOf = ($: CheerioAPI) => ({
  tone: (by($, 'list-alert').attr('class') ?? '').match(/gpa-alert-(\w+)/)?.[1],
  title: flat(by($, 'list-alert').find('.gpa-alert-title').text()),
  body: flat(by($, 'list-alert').find('.gpa-alert-body > div').first().text())
})

/** What GAS was asked for on the latest read. */
const asked = () => vi.mocked(queryBucketUseCase).mock.calls.at(-1)?.[1]

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.setSystemTime(now)
  withCatalogue(fullCatalogue)
  vi.mocked(queryBucketUseCase).mockReset()
  vi.mocked(queryBucketUseCase).mockResolvedValue(answered())
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('Loaded', () => {
  test('GAS outbox: title, service, the Outbox tab, the prototype’s columns and a row that opens the event', async () => {
    const { $, statusCode } = await view()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'list-title')).toBe('Events')
    expect(flat($('.gpa-pageheader-meta').text())).toBe(
      'Grant Application Service'
    )
    expect(
      by($, 'list-tabs')
        .find('a')
        .toArray()
        .map((a) => [
          flat($(a).text()),
          $(a).attr('href'),
          $(a).attr('aria-current')
        ])
    ).toEqual([
      ['Outbox', outboxPath, 'page'],
      ['Inbox', '/dev-ops/events/gas/inbox', undefined]
    ])
    expect(by($, 'list-tabs').attr('aria-label')).toBe('Queue')
    expect(headers($)).toEqual(['Event', 'Event ID', 'Status', 'Created'])
    expect(firstRowCells($)).toEqual([
      'UpdateCaseStatus',
      '5208709c-e2d5-4870-b6ae-ff168bf65726',
      'Dead letter',
      '13 Oct 2026 14:53',
      ''
    ])
    expect(by($, 'list-row').find('.gpa-rowlink').attr('href')).toBe(
      '/dev-ops/events/gas/outbox/66f000000000000000000001?back=%2Fdev-ops%2Fevents%2Fgas%2Foutbox'
    )
    expect(by($, 'list-row').find('td').eq(1).attr('class')).toBe(
      'gpa-cell-mono'
    )
    expect(by($, 'list-row').find('.gpa-dot').attr('class')).toContain(
      'gpa-dot-danger'
    )
    expect(by($, 'list-row').find('time').attr('title')).toBe(
      '13 Oct 2026 14:53:00 UTC'
    )
    expect(by($, 'list-footer')).toHaveLength(0)
  })

  test('the columns keep the prototype’s widths, and the time sits on the right', async () => {
    const { $ } = await view()

    expect($('gpa-data-table').attr('data-cols')).toBe(
      'minmax(220px, 1fr) 336px 128px var(--size-column-date) var(--size-column-chevron)'
    )
    expect(by($, 'list-row').find('td').eq(3).attr('class')).toBe('gpa-right')
  })

  test('the widths are in a <style> the response’s policy allows, so every browser draws them on load', async () => {
    const first = await view()
    const second = await view()

    expect(tableStyles(first.$, first.csp)).toEqual([
      { label: 'Events', nonced: true, widths: true }
    ])
    expect(first.$('style[nonce]').text()).toContain(
      '--gpa-cols:minmax(220px, 1fr) 336px 128px var(--size-column-date) var(--size-column-chevron);'
    )
    expect(styleNonceOf(second.csp)).not.toBe(styleNonceOf(first.csp))
    expect(second.$('style[nonce]').attr('nonce')).toBe(
      styleNonceOf(second.csp)
    )
  })

  test('the prototype’s tones: Queued is info, Failed danger', async () => {
    given(
      answered(
        exact({
          rows: [
            eventRow({ cells: { status: 'PUBLISHED' } }),
            eventRow({ cells: { status: 'FAILED' } }),
            eventRow({ cells: { status: 'COMPLETED' } })
          ]
        })
      )
    )

    const { $ } = await view()

    expect(
      by($, 'list-row')
        .find('.gpa-dot')
        .toArray()
        .map((dot) => $(dot).attr('class'))
    ).toEqual([
      'gpa-dot gpa-dot-info',
      'gpa-dot gpa-dot-danger',
      'gpa-dot gpa-dot-success'
    ])
  })

  test('Inbox: the inbox is current, its time is Created as on the outbox, and it has no audit switch', async () => {
    given(answered(exact({ bucket: 'gas.inbox' })))

    const { $ } = await view('/dev-ops/events/gas/inbox')

    expect(by($, 'list-tabs').find('[aria-current="page"]').text()).toBe(
      'Inbox'
    )
    expect(headers($).at(-1)).toBe('Created')
    expect(by($, 'list-range').find('.gpa-chip-label').text()).toBe('Created:')
    expect(chipItems($, 'eventType').map(({ text }) => text)).toEqual([
      'All',
      'AgreementStatusUpdated',
      'CaseStatusUpdated'
    ])
  })

  test('CW: the service is Caseworking', async () => {
    const { $ } = await view('/dev-ops/events/cw/outbox')

    expect(flat($('.gpa-pageheader-meta').text())).toBe('Caseworking')
    expect(by($, 'list-tabs').find('a').first().attr('href')).toBe(
      '/dev-ops/events/cw/outbox'
    )
  })

  test('the browser tab names the queue, and the sidebar marks Events', async () => {
    const { $ } = await view()

    expect($('title').text()).toBe('GAS outbox – Grants Platform')
    expect($('[data-testid="shell-nav-gas.outbox"]').attr('aria-current')).toBe(
      'page'
    )
  })

  test('the page is drawn without the old stylesheet', async () => {
    const { $ } = await view()

    expect($('link[href*="dev-ops.css"]')).toHaveLength(0)
    expect($('script[src*="views/legacy"]')).toHaveLength(0)
  })
})

describe('filters', () => {
  test('Status: every value, with no counts beside them or total', async () => {
    const { $ } = await view()

    expect(chipItems($, 'status')).toEqual([
      { text: 'All', href: outboxPath },
      { text: 'Queued', href: `${outboxPath}?status=PUBLISHED` },
      { text: 'Processing', href: `${outboxPath}?status=PROCESSING` },
      { text: 'Failed', href: `${outboxPath}?status=FAILED` },
      { text: 'Resubmitted', href: `${outboxPath}?status=RESUBMITTED` },
      { text: 'Completed', href: `${outboxPath}?status=COMPLETED` },
      { text: 'Dead letter', href: `${outboxPath}?status=DEAD_LETTER` },
      { text: 'Purged', href: `${outboxPath}?status=PURGED` }
    ])
    expect(by($, 'list-chip-status').find('.gpa-menuitem-meta')).toHaveLength(0)
  })

  test('a chosen value: the chip names it, every link keeps it, and its tag removes it', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(by($, 'list-chip-status').find('.gpa-chip-value').text()).toBe(
      'Dead letter'
    )
    expect(chipItems($, 'eventType')[2].href).toBe(
      `${outboxPath}?status=DEAD_LETTER&event=UpdateCaseStatus`
    )
    expect(tags($)).toEqual(['Status is Dead letter'])
    expect(by($, 'list-applied').find('.gpa-tag a').attr('href')).toBe(
      outboxPath
    )
    expect($('.gpa-chip-clear')).toHaveLength(0)
    expect(by($, 'list-clear-all').attr('href')).toBe(outboxPath)
    expect(asked()?.where).toEqual({ status: 'DEAD_LETTER' })
  })

  test('Times opens from the address over a filtered list, which keeps its filters', async () => {
    const page = `${outboxPath}?status=DEAD_LETTER`
    const { $, statusCode } = await view(`${page}&times=open`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(isOpenWithoutScript($, 'times-dialog')).toBe(true)
    expect(closeHrefOf($, 'times-dialog')).toBe(page)
    expect(asked()?.where).toEqual({ status: 'DEAD_LETTER' })
  })

  test('two statuses: the chip says 2 selected, each value is ticked and toggles itself, and each has its own tag', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER&status=FAILED`)
    const items = by($, 'list-chip-status').find('.gpa-menuitem')

    expect(by($, 'list-chip-status').find('.gpa-chip-value').text()).toBe(
      '2 selected'
    )
    expect(items.first().attr('role')).toBe('menuitemcheckbox')
    expect(
      items
        .toArray()
        .filter((item) => $(item).attr('aria-checked') === 'true')
        .map((item) => flat($(item).text()))
    ).toEqual(['Failed', 'Dead letter'])
    expect(chipItems($, 'status')).toEqual([
      { text: 'All', href: outboxPath },
      {
        text: 'Queued',
        href: `${outboxPath}?status=PUBLISHED&status=FAILED&status=DEAD_LETTER`
      },
      {
        text: 'Processing',
        href: `${outboxPath}?status=PROCESSING&status=FAILED&status=DEAD_LETTER`
      },
      { text: 'Failed', href: `${outboxPath}?status=DEAD_LETTER` },
      {
        text: 'Resubmitted',
        href: `${outboxPath}?status=FAILED&status=RESUBMITTED&status=DEAD_LETTER`
      },
      {
        text: 'Completed',
        href: `${outboxPath}?status=FAILED&status=COMPLETED&status=DEAD_LETTER`
      },
      { text: 'Dead letter', href: `${outboxPath}?status=FAILED` },
      {
        text: 'Purged',
        href: `${outboxPath}?status=FAILED&status=DEAD_LETTER&status=PURGED`
      }
    ])
    expect(tags($)).toEqual(['Status is Failed', 'Status is Dead letter'])
    expect(
      by($, 'list-applied')
        .find('.gpa-tag a')
        .toArray()
        .map((link) => $(link).attr('href'))
    ).toEqual([
      `${outboxPath}?status=DEAD_LETTER`,
      `${outboxPath}?status=FAILED`
    ])
    expect(by($, 'list-clear-all').attr('href')).toBe(outboxPath)
    expect(asked()?.where).toEqual({ status: ['DEAD_LETTER', 'FAILED'] })
  })

  test('two statuses travel with every other link and form: the next filter, the time range and the search', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER&status=FAILED`)
    const fieldsOf = (form: ReturnType<CheerioAPI>) =>
      form
        .find('input[type="hidden"][name="status"]')
        .toArray()
        .map((input) => $(input).attr('value'))

    expect(chipItems($, 'eventType')[1].href).toBe(
      `${outboxPath}?status=DEAD_LETTER&status=FAILED&event=CreateCase`
    )
    expect(fieldsOf(by($, 'list-range').find('form'))).toEqual([
      'DEAD_LETTER',
      'FAILED'
    ])
    expect(fieldsOf(by($, 'list-search').find('form'))).toEqual([
      'DEAD_LETTER',
      'FAILED'
    ])
  })

  test('two filters: a tag for each value, and Clear all goes to the bare list', async () => {
    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&event=UpdateCaseStatus`
    )

    expect(tags($)).toEqual([
      'Status is Dead letter',
      'Event is UpdateCaseStatus'
    ])
    expect(by($, 'list-clear-all').attr('href')).toBe(outboxPath)
  })

  test('no filter set: no tag and no Clear all', async () => {
    const { $ } = await view()

    expect(tags($)).toEqual([])
    expect(by($, 'list-clear-all')).toHaveLength(0)
  })

  test('Audit is one more Event type, listed last, and All filters by no type', async () => {
    const { $ } = await view()

    expect(chipItems($, 'eventType').map(({ text }) => text)).toEqual([
      'All',
      'CreateCase',
      'UpdateCaseStatus',
      'Audit'
    ])
    expect(asked()?.where).toEqual({})
  })

  test('Event is Audit: picked as any type is', async () => {
    const { $ } = await view(`${outboxPath}?event=Audit`)

    expect(tags($)).toEqual(['Event is Audit'])
    expect(asked()?.where).toEqual({ eventType: 'Audit' })
  })

  test('an old link with the audit switch on goes to the same list without it, every other filter kept', async () => {
    const { statusCode, location } = await view(
      `${outboxPath}?status=DEAD_LETTER&audit=on&event=CreateCase&from=2026-11-03&to=2026-11-09`
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(location).toBe(
      `${outboxPath}?status=DEAD_LETTER&event=CreateCase&from=2026-11-03&to=2026-11-09`
    )
    expect(vi.mocked(queryBucketUseCase)).not.toHaveBeenCalled()
  })

  test('an old audit link with a key the list doesn’t declare is refused, as any such address is', async () => {
    const { statusCode } = await view(`${outboxPath}?audit=on&nope=1`)

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('the interim error filter: Error name is …, in code, with its remove link', async () => {
    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&errorname=MongoServerError`
    )

    expect(tags($)).toEqual([
      'Status is Dead letter',
      'Error name is MongoServerError'
    ])
    expect(
      by($, 'list-applied').find('.gpa-tag').eq(1).find('strong').attr('class')
    ).toBe('gpa-mono')
    expect(by($, 'list-applied').find('.gpa-tag a').eq(1).attr('href')).toBe(
      `${outboxPath}?status=DEAD_LETTER`
    )
    expect(asked()?.where).toEqual({
      status: 'DEAD_LETTER',
      'lastError.name': 'MongoServerError'
    })
  })

  test('the Overview error filter: Error is …, in code', async () => {
    const { $ } = await view(`${outboxPath}?error=abc123`)

    expect(tags($)).toEqual(['Error is abc123'])
  })

  test('Created: quick ranges are links that keep the other filters, and Any time is first', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    const presets = by($, 'list-range')
      .find('.gpa-range-presets a')
      .toArray()
      .map((a) => [flat($(a).text()), $(a).attr('href')])

    expect(presets).toEqual([
      ['Any time', `${outboxPath}?status=DEAD_LETTER`],
      [
        'Last hour',
        `${outboxPath}?status=DEAD_LETTER&from=2026-10-13T14%3A20%3A00.000Z&range=1h`
      ],
      [
        'Last 24 hours',
        `${outboxPath}?status=DEAD_LETTER&from=2026-10-12T15%3A20%3A00.000Z&range=24h`
      ],
      [
        'Last 7 days',
        `${outboxPath}?status=DEAD_LETTER&from=2026-10-06T15%3A20%3A00.000Z&range=7d`
      ],
      [
        'Last 30 days',
        `${outboxPath}?status=DEAD_LETTER&from=2026-09-13T15%3A20%3A00.000Z&range=30d`
      ]
    ])
    expect(
      by($, 'list-range')
        .find('form input[type="hidden"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toEqual([['status', 'DEAD_LETTER']])
    expect(by($, 'list-range').attr('data-max')).toBe('2026-10-13')
  })

  test('Created, a quick range: the chip and its tag name it', async () => {
    const { $ } = await view(
      `${outboxPath}?from=2026-10-12T15%3A20%3A00.000Z&range=24h`
    )

    expect(by($, 'list-range').find('.gpa-chip-value').text()).toBe(
      'Last 24 hours'
    )
    expect(tags($)).toEqual(['Created is Last 24 hours'])
    expect(by($, 'list-applied').find('.gpa-tag a').attr('href')).toBe(
      outboxPath
    )
    expect(asked()?.from).toBe('2026-10-12T15:20:00.000Z')
  })

  test('Created, from the calendar: whole days in the chosen zone, "Created is 3–9 Nov 2026"', async () => {
    const { $ } = await view(`${outboxPath}?from=2026-11-03&to=2026-11-09`)

    expect(by($, 'list-range').find('.gpa-chip-value').text()).toBe(
      '3–9 Nov 2026'
    )
    expect(tags($)).toEqual(['Created is 3–9 Nov 2026'])
    expect(by($, 'list-range').find('input[name="from"]').attr('value')).toBe(
      '2026-11-03'
    )
    expect(asked()).toEqual(
      expect.objectContaining({
        from: '2026-11-03T00:00:00.000Z',
        to: '2026-11-09T23:59:59.999Z'
      })
    )
  })

  test('Created, from the calendar in UK time: the day’s edges are UK midnight', async () => {
    await view(
      `${outboxPath}?from=2026-10-01&to=2026-10-02`,
      'dev-ops-times=uk'
    )

    expect(asked()).toEqual(
      expect.objectContaining({
        from: '2026-09-30T23:00:00.000Z',
        to: '2026-10-02T22:59:59.999Z'
      })
    )
  })

  test('a day that doesn’t exist is a bad link', async () => {
    const { statusCode } = await view(`${outboxPath}?from=2026-02-30`)

    expect(statusCode).toBe(statusCodes.badRequest)
  })
})

describe('the time range in links', () => {
  test('every chip, menu and tag link carries the range as days, as the range chip does', async () => {
    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&from=2026-10-01&to=2026-10-31`
    )
    const range = 'from=2026-10-01&to=2026-10-31'
    const links = [
      ...chipItems($, 'status').map(({ href }) => href),
      ...chipItems($, 'eventType').map(({ href }) => href),
      by($, 'list-applied').find('.gpa-tag a').first().attr('href')
    ]

    expect(links.every((href) => href?.includes(range))).toBe(true)
    expect(asked()).toEqual(
      expect.objectContaining({
        from: '2026-10-01T00:00:00.000Z',
        to: '2026-10-31T23:59:59.999Z'
      })
    )
  })
})

describe('a value its fact doesn’t offer', () => {
  test.each(['status=BOGUS', 'status=FAILED&status=BOGUS', 'event=Nope'])(
    '%s is refused as an address the list can’t read, before GAS is asked',
    async (query) => {
      const { $, statusCode } = await view(`${outboxPath}?${query}`)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(alertOf($).title).toBe(
        'This address has a filter the list doesn’t have.'
      )
      expect(queryBucketUseCase).not.toHaveBeenCalled()
    }
  )

  test('a code a version sits within is read even with no rows yet, as a version page links to it', async () => {
    const { statusCode } = await view(
      '/dev-ops/applications?grant=new-grant&version=1.0.0'
    )

    expect(statusCode).toBe(statusCodes.ok)
    expect(asked()?.where).toEqual({
      code: 'new-grant',
      currentConfigVersion: '1.0.0'
    })
  })
})

describe('a key that takes one value, given twice', () => {
  test.each(['error=A&error=B', 'errorname=A&errorname=B'])(
    '%s is refused as an address the list can’t read, before GAS is asked',
    async (query) => {
      const { $, statusCode } = await view(`${outboxPath}?${query}`)

      expect(statusCode).toBe(statusCodes.badRequest)
      expect(alertOf($).title).toBe(
        'This address has a filter the list doesn’t have.'
      )
      expect(queryBucketUseCase).not.toHaveBeenCalled()
    }
  )

  test('a search posted as a form with it twice is refused the same way', async () => {
    const { statusCode, result } = await server.inject({
      method: 'POST',
      url: outboxPath,
      payload: 'error=A&error=B&ref-kind=id&ref-value=abc-123',
      auth: { strategy: 'session', credentials },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin'
      }
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(alertOf(load(result as unknown as string)).title).toBe(
      'This address has a filter the list doesn’t have.'
    )
  })
})

describe('the total', () => {
  const totalOf = ($: CheerioAPI) =>
    by($, 'list-applied').find('.gpa-filterbar-total')

  test.each([
    [{ count: 12456, capped: false }, '12,456 events'],
    [{ count: 10000, capped: true }, '10,000+ events'],
    [{ count: 1, capped: false }, '1 event'],
    [{ count: 0, capped: false }, '0 events']
  ])('%j: "%s" at the end of the applied row', async (total, text) => {
    given(answered(exact({ total })))

    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(flat(totalOf($).text())).toBe(text)
    expect(totalOf($).attr('role')).toBe('status')
    expect(by($, 'list-applied').children().last().is(totalOf($))).toBe(true)
  })

  test('a search is counted too: its total beside its tag', async () => {
    given(answered(exact({ total: { count: 1, capped: false } })))

    const { $ } = await searched('id', 'abc-123')

    expect(tags($)).toEqual(['Event ID is abc-123'])
    expect(flat(totalOf($).text())).toBe('1 event')
  })

  test('drawn with no filter applied', async () => {
    given(answered(exact({ total: { count: 3, capped: false } })))

    const { $ } = await view()

    expect(flat(totalOf($).text())).toBe('3 events')
    expect(by($, 'list-applied').find('.gpa-tag')).toHaveLength(0)
  })

  test('the list’s own noun: "4 applications"', async () => {
    given(answered(exact({ rows: [], total: { count: 4, capped: false } })))

    const { $ } = await view('/dev-ops/applications')

    expect(flat(totalOf($).text())).toBe('4 applications')
  })

  test.each([
    [
      'on a bounded read',
      answered({
        ...bounded({
          keepLooking: 'k1',
          searchedTo: '2026-10-06T14:00:00.000Z'
        }),
        total: null
      })
    ],
    ['from a service that doesn’t count yet', answered(exact())],
    ['when the list couldn’t be read', failed(false)]
  ])('none %s', async (_why, read) => {
    given(read)

    const { $ } = await view()

    expect(totalOf($)).toHaveLength(0)
  })
})

describe('search', () => {
  test('the kinds are the catalogue’s, in its order, posted to the list with the other filters', async () => {
    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    const form = by($, 'list-search').find('form')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(outboxPath)
    expect(
      form
        .find('select[name="ref-kind"] option')
        .toArray()
        .map((option) => [$(option).attr('value'), $(option).text()])
    ).toEqual([
      ['ref', 'Reference'],
      ['trace', 'Trace ID'],
      ['id', 'Event ID']
    ])
    expect(form.find('input[type="hidden"][name="status"]').val()).toBe(
      'DEAD_LETTER'
    )
    expect(form.find('input[name="ref-value"]')).toHaveLength(1)
  })

  test('both kind pickers are drawn, so CSS picks one by scripting and nothing swaps on load', async () => {
    const { $ } = await view()
    const picker = by($, 'list-search').find('gpa-search-kind')
    const menu = picker.children('gpa-dropdown[data-gpa-picker]')

    expect(
      picker.children('select.gpa-search-kind-native').is('[hidden]')
    ).toBe(false)
    expect(menu.is('[hidden]')).toBe(false)
    expect(
      menu
        .find('.gpa-menuitem')
        .toArray()
        .map((item) => [$(item).attr('data-value'), flat($(item).text())])
    ).toEqual([
      ['ref', 'Reference'],
      ['trace', 'Trace ID'],
      ['id', 'Event ID']
    ])
  })

  test('a search is kept out of the address: the list reads it back and tags it, in code', async () => {
    const posted = await post({ 'ref-kind': 'id', 'ref-value': 'abc-123' })

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(outboxPath)

    const { $ } = await view(posted.location, posted.cookie)

    expect(asked()?.ref).toBe('id:abc-123')
    expect(tags($)).toEqual(['Event ID is abc-123'])
    expect(by($, 'list-search-input').find('input').attr('value')).toBe(
      'abc-123'
    )
  })

  test('a search posted as a form keeps two statuses, sent as two fields', async () => {
    const { statusCode, headers } = await server.inject({
      method: 'POST',
      url: outboxPath,
      payload: 'status=DEAD_LETTER&status=FAILED&ref-kind=id&ref-value=abc-123',
      auth: { strategy: 'session', credentials },
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'sec-fetch-site': 'same-origin'
      }
    })

    expect(statusCode).toBe(statusCodes.seeOther)
    expect(headers.location).toBe(
      `${outboxPath}?status=DEAD_LETTER&status=FAILED`
    )
  })

  test('the search tag clears it with a post, as it was set', async () => {
    const { $ } = await searched('id', 'abc-123')

    const remove = by($, 'list-applied').find('.gpa-tag button')
    const form = $(`#${remove.attr('form')}`)

    expect(remove.attr('name')).toBe('ref-value')
    expect(remove.attr('value')).toBe('')
    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(outboxPath)
    expect(form.find('input[name="ref-value"]')).toHaveLength(0)
  })

  test('Clear all drops the stored search too', async () => {
    const { $, cookie } = await searched('id', 'abc-123')
    const clearAll = by($, 'list-clear-all')

    expect(clearAll.attr('href')).toBe(`${outboxPath}?clear=all`)

    const withStatus = await view(`${outboxPath}?status=DEAD_LETTER`, cookie)
    const href = by(withStatus.$, 'list-clear-all').attr('href')

    expect(href).toBe(`${outboxPath}?clear=all`)

    const cleared = await view(href, withStatus.cookie)

    expect(cleared.statusCode).toBe(statusCodes.found)
    expect(cleared.location).toBe(outboxPath)

    await view(cleared.location, cleared.cookie)

    expect(asked()?.ref).toBeUndefined()
  })

  test('bad characters: the box says why, with what was typed, and nothing is stored', async () => {
    const { $, statusCode, cookie } = await post({
      'ref-kind': 'ref',
      'ref-value': 'a b'
    })

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(textOf($, 'list-search-error')).toBe(
      'Enter an identifier using only letters, numbers and . _ : @ -'
    )
    expect(by($, 'list-search-input').find('input').attr('value')).toBe('a b')

    await view(outboxPath, cookie)

    expect(asked()?.ref).toBeUndefined()
  })
})

describe('No matches', () => {
  test('filters on: the prototype’s empty state, and the tags stay', async () => {
    given(answered(exact({ rows: [] })))

    const { $ } = await view(
      `${outboxPath}?status=DEAD_LETTER&event=CreateCase`
    )

    expect(flat($('.gpa-empty-title').text())).toBe('No events match')
    expect(flat($('.gpa-empty-body').text())).toBe(
      'Nothing created in this time range has this status and event.'
    )
    expect(tags($)).toHaveLength(2)
  })

  test('only a search on: the search names what had no match', async () => {
    given(answered(exact({ rows: [] })))

    const { $ } = await searched('trace', 'abc')

    expect(flat($('.gpa-empty-body').text())).toBe(
      'No events have this trace ID.'
    )
  })

  test('nothing on: the queue is empty, and says what would be here', async () => {
    given(answered(exact({ rows: [] })))

    const { $ } = await view()

    expect(flat($('.gpa-empty-title').text())).toBe('No events yet')
    expect(flat($('.gpa-empty-body').text())).toBe(
      'Events GAS sends appear here.'
    )
  })
})

describe('paging', () => {
  test('a next page: Show more links to it, and the element loads it in place', async () => {
    given(answered(exact({ page: { ...exact().page, next: 'c2' } })))

    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(by($, 'list-footer').parent().is('gpa-load-more')).toBe(true)
    expect(by($, 'list-footer').find('a').attr('href')).toBe(
      `${outboxPath}?cursor=c2&status=DEAD_LETTER`
    )
    expect(flat(by($, 'list-footer').text())).toBe('Show more events')
    expect($('tbody#list-rows')).toHaveLength(1)
  })

  test('a later page is that page’s rows, read from its cursor, with no empty state', async () => {
    given(answered(exact({ rows: [] })))

    const { $, statusCode } = await view(`${outboxPath}?cursor=c2`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(asked()?.cursor).toBe('c2')
    expect($('.gpa-empty')).toHaveLength(0)
  })

  test('Searched, keep looking: where the read stopped, and the way on', async () => {
    given(
      answered(
        bounded({ keepLooking: 'k1', searchedTo: '2026-10-06T14:00:00.000Z' }, [
          eventRow()
        ])
      )
    )

    const { $ } = await searched('ref', 'abc')
    const id = asked()

    expect(id?.ref).toBe('ref:abc')
    expect(flat(by($, 'list-footer').find('span').first().text())).toBe(
      'Searched back to 6 Oct 2026 14:00.'
    )
    expect(flat(by($, 'list-footer').find('a').text())).toBe('Keep looking')
    expect(by($, 'list-footer').find('a').attr('href')).toMatch(
      /^\/dev-ops\/events\/gas\/outbox\?cursor=k1&searched=[0-9a-f-]{36}$/
    )
  })

  test('Searched, keep looking, nothing yet: the empty state says so and the footer stays', async () => {
    given(
      answered(
        bounded({ keepLooking: 'k1', searchedTo: '2026-10-06T14:00:00.000Z' })
      )
    )

    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(flat($('.gpa-empty-title').text())).toBe('No matches so far')
    expect(by($, 'list-footer')).toHaveLength(1)
  })

  test('Searched everything: a bounded read that reached the end says so', async () => {
    given(answered(bounded({ complete: true }, [eventRow()])))

    const { $ } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(flat(by($, 'list-footer').text())).toBe('Searched everything.')
  })

  test('an exact read that reached the end says nothing more', async () => {
    const { $ } = await view()

    expect(by($, 'list-footer')).toHaveLength(0)
  })

  test('Load more failed: the page, no rows, and a retry of the same page; the element sees the failure', async () => {
    given(failed(false))

    const { $, statusCode } = await view(`${outboxPath}?cursor=c2`)

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(by($, 'list-row')).toHaveLength(0)
    expect(by($, 'list-alert')).toHaveLength(0)
    expect(flat(by($, 'list-footer').find('.gpa-text-danger').text())).toBe(
      'Couldn’t load more events — GAS didn’t answer.'
    )
    expect(flat(by($, 'list-footer').find('a').text())).toBe('Retry')
    expect(by($, 'list-footer').find('a').attr('href')).toBe(
      `${outboxPath}?cursor=c2`
    )
    expect(by($, 'list-footer').attr('role')).toBe('alert')
  })

  test('a later page of a search no longer held goes back to the first page', async () => {
    const { statusCode, location } = await view(
      `${outboxPath}?cursor=c2&searched=0b7c1d1e-0000-4000-8000-000000000001`
    )

    expect(statusCode).toBe(statusCodes.found)
    expect(location).toBe(outboxPath)
  })
})

describe('Search refused', () => {
  test('the service’s reason in code, the search cleared, and the list read again without it', async () => {
    given(refused, answered())

    const { $, statusCode, cookie } = await searched('ref', 'a'.repeat(120))

    expect(statusCode).toBe(statusCodes.ok)
    expect(alertOf($)).toEqual({
      tone: 'warning',
      title: 'GAS refused this search.',
      body: '"ref-value" must be at most 100 characters The search has been cleared.'
    })
    expect(by($, 'list-alert').find('code').text()).toBe(
      '"ref-value" must be at most 100 characters'
    )
    expect(by($, 'list-start-again').attr('href')).toBe(outboxPath)
    expect(asked()?.ref).toBeUndefined()
    expect(by($, 'list-row')).toHaveLength(1)
    expect(tags($)).toEqual([])

    await view(outboxPath, cookie)

    expect(asked()?.ref).toBeUndefined()
  })

  test('refused filters: the reason, Start again, and no rows', async () => {
    given(refused)

    const { $, statusCode } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(alertOf($).title).toBe('GAS refused these filters.')
    expect(by($, 'list-table')).toHaveLength(0)
  })

  test('a key the list doesn’t declare is refused before GAS is asked', async () => {
    const { $, statusCode } = await view(`${outboxPath}?nope=1`)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(alertOf($).title).toBe(
      'This address has a filter the list doesn’t have.'
    )
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })
})

describe('Unavailable', () => {
  test('timed out: the prototype’s copy, Try again on this address, no table, the filters kept', async () => {
    given(failed(true))

    const { $, statusCode } = await view(`${outboxPath}?status=DEAD_LETTER`)

    expect(statusCode).toBe(statusCodes.gatewayTimeout)
    expect(alertOf($)).toEqual({
      tone: 'danger',
      title: 'The events list couldn’t be loaded.',
      body: 'GAS didn’t answer in time. Nothing has changed — try again in a moment.'
    })
    expect(by($, 'list-retry').attr('href')).toBe(
      `${outboxPath}?status=DEAD_LETTER`
    )
    expect(by($, 'list-table')).toHaveLength(0)
    expect(by($, 'list-chip-status')).toHaveLength(1)
  })

  test('answered with an error: says so, apart from a timeout, and where to look if it keeps failing', async () => {
    given(failed(false, true))

    const { $, statusCode } = await view(outboxPath)

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(alertOf($)).toEqual({
      tone: 'danger',
      title: 'The events list couldn’t be loaded.',
      body: 'GAS answered with an error. Nothing has changed — try again in a moment; if it keeps failing, check GAS’s logs.'
    })
    expect(by($, 'list-retry').attr('href')).toBe(outboxPath)
    expect(by($, 'list-table')).toHaveLength(0)
  })

  test('no connection: GAS couldn’t be reached, on a CW list too, since the app talks only to GAS', async () => {
    given(failed(false))

    const { $, statusCode } = await view('/dev-ops/events/cw/outbox')

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(alertOf($).body).toBe(
      'GAS couldn’t be reached. Nothing has changed — try again in a moment.'
    )
  })
})

describe('Caseworking unreachable', () => {
  const cwDown: Catalogue = {
    buckets: fullCatalogue.buckets.filter(({ service }) => service !== 'CW'),
    sourceErrors: [{ hop: 'CW-BE' }]
  }

  test('a CW events address with CW missing from the catalogue says why, and isn’t a 404', async () => {
    withCatalogue(cwDown)

    const { $, statusCode } = await view('/dev-ops/events/cw/inbox')

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(textOf($, 'list-title')).toBe('Events')
    expect(flat($('.gpa-pageheader-meta').text())).toBe('Caseworking')
    expect(alertOf($)).toEqual({
      tone: 'danger',
      title: 'Caseworking can’t be reached.',
      body: 'GAS is up, but its calls to CW are failing, so CW’s events can’t be listed. Nothing has changed.'
    })
    expect(by($, 'list-retry').attr('href')).toBe('/dev-ops/events/cw/inbox')
    expect(by($, 'list-table')).toHaveLength(0)
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })

  test('the sidebar keeps CW’s Events', async () => {
    withCatalogue(cwDown)

    const { $ } = await view('/dev-ops/events/cw/inbox')

    expect($('[data-testid="shell-nav-cw.outbox"]').attr('href')).toBe(
      '/dev-ops/events/cw/outbox'
    )
  })

  test('without the CW-BE source error, a missing list is not found', async () => {
    withCatalogue({ ...cwDown, sourceErrors: [] })

    const { statusCode } = await view('/dev-ops/events/cw/inbox')

    expect(statusCode).toBe(statusCodes.notFound)
  })
})

describe('the other lists, on the same page', () => {
  test('Applications: Reference, Grant and Received, no position, the service under the title', async () => {
    given(
      answered(
        exact({
          rows: [
            {
              id: 'a1',
              time: '2026-10-13T10:00:00.000Z',
              title: 'abc-123',
              subtitle: null,
              cells: {
                code: 'woodland@1.4.2',
                position: { phase: 'P', stage: 'S', status: 'X' }
              },
              link: {
                kind: 'application',
                code: 'woodland',
                clientRef: 'abc-123'
              }
            }
          ],
          groups: []
        })
      )
    )

    const { $ } = await view('/dev-ops/applications')

    expect(textOf($, 'list-title')).toBe('Applications')
    expect(flat($('.gpa-pageheader-meta').text())).toBe(
      'Grant Application Service'
    )
    expect(by($, 'list-tabs')).toHaveLength(0)
    expect(headers($)).toEqual(['Reference', 'Grant', 'Received'])
    expect(firstRowCells($)).toEqual([
      'abc-123',
      'woodland@1.4.2',
      '13 Oct 2026 10:00',
      ''
    ])
    expect(by($, 'list-range').find('.gpa-chip-label').text()).toBe('Received:')
  })

  test('Grants: one Grant column, Stored with its hint, the code alone without a version', async () => {
    given(
      answered(
        exact({
          rows: [
            {
              id: 'g1',
              time: '2026-10-13T10:00:00.000Z',
              title: 'woodland',
              subtitle: null,
              cells: {
                version: '1.4.2',
                definition: 'pending',
                status: 'active'
              },
              link: { kind: 'grant', code: 'woodland', version: '1.4.2' }
            },
            {
              id: 'g2',
              time: '2026-10-13T10:00:00.000Z',
              title: 'hedgerow',
              subtitle: null,
              cells: {
                version: null,
                definition: 'permanent_error',
                status: 'draft'
              },
              link: { kind: 'grant', code: 'hedgerow', version: '0.0.1' }
            }
          ],
          groups: []
        })
      )
    )

    const { $ } = await view('/dev-ops/grants')

    expect(flat($('.gpa-pageheader-meta').text())).toBe(
      'Grant Application Service'
    )
    expect(headers($)).toEqual(['Grant', 'Stored', 'Status', 'Received'])
    expect(firstRowCells($).slice(0, 3)).toEqual([
      'woodland@1.4.2',
      expect.stringContaining('Not stored yet'),
      'Active'
    ])
    expect(
      by($, 'list-row').first().find('gpa-tooltip').attr('text')
    ).toContain("isn't fetched by GAS yet")
    expect(flat(by($, 'list-row').eq(1).find('td').first().text())).toBe(
      'hedgerow'
    )
    expect(
      by($, 'list-row').eq(1).find('.gpa-dot').eq(0).attr('class')
    ).toContain('gpa-dot-danger')
    expect(
      by($, 'list-chip-worstFetchStatus').find('.gpa-chip-label').text()
    ).toBe('Stored:')
    expect(by($, 'list-search')).toHaveLength(0)
  })

  test('Workflows and Cases: CW’s, with their own labels', async () => {
    given(
      answered(exact({ rows: [], groups: [] })),
      answered(exact({ rows: [], groups: [] }))
    )

    const workflows = await view('/dev-ops/workflows')
    const cases = await view('/dev-ops/cases')

    expect(headers(workflows.$)).toEqual([
      'Workflow',
      'Stored',
      'Status',
      'Received'
    ])
    expect(headers(cases.$)).toEqual(['Reference', 'Grant', 'Created'])
    expect(flat(workflows.$('.gpa-pageheader-meta').text())).toBe('Caseworking')
    expect(flat(cases.$('.gpa-pageheader-meta').text())).toBe('Caseworking')
    expect(flat(cases.$('.gpa-empty-body').text())).toBe(
      'Cases CW creates appear here.'
    )
  })
})

describe('a refused search whose re-read fails too', () => {
  test('the re-read times out: the list’s own Unavailable, with Try again, and 504', async () => {
    given(refused, failed(true))

    const { $, statusCode } = await searched('ref', 'x'.repeat(120))

    expect(statusCode).toBe(statusCodes.gatewayTimeout)
    expect(alertOf($).title).toBe('The events list couldn’t be loaded.')
    expect(by($, 'list-retry').attr('href')).toBe(outboxPath)
  })

  test('the filters are refused too: that refusal, and 400', async () => {
    given(refused, refused)

    const { $, statusCode } = await searched('ref', 'x'.repeat(120))

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(alertOf($).title).toBe('GAS refused these filters.')
  })

  test('on a later page, the list is read again from its first page', async () => {
    given(answered(exact({ page: { ...exact().page, next: 'c2' } })))

    const first = await searched('ref', 'abc')
    const href = by(first.$, 'list-footer').find('a').attr('href')!

    given(refused, answered())
    await view(href, first.cookie)

    expect(asked()?.cursor).toBeUndefined()
    expect(asked()?.ref).toBeUndefined()
  })
})

test('a chosen audit value is named by its label', async () => {
  const { $ } = await view(`${outboxPath}?event=Audit`)

  expect(by($, 'list-chip-eventType').find('.gpa-chip-value').text()).toBe(
    'Audit'
  )
})

test('a subtitle the catalogue sends for a list with no subtitle column is drawn under the title', async () => {
  given(
    answered(
      exact({
        rows: [
          {
            id: 'a1',
            time: '2026-10-13T10:00:00.000Z',
            title: 'abc-123',
            subtitle: 'Woodland application',
            cells: { code: 'woodland@1.4.2' },
            link: {
              kind: 'application',
              code: 'woodland',
              clientRef: 'abc-123'
            }
          }
        ],
        groups: []
      })
    )
  )

  const { $ } = await view('/dev-ops/applications')

  expect(by($, 'list-row').find('td').first().text()).toContain(
    'Woodland application'
  )
})
