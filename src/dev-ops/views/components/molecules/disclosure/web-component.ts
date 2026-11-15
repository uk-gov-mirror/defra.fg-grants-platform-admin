let count = 0;

export class GpaDisclosure extends HTMLElement {
  connectedCallback() {
    const details = this.querySelector<HTMLDetailsElement>(":scope > details");
    if (!details) return;
    const summary = details.querySelector(":scope > summary")!;
    const panel = details.querySelector<HTMLElement>(
      ":scope > .gpa-disclosure-panel",
    )!;
    const show = this.dataset.show ?? summary.textContent?.trim() ?? "";
    const hide = this.dataset.hide ?? show;
    const chevron = summary.querySelector("svg");
    chevron?.setAttribute("class", "gpa-icon gpa-chevron");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gpa-disclosure";
    for (const name of ["data-testid", "title"]) {
      const v = summary.getAttribute(name);
      if (v) button.setAttribute(name, v);
    }
    const label = document.createElement("span");
    button.append(label);
    if (chevron) button.append(chevron);
    panel.id ||= `gpa-disclosure-${++count}`;
    panel.classList.add("is-upgraded");
    button.setAttribute("aria-controls", panel.id);
    const set = (open: boolean) => {
      button.setAttribute("aria-expanded", String(open));
      label.textContent = open ? hide : show;
      panel.hidden = !open;
    };
    set(details.open);
    button.addEventListener("click", () => {
      const open = button.getAttribute("aria-expanded") !== "true";
      set(open);
      this.dispatchEvent(
        new CustomEvent("gpa-toggle", { detail: { open }, bubbles: true }),
      );
    });
    details.replaceWith(button, panel);
  }
}
