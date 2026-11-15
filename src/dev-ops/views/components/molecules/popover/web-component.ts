import { Popover } from "../../core/popover.ts";

export class GpaPopover extends HTMLElement {
  connectedCallback() {
    const host = this.querySelector<HTMLElement>(":scope > .gpa-dropdown");
    const trigger = host?.querySelector<HTMLElement>(
      ":scope > [popovertarget]",
    );
    const native = host?.querySelector<HTMLElement>(":scope > [popover]");
    if (!host || !trigger || !native) return;
    trigger.removeAttribute("popovertarget");
    native.remove();
    const content = [...native.childNodes];
    const pop = new Popover(host, trigger, {
      label: native.getAttribute("aria-label") ?? "",
      align: this.dataset.align === "end" ? "end" : "start",
      padded: native.classList.contains("gpa-popover-padded"),
      build: (panel) => panel.append(...content),
    });
    for (const c of native.classList)
      if (!["gpa-float", "gpa-popover", "gpa-popover-padded"].includes(c))
        pop.panel.classList.add(c);
    if (native.dataset.testid) pop.panel.dataset.testid = native.dataset.testid;
  }
}
