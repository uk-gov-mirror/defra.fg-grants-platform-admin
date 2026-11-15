import { place } from "../../core/floating.ts";

let count = 0;

export class GpaTooltip extends HTMLElement {
  #tip: HTMLElement | null = null;
  #timer = 0;

  connectedCallback() {
    const show = () => this.show();
    this.addEventListener("pointerenter", () => {
      window.clearTimeout(this.#timer);
      this.#timer = window.setTimeout(show, 300);
    });
    this.addEventListener("pointerleave", () => this.hide());
    this.addEventListener("pointerdown", () => this.hide());
    this.addEventListener("focusin", (event) => {
      const target = event.target as Element;
      try {
        if (target.matches(":focus-visible")) show();
      } catch {
        show();
      }
    });
    this.addEventListener("focusout", () => this.hide());
  }

  disconnectedCallback() {
    this.hide();
  }

  get trigger(): HTMLElement | null {
    return (
      this.querySelector<HTMLElement>(
        ".gpa-tooltip-trigger, button, a, [tabindex], input, select, textarea",
      ) ?? (this.firstElementChild as HTMLElement | null)
    );
  }

  show() {
    window.clearTimeout(this.#timer);
    const text = this.getAttribute("text");
    const trigger = this.trigger;
    if (!text || !trigger || this.#tip) return;
    const tip = document.createElement("span");
    tip.className = "gpa-tooltip gpa-float";
    tip.setAttribute("role", "tooltip");
    tip.id = `gpa-tip-${++count}`;
    tip.textContent = text;
    if ("showPopover" in tip) tip.setAttribute("popover", "manual");
    const host = this.closest("dialog[open]") ?? document.body;
    host.appendChild(tip);
    try {
      tip.showPopover?.();
    } catch {}
    place(trigger, tip, {
      side: (this.getAttribute("side") as "top" | "bottom") ?? "top",
      align: "center",
      gap: 6,
    });
    if (!trigger.hasAttribute("aria-describedby")) {
      trigger.setAttribute("aria-describedby", tip.id);
      tip.dataset.described = "";
    }
    this.#tip = tip;
    document.addEventListener("keydown", this.#onKey, true);
  }

  hide() {
    window.clearTimeout(this.#timer);
    document.removeEventListener("keydown", this.#onKey, true);
    if (!this.#tip) return;
    if (this.#tip.dataset.described != null)
      this.trigger?.removeAttribute("aria-describedby");
    this.#tip.remove();
    this.#tip = null;
  }

  #onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") this.hide();
  };
}
