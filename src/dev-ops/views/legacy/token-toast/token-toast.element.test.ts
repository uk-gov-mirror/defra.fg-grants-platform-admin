// @vitest-environment happy-dom

import { TokenToast } from './token-toast.element.ts'

const mountToast = async (dismissAfter = '') => {
  await import('../index.ts')
  document.body.innerHTML = `
    <do-token-toast${dismissAfter ? ` data-dismiss-after="${dismissAfter}"` : ''}>
      <div role="status"><p data-toast-message>Revoked.</p>
      <button type="button" data-toast-dismiss>Dismiss</button></div>
    </do-token-toast>`
  await Promise.resolve()

  return {
    toast: () => document.querySelector('do-token-toast'),
    message: () => document.querySelector('[data-toast-message]')!.textContent,
    dismiss: () =>
      document.querySelector<HTMLElement>('[data-toast-dismiss]')!.click()
  }
}

describe('do-token-toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  test('registers the custom element', async () => {
    await mountToast()

    expect(customElements.get('do-token-toast')).toBe(TokenToast)
  })

  test('puts its words back into the live region a moment after arrival, so they are read out', async () => {
    const { message } = await mountToast()

    expect(message()).toBe('')
    vi.advanceTimersByTime(100)
    expect(message()).toBe('Revoked.')
  })

  test('goes when dismissed', async () => {
    const { toast, dismiss } = await mountToast()

    dismiss()

    expect(toast()).toBeNull()
  })

  test('stays until dismissed unless told when to go', async () => {
    const { toast } = await mountToast()

    vi.advanceTimersByTime(60_000)

    expect(toast()).not.toBeNull()
  })

  test('goes by itself after the time it is given', async () => {
    const { toast } = await mountToast('10000')

    vi.advanceTimersByTime(10_000)

    expect(toast()).toBeNull()
  })

  test('stays while focus is on it', async () => {
    const { toast } = await mountToast('10000')

    toast()!.dispatchEvent(new FocusEvent('focusin'))
    vi.advanceTimersByTime(10_000)

    expect(toast()).not.toBeNull()
  })
})
