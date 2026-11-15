type Side = "bottom" | "top";

type Align = "start" | "end" | "center";

export type Placement = {
  side?: Side;
  align?: Align;
  gap?: number;
};

const margin = 8;

const minHeight = 80;

const placedProperties = ["position", "left", "top", "max-height"];

const clamp = (value: number, low: number, high: number) =>
  Math.max(low, Math.min(value, high));

const menuOf = (panel: HTMLElement): HTMLElement =>
  panel.querySelector<HTMLElement>(".gpa-menu") ?? panel;

const opposite = (side: Side): Side => (side === "bottom" ? "top" : "bottom");

const roomBeside = (anchor: DOMRect, gap: number): Record<Side, number> => ({
  bottom: window.innerHeight - anchor.bottom - gap - margin,
  top: anchor.top - gap - margin,
});

const toSide = (
  side: Side,
  height: number,
  room: Record<Side, number>,
): Side =>
  height > room[side] && room[opposite(side)] > room[side]
    ? opposite(side)
    : side;

const toEdge = (anchor: Element, align: Align): Align => {
  const swapped: Record<Align, Align> = {
    start: "end",
    end: "start",
    center: "center",
  };

  return getComputedStyle(anchor).direction === "rtl" ? swapped[align] : align;
};

const toLeft = (anchor: DOMRect, width: number, edge: Align): number => {
  const lefts: Record<Align, number> = {
    start: anchor.left,
    end: anchor.right - width,
    center: anchor.left + anchor.width / 2 - width / 2,
  };
  const vw = document.documentElement.clientWidth;

  return clamp(lefts[edge], margin, vw - width - margin);
};

const toTop = (
  anchor: DOMRect,
  height: number,
  side: Side,
  gap: number,
): number => {
  const top =
    side === "bottom" ? anchor.bottom + gap : anchor.top - gap - height;

  return clamp(top, margin, window.innerHeight - height - margin);
};

const fitHeight = (panel: HTMLElement, room: number): number => {
  if (panel.offsetHeight > room) {
    menuOf(panel).style.maxHeight =
      `${Math.max(minHeight, Math.floor(room))}px`;
  }

  return panel.offsetHeight;
};

const correct = (panel: HTMLElement, left: number, top: number) => {
  if (!panel.offsetParent) return;
  const got = panel.getBoundingClientRect();

  if (Math.abs(got.left - left) > 0.5) {
    panel.style.left = `${Math.round(2 * left - got.left)}px`;
  }
  if (Math.abs(got.top - top) > 0.5) {
    panel.style.top = `${Math.round(2 * top - got.top)}px`;
  }
};

const defaults: Required<Placement> = {
  side: "bottom",
  align: "start",
  gap: 4,
};

export const place = (
  anchor: Element,
  panel: HTMLElement,
  placement: Placement = {},
) => {
  const { side, align, gap } = { ...defaults, ...placement };
  const rect = anchor.getBoundingClientRect();

  panel.classList.add("is-placed");
  panel.style.position = "fixed";
  panel.style.maxHeight = "";
  menuOf(panel).style.removeProperty("max-height");

  const room = roomBeside(rect, gap);
  const at = toSide(side, panel.offsetHeight, room);
  const height = fitHeight(panel, room[at]);
  const left = toLeft(rect, panel.offsetWidth, toEdge(anchor, align));
  const top = toTop(rect, height, at, gap);

  panel.style.left = `${Math.round(left)}px`;
  panel.style.top = `${Math.round(top)}px`;
  correct(panel, left, top);
  panel.dataset.side = at;
};

export const unplace = (panel: HTMLElement) => {
  panel.classList.remove("is-placed");
  for (const property of placedProperties) {
    panel.style.removeProperty(property);
  }
};
