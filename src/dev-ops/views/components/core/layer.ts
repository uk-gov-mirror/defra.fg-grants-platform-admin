import { place, type Placement } from "./floating.ts";

export class Layer {
  panel: HTMLElement;
  #anchor: Element;
  #placement: Placement & { matchWidth?: boolean };
  #onAway: (event: Event) => void;
  #replace = () => this.place();

  constructor(
    anchor: Element,
    panel: HTMLElement,
    placement: Placement & { matchWidth?: boolean },
    onAway: () => void,
  ) {
    this.#anchor = anchor;
    this.panel = panel;
    this.#placement = placement;
    this.#onAway = (event: Event) => {
      const t = event.target as Node;
      if (!anchor.contains(t) && !panel.contains(t)) onAway();
    };
  }

  get open() {
    return this.panel.isConnected;
  }

  show() {
    const host = this.#anchor.closest("dialog[open]") ?? document.body;
    if ("showPopover" in this.panel)
      this.panel.setAttribute("popover", "manual");
    host.appendChild(this.panel);
    try {
      this.panel.showPopover?.();
    } catch {}
    this.place();
    document.addEventListener("mousedown", this.#onAway);
    window.addEventListener("scroll", this.#replace, true);
    window.addEventListener("resize", this.#replace);
  }

  place() {
    if (this.#placement.matchWidth)
      this.panel.style.minWidth = `${Math.round(this.#anchor.getBoundingClientRect().width)}px`;
    place(this.#anchor, this.panel, this.#placement);
  }

  hide() {
    document.removeEventListener("mousedown", this.#onAway);
    window.removeEventListener("scroll", this.#replace, true);
    window.removeEventListener("resize", this.#replace);
    this.panel.remove();
  }
}

export const svg = (
  root: ParentNode,
  name: string,
  size: number,
  cls = "gpa-icon",
): SVGElement | null => {
  let source: SVGElement | null = null;
  for (const t of root.querySelectorAll<HTMLTemplateElement>(
    "template[data-gpa-icons]",
  )) {
    source = t.content.querySelector<SVGElement>(`svg[data-icon="${name}"]`);
    if (source) break;
  }
  if (!source) return null;
  const copy = source.cloneNode(true) as SVGElement;
  copy.removeAttribute("data-gpa-icon");
  copy.setAttribute("width", String(size));
  copy.setAttribute("height", String(size));
  copy.setAttribute("class", cls);
  copy.setAttribute("aria-hidden", "true");
  return copy;
};
