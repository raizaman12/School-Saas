import { tenantApi, type ThemePreset } from "@/lib/resources/tenant";
import { applyPrimaryTheme } from "./applyTheme";

export { applyPrimaryTheme, primaryRampFromHex } from "./applyTheme";
export type { ThemePreset };

// The catalog is small, public, and effectively static for a session — one
// fetch, reused everywhere (signup wizard, settings page, auto-apply on
// login) rather than re-requesting it on every render.
let cachedPresets: ThemePreset[] | null = null;
let inFlight: Promise<ThemePreset[]> | null = null;

export async function getThemePresets(): Promise<ThemePreset[]> {
  if (cachedPresets) return cachedPresets;
  if (!inFlight) {
    inFlight = tenantApi
      .themePresets()
      .then((presets) => {
        cachedPresets = presets;
        return presets;
      })
      .catch((err) => {
        inFlight = null; // allow a retry on next call
        throw err;
      });
  }
  return inFlight;
}

/** Resolves a themeId to its base hex and applies it. No-ops silently if the id is unknown or the catalog can't be fetched — a school never gets stuck on a broken page just because theming failed. */
export async function applyThemeById(themeId: string | null | undefined) {
  if (!themeId) return;
  try {
    const presets = await getThemePresets();
    const preset = presets.find((p) => p.id === themeId);
    if (preset) applyPrimaryTheme(preset.primaryHex);
  } catch {
    // Best-effort — theming is cosmetic, never worth blocking or erroring the page over.
  }
}
