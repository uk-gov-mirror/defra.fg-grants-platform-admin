import { svg } from "./layer.ts";

type Attrs = Record<string, string | number | boolean | null | undefined>;

export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === "className") node.className = String(v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
};

const sizes = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 } as const;

export const icon = (
  root: ParentNode,
  name: string,
  size: keyof typeof sizes = "md",
  cls = "gpa-icon",
) => svg(root, name, sizes[size], cls);

export const button = (
  text: string,
  o: {
    variant?: string;
    size?: string;
    className?: string;
    attrs?: Attrs;
  } = {},
) =>
  el(
    "button",
    {
      type: "button",
      className: [
        "gpa-btn",
        `gpa-btn-${o.variant ?? "default"}`,
        `gpa-btn-${o.size ?? "md"}`,
        o.className,
      ]
        .filter(Boolean)
        .join(" "),
      ...o.attrs,
    },
    el("span", {}, text),
  );

export const iconButton = (
  root: ParentNode,
  name: string,
  label: string,
  o: { size?: "xs" | "sm" | "md"; className?: string; attrs?: Attrs } = {},
) => {
  const s = o.size ?? "md";
  return el(
    "button",
    {
      type: "button",
      className: [
        "gpa-btn",
        "gpa-btn-tertiary",
        `gpa-btn-${s}`,
        "gpa-btn-icon",
        o.className,
      ]
        .filter(Boolean)
        .join(" "),
      "aria-label": label,
      ...o.attrs,
    },
    icon(root, name, s === "xs" || s === "sm" ? "sm" : "md"),
  );
};

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
