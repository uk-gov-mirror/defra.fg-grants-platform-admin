import { toValueRows } from './mapping-rows.ts'
import { toMappingRows } from './mapping-table.ts'

describe('toValueRows', () => {
  test('names each value by its whole path and says where it comes from', () => {
    expect(
      toValueRows(
        toMappingRows({
          currency: 'GBP',
          note: '',
          parties: { sbi: '$.application.sbi', tags: [] },
          year: 'jsonata:$now()'
        })
      )
    ).toEqual([
      { field: 'currency', how: 'Fixed', value: 'GBP', calculated: false },
      { field: 'note', how: 'Fixed', value: '""', calculated: false },
      {
        field: 'parties.sbi',
        how: 'From',
        value: '$.application.sbi',
        calculated: false
      },
      { field: 'parties.tags', how: 'List', value: null, calculated: false },
      { field: 'year', how: 'Calculated', value: '$now()', calculated: true }
    ])
  })

  test('gives a list with elements no row of its own, only its elements', () => {
    expect(toValueRows(toMappingRows({ codes: ['A'] }))).toEqual([
      { field: 'codes.1', how: 'Fixed', value: 'A', calculated: false }
    ])
  })
})
