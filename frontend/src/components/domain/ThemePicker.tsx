"use client";

import { Check } from "lucide-react";
import type { ThemePreset } from "@/lib/resources/tenant";

/**
 * Renders the school color-theme swatch grid — shared by the signup
 * wizard's theme step and the Settings page's "change it later" picker,
 * so both stay visually identical and only exist in one place.
 */
export function ThemePicker({
  presets,
  selected,
  onSelect,
}: {
  presets: ThemePreset[];
  selected: string;
  onSelect: (preset: ThemePreset) => void;
}) {
  return (
    <div className="grid grid-cols-4 gap-3 sm:grid-cols-6">
      {presets.map((preset) => {
        const isSelected = selected === preset.id;
        return (
          <button
            key={preset.id}
            type="button"
            onClick={() => onSelect(preset)}
            title={preset.label}
            aria-label={preset.label}
            aria-pressed={isSelected}
            className={`flex flex-col items-center gap-1.5 rounded-lg p-2 transition-colors ${
              isSelected ? "bg-slate-100 ring-2 ring-offset-1" : "hover:bg-slate-50"
            }`}
            style={isSelected ? ({ "--tw-ring-color": preset.primaryHex } as React.CSSProperties) : undefined}
          >
            <span
              className="relative flex size-9 items-center justify-center rounded-full border border-black/10"
              style={{ backgroundColor: preset.primaryHex }}
            >
              {isSelected && <Check className="size-4 text-white drop-shadow" aria-hidden="true" />}
            </span>
            <span className="text-center text-[11px] leading-tight text-slate-600">{preset.label}</span>
          </button>
        );
      })}
    </div>
  );
}
