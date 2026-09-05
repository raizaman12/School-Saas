import { describe, it, expect, afterEach } from "vitest";
import { primaryRampFromHex, applyPrimaryTheme } from "./applyTheme";

describe("primaryRampFromHex", () => {
  it("produces all ten stops (50-900)", () => {
    const ramp = primaryRampFromHex("#7f1d1d");
    expect(Object.keys(ramp).sort()).toEqual(["100", "200", "300", "400", "50", "500", "600", "700", "800", "900"]);
  });

  it("every stop is a valid 6-digit hex color", () => {
    const ramp = primaryRampFromHex("#065f46");
    for (const hex of Object.values(ramp)) {
      expect(hex).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it("uses the input color exactly as the 600 stop (presets are chosen as the 600 shade)", () => {
    const ramp = primaryRampFromHex("#7f1d1d");
    expect(ramp["600"]).toBe("#7f1d1d");
  });

  it("lighter stops are actually lighter and darker stops are actually darker than the base", () => {
    const ramp = primaryRampFromHex("#2563eb");
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return (n >> 16) + ((n >> 8) & 0xff) + (n & 0xff);
    };
    expect(luminance(ramp["50"])).toBeGreaterThan(luminance(ramp["600"]));
    expect(luminance(ramp["900"])).toBeLessThan(luminance(ramp["600"]));
    // Monotonic across the whole ramp, not just the endpoints.
    const stops = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
    for (let i = 1; i < stops.length; i++) {
      expect(luminance(ramp[stops[i]])).toBeLessThanOrEqual(luminance(ramp[stops[i - 1]]));
    }
  });

  // Every real preset from the backend catalog (config/themePresets.ts),
  // including the very dark (midnight-black) and lighter (sky-blue) ends
  // of the range, where lightness clamping is most likely to break the
  // light-to-dark order.
  it("stays monotonic (light to dark) for every actual theme preset color", () => {
    const luminance = (hex: string) => {
      const n = parseInt(hex.slice(1), 16);
      return (n >> 16) + ((n >> 8) & 0xff) + (n & 0xff);
    };
    const stops = ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"];
    const presetHexes = [
      "#1e3a8a",
      "#2563eb",
      "#0284c7",
      "#334155",
      "#065f46",
      "#047857",
      "#166534",
      "#4d7c0f",
      "#7f1d1d",
      "#881337",
      "#b91c1c",
      "#9a3412",
      "#1f2937",
      "#475569",
      "#6d28d9",
      "#4338ca",
      "#0f766e",
      "#0e7490",
      "#a16207",
      "#b45309",
      "#c2410c",
      "#86198f",
      "#be185d",
      "#111827",
    ];

    for (const baseHex of presetHexes) {
      const ramp = primaryRampFromHex(baseHex);
      for (let i = 1; i < stops.length; i++) {
        expect(luminance(ramp[stops[i]])).toBeLessThanOrEqual(luminance(ramp[stops[i - 1]]));
      }
    }
  });
});

describe("applyPrimaryTheme", () => {
  afterEach(() => {
    // Reset so this test doesn't leak CSS var overrides into other test files.
    for (const stop of ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900"]) {
      document.documentElement.style.removeProperty(`--color-primary-${stop}`);
    }
  });

  it("sets --color-primary-* custom properties on the document root", () => {
    applyPrimaryTheme("#7f1d1d");
    expect(document.documentElement.style.getPropertyValue("--color-primary-600").trim()).toBe("#7f1d1d");
    expect(document.documentElement.style.getPropertyValue("--color-primary-50")).not.toBe("");
  });

  it("does nothing (no throw) when given no color", () => {
    expect(() => applyPrimaryTheme(undefined)).not.toThrow();
    expect(() => applyPrimaryTheme(null)).not.toThrow();
  });
});
