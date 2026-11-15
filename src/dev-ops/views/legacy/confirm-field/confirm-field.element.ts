/** Holds its dialog's submit until exactly `data-expected` is typed, as the server then checks again. */
export class ConfirmField extends HTMLElement {
  #enhanced = false

  connectedCallback() {
    queueMicrotask(() => this.enhance())
  }

  enhance() {
    const input = this.querySelector('input')

    if (this.#enhanced || !input) {
      return
    }
    this.#enhanced = true

    const update = () =>
      this.toggleAttribute(
        'data-invalid',
        input.value.trim() !== this.dataset.expected
      )

    input.addEventListener('input', update)
    update()
  }
}
