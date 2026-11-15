import { readFileSync } from "node:fs";
import path from "node:path";
import type nunjucks from "nunjucks";
import { chartModel, fmtNum, sparkline } from "./core/charts.ts";
import { calendarMonth, formatDate, formatRange } from "./core/dates.ts";
import { diffLines } from "./core/diff.ts";

export {
  barList,
  chartModel,
  fmtNum,
  sparkline,
  treeLeaves,
} from "./core/charts.ts";
export {
  calendarMonth,
  formatDate,
  formatRange,
  parseDate,
} from "./core/dates.ts";
export { diffLines } from "./core/diff.ts";

export const designSystemViews = path.resolve(import.meta.dirname, "..");

const icons: Record<string, [string, Record<string, string>][]> = JSON.parse(
  readFileSync(path.join(import.meta.dirname, "core/icons.json"), "utf8"),
);

let counter = 0;

const nextId = (prefix = "gpa") => `${prefix}-${(++counter).toString(36)}`;

const aliases: Record<string, string> = JSON.parse(
  readFileSync(
    path.join(import.meta.dirname, "core/icon-aliases.json"),
    "utf8",
  ),
);

export const iconNodes = (name: string) => {
  const nodes = icons[iconName(name)];
  if (!nodes) throw new Error(`Unknown icon "${name}"`);
  return nodes;
};

export const iconName = (name: string) => aliases[name] ?? name;

export const addDesignSystem = (environment: nunjucks.Environment) => {
  environment.addGlobal("gpaIconNodes", iconNodes);
  environment.addGlobal("gpaIconName", iconName);
  environment.addGlobal("gpaId", nextId);
  environment.addGlobal("gpaDiff", diffLines);
  environment.addGlobal("gpaFormatDate", formatDate);
  environment.addGlobal("gpaFormatRange", formatRange);
  environment.addGlobal("gpaCalendarMonth", calendarMonth);
  environment.addGlobal("gpaChart", chartModel);
  environment.addGlobal("gpaSparkline", sparkline);
  environment.addGlobal("gpaNum", fmtNum);
  return environment;
};
