import { CalendarView } from "../../core/calendar.ts";

export class GpaCalendar extends HTMLElement {
  connectedCallback() {
    const input = this.querySelector<HTMLInputElement>('input[type="date"]');
    if (!input || this.querySelector(".gpa-calendar:not([data-gpa-ssr])"))
      return;
    for (const ssr of this.querySelectorAll(":scope > [data-gpa-ssr]"))
      ssr.remove();
    const view = new CalendarView(this, {
      value: input.value || null,
      rangeStart: this.dataset.rangeStart || null,
      rangeEnd: this.dataset.rangeEnd || null,
      min: input.min || null,
      max: input.max || null,
      onSelect: (s) => {
        input.value = s;
        view.update({ value: s });
        input.dispatchEvent(new Event("change", { bubbles: true }));
        this.dispatchEvent(
          new CustomEvent("gpa-change", {
            bubbles: true,
            detail: { value: s },
          }),
        );
      },
    });
    input.type = "hidden";
    input.closest(".gpa-input")?.replaceWith(input);
    input.removeAttribute("data-gpa-native");
    this.prepend(view.element);
  }
}
