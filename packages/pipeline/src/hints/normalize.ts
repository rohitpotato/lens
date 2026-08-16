/**
 * Normalize a vendor name for prompt_hints.matching_key lookup.
 * Same normalization used by Phase 5 entity resolution — kept here for now,
 * moves to a shared `@lens/entities` module when we add pgvector.
 */
const SUFFIXES = [
  'inc',
  'incorporated',
  'llc',
  'l l c',
  'ltd',
  'limited',
  'pvt',
  'private',
  'corp',
  'corporation',
  'co',
  'company',
  'gmbh',
  'ab',
  'sa',
  'plc',
];

export function normalizeVendor(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = raw.toLowerCase().replace(/[^\w\s]/g, ' ').replace(/\s+/g, ' ').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suf of SUFFIXES) {
      if (s.endsWith(' ' + suf)) {
        s = s.slice(0, s.length - suf.length - 1).trim();
        changed = true;
      }
    }
  }
  return s;
}
