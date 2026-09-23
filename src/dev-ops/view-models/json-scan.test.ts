import { scanJson, toFaultMessage } from './json-scan.ts'

const pretty = JSON.stringify(
  {
    specversion: '1.0',
    data: { answers: { landParcels: [{ sheetId: 12345, parcelId: '0000' }] } }
  },
  null,
  2
)

describe('scanJson', () => {
  test.each([
    ['an object', pretty],
    ['an empty object', '{}'],
    ['an empty array', ' [ ] '],
    ['a bare string', '"x"'],
    ['numbers of every shape', '[0, -1, 1.5, 2e10, 3E-2, -0.5e+3]'],
    ['the three words', '[true, false, null]'],
    ['every escape', String.raw`"\" \\ \/ \b \f \n \r \t é 😀"`],
    ['whitespace of all four kinds', '\t{\r\n "a" : 1 }\n'],
    [
      'a deep nesting the call stack could not take',
      `${'['.repeat(100_000)}${']'.repeat(100_000)}`
    ]
  ])('reads %s as whole, as JSON.parse does', (_name, text) => {
    expect(scanJson(text).fault).toBeNull()
    expect(() => JSON.parse(text)).not.toThrow()
  })

  test.each([
    ['nothing at all', '', 1, 1, 'a value'],
    [
      'a trailing comma in an object',
      '{\n  "a": 1,\n}',
      3,
      1,
      'a property name in double quotes'
    ],
    ['an unquoted key', '{ a: 1 }', 1, 3, 'a property name in double quotes'],
    ['a missing colon', '{ "a" 1 }', 1, 7, 'a colon'],
    [
      'a missing comma between members',
      '{ "a": 1 "b": 2 }',
      1,
      10,
      'a comma or a closing brace'
    ],
    [
      'a missing comma between items',
      '[1 2]',
      1,
      4,
      'a comma or a closing bracket'
    ],
    ['a trailing comma in an array', '[1,]', 1, 4, 'a value'],
    ['an unclosed object', '{ "a": 1', 1, 9, 'a comma or a closing brace'],
    ['an unclosed array', '[1', 1, 3, 'a comma or a closing bracket'],
    ['an unclosed string', '{ "a": "b }', 1, 12, 'a closing quote'],
    [
      'a line break inside a string',
      '{ "a": "b\n" }',
      1,
      10,
      'a closing quote'
    ],
    ['a tab inside a string', '"a\tb"', 1, 3, 'an escaped control character'],
    ['an unknown escape', String.raw`"\x"`, 1, 3, 'a valid escape'],
    [
      'a short unicode escape',
      String.raw`"\u12G4"`,
      1,
      4,
      'four hexadecimal digits'
    ],
    ['a backslash at the very end', '"\\', 1, 3, 'a valid escape'],
    ['a sign with no digits', '-', 1, 2, 'a digit'],
    ['a point with no digits after it', '1.', 1, 3, 'a digit'],
    ['an exponent with no digits', '1e+', 1, 4, 'a digit'],
    ['a leading zero', '[01]', 1, 3, 'a comma or a closing bracket'],
    ['a misspelt word', 'nul', 1, 1, 'a value'],
    ['a single quote', "{ 'a': 1 }", 1, 3, 'a property name in double quotes'],
    ['a second document', '{} {}', 1, 4, 'the end of the document'],
    ['a stray character where a value goes', '{ "a": ? }', 1, 8, 'a value']
  ])('finds %s', (_name, text, line, column, expected) => {
    expect(scanJson(text).fault).toEqual({ line, column, expected })
    expect(() => JSON.parse(text)).toThrow(SyntaxError)
  })

  test('counts lines from one and columns from one on each line', () => {
    const broken = pretty.replace('"parcelId": "0000"', '"parcelId": "0000",')

    expect(scanJson(broken).fault).toEqual({
      line: 9,
      column: 9,
      expected: 'a property name in double quotes'
    })
  })

  test('counts a character outside the basic plane as two columns, as a textarea does', () => {
    expect(scanJson('{ "a": "😀" x }').fault).toEqual({
      line: 1,
      column: 13,
      expected: 'a comma or a closing brace'
    })
  })
})

describe('keys that cannot be saved', () => {
  test.each([
    [
      'a key starting with $',
      '{\n  "a": { "$set": 1 }\n}',
      2,
      10,
      'dollar-key'
    ],
    [
      'a $ key spelt with an escape',
      String.raw`{ "\u0024where": 1 }`,
      1,
      3,
      'dollar-key'
    ],
    [
      'a key repeated in one object',
      '{\n  "a": 1,\n  "b": 2,\n  "a": 3\n}',
      4,
      3,
      'duplicate-key'
    ],
    [
      'a repeat spelt with an escape',
      String.raw`{ "a": 1, "\u0061": 2 }`,
      1,
      11,
      'duplicate-key'
    ]
  ])('finds %s', (_name, text, line, column, problem) => {
    expect(scanJson(text)).toEqual({
      fault: null,
      keyFault: { line, column, problem },
      unsafeInteger: null
    })
  })

  test('reads the same key in two objects, and a $ inside a value, as fine', () => {
    expect(
      scanJson(
        '{ "a": { "id": 1 }, "b": { "id": 1 }, "c": ["$x", { "id": "$" }] }'
      ).keyFault
    ).toBeNull()
  })

  test('names only the first', () => {
    expect(scanJson('{ "a": 1, "a": 2, "$b": 3 }').keyFault).toEqual({
      line: 1,
      column: 11,
      problem: 'duplicate-key'
    })
  })

  test('gives way to a syntax fault anywhere in the text', () => {
    expect(scanJson('{ "a": 1, "a": 2 x }')).toEqual({
      fault: { line: 1, column: 18, expected: 'a comma or a closing brace' },
      keyFault: null,
      unsafeInteger: null
    })
  })
})

describe('whole numbers too large to keep', () => {
  test.each([
    ['2^53', '{ "a": 9007199254740992 }', { line: 1, column: 8 }],
    ['-(2^53)', '[-9007199254740992]', { line: 1, column: 2 }],
    [
      'a twenty-digit id',
      '{\n  "id": 12345678901234567890\n}',
      { line: 2, column: 9 }
    ]
  ])('finds %s', (_name, text, position) => {
    expect(scanJson(text).unsafeInteger).toEqual(position)
  })

  test.each([
    ['2^53 − 1', '9007199254740991'],
    ['-(2^53 − 1)', '-9007199254740991'],
    ['a fraction', '12345678901234567890.5'],
    ['an exponent', '1e300'],
    ['the digits as a string', '"12345678901234567890"']
  ])('lets %s through', (_name, text) => {
    expect(scanJson(text).unsafeInteger).toBeNull()
  })

  test('names only the first', () => {
    expect(
      scanJson('[1, 9007199254740993, 9007199254740994]').unsafeInteger
    ).toEqual({ line: 1, column: 5 })
  })
})

describe('toFaultMessage', () => {
  test('names the place and what should have been there', () => {
    expect(toFaultMessage({ line: 17, column: 9, expected: 'a colon' })).toBe(
      'Expected a colon at line 17, column 9.'
    )
  })

  test('never quotes the text it is about', () => {
    const secret = 'SBI-106284736'
    const text = `{ "sbi": "${secret}" "name": "Jane Doe" }`
    const { fault } = scanJson(text)

    expect(fault).not.toBeNull()
    expect(toFaultMessage(fault!)).toBe(
      'Expected a comma or a closing brace at line 1, column 26.'
    )
    expect(toFaultMessage(fault!)).not.toContain(secret)
  })
})
