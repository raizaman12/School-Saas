/**
 * Derives a short, human-recognizable prefix for a tenant's auto-generated
 * IDs (student admission codes, employee codes) from its school name — so
 * "Educator School" mints IDs like `EDU-2026-000001` instead of a bare,
 * unbranded `2026-000001` that looks identical across every school on the
 * platform. Multi-word names use initials (e.g. "City Model School" ->
 * "CMS"); a single word uses its first few letters (e.g. "Educator" ->
 * "EDU"). Purely cosmetic/for readability — never used for lookups or
 * uniqueness (that's still the tenant-scoped sequence number), so it does
 * not need to be globally unique across tenants.
 */
export function deriveTenantCode(schoolName: string): string {
  const words = schoolName
    .split(/\s+/)
    .map((w) => w.replace(/[^a-zA-Z]/g, ''))
    .filter((w) => w.length > 0);

  let code: string;
  if (words.length >= 2) {
    code = words
      .slice(0, 6)
      .map((w) => w[0])
      .join('');
  } else if (words.length === 1) {
    code = words[0].slice(0, 3);
  } else {
    code = '';
  }

  code = code.toUpperCase();
  return code.length >= 2 ? code : 'SCH';
}
