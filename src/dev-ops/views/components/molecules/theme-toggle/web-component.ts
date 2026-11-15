import { svg } from "../../core/layer.ts";

const DARK = "dark";
const LIGHT = "light";

type Theme = typeof DARK | typeof LIGHT;

const isTheme = (v: unknown): v is Theme => v === DARK || v === LIGHT;

const readCookie = (name: string) =>
  document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.split("=")[1];

const cookieFlags = () =>
  `Path=/; SameSite=Strict${location.protocol === "https:" ? "; Secure" : ""}`;

const prefersDark = () => {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
};

export class GpaThemeToggle extends HTMLElement {
  connectedCallback() {
    queueMicrotask(() => this.enhance());
  }

  get key() {
    return this.dataset.cookie ?? "gpa-theme";
  }

  #stored(): Theme | null {
    let v: string | null | undefined = null;
    try {
      v = localStorage.getItem(this.key);
    } catch {}
    if (isTheme(v)) return v;
    const c = readCookie(this.key);
    return isTheme(c) ? c : null;
  }

  #write(theme: Theme) {
    try {
      localStorage.setItem(this.key, theme);
    } catch {}
    document.cookie = `${this.key}=${theme}; Max-Age=31536000; ${cookieFlags()}`;
  }

  #current(): Theme {
    const stated = document.documentElement.dataset.theme;

    if (isTheme(stated)) {
      return stated;
    }

    return this.#stored() ?? (prefersDark() ? DARK : LIGHT);
  }

  enhance() {
    GpaThemeToggle.apply(this.#current());

    const input = this.querySelector<HTMLInputElement>(
      'input[type="checkbox"]',
    );
    const item = this.querySelector<HTMLElement>('[role="menuitemcheckbox"]');

    input?.addEventListener("change", () =>
      this.#set(input.checked ? DARK : LIGHT),
    );
    item?.addEventListener("click", () =>
      this.#set(document.documentElement.dataset.theme === DARK ? LIGHT : DARK),
    );
  }

  #set(theme: Theme) {
    this.#write(theme);
    GpaThemeToggle.apply(theme);
  }

  static apply(theme: Theme) {
    document.documentElement.dataset.theme = theme;
    for (const t of document.querySelectorAll("gpa-theme-toggle")) {
      const input = t.querySelector<HTMLInputElement>('input[type="checkbox"]');
      const dark = theme === DARK;
      if (input) input.checked = dark;
      const swap = (sel: string, name: string, size: number) => {
        const host = t.querySelector(sel);
        if (host && host.querySelector("svg")?.dataset.icon !== name)
          host.replaceChildren(
            ...([svg(t, name, size)].filter(Boolean) as Node[]),
          );
      };
      swap(".gpa-theme-knob", dark ? "moon" : "sun", 12);
      swap(".gpa-theme-other", dark ? "sun" : "moon", 12);
      const item = t.querySelector('[role="menuitemcheckbox"]');
      if (item) {
        item.setAttribute("aria-checked", String(dark));
        const tick = item.querySelector(".gpa-menuitem-tick");
        if (tick && Boolean(tick.firstElementChild) !== dark)
          tick.replaceChildren(
            ...(dark ? ([svg(t, "check", 14)].filter(Boolean) as Node[]) : []),
          );
      }
    }
  }
}
