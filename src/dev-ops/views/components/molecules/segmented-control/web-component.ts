export class GpaSegmented extends HTMLElement {
  connectedCallback() {
    const group = this.querySelector<HTMLElement>('[role="radiogroup"]');
    const buttons = [
      ...this.querySelectorAll<HTMLButtonElement>('button[role="radio"]'),
    ];
    if (!group || !buttons.length || group.dataset.gpaUp != null) return;
    group.dataset.gpaUp = "";
    let hidden: HTMLInputElement | null = null;
    const name = this.dataset.name;
    if (name) {
      hidden = document.createElement("input");
      hidden.type = "hidden";
      hidden.name = name;
      const form = buttons[0].getAttribute("form");
      if (form) hidden.setAttribute("form", form);
      hidden.value =
        buttons.find((b) => b.getAttribute("aria-checked") === "true")?.dataset
          .value ?? "";
      this.append(hidden);
    }
    for (const b of buttons) {
      b.type = "button";
      b.removeAttribute("name");
      b.addEventListener("click", () => {
        if (b.getAttribute("aria-checked") === "true") return;
        for (const x of buttons)
          x.setAttribute("aria-checked", String(x === b));
        const value = b.dataset.value ?? "";
        if (hidden) {
          hidden.value = value;
          hidden.dispatchEvent(new Event("change", { bubbles: true }));
        }
        this.dispatchEvent(
          new CustomEvent("gpa-change", { bubbles: true, detail: { value } }),
        );
      });
    }
  }
}
