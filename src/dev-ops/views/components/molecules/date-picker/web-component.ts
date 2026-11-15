import { formatDate, parseDate, toISO } from "../../core/dates.ts";
import { CalendarView } from "../../core/calendar.ts";
import { button, el, iconButton } from "../../core/dom.ts";
import { Popover } from "../../core/popover.ts";

export class GpaDatePicker extends HTMLElement {
  #input!: HTMLInputElement;
  #hidden: HTMLInputElement | null = null;
  #box!: HTMLElement;
  #value: string | null = null;
  #pop!: Popover;
  #serverInvalid = false;

  get value() {
    return this.#value;
  }

  connectedCallback() {
    if (this.#input) return;
    for (const ssr of this.querySelectorAll(":scope > [data-gpa-ssr]"))
      ssr.remove();
    const input = this.querySelector<HTMLInputElement>(
      ".gpa-datefield-typed input",
    );
    if (!input) return;
    this.#input = input;
    this.#box = input.closest(".gpa-input") as HTMLElement;
    this.#box.removeAttribute("data-gpa-native");
    this.#serverInvalid = this.#box.classList.contains("is-invalid");
    this.#value = input.value || null;
    const min = input.min || this.dataset.min || null;
    const max = input.max || this.dataset.max || null;
    if (input.name) {
      this.#hidden = el("input", {
        type: "hidden",
        name: input.name,
        value: this.#value ?? "",
      });
      if (input.getAttribute("form"))
        this.#hidden.setAttribute("form", input.getAttribute("form")!);
    }
    input.removeAttribute("name");
    input.removeAttribute("min");
    input.removeAttribute("max");
    input.type = "text";
    input.value = formatDate(this.#value);
    input.placeholder = this.dataset.placeholder || "e.g. 4 Feb 2027";
    input.autocomplete = "off";
    input.spellcheck = false;

    const trigger = iconButton(this, "calendar", "Choose a date", {
      size: "xs",
      className: "gpa-datefield-btn",
    });
    trigger.disabled = input.disabled;
    const host = el("div", { className: "gpa-dropdown" }, trigger);
    this.#box.append(host);
    if (this.#hidden) this.#box.append(this.#hidden);

    this.#pop = new Popover(host, trigger, {
      label: "Choose a date",
      align: "end",
      build: (panel, close) => {
        const cal = new CalendarView(this, {
          value: this.#value,
          min,
          max,
          onSelect: (s) => {
            this.#set(s);
            close();
          },
        });
        const todayBtn = button("Today", { variant: "tertiary", size: "sm" });
        todayBtn.addEventListener("click", () => {
          this.#set(toISO(new Date()));
          close();
        });
        const row = el(
          "div",
          { className: "gpa-inline gpa-gap-md gpa-justify-between" },
          todayBtn,
        );
        if (this.hasAttribute("data-clearable") && this.#value) {
          const clear = button("Clear", { variant: "tertiary", size: "sm" });
          clear.addEventListener("click", () => {
            this.#set(null);
            close();
          });
          row.append(clear);
        }
        panel.append(
          el("div", { className: "gpa-stack gpa-gap-md" }, cal.element, row),
        );
      },
    });

    const commit = () => {
      const t = input.value.trim();
      if (!t) {
        if (this.#value != null) this.#set(null);
        this.#bad(false);
        return;
      }
      const iso = parseDate(t);
      if (iso && !((min && iso < min) || (max && iso > max))) {
        if (iso !== this.#value) this.#set(iso);
        else {
          input.value = formatDate(iso);
          this.#bad(false);
        }
      } else this.#bad(true);
    };
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
      else if (e.key === "ArrowDown" && e.altKey) {
        e.preventDefault();
        this.#pop.show();
      }
    });
    if (this.hasAttribute("data-open")) this.#pop.show();
  }

  set(iso: string | null) {
    this.#set(iso);
  }

  #bad(on: boolean) {
    const invalid = on || this.#serverInvalid;
    this.#box.classList.toggle("is-invalid", invalid);
    if (invalid) this.#input.setAttribute("aria-invalid", "true");
    else this.#input.removeAttribute("aria-invalid");
  }

  #set(v: string | null) {
    const changed = v !== this.#value;
    this.#value = v;
    this.#input.value = formatDate(v);
    this.#bad(false);
    if (this.#hidden) this.#hidden.value = v ?? "";
    if (!changed) return;
    this.#hidden?.dispatchEvent(new Event("change", { bubbles: true }));
    this.dispatchEvent(
      new CustomEvent("gpa-change", { bubbles: true, detail: { value: v } }),
    );
  }
}
