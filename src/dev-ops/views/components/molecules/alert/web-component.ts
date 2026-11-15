export class GpaDismiss extends HTMLElement {
  connectedCallback() {
    this.addEventListener("click", (event) => {
      if (!(event.target as Element).closest("button")) return;
      const target = this.closest<HTMLElement>(
        "[data-gpa-dismissable], .gpa-toast",
      );
      if (!target) return;
      const next = target.nextElementSibling as HTMLElement | null;
      target.remove();
      this.dispatchEvent(new CustomEvent("gpa-dismiss", { bubbles: true }));
      if (next && next.tabIndex >= 0) next.focus({ preventScroll: true });
    });
  }
}
