/**
 * A broad palette of preset color themes a school can pick for its
 * dashboard/portal's accent color at signup (and change later). Pakistani
 * school uniforms/branding span a wide range of colors (navy, bottle
 * green, maroon, sky blue, and so on) — this list is NOT tied to any
 * specific named institution's actual branding (there's no reliable way
 * to verify or keep that in sync school-by-school), it's simply a wide
 * enough spread of common colors that most schools can find one close to
 * their own uniform/brand and recognize their portal as "theirs".
 *
 * Only a single base hex (roughly a Tailwind "600" shade) is stored per
 * theme — the frontend derives the full 50-900 ramp from it at render
 * time (see frontend's lib/theme). Keeping just the seed color here (not
 * a whole ramp) means adding a new preset is a one-line change.
 */
export const THEME_IDS = [
  'navy-blue',
  'royal-blue',
  'sky-blue',
  'steel-blue',
  'bottle-green',
  'emerald-green',
  'forest-green',
  'olive-green',
  'maroon',
  'burgundy',
  'crimson-red',
  'brick-red',
  'charcoal-grey',
  'slate-grey',
  'purple',
  'indigo',
  'teal',
  'turquoise',
  'mustard-gold',
  'amber',
  'coral-orange',
  'plum',
  'rose-pink',
  'midnight-black',
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemePreset {
  id: ThemeId;
  label: string;
  primaryHex: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { id: 'navy-blue', label: 'Navy Blue', primaryHex: '#1e3a8a' },
  { id: 'royal-blue', label: 'Royal Blue', primaryHex: '#2563eb' },
  { id: 'sky-blue', label: 'Sky Blue', primaryHex: '#0284c7' },
  { id: 'steel-blue', label: 'Steel Blue', primaryHex: '#334155' },
  { id: 'bottle-green', label: 'Bottle Green', primaryHex: '#065f46' },
  { id: 'emerald-green', label: 'Emerald Green', primaryHex: '#047857' },
  { id: 'forest-green', label: 'Forest Green', primaryHex: '#166534' },
  { id: 'olive-green', label: 'Olive Green', primaryHex: '#4d7c0f' },
  { id: 'maroon', label: 'Maroon', primaryHex: '#7f1d1d' },
  { id: 'burgundy', label: 'Burgundy', primaryHex: '#881337' },
  { id: 'crimson-red', label: 'Crimson Red', primaryHex: '#b91c1c' },
  { id: 'brick-red', label: 'Brick Red', primaryHex: '#9a3412' },
  { id: 'charcoal-grey', label: 'Charcoal Grey', primaryHex: '#1f2937' },
  { id: 'slate-grey', label: 'Slate Grey', primaryHex: '#475569' },
  { id: 'purple', label: 'Purple', primaryHex: '#6d28d9' },
  { id: 'indigo', label: 'Indigo', primaryHex: '#4338ca' },
  { id: 'teal', label: 'Teal', primaryHex: '#0f766e' },
  { id: 'turquoise', label: 'Turquoise', primaryHex: '#0e7490' },
  { id: 'mustard-gold', label: 'Mustard / Gold', primaryHex: '#a16207' },
  { id: 'amber', label: 'Amber', primaryHex: '#b45309' },
  { id: 'coral-orange', label: 'Coral Orange', primaryHex: '#c2410c' },
  { id: 'plum', label: 'Plum', primaryHex: '#86198f' },
  { id: 'rose-pink', label: 'Rose Pink', primaryHex: '#be185d' },
  { id: 'midnight-black', label: 'Midnight Black', primaryHex: '#111827' },
];

export const DEFAULT_THEME_ID: ThemeId = 'navy-blue';

export function isValidThemeId(id: string): id is ThemeId {
  return (THEME_IDS as readonly string[]).includes(id);
}
