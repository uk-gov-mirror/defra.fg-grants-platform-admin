// @vitest-environment happy-dom

import { ClientField } from './client-field.element.ts'

const mountField = async (counts = '{"grants-ui":2,"fg-gss-pmf":1}') => {
  await import('../index.ts')
  document.body.innerHTML = `
    <do-client-field data-active-counts='${counts}'>
      <input type="text">
      <p data-client-error hidden>Someone has just created this client.</p>
      <p data-client-active></p>
    </do-client-field>`
  await Promise.resolve()

  const input = document.querySelector('input')!

  return {
    field: () => document.querySelector('do-client-field')!,
    error: () => document.querySelector<HTMLElement>('[data-client-error]')!,
    input: () => document.querySelector('input')!,
    type: (value: string) => {
      input.value = value
      input.dispatchEvent(new Event('input'))
    },
    line: () => document.querySelector('[data-client-active]')!.textContent
  }
}

describe('do-client-field', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountField()

    expect(customElements.get('do-client-field')).toBe(ClientField)
  })

  test.each([
    [
      'grants-ui',
      'grants-ui already has 2 working tokens. If this replaces one, rotate that token instead.'
    ],
    [
      ' fg-gss-pmf ',
      'fg-gss-pmf already has 1 working token. If this replaces one, rotate that token instead.'
    ],
    ['new-service', ''],
    ['constructor', '']
  ])('says what "%s" already has', async (typed, said) => {
    const { type, line } = await mountField()

    type(typed)

    expect(line()).toBe(said)
  })

  test('says, as it is typed, a name outside the rule', async () => {
    const { type, error, input } = await mountField()

    type('Bad')

    expect(error().hidden).toBe(false)
    expect(error().textContent).toBe(
      'Use lowercase letters, digits and hyphens only.'
    )
    expect(input().getAttribute('aria-invalid')).toBe('true')

    type('good')

    expect(error().hidden).toBe(true)
    expect(input().hasAttribute('aria-invalid')).toBe(false)
  })

  test('holds the dialog while the name is empty or wrong', async () => {
    const { type, field } = await mountField()

    expect(field().hasAttribute('data-invalid')).toBe(true)
    type('grants-ui')
    expect(field().hasAttribute('data-invalid')).toBe(false)
    type('Bad')
    expect(field().hasAttribute('data-invalid')).toBe(true)
  })

  test('says nothing with counts it cannot read', async () => {
    const { type, line } = await mountField('not json')

    type('grants-ui')

    expect(line()).toBe('')
  })
})
