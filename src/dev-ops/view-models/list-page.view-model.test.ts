import type { BucketResult } from '../use-cases/query-bucket.use-case.ts'
import {
  casesBucket,
  fullCatalogue,
  gasOutbox
} from '../use-cases/test-fixtures.ts'
import { toCaseworkingUnreachable, toListPage } from './list-page.view-model.ts'
import type { ListPageInput } from './list-page.view-model.ts'
import { toTimes } from './times.ts'

const result = (overrides: Partial<BucketResult> = {}): BucketResult => ({
  bucket: 'x',
  plan: {
    kind: 'exact',
    index: [],
    bound: [],
    filled: [],
    residual: [],
    scans: 1
  },
  rows: [],
  page: { next: null, keepLooking: null, searchedTo: null, complete: true },
  groups: [],
  ...overrides
})

const input = (overrides: Partial<ListPageInput> = {}): ListPageInput => ({
  bucket: gasOutbox,
  read: {
    page: result(),
    unavailable: false,
    timedOut: false,
    errored: false,
    refused: false,
    refusal: null
  },
  filters: {},
  buckets: fullCatalogue.buckets,
  times: toTimes('utc'),
  search: null,
  now: new Date('2026-10-13T15:20:00.000Z'),
  ...overrides
})

describe('toListPage', () => {
  test('choosing a fact drops the facts within it, as a version is within its workflow', () => {
    const page = toListPage(
      input({
        bucket: casesBucket,
        filters: {
          workflowCode: 'example-grant',
          currentConfigVersion: '1.0.0'
        }
      })
    )

    expect(page.chips[0].items.map(({ href }) => href)).toEqual([
      '/dev-ops/cases',
      '/dev-ops/cases'
    ])
    expect(
      page.applied.map(({ label, value }) => `${label} is ${value}`)
    ).toEqual(['Workflow is example-grant', 'Version is 1.0.0'])
    expect(page.applied[0]).toEqual(
      expect.objectContaining({ removeHref: '/dev-ops/cases' })
    )
    expect(page.filtered).toBe(true)
  })

  test('nothing set: every chip reads All, no tags and not filtered', () => {
    const page = toListPage(input())

    expect(page.chips.map(({ value }) => value)).toEqual(['All', 'All'])
    expect(page.applied).toEqual([])
    expect(page.filtered).toBe(false)
  })

  test('several values: the chip says how many, and a tag each, in the menu’s order', () => {
    const page = toListPage(
      input({ filters: { status: ['DEAD_LETTER', 'FAILED'] } })
    )

    expect(page.chips[0].value).toBe('2 selected')
    expect(page.applied.map(({ value }) => value)).toEqual([
      'Failed',
      'Dead letter'
    ])
  })

  test('a chosen value the catalogue no longer lists is kept in the menu', () => {
    const page = toListPage(input({ filters: { eventType: 'Retired' } }))

    expect(page.chips[1].items.at(-1)).toEqual(
      expect.objectContaining({ text: 'Retired', checked: true })
    )
  })

  test('a held search: tagged by its kind, cleared by its own form, Clear all drops it', () => {
    const page = toListPage(
      input({
        search: { q: 'id:abc', id: 'u1' },
        filters: { status: 'DEAD_LETTER' }
      })
    )

    expect(page.applied.at(-1)).toEqual({
      key: 'search',
      label: 'Event ID',
      value: 'abc',
      mono: true,
      removeName: 'ref-value',
      removeValue: '',
      removeForm: 'list-search-clear'
    })
    expect(page.clearSearchForm?.hidden).toEqual([
      { name: 'status', value: 'DEAD_LETTER' }
    ])
    expect(page.applied).toHaveLength(2)
    expect(page.filtered).toBe(true)
    expect(page.clearAllHref).toBe('/dev-ops/events/gas/outbox?clear=all')
    expect(page.searchField?.kinds.find(({ checked }) => checked)?.value).toBe(
      'id'
    )
  })

  test('a later page of a search names it in its own next link', () => {
    const page = toListPage(
      input({
        search: { q: 'ref:abc', id: 'u1' },
        cursor: 'c1',
        read: {
          page: result({
            page: {
              next: 'c2',
              keepLooking: null,
              searchedTo: null,
              complete: false
            }
          }),
          unavailable: false,
          timedOut: false,
          errored: false,
          refused: false,
          refusal: null
        }
      })
    )

    expect(page.table?.footer).toEqual({
      state: 'more',
      nextHref: '/dev-ops/events/gas/outbox?cursor=c2&searched=u1',
      noun: 'events'
    })
  })

  test('a row with no page of its own is no link', () => {
    const page = toListPage(
      input({
        read: {
          page: result({
            rows: [
              {
                id: 'r',
                time: 'not a time',
                title: 'T',
                subtitle: null,
                cells: {},
                link: null
              }
            ]
          }),
          unavailable: false,
          timedOut: false,
          errored: false,
          refused: false,
          refusal: null
        }
      })
    )

    expect(page.table?.rows[0]).toEqual({
      href: null,
      cells: [
        { kind: 'text', text: 'T', mono: false, align: 'start' },
        { kind: 'none', align: 'start' },
        { kind: 'none', align: 'start' },
        { kind: 'text', text: 'not a time', mono: false, align: 'right' }
      ]
    })
  })
})

test('Caseworking unreachable: no filters, no table, the reason and Try again', () => {
  const page = toCaseworkingUnreachable('cw.inbox', '/dev-ops/events/cw/inbox')

  expect(page.range).toBeNull()
  expect(page.table).toBeNull()
  expect(page.navActive).toBe('cw.inbox')
  expect(page.alert?.retryHref).toBe('/dev-ops/events/cw/inbox')
})

test('a chosen value is named by its label, not its code', () => {
  const page = toListPage(
    input({
      bucket: {
        ...gasOutbox,
        facts: gasOutbox.facts.map((fact) =>
          fact.name === 'eventType'
            ? {
                ...fact,
                values: [{ value: 'AUD', label: 'Audit' }]
              }
            : fact
        )
      },
      filters: { eventType: 'AUD' }
    })
  )

  expect(page.chips[1].value).toBe('Audit')
  expect(page.chips[1].items.at(-1)?.text).toBe('Audit')
})
