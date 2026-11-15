// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { toJsonView } from '../../../view-models/json-viewer.view-model.ts'

const value = {
  list: Array.from({ length: 13 }, (_, i) => i),
  data: { caseRef: 'GLD-9B2' }
}

const writeText = vi.fn()

const mountViewer = async () => {
  const body = await mount('json-viewer', {
    view: toJsonView(value),
    label: 'Payload',
    testId: 'payload'
  })
  const part = (testId: string) =>
    body.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!

  return {
    copy: part('payload-copy') as HTMLButtonElement,
    status: part('payload-copy-status')
  }
}

describe('do-json-viewer', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    writeText.mockReset().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText } })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  test('shows Copy once it can copy', async () => {
    const { copy } = await mountViewer()

    expect(copy.parentElement?.hidden).toBe(false)
  })

  test('leaves Copy hidden where there is no clipboard', async () => {
    vi.stubGlobal('navigator', {})

    const { copy } = await mountViewer()

    expect(copy.parentElement?.hidden).toBe(true)
  })

  test('copies the whole document as it is printed, folded parts too', async () => {
    const { copy } = await mountViewer()

    copy.click()
    await vi.advanceTimersByTimeAsync(0)

    expect(writeText).toHaveBeenCalledWith(JSON.stringify(value, null, 2))
  })

  test('says it copied, out loud once and on the button until the operator moves on', async () => {
    const { copy, status } = await mountViewer()

    copy.focus()
    copy.click()
    await vi.advanceTimersByTimeAsync(0)

    expect(status.textContent).toBe('Copied')
    expect(status.getAttribute('aria-live')).toBe('polite')
    expect(copy.textContent).toBe('Copied payload')

    await vi.advanceTimersByTimeAsync(5000)

    expect(status.textContent).toBe('')
    expect(copy.textContent).toBe('Copied payload')

    copy.blur()

    expect(copy.textContent).toBe('Copy payload')
  })

  test('says so when the copy is refused', async () => {
    writeText.mockRejectedValueOnce(new Error('denied'))
    const { copy, status } = await mountViewer()

    copy.click()
    await vi.advanceTimersByTimeAsync(0)

    expect(status.textContent).toBe("Couldn't copy")
    expect(copy.textContent).toBe("Couldn't copy payload")
  })
})
