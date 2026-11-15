import { toRawTab, toSize } from './record-raw-tab.ts'

const copy = {
  noun: 'application',
  error: { title: 'Failed.', text: 'Try later.' },
  nothing: 'Nothing.'
}

const tabHref = '/dev-ops/applications/woodland/a?tab=raw'

const tooLarge = [{ section: 'raw', message: 'too large to show' }]

describe('toRawTab', () => {
  test('is the document as stored, indented', () => {
    expect(
      toRawTab({ raw: { a: [1] }, sectionErrors: [] }, copy, tabHref)
    ).toEqual({ kind: 'document', json: '{\n  "a": [\n    1\n  ]\n}' })
  })

  test('says the document is too large, with its size', () => {
    expect(
      toRawTab(
        { raw: null, storedBytes: 2516582, sectionErrors: tooLarge },
        copy,
        tabHref
      )
    ).toEqual({
      kind: 'too-large',
      text: 'The stored application is 2.4 MiB, too large for this page.'
    })
  })

  test('says it is too large without a size GAS did not send', () => {
    expect(
      toRawTab(
        { raw: null, storedBytes: null, sectionErrors: tooLarge },
        copy,
        tabHref
      )
    ).toEqual({
      kind: 'too-large',
      text: 'The stored application is too large to show on this page.'
    })
  })

  test('says the tab failed for any other Raw error', () => {
    expect(
      toRawTab(
        {
          raw: null,
          sectionErrors: [{ section: 'raw', message: 'GAS timed out' }]
        },
        copy,
        tabHref
      )
    ).toEqual({ kind: 'error', error: { ...copy.error, retryHref: tabHref } })
  })

  test("ignores another section's error", () => {
    expect(
      toRawTab(
        {
          raw: { a: 1 },
          sectionErrors: [{ section: 'events', message: 'too large to show' }]
        },
        copy,
        tabHref
      ).kind
    ).toBe('document')
  })

  test('says the source sent nothing when it sent no document', () => {
    expect(toRawTab({ raw: null, sectionErrors: [] }, copy, tabHref)).toEqual({
      kind: 'nothing',
      title: 'Nothing.'
    })
  })
})

describe('toSize', () => {
  test.each([
    [524288, '512 KiB'],
    [1572864, '1.5 MiB'],
    [4194304, '4 MiB'],
    [1500, '1.5 KiB']
  ])('writes %i bytes as %s', (bytes, text) => {
    expect(toSize(bytes)).toBe(text)
  })
})
