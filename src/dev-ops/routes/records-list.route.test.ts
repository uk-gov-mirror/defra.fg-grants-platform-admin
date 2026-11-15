import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  applicationsBucket,
  casesBucket,
  fullCatalogue
} from '../use-cases/test-fixtures.ts'
import {
  getBucketAtUseCase,
  getCatalogueUseCase
} from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketEntry,
  Catalogue
} from '../use-cases/get-catalogue.use-case.ts'
import type {
  BucketListResult,
  BucketResult,
  BucketRow
} from '../use-cases/query-bucket.use-case.ts'
import { queryBucketUseCase } from '../use-cases/query-bucket.use-case.ts'
import { expectTablesStyled } from '../test-utils.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/query-bucket.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-10-13T15:20:00.000Z')

/** The two lists as GAS and CW declare them (applications.bucket.js, cases.bucket.js), each with its own search kinds. */
const applications: BucketEntry = {
  ...applicationsBucket,
  facts: applicationsBucket.facts.slice(0, 2),
  refs: [
    { kind: 'ref', label: 'Reference' },
    { kind: 'sbi', label: 'SBI' },
    { kind: 'frn', label: 'FRN' },
    { kind: 'crn', label: 'CRN' },
    { kind: 'agreement', label: 'Agreement number' }
  ]
}

const cases: BucketEntry = {
  ...casesBucket,
  refs: [
    { kind: 'ref', label: 'Reference' },
    { kind: 'sbi', label: 'SBI' }
  ]
}

const catalogue: Catalogue = {
  ...fullCatalogue,
  buckets: fullCatalogue.buckets.map((bucket) =>
    bucket.id === applications.id
      ? applications
      : bucket.id === cases.id
        ? cases
        : bucket
  )
}

const lists = [
  {
    name: 'Applications',
    path: '/dev-ops/applications',
    id: 'gas.applications',
    service: 'GAS',
    serviceName: 'Grant Application Service',
    noun: 'applications',
    fact: 'code',
    param: 'grant',
    chip: 'Grant',
    time: 'Received',
    kinds: ['Reference', 'SBI', 'FRN', 'CRN', 'Agreement number'],
    row: (ref: string, code: string): BucketRow => ({
      id: ref,
      time: '2026-10-13T14:04:00.000Z',
      title: ref,
      subtitle: null,
      cells: { code, position: { phase: 'P', stage: 'S', status: 'X' } },
      link: { kind: 'application', code: 'woodland', clientRef: ref }
    }),
    href: (ref: string) => `/dev-ops/applications/woodland/${ref}`,
    empty: 'Applications GAS receives appear here.'
  },
  {
    name: 'Cases',
    path: '/dev-ops/cases',
    id: 'cw.cases',
    service: 'CW',
    serviceName: 'Caseworking',
    noun: 'cases',
    fact: 'workflowCode',
    param: 'workflow',
    chip: 'Workflow',
    time: 'Created',
    kinds: ['Reference', 'SBI'],
    row: (ref: string, code: string): BucketRow => ({
      id: ref,
      time: '2026-10-13T14:04:00.000Z',
      title: ref,
      subtitle: null,
      cells: {
        workflowCode: code,
        position: { phase: 'P', stage: 'S', status: 'X' }
      },
      link: { kind: 'case', workflowCode: 'woodland', caseRef: ref }
    }),
    href: (ref: string) => `/dev-ops/cases/woodland/${ref}`,
    empty: 'Cases CW creates appear here.'
  }
]

type List = (typeof lists)[number]

const exact = (
  list: List,
  overrides: Partial<BucketResult> = {}
): BucketResult => ({
  bucket: list.id,
  plan: {
    kind: 'exact',
    index: [list.fact],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [
    list.row('gld-ssp-x9v', 'woodland@1.43.2'),
    list.row('wmp-925-tjf', 'woodland')
  ],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [
    {
      by: list.fact,
      values: [{ value: 'example-grant', count: 12, capped: false }],
      total: { count: 12, capped: false }
    }
  ],
  ...overrides
})

const bounded = (list: List, page: Partial<BucketResult['page']>) =>
  exact(list, {
    plan: { ...exact(list).plan, kind: 'bounded' },
    groups: [],
    page: {
      next: null,
      keepLooking: null,
      searchedTo: null,
      complete: false,
      ...page
    }
  })

const answered = (page: BucketResult): BucketListResult => ({
  page,
  unavailable: false,
  timedOut: false,
  errored: false,
  refused: false,
  refusal: null
})

const given = (...reads: BucketListResult[]) => {
  for (const read of reads) {
    vi.mocked(queryBucketUseCase).mockResolvedValueOnce(read)
  }
}

let server: Server

const cookieOf = (setCookie: string | string[] | undefined): string =>
  [setCookie ?? []]
    .flat()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')

const view = async (url: string, cookie = '') => {
  const { result, statusCode, headers } = await server.inject({
    method: 'GET',
    url,
    auth: { strategy: 'session', credentials },
    headers: {
      cookie: [cookie, 'dev-ops-times=utc'].filter(Boolean).join('; ')
    }
  })

  const $ = load(result as unknown as string)
  expectTablesStyled($, headers['content-security-policy'])

  return { $, statusCode }
}

/** Searches, then opens the list it redirects to, with the session the search set. */
const searched = async (list: List, kind: string, value: string) => {
  const {
    result,
    statusCode,
    headers: answer
  } = await server.inject({
    method: 'POST',
    url: list.path,
    payload: { 'ref-kind': kind, 'ref-value': value },
    auth: { strategy: 'session', credentials },
    headers: { 'sec-fetch-site': 'same-origin' }
  })

  if (statusCode !== statusCodes.seeOther) {
    return { $: load(result as unknown as string), statusCode }
  }

  return view(answer.location!, cookieOf(answer['set-cookie']))
}

const flat = (text: string) => text.replace(/\s+/g, ' ').trim()

const by = ($: CheerioAPI, testId: string) => $(`[data-testid="${testId}"]`)

const headers = ($: CheerioAPI) =>
  by($, 'list-table')
    .find('th')
    .toArray()
    .map((th) => flat($(th).text()))

const rows = ($: CheerioAPI) =>
  by($, 'list-row')
    .toArray()
    .map((row) =>
      $(row)
        .find('td')
        .toArray()
        .map((td) => flat($(td).text()))
        .slice(0, 3)
    )

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

beforeAll(async () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(now)

  server = await createServer()
  await server.register([devOps])
  await server.initialize()
})

beforeEach(() => {
  vi.mocked(getCatalogueUseCase).mockResolvedValue(catalogue)
  vi.mocked(getBucketAtUseCase).mockImplementation(async (path) => ({
    available: true,
    bucket: catalogue.buckets.find((bucket) => bucket.path === path) ?? null
  }))
  vi.mocked(queryBucketUseCase).mockReset()
})

afterAll(async () => {
  vi.useRealTimers()
  await server.stop()
})

describe.each(lists)('the $name list', (list) => {
  test('L1 loaded: the service under the title, Reference, Grant and the time, each row opening its record', async () => {
    given(answered(exact(list)))

    const { $, statusCode } = await view(list.path)

    expect(statusCode).toBe(statusCodes.ok)
    expect(flat(by($, 'list-title').text())).toBe(list.name)
    expect(flat($('.gpa-pageheader-meta').text())).toBe(list.serviceName)
    expect(headers($)).toEqual(['Reference', 'Grant', list.time])
    expect(rows($)).toEqual([
      ['gld-ssp-x9v', 'woodland@1.43.2', '13 Oct 2026 14:04'],
      ['wmp-925-tjf', 'woodland', '13 Oct 2026 14:04']
    ])
    expect(by($, 'list-row').first().find('a').attr('href')).toMatch(
      new RegExp(`^${list.href('gld-ssp-x9v')}(\\?|$)`)
    )
    expect(by($, 'list-row').first().find('.gpa-mono').length).toBeGreaterThan(
      0
    )
  })

  test('L1 loaded: the chip without counts, the time chip and the search kinds', async () => {
    given(answered(exact(list)))

    const { $ } = await view(list.path)
    const chip = by($, `list-chip-${list.fact}`)

    expect(flat(chip.find('.gpa-chip-label').text())).toBe(`${list.chip}:`)
    expect(
      chip
        .find('.gpa-menuitem')
        .toArray()
        .map((item) => [
          flat($(item).find('.gpa-menuitem-label').text()),
          $(item).attr('href')
        ])
    ).toEqual([
      ['All', list.path],
      ['example-grant', `${list.path}?${list.param}=example-grant`]
    ])
    expect(chip.find('.gpa-menuitem-meta')).toHaveLength(0)
    expect(flat(by($, 'list-range').find('.gpa-chip-label').text())).toBe(
      `${list.time}:`
    )
    expect(
      by($, 'list-search')
        .find('select[name="ref-kind"] option')
        .toArray()
        .map((option) => $(option).text())
    ).toEqual(list.kinds)
  })

  test('L2 no matches: the prototype’s empty state, the filters still there', async () => {
    given(answered(exact(list, { rows: [] })))

    const { $ } = await view(`${list.path}?${list.param}=example-grant`)

    expect(flat($('.gpa-empty-title').text())).toBe(`No ${list.noun} match`)
    expect(tags($)).toEqual([`${list.chip} is example-grant`])
    expect(
      by($, 'list-applied').find('.gpa-tag button, .gpa-tag a')
    ).toHaveLength(1)
  })

  test('L3 searched, keep looking: where the read stopped, and the way on', async () => {
    given(
      answered(
        bounded(list, {
          keepLooking: 'k1',
          searchedTo: '2026-10-06T14:00:00.000Z'
        })
      )
    )

    const { $ } = await searched(list, 'sbi', '107214733')

    expect(flat(by($, 'list-footer').find('span').first().text())).toBe(
      'Searched back to 6 Oct 2026 14:00.'
    )
    expect(by($, 'list-footer').find('time').attr('datetime')).toBe(
      '2026-10-06T14:00:00Z'
    )
    expect(flat(by($, 'list-footer').find('a').text())).toBe('Keep looking')
    expect(by($, 'list-footer').find('a').attr('href')).toMatch(
      new RegExp(`^${list.path}\\?cursor=k1`)
    )
  })

  test('L4 searched everything: says so', async () => {
    given(answered(bounded(list, { complete: true })))

    const { $ } = await view(`${list.path}?${list.param}=example-grant`)

    expect(flat(by($, 'list-footer').text())).toBe('Searched everything.')
  })

  test(`L5 search refused: the service's reason in code, and Start again`, async () => {
    given(
      {
        page: null,
        unavailable: false,
        timedOut: false,
        errored: false,
        refused: true,
        refusal: '"ref-value" must be at most 100 characters'
      },
      answered(exact(list))
    )

    const { $ } = await searched(list, 'ref', 'a'.repeat(120))

    expect(alertOf($)).toEqual({
      tone: 'warning',
      title: `${list.service} refused this search.`,
      body: '"ref-value" must be at most 100 characters The search has been cleared.'
    })
    expect(by($, 'list-alert').find('code').text()).toBe(
      '"ref-value" must be at most 100 characters'
    )
    expect(by($, 'list-start-again').attr('href')).toBe(list.path)
  })

  test('L6 unavailable: the prototype’s copy naming the service, Try again, no table', async () => {
    given({
      page: null,
      unavailable: true,
      timedOut: true,
      errored: false,
      refused: false,
      refusal: null
    })

    const { $, statusCode } = await view(list.path)

    expect(statusCode).toBe(statusCodes.gatewayTimeout)
    expect(alertOf($)).toEqual({
      tone: 'danger',
      title: `The ${list.noun} list couldn’t be loaded.`,
      body: `${list.service} didn’t answer in time. Nothing has changed — try again in a moment.`
    })
    expect(by($, 'list-retry').attr('href')).toBe(list.path)
    expect(by($, 'list-table')).toHaveLength(0)
  })

  test('L7 load more failed: the service named, and a retry of the same page', async () => {
    given({
      page: null,
      unavailable: true,
      timedOut: false,
      errored: false,
      refused: false,
      refusal: null
    })

    const { $ } = await view(`${list.path}?cursor=c2`)

    expect(flat(by($, 'list-footer').find('.gpa-text-danger').text())).toBe(
      `Couldn’t load more ${list.noun} — ${list.service} didn’t answer.`
    )
    expect(by($, 'list-footer').find('a').attr('href')).toBe(
      `${list.path}?cursor=c2`
    )
  })

  test('L8 a search with characters no reference has: the box says why, and nothing is searched for', async () => {
    given(answered(exact(list)))

    const { $, statusCode } = await searched(list, 'ref', 'a b')

    expect(statusCode).toBe(statusCodes.badRequest)
    expect(flat(by($, 'list-search-error').text())).toBe(
      'Enter an identifier using only letters, numbers and . _ : @ -'
    )
    expect(
      vi.mocked(queryBucketUseCase).mock.calls.at(-1)?.[1].ref
    ).toBeUndefined()
  })

  test('L9 a version from a version page’s link: a tag of its own, removed with its grant kept', async () => {
    given(answered(exact(list)))

    const { $ } = await view(
      `${list.path}?${list.param}=example-grant&version=1.4.2`
    )

    expect(tags($)).toEqual([
      `${list.chip} is example-grant`,
      'Version is 1.4.2'
    ])
    expect(by($, 'list-applied').find('.gpa-tag a').eq(1).attr('href')).toBe(
      `${list.path}?${list.param}=example-grant`
    )
    expect(vi.mocked(queryBucketUseCase).mock.calls.at(-1)?.[1].where).toEqual({
      [list.fact]: 'example-grant',
      currentConfigVersion: '1.4.2'
    })
  })

  test('two grants: the chip says 2 selected, a tag each, and both are asked for', async () => {
    given(answered(exact(list)))

    const { $ } = await view(
      `${list.path}?${list.param}=example-grant&${list.param}=woodland`
    )

    expect(by($, `list-chip-${list.fact}`).find('.gpa-chip-value').text()).toBe(
      '2 selected'
    )
    expect(tags($)).toEqual([
      `${list.chip} is example-grant`,
      `${list.chip} is woodland`
    ])
    expect(vi.mocked(queryBucketUseCase).mock.calls.at(-1)?.[1].where).toEqual({
      [list.fact]: ['example-grant', 'woodland']
    })
  })

  test('L10 nothing at all, with no filters: says what would be here', async () => {
    given(answered(exact(list, { rows: [], groups: [] })))

    const { $ } = await view(list.path)

    expect(flat($('.gpa-empty-title').text())).toBe(`No ${list.noun} yet`)
    expect(flat($('.gpa-empty-body').text())).toBe(list.empty)
  })
})
