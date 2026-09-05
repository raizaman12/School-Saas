/**
 * Turns free text into a URL/slug-safe string: lowercase, non-alphanumeric
 * runs collapsed to a single hyphen, leading/trailing hyphens trimmed.
 * Deliberately produces the exact same charset `slugSchema` accepts (see
 * auth.validation.ts) — lowercase letters, numbers, hyphens, no leading/
 * trailing/doubled hyphens — so a derived slug never needs a second pass
 * to become valid.
 *
 * Used by multi-branch signup (auth.service.ts's signupMultiBranch) to
 * derive each branch's own internal tenant slug from the group slug plus
 * the branch name (e.g. group "alpha-schools" + branch "DHA Campus" ->
 * "alpha-schools-dha-campus").
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
