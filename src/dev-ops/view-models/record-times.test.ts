import { readsTheSame, toRecordTime } from './record-times.ts'
import { toTimes } from './times.ts'

describe('toRecordTime', () => {
  test('writes an instant in the chosen zone, with its seconds and zone in the title', () => {
    expect(toRecordTime('2026-10-13T14:04:09.000Z', toTimes('uk'))).toEqual({
      datetime: '2026-10-13T14:04:09Z',
      text: '13\u00a0Oct 2026 15:04',
      title: '13 Oct 2026 15:04:09 BST'
    })
  })

  test('shows anything else GAS stored as it is', () => {
    expect(toRecordTime('13/10/2026', toTimes('utc'))).toEqual({
      datetime: null,
      text: '13/10/2026',
      title: null
    })
  })

  test.each([null, ''])('is nothing for %j', (value) => {
    expect(toRecordTime(value, toTimes('utc'))).toBeNull()
  })
})

describe('readsTheSame', () => {
  const utc = toTimes('utc')

  test('is true for two times in the same minute', () => {
    expect(
      readsTheSame(
        toRecordTime('2026-10-13T14:04:09.000Z', utc),
        toRecordTime('2026-10-13T14:04:51.000Z', utc)
      )
    ).toBe(true)
  })

  test('is false for two minutes', () => {
    expect(
      readsTheSame(
        toRecordTime('2026-10-13T14:04:09.000Z', utc),
        toRecordTime('2026-10-13T14:05:00.000Z', utc)
      )
    ).toBe(false)
  })

  test('tells apart two times an hour apart that UK time writes the same, the night the clocks go back', () => {
    const uk = toTimes('uk')
    const bst = toRecordTime('2026-10-25T00:30:00.000Z', uk)
    const gmt = toRecordTime('2026-10-25T01:30:00.000Z', uk)

    expect(bst?.text).toBe(gmt?.text)
    expect(readsTheSame(bst, gmt)).toBe(false)
  })
})
