const locale = "en-GB";

export const fmtNum = (v: unknown) =>
  typeof v === "number" ? v.toLocaleString(locale) : String(v);

export const niceTicks = (max: number, n = 4) => {
  if (!(max > 0)) return [0, 1];
  const raw = max / n;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / mag;
  const step =
    (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) out.push(+v.toFixed(10));
  if (out[out.length - 1] < max) out.push(out[out.length - 1] + step);
  return out;
};

export const sparkline = (data: number[], w = 96, h = 28) => {
  const pad = 2;
  const lo = Math.min(...data);
  const hi = Math.max(...data);
  const span = hi - lo || 1;
  const pts = data.map((v, i) => [
    pad + (i / Math.max(1, data.length - 1)) * (w - pad * 2),
    pad + (1 - (v - lo) / span) * (h - pad * 2),
  ]);
  return {
    points: pts.map((q) => q.join(",")).join(" "),
    last: pts[pts.length - 1] ?? null,
    width: w,
    height: h,
  };
};

export const barList = (items: { value: number }[], max?: number) => {
  const top = max || Math.max(...items.map((i) => i.value), 0) || 1;
  return items.map((it) => ({
    ...it,
    pct: Math.round(Math.max(0.5, (it.value / top) * 100)),
    text: fmtNum(it.value),
  }));
};

export interface ChartInput {
  type?: "line" | "bar";
  series: { name: string; data: (number | null)[] }[];
  x?: (string | number)[];
  height?: number;
}

export const X_TIERS = Array.from({ length: 20 }, (_, k) => k + 2);

export const chartModel = (p: ChartInput) => {
  const series = (p.series || []).slice(0, 8);
  const xs = p.x || (series[0] ? series[0].data.map((_, i) => i) : []);
  const H = p.height || 240;
  const bar = p.type === "bar";
  const labelled = series.length <= 4 && !bar && series.length > 1;
  const m = { t: 12, r: labelled ? 88 : 16, b: 28, l: 48 };
  const all: number[] = [];
  for (const s of series) for (const v of s.data) if (v != null) all.push(v);
  const ticks = niceTicks(Math.max(...all, 0));
  const top = ticks[ticks.length - 1] || 1;
  const ih = H - m.t - m.b;
  const n = xs.length;
  const P = (i: number) =>
    bar ? ((i + 0.5) / n) * 100 : n <= 1 ? 50 : (i / (n - 1)) * 100;
  const Y = (v: number) => m.t + ih - (v / top) * ih;
  const pct = (v: number) => +v.toFixed(4) + "%";
  const grid = ticks.map((t) => ({ y: Y(t), base: t === 0, label: fmtNum(t) }));
  const xLabels = xs.map((x, i) => ({
    x: pct(P(i)),
    text: String(x),
    tiers: X_TIERS.filter((c) => i % Math.max(1, Math.ceil(n / c)) === 0)
      .map((c) => "gpa-x" + c)
      .join(" "),
  }));
  const slots = bar
    ? xs.map((_, i) => ({
        x: pct((i / n) * 100),
        width: pct(100 / n),
        bars: series
          .map((s, si) => {
            const v = s.data[i];
            if (v == null) return null;
            return { s: si, y: Y(v), h: Math.max(0, Y(0) - Y(v)) };
          })
          .filter(Boolean) as { s: number; y: number; h: number }[],
      }))
    : [];
  const lines = bar
    ? []
    : series.map((s, si) => {
        let d = "";
        s.data.forEach((v, i) => {
          if (v == null) return;
          d +=
            (d && s.data[i - 1] != null ? "L" : "M") +
            +(P(i) * 10).toFixed(3) +
            "," +
            +(Y(v) - m.t).toFixed(3);
        });
        let li = s.data.length - 1;
        while (li > 0 && s.data[li] == null) li--;
        const label = labelled
          ? { x: pct(P(li)), y: Y(s.data[li] ?? 0), text: s.name }
          : null;
        return { d, label, series: si + 1 };
      });
  return {
    H,
    m,
    ih,
    n,
    bar,
    labelled,
    k: series.length,
    xs: xs.map(String),
    series,
    grid,
    xLabels,
    slots,
    lines,
    P,
    Y,
    top,
    baseline: Y(0),
  };
};

export const treeLeaves = (it: {
  id: string;
  children?: unknown[];
}): string[] =>
  it.children && it.children.length
    ? (it.children as { id: string; children?: unknown[] }[]).flatMap(
        treeLeaves,
      )
    : [it.id];
