export class GpaToastRegion extends HTMLElement {
  #region: HTMLElement | null = null;

  connectedCallback() {
    if (this.#region) return;
    this.#region = this.querySelector(":scope > .gpa-toast-region");
    if (!this.#region) return;
    if ("showPopover" in this.#region)
      this.#region.setAttribute("popover", "manual");
    document.addEventListener("gpa-open", this.#follow);
    document.addEventListener("gpa-close", this.#follow);
    this.#follow();
  }

  disconnectedCallback() {
    document.removeEventListener("gpa-open", this.#follow);
    document.removeEventListener("gpa-close", this.#follow);
  }

  #follow = () => {
    const region = this.#region!;
    const modals = [
      ...document.querySelectorAll<HTMLDialogElement>("dialog[open]"),
    ].filter((d) => d.matches(":modal"));
    const host = modals[modals.length - 1] ?? this;
    if (region.parentElement !== host) host.append(region);
    try {
      if (region.matches(":popover-open")) region.hidePopover();
      region.showPopover?.();
    } catch {}
  };
}
