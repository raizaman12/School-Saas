import { describe, it, expect } from "vitest";
import { t } from "./index";

describe("t", () => {
  it("resolves a nested dictionary key", () => {
    expect(t("nav.students")).toBe("Students");
  });

  it("falls back to the raw path for an unknown key", () => {
    expect(t("nav.doesNotExist")).toBe("nav.doesNotExist");
  });
});
