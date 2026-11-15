import { el } from "../../core/dom.ts";

export class GpaLoadMore extends HTMLElement {
  #observer: IntersectionObserver | null = null;
  #busy = false;

  connectedCallback() {
    const link = this.querySelector<HTMLAnchorElement>("a[data-gpa-more]");
    const form = this.querySelector<HTMLFormElement>("form");
    if ((!link && !form) || this.dataset.gpaUp != null) return;
    this.dataset.gpaUp = "";
    link?.addEventListener("click", (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button > 0 || !this.#body)
        return;
      e.preventDefault();
      this.load(true);
    });
    form?.addEventListener("submit", (e) => {
      if (!this.#body) return;
      e.preventDefault();
      this.load(true);
    });
    if (
      this.dataset.auto !== "false" &&
      typeof IntersectionObserver !== "undefined"
    ) {
      this.#observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((x) => x.isIntersecting)) this.load(false);
        },
        { rootMargin: "0px 0px 320px 0px" },
      );
      this.#observer.observe(this);
    }
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
  }

  get #href() {
    return (
      this.querySelector<HTMLAnchorElement>("a[data-gpa-more]")?.href ??
      this.querySelector<HTMLFormElement>("form")?.action ??
      this.dataset.href ??
      ""
    );
  }

  #post: URLSearchParams | null = null;

  get #body(): HTMLElement | null {
    return (
      this.closest(".gpa-table")?.querySelector<HTMLElement>(
        "tbody, .gpa-table-body",
      ) ?? null
    );
  }

  #footer(content: (Node | string)[], attrs: Record<string, string> = {}) {
    const foot = this.querySelector<HTMLElement>(".gpa-listfoot");
    if (!foot) return;
    for (const a of ["role", "aria-live"]) foot.removeAttribute(a);
    for (const [k, v] of Object.entries(attrs)) foot.setAttribute(k, v);
    foot.replaceChildren(...content);
  }

  #count(body: HTMLElement, page: Document, theirs: Element) {
    const sel = "[data-load-more-count]";
    const scope = (n: Element) =>
      n.closest(".gpa-listpage") ?? n.closest(".gpa-table");
    const id = this.dataset.countId;
    const mine = id
      ? [document.getElementById(id)].filter(Boolean)
      : [...(scope(body)?.querySelectorAll<HTMLElement>(sel) ?? [])];
    const theirsAll = id
      ? [page.getElementById(id)]
      : [...(scope(theirs)?.querySelectorAll<HTMLElement>(sel) ?? [])];
    mine.forEach((m, i) => {
      const t = (m!.id && page.getElementById(m!.id)) || theirsAll[i];
      if (t)
        m!.replaceChildren(
          ...[...t.childNodes].map((n) => document.importNode(n, true)),
        );
    });
  }

  async load(byHand: boolean) {
    const href = this.#href;
    const body = this.#body;
    if (this.#busy || !href || !body) return;
    this.#busy = true;
    this.dataset.href = href;
    const form = this.querySelector<HTMLFormElement>("form");
    if (form)
      this.#post = new URLSearchParams(
        [...new FormData(form)].map(([k, v]) => [k, String(v)]),
      );
    const noun = this.dataset.noun ?? "records";
    this.#footer(
      [
        el("span", {
          className: "gpa-spinner gpa-spinner-sm",
          "aria-hidden": "true",
        }),
        `Loading more ${noun}…`,
      ],
      { "aria-live": "polite" },
    );
    try {
      const res = await fetch(href, {
        method: this.#post ? "POST" : "GET",
        body: this.#post ?? undefined,
        headers: { Accept: "text/html", "X-Requested-With": "gpa-load-more" },
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(String(res.status));
      const page = new DOMParser().parseFromString(
        (await res.text()).replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, ""),
        "text/html",
      );
      const theirs =
        (body.id && page.getElementById(body.id)) ||
        page.querySelector(".gpa-table tbody, .gpa-table .gpa-table-body");
      if (!theirs) throw new Error("no rows");
      const rows = [...theirs.children].map(
        (r) => document.importNode(r, true) as HTMLElement,
      );
      body.append(...rows);
      this.#count(body, page, theirs);
      const next = theirs
        .closest(".gpa-table")
        ?.querySelector("gpa-load-more, .gpa-listfoot");
      this.#observer?.disconnect();
      this.#busy = false;
      if (next) this.replaceWith(document.importNode(next, true));
      else this.remove();
      if (byHand && rows[0]) {
        const target =
          rows[0].querySelector<HTMLElement>(
            "a[href], button:not([disabled])",
          ) ?? rows[0];
        if (target === rows[0] && !rows[0].hasAttribute("tabindex"))
          rows[0].tabIndex = -1;
        target.focus();
      }
      body.dispatchEvent(
        new CustomEvent("gpa-load", { bubbles: true, detail: { rows } }),
      );
    } catch {
      this.#busy = false;
      const retry = el(
        "button",
        { type: "button", className: "gpa-btn gpa-btn-default gpa-btn-sm" },
        el("span", {}, "Retry"),
      );
      retry.addEventListener("click", () => this.load(true));
      this.#footer(
        [
          el(
            "span",
            { className: "gpa-text-danger" },
            `Couldn’t load more ${noun}.`,
          ),
          retry,
        ],
        { role: "alert" },
      );
    }
  }
}
