import { load, type CheerioAPI } from 'cheerio'
import type { Server } from '@hapi/hapi'

import { statusCodes } from '../../common/status-codes.ts'
import { createServer } from '../../server/index.ts'
import { devOps } from '../index.ts'
import {
  fullCatalogue,
  grantsBucket,
  workflowsBucket
} from '../use-cases/test-fixtures.ts'
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
import { expectTablesStyled } from '../test-utils.ts'

vi.mock(import('../use-cases/get-catalogue.use-case.ts'))
vi.mock(import('../use-cases/query-bucket.use-case.ts'))
vi.mock(import('../../common/config.ts'))

const credentials = {
  user: { id: '6f1e9c2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b', name: 'Ada Lovelace' },
  scope: ['FCP.GrantOperationsAdmin']
}

const now = new Date('2026-10-13T15:20:00.000Z')

const catalogue: Catalogue = fullCatalogue

const versionRow =
  (kind: 'grant' | 'workflow') =>
  (
    code: string,
    version: string | null,
    definition = 'fetched'
  ): BucketRow => ({
    id: `${code}@${version}`,
    time: '2026-10-13T14:04:00.000Z',
    title: code,
    subtitle: null,
    cells: { version, definition, status: 'active' },
    link: version ? { kind, code, version } : null
  })

/** The two version lists, as GAS and CW declare them (grants.bucket.js, the workflows bucket). */
const lists = [
  {
    name: 'Grants',
    path: '/dev-ops/grants',
    id: grantsBucket.id,
    service: 'GAS',
    noun: 'grant versions',
    fact: 'grantCode',
    stored: 'worstFetchStatus',
    param: 'grant',
    chip: 'Grant',
    column: 'Grant',
    serviceName: 'Grant Application Service',
    row: versionRow('grant'),
    href: (code: string, version: string) =>
      `/dev-ops/grants/${code}/${version}`,
    tooltip: true
  },
  {
    name: 'Workflows',
    path: '/dev-ops/workflows',
    id: workflowsBucket.id,
    service: 'CW',
    noun: 'workflow versions',
    fact: 'grantCode',
    stored: 'fetchStatus',
    param: 'workflow',
    chip: 'Workflow',
    column: 'Workflow',
    serviceName: 'Caseworking',
    row: versionRow('workflow'),
    href: (code: string, version: string) =>
      `/dev-ops/workflows/${code}/${version}`,
    tooltip: false
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
    list.row('woodland-creation', '1.4.2'),
    list.row('woodland-creation', null, 'permanent_error')
  ],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [
    {
      by: list.fact,
      values: [{ value: 'woodland-creation', count: 12, capped: false }],
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
        .map((td) => flat($(td).clone().find('.gpa-vh').remove().end().text()))
        .slice(0, 4)
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
  test('loaded: the service under the title, one version column as code@version, Stored, Status and Received, each row opening its version', async () => {
    given(answered(exact(list)))

    const { $, statusCode } = await view(list.path)

    expect(statusCode).toBe(statusCodes.ok)
    expect(flat(by($, 'list-title').text())).toBe(list.name)
    expect(flat($('.gpa-pageheader-meta').text())).toBe(list.serviceName)
    expect(headers($)).toEqual([list.column, 'Stored', 'Status', 'Received'])
    expect(rows($)).toEqual([
      ['woodland-creation@1.4.2', 'Stored', 'Active', '13 Oct 2026 14:04'],
      ['woodland-creation', 'Failed', 'Active', '13 Oct 2026 14:04']
    ])
    expect(by($, 'list-row').first().find('a').attr('href')).toMatch(
      new RegExp(`^${list.href('woodland-creation', '1.4.2')}(\\?|$)`)
    )
    expect(by($, 'list-row').eq(1).find('.gpa-dot-danger')).toHaveLength(1)
  })

  test('loaded: the chips in the prototype’s order, Stored named so, and no search field', async () => {
    given(answered(exact(list)))

    const { $ } = await view(list.path)

    expect(
      $('.gpa-filterbar .gpa-chip-label')
        .toArray()
        .map((label) => flat($(label).text()))
    ).toEqual([`${list.chip}:`, 'Stored:', 'Status:', 'Received:'])
    expect(
      by($, `list-chip-${list.stored}`)
        .find('a.gpa-menuitem')
        .eq(1)
        .attr('href')
    ).toBe(`${list.path}?definition=fetched`)
    expect(by($, 'list-search')).toHaveLength(0)
  })

  test('the tags follow the chips’ order', async () => {
    given(answered(exact(list)))

    const { $ } = await view(
      `${list.path}?status=active&definition=permanent_error&${list.param}=woodland-creation`
    )
    const chipLabels = $('[data-testid^="list-chip-"] .gpa-chip-label')
      .toArray()
      .map((label) => $(label).text().replace(':', '').trim())

    expect(tags($).map((tag) => tag.split(' is ')[0])).toEqual(
      chipLabels.filter((label) =>
        tags($).some((tag) => tag.startsWith(`${label} is`))
      )
    )
    expect(tags($)).toHaveLength(3)
  })

  test('the applied tag says Stored, as the chip does', async () => {
    given(answered(exact(list)))

    const { $ } = await view(`${list.path}?definition=permanent_error`)

    expect(tags($)).toEqual(['Stored is Failed'])
  })

  test('two Stored values: 2 selected, a tag each in the menu’s order, and both asked for', async () => {
    given(answered(exact(list)))

    const { $ } = await view(
      `${list.path}?definition=permanent_error&definition=transient_error`
    )

    expect(
      by($, `list-chip-${list.stored}`).find('.gpa-chip-value').text()
    ).toBe('2 selected')
    expect(tags($)).toEqual(['Stored is Fetch error', 'Stored is Failed'])
    expect(vi.mocked(queryBucketUseCase).mock.calls.at(-1)?.[1].where).toEqual({
      [list.stored]: ['permanent_error', 'transient_error']
    })
  })

  test(`the Stored hint is in a tooltip only on the list the prototype gives one (${list.tooltip})`, async () => {
    given(answered(exact(list)))

    const { $ } = await view(list.path)

    expect(by($, 'list-row').first().find('gpa-tooltip')).toHaveLength(
      list.tooltip ? 1 : 0
    )
  })

  test('no matches: the prototype’s empty state', async () => {
    given(answered(exact(list, { rows: [] })))

    const { $ } = await view(`${list.path}?${list.param}=woodland-creation`)

    expect(flat($('.gpa-empty-title').text())).toBe(`No ${list.noun} match`)
    expect(flat($('.gpa-empty-body').text())).toBe(
      'Nothing received in this time range has this status and definition state.'
    )
  })

  test('searched everything: says so', async () => {
    given(answered(bounded(list, { complete: true })))

    const { $ } = await view(`${list.path}?${list.param}=woodland-creation`)

    expect(flat(by($, 'list-footer').text())).toBe('Searched everything.')
  })

  test('a filter read that stopped early: where it stopped, and the way on', async () => {
    given(
      answered(
        bounded(list, {
          keepLooking: 'k1',
          searchedTo: '2026-10-06T14:00:00.000Z'
        })
      )
    )

    const { $ } = await view(`${list.path}?definition=pending`)

    expect(flat(by($, 'list-footer').find('a').text())).toBe('Keep looking')
  })

  test('a filter the service refused: its reason, and Start again', async () => {
    given({
      page: null,
      unavailable: false,
      timedOut: false,
      errored: false,
      refused: true,
      refusal: '"definition" must be one of [fetched, pending]'
    })

    const { $ } = await view(`${list.path}?definition=pending`)

    expect(alertOf($).title).toBe(`${list.service} refused these filters.`)
    expect(by($, 'list-start-again').attr('href')).toBe(list.path)
  })

  test('unavailable: the prototype’s copy naming the service, Try again, no table', async () => {
    given({
      page: null,
      unavailable: true,
      timedOut: true,
      errored: false,
      refused: false,
      refusal: null
    })

    const { $ } = await view(list.path)

    expect(alertOf($)).toEqual({
      tone: 'danger',
      title: `The ${list.noun} list couldn’t be loaded.`,
      body: `${list.service} didn’t answer in time. Nothing has changed — try again in a moment.`
    })
    expect(by($, 'list-table')).toHaveLength(0)
  })

  test('load more failed: the service named, and a retry of the same page', async () => {
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
  })

  test('nothing at all: says what would be here', async () => {
    given(answered(exact(list, { rows: [], groups: [] })))

    const { $ } = await view(list.path)

    expect(flat($('.gpa-empty-body').text())).toBe(
      `Versions the config broker publishes to ${list.service} appear here.`
    )
  })
})
