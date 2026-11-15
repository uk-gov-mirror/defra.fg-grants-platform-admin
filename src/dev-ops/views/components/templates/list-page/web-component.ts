export class GpaListPage extends HTMLElement {
  #observer: ResizeObserver | null = null;

  connectedCallback() {
    const page = this.querySelector<HTMLElement>(":scope > .gpa-listpage");
    const top = page?.querySelector<HTMLElement>(":scope > .gpa-listpage-top");
    if (!page || !top || this.#observer) return;
    const set = () =>
      page.style.setProperty("--gpa-list-top", `${top.offsetHeight}px`);
    set();
    if (typeof ResizeObserver === "undefined") return;
    this.#observer = new ResizeObserver(set);
    this.#observer.observe(top);
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
  }
}
