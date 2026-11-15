import { CalendarView } from "../../core/calendar.ts";
import { el } from "../../core/dom.ts";
import { Popover } from "../../core/popover.ts";

export class GpaDateRangeChip extends HTMLElement {
  connectedCallback() {
    const trigger = this.querySelector<HTMLButtonElement>(
      ":scope > .gpa-dropdown > .gpa-chip",
    );
    const native = this.querySelector<HTMLElement>(
      ":scope > .gpa-dropdown > [popover]",
    );
    if (!trigger || !native || this.dataset.gpaUp != null) return;
    this.dataset.gpaUp = "";
    const label = native.getAttribute("aria-label") ?? "";
    const presetsFrom = [
      ...native.querySelectorAll<HTMLElement>(".gpa-range-presets > *"),
    ];
    const startInput = native.querySelector<HTMLInputElement>(
      'input[data-gpa-range="start"]',
    );
    const endInput = native.querySelector<HTMLInputElement>(
      'input[data-gpa-range="end"]',
    );
    const hint = this.dataset.hint || "";
    const host = trigger.parentElement as HTMLElement;
    const value = {
      start: startInput?.value || null,
      end: endInput?.value || null,
    };
    let form: HTMLFormElement | null = startInput?.form ?? null;
    for (const i of [startInput, endInput]) if (i) i.type = "hidden";
    if (form && native.contains(form)) {
      form.hidden = true;
      for (const i of [startInput, endInput]) if (i) form.append(i);
      for (const x of form.querySelectorAll("button, .gpa-range-native-label"))
        x.remove();
      this.append(form);
    } else {
      for (const i of [startInput, endInput]) if (i) this.append(i);
      form = startInput?.form ?? null;
    }
    native.remove();
    trigger.removeAttribute("popovertarget");

    let draft: { start: string | null; end: string | null } | null = null;
    const finish = (detail: Record<string, unknown>, go: () => void) => {
      const ev = new CustomEvent("gpa-change", {
        bubbles: true,
        cancelable: true,
        detail,
      });
      if (this.dispatchEvent(ev)) go();
    };
    new Popover(host, trigger, {
      label,
      onOpenChange: () => (draft = null),
      build: (panel, close) => {
        const presets = el("div", {
          className: "gpa-range-presets",
          role: "group",
          "aria-label": "Quick ranges",
        });
        for (const src of presetsFrom) {
          const on =
            src.getAttribute("aria-pressed") === "true" ||
            src.getAttribute("aria-current") === "true";
          const btn = el(
            "button",
            {
              type: "button",
              className: `gpa-btn gpa-btn-${on ? "secondary" : "tertiary"} gpa-btn-sm`,
              "aria-pressed": String(on),
            },
            el("span", {}, src.textContent ?? ""),
          );
          btn.addEventListener("click", () => {
            close();
            const href = src.getAttribute("href");
            const btnSrc = src as HTMLButtonElement;
            finish({ preset: src.textContent }, () => {
              if (href) location.assign(href);
              else if (btnSrc.form) btnSrc.form.requestSubmit(btnSrc);
            });
          });
          presets.append(btn);
        }
        const hintEl = hint
          ? el("p", { className: "gpa-range-hint" }, hint)
          : null;
        const live = el("span", { "aria-live": "polite", className: "gpa-vh" });
        const cur = () => draft ?? value;
        const cal: CalendarView = new CalendarView(this, {
          rangeStart: cur().start,
          rangeEnd: cur().end,
          min: this.dataset.min,
          max: this.dataset.max,
          onSelect: (d) => {
            if (!draft || !draft.start || draft.end) {
              draft = { start: d, end: null };
              live.textContent = "Now pick the last day.";
              cal.update({ rangeStart: d, rangeEnd: null });
              return;
            }
            let [a, b] = [draft.start, d];
            if (b < a) [a, b] = [b, a];
            draft = null;
            close();
            finish({ start: a, end: b }, () => {
              if (startInput) startInput.value = a;
              if (endInput) endInput.value = b;
              form?.requestSubmit();
            });
          },
        });
        panel.append(
          el(
            "div",
            { className: "gpa-range" },
            presets,
            el(
              "div",
              { className: "gpa-range-cal" },
              cal.element,
              hintEl,
              live,
            ),
          ),
        );
      },
    });
  }
}
