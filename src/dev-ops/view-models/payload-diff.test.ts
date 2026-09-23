import { maxEditLength, toPayloadDiff } from './payload-diff.ts'

const lines = (count: number, prefix = 'line'): string =>
  Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join(
    '\n'
  )

const replaceLine = (text: string, number: number, replacement: string) =>
  text
    .split('\n')
    .map((line, index) => (index === number - 1 ? replacement : line))
    .join('\n')

describe('toPayloadDiff', () => {
  test('marks a changed line as removed then added, numbered on each side', () => {
    const { rows, tooLong } = toPayloadDiff('a\nb\nc', 'a\nB\nc')

    expect(tooLong).toBe(false)
    expect(rows).toEqual([
      { op: 'same', a: 1, b: 1, text: 'a' },
      { op: 'removed', a: 2, b: null, text: 'b' },
      { op: 'added', a: null, b: 2, text: 'B' },
      { op: 'same', a: 3, b: 3, text: 'c' }
    ])
  })

  test('numbers the lines after an insertion on each side apart', () => {
    const { rows } = toPayloadDiff('a\nc', 'a\nb\nc')

    expect(rows).toEqual([
      { op: 'same', a: 1, b: 1, text: 'a' },
      { op: 'added', a: null, b: 2, text: 'b' },
      { op: 'same', a: 2, b: 3, text: 'c' }
    ])
  })

  test('diffs a change to the last line as a changed line', () => {
    const { rows } = toPayloadDiff('a\nb', 'a\nc')

    expect(rows.map(({ op, text }) => [op, text])).toEqual([
      ['same', 'a'],
      ['removed', 'b'],
      ['added', 'c']
    ])
  })

  test('keeps three unchanged lines either side of a change and folds the rest', () => {
    const before = lines(20)
    const { rows } = toPayloadDiff(before, replaceLine(before, 10, 'changed'))

    expect(rows.map(({ op, text }) => [op, text])).toEqual([
      ['skipped', '6 unchanged lines'],
      ['same', 'line 7'],
      ['same', 'line 8'],
      ['same', 'line 9'],
      ['removed', 'line 10'],
      ['added', 'changed'],
      ['same', 'line 11'],
      ['same', 'line 12'],
      ['same', 'line 13'],
      ['skipped', '7 unchanged lines']
    ])
  })

  test('says one unchanged line in the singular', () => {
    const before = lines(5)
    const { rows } = toPayloadDiff(before, replaceLine(before, 1, 'changed'))

    expect(rows.at(-1)).toEqual({
      op: 'skipped',
      a: null,
      b: null,
      text: '1 unchanged line'
    })
  })

  test('folds the run between two changes far apart, and keeps a short one', () => {
    const before = lines(30)
    const far = replaceLine(replaceLine(before, 5, 'x'), 25, 'y')
    const near = replaceLine(replaceLine(before, 5, 'x'), 11, 'y')

    expect(
      toPayloadDiff(before, far).rows.filter(({ op }) => op === 'skipped')
    ).toHaveLength(3)
    expect(
      toPayloadDiff(before, near).rows.filter(({ op }) => op === 'skipped')
    ).toHaveLength(2)
  })

  test('gives up past the edit bound and says so, rather than taking the time', () => {
    const before = lines(maxEditLength + 10, 'old')
    const after = lines(maxEditLength + 10, 'new')

    expect(toPayloadDiff(before, after)).toEqual({ rows: [], tooLong: true })
  })
})
