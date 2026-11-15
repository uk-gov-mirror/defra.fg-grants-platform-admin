export const locale = "en-GB";
export const weekStart = 1;
export const dateOrder = "dmy" as "dmy" | "mdy";

const pad2 = (n: number) => (n < 10 ? "0" : "") + n;

export const toISO = (d: Date) =>
  `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

export const fromISO = (s: string | null | undefined): Date | null => {
  const m = s ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(s) : null;
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
};

export const addDays = (d: Date, n: number) => {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
};

const parts = (d: Date) => {
  const out: Record<string, string> = {};
  for (const x of new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).formatToParts(d))
    out[x.type] = x.value;
  out.month = (out.month ?? "").replace(".", "").replace(/^Sept$/, "Sep");
  return out;
};

export const formatDate = (
  iso: string | null | undefined,
  o: { year?: boolean } = {},
) => {
  const d = fromISO(iso);
  if (!d) return "";
  const q = parts(d);
  return `${q.day} ${q.month}${o.year === false ? "" : ` ${q.year}`}`;
};

export const formatRange = (
  a: string | null | undefined,
  b: string | null | undefined,
) => {
  const da = fromISO(a);
  const db = fromISO(b);
  if (!da || !db)
    return da ? `${formatDate(a)} –` : db ? `– ${formatDate(b)}` : "";
  const A = parts(da);
  const B = parts(db);
  if (A.year !== B.year) return `${formatDate(a)} – ${formatDate(b)}`;
  if (A.month !== B.month)
    return `${formatDate(a, { year: false })} – ${formatDate(b)}`;
  return A.day === B.day ? formatDate(a) : `${A.day}–${formatDate(b)}`;
};

export const parseDate = (text: string | null | undefined): string | null => {
  const t = String(text ?? "").trim();
  if (!t) return null;
  let y: number | undefined;
  let mo: number | undefined;
  let d: number | undefined;
  let m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t)))
    [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})[./\- ](\d{1,2})[./\- ](\d{2}|\d{4})$/.exec(t))) {
    [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (dateOrder === "mdy") [d, mo] = [mo, d];
  } else {
    const names = Array.from({ length: 12 }, (_, i) => {
      const dt = new Date(2000, i, 1);
      return [
        dt.toLocaleDateString(locale, { month: "long" }).toLowerCase(),
        dt
          .toLocaleDateString(locale, { month: "short" })
          .toLowerCase()
          .replace(".", ""),
      ];
    });
    for (const w of t.toLowerCase().replace(/[.,]/g, " ").split(/\s+/)) {
      if (/^\d{4}$/.test(w)) y = +w;
      else if (/^\d{1,2}$/.test(w)) d = +w;
      else
        names.forEach((n, i) => {
          if (w.length >= 3 && (n[0].startsWith(w) || n[1].startsWith(w)))
            mo = i + 1;
        });
    }
  }
  if (y !== undefined && y < 100) y += 2000;
  if (!y || !mo || !d) return null;
  const r = new Date(y, mo - 1, d);
  return r.getFullYear() === y && r.getMonth() === mo - 1 && r.getDate() === d
    ? toISO(r)
    : null;
};

export const today = () => toISO(new Date());

export const calendarMonth = (
  o: {
    value?: string | null;
    rangeStart?: string | null;
    rangeEnd?: string | null;
    min?: string | null;
    max?: string | null;
    today?: string | null;
  } = {},
) => {
  const sel = o.value || o.rangeStart || null;
  const d = fromISO(sel) ?? new Date();
  const month = new Date(d.getFullYear(), d.getMonth(), 1);
  const lead = (month.getDay() - weekStart + 7) % 7;
  const weeks = Math.ceil(
    (lead + new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()) /
      7,
  );
  const start = addDays(month, -lead - 7 * Math.floor((6 - weeks) / 2));
  const focus = sel || o.today || today();
  const now = o.today || today();
  let rs = o.rangeStart ?? null;
  let re = o.rangeEnd ?? null;
  if (rs && re && re < rs) [rs, re] = [re, rs];
  const out = (s: string) =>
    Boolean((o.min && s < o.min) || (o.max && s > o.max));
  const title = month.toLocaleDateString(locale, {
    month: "long",
    year: "numeric",
  });
  const weekdays = Array.from({ length: 7 }, (_, w) => {
    const x = addDays(start, w);
    return {
      narrow: x.toLocaleDateString(locale, { weekday: "narrow" }),
      long: x.toLocaleDateString(locale, { weekday: "long" }),
    };
  });
  const rows = Array.from({ length: 6 }, (_, r) =>
    Array.from({ length: 7 }, (_, c) => {
      const x = addDays(start, r * 7 + c);
      const s = toISO(x);
      const other = x.getMonth() !== month.getMonth();
      const selected = s === o.value || s === rs || s === re;
      const inRange = Boolean(rs && re && s > rs && s < re);
      return {
        iso: s,
        day: x.getDate(),
        label: x.toLocaleDateString(locale, {
          weekday: "long",
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
        className: [
          "gpa-day",
          other && "is-other",
          selected && "is-selected",
          inRange && "is-inrange",
          s === rs && "is-start",
          s === re && "is-end",
          s === now && "is-today",
        ]
          .filter(Boolean)
          .join(" "),
        selected,
        focus: s === focus,
        disabled: out(s),
        today: s === now,
      };
    }),
  );
  return { title, weekdays, rows };
};
