/**
 * Applies a school's chosen accent-color theme to the whole app at
 * runtime, by overriding the `--color-primary-*` CSS custom properties
 * that every `bg-primary-*` / `text-primary-*` / `border-primary-*`
 * Tailwind utility resolves through (see globals.css — the primary ramp
 * lives in a plain `@theme` block rather than `@theme inline`
 * specifically so utilities compile to `var(--color-primary-600)` instead
 * of a baked-in literal hex, which is what makes this override possible
 * without a rebuild).
 *
 * Only one base hex is stored per theme (roughly a "600" shade); the
 * rest of the 50-900 ramp is derived here by walking lightness in HSL
 * space while keeping hue/saturation from the base color, so a single
 * color pick still produces hover states, subtle backgrounds, etc. that
 * all read as "the same color family".
 */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function hexToHsl(hex: string): Hsl {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  switch (max) {
    case r:
      h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
      break;
    case g:
      h = ((b - r) / d + 2) * 60;
      break;
    default:
      h = ((r - g) / d + 4) * 60;
  }

  return { h, s: s * 100, l: l * 100 };
}

function hslToHex({ h, s, l }: Hsl): string {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];

  const toHex = (v: number) =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Lightness OFFSET (in HSL percentage points) from the base color's own
// lightness, for each shade in the ramp — not an absolute target. Presets
// range from very dark (midnight-black, ~L7) to mid-tone (sky-blue,
// ~L38), so a fixed absolute-lightness table (e.g. "600 is always L42")
// can put the base color's own stop LIGHTER than the computed "500" stop
// for an already-light base, breaking the ramp's light-to-dark order.
// Anchoring every stop as an offset from the base's actual lightness
// guarantees the ramp stays monotonic no matter how light or dark the
// chosen preset is; it's clamped to [0, 100] at the extremes, where a
// very dark or very light base will compress the offsets that would
// otherwise overflow rather than reverse their order.
const RAMP_OFFSET_FROM_BASE: Record<string, number> = {
  "50": 55,
  "100": 51,
  "200": 43,
  "300": 32,
  "400": 18,
  "500": 8,
  "600": 0,
  "700": -8,
  "800": -15,
  "900": -22,
};

/** Very light stops need saturation pulled down too, or they read as neon/candy rather than a soft tint. */
function saturationForStop(stop: string, baseSaturation: number): number {
  if (stop === "50" || stop === "100") return Math.min(baseSaturation, 35);
  if (stop === "200") return Math.min(baseSaturation, 55);
  return baseSaturation;
}

export function primaryRampFromHex(baseHex: string): Record<string, string> {
  const { h, s, l: baseL } = hexToHsl(baseHex);
  const ramp: Record<string, string> = {};
  for (const [stop, offset] of Object.entries(RAMP_OFFSET_FROM_BASE)) {
    const l = Math.min(100, Math.max(0, baseL + offset));
    ramp[stop] = hslToHex({ h, s: saturationForStop(stop, s), l });
  }
  // The 600 stop is exactly the school's chosen color, not a derived
  // approximation — every preset's primaryHex IS the 600 shade. (The
  // offset-based computation above already lands here almost exactly;
  // this just removes any float-rounding drift.)
  ramp["600"] = baseHex;
  return ramp;
}

/** Overrides the primary color ramp on the document root. Safe to call on every render; a no-op if the color hasn't changed isn't worth optimizing for. */
export function applyPrimaryTheme(baseHex: string | undefined | null) {
  if (typeof document === "undefined" || !baseHex) return;
  const ramp = primaryRampFromHex(baseHex);
  const root = document.documentElement.style;
  for (const [stop, hex] of Object.entries(ramp)) {
    root.setProperty(`--color-primary-${stop}`, hex);
  }
}
