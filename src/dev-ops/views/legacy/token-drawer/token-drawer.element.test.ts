// @vitest-environment happy-dom

import { TokenDrawer } from './token-drawer.element.ts'

const panel = (id: string) => `
  <section data-token-panel="${id}" hidden>
    <h2 tabindex="-1" data-drawer-heading data-testid="heading-${id}">Token ${id}</h2>
    <button type="button" data-drawer-close data-testid="close-${id}">Close</button>
    <button type="button" aria-disabled="true" aria-describedby="reason-${id}" data-testid="revoke-${id}">Revoke</button>
    <p id="reason-${id}">Revoking this token would lock its caller out. Rotate instead.</p>
  </section>`

const mountDrawer = async (openToken = '') => {
  await import('../index.ts')
  document.body.innerHTML = `
    <do-token-drawer${openToken ? ` data-open-token="${openToken}"` : ''}>
      <input type="checkbox" data-drawer-toggle>
      <div data-drawer-page>
        <table><tbody>
          <tr data-drawer-row><td data-testid="cell-a">client-a</td><td><button type="button" data-drawer-open="a" data-testid="open-a">Open</button></td></tr>
          <tr data-drawer-row><td data-testid="cell-b">client-b</td><td><button type="button" data-drawer-open="b" data-testid="open-b">Open</button></td></tr>
        </tbody></table>
      </div>
      <div>${panel('a')}${panel('b')}</div>
    </do-token-drawer>`
  await Promise.resolve()

  const get = (testId: string) =>
    document.querySelector<HTMLElement>(`[data-testid="${testId}"]`)!

  return {
    get,
    toggle: document.querySelector<HTMLInputElement>('[data-drawer-toggle]')!,
    page: document.querySelector<HTMLElement>('[data-drawer-page]')!,
    panelOf: (id: string) =>
      document.querySelector<HTMLElement>(`[data-token-panel="${id}"]`)!
  }
}

describe('do-token-drawer', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    document.getSelection()?.removeAllRanges()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('registers the custom element', async () => {
    await mountDrawer()

    expect(customElements.get('do-token-drawer')).toBe(TokenDrawer)
  })

  test("opens on a row's token alone, with focus on its heading and the page behind inert", async () => {
    const { get, toggle, page, panelOf } = await mountDrawer()

    get('open-b').click()

    expect(toggle.checked).toBe(true)
    expect(panelOf('b').hidden).toBe(false)
    expect(panelOf('a').hidden).toBe(true)
    expect(page.inert).toBe(true)
    expect(document.activeElement).toBe(get('heading-b'))
  })

  test('opens on a click anywhere on a row, as its button would, and hands focus back to that button', async () => {
    const { get, toggle, panelOf } = await mountDrawer()

    get('cell-b').click()

    expect(toggle.checked).toBe(true)
    expect(panelOf('b').hidden).toBe(false)
    expect(document.activeElement).toBe(get('heading-b'))

    get('close-b').click()

    expect(document.activeElement).toBe(get('open-b'))
  })

  test('leaves a row closed when the click ends a text selection in it', async () => {
    const { get, toggle } = await mountDrawer()

    document.getSelection()!.selectAllChildren(get('cell-a'))
    get('cell-a').click()

    expect(toggle.checked).toBe(false)
  })

  test('gives each row one tab stop, its button, and leaves the row itself out of the tab order', async () => {
    const { get } = await mountDrawer()
    const row = get('cell-a').closest('tr')!

    expect(row.hasAttribute('tabindex')).toBe(false)
    expect([...row.querySelectorAll('button, [href], [tabindex]')]).toEqual([
      get('open-a')
    ])
  })

  test("measures the page's scrollbar gutter as it opens, before the drawer takes it", async () => {
    const { get } = await mountDrawer()
    const root = document.documentElement

    vi.spyOn(root, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, window.innerWidth - 15, 0)
    )
    get('open-a').click()

    expect(root.style.getPropertyValue('--page-gutter')).toBe('15px')
  })

  test('closes on its close button, handing focus back to the row', async () => {
    const { get, toggle, page } = await mountDrawer()

    get('open-a').click()
    get('close-a').click()

    expect(toggle.checked).toBe(false)
    expect(page.inert).toBe(false)
    expect(document.activeElement).toBe(get('open-a'))
  })

  test('closes on Escape', async () => {
    const { get, toggle } = await mountDrawer()

    get('open-a').click()
    get('heading-a').dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )

    expect(toggle.checked).toBe(false)
    expect(document.activeElement).toBe(get('open-a'))
  })

  test('closes on Escape before focus has reached it', async () => {
    const { get, toggle } = await mountDrawer()

    get('open-a').click()
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )

    expect(toggle.checked).toBe(false)
  })

  test('leaves a dialog to close itself on Escape', async () => {
    const { get, toggle } = await mountDrawer()
    const dialog = document.createElement('dialog')

    document.body.append(dialog)
    get('open-a').click()
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
    )

    expect(toggle.checked).toBe(true)
  })

  test('hands focus back when the overlay unticks it', async () => {
    const { get, toggle, page } = await mountDrawer()

    get('open-a').click()
    toggle.checked = false
    toggle.dispatchEvent(new Event('change'))

    expect(page.inert).toBe(false)
    expect(document.activeElement).toBe(get('open-a'))
  })

  test('keeps Tab inside the open panel, round from last to first and back', async () => {
    const { get } = await mountDrawer()

    get('open-a').click()
    get('revoke-a').focus()
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    )
    expect(document.activeElement).toBe(get('close-a'))

    document.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Tab',
        shiftKey: true,
        bubbles: true
      })
    )
    expect(document.activeElement).toBe(get('revoke-a'))
  })

  test('brings Tab back into the panel from anywhere else on the page', async () => {
    const { get } = await mountDrawer()

    get('open-a').click()
    get('open-b').focus()
    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', bubbles: true })
    )

    expect(document.activeElement).toBe(get('close-a'))
  })

  test('keeps the locked Revoke of the token in use focusable, saying why', async () => {
    const { get } = await mountDrawer()

    get('open-a').click()
    get('revoke-a').focus()

    expect(document.activeElement).toBe(get('revoke-a'))
    expect(
      document.getElementById(get('revoke-a').getAttribute('aria-describedby')!)
        ?.textContent
    ).toBe('Revoking this token would lock its caller out. Rotate instead.')
  })

  test('opens on arrival on the token a dialog came back for', async () => {
    const { toggle, panelOf } = await mountDrawer('b')

    expect(toggle.checked).toBe(true)
    expect(panelOf('b').hidden).toBe(false)
  })
})
