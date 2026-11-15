export class GpaDataTable extends HTMLElement {
  connectedCallback() {
    const scroll = this.querySelector<HTMLElement>(".gpa-table-scroll");
    if (!scroll) return;
    const cols = this.dataset.cols;
    if (cols) {
      scroll.style.setProperty("--gpa-cols", cols);
      const narrow = cols
        .split(/\s+(?![^(]*\))/)
        .map((t) =>
          /^var\(--size-column-(check|chevron)\)$/.test(t) ? t : "auto",
        )
        .join(" ");
      scroll.style.setProperty("--gpa-cols-narrow", narrow);
    }
    if (this.hasAttribute("data-sticky")) {
      for (const row of scroll.querySelectorAll("tbody .gpa-tr")) {
        const cells = [...row.children].filter(
          (c) => !c.classList.contains("gpa-cell-check"),
        );
        cells[0]?.classList.add("gpa-sticky-col");
        if (this.hasAttribute("data-selectable"))
          cells[0]?.classList.add("gpa-sticky-after-check");
        row.querySelector(".gpa-cell-check")?.classList.add("gpa-sticky-col");
      }
    }
    if (
      scroll.classList.contains("is-subgrid") &&
      typeof ResizeObserver !== "undefined"
    ) {
      const check = () =>
        scroll.classList.toggle(
          "is-fitting",
          scroll.scrollWidth <= scroll.clientWidth + 1,
        );
      const ro = new ResizeObserver(check);
      ro.observe(scroll);
      const head = scroll.querySelector(".gpa-thead");
      if (head) ro.observe(head);
      check();
    }
    this.addEventListener("mouseover", (event) => {
      const link = (event.target as Element).closest<HTMLElement>(
        ".gpa-rowlink",
      );
      if (!link) return;
      if (link.scrollWidth > link.clientWidth + 1)
        link.title ||= link.textContent?.trim() ?? "";
    });
    if (this.hasAttribute("data-selectable")) this.#selection();
  }

  #selection() {
    const all = this.querySelector<HTMLInputElement>("input[data-gpa-all]");
    const rows = () => [
      ...this.querySelectorAll<HTMLInputElement>("input[data-gpa-row]"),
    ];
    const bar = this.querySelector<HTMLElement>(".gpa-bulkbar");
    const sync = () => {
      const boxes = rows();
      const on = boxes.filter((b) => b.checked);
      for (const b of boxes) {
        const tr = b.closest("tr");
        tr?.classList.toggle("is-selected", b.checked);
        tr?.setAttribute("aria-selected", String(b.checked));
      }
      if (all) {
        all.checked = boxes.length > 0 && on.length === boxes.length;
        all.indeterminate = on.length > 0 && on.length < boxes.length;
        all.disabled = boxes.length === 0;
        const tick = all.parentElement?.querySelector("svg");
        if (tick) tick.style.display = "";
      }
      if (bar) {
        bar.hidden = on.length === 0;
        const text = `${on.length} selected`;
        bar.setAttribute("aria-label", text);
        const count = bar.querySelector(".gpa-bulkbar-count");
        if (count) count.textContent = text;
      }
      this.dispatchEvent(
        new CustomEvent("gpa-selection", {
          detail: { ids: on.map((b) => b.value) },
          bubbles: true,
        }),
      );
    };
    this.addEventListener("change", (event) => {
      const t = event.target as HTMLInputElement;
      if (t === all) for (const b of rows()) b.checked = all.checked;
      if (t === all || t.hasAttribute("data-gpa-row")) sync();
    });
    bar?.querySelector("[data-gpa-clear]")?.addEventListener("click", () => {
      for (const b of rows()) b.checked = false;
      sync();
    });
    sync();
  }
}
