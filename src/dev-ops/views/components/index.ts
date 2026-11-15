import { GpaDialog } from "./organisms/dialog/web-component.ts";
import { GpaDismiss } from "./molecules/alert/web-component.ts";
import { GpaDropdown } from "./molecules/dropdown/web-component.ts";
import { GpaErrorSummary } from "./molecules/error-summary/web-component.ts";
import { GpaSegmented } from "./molecules/segmented-control/web-component.ts";
import { GpaThemeToggle } from "./molecules/theme-toggle/web-component.ts";
import { GpaToastRegion } from "./molecules/toast-region/web-component.ts";
import { GpaToast } from "./molecules/toast/web-component.ts";
import { GpaTooltip } from "./atoms/tooltip/web-component.ts";

const elements: [string, CustomElementConstructor][] = [
  ["gpa-dialog", GpaDialog],
  ["gpa-dismiss", GpaDismiss],
  ["gpa-dropdown", GpaDropdown],
  ["gpa-error-summary", GpaErrorSummary],
  ["gpa-segmented", GpaSegmented],
  ["gpa-theme-toggle", GpaThemeToggle],
  ["gpa-toast-region", GpaToastRegion],
  ["gpa-toast", GpaToast],
  ["gpa-tooltip", GpaTooltip],
];

for (const [name, element] of elements) {
  if (!customElements.get(name)) customElements.define(name, element);
}

const upgrade = (root: ParentNode) => {
  for (const input of root.querySelectorAll<HTMLInputElement>(
    "input[data-gpa-indeterminate]",
  ))
    input.indeterminate = true;
  const arrived = root.querySelector<HTMLElement>("[data-focus-on-arrival]");
  if (arrived && root === document) {
    arrived.focus({ preventScroll: true });
    arrived.scrollIntoView?.({ block: "nearest" });
  }
  for (const count of root.querySelectorAll<HTMLElement>(
    "[data-gpa-count-for]",
  )) {
    const control = document.getElementById(count.dataset.gpaCountFor ?? "") as
      HTMLInputElement | HTMLTextAreaElement | null;
    if (control && "value" in control)
      count.textContent = `${control.value.length} / ${count.dataset.max}`;
  }
};

document.addEventListener("input", (event) => {
  const control = event.target as HTMLInputElement | HTMLTextAreaElement;
  if (!control.id || !("value" in control)) return;
  for (const count of document.querySelectorAll<HTMLElement>(
    `[data-gpa-count-for="${CSS.escape(control.id)}"]`,
  ))
    count.textContent = `${control.value.length} / ${count.dataset.max}`;
});

document.addEventListener("submit", (event) => {
  const button = (event as SubmitEvent).submitter as HTMLButtonElement | null;
  if (!button?.hasAttribute("data-gpa-loading-on-submit")) return;
  window.setTimeout(() => {
    if (event.defaultPrevented) return;
    button.setAttribute("aria-busy", "true");
    button.disabled = true;
    const spinner = document.createElement("span");
    spinner.className = "gpa-spinner gpa-spinner-sm";
    spinner.setAttribute("aria-hidden", "true");
    spinner.dataset.gpaSubmitSpinner = "";
    const lead = button.firstElementChild;
    if (lead?.matches("svg.gpa-icon")) {
      lead.setAttribute("hidden", "");
      lead.setAttribute("data-gpa-submit-hidden", "");
    }
    button.prepend(spinner);
  }, 0);
});

window.addEventListener("pageshow", (event) => {
  if (!event.persisted) return;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-gpa-loading-on-submit][aria-busy="true"]',
  )) {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.querySelector("[data-gpa-submit-spinner]")?.remove();
    button.querySelector("[data-gpa-submit-hidden]")?.removeAttribute("hidden");
  }
});

document.addEventListener(
  "click",
  (event) => {
    if ((event.target as Element).closest?.("[data-gpa-off]"))
      event.preventDefault();
  },
  true,
);
if (document.readyState === "loading")
  document.addEventListener("DOMContentLoaded", () => upgrade(document));
else upgrade(document);

export {
  GpaDialog,
  GpaDismiss,
  GpaDropdown,
  GpaErrorSummary,
  GpaSegmented,
  GpaThemeToggle,
  GpaToastRegion,
  GpaToast,
  GpaTooltip,
};
