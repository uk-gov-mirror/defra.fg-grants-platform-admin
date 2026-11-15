import { addDays, fromISO, locale, toISO, today, weekStart } from "./dates.ts";
import { el, icon, iconButton } from "./dom.ts";

export interface CalendarOptions {
  value?: string | null;
  rangeStart?: string | null;
  rangeEnd?: string | null;
  min?: string | null;
  max?: string | null;
  onSelect?: (iso: string) => void;
}

export class CalendarView {
  element = el("div", { className: "gpa-calendar" });
  #root: ParentNode;
  #o: CalendarOptions;
  #month: Date;
  #focus: string;
  #hover: string | null = null;
  #view: "days" | "months" = "days";
  #drawn = "";
  #focusNext = false;

  constructor(root: ParentNode, o: CalendarOptions) {
    this.#root = root;
    this.#o = o;
    const sel = o.value || o.rangeStart || null;
    const d = fromISO(sel) ?? new Date();
    this.#month = new Date(d.getFullYear(), d.getMonth(), 1);
    this.#focus = sel || today();
    this.render();
  }

  update(o: Partial<CalendarOptions>) {
    this.#o = { ...this.#o, ...o };
    this.render();
  }

  #out = (s: string) =>
    Boolean(
      (this.#o.min && s < this.#o.min) || (this.#o.max && s > this.#o.max),
    );

  #moveTo(s: string) {
    const d = fromISO(s)!;
    this.#focus = s;
    this.#focusNext = true;
    if (
      d.getMonth() !== this.#month.getMonth() ||
      d.getFullYear() !== this.#month.getFullYear()
    )
      this.#month = new Date(d.getFullYear(), d.getMonth(), 1);
    this.render();
  }

  #key = (e: KeyboardEvent) => {
    const d = fromISO(this.#focus)!;
    const ws = (d.getDay() - weekStart + 7) % 7;
    const k = e.key;
    let n: Date | null = null;
    if (k === "ArrowLeft") n = addDays(d, -1);
    else if (k === "ArrowRight") n = addDays(d, 1);
    else if (k === "ArrowUp") n = addDays(d, -7);
    else if (k === "ArrowDown") n = addDays(d, 7);
    else if (k === "PageUp")
      n = new Date(
        d.getFullYear(),
        d.getMonth() - 1,
        Math.min(d.getDate(), 28),
      );
    else if (k === "PageDown")
      n = new Date(
        d.getFullYear(),
        d.getMonth() + 1,
        Math.min(d.getDate(), 28),
      );
    else if (k === "Home") n = addDays(d, -ws);
    else if (k === "End") n = addDays(d, 6 - ws);
    if (n) {
      e.preventDefault();
      this.#moveTo(toISO(n));
    }
  };

  #start() {
    const first = new Date(this.#month);
    const lead = (first.getDay() - weekStart + 7) % 7;
    const weeks = Math.ceil(
      (lead +
        new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()) /
        7,
    );
    return addDays(first, -lead - 7 * Math.floor((6 - weeks) / 2));
  }

  render() {
    const key = `${this.#view}:${this.#month.getFullYear()}-${this.#month.getMonth()}`;
    if (key !== this.#drawn) {
      this.#drawn = key;
      const headButtons = () => [
        ...this.element.querySelectorAll<HTMLElement>(
          ".gpa-calendar-head > button",
        ),
      ];
      const at = headButtons().indexOf(document.activeElement as HTMLElement);
      this.element.replaceChildren(
        ...(this.#view === "months" ? this.#drawMonths() : this.#drawDays()),
      );
      if (at >= 0) headButtons()[at]?.focus();
    }
    if (this.#view === "days") this.#patchDays();
    if (this.#focusNext) {
      this.#focusNext = false;
      this.element
        .querySelector<HTMLElement>(`[data-date="${this.#focus}"]`)
        ?.focus();
    }
  }

  #head(
    prev: string,
    next: string,
    onPrev: () => void,
    onNext: () => void,
    title: HTMLElement,
  ) {
    const a = iconButton(this.#root, "chevron-left", prev, {
      size: "sm",
      className: "gpa-dir-icon",
    });
    const b = iconButton(this.#root, "chevron-right", next, {
      size: "sm",
      className: "gpa-dir-icon",
    });
    a.addEventListener("click", onPrev);
    b.addEventListener("click", onNext);
    return el("div", { className: "gpa-calendar-head" }, a, title, b);
  }

  #drawMonths(): Node[] {
    const yr = this.#month.getFullYear();
    const title = el(
      "button",
      {
        type: "button",
        className: "gpa-calendar-title gpa-calendar-switch",
        "aria-live": "polite",
      },
      String(yr),
    );
    title.addEventListener("click", () => {
      this.#view = "days";
      this.render();
    });
    const go = (y: number) => () => {
      this.#month = new Date(y, this.#month.getMonth(), 1);
      this.render();
    };
    const grid = el("div", {
      className: "gpa-calendar-months",
      role: "group",
      "aria-label": "Choose month",
    });
    for (let m = 0; m < 12; m++) {
      const d = new Date(yr, m, 1);
      const cur = m === this.#month.getMonth();
      const b = el(
        "button",
        {
          type: "button",
          className: `gpa-day gpa-month${cur ? " is-selected" : ""}`,
          "aria-pressed": String(cur),
        },
        d.toLocaleDateString(locale, { month: "short" }),
      );
      b.addEventListener("click", () => {
        this.#month = d;
        this.#view = "days";
        this.#focus = toISO(d);
        this.#focusNext = true;
        this.render();
      });
      grid.append(b);
    }
    return [
      this.#head("Previous year", "Next year", go(yr - 1), go(yr + 1), title),
      grid,
    ];
  }

  #drawDays(): Node[] {
    const month = this.#month;
    const title = month.toLocaleDateString(locale, {
      month: "long",
      year: "numeric",
    });
    const sw = el(
      "button",
      {
        type: "button",
        className: "gpa-calendar-title gpa-calendar-switch",
        "aria-live": "polite",
        "aria-label": `${title} — Choose month`,
      },
      title,
      icon(this.#root, "chevron-down", "xs"),
    );
    sw.addEventListener("click", () => {
      this.#view = "months";
      this.render();
    });
    const step = (k: number) => () => {
      this.#month = new Date(month.getFullYear(), month.getMonth() + k, 1);
      this.render();
    };
    const start = this.#start();
    const grid = el("div", {
      role: "grid",
      "aria-label": title,
      className: "gpa-calendar-grid",
    });
    grid.addEventListener("keydown", this.#key);
    grid.addEventListener("mouseleave", () => {
      this.#hover = null;
      this.render();
    });
    const wd = el("div", { role: "row", className: "gpa-calendar-row" });
    for (let w = 0; w < 7; w++) {
      const d = addDays(start, w);
      wd.append(
        el(
          "span",
          {
            role: "columnheader",
            className: "gpa-calendar-wd",
            "aria-label": d.toLocaleDateString(locale, { weekday: "long" }),
          },
          d.toLocaleDateString(locale, { weekday: "narrow" }),
        ),
      );
    }
    grid.append(wd);
    for (let r = 0; r < 6; r++) {
      const row = el("div", { role: "row", className: "gpa-calendar-row" });
      for (let c = 0; c < 7; c++) {
        const d = addDays(start, r * 7 + c);
        const s = toISO(d);
        const b = el(
          "button",
          {
            type: "button",
            "data-date": s,
            "aria-label": d.toLocaleDateString(locale, {
              weekday: "long",
              day: "numeric",
              month: "long",
              year: "numeric",
            }),
          },
          String(d.getDate()),
        );
        b.addEventListener("click", () => {
          this.#focus = s;
          this.render();
          this.#o.onSelect?.(s);
        });
        b.addEventListener("mouseenter", () => {
          if (this.#o.rangeStart && !this.#o.rangeEnd) {
            this.#hover = s;
            this.render();
          }
        });
        row.append(el("span", { role: "gridcell" }, b));
      }
      grid.append(row);
    }
    return [
      this.#head("Previous month", "Next month", step(-1), step(1), sw),
      grid,
    ];
  }

  #patchDays() {
    const o = this.#o;
    const now = today();
    let rs = o.rangeStart ?? null;
    let re = o.rangeEnd || (o.rangeStart && !o.rangeEnd ? this.#hover : null);
    if (rs && re && re < rs) [rs, re] = [re, rs];
    for (const b of this.element.querySelectorAll<HTMLButtonElement>(
      "button[data-date]",
    )) {
      const s = b.dataset.date!;
      const other = fromISO(s)!.getMonth() !== this.#month.getMonth();
      const sel = s === o.value || s === rs || s === re;
      const inR = Boolean(rs && re && s > rs && s < re);
      b.className = [
        "gpa-day",
        other && "is-other",
        sel && "is-selected",
        inR && "is-inrange",
        s === rs && "is-start",
        s === re && "is-end",
        s === now && "is-today",
      ]
        .filter(Boolean)
        .join(" ");
      b.tabIndex = s === this.#focus ? 0 : -1;
      b.toggleAttribute("data-autofocus", s === this.#focus);
      b.disabled = this.#out(s);
      if (s === now) b.setAttribute("aria-current", "date");
      else b.removeAttribute("aria-current");
      const cell = b.parentElement!;
      if (sel) cell.setAttribute("aria-selected", "true");
      else cell.removeAttribute("aria-selected");
    }
  }
}
