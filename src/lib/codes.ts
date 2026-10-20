/**
 * Company code generator.
 * Produces a unique human-transcribable code like "INFOBB2548" from a company
 * name. Super admin may also supply a custom code (validated separately).
 */

function slugify(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .join("");
}

/** Derive a prefix like "INFOBB" from "Infolink Broadband". */
export function companyPrefix(name: string): string {
  const s = slugify(name);
  if (s.length >= 6) return s.slice(0, 6);
  return s.padEnd(6, "X");
}

export const COMPANY_CODE_RE = /^[A-Z0-9]{4,12}$/;

export function isValidCompanyCode(code: string): boolean {
  return COMPANY_CODE_RE.test(code);
}

/** Random 4-digit numeric suffix, e.g. "2548". */
function suffix(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

/** Suggest a company code. Caller must verify uniqueness in DB. */
export function suggestCompanyCode(name: string): string {
  return `${companyPrefix(name)}${suffix()}`;
}

/** Franchise code, unique within the company: INFOBB2548-F01 */
export function franchiseCode(companyCode: string, index: number): string {
  return `${companyCode}-F${String(index).padStart(2, "0")}`;
}

/** Next CAF number for a company: INFOBB2548-CAF-000001 */
export function cafNumber(companyCode: string, seq: number): string {
  return `${companyCode}-CAF-${String(seq).padStart(6, "0")}`;
}
