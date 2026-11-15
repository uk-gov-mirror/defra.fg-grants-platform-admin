import { environment } from '../../../view-options.ts'
import { load } from 'cheerio'

const stacked = () =>
  load(
    environment.renderString(
      `{% from "stacked-rows/macro.njk" import stackedRows %}{% call(row, index) stackedRows({ columns: columns, rows: rows, testId: "rules" }) %}{{ row[index] }}{% endcall %}`,
      {
        columns: [
          { label: 'Applies to', width: 'w-1/4' },
          { label: 'Rule', width: 'w-3/4' }
        ],
        rows: [
          ['(root)', 'Fields not listed are removed'],
          ['email', 'Needs at least one of: email, phone']
        ]
      }
    )
  )

describe('stacked-rows component', () => {
  test('draws a table from sm up, from the same rows', () => {
    const $ = stacked()
    const table = $('[data-testid="rules-table"]')

    expect(table.parent().attr('class')).toBe(
      'hidden w-full overflow-x-auto sm:block'
    )
    expect(
      table
        .find('col')
        .toArray()
        .map((col) => $(col).attr('class'))
    ).toEqual(['w-1/4', 'w-3/4'])
    expect(
      table
        .find('th')
        .toArray()
        .map((th) => $(th).text())
    ).toEqual(['Applies to', 'Rule'])
    expect(
      $('[data-testid="rules-row"]')
        .toArray()
        .map((row) => $(row).find('td').first().text())
    ).toEqual(['(root)', 'email'])
  })

  test('draws each row as a block below sm: a title, then a muted label and value per column', () => {
    const $ = stacked()
    const blocks = $('[data-testid="rules-block"]')

    expect($('[data-testid="rules-blocks"]').attr('class')).toContain(
      'sm:hidden'
    )
    expect(blocks).toHaveLength(2)
    expect(blocks.first().children().first().text()).toBe('(root)')
    expect(
      blocks.first().children().eq(1).text().replace(/\s+/g, ' ').trim()
    ).toBe('Rule · Fields not listed are removed')
    expect(
      blocks.first().children().eq(1).children().first().attr('class')
    ).toBe('text-base-content/70')
  })
})
