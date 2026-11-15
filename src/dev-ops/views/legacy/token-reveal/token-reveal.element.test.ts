// @vitest-environment happy-dom

import { TokenReveal } from './token-reveal.element.ts'

const raw = 'Zq3pLm8Rt2Vw9Xy4Ab7Cd1Ef6Gh0Ij5Kl3Mn8Op2x7Qa'

const mountReveal = async () => {
  await import('../index.ts')
  document.body.innerHTML = `
    <do-token-reveal>
      <textarea readonly data-reveal-token>${raw}</textarea>
      <button type="button" data-reveal-copy hidden><span data-reveal-copy-label>Copy</span></button>
      <p data-reveal-status></p>
      <form method="get" action="/dev-ops/clients/gas">
        <input type="checkbox" required data-reveal-ack>
        <button type="submit" data-reveal-done>Done</button>
      </form>
    </do-token-reveal>`
  await Promise.resolve()

  const get = <T extends HTMLElement>(name: string) =>
    document.querySelector<T>(`[data-reveal-${name}]`)!

  return {
    token: get<HTMLTextAreaElement>('token'),
    copy: get<HTMLButtonElement>('copy'),
    status: get('status'),
    ack: get<HTMLInputElement>('ack'),
    done: get<HTMLButtonElement>('done')
  }
}

describe('do-token-reveal', () => {
  const writeText = vi.fn(async (_text: string) => undefined)

  beforeEach(() => {
    document.body.innerHTML = ''
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    })
  })

  test('registers the custom element', async () => {
    await mountReveal()

    expect(customElements.get('do-token-reveal')).toBe(TokenReveal)
  })

  test('holds Done until the token is said to be stored', async () => {
    const { ack, done } = await mountReveal()

    expect(done.disabled).toBe(true)

    ack.checked = true
    ack.dispatchEvent(new Event('change'))

    expect(done.disabled).toBe(false)
  })

  test('copies the token and says so', async () => {
    const { copy, status } = await mountReveal()

    expect(copy.hidden).toBe(false)
    copy.click()
    await vi.waitFor(() => expect(status.textContent).toBe('Token copied'))
    expect(copy.textContent).toBe('Copied')
    expect(writeText).toHaveBeenCalledWith(raw)
  })

  test('says when the copy fails', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    const { copy, status } = await mountReveal()

    copy.click()

    await vi.waitFor(() =>
      expect(status.textContent).toBe(
        "Couldn't copy the token. Select it and copy it instead."
      )
    )
  })

  test('leaves for the page on Done, with no bare ? on the address', async () => {
    const assign = vi.fn()
    vi.spyOn(window, 'location', 'get').mockReturnValue({
      ...window.location,
      assign
    } as never)
    const { ack, done } = await mountReveal()
    const submit = () =>
      done.form!.dispatchEvent(new Event('submit', { cancelable: true }))

    submit()
    expect(assign).not.toHaveBeenCalled()

    ack.checked = true
    submit()
    expect(assign).toHaveBeenCalledWith(
      expect.stringMatching(/\/dev-ops\/clients\/gas$/)
    )
  })

  test('wipes the token as the page is left', async () => {
    const { token } = await mountReveal()

    window.dispatchEvent(new Event('pagehide'))

    expect(token.value).toBe('')
    expect(document.body.innerHTML).not.toContain(raw)
  })
})
