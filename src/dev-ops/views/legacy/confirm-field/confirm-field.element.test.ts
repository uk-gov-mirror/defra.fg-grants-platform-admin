// @vitest-environment happy-dom

import { ConfirmField } from './confirm-field.element.ts'

const mountField = async () => {
  await import('../index.ts')
  document.body.innerHTML = `
    <do-confirm-field data-expected="grants-ui"><input type="text"></do-confirm-field>`
  await Promise.resolve()

  const input = document.querySelector('input')!

  return {
    field: () => document.querySelector('do-confirm-field')!,
    type: (value: string) => {
      input.value = value
      input.dispatchEvent(new Event('input'))
    }
  }
}

describe('do-confirm-field', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountField()

    expect(customElements.get('do-confirm-field')).toBe(ConfirmField)
  })

  test('holds its dialog until the expected name is typed', async () => {
    const { field, type } = await mountField()

    expect(field().hasAttribute('data-invalid')).toBe(true)
    type('grants')
    expect(field().hasAttribute('data-invalid')).toBe(true)
    type(' grants-ui ')
    expect(field().hasAttribute('data-invalid')).toBe(false)
  })
})
