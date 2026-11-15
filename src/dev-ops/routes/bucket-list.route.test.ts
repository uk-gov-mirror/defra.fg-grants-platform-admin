import { load, type Cheerio, type CheerioAPI } from 'cheerio'
import type { Element } from 'domhandler'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  applicationsBucket,
  catalogue,
  grantsBucket,
  outboxBucket,
  pagedInbox,
  pagedOutbox,
  summarisedBucket,
  toggledBucket,
  workflowsBucket
} from '../use-cases/test-fixtures.ts'
import {
  getBucketAtUseCase,
  getCatalogueUseCase
} from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketListResult,
  BucketResult,
  BucketRow
} from '../use-cases/query-bucket.use-case.ts'
import { queryBucketUseCase } from '../use-cases/query-bucket.use-case.ts'
import type {
  SummaryRead,
  SummaryResult
} from '../use-cases/summarise-bucket.use-case.ts'
import { summariseBucketUseCase } from '../use-cases/summarise-bucket.use-case.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/query-bucket.use-case.ts'))
vi.mock(import('../use-cases/summarise-bucket.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: {
    id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b',
    name: 'Ada Lovelace'
  },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-10-09T09:20:00.000Z')

const path = '/dev-ops/events/gas/outbox'

const applicationsPath = '/dev-ops/applications'

const row = (overrides: Partial<BucketRow> = {}): BucketRow => ({
  id: '66f000000000000000000001',
  time: '2026-10-09T09:14:03.120Z',
  title: 'UpdateCaseStatus',
  subtitle: '0b7c1d1e-0000-4000-8000-000000000001',
  cells: {
    status: 'DEAD_LETTER',
    grantCode: 'example-grant',
    completedAt: null
  },
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
    index: ['kind', 'status', 'eventType', 'publicationDate', '_id'],
    bound: ['status', 'eventType'],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [row()],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [
    {
      by: 'status',
      values: [
        { value: 'PUBLISHED', count: 0, capped: false },
        { value: 'DEAD_LETTER', count: 21, capped: false }
      ],
      total: { count: 48, capped: false }
    }
  ],
  ...overrides
})

const bounded = (overrides: Partial<BucketResult> = {}): BucketResult => ({
  bucket: 'gas.outbox',
  plan: {
    kind: 'bounded',
    index: ['kind', 'status', 'publicationDate', '_id'],
    bound: ['status'],
    filled: [],
    residual: ['grantCode'],
    scans: 1
  },
  rows: [],
  page: {
    next: null,
    keepLooking: 'eyJ0Ijoi',
    searchedTo: '2026-09-03T10:12:00.000Z',
    complete: false
  },
  groups: [],
  ...overrides
})

const applicationRow = (overrides: Partial<BucketRow> = {}): BucketRow =>
  row({
    title: 'abc-123-xyz',
    subtitle: null,
    cells: {
      code: 'example-grant',
      position: {
        phase: 'PRE_AWARD',
        stage: 'REVIEW_APPLICATION',
        status: 'IN_REVIEW'
      }
    },
    link: {
      kind: 'application',
      code: 'example-grant',
      clientRef: 'abc-123-xyz'
    },
    ...overrides
  })

const answered = (page: BucketResult | null = exact()): BucketListResult => ({
  page,
  unavailable: false,
  refused: false,
  refusal: null
})

const givenPage = (page: BucketResult = exact()) =>
  vi.mocked(queryBucketUseCase).mockResolvedValue(answered(page))

const refusal: BucketListResult = {
  page: null,
  unavailable: false,
  refused: true,
  refusal: 'A filter names a fact this bucket does not declare'
}

const outage: BucketListResult = {
  page: null,
  unavailable: true,
  refused: false,
  refusal: null
}

const flatten = (text: string) => text.replace(/\s+/g, ' ').trim()

/** Anything after the row's link that is positioned or stacked sits over its stretched overlay and swallows the click. */
const liftedOver = ($: CheerioAPI, cells: Cheerio<Element>) =>
  cells
    .find('td *')
    .toArray()
    .filter((node) => !$(node).is('a'))
    .filter((node) =>
      ($(node).attr('class') ?? '')
        .split(/\s+/)
        .some((name) => /^(relative|absolute|sticky|fixed|z-)/.test(name))
    )
    .map((node) => $(node).attr('data-testid') ?? node.tagName)

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

/** The session cookie a request carries, so a search posted earlier is read back. */
// UK time, the setting these expectations are written in.
const withCookie = (cookie: string) => ({
  cookie: [cookie, 'dev-ops-times=uk'].filter(Boolean).join('; ')
})

const viewPage = async (url = path, cookie = '') => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: withCookie(cookie)
  })

  return {
    $: load(result as unknown as string),
    statusCode,
    headers,
    cookie: cookieOf(headers['set-cookie']) || cookie
  }
}

const search = async (
  payload: Record<string, string>,
  cookie = '',
  url = path
) => {
  const { result, statusCode, headers } = await server.inject({
    method: 'POST',
    url,
    payload,
    auth: { strategy: 'session', credentials },
    headers: withCookie(cookie)
  })

  return {
    $: load(result as unknown as string),
    statusCode,
    location: headers.location,
    cookie: cookieOf(headers['set-cookie']) || cookie
  }
}

const part = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const textOf = ($: CheerioAPI, testId: string) =>
  flatten(part($, testId).text())

const textsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .toArray()
    .map((node) => flatten($(node).text()))

const hrefsOf = ($: CheerioAPI, testId: string) =>
  part($, testId)
    .toArray()
    .map((node) => $(node).attr('href'))

/** What GAS was asked for on the latest read: the search and whether it was a repeat. */
const asked = () => vi.mocked(queryBucketUseCase).mock.calls.at(-1)?.slice(1)

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.setSystemTime(now)
  givenPage()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe('the paths over the lists', () => {
  test('open the admin itself on the first list the catalogue names, temporarily', async () => {
    const { statusCode, headers } = await viewPage('/dev-ops')

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(path)
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })

  test.each([
    ['no catalogue could be read', null],
    ['the catalogue lists none', { buckets: [], sourceErrors: [] }]
  ])(
    'say the lists could not be loaded at the admin itself when %s, redirecting nowhere',
    async (_name, held) => {
      vi.mocked(getCatalogueUseCase).mockResolvedValueOnce(held)
      vi.mocked(getCatalogueUseCase).mockResolvedValueOnce(held)

      const { statusCode, headers, $ } = await viewPage('/dev-ops')

      expect(statusCode).toBe(statusCodes.serviceUnavailable)
      expect(headers.location).toBeUndefined()
      expect(part($, 'status-catalogue').find('h1').text()).toBe(
        'Dev Ops couldn’t read its lists'
      )
    }
  )

  test.each([
    ['a heading over lists', '/dev-ops/events'],
    ['a heading over one service’s lists', '/dev-ops/events/gas'],
    ['a list named by its id', '/dev-ops/buckets/gas.outbox'],
    ['a path that only starts like a list', '/dev-ops/events/gas/outboxes'],
    ['a path below a list', '/dev-ops/applications/more']
  ])(
    'answer %s with the not-found page, redirecting nowhere',
    async (_name, url) => {
      const { statusCode, headers, $ } = await viewPage(url)

      expect(statusCode).toBe(statusCodes.notFound)
      expect(headers.location).toBeUndefined()
      expect($('title').text()).toContain('Page not found')
      expect(queryBucketUseCase).not.toHaveBeenCalled()
    }
  )

  test('say the lists could not be loaded when no catalogue could be read', async () => {
    vi.mocked(getBucketAtUseCase).mockResolvedValueOnce({
      available: false,
      bucket: null
    })
    vi.mocked(getCatalogueUseCase).mockResolvedValueOnce(null)

    const { statusCode, $ } = await viewPage('/dev-ops/events')

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(part($, 'status-catalogue')).toHaveLength(1)
    expect(part($, 'bucket-table')).toHaveLength(0)
  })

  test('leave the routes beside them to answer for themselves', async () => {
    const { statusCode } = await server.inject({
      method: 'GET',
      url: '/health'
    })

    expect(statusCode).toBe(statusCodes.ok)
    expect(getBucketAtUseCase).not.toHaveBeenCalled()
  })

  test('brand the admin with a link to the first list', async () => {
    const { $ } = await viewPage()

    expect($('[data-testid$="-brand"]').first().attr('href')).toBe(path)
  })
})

describe('the navigation', () => {
  test('lists every bucket under its service, by the catalogue alone', async () => {
    const { $ } = await viewPage()

    expect(
      part($, 'shell-nav')
        .find('[role="group"]')
        .toArray()
        .map((group) => $(group).attr('aria-label'))
    ).toEqual(['Grant Application Service', 'Caseworking'])
    expect(part($, 'shell-nav-gas.outbox').attr('href')).toBe(path)
    expect(part($, 'shell-nav-gas.outbox').text().trim()).toBe(
      'Grant Application Service Outbox'
    )
    expect(part($, 'bucket-title').text()).toBe('GAS outbox')
    expect(part($, 'shell-nav-gas.applications').attr('href')).toBe(
      applicationsPath
    )
    expect(part($, 'shell-nav-gas.outbox').find('svg').attr('data-icon')).toBe(
      'radio-tower'
    )
    expect(
      part($, 'shell-nav-gas.applications').find('svg').attr('data-icon')
    ).toBe('file-text')
  })

  test('marks the bucket on show', async () => {
    const { $ } = await viewPage(applicationsPath)

    expect(
      $('[data-testid="shell-nav"] [aria-current="page"]').text().trim()
    ).toBe('Applications')
  })
})

describe('a bucket list', () => {
  test('opens on the newest rows, asking for a plain browse', async () => {
    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(queryBucketUseCase).toHaveBeenCalledTimes(1)
    expect(queryBucketUseCase).toHaveBeenCalledWith(
      outboxBucket,
      { where: {} },
      false
    )
    expect(textOf($, 'bucket-title')).toBe('GAS outbox')
    expect($('title').text()).toContain('GAS outbox')
    expect(part($, 'bucket-row')).toHaveLength(1)
  })

  test('is not found for a bucket the catalogue has not got', async () => {
    const { statusCode } = await viewPage('/dev-ops/events/gas/nothing')

    expect(statusCode).toBe(statusCodes.notFound)
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })

  test('says it could not be loaded when there is no catalogue to find it in', async () => {
    vi.mocked(getBucketAtUseCase).mockResolvedValueOnce({
      available: false,
      bucket: null
    })

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.serviceUnavailable)
    expect(part($, 'status-catalogue')).toHaveLength(1)
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })

  test('keeps out of shared caches but lets Back restore it', async () => {
    const { headers } = await viewPage()

    expect(headers['cache-control']).toBe('private, no-cache')
  })

  test('heads the table with the title, each declared column and the time', async () => {
    const { $ } = await viewPage()

    expect(
      part($, 'bucket-head')
        .find('th')
        .toArray()
        .map((head) => $(head).text())
    ).toEqual(['Event', 'Status', 'Grant', 'Created'])
  })

  test('draws an event row by its short name, with its id, status, grant and when', async () => {
    const { $ } = await viewPage(`${path}?status=DEAD_LETTER`)

    const link = part($, 'bucket-row-link')

    expect(link.attr('href')).toBe(
      `/dev-ops/events/gas/outbox/66f000000000000000000001?back=${encodeURIComponent(`${path}?status=DEAD_LETTER`)}`
    )
    expect(textOf($, 'bucket-row-title')).toBe('UpdateCaseStatus')
    expect(link.find('.sr-only').text()).toBe(
      'Update case status, 0b7c1d1e-0000-4000-8000-000000000001'
    )
    expect(textOf($, 'bucket-row-subtitle')).toBe(
      '0b7c1d1e-0000-4000-8000-000000000001'
    )
    expect(
      part($, 'bucket-cell-status').find('[data-testid="do-status-label"]')
    ).toHaveLength(1)
    expect(textOf($, 'bucket-cell-status')).toBe('Dead letter')
    expect(
      part($, 'bucket-cell-status')
        .find('[data-testid="do-status-dot"]')
        .hasClass('status-error')
    ).toBe(true)
    expect(textOf($, 'bucket-cell-grantCode')).toBe('example-grant')
    expect(textOf($, 'bucket-row-time-at')).toBe(
      '6m ago (9 Oct 2026 10:14:03.120)'
    )
    expect(part($, 'bucket-row').attr('class')).toContain('bg-error/5')
  })

  test('draws a record row by its reference, with its position spoken whole', async () => {
    givenPage(
      exact({
        bucket: 'gas.applications',
        rows: [applicationRow()]
      })
    )

    const { $ } = await viewPage(applicationsPath)

    const link = part($, 'bucket-row-link')

    expect(link.attr('href')).toBe(
      `/dev-ops/applications/example-grant/abc-123-xyz?back=${encodeURIComponent(applicationsPath)}`
    )
    expect(link.attr('class')).toContain('font-mono')
    expect(flatten(link.text())).toBe('abc-123-xyz')
    expect(part($, 'bucket-row-tag')).toHaveLength(0)
    expect(textOf($, 'bucket-cell-position-label')).toBe('In review')
    expect(part($, 'bucket-cell-position').find('.sr-only').text()).toBe(
      'Pre award › Review application › In review'
    )
    expect(part($, 'bucket-row-subtitle')).toHaveLength(0)
  })

  test('lifts nothing in a row over its link, so a click anywhere opens it', async () => {
    givenPage(exact({ rows: [row(), applicationRow()] }))

    const { $ } = await viewPage()

    expect(liftedOver($, part($, 'bucket-row'))).toEqual([])
  })

  test('draws a dash for a cell and a title the row has not got', async () => {
    givenPage(
      exact({ rows: [row({ title: null, subtitle: null, cells: {} })] })
    )

    const { $ } = await viewPage()

    expect(textOf($, 'bucket-row-title')).toBe('—')
    expect(textOf($, 'bucket-cell-status-none')).toBe('—')
    expect(textOf($, 'bucket-cell-grantCode-none')).toBe('—')
  })

  test('draws a row with no page of its own as no link, with no hover', async () => {
    givenPage(exact({ rows: [row({ link: null })] }))

    const { $ } = await viewPage()

    expect(part($, 'bucket-row')).toHaveLength(1)
    expect(part($, 'bucket-row-link')).toHaveLength(0)
    expect(part($, 'bucket-row').attr('class')).not.toContain('cursor-pointer')
  })

  test('escapes whatever a row holds', async () => {
    const xss = '<script>alert(1)</script>'

    givenPage(
      exact({
        rows: [
          row({
            title: xss,
            subtitle: xss,
            cells: { status: xss, grantCode: xss }
          })
        ]
      })
    )

    const { $ } = await viewPage()

    expect(part($, 'bucket-table').find('script')).toHaveLength(0)
    expect(textOf($, 'bucket-cell-grantCode')).toBe(xss)
  })

  test('says nothing was found when nothing matches', async () => {
    givenPage(exact({ rows: [] }))

    const { $ } = await viewPage()

    expect(textOf($, 'bucket-empty')).toBe('No events found.')
    expect(part($, 'bucket-table')).toHaveLength(0)
    expect(part($, 'bucket-tail').attr('hidden')).toBeDefined()
  })
})

describe('the tiles', () => {
  test('draw the first grouping: All with the total, then each value with its count', async () => {
    const { $ } = await viewPage()

    expect(part($, 'bucket-tiles').attr('aria-label')).toBe('Filter by status')
    expect(textsOf($, 'bucket-tile-label')).toEqual([
      'All',
      'Queued',
      'Dead letter'
    ])
    expect(textsOf($, 'bucket-tile-count')).toEqual(['48', '0', '21'])
    expect(hrefsOf($, 'bucket-tile')).toEqual([
      path,
      `${path}?status=PUBLISHED`,
      `${path}?status=DEAD_LETTER`
    ])
    expect(
      part($, 'bucket-tile')
        .toArray()
        .map((tile) => $(tile).attr('data-value'))
    ).toEqual([undefined, 'PUBLISHED', 'DEAD_LETTER'])
    expect(part($, 'bucket-tile').first().attr('aria-current')).toBe('page')
    expect(part($, 'bucket-tile').last().attr('aria-label')).toBe(
      'Dead letter: 21 events'
    )
  })

  test('colour a count that needs attention, and quieten a count of none', async () => {
    const { $ } = await viewPage()

    const counts = part($, 'bucket-tile-count')

    expect(counts.eq(1).attr('class')).toContain('text-base-content/70')
    expect(counts.eq(2).attr('class')).toContain('text-error')
  })

  test('mark the chosen one, and keep the count of All while one is chosen', async () => {
    const { $ } = await viewPage(`${path}?status=DEAD_LETTER`)

    expect(part($, 'bucket-tile').last().attr('aria-current')).toBe('page')
    expect(textsOf($, 'bucket-tile-count')).toEqual(['48', '0', '21'])
  })

  test('draw a dash for every count on a read that could not count', async () => {
    givenPage(
      bounded({ groups: [{ by: 'status', values: null, total: null }] })
    )

    const { $ } = await viewPage(`${path}?grant=example-grant`)

    expect(textsOf($, 'bucket-tile-count')).toEqual(['—', '—', '—'])
  })

  test('write a capped count with a plus', async () => {
    const total = { count: 10000, capped: true }
    const [status] = exact().groups

    givenPage(exact({ groups: [{ ...status, total }] }))

    const { $ } = await viewPage()

    expect(textsOf($, 'bucket-tile-count')[0]).toBe('10,000+')
  })
})

describe('the filters', () => {
  test('size a menu to its longest option, on one line, cut short with its whole text on hover if it cannot fit', async () => {
    const { $ } = await viewPage()

    const panel = part($, 'bucket-filter-eventType-panel')
    const option = part($, 'bucket-filter-eventType-chip').last()

    expect(panel.hasClass('w-max')).toBe(true)
    expect(panel.hasClass('w-60')).toBe(false)
    expect(option.hasClass('whitespace-nowrap')).toBe(true)
    expect(option.find('span').last().hasClass('truncate')).toBe(true)
    expect(option.find('span').last().attr('title')).toBe(
      option.find('span').last().text()
    )
  })

  test('offer a menu for a fact with values, from the values it declares', async () => {
    const { $ } = await viewPage()

    const menu = part($, 'bucket-filter-eventType')

    expect(flatten(menu.find('button').text())).toBe('Event: All')
    expect(
      part($, 'bucket-filter-eventType-chip')
        .toArray()
        .map((chip) => [flatten($(chip).text()), $(chip).attr('href')])
    ).toEqual([
      ['All', path],
      ['UpdateCaseStatus', `${path}?event=UpdateCaseStatus`],
      ['Unrecognised', `${path}?event=Unrecognised`]
    ])
    expect(part($, 'bucket-filter-status')).toHaveLength(0)
  })

  test('ask GAS for each fact in the URL, a dotted one as one fact', async () => {
    await viewPage(
      `${path}?status=DEAD_LETTER&event=UpdateCaseStatus&error=MongoServerError`
    )

    expect(asked()).toEqual([
      {
        where: {
          status: 'DEAD_LETTER',
          eventType: 'UpdateCaseStatus',
          'lastError.name': 'MongoServerError'
        }
      },
      false
    ])
  })

  test.each([
    ['a key no fact is spelled by', `${path}?colour=x`],
    [
      'a fact named as GAS names it rather than by its key',
      `${path}?eventType=x`
    ],
    ['a toggle named the old way', `${path}?show=eventType`]
  ])('refuse %s, with no read and no alias', async (_name, url) => {
    const { statusCode, $ } = await viewPage(url)

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'bucket-refused')).toBe(
      'A filter in the address is not one this list declares. Start again'
    )
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })

  test('drop an empty value, as an unset box sends one', async () => {
    await viewPage(`${path}?status=DEAD_LETTER&grant=`)

    expect(asked()).toEqual([{ where: { status: 'DEAD_LETTER' } }, false])
  })

  test.each([
    ['a key that could be no fact', `${path}?event-type=x`],
    ['a value over 200 characters', `${path}?grant=${'x'.repeat(201)}`],
    ['a fact given twice', `${path}?status=FAILED&status=DEAD_LETTER`],
    ['a cursor over 512 characters', `${path}?cursor=${'x'.repeat(513)}`]
  ])('refuse %s', async (_name, url) => {
    const { statusCode } = await viewPage(url)

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })

  test('note an open filter in force, with the way to clear it', async () => {
    const { $ } = await viewPage(
      `${path}?status=DEAD_LETTER&grant=example-grant`
    )

    expect(textOf($, 'bucket-note-grantCode')).toBe('Grant: "example-grant"')
    expect(part($, 'bucket-note-grantCode-clear').attr('href')).toBe(
      `${path}?status=DEAD_LETTER`
    )
  })

  test('note a version of the chosen grant, clear it to the grant, and drop it from every choice of grant', async () => {
    givenPage(
      exact({
        bucket: 'gas.applications',
        rows: [applicationRow({ cells: { code: 'example-grant@1.2.0' } })]
      })
    )

    const { $ } = await viewPage(
      `${applicationsPath}?grant=example-grant&version=1.2.0`
    )

    expect(asked()).toEqual([
      { where: { code: 'example-grant', currentConfigVersion: '1.2.0' } },
      false
    ])
    expect(textOf($, 'bucket-cell-code')).toBe('example-grant@1.2.0')
    expect(textOf($, 'bucket-note-currentConfigVersion')).toBe(
      'Version: "1.2.0"'
    )
    expect(part($, 'bucket-note-currentConfigVersion-clear').attr('href')).toBe(
      `${applicationsPath}?grant=example-grant`
    )
    expect(hrefsOf($, 'bucket-filter-code-chip')).toEqual([
      applicationsPath,
      `${applicationsPath}?grant=example-grant`
    ])
  })

  test('offer no box to type a filter into, on any list', async () => {
    for (const url of [path, applicationsPath]) {
      const { $ } = await viewPage(url)

      expect($('[data-testid^="bucket-open"]')).toHaveLength(0)
      expect($('body').text()).not.toContain('More filters')
    }
  })

  test('draw no notes on a list with no open filter in force', async () => {
    const { $ } = await viewPage(applicationsPath)

    expect(part($, 'bucket-filter-notes')).toHaveLength(0)
  })
})

describe('the time range', () => {
  test('offers All and the six presets, titled for the bucket', async () => {
    const { $ } = await viewPage(`${path}?status=DEAD_LETTER`)

    expect(part($, 'bucket-range')).toHaveLength(1)
    expect(part($, 'bucket-range-preset')).toHaveLength(6)
    expect(part($, 'bucket-range-preset').first().attr('title')).toBe(
      'Events from the last 15m'
    )
    expect(part($, 'bucket-range-preset').first().attr('href')).toBe(
      `${path}?status=DEAD_LETTER&from=2026-10-09T09%3A05%3A00.000Z&range=15m`
    )
  })

  test('asks GAS for the window, leaving the preset key in the URL', async () => {
    await viewPage(`${path}?from=2026-10-08T09:20:00.000Z&range=24h`)

    expect(asked()).toEqual([
      { where: {}, from: '2026-10-08T09:20:00.000Z' },
      false
    ])
  })

  test('reads a Custom box in UK time', async () => {
    await viewPage(`${path}?from=2026-10-08T10:00&to=2026-10-08T11:00`)

    expect(asked()).toEqual([
      {
        where: {},
        from: '2026-10-08T09:00:00.000Z',
        to: '2026-10-08T10:00:00.000Z'
      },
      false
    ])
  })
})

describe('how a list was read', () => {
  test('is not said for an exact read: no label, no total, nothing above the rows', async () => {
    const { $ } = await viewPage()

    expect(part($, 'bucket-plan')).toHaveLength(0)
    expect(part($, 'bucket-card-header')).toHaveLength(0)
    expect(part($, 'bucket-total')).toHaveLength(0)
    expect(part($, 'bucket-card').text()).not.toMatch(/Exact|Bounded/)
    expect(part($, 'bucket-searched-to')).toHaveLength(0)
  })

  test('is said for a bounded read only by how far it looked, with a plain link on', async () => {
    givenPage(bounded())

    const { $ } = await viewPage(`${path}?status=COMPLETED&grant=example-grant`)

    expect(part($, 'bucket-plan')).toHaveLength(0)
    expect(part($, 'bucket-card').text()).not.toMatch(/Exact|Bounded/)
    expect(textOf($, 'bucket-empty')).toBe('No matches so far.')
    expect(textOf($, 'bucket-searched-to')).toBe(
      'Searched back to 3 Sep 2026 11:12:00.000.'
    )
    expect(part($, 'bucket-keep-looking').text()).toBe('Keep looking')
    expect(part($, 'bucket-keep-looking').attr('href')).toBe(
      `${path}?cursor=eyJ0Ijoi&status=COMPLETED&grant=example-grant`
    )
    expect(part($, 'bucket-tail').attr('data-open')).toBeDefined()
    expect($('do-load-more')).toHaveLength(0)
  })

  test('says a bounded read that reached the end searched everything', async () => {
    givenPage(
      bounded({
        rows: [row()],
        page: {
          next: null,
          keepLooking: null,
          searchedTo: null,
          complete: true
        }
      })
    )

    const { $ } = await viewPage(`${path}?grant=example-grant`)

    expect(textOf($, 'bucket-searched-to')).toBe('Searched everything.')
    expect(part($, 'bucket-keep-looking')).toHaveLength(0)
    expect(part($, 'bucket-tail').attr('data-closed')).toBeDefined()
    expect(part($, 'bucket-load-more-end').attr('hidden')).toBeDefined()
  })

  test('says an empty bounded read that reached the end on one line, in place of the empty line, with no tail under it', async () => {
    givenPage(
      bounded({
        page: {
          next: null,
          keepLooking: null,
          searchedTo: null,
          complete: true
        }
      })
    )

    const { $ } = await viewPage(`${path}?grant=example-grant`)

    expect(textOf($, 'bucket-empty')).toBe(
      'No events whose Grant is "example-grant". Searched everything.'
    )
    expect(part($, 'bucket-tail').attr('hidden')).toBeDefined()
    expect(part($, 'bucket-tail').attr('data-closed')).toBeDefined()
  })

  test('says an empty exact read found nothing, and no more than that', async () => {
    givenPage(exact({ rows: [], groups: [] }))

    const { $ } = await viewPage()

    expect(textOf($, 'bucket-empty')).toBe('No events found.')
    expect(part($, 'bucket-tail').attr('hidden')).toBeDefined()
  })

  test('ends a list read exactly to its last row with No more, and no tail', async () => {
    givenPage(exact())

    const { $ } = await viewPage()

    expect(part($, 'bucket-load-more-end').attr('hidden')).toBeUndefined()
    expect(textOf($, 'bucket-load-more-end')).toBe('No more events')
    expect(part($, 'bucket-tail').attr('hidden')).toBeDefined()
    expect(part($, 'bucket-searched-to')).toHaveLength(0)
  })

  test('ends a record list read exactly with No more of its own noun', async () => {
    givenPage(exact({ rows: [applicationRow()] }))

    const { $ } = await viewPage(applicationsPath)

    expect(textOf($, 'bucket-load-more-end')).toBe('No more applications')
    expect(part($, 'bucket-searched-to')).toHaveLength(0)
  })
})

describe('infinite scroll', () => {
  const more = {
    next: 'eyJ0IjoiMjAy',
    keepLooking: null,
    searchedTo: null,
    complete: false
  }

  test('links the next page with every filter, for the element and for no script', async () => {
    givenPage(exact({ page: more }))

    const { $ } = await viewPage(`${path}?status=DEAD_LETTER`)

    const next = `${path}?cursor=eyJ0IjoiMjAy&status=DEAD_LETTER`

    expect($('do-load-more').attr('data-next-page')).toBe(next)
    expect(part($, 'bucket-load-more-link').attr('href')).toBe(next)
    expect($('do-load-more').attr('data-rows')).toBe('bucket-rows')
    expect($('do-load-more').attr('data-noun-many')).toBe('events')
    expect($('#bucket-rows > tr')).toHaveLength(1)
  })

  test('says there are no more once the last page is in', async () => {
    const { $ } = await viewPage()

    expect($('do-load-more').attr('data-next-page')).toBeUndefined()
    expect(part($, 'bucket-load-more-end').attr('hidden')).toBeUndefined()
    expect(part($, 'bucket-load-more-end').text()).toBe('No more events')
  })

  test('never says there are no more while a bounded read can keep looking, and never loads that for itself', async () => {
    givenPage(bounded({ rows: [row()] }))

    const { $ } = await viewPage(`${path}?grant=example-grant`)

    expect($('do-load-more').attr('data-next-page')).toBeUndefined()
    expect($('do-load-more').attr('data-open')).toBeDefined()
    expect($('do-load-more').attr('data-tail')).toBe('bucket-tail')
    expect(part($, 'bucket-load-more-end').attr('hidden')).toBeDefined()
    expect($('#bucket-tail [data-testid="bucket-keep-looking"]')).toHaveLength(
      1
    )
  })

  test('asks a later page for the place it starts from, as a browse that is never a repeat', async () => {
    const first = await viewPage()

    await viewPage(
      `${path}?cursor=eyJ0IjoiMjAy&status=DEAD_LETTER`,
      first.cookie
    )
    await viewPage(
      `${path}?cursor=eyJ0IjoiMjAy&status=DEAD_LETTER`,
      first.cookie
    )

    expect(asked()).toEqual([
      { where: { status: 'DEAD_LETTER' }, cursor: 'eyJ0IjoiMjAy' },
      false
    ])
  })
})

describe('a browse', () => {
  test('tells GAS a refresh of the same first page is a repeat', async () => {
    const first = await viewPage()

    expect(asked()?.[1]).toBe(false)

    await viewPage(path, first.cookie)

    expect(asked()?.[1]).toBe(true)
  })

  test('is fresh under changed filters', async () => {
    const first = await viewPage()

    await viewPage(`${path}?status=DEAD_LETTER`, first.cookie)

    expect(asked()?.[1]).toBe(false)
  })

  test('keeps each bucket apart', async () => {
    const first = await viewPage()

    await viewPage(applicationsPath, first.cookie)

    expect(asked()?.[1]).toBe(false)
  })
})

describe('a toggle', () => {
  const toggled = () =>
    vi
      .mocked(getBucketAtUseCase)
      .mockResolvedValueOnce({ available: true, bucket: toggledBucket })

  test('is a switch that is off on a bare URL and links to the list with it on', async () => {
    toggled()

    const { $ } = await viewPage()

    const link = part($, 'bucket-toggle-eventType')

    expect(flatten(link.text())).toBe('Show audit events, off')
    expect(link.attr('href')).toBe(`${path}?audit=on`)
    expect($('do-filter-switch').attr('data-checked')).toBe('false')
    expect(asked()).toEqual([{ where: {} }, false])
  })

  test('is on when the URL says so, links back to the bare list and stays on every link', async () => {
    toggled()
    givenPage(exact({ page: { ...exact().page, next: 'eyJ0Ijoi' } }))

    const { $ } = await viewPage(`${path}?audit=on&status=DEAD_LETTER`)

    const link = part($, 'bucket-toggle-eventType')

    expect(flatten(link.text())).toBe('Show audit events, on')
    expect(link.attr('href')).toBe(`${path}?status=DEAD_LETTER`)
    expect($('do-filter-switch').attr('data-checked')).toBe('true')
    expect(asked()).toEqual([
      { where: { status: 'DEAD_LETTER' }, show: ['eventType'] },
      false
    ])
    expect(
      hrefsOf($, 'bucket-tile').every((href) => href?.includes('audit=on'))
    ).toBe(true)
    expect(part($, 'bucket-load-more').attr('data-next-page')).toContain(
      'audit=on'
    )
  })

  test('counts a URL that names a hidden value as one that shows it', async () => {
    toggled()

    const { $ } = await viewPage(`${path}?event=Audit`)

    expect($('do-filter-switch').attr('data-checked')).toBe('true')
    expect(part($, 'bucket-toggle-eventType').attr('href')).toBe(path)
    expect(asked()).toEqual([
      { where: { eventType: 'Audit' }, show: ['eventType'] },
      false
    ])
    expect(
      hrefsOf($, 'bucket-tile').every((href) => href?.includes('audit=on'))
    ).toBe(true)
  })

  test('survives a search, whose own fields it cannot be taken for', async () => {
    toggled()

    const posted = await search({
      'ref-kind': 'ref',
      'ref-value': 'abc-123-xyz',
      audit: 'on'
    })

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(`${path}?audit=on`)
  })

  test('is not drawn for a bucket that declares none', async () => {
    const { $ } = await viewPage()

    expect($('do-filter-switch')).toHaveLength(0)
  })
})

describe('a search by identifier', () => {
  test('offers each kind the bucket declares, in a form that posts and keeps the filters', async () => {
    const { $ } = await viewPage(`${path}?status=DEAD_LETTER&range=24h`)

    const form = part($, 'bucket-search')

    expect(form.attr('method')).toBe('post')
    expect(form.attr('action')).toBe(path)
    expect(
      part($, 'bucket-search-kind-chip')
        .toArray()
        .map((option) => [
          $(option).attr('data-value'),
          $(option).text().trim()
        ])
    ).toEqual([
      ['ref', 'Reference'],
      ['trace', 'Trace ID']
    ])
    expect(part($, 'bucket-search-kind-value').attr('name')).toBe('ref-kind')
    expect(part($, 'bucket-search-kind-select').attr('aria-label')).toBe(
      'Search events by'
    )
    expect(part($, 'bucket-search-input').attr('name')).toBe('ref-value')
    expect(part($, 'bucket-search-input').attr('type')).toBe('search')
    expect(
      form
        .find('[data-testid="bucket-search-filter"]')
        .toArray()
        .map((input) => [$(input).attr('name'), $(input).attr('value')])
    ).toEqual([
      ['status', 'DEAD_LETTER'],
      ['range', '24h']
    ])
  })

  test('is posted, kept out of the URL, and answered with the list it filtered', async () => {
    const posted = await search({
      'ref-kind': 'ref',
      'ref-value': ' abc-123-xyz ',
      status: 'DEAD_LETTER'
    })

    expect(posted.statusCode).toBe(statusCodes.seeOther)
    expect(posted.location).toBe(`${path}?status=DEAD_LETTER`)
    expect(queryBucketUseCase).not.toHaveBeenCalled()

    const { $ } = await viewPage(posted.location, posted.cookie)

    expect(asked()).toEqual([
      { where: { status: 'DEAD_LETTER' }, ref: 'ref:abc-123-xyz' },
      false
    ])
    expect(textOf($, 'bucket-note-search')).toBe(
      'Matching Reference "abc-123-xyz"'
    )
    expect(part($, 'bucket-search-input').attr('value')).toBe('abc-123-xyz')
    expect(part($, 'bucket-search-kind-value').attr('value')).toBe('ref')
    expect(textOf($, 'bucket-search-kind-chosen')).toBe('Reference')
  })

  test('tells GAS that a refresh or Back is a repeat', async () => {
    const posted = await search({
      'ref-kind': 'trace',
      'ref-value': '0b7c1d1e'
    })

    await viewPage(posted.location, posted.cookie)
    await viewPage(posted.location, posted.cookie)

    expect(asked()).toEqual([{ where: {}, ref: 'trace:0b7c1d1e' }, true])
  })

  test('is cleared by an empty search, which the note posts', async () => {
    const posted = await search({
      'ref-kind': 'ref',
      'ref-value': 'abc-123-xyz'
    })
    const { $ } = await viewPage(posted.location, posted.cookie)

    const clear = part($, 'bucket-note-search-clear').closest('form')

    expect(clear.attr('method')).toBe('post')
    expect(clear.find('input[name="ref-value"]').attr('value')).toBe('')

    const cleared = await search({ 'ref-value': '' }, posted.cookie)

    expect(cleared.statusCode).toBe(statusCodes.seeOther)

    const after = await viewPage(cleared.location, cleared.cookie)

    expect(asked()).toEqual([{ where: {} }, false])
    expect(part(after.$, 'bucket-note-search')).toHaveLength(0)
  })

  test.each([
    [
      'a kind the bucket does not declare',
      { 'ref-kind': 'sbi', 'ref-value': '900000005' }
    ],
    [
      'a value GAS could not hold',
      { 'ref-kind': 'ref', 'ref-value': 'abc 123 <b>' }
    ]
  ])(
    'refuses %s, says why beside the box, and stores nothing',
    async (_name, payload) => {
      const earlier = await search({
        'ref-kind': 'ref',
        'ref-value': 'abc-123-xyz'
      })
      const refused = await search(
        { ...payload, status: 'DEAD_LETTER' },
        earlier.cookie
      )

      expect(refused.statusCode).toBe(statusCodes.badRequest)
      expect(textOf(refused.$, 'bucket-search-error')).toBe(
        'Enter an identifier using only letters, numbers and . _ : @ -'
      )
      expect(part(refused.$, 'bucket-search-input').attr('value')).toBe(
        payload['ref-value']
      )
      expect(part(refused.$, 'bucket-search-input').attr('aria-invalid')).toBe(
        'true'
      )
      expect(asked()).toEqual([{ where: { status: 'DEAD_LETTER' } }, false])

      await viewPage(path, refused.cookie)

      expect(asked()).toEqual([{ where: {} }, false])
    }
  )

  test('runs again on a later page that says it is one of a search', async () => {
    const posted = await search({
      'ref-kind': 'ref',
      'ref-value': 'abc-123-xyz'
    })

    givenPage(
      exact({
        page: {
          next: 'NEXT',
          keepLooking: null,
          searchedTo: null,
          complete: false
        }
      })
    )

    const { $ } = await viewPage(posted.location, posted.cookie)
    const nextPage = $('do-load-more').attr('data-next-page') ?? ''

    expect(nextPage).toMatch(
      new RegExp(String.raw`^${path}\?cursor=NEXT&searched=[0-9a-f-]{36}$`)
    )
    expect(nextPage).not.toContain('abc-123-xyz')

    await viewPage(nextPage, posted.cookie)
    await viewPage(nextPage, posted.cookie)

    expect(asked()).toEqual([
      { where: {}, ref: 'ref:abc-123-xyz', cursor: 'NEXT' },
      false
    ])
  })

  test('never continues one search with another held since, as from another browser tab', async () => {
    const first = await search({ 'ref-kind': 'ref', 'ref-value': 'abc-123' })

    givenPage(
      exact({
        page: {
          next: 'NEXT',
          keepLooking: null,
          searchedTo: null,
          complete: false
        }
      })
    )

    const { $ } = await viewPage(first.location, first.cookie)
    const firstNext = $('do-load-more').attr('data-next-page') ?? ''
    const second = await search(
      { 'ref-kind': 'ref', 'ref-value': 'def-456' },
      first.cookie
    )

    vi.mocked(queryBucketUseCase).mockClear()

    const { statusCode, headers } = await viewPage(firstNext, second.cookie)

    expect(statusCode).toBe(statusCodes.found)
    expect(headers.location).toBe(path)
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })

  test('refuses a later page that names a search in a form no search has', async () => {
    const { statusCode } = await viewPage(`${path}?cursor=NEXT&searched=1`)

    expect(statusCode).toBe(statusCodes.badRequest)
  })

  test('is left out of a later page that is a browse', async () => {
    const posted = await search({
      'ref-kind': 'ref',
      'ref-value': 'abc-123-xyz'
    })

    await viewPage(`${path}?cursor=NEXT`, posted.cookie)

    expect(asked()).toEqual([{ where: {}, cursor: 'NEXT' }, false])
  })

  test.each([
    ['none is held', async () => ''],
    [
      'it was cleared',
      async () => {
        const posted = await search({
          'ref-kind': 'ref',
          'ref-value': 'abc-123-xyz'
        })

        return (await search({ 'ref-value': '' }, posted.cookie)).cookie
      }
    ],
    [
      'it is older than 15 minutes',
      async () => {
        const posted = await search({
          'ref-kind': 'ref',
          'ref-value': 'abc-123-xyz'
        })

        vi.setSystemTime(new Date(now.getTime() + 15 * 60 * 1000 + 1))

        return posted.cookie
      }
    ]
  ])(
    'sends a later page of a search back to its first page when %s, never continuing unfiltered',
    async (_name, given) => {
      const cookie = await given()

      vi.mocked(queryBucketUseCase).mockClear()

      const { statusCode, headers } = await viewPage(
        `${path}?cursor=NEXT&searched=0b7c1d1e-0000-4000-8000-000000000001&status=DEAD_LETTER`,
        cookie
      )

      expect(statusCode).toBe(statusCodes.found)
      expect(headers.location).toBe(`${path}?status=DEAD_LETTER`)
      expect(queryBucketUseCase).not.toHaveBeenCalled()
    }
  )

  test('is forgotten after 15 minutes, and the list browses again', async () => {
    const posted = await search({
      'ref-kind': 'ref',
      'ref-value': 'abc-123-xyz'
    })

    vi.setSystemTime(new Date(now.getTime() + 15 * 60 * 1000 + 1))
    await viewPage(posted.location, posted.cookie)

    expect(asked()).toEqual([{ where: {} }, false])
  })

  test('keeps its own search apart from another bucket', async () => {
    const posted = await search({
      'ref-kind': 'ref',
      'ref-value': 'abc-123-xyz'
    })

    await viewPage(applicationsPath, posted.cookie)

    expect(queryBucketUseCase).toHaveBeenLastCalledWith(
      applicationsBucket,
      { where: {} },
      false
    )
  })

  test('is not found on a bucket the catalogue has not got', async () => {
    const { statusCode } = await search(
      { 'ref-kind': 'ref', 'ref-value': 'abc-123-xyz' },
      '',
      '/dev-ops/events/gas/nothing'
    )

    expect(statusCode).toBe(statusCodes.notFound)
  })

  test('offers no menu of one on a bucket with a single kind of identifier', async () => {
    const { $ } = await viewPage(applicationsPath)

    expect(part($, 'bucket-search-kind')).toHaveLength(0)
    expect(part($, 'bucket-search-kind-panel')).toHaveLength(0)
    expect(part($, 'bucket-search').find('select')).toHaveLength(0)
    expect(part($, 'bucket-search-kind-value').attr('name')).toBe('ref-kind')
    expect(part($, 'bucket-search-kind-value').attr('value')).toBe('ref')
    expect(part($, 'bucket-search-kind-value').attr('disabled')).toBeUndefined()
    expect(part($, 'bucket-search-input').attr('placeholder')).toBe(
      'Exact Reference'
    )
    expect(part($, 'bucket-search-input').attr('aria-label')).toBe(
      'Reference to search applications for'
    )
  })

  test('is not offered on a bucket with no identifiers', async () => {
    vi.mocked(getBucketAtUseCase).mockResolvedValueOnce({
      available: true,
      bucket: { ...outboxBucket, refs: [] }
    })

    const { $ } = await viewPage()

    expect(part($, 'bucket-search')).toHaveLength(0)
  })
})

describe('the version lists', () => {
  const grantsPath = '/dev-ops/grants'
  const workflowsPath = '/dev-ops/workflows'

  const versionRow = (
    kind: 'grant' | 'workflow',
    overrides: Partial<BucketRow> = {}
  ): BucketRow =>
    row({
      title: 'woodland-creation',
      subtitle: null,
      cells: { version: '1.2.0', status: 'active', definition: 'fetched' },
      link: { kind, code: 'woodland-creation', version: '1.2.0' },
      ...overrides
    })

  const givenGrants = (rows: BucketRow[]) =>
    givenPage(exact({ bucket: 'gas.grants', rows, groups: [] }))

  const menuNames = ($: CheerioAPI) =>
    part($, 'bucket-toolbar')
      .find('[data-testid^="bucket-filter-"][data-testid$="-button"]')
      .toArray()
      .map((button) => flatten($(button).text()))

  test('are in the navigation, Grants under GAS after Applications and Workflows under CW after Cases', async () => {
    const { $ } = await viewPage(grantsPath)

    expect(
      part($, 'shell-nav')
        .find('a')
        .toArray()
        .map((link) => $(link).attr('data-testid'))
    ).toEqual([
      'shell-nav-gas.outbox',
      'shell-nav-gas.applications',
      'shell-nav-gas.grants',
      'shell-nav-clients-gas',
      'shell-nav-cw.cases',
      'shell-nav-cw.workflows',
      'shell-nav-clients-cw'
    ])
    expect(part($, 'shell-nav-gas.grants').find('svg').attr('data-icon')).toBe(
      'landmark'
    )
    expect(
      part($, 'shell-nav-cw.workflows').find('svg').attr('data-icon')
    ).toBe('workflow')
  })

  test('head the table with grant, version, definition, status and received, at set widths, with Status hidden on phones', async () => {
    givenGrants([versionRow('grant')])

    const { $ } = await viewPage(grantsPath)

    expect(queryBucketUseCase).toHaveBeenCalledWith(
      grantsBucket,
      { where: {} },
      false
    )
    expect(
      part($, 'bucket-head')
        .find('th')
        .toArray()
        .map((head) => $(head).text())
    ).toEqual(['Grant', 'Version', 'Definition', 'Status', 'Received'])
    expect(
      part($, 'bucket-table')
        .find('colgroup col')
        .toArray()
        .map((col) => $(col).attr('class'))
    ).toEqual([
      'w-[22%] sm:w-[26%]',
      'w-[17%] sm:w-[14%]',
      'w-[34%] sm:w-[22%]',
      'w-[14%] max-sm:hidden',
      'w-[27%] sm:w-[24%]'
    ])
    expect(part($, 'bucket-head').find('th').eq(3).attr('class')).toBe(
      'hidden sm:table-cell'
    )
    expect(part($, 'bucket-cell-status').attr('class')).toBe(
      'overflow-hidden max-sm:text-xs hidden sm:table-cell'
    )
    expect(part($, 'bucket-table').attr('class')).toContain('sm:min-w-[64rem]')
    expect(part($, 'bucket-table').attr('class')).not.toContain(
      ' min-w-[64rem]'
    )
  })

  test('keep the even columns on every other list', async () => {
    const { $ } = await viewPage('/dev-ops/applications')

    expect(
      part($, 'bucket-table')
        .find('colgroup col')
        .toArray()
        .map((col) => $(col).attr('class'))
    ).toEqual(['w-1/4', 'w-1/4', 'w-1/4', 'w-1/4'])
  })

  test('title each badge with what its value means, and add the draft clause on a draft row', async () => {
    givenGrants([
      versionRow('grant', {
        cells: { version: '2.0.0', status: 'draft', definition: 'pending' }
      })
    ])

    const { $ } = await viewPage(grantsPath)

    expect(
      part($, 'bucket-cell-definition')
        .find('[data-testid="do-status-badge"]')
        .attr('title')
    ).toBe(
      "At least one of this version's files (grant, agreement, payment) isn't fetched by GAS yet. Draft: GAS won't pick it for new work until it is published as active."
    )
    expect(
      part($, 'bucket-cell-status')
        .find('[data-testid="do-status-badge"]')
        .attr('title')
    ).toBe('Not yet published as active.')
  })

  test('badge a draft beside its version on phones, and keep the Definition on one line there', async () => {
    givenGrants([
      versionRow('grant', {
        cells: { version: '2.0.0', status: 'draft', definition: 'pending' }
      })
    ])

    const { $ } = await viewPage(grantsPath)
    const badge = part($, 'bucket-cell-version-phone-status')

    expect(badge.attr('class')).toBe('sm:hidden')
    expect(flatten(badge.text())).toBe('Draft')
    expect(badge.children().attr('class')).toBe('badge badge-ghost badge-sm')
    expect(part($, 'bucket-cell-definition').attr('class')).toBe(
      'overflow-hidden max-sm:text-xs'
    )
  })

  test('say each value under it in the filter menus', async () => {
    const { $ } = await viewPage(grantsPath)

    expect(textsOf($, 'bucket-filter-worstFetchStatus-hint')).toEqual([
      'GAS has fetched every file of this version (grant, agreement, payment) itself.',
      "At least one of this version's files (grant, agreement, payment) isn't fetched by GAS yet.",
      "GAS's last fetch of at least one of this version's files from S3 failed.",
      "GAS refused at least one of this version's files and won't use it."
    ])
    expect(
      part($, 'bucket-filter-worstFetchStatus-hint').first().attr('class')
    ).toBe('block text-xs text-base-content/70')
  })

  test('name the Time button by the time the list is kept by', async () => {
    const { $ } = await viewPage(grantsPath)

    expect(flatten(textOf($, 'bucket-range-button'))).toBe('Received: All')
  })

  test('say which filters found nothing', async () => {
    givenGrants([])

    const { $ } = await viewPage(
      `${grantsPath}?status=draft&definition=permanent_error`
    )

    expect(textOf($, 'bucket-empty')).toBe(
      'No grant versions whose Status is Draft and Definition is Failed.'
    )
  })

  test('give a screen reader the version in the link, and wrap a long code at its hyphens', async () => {
    givenGrants([versionRow('grant')])

    const { $ } = await viewPage(grantsPath)

    expect(textOf($, 'bucket-row-spoken-version')).toBe('version 1.2.0')
    expect(part($, 'bucket-row-spoken-version').attr('class')).toBe('sr-only')
    expect(part($, 'bucket-row-link').attr('class')).toContain('break-words')
    expect(part($, 'bucket-row-link').attr('class')).not.toContain('break-all')
  })

  test('draw a grant version by its code, linked to its page, with its version, status and definition', async () => {
    givenGrants([versionRow('grant')])

    const { $ } = await viewPage(`${grantsPath}?status=active`)

    const link = part($, 'bucket-row-link')

    expect(link.attr('href')).toBe(
      `${grantsPath}/woodland-creation/1.2.0?back=${encodeURIComponent(`${grantsPath}?status=active`)}`
    )
    expect(link.attr('class')).toContain('font-mono')
    expect(textOf($, 'bucket-row-title')).toBe('woodland-creation')
    expect(textOf($, 'bucket-cell-version')).toBe('1.2.0')
    expect(part($, 'bucket-cell-version').find('.font-mono')).toHaveLength(1)
    expect(textOf($, 'bucket-cell-status')).toBe('Active')
    expect(
      part($, 'bucket-cell-status')
        .find('[data-testid="do-status-dot"]')
        .hasClass('status-success')
    ).toBe(true)
    expect(textOf($, 'bucket-cell-definition')).toBe('Stored')
    expect(part($, 'bucket-row').attr('class')).not.toContain('bg-error/5')
  })

  test('tint a version whose definition failed for good like a dead letter, and no other', async () => {
    givenGrants([
      versionRow('grant', {
        cells: {
          version: '1.2.0',
          status: 'draft',
          definition: 'permanent_error'
        }
      }),
      versionRow('grant', {
        id: '66f000000000000000000002',
        cells: { version: '1.1.0', status: 'active', definition: 'pending' }
      })
    ])

    const { $ } = await viewPage(grantsPath)

    const rows = part($, 'bucket-row')

    expect(rows.eq(0).attr('class')).toContain('bg-error/5')
    expect(rows.eq(1).attr('class')).not.toContain('bg-error/5')
    expect(textsOf($, 'bucket-cell-definition')).toEqual([
      'Failed',
      'Not stored yet'
    ])
  })

  test('offer the time, then the grant, status and definition menus, with the codes plain, and no search', async () => {
    const { $ } = await viewPage(grantsPath)

    expect(menuNames($)).toEqual([
      'Grant: All',
      'Status: All',
      'Definition: All'
    ])
    expect(
      part($, 'bucket-filter-grantCode-panel').find('.font-mono')
    ).toHaveLength(0)
    expect(textsOf($, 'bucket-filter-grantCode-chip')).toEqual([
      'All',
      'hedgerow-restoration',
      'woodland-creation'
    ])
    expect(part($, 'bucket-search')).toHaveLength(0)
  })

  test('ask GAS for drafts only when the status is Draft', async () => {
    await viewPage(`${grantsPath}?status=draft`)

    expect(asked()).toEqual([{ where: { status: 'draft' } }, false])
  })

  test('ask GAS for the definition status as one dotted fact', async () => {
    await viewPage(`${grantsPath}?definition=permanent_error`)

    expect(asked()).toEqual([
      { where: { worstFetchStatus: 'permanent_error' } },
      false
    ])
  })

  test('end with No more grant versions, and say when none are found', async () => {
    givenGrants([versionRow('grant')])

    const ended = await viewPage(grantsPath)

    expect(textOf(ended.$, 'bucket-load-more-end')).toBe(
      'No more grant versions'
    )

    givenGrants([])

    const empty = await viewPage(grantsPath)

    expect(textOf(empty.$, 'bucket-empty')).toBe('No grant versions found.')
  })

  test('draw a workflow version linked to its page, with the workflow menu, ending on its own noun', async () => {
    givenPage(
      exact({
        bucket: 'cw.workflows',
        rows: [versionRow('workflow')],
        groups: []
      })
    )

    const { $ } = await viewPage(`${workflowsPath}?workflow=woodland-creation`)

    expect(queryBucketUseCase).toHaveBeenCalledWith(
      workflowsBucket,
      { where: { grantCode: 'woodland-creation' } },
      false
    )
    expect(part($, 'bucket-row-link').attr('href')).toBe(
      `${workflowsPath}/woodland-creation/1.2.0?back=${encodeURIComponent(`${workflowsPath}?workflow=woodland-creation`)}`
    )
    expect(menuNames($)).toEqual([
      'Workflow: woodland-creation',
      'Status: All',
      'Definition: All'
    ])
    expect(textOf($, 'bucket-load-more-end')).toBe('No more workflow versions')
  })
})

describe('a list GAS would not or could not read', () => {
  test('says GAS refused the request, in its words, with a way to start again', async () => {
    vi.mocked(queryBucketUseCase).mockResolvedValue(refusal)

    const { statusCode, $ } = await viewPage(`${path}?status=FAILED`)

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'bucket-refused')).toBe(
      'GAS refused this request: A filter names a fact this bucket does not declare. Start again'
    )
    expect(part($, 'bucket-refused-clear').attr('href')).toBe(path)
    expect(part($, 'bucket-plan')).toHaveLength(0)
    expect(part($, 'bucket-table')).toHaveLength(0)
  })

  test('forgets a search GAS refused, so the next render browses', async () => {
    const posted = await search({
      'ref-kind': 'ref',
      'ref-value': 'abc-123-xyz'
    })

    vi.mocked(queryBucketUseCase).mockResolvedValueOnce(refusal)
    await viewPage(posted.location, posted.cookie)
    await viewPage(posted.location, posted.cookie)

    expect(asked()).toEqual([{ where: {} }, false])
  })

  test('says the bucket could not be loaded on any other failure', async () => {
    vi.mocked(queryBucketUseCase).mockResolvedValue(outage)

    const { statusCode, $ } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'bucket-error')).toBe('GAS outbox could not be loaded.')
    expect(part($, 'bucket-error').attr('role')).toBe('alert')
    expect(
      part($, 'shell-nav').find(
        'a[data-testid^="shell-nav-gas."], a[data-testid^="shell-nav-cw."]'
      )
    ).toHaveLength(catalogue.buckets.length)
  })
})

describe("the widths of a list's columns", () => {
  test('are shared evenly on a list not titled by event, one share per declared column, the title and the time', async () => {
    const { $ } = await viewPage(applicationsPath)

    expect(
      part($, 'bucket-table')
        .find('colgroup col')
        .toArray()
        .map((col) => $(col).attr('class') ?? '')
    ).toEqual(['w-1/4', 'w-1/4', 'w-1/4', 'w-1/4'])
    expect(
      part($, 'bucket-head')
        .find('th')
        .toArray()
        .map((th) => [$(th).text(), $(th).attr('class') ?? null])
    ).toEqual([
      ['Reference', null],
      ['Grant', null],
      ['Status', null],
      ['Created', 'text-right']
    ])
  })
})

describe('the head of a list with one column beside the title', () => {
  test('lays it out as every events table: the title takes what the declared widths of the column and the time leave', async () => {
    vi.mocked(getBucketAtUseCase).mockResolvedValueOnce({
      available: true,
      bucket: { ...outboxBucket, columns: outboxBucket.columns.slice(0, 1) }
    })

    const { $ } = await viewPage()

    expect(
      part($, 'bucket-head')
        .find('th')
        .toArray()
        .map((th) => [$(th).text(), $(th).attr('class') ?? null])
    ).toEqual([
      ['Event', null],
      ['Status', null],
      ['Created', 'text-right']
    ])
    expect(
      part($, 'bucket-table')
        .find('colgroup col')
        .toArray()
        .map((col) => $(col).attr('class') ?? '')
    ).toEqual(['', 'w-[20%] xl:w-[18%]', 'w-[17%] xl:w-[13%]'])
  })
})

describe('the summaries a list declares', () => {
  const summary = (overrides: Partial<SummaryResult> = {}): SummaryResult => ({
    bucket: 'gas.outbox',
    summary: 'errors',
    entries: [
      {
        values: {
          'lastError.name': 'TimeoutError',
          eventType: 'UpdateCaseStatus'
        },
        count: 3,
        capped: false,
        firstAt: '2026-10-01T08:00:00.000Z',
        lastAt: '2026-10-09T09:14:03.120Z'
      },
      {
        values: { 'lastError.name': null, eventType: null },
        count: 1,
        capped: false,
        firstAt: null,
        lastAt: null
      }
    ],
    more: false,
    complete: true,
    ...overrides
  })

  const summarised = (page: SummaryResult | null = summary()): SummaryRead => ({
    page,
    unavailable: page === null,
    refused: false,
    refusal: null
  })

  const summaryAsked = () =>
    vi
      .mocked(summariseBucketUseCase)
      .mock.calls.map(([bucket, id, query]) => [bucket.id, id, query])

  beforeEach(() => {
    vi.mocked(getBucketAtUseCase).mockResolvedValue({
      available: true,
      bucket: summarisedBucket
    })
    vi.mocked(summariseBucketUseCase).mockResolvedValue(summarised())
  })

  test('are read with the first page and drawn closed above the rows, titled as declared', async () => {
    const { $ } = await viewPage()

    const details = part($, 'bucket-summary-details')

    expect(summaryAsked()).toEqual([['gas.outbox', 'errors', {}]])
    expect(details.is('details')).toBe(true)
    expect(details.attr('open')).toBeUndefined()
    expect(textOf($, 'bucket-summary-title')).toBe('Top errors (2 groups)')
    expect(
      part($, 'bucket-summary-table')
        .find('th')
        .toArray()
        .map((th) => $(th).text())
    ).toEqual(['Count', 'Error name', 'Event', 'First seen', 'Last seen'])
    expect(
      $('[data-testid="bucket-summary"] ~ * [data-testid="bucket-table"]')
    ).toHaveLength(1)
  })

  test('draw each entry with its count and when it was last seen, linked to the same list narrowed to it', async () => {
    const { $ } = await viewPage()

    expect(textsOf($, 'bucket-summary-count')).toEqual(['3', '1'])
    expect(hrefsOf($, 'bucket-summary-link')).toEqual([
      `${path}?status=DEAD_LETTER&event=UpdateCaseStatus&error=TimeoutError`
    ])
    expect(part($, 'bucket-summary-last').first().attr('datetime')).toBe(
      '2026-10-09T09:14:03.120Z'
    )
  })

  test('show the rows with no value truthfully, as text and not a link', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'bucket-summary-none')).toBe('No error recorded')
    expect(part($, 'bucket-summary-none').is('a')).toBe(false)
    expect(part($, 'bucket-summary-none').attr('class')).toBe(
      'font-mono text-base-content/70'
    )
  })

  test('follow the time range and the toggle, in what is asked and in every link', async () => {
    const { $ } = await viewPage(
      `${path}?audit=on&from=2026-10-08T09%3A20%3A00.000Z&range=24h`
    )

    expect(summaryAsked()).toEqual([
      [
        'gas.outbox',
        'errors',
        { show: ['eventType'], from: '2026-10-08T09:20:00.000Z' }
      ]
    ])
    expect(hrefsOf($, 'bucket-summary-link')).toEqual([
      `${path}?status=DEAD_LETTER&event=UpdateCaseStatus&error=TimeoutError&audit=on&from=2026-10-08T09%3A20%3A00.000Z&range=24h`
    ])
  })

  test('take no notice of the Event filter or an error name the list is narrowed by', async () => {
    const { $ } = await viewPage(
      `${path}?status=DEAD_LETTER&event=UpdateCaseStatus&error=OtherError`
    )

    expect(summaryAsked()).toEqual([['gas.outbox', 'errors', {}]])
    expect(hrefsOf($, 'bucket-summary-link')).toEqual([
      `${path}?status=DEAD_LETTER&event=UpdateCaseStatus&error=TimeoutError`
    ])
    expect(part($, 'bucket-note-lastError.name-clear')).toHaveLength(1)
  })

  test('are neither read nor drawn while the list is narrowed to another status', async () => {
    const { $ } = await viewPage(`${path}?status=COMPLETED`)

    expect(summariseBucketUseCase).not.toHaveBeenCalled()
    expect(part($, 'bucket-summary')).toHaveLength(0)
  })

  test('are neither read nor drawn on a later page', async () => {
    const { $ } = await viewPage(`${path}?cursor=eyJ0Ijoi`)

    expect(summariseBucketUseCase).not.toHaveBeenCalled()
    expect(part($, 'bucket-summary')).toHaveLength(0)
  })

  test('are neither read nor drawn while a search is held', async () => {
    const posted = await search({ 'ref-kind': 'ref', 'ref-value': 'abc-123' })

    const { $ } = await viewPage(posted.location, posted.cookie)

    expect(summariseBucketUseCase).not.toHaveBeenCalled()
    expect(part($, 'bucket-summary')).toHaveLength(0)
  })

  test('say so in one line when nothing was found, with no table to open', async () => {
    vi.mocked(summariseBucketUseCase).mockResolvedValue(
      summarised(summary({ entries: [] }))
    )

    const { $ } = await viewPage()

    expect(textOf($, 'bucket-summary-empty')).toBe(
      'Top errors: No dead letter events.'
    )
    expect(part($, 'bucket-summary-details')).toHaveLength(0)
    expect(part($, 'bucket-row')).toHaveLength(1)
  })

  test('say so when a cap was met', async () => {
    vi.mocked(summariseBucketUseCase).mockResolvedValue(
      summarised(summary({ more: true, complete: false }))
    )

    const { $ } = await viewPage()

    expect(textsOf($, 'bucket-summary-note')).toEqual([
      'Showing the 20 most frequent.',
      'There are more distinct values than were counted.'
    ])
  })

  test('say plainly when they could not be read, and leave the list as it is', async () => {
    vi.mocked(summariseBucketUseCase).mockResolvedValue(summarised(null))

    const { $, statusCode } = await viewPage()

    expect(statusCode).toBe(statusCodes.ok)
    expect(textOf($, 'bucket-summary-error')).toBe(
      'Top errors could not be loaded.'
    )
    expect(part($, 'bucket-summary-details')).toHaveLength(0)
    expect(part($, 'bucket-row')).toHaveLength(1)
  })

  test('escape a value they draw', async () => {
    vi.mocked(summariseBucketUseCase).mockResolvedValue(
      summarised(
        summary({
          entries: [
            {
              values: { 'lastError.name': '<img src=x>', eventType: 'Sent' },
              count: 1,
              capped: false,
              firstAt: null,
              lastAt: null
            }
          ]
        })
      )
    )

    const { $ } = await viewPage()

    expect(textOf($, 'bucket-summary-link')).toBe('<img src=x>')
    expect(part($, 'bucket-summary').find('img')).toHaveLength(0)
  })

  test('are not read for a list that declares none', async () => {
    vi.mocked(getBucketAtUseCase).mockResolvedValue({
      available: true,
      bucket: outboxBucket
    })

    const { $ } = await viewPage()

    expect(summariseBucketUseCase).not.toHaveBeenCalled()
    expect(part($, 'bucket-summary')).toHaveLength(0)
  })
})

describe('the lists that share a page', () => {
  const inboxPath = '/dev-ops/events/gas/inbox'
  const paged = { buckets: [pagedOutbox, pagedInbox], sourceErrors: [] }
  const byPath = new Map([
    ['events/gas/outbox', pagedOutbox],
    ['events/gas/inbox', pagedInbox]
  ])

  const tabsOf = ($: CheerioAPI) =>
    part($, 'bucket-tab')
      .toArray()
      .map((tab) => [
        $(tab).text(),
        $(tab).attr('href'),
        $(tab).attr('aria-current') ?? null
      ])

  beforeEach(() => {
    vi.mocked(getCatalogueUseCase).mockResolvedValue(paged)
    vi.mocked(getBucketAtUseCase).mockImplementation(async (at) => ({
      available: true,
      bucket: byPath.get(at) ?? null
    }))
  })

  test('draw a tab per list under the page title, the first one by default, as plain links', async () => {
    const { $ } = await viewPage()

    expect(textOf($, 'bucket-title')).toBe('GAS events')
    expect($('title').text()).toContain('GAS events')
    expect(part($, 'bucket-tabs').attr('aria-label')).toBe('GAS events')
    expect(tabsOf($)).toEqual([
      ['Outbox', path, 'page'],
      ['Inbox', inboxPath, null]
    ])
    expect(part($, 'bucket-tab').first().attr('class')).toBe('tab tab-active')
    expect(
      part($, 'bucket-tab')
        .toArray()
        .every((tab) => tab.tagName === 'a')
    ).toBe(true)
  })

  test('sit above the tiles, the filters and the search', async () => {
    const { $ } = await viewPage()

    expect(
      $(
        '[data-testid="bucket-tabs"] ~ [data-testid="bucket-tiles"], [data-testid="bucket-tabs"] ~ [data-testid="bucket-toolbar"]'
      )
    ).toHaveLength(2)
  })

  test('mark the other tab on the other list', async () => {
    const { $ } = await viewPage(inboxPath)

    expect(tabsOf($)).toEqual([
      ['Outbox', path, null],
      ['Inbox', inboxPath, 'page']
    ])
  })

  test('are one link in the navigation, current on either list', async () => {
    const outbox = await viewPage()
    const inbox = await viewPage(inboxPath)

    for (const { $ } of [outbox, inbox]) {
      const link = part($, 'shell-nav-gas.outbox')

      expect(link.text().trim()).toBe('Grant Application Service Events')
      expect(link.attr('href')).toBe(path)
      expect(link.attr('aria-current')).toBe('page')
      expect(part($, 'shell-nav-gas.inbox')).toHaveLength(0)
      expect(part($, 'shell-nav').find('ul ul')).toHaveLength(0)
    }
  })

  test('link to the plain other list, taking nothing chosen on this one with them', async () => {
    const { $ } = await viewPage(
      `${path}?status=DEAD_LETTER&event=UpdateCaseStatus&error=TimeoutError&audit=on&range=24h&from=2026-10-08T09%3A20%3A00.000Z`
    )

    expect(tabsOf($)[1][1]).toBe(inboxPath)
  })

  test('take no held search across, and say nothing of one in the link', async () => {
    const posted = await search({
      'ref-kind': 'trace',
      'ref-value': '0b7c1d1e'
    })
    const searched = await viewPage(posted.location, posted.cookie)

    expect(tabsOf(searched.$)[1][1]).toBe(inboxPath)

    const { $ } = await viewPage(inboxPath, searched.cookie)

    expect(asked()).toEqual([{ where: {} }, false])
    expect(part($, 'bucket-note-search')).toHaveLength(0)
  })

  test('refuse the key a tab once used to carry a search, as no filter could take it', async () => {
    const { statusCode } = await viewPage(
      `${inboxPath}?search-from=events%2Fgas%2Foutbox`
    )

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(queryBucketUseCase).not.toHaveBeenCalled()
  })

  test('are not drawn for a list with a page of its own', async () => {
    vi.mocked(getBucketAtUseCase).mockResolvedValue({
      available: true,
      bucket: applicationsBucket
    })

    const { $ } = await viewPage(applicationsPath)

    expect(part($, 'bucket-tabs')).toHaveLength(0)
    expect(textOf($, 'bucket-title')).toBe('Applications')
  })
})
