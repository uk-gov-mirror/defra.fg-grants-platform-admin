export class GpaConfirm extends HTMLElement {
  connectedCallback() {
    const field = this.querySelector<HTMLInputElement>(
      "input[data-gpa-require]",
    );
    const ok = this.querySelector<HTMLButtonElement>("[data-gpa-confirm]");
    if (!field || !ok || field.dataset.gpaUp != null) return;
    field.dataset.gpaUp = "";
    const want = field.dataset.gpaRequire;
    const sync = () => (ok.disabled = field.value !== want);
    field.addEventListener("input", sync);
    ok.form?.addEventListener("submit", (e) => {
      if (field.value !== want) e.preventDefault();
    });
    sync();
  }
}
