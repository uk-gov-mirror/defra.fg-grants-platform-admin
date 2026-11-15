import { readFileSync } from "node:fs";
import path from "node:path";
import type nunjucks from "nunjucks";

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
  return environment;
};
