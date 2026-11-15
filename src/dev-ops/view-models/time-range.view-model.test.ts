import { ukZone } from './zoned-clock.ts'
import Joi from 'joi'

import {
  timeRangeFilters,
  toRangeInstants,
  toTimeRange
} from './time-range.view-model.ts'
import type { TimeRangeList } from './time-range.view-model.ts'

const now = new Date('2026-06-16T10:20:00.000Z')

interface ApplicationsQuery {
  code?: string
  q?: string
  cursor?: string
  from?: string
  to?: string
  range?: string
}

const applications: TimeRangeList<ApplicationsQuery> = {
  basePath: '/dev-ops/applications',
  filterKeys: ['code', 'q', 'from', 'to', 'range'],
  presetTitlePrefix: 'Applications created in the last'
}

const rangeFor = (query: ApplicationsQuery = {}) =>
  toTimeRange(applications, query, now, ukZone)

describe('toTimeRange', () => {
  test('offers All and the same six presets on any list', () => {
    expect(rangeFor().presets.map(({ label }) => label)).toEqual([
      'Last 15m',
      'Last 1h',
      'Last 6h',
      'Last 24h',
      'Last 7d',
      'Last 30d'
    ])
    expect(rangeFor().anyTimeActive).toBe(true)
  })

  test('links each preset to its own list, keeping its other filters', () => {
    const [fifteen] = rangeFor({
      code: 'woodland',
      q: 'APP-1',
      cursor: 'END',
      to: '2026-06-16T10:00:00.000Z'
    }).presets

    expect(fifteen.href).toBe(
      '/dev-ops/applications?code=woodland&q=APP-1&from=2026-06-16T10%3A05%3A00.000Z&range=15m'
    )
  })

  test('titles each preset in the words of the list', () => {
    expect(rangeFor().presets[3].title).toBe(
      'Applications created in the last 24h'
    )
  })

  test('clears only the window on All', () => {
    expect(
      rangeFor({
        code: 'woodland',
        from: '2026-06-15T10:20:00.000Z',
        range: '24h'
      }).anyTimeHref
    ).toBe('/dev-ops/applications?code=woodland')
  })

  test('sends the Custom form to the list, carrying every filter but the window', () => {
    const range = rangeFor({
      code: 'woodland',
      q: 'APP-1',
      from: '2026-06-16T09:00:00.000Z',
      range: '1h',
      cursor: 'END'
    })

    expect(range.action).toBe('/dev-ops/applications')
    expect(range.hiddenFields).toEqual([
      { name: 'code', value: 'woodland' },
      { name: 'q', value: 'APP-1' }
    ])
  })

  test('fills the Custom boxes in UK time', () => {
    const range = rangeFor({
      from: '2026-06-16T09:00:00.000Z',
      to: '2026-06-16T10:20:30.000Z'
    })

    expect(range.fromInput).toBe('2026-06-16T10:00:00')
    expect(range.toInput).toBe('2026-06-16T11:20:30')
    expect(range.label).toBe('2026-06-16 10:00 – 2026-06-16 11:20')
    expect(range.active).toBe(true)
  })
})

describe('toRangeInstants', () => {
  test('takes the first pass of the repeated autumn hour for From, the second for To', () => {
    expect(
      toRangeInstants(
        { from: '2026-10-25T01:30', to: '2026-10-25T01:30' },
        ukZone
      )
    ).toEqual({
      from: '2026-10-25T00:30:00.000Z',
      to: '2026-10-25T01:30:00.000Z'
    })
  })

  test('passes an instant from a preset link through untouched', () => {
    expect(
      toRangeInstants({ from: '2026-06-16T09:00:00.000Z' }, ukZone)
    ).toEqual({
      from: '2026-06-16T09:00:00.000Z'
    })
  })

  test('leaves out an empty box', () => {
    expect(toRangeInstants({ from: '', to: undefined }, ukZone)).toEqual({})
  })
})

describe('timeRangeFilters', () => {
  const schema = Joi.object(timeRangeFilters)

  test('refuses a date the calendar does not have', () => {
    expect(schema.validate({ from: '2026-02-30T00:00' }).error).toBeDefined()
  })

  test('takes a box with or without seconds, and an empty one', () => {
    expect(
      schema.validate({ from: '2026-06-16T09:00', to: '2026-06-16T09:00:30' })
        .error
    ).toBeUndefined()
    expect(schema.validate({ from: '', range: '' }).error).toBeUndefined()
  })
})
