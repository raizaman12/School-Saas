import { strings, defaultLocale, type Locale } from "./strings";

type Dictionary = (typeof strings)[Locale];

/** Simple `t("nav.students")` accessor over the current (only, for now) locale dictionary. */
export function t(path: string, locale: Locale = defaultLocale): string {
  const segments = path.split(".");
  let node: unknown = strings[locale] as Dictionary;
  for (const segment of segments) {
    if (typeof node !== "object" || node === null || !(segment in node)) return path;
    node = (node as Record<string, unknown>)[segment];
  }
  return typeof node === "string" ? node : path;
}

export { strings, defaultLocale };
export type { Locale };
