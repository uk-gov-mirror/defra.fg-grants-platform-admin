import { toFilterHref } from './list-filters.ts'

interface ListQuery {
  code?: string | string[]
  q?: string
  from?: string
}

const keys = ['code', 'q', 'from'] as const

describe('toFilterHref', () => {
  test('carries the filters in the order of its keys, not of the query', () => {
    expect(
      toFilterHref('/dev-ops/applications', keys, {
        from: '2026-06-16T10:00:00.000Z',
        q: 'smith',
        code: 'woodland'
      })
    ).toBe(
      '/dev-ops/applications?code=woodland&q=smith&from=2026-06-16T10%3A00%3A00.000Z'
    )
  })

  test('puts the params it is given ahead of the filters', () => {
    expect(
      toFilterHref<ListQuery>(
        '/dev-ops/applications',
        keys,
        { code: 'woodland', q: 'smith' },
        new URLSearchParams({ cursor: 'A' })
      )
    ).toBe('/dev-ops/applications?cursor=A&code=woodland&q=smith')
  })

  test('repeats the key of a filter with several values, in their order', () => {
    expect(
      toFilterHref<ListQuery>('/dev-ops/applications', keys, {
        code: ['woodland', '', 'grasslands'],
        q: 'smith'
      })
    ).toBe('/dev-ops/applications?code=woodland&code=grasslands&q=smith')
  })

  test('a filter it carries replaces the same key among the params', () => {
    expect(
      toFilterHref<ListQuery>(
        '/dev-ops/applications',
        keys,
        { code: ['woodland', 'grasslands'] },
        new URLSearchParams([['code', 'old']])
      )
    ).toBe('/dev-ops/applications?code=woodland&code=grasslands')
  })

  test('leaves out the filters that are unset or blank', () => {
    expect(
      toFilterHref<ListQuery>('/dev-ops/applications', keys, {
        code: '',
        q: 'smith'
      })
    ).toBe('/dev-ops/applications?q=smith')
  })

  test.each<ListQuery>([{}, { code: '', q: '', from: '' }])(
    'is the bare path when there is nothing to carry: %j',
    (query) => {
      expect(toFilterHref('/dev-ops/applications', keys, query)).toBe(
        '/dev-ops/applications'
      )
    }
  )
})
