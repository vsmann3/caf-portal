export const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024;
export const DOCUMENT_OPTIONS = [
  ["PASSPORT_PHOTO", "Customer photo"],
  ["ID_PROOF", "Identity proof"],
  ["ADDRESS_PROOF", "Address proof"],
  ["GST_CERTIFICATE", "GST certificate"],
  ["SIGNED_CAF", "Signed CAF / declaration"],
  ["BUSINESS_PROOF", "Business proof"],
  ["BANK_PROOF", "Payment proof"],
  ["OTHER", "Other"],
] as const;

export function usernameCandidates(name: string, mobile: string): string[] {
  const first = name.trim().split(/\s+/)[0] ?? "";
  const prefix =
    first
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "")
      .slice(0, 40) || "customer";
  if (!/^[6-9]\d{9}$/.test(mobile)) return [];
  return Array.from({ length: 6 }, (_, i) => prefix + mobile.slice(-(5 + i)));
}
