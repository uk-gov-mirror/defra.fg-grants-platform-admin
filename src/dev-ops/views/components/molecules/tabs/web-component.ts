export class GpaTabs extends HTMLElement {
  connectedCallback() {
    const tabs = [...this.querySelectorAll<HTMLAnchorElement>('[role="tab"]')];
    const panelOf = (tab: Element) =>
      document.getElementById(tab.getAttribute("aria-controls") ?? "");
    const select = (tab: HTMLAnchorElement, focus = false) => {
      for (const t of tabs) {
        const on = t === tab;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        const panel = panelOf(t);
        if (panel) panel.hidden = !on;
      }
      if (focus) tab.focus();
      this.dispatchEvent(
        new CustomEvent("gpa-change", {
          detail: { id: tab.dataset.id },
          bubbles: true,
        }),
      );
    };
    const current =
      tabs.find((t) => t.getAttribute("aria-selected") === "true") ?? tabs[0];
    if (current) select(current);
    for (const tab of tabs) {
      tab.addEventListener("click", (event) => {
        event.preventDefault();
        if (!tab.hasAttribute("aria-disabled")) select(tab);
      });
      tab.addEventListener("keydown", (event) => {
        const i = tabs.indexOf(tab),
          n = tabs.length;
        const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: n - 1 }[
          event.key
        ];
        if (to === undefined) return;
        event.preventDefault();
        select(tabs[(to + n) % n], true);
      });
    }
  }
}
