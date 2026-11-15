import { FOCUSABLE, el } from "./dom.ts";
import { Layer } from "./layer.ts";

let count = 0;

export class Popover {
  panel: HTMLElement;
  #host: HTMLElement;
  #trigger: HTMLElement;
  #layer: Layer;
  #build: (panel: HTMLElement, close: () => void) => void;
  #onChange?: (open: boolean) => void;

  constructor(
    host: HTMLElement,
    trigger: HTMLElement,
    o: {
      label: string;
      align?: "start" | "end";
      padded?: boolean;
      build: (panel: HTMLElement, close: () => void) => void;
      onOpenChange?: (open: boolean) => void;
    },
  ) {
    this.#host = host;
    this.#trigger = trigger;
    this.#build = o.build;
    this.#onChange = o.onOpenChange;
    this.panel = el("div", {
      id: `gpa-pop-${++count}`,
      role: "dialog",
      "aria-label": o.label,
      tabindex: -1,
      className: `gpa-float gpa-popover${o.padded === false ? "" : " gpa-popover-padded"}`,
    });
    this.#layer = new Layer(
      host,
      this.panel,
      { side: "bottom", align: o.align ?? "start", gap: 6 },
      () => this.close(),
    );
    trigger.setAttribute("aria-haspopup", "dialog");
    trigger.setAttribute("aria-expanded", "false");
    trigger.addEventListener("click", () =>
      this.open ? this.close() : this.show(true),
    );
    this.panel.addEventListener("keydown", this.#onKey);
  }

  get open() {
    return this.#layer.open;
  }

  show(byUser = false) {
    this.panel.replaceChildren();
    this.#build(this.panel, () => this.close(true));
    this.#layer.show();
    this.#trigger.setAttribute("aria-expanded", "true");
    this.#trigger.setAttribute("aria-controls", this.panel.id);
    if (byUser)
      (
        this.panel.querySelector<HTMLElement>("[data-autofocus]") ??
        this.panel.querySelector<HTMLElement>(FOCUSABLE) ??
        this.panel
      ).focus({ preventScroll: true });
    this.#onChange?.(true);
  }

  place() {
    this.#layer.place();
  }

  close(refocus = false) {
    if (!this.open) return;
    this.#layer.hide();
    this.#trigger.setAttribute("aria-expanded", "false");
    this.#trigger.removeAttribute("aria-controls");
    if (refocus)
      this.#host
        .querySelector<HTMLElement>(FOCUSABLE)
        ?.focus({ preventScroll: true });
    this.#onChange?.(false);
  }

  #onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      this.close(true);
      return;
    }
    if (e.key === "Tab") {
      const list = [...this.panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const a = list[0];
      const z = list[list.length - 1];
      const at = document.activeElement;
      if (
        !list.length ||
        (!e.shiftKey && at === z) ||
        (e.shiftKey && (at === a || at === this.panel))
      ) {
        e.preventDefault();
        this.close(true);
      }
    }
  };
}
