export type DiffLine =
  | {
      kind: "same" | "add" | "del";
      before?: number;
      after?: number;
      text: string;
    }
  | { kind: "gap"; count: number; text: string };

export interface Diff {
  lines: DiffLine[];
  added: number;
  removed: number;
}

export const diffLines = (
  before: string,
  after: string,
  context: number | false = 3,
): Diff => {
  const a = String(before ?? "").split("\n");
  const b = String(after ?? "").split("\n");
  const n = a.length;
  const m = b.length;
  const t = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      t[i][j] =
        a[i] === b[j]
          ? t[i + 1][j + 1] + 1
          : Math.max(t[i + 1][j], t[i][j + 1]);
  const ops: Exclude<DiffLine, { kind: "gap" }>[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j])
      ops.push({ kind: "same", before: ++i, after: ++j, text: a[i - 1] });
    else if (i < n && (j >= m || t[i + 1][j] >= t[i][j + 1]))
      ops.push({ kind: "del", before: ++i, text: a[i - 1] });
    else ops.push({ kind: "add", after: ++j, text: b[j - 1] });
  }
  const added = ops.filter((o) => o.kind === "add").length;
  const removed = ops.filter((o) => o.kind === "del").length;
  if (context === false) return { lines: ops, added, removed };
  const keep = ops.map((_, k) => {
    for (
      let x = Math.max(0, k - context);
      x <= Math.min(ops.length - 1, k + context);
      x++
    )
      if (ops[x].kind !== "same") return true;
    return false;
  });
  const lines: DiffLine[] = [];
  for (let k = 0; k < ops.length; k++) {
    if (keep[k]) {
      lines.push(ops[k]);
      continue;
    }
    const start = k;
    while (k < ops.length && !keep[k]) k++;
    const count = k - start;
    lines.push({
      kind: "gap",
      count,
      text: `${count} unchanged ${count === 1 ? "line" : "lines"}`,
    });
    k--;
  }
  return { lines, added, removed };
};
