import { Action, AppData, BrandRecord, CatalogBrand } from "./types";

export const SEED_BRANDS: CatalogBrand[] = [
  { id: "brand_bbRDNMtVVPeqthpbpvJEiS", name: "BMW", aliases: ["BMW Group", "BMW OE"], category: "Automotive", website: "bmw.com", country: "Germany", source: "Built-in" },
  { id: "brand_r6SKqPwxGUKM4bRhMR5ZKm", name: "Toyota", aliases: ["Toyota Genuine", "Toyota Original", "Toyota OE"], category: "Automotive", website: "toyota.com", country: "Japan", source: "Built-in" },
  { id: "brand_y8d46CKfXBs4MFGY1oc63c", name: "ST Suspensions", aliases: ["ST Suspension", "ST"], category: "Performance", website: "stsuspensions.com", country: "Germany", source: "Built-in" },
  { id: "brand_uXCZVVTZv1Hk8BhLL8GcRU", name: "Daelim", aliases: ["Daelim Motor", "Daelim (Original OE)"], category: "Motorcycle", country: "South Korea", source: "Built-in" },
  { id: "brand_BxSPfBXkcDRkpq6iHpUMMU", name: "SYM", aliases: ["SYM (Original OE)"], category: "Motorcycle", country: "Taiwan", source: "Built-in" },
];

const PLACEHOLDERS = /^(details? in description|see description|unknown|unbranded|no brand|not applicable|n\/?a|generic|other)$/i;
const SELLER_PREFIX = /^(sold by|seller|store|shop)\s*[:\-]\s*/i;

export function normalizeBrand(input: string): string {
  let name = input.normalize("NFKC").trim().replace(SELLER_PREFIX, "");
  name = name.replace(/\\+|\/+|_+/g, " ");
  name = name.replace(/[()[\]{}]/g, " ");
  name = name.replace(/\b(original\s+oe|genuine|oem|oe)\b/gi, " ");
  name = name.replace(/[^\p{L}\p{N}&+.'-]+/gu, " ").replace(/\s+/g, " ").trim();
  const corrections: Record<string, string> = {
    "st suspension": "ST Suspensions",
    "eda cooling": "EDA Cooling",
  };
  return corrections[name.toLowerCase()] || name;
}

function similarity(a: string, b: string) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 1;
  const bigrams = (s: string) => new Set(Array.from({ length: Math.max(0, s.length - 1) }, (_, i) => s.slice(i, i + 2)));
  const ax = bigrams(x);
  const by = bigrams(y);
  if (!ax.size || !by.size) return 0;
  let overlap = 0;
  ax.forEach((part) => { if (by.has(part)) overlap += 1; });
  return (2 * overlap) / (ax.size + by.size);
}

export function classifyBrand(
  raw: { id: string; name: string; listingCount?: number; skuCount?: number },
  data: AppData,
): BrandRecord {
  const normalized = normalizeBrand(raw.name);
  const settings = data.validationSettings;
  const result = (values: Omit<BrandRecord, keyof typeof raw | "normalized">): BrandRecord => ({ ...raw, normalized, ...values });

  if (settings.previousDecisions) {
    const learned = data.learned[normalized.toLowerCase()];
    if (learned) {
      const imported = learned.origin === "imported";
      return result({ ...learned, confidence: 100, evidence: [imported ? "Matched the imported Previous Decisions CSV" : "Matched a prior reviewer override saved on this device"], status: "ready", decisionSource: imported ? "Previous Decisions CSV" : "Previous manual decision" });
    }
  }

  const allBrands = [...data.rootBrands, ...SEED_BRANDS, ...data.customBrands, ...data.acaBrands, ...data.fpaBrands];
  if (settings.aliasTable) {
    const alias = allBrands.find((brand) => brand.aliases.some((item) => item.toLowerCase() === normalized.toLowerCase() || item.toLowerCase() === raw.name.trim().toLowerCase()));
    if (alias) return result({ action: "MERGE", targetId: alias.id, targetName: alias.name, confidence: 100, reason: "Matched a known alias", evidence: [`Alias: ${raw.name} → ${alias.name}`, `${alias.source || "Local"} brand table`], status: "ready", decisionSource: "Alias table" });
  }

  const tableMatch = (brands: CatalogBrand[], source: "FPA" | "Root") => {
    const label = source === "Root" ? "existing brand table" : "FPA";
    const exact = brands.find((brand) => brand.name.toLowerCase() === normalized.toLowerCase());
    if (exact) return result({ action: "MERGE", targetId: exact.id, targetName: exact.name, confidence: 100, reason: `Exact match in the offline ${label}`, evidence: [`${label} exact match`, exact.id], status: "ready", decisionSource: source === "Root" ? "Brand table exact" : "FPA exact" });
    const fuzzy = brands.map((brand) => ({ brand, score: similarity(normalized, brand.name) })).sort((a, b) => b.score - a.score)[0];
    if (fuzzy && fuzzy.score >= 0.72) {
      const confidence = Math.round(fuzzy.score * 92);
      return result({ action: "MERGE", targetId: fuzzy.brand.id, targetName: fuzzy.brand.name, confidence, reason: `Possible fuzzy match in the offline ${label}`, evidence: [`${Math.round(fuzzy.score * 100)}% name similarity`, `${label} fuzzy match`], status: "needs-review", decisionSource: source === "Root" ? "Brand table fuzzy" : "FPA fuzzy" });
    }
    return undefined;
  };
  const fpaBrands = [...SEED_BRANDS, ...data.fpaBrands, ...data.customBrands];
  if (settings.rootBrandTable) {
    const match = tableMatch(data.rootBrands, "Root");
    if (match) return match;
  }
  if (settings.acaTable) {
    const exact = data.acaBrands.find((brand) => brand.name.toLowerCase() === normalized.toLowerCase());
    if (exact) {
      const fpa = fpaBrands.find((brand) => brand.name.toLowerCase() === exact.name.toLowerCase());
      if (fpa) return result({ action: "MERGE", targetId: fpa.id, targetName: fpa.name, confidence: 100, reason: "ACA manufacturer cross-referenced to an FPA canonical brand", evidence: [`ACA BrandID: ${exact.id}`, `FPA BrandID: ${fpa.id}`], status: "ready", decisionSource: "ACA + FPA" });
      return result({ action: "CREATE", targetName: exact.name, confidence: 96, reason: "Confirmed in ACA but no FPA canonical brand exists", evidence: [`ACA exact match: ${exact.id}`, "No FPA cross-reference"], status: "ready", decisionSource: "ACA exact" });
    }
    const fuzzy = data.acaBrands.map((brand) => ({ brand, score: similarity(normalized, brand.name) })).sort((a, b) => b.score - a.score)[0];
    if (fuzzy && fuzzy.score >= 0.72) return result({ action: "CREATE", targetName: fuzzy.brand.name, confidence: Math.round(fuzzy.score * 88), reason: "Possible brand or sub-brand match in the ACA table", evidence: [`ACA BrandID: ${fuzzy.brand.id}`, `${Math.round(fuzzy.score * 100)}% name similarity`], status: "needs-review", decisionSource: "ACA fuzzy" });
  }
  if (settings.fpaTable) {
    const match = tableMatch(fpaBrands, "FPA");
    if (match) return match;
  }

  if (settings.offlineRules) {
    if (!normalized || PLACEHOLDERS.test(normalized)) return { ...result({ action: "DELETE", confidence: 100, reason: "Placeholder text, not a brand", evidence: ["Matched local non-brand language rule"], status: "ready", decisionSource: "Offline rule" }), normalized: normalized || "—" };
    const suspicious = /\b(parts?|auto|motors?|outlet|store|shop|direct)\b/i.test(normalized) && normalized.split(" ").length > 2;
    if (suspicious) return result({ action: "SKIP", confidence: 70, reason: "Possible seller, retailer, or generic storefront", evidence: ["Matched local retailer wording rule"], status: "needs-review", decisionSource: "Offline rule" });
  }

  return result({ action: "CREATE", targetName: normalized, confidence: 65, reason: "No enabled local module found an existing brand", evidence: ["No previous, alias, existing-brand, ACA, or FPA match", "Offline fallback decision"], status: "needs-review", decisionSource: "Offline fallback" });
}

function parseRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(field.trim()); field = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field.trim()); if (row.some(Boolean)) rows.push(row); row = []; field = "";
    } else field += char;
  }
  row.push(field.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

export function parseCsv(text: string): { id: string; name: string; listingCount?: number; skuCount?: number }[] {
  const rows = parseRows(text);
  if (!rows.length) return [];
  const lower = rows[0].map((h) => h.toLowerCase().replace(/[^a-z]/g, ""));
  const idIndex = lower.findIndex((h) => ["unmappedbrandid", "draftbrandid", "brandid"].includes(h));
  const nameIndex = lower.findIndex((h) => ["unmappedbrandname", "brandname", "brand"].includes(h));
  const listingIndex = lower.findIndex((h) => h === "listingcount" || h === "sellercount");
  const skuIndex = lower.findIndex((h) => h === "skucount");
  const hasHeader = idIndex >= 0 || nameIndex >= 0;
  const dataRows = hasHeader ? rows.slice(1) : rows;
  const idCol = idIndex >= 0 ? idIndex : 0;
  const nameCol = nameIndex >= 0 ? nameIndex : 1;
  return dataRows.filter((r) => r[nameCol]).map((r, index) => ({
    id: r[idCol] || `missing_id_${String(index + 1).padStart(5, "0")}`,
    name: r[nameCol],
    listingCount: listingIndex >= 0 ? Number(r[listingIndex]) || undefined : undefined,
    skuCount: skuIndex >= 0 ? Number(r[skuIndex]) || undefined : undefined,
  }));
}

export function parseReferenceCsv(text: string, source: "ACA" | "FPA" | "ROOT"): CatalogBrand[] {
  const rows = parseRows(text);
  if (!rows.length) return [];
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z]/g, ""));
  const index = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const result = new Map<string, CatalogBrand>();

  if (source === "FPA") {
    const idIndex = index("id", "brandid");
    const nameIndex = index("name", "brandname");
    const aliasIndex = index("aliases", "alias");
    if (idIndex < 0 || nameIndex < 0) return [];
    rows.slice(1).forEach((row) => {
      const id = row[idIndex]?.trim(); const name = row[nameIndex]?.trim(); const alias = aliasIndex >= 0 ? row[aliasIndex]?.trim() : "";
      if (!id?.startsWith("brand_") || !name) return;
      const existing = result.get(id) || { id, name, aliases: [], category: "Automotive", source: "FPA" as const };
      if (alias && alias.toLowerCase() !== name.toLowerCase() && !existing.aliases.some((item) => item.toLowerCase() === alias.toLowerCase())) existing.aliases.push(alias);
      result.set(id, existing);
    });
  } else if (source === "ROOT") {
    const idIndex = index("id", "brandid"); const nameIndex = index("name", "brandname"); const aliasIndex = index("aliases", "alias"); const statusIndex = index("status");
    if (idIndex < 0 || nameIndex < 0) return [];
    rows.slice(1).forEach((row) => {
      const id = row[idIndex]?.trim(); const name = row[nameIndex]?.trim(); const status = statusIndex >= 0 ? row[statusIndex]?.trim().toUpperCase() : "ACTIVE";
      if (!id?.startsWith("brand_") || !name || status !== "ACTIVE") return;
      const aliases = aliasIndex >= 0 ? (row[aliasIndex] || "").split(",").map((alias) => alias.trim()).filter((alias) => alias && alias.toLowerCase() !== name.toLowerCase()) : [];
      result.set(id, { id, name, aliases: [...new Set(aliases)], category: "Automotive", source: "Root" });
    });
  } else {
    const brandIdIndex = index("brandid"); const brandNameIndex = index("brandname");
    const subIdIndex = index("subbrandid"); const subNameIndex = index("subbrandname");
    if (brandIdIndex < 0 || brandNameIndex < 0) return [];
    rows.slice(1).forEach((row) => {
      const id = row[brandIdIndex]?.trim(); const name = row[brandNameIndex]?.trim();
      if (id && name && !result.has(id)) result.set(id, { id, name, aliases: [], category: "Automotive", source: "ACA" });
      const subId = subIdIndex >= 0 ? row[subIdIndex]?.trim() : ""; const subName = subNameIndex >= 0 ? row[subNameIndex]?.trim() : "";
      if (subId && subName && !result.has(subId)) result.set(subId, { id: subId, name: subName, aliases: [], category: "Automotive sub-brand", source: "ACA" });
    });
  }
  return [...result.values()];
}

export function parseDecisionCsv(text: string): { decisions: AppData["learned"]; imported: number; skipped: number; conflicts: number } {
  const rows = parseRows(text);
  if (!rows.length) return { decisions: {}, imported: 0, skipped: 0, conflicts: 0 };
  const headers = rows[0].map((header) => header.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z]/g, ""));
  const index = (...names: string[]) => headers.findIndex((header) => names.includes(header));
  const brandIndex = index("listingbrand", "unmappedbrandname", "brandname");
  const actionIndex = index("action"); const targetIndex = index("mergetarget", "targetbrandname"); const idIndex = index("fpabrandid", "targetbrandid");
  if (brandIndex < 0 || actionIndex < 0) return { decisions: {}, imported: 0, skipped: Math.max(0, rows.length - 1), conflicts: 0 };
  const allowed = new Set<Action>(["CREATE", "MERGE", "SKIP", "DELETE"]); const candidates = new Map<string, AppData["learned"][string]>(); const conflicted = new Set<string>(); let skipped = 0;
  rows.slice(1).forEach((row) => {
    const brand = row[brandIndex]?.trim(); const action = row[actionIndex]?.trim().toUpperCase() as Action; const targetName = targetIndex >= 0 ? row[targetIndex]?.trim() : ""; const targetId = idIndex >= 0 ? row[idIndex]?.trim() : "";
    if (!brand || !allowed.has(action) || (action === "MERGE" && (!targetId?.startsWith("brand_") || !targetName))) { skipped += 1; return; }
    const key = normalizeBrand(brand).toLowerCase(); const decision = { action, targetId: action === "MERGE" ? targetId : undefined, targetName: action === "MERGE" ? targetName : action === "CREATE" ? normalizeBrand(brand) : undefined, reason: "Imported from Previous Decisions CSV", reviewedAt: new Date().toISOString(), origin: "imported" as const };
    const existing = candidates.get(key);
    if (existing && JSON.stringify([existing.action, existing.targetId, existing.targetName]) !== JSON.stringify([decision.action, decision.targetId, decision.targetName])) { conflicted.add(key); candidates.delete(key); return; }
    if (!conflicted.has(key)) candidates.set(key, decision);
  });
  return { decisions: Object.fromEntries(candidates), imported: candidates.size, skipped, conflicts: conflicted.size };
}

const escapeCsv = (value: unknown) => `"${String(value ?? "").replaceAll('"', '""')}"`;
export function toCsv(records: BrandRecord[]) {
  const header = ["UnmappedBrandID", "UnmappedBrandName", "Action", "TargetBrandID", "TargetBrandName"];
  return [header.join(","), ...records.map((r) => [
    r.id,
    r.name,
    r.action,
    r.action === "MERGE" ? r.targetId : "",
    r.action === "MERGE" || r.action === "CREATE" ? (r.targetName || r.normalized) : "",
  ].map(escapeCsv).join(","))].join("\n");
}
