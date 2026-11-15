// @vitest-environment happy-dom

import { mount } from '../../../test-utils.ts'
import { Modal } from './modal.element.ts'

const form = `
  <form method="post" action="/x">
    <input type="hidden" name="hint" value="x7Qa">
    <input type="text" name="confirm" data-testid="field">
    <button type="button" data-modal-close data-testid="cancel">Cancel</button>
    <button type="submit" data-testid="submit">Revoke token</button>
  </form>`

const mountDialog = async (params: object = {}, block = form) => {
  const body = await mount(
    'token-dialog',
    { id: 'revoke', title: 'Revoke token', ...params },
    block
  )
  const opener = document.createElement('button')

  opener.dataset.modalOpen = 'revoke'
  opener.dataset.testid = 'opener'
  body.prepend(opener)

  return {
    body,
    opener,
    dialog: body.querySelector<HTMLDialogElement>('dialog')!,
    field: body.querySelector<HTMLInputElement>('[data-testid="field"]')!
  }
}

describe('do-modal', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
  })

  test('registers the custom element', async () => {
    await mountDialog()

    expect(customElements.get('do-modal')).toBe(Modal)
  })

  test('opens from the button that names it, moving focus to the first field', async () => {
    const { opener, dialog, field } = await mountDialog()

    opener.click()

    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(field)
  })

  test('closes on Cancel, handing focus back to the button that opened it', async () => {
    const { body, opener, dialog } = await mountDialog()

    opener.focus()
    opener.click()
    body.querySelector<HTMLElement>('[data-testid="cancel"]')!.click()

    expect(dialog.open).toBe(false)
    expect(document.activeElement).toBe(opener)
  })

  test('opens on arrival, with focus on what was wrong', async () => {
    const { dialog, body } = await mountDialog(
      { open: true },
      form.replace(
        'data-testid="field"',
        'aria-invalid="true" data-testid="error"'
      )
    )

    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(
      body.querySelector('[data-testid="error"]')
    )
  })

  test('starts a locked dialog at its heading, and keeps it open on Escape', async () => {
    const { dialog } = await mountDialog({ open: true, locked: true })
    const cancel = new Event('cancel', { cancelable: true })

    dialog.dispatchEvent(cancel)

    expect(document.activeElement).toBe(dialog.querySelector('h2'))
    expect(cancel.defaultPrevented).toBe(true)
  })

  test('lets an unlocked dialog close on Escape', async () => {
    const { dialog } = await mountDialog({ open: true })
    const cancel = new Event('cancel', { cancelable: true })

    dialog.dispatchEvent(cancel)

    expect(cancel.defaultPrevented).toBe(false)
  })

  test('disables the button that submitted, so one click is one write', async () => {
    const { dialog, body } = await mountDialog({ open: true })
    const submit = body.querySelector<HTMLButtonElement>(
      '[data-testid="submit"]'
    )!
    const event = new Event('submit', { cancelable: true }) as SubmitEvent

    Object.defineProperty(event, 'submitter', { value: submit })
    dialog
      .querySelector('form')!
      .addEventListener('submit', (e) => e.preventDefault())
    dialog.querySelector('form')!.dispatchEvent(event)

    expect(submit.disabled).toBe(true)
  })

  test('holds the submit while a field inside says it is not ready', async () => {
    const { opener, body } = await mountDialog(
      {},
      form.replace(
        '<input type="text" name="confirm" data-testid="field">',
        '<span data-invalid data-testid="gate"></span><input type="text" name="confirm" data-testid="field">'
      )
    )
    const submit = body.querySelector<HTMLButtonElement>(
      '[data-testid="submit"]'
    )!

    opener.click()
    await new Promise((resolve) => requestAnimationFrame(resolve))
    expect(submit.disabled).toBe(true)

    body.querySelector('[data-testid="gate"]')!.removeAttribute('data-invalid')
    body
      .querySelector('[data-testid="field"]')!
      .dispatchEvent(new Event('input', { bubbles: true }))
    expect(submit.disabled).toBe(false)
  })

  test('starts afresh when opened from its button, after coming back with errors', async () => {
    const { opener, dialog, body } = await mountDialog(
      { open: true, formError: 'Not issued.' },
      `<form method="post" action="/x">
        <input type="text" name="clientId" value="Bad" aria-invalid="true" data-reset-value="" data-testid="field">
        <p data-reset-remove data-testid="field-error">Use lowercase letters, digits and hyphens only.</p>
        <label><input type="radio" name="expiry" value="30" checked data-testid="thirty"> 30 days</label>
        <label><input type="radio" name="expiry" value="90" data-reset-checked data-testid="ninety"> 90 days</label>
        <button type="submit" data-testid="submit">Create token</button>
      </form>`
    )

    dialog.close()
    opener.click()

    expect(dialog.open).toBe(true)
    const field = body.querySelector<HTMLInputElement>('[data-testid="field"]')!

    expect(field.value).toBe('')
    expect(field.hasAttribute('aria-invalid')).toBe(false)
    expect(body.querySelector('[data-testid="field-error"]')).toBeNull()
    expect(body.querySelector('[data-modal-error]')).toBeNull()
    expect(
      body.querySelector<HTMLInputElement>('[data-testid="ninety"]')!.checked
    ).toBe(true)
    expect(
      body.querySelector<HTMLInputElement>('[data-testid="thirty"]')!.checked
    ).toBe(false)
  })

  test('keeps what came back when it opens on arrival, with focus on the refusal', async () => {
    const { dialog, body } = await mountDialog({
      open: true,
      formError: 'Not revoked — this token is no longer active.'
    })

    expect(dialog.open).toBe(true)
    expect(document.activeElement).toBe(
      body.querySelector('[data-modal-error]')
    )
  })

  test('ignores a button that names another dialog', async () => {
    const { body, dialog } = await mountDialog()
    const other = document.createElement('button')

    other.dataset.modalOpen = 'delete'
    body.append(other)
    other.click()

    expect(dialog.open).toBe(false)
  })
})
