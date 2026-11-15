export class GpaErrorSummary extends HTMLElement {
  connectedCallback() {
    const box = this.querySelector<HTMLElement>(".gpa-errorsummary");
    if (!box || box.dataset.gpaSeen) return;
    box.dataset.gpaSeen = "";
    queueMicrotask(() => {
      box.focus();
      box.scrollIntoView?.({ block: "nearest" });
    });
    box.addEventListener("click", (event) => {
      const a = (event.target as Element).closest<HTMLAnchorElement>(
        'a[href^="#"]',
      );
      const field =
        a && document.getElementById(decodeURIComponent(a.hash.slice(1)));
      if (!field) return;
      event.preventDefault();
      field.focus();
      field.scrollIntoView?.({ block: "center" });
    });
  }
}
