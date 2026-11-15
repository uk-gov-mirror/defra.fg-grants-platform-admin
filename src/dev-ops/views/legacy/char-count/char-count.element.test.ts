// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { CharCount } from './char-count.element.ts'

const params = {
  id: 'purge-note',
  name: 'note',
  value: '',
  count: '0 / 500',
  max: 500,
  message: null,
  messageId: 'purge-note-hint',
  helpId: 'purge-note-help',
  describedBy: 'purge-note-help',
  hint: "Don't include personal data.",
  placeholder: 'Why will this event never be processed?',
  testId: 'note'
}

const mountCount = async (overrides: object = {}) => {
  const body = await mount('char-count', { ...params, ...overrides })
  const field = body.querySelector('textarea')!

  return {
    field,
    count: body.querySelector<HTMLElement>('[data-testid="note-count"]')!,
    status: body.querySelector<HTMLElement>('[data-testid="note-status"]')!,
    type: (value: string) => {
      field.value = value
      field.dispatchEvent(new Event('input', { bubbles: true }))
    }
  }
}

describe('do-char-count', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountCount()

    expect(customElements.get('do-char-count')).toBe(CharCount)
  })

  test('counts what is typed, against the limit on the element', async () => {
    const { count, type } = await mountCount()

    type('four')

    expect(count.textContent).toBe('4 / 500')
  })

  test('counts a value the server put there, before anything is typed', async () => {
    const { count } = await mountCount({ value: 'abc', count: '0 / 500' })

    expect(count.textContent).toBe('3 / 500')
  })

  test('falls back to 500 where the element names no usable limit', async () => {
    const { count, type } = await mountCount({ max: 'lots' })

    type('ab')

    expect(count.textContent).toBe('2 / 500')
  })

  test('says nothing until the limit is near', async () => {
    const { status, type } = await mountCount()

    type('a note well inside the limit')

    expect(status.textContent).toBe('')
  })

  test('announces what is left once the limit is near', async () => {
    const { status, type } = await mountCount({ max: 60 })

    type('x'.repeat(11))

    expect(status.textContent).toBe('49 characters remaining')
  })

  test('counts the last character in the singular', async () => {
    const { status, type } = await mountCount({ max: 10 })

    type('x'.repeat(9))

    expect(status.textContent).toBe('1 character remaining')
  })

  test('says how far past the limit the note is', async () => {
    const { status, type } = await mountCount({ max: 10 })

    type('x'.repeat(13))

    expect(status.textContent).toBe('3 characters too many')
  })

  test('falls quiet again when the note comes back under', async () => {
    const { status, type } = await mountCount({ max: 60 })

    type('x'.repeat(20))
    type('x')

    expect(status.textContent).toBe('')
  })

  test('leaves markup it does not recognise alone', async () => {
    document.body.innerHTML =
      '<do-char-count data-max="500"><p>Nothing here</p></do-char-count>'

    await Promise.resolve()

    expect(document.querySelector('p')!.textContent).toBe('Nothing here')
  })
})
