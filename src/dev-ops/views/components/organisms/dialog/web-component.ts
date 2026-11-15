const reducedMotion = (): boolean => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

const exitMs = (): number => {
  const value = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue(
      "--duration-exit",
    ),
  );

  if (reducedMotion()) {
    return 0;
  }

  return Number.isNaN(value) ? 150 : value;
};

const hostOf = (opener: HTMLElement): GpaDialog | null =>
  document
    .getElementById(opener.dataset.gpaOpen ?? "")
    ?.closest<GpaDialog>("gpa-dialog") ?? null;

const onPageClick = (event: MouseEvent) => {
  const opener = (event.target as Element).closest?.<HTMLElement>(
    "[data-gpa-open]",
  );
  const host = opener && hostOf(opener);

  if (host) {
    event.preventDefault();
    host.show(opener);
  }
};

export class GpaDialog extends HTMLElement {
  #dialog: HTMLDialogElement | null = null;
  #opener: HTMLElement | null = null;
  #arrived = false;

  static #listening = false;

  connectedCallback() {
    queueMicrotask(() => this.enhance());
    if (!GpaDialog.#listening) {
      GpaDialog.#listening = true;
      document.addEventListener("click", onPageClick);
    }
  }

  enhance() {
    const dialog = this.#dialog
      ? null
      : this.querySelector<HTMLDialogElement>(":scope > dialog");

    if (!dialog) {
      return;
    }
    this.#dialog = dialog;
    dialog.addEventListener("cancel", this.#onCancel);
    dialog.addEventListener("click", this.#onClick);
    if (this.hasAttribute("data-open")) {
      this.#arrived = true;
      this.show();
    }
  }

  get #dismissible() {
    return this.dataset.dismissible !== "false";
  }

  #onCancel = (event: Event) => {
    event.preventDefault();
    if (this.#dismissible) this.hide();
  };

  #onClick = (event: MouseEvent) => {
    const target = event.target as Element;

    if (target.closest("[data-gpa-close]") && this.#dismissible) {
      event.preventDefault();
      this.hide();
    }
  };

  #reset(dialog: HTMLDialogElement) {
    const forms = new Set<HTMLFormElement>(dialog.querySelectorAll("form"));
    for (const field of dialog.querySelectorAll<HTMLInputElement>(
      "input, select, textarea, button",
    ))
      if (field.form) forms.add(field.form);
    for (const form of forms) {
      form.reset();
      for (const field of form.elements)
        if (
          field instanceof HTMLInputElement ||
          field instanceof HTMLTextAreaElement ||
          field instanceof HTMLSelectElement
        )
          field.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }

  #returnFocus() {
    const opener = this.#opener;
    if (!opener?.isConnected) return;
    const panel = opener.closest<HTMLElement>("[popover][id]");
    const shut = panel && !panel.matches(":popover-open");
    const hidden =
      typeof opener.checkVisibility === "function"
        ? !opener.checkVisibility()
        : opener.offsetParent === null;
    if (panel && (shut || hidden)) {
      const trigger = document.querySelector<HTMLElement>(
        `[popovertarget="${CSS.escape(panel.id)}"]`,
      );
      if (trigger) {
        trigger.focus();
        return;
      }
    }
    opener.focus();
  }

  #restoreAddress(dialog: HTMLDialogElement) {
    const href = dialog.querySelector<HTMLAnchorElement>(
      "a.gpa-dialog-close[href]",
    )?.href;
    if (!href) return;
    try {
      const to = new URL(href, location.href);
      if (to.origin !== location.origin || to.href === location.href) return;
      history.replaceState(
        history.state,
        "",
        to.pathname + to.search + to.hash,
      );
    } catch {}
  }

  get dialog() {
    return this.#dialog;
  }

  show(opener?: HTMLElement) {
    const dialog = this.#dialog;

    if (!dialog) {
      return;
    }
    this.#opener = opener ?? (document.activeElement as HTMLElement | null);
    if (opener && this.hasAttribute("data-reset-on-open")) this.#reset(dialog);
    dialog.classList.remove("is-leaving");
    dialog.close();
    dialog.showModal();
    this.#lock();
    this.#focusIn(dialog);
    this.dispatchEvent(new CustomEvent("gpa-open", { bubbles: true }));
  }

  #focusIn(dialog: HTMLDialogElement) {
    const focusable =
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const body = dialog.querySelector(".gpa-dialog-body, .gpa-drawer-body");
    const target =
      dialog.querySelector<HTMLElement>("[data-autofocus], [autofocus]") ??
      body?.querySelector<HTMLElement>(focusable) ??
      dialog.querySelector<HTMLElement>(".gpa-dialog, .gpa-drawer");
    target?.focus({ preventScroll: true });
  }

  #unlock: (() => void) | null = null;

  #lock() {
    const body = document.body,
      sw = window.innerWidth - document.documentElement.clientWidth;
    const was = [body.style.overflow, body.style.paddingRight];
    body.style.overflow = "hidden";
    if (sw > 0) body.style.paddingRight = `${sw}px`;
    this.#unlock = () => {
      body.style.overflow = was[0];
      body.style.paddingRight = was[1];
    };
  }

  hide() {
    const dialog = this.#dialog;

    if (!dialog?.open || dialog.classList.contains("is-leaving")) {
      return;
    }
    dialog.classList.add("is-leaving");
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      this.#closed(dialog);
    };
    const timer = window.setTimeout(finish, exitMs() ? 1000 : 0);
    requestAnimationFrame(() => {
      const running = dialog.getAnimations?.({ subtree: true }) ?? [];
      if (!running.length) finish();
      else Promise.all(running.map((a) => a.finished)).then(finish, finish);
    });
  }

  #closed(dialog: HTMLDialogElement) {
    dialog.classList.remove("is-leaving");
    dialog.close();
    this.#unlock?.();
    this.#unlock = null;
    if (this.#arrived) {
      this.#arrived = false;
      this.#restoreAddress(dialog);
    }
    this.#returnFocus();
    this.dispatchEvent(new CustomEvent("gpa-close", { bubbles: true }));
  }
}
