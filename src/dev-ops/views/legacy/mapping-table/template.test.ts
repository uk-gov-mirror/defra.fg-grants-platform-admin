import type { CheerioAPI } from 'cheerio'

import { render } from '../../../test-utils.ts'
import { toMappingRows } from '../../../view-models/mapping-table.ts'

const flatten = (text: string) => text.replaceAll(/\s+/g, ' ').trim()

const part = ($: CheerioAPI, name: string) =>
  $(`[data-testid="fields-${name}"]`)

const tableOf = (mapping: Record<string, unknown>) =>
  render('mapping-table', { rows: toMappingRows(mapping), testId: 'fields' })

describe('mapping-table component', () => {
  test('heads Field, Value and Comes from, Comes from only from sm up', () => {
    const $ = tableOf({ scheme: 'WMP' })
    const heads = $('th')

    expect(heads.toArray().map((head) => $(head).text())).toEqual([
      'Field',
      'Value',
      'Comes from'
    ])
    expect(heads.last().attr('class')).toBe(
      'hidden whitespace-nowrap sm:table-cell'
    )
    expect($('col').last().attr('class')).toBe('hidden w-28 sm:table-column')
    expect($('table').attr('class')).toContain('sm:min-w-[40rem]')
    expect(part($, '')).toHaveLength(0)
  })

  test('says where each value comes from, and below sm as a muted suffix', () => {
    const $ = tableOf({
      scheme: 'WMP',
      sbi: '$.claim.sbi',
      year: 'jsonata:$substring($.execution.executedAt, 0, 4)',
      invoice: ''
    })

    expect(
      part($, 'comes-from')
        .toArray()
        .map((cell) => $(cell).text())
    ).toEqual(['fixed', 'copied', 'calculated', 'empty'])
    expect($('[data-comes-from]').first().attr('class')).toBe(
      'ml-1.5 text-xs sm:hidden text-base-content/70'
    )
  })

  test('clamps an expression to two lines, opening it in full, without its prefix', () => {
    const $ = tableOf({
      year: 'jsonata:$substring($.execution.executedAt, 0, 4)'
    })
    const expression = $('[data-expression]')

    expect(expression.is('details')).toBe(true)
    expect(expression.find('summary span').first().attr('class')).toContain(
      'line-clamp-2'
    )
    expect(flatten(expression.text())).toBe(
      '$substring($.execution.executedAt, 0, 4)'
    )
  })

  test('indents nested fields beneath their parent, and says what a collection walks', () => {
    const $ = tableOf({
      actions: {
        itemsRef: '$.application.annualActions',
        items: { ref: '@.ref' }
      }
    })
    const rows = part($, 'row')

    expect(flatten(rows.first().find('td').eq(1).text())).toBe(
      '$.application.annualActions for each'
    )
    expect(
      rows.first().find('td').eq(1).find('[data-comes-from]').attr('class')
    ).toContain('sm:hidden')
    expect(flatten(part($, 'comes-from').first().text())).toBe('for each')
    expect(part($, 'field').eq(1).attr('class')).toBe('block text-sm pl-4')
  })

  test('says a list with no items is empty', () => {
    const $ = tableOf({ actions: [] })

    expect(flatten(part($, 'row').first().find('td').eq(1).text())).toBe(
      'empty list'
    )
  })

  test('separates a value from where it comes from in its text', () => {
    const $ = tableOf({ sbi: '$.claim.sbi' })

    expect(flatten(part($, 'row').first().find('td').eq(1).text())).toBe(
      '$.claim.sbi copied'
    )
  })
})
