import { Action, AppData, BrandRecord, CatalogBrand, RootTableChange } from "./types";

export const SEED_BRANDS: CatalogBrand[] = [
  { id: "brand_bbRDNMtVVPeqthpbpvJEiS", name: "BMW", aliases: ["BMW Group", "BMW OE"], category: "Automotive", website: "bmw.com", country: "Germany", source: "Built-in" },
  { id: "brand_r6SKqPwxGUKM4bRhMR5ZKm", name: "Toyota", aliases: ["Toyota Genuine", "Toyota Original", "Toyota OE"], category: "Automotive", website: "toyota.com", country: "Japan", source: "Built-in" },
  { id: "brand_y8d46CKfXBs4MFGY1oc63c", name: "ST Suspensions", aliases: ["ST Suspension", "ST"], category: "Performance", website: "stsuspensions.com", country: "Germany", source: "Built-in" },
  { id: "brand_uXCZVVTZv1Hk8BhLL8GcRU", name: "Daelim", aliases: ["Daelim Motor", "Daelim (Original OE)"], category: "Motorcycle", country: "South Korea", source: "Built-in" },
  { id: "brand_BxSPfBXkcDRkpq6iHpUMMU", name: "SYM", aliases: ["SYM (Original OE)"], category: "Motorcycle", country: "Taiwan", source: "Built-in" },
];

const PLACEHOLDERS = /^(details? in description|see description|unknown|unbranded|no brand|not applicable|n\/?a|generic|other)$/i;
const SELLER_PREFIX = /^(sold by|seller|store|shop)\s*[:\-]\s*/i;
const SUSPICIOUS_SYMBOLS = /[?¿‽!@#$%^*+=<>|~`]/u;

function distinctBrands(...groups: CatalogBrand[][]) {
  const brands = new Map<string, CatalogBrand>();
  groups.flat().forEach((brand) => { if (!brands.has(brand.id)) brands.set(brand.id, brand); });
  return [...brands.values()];
}

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

const GENERIC_MATCH_TOKENS = new Set([
  "auto", "automotive", "brand", "commercial", "company", "genuine", "group", "international", "motor", "motors",
  "original", "part", "parts", "performance", "product", "products", "quality", "series", "service", "services", "shop",
  "store", "supply", "system", "systems", "tool", "tools", "world",
]);

function brandTokens(value: string) {
  return normalizeBrand(value).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length >= 3 && !GENERIC_MATCH_TOKENS.has(token));
}

function editSimilarity(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let left = 1; left <= a.length; left += 1) {
    const current = [left];
    for (let right = 1; right <= b.length; right += 1) current[right] = Math.min(current[right - 1] + 1, previous[right] + 1, previous[right - 1] + (a[left - 1] === b[right - 1] ? 0 : 1));
    previous.splice(0, previous.length, ...current);
  }
  return 1 - previous[b.length] / Math.max(1, a.length, b.length);
}

export function assessMergeCompatibility(sourceName: string, targetName: string) {
  const source = normalizeBrand(sourceName).toLowerCase();
  const target = normalizeBrand(targetName).toLowerCase();
  if (!source || !target) return { safe: false, score: 0, reason: "Missing source or target name" };
  if (source === target) return { safe: true, score: 100, reason: "Exact normalized name" };
  const sourceTokens = brandTokens(source);
  const targetTokens = brandTokens(target);
  const shared = [...new Set(sourceTokens.filter((token) => targetTokens.includes(token)))];
  const fuzzy = similarity(source, target);
  const compactSource = source.replace(/[^\p{L}\p{N}]/gu, "");
  const compactTarget = target.replace(/[^\p{L}\p{N}]/gu, "");
  const bothSingleDistinctive = sourceTokens.length === 1 && targetTokens.length === 1;
  const spelling = editSimilarity(compactSource, compactTarget);
  const sharedCoverage = shared.length / Math.max(1, Math.min(sourceTokens.length, targetTokens.length));
  // Direction matters: an extended source such as "Toyota Camry" may resolve to
  // the shorter canonical "Toyota". A short source such as "NORM" must not be
  // absorbed by a longer, potentially unrelated target such as "NORM liners".
  const canonicalPrefix = source.length >= 4 && target.length >= 4 && source.startsWith(`${target} `);
  const safe = shared.length >= 2
    || (shared.length === 1 && sharedCoverage === 1 && (canonicalPrefix || fuzzy >= 0.88))
    || (bothSingleDistinctive && compactSource.length >= 5 && compactTarget.length >= 5 && spelling >= 0.75)
    || (!shared.length && compactSource.length >= 5 && compactTarget.length >= 5 && fuzzy >= 0.9);
  const score = Math.round(Math.max(fuzzy * 100, spelling * 100, sharedCoverage * 94, canonicalPrefix && shared.length ? 92 : 0));
  const reason = !sourceTokens.length || !targetTokens.length
    ? "The apparent overlap consists only of generic catalog words"
    : shared.length ? `${shared.length} distinctive token${shared.length === 1 ? "" : "s"} shared: ${shared.join(", ")}`
      : `${Math.round(fuzzy * 100)}% spelling similarity with no distinctive shared token`;
  return { safe, score, reason };
}

export function findRelatedUbqBrands(
  row: { id: string; name: string },
  rows: { id: string; name: string }[],
  limit = 6,
) {
  const original = normalizeBrand(row.name).toLowerCase();
  const tokens = original.split(/\s+/).filter((token) => token.length >= 3);
  const meaningful = tokens.filter((token) => !GENERIC_MATCH_TOKENS.has(token));
  if (!original || !meaningful.length) return [];
  return rows.flatMap((candidate) => {
    if (candidate.id === row.id) return [];
    const normalized = normalizeBrand(candidate.name).toLowerCase();
    if (!normalized) return [];
    const candidateTokens = normalized.split(/\s+/).filter((token) => token.length >= 3 && !GENERIC_MATCH_TOKENS.has(token));
    const shared = meaningful.filter((token) => candidateTokens.includes(token));
    const containment = shared.length / Math.max(1, Math.min(meaningful.length, candidateTokens.length));
    const phraseContained = original.length >= 5 && normalized.length >= 5 && (original.includes(normalized) || normalized.includes(original));
    const exact = original === normalized;
    const fuzzy = similarity(original, normalized);
    const score = exact ? 100 : phraseContained ? 94 : Math.round(Math.max(containment * 90, fuzzy * 92));
    if (score < 78 || !shared.length || (shared.length === 1 && containment < 1)) return [];
    const reason = exact ? "Same normalized UBQ name" : phraseContained ? "One UBQ name contains the other brand phrase" : `${shared.length} shared brand token${shared.length === 1 ? "" : "s"}`;
    return [{ id: candidate.id, name: candidate.name, score, reason }];
  }).sort((left, right) => right.score - left.score || left.name.length - right.name.length).slice(0, limit);
}

export function findPriorUbqFamilyMerge(
  row: { id: string; name: string },
  familyIds: Set<string>,
  history: BrandRecord[],
) {
  return history.find((candidate) => candidate.action === "MERGE"
    && candidate.targetId?.startsWith("brand_")
    && (familyIds.has(candidate.id) || findRelatedUbqBrands(row, [{ id: candidate.id, name: candidate.name }], 1).length > 0));
}

export function resolveRootBrandTarget(id: string, rootBrands: CatalogBrand[]) {
  const byId = new Map(rootBrands.map((brand) => [brand.id, brand]));
  const chain: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(id);
  while (current) {
    if (seen.has(current.id)) return { brand: undefined, chain: [...chain, current.id], circular: true };
    seen.add(current.id); chain.push(current.id);
    if (!current.sameAs) break;
    current = byId.get(current.sameAs);
  }
  if (!current || (current.rootStatus || "ACTIVE") !== "ACTIVE") return { brand: undefined, chain, circular: false };
  return { brand: current, chain, circular: false };
}

export function canonicalRootCatalog(rootBrands: CatalogBrand[]) {
  const active = new Map(rootBrands.filter((brand) => (brand.rootStatus || "ACTIVE") === "ACTIVE").map((brand) => [brand.id, { ...brand, aliases: [...brand.aliases] }]));
  rootBrands.forEach((brand) => {
    if (!brand.sameAs) return;
    const resolved = resolveRootBrandTarget(brand.id, rootBrands);
    if (!resolved.brand || resolved.circular) return;
    const canonical = active.get(resolved.brand.id);
    if (!canonical) return;
    canonical.aliases = [...new Set([...canonical.aliases, brand.name, ...brand.aliases].filter((alias) => alias.toLowerCase() !== canonical.name.toLowerCase()))];
  });
  return [...active.values()];
}

export function classifyBrand(
  raw: { id: string; name: string; listingCount?: number; skuCount?: number },
  data: AppData,
): BrandRecord {
  const normalized = normalizeBrand(raw.name);
  const settings = data.validationSettings;
  const result = (values: Omit<BrandRecord, keyof typeof raw | "normalized">): BrandRecord => ({ ...raw, normalized, ...values });
  const aliasesFor = (brand: CatalogBrand) => [...new Set([raw.name.trim(), normalized].filter((value) => value && value.toLowerCase() !== brand.name.toLowerCase() && !brand.aliases.some((alias) => alias.toLowerCase() === value.toLowerCase())))];

  if (settings.previousDecisions) {
    const learned = data.learned[normalized.toLowerCase()];
    if (learned) {
      const imported = learned.origin === "imported";
      const adminVerified = learned.verification === "ADMIN_VERIFIED";
      const learnedEvidence = adminVerified ? "Matched a decision verified by a later Admin source-table import" : imported ? "Matched the imported Previous Decisions CSV" : "Matched a prior reviewer override saved in the shared workspace";
      const learnedSource = adminVerified ? "Admin-verified previous decision" : imported ? "Previous Decisions CSV" : "Previous manual decision";
      if (learned.action === "MERGE" && learned.targetId && data.rootBrands.some((brand) => brand.id === learned.targetId)) {
        const resolved = resolveRootBrandTarget(learned.targetId, data.rootBrands);
        if (!resolved.brand) return result({ action: "SKIP", confidence: 45, reason: "The previous MERGE target is no longer an active canonical Root brand", evidence: [`Unsafe target chain: ${resolved.chain.join(" → ") || learned.targetId}`, resolved.circular ? "Circular sameAs chain detected" : "Target is blocked, inactive, or missing"], status: "needs-review", decisionSource: "Previous decision target check" });
        return result({ ...learned, targetId: resolved.brand.id, targetName: resolved.brand.name, confidence: 100, evidence: [learnedEvidence, ...(resolved.chain.length > 1 ? [`Canonical target chain: ${resolved.chain.join(" → ")}`] : [])], status: "ready", decisionSource: learnedSource, canonicalTargetChain: resolved.chain });
      }
      return result({ ...learned, confidence: 100, evidence: [learnedEvidence], status: "ready", decisionSource: learnedSource });
    }
  }

  if (settings.offlineRules && SUSPICIOUS_SYMBOLS.test(raw.name)) {
    return result({ action: "SKIP", confidence: 100, reason: "Contains a question mark or unsupported symbol", evidence: ["Matched local suspicious-symbol rule"], status: "ready", decisionSource: "Offline symbol rule" });
  }

  const historicalNameMatches = data.historicalMappings.filter((entry) => entry.normalized.toLowerCase() === normalized.toLowerCase());
  const historicalIdMatches = data.historicalMappings.filter((entry) => entry.sourceBrandId === raw.id);
  const historical = settings.historicalMappings
    ? (historicalIdMatches.length ? historicalIdMatches : historicalNameMatches.length === 1 ? historicalNameMatches : [])
      .sort((left, right) => right.date.localeCompare(left.date))[0]
    : undefined;
  if (historical?.action === "SKIP" || historical?.action === "DELETE") {
    return result({ action: historical.action, confidence: 100, reason: `Matched a prior ${historical.originalAction} decision from ${new Date(historical.date).toLocaleDateString()}`, evidence: [`Historical mapping: ${historical.brand} · ${historical.originalAction}`, `Source: ${historical.sourceFilename}`], status: "ready", decisionSource: "Historical mapping memory" });
  }
  if (historical?.action === "MERGE" && historical.targetBrandId) {
    const target = [...data.rootBrands, ...data.fpaBrands, ...data.customBrands].find((brand) => brand.id === historical.targetBrandId);
    if (target) return result({ action: "MERGE", targetId: target.id, targetName: historical.targetBrandName || target.name, confidence: 100, reason: `Matched a completed Alias decision by ${historical.reviewer || "the offline team"}`, evidence: [`Historical mapping: ${historical.brand} → ${historical.targetBrandName || target.name}`, historical.sourceBrandId ? `Unmapped BrandID: ${historical.sourceBrandId}` : "Matched by unique normalized name", `Source: ${historical.sourceFilename}`], status: "ready", decisionSource: "Historical mapping memory" });
  }

  const activeRootBrands = canonicalRootCatalog(data.rootBrands);
  const allBrands = distinctBrands(data.customBrands, activeRootBrands, SEED_BRANDS, data.acaBrands, data.fpaBrands);
  if (settings.aliasTable) {
    const aliasMatches = allBrands.filter((brand) => brand.aliases.some((item) => item.toLowerCase() === normalized.toLowerCase() || item.toLowerCase() === raw.name.trim().toLowerCase()));
    if (aliasMatches.length > 1) return result({ action: "SKIP", confidence: 40, reason: "Alias points to multiple existing BrandIDs and needs correction", evidence: aliasMatches.map((brand) => `${brand.name}: ${brand.id}`), status: "needs-review", decisionSource: "Alias conflict" });
    const alias = aliasMatches[0];
    if (alias) return result({ action: "MERGE", targetId: alias.id, targetName: alias.name, confidence: 100, reason: "Matched a known alias", evidence: [`Alias: ${raw.name} → ${alias.name}`, `${alias.source || "Local"} brand table`], status: "ready", decisionSource: "Alias table", suggestedAliases: aliasesFor(alias) });
  }

  const tableMatch = (brands: CatalogBrand[], source: "FPA" | "Root") => {
    const label = source === "Root" ? "existing brand table" : "FPA";
    const exact = brands.find((brand) => brand.name.toLowerCase() === normalized.toLowerCase());
    if (exact) return result({ action: "MERGE", targetId: exact.id, targetName: exact.name, confidence: 100, reason: `Exact match in the offline ${label}`, evidence: [`${label} exact match`, exact.id], status: "ready", decisionSource: source === "Root" ? "Brand table exact" : "FPA exact", suggestedAliases: aliasesFor(exact) });
    const normalizedLower = normalized.toLowerCase();
    const family = brands
      .filter((brand) => brand.name.trim().length >= 4 && normalizedLower.startsWith(`${brand.name.trim().toLowerCase()} `) && assessMergeCompatibility(normalized, brand.name).safe)
      .sort((a, b) => b.name.length - a.name.length)[0];
    if (family) return result({ action: "MERGE", targetId: family.id, targetName: family.name, confidence: 92, reason: `Likely model, product line, or extended name of an existing ${label} brand`, evidence: [`Canonical brand prefix: ${family.name}`, `${raw.name} → ${family.name}`, family.id], status: "needs-review", decisionSource: source === "Root" ? "Brand table family match" : "FPA family match", suggestedAliases: aliasesFor(family) });
    const fuzzy = brands.map((brand) => ({ brand, score: similarity(normalized, brand.name) })).sort((a, b) => b.score - a.score)[0];
    const fuzzyCompatibility = fuzzy ? assessMergeCompatibility(normalized, fuzzy.brand.name) : undefined;
    if (fuzzy && fuzzy.score >= 0.84 && fuzzyCompatibility?.safe) {
      const confidence = Math.round(fuzzy.score * 92);
      return result({ action: "MERGE", targetId: fuzzy.brand.id, targetName: fuzzy.brand.name, confidence, reason: `Possible fuzzy match in the offline ${label}`, evidence: [`${Math.round(fuzzy.score * 100)}% name similarity`, `${label} fuzzy match`], status: "needs-review", decisionSource: source === "Root" ? "Brand table fuzzy" : "FPA fuzzy", suggestedAliases: aliasesFor(fuzzy.brand) });
    }
    return undefined;
  };
  const rootIds = new Set(activeRootBrands.map((brand) => brand.id));
  const rootBrands = distinctBrands(data.customBrands.filter((brand) => rootIds.has(brand.id)), activeRootBrands);
  const fpaBrands = distinctBrands(data.customBrands, data.fpaBrands, SEED_BRANDS);
  if (settings.rootBrandTable) {
    const match = tableMatch(rootBrands, "Root");
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

  if (historical?.action === "MERGE") return result({ action: "SKIP", confidence: 92, reason: "Previously mapped as an Alias, but the historical file does not contain the target BrandID", evidence: [`Historical mapping: ${historical.brand} · ${historical.originalAction} · ${new Date(historical.date).toLocaleDateString()}`, "Choose a valid Root/FPA target before changing this to MERGE", `Source: ${historical.sourceFilename}`], status: "needs-review", decisionSource: "Historical alias evidence" });
  if (historical?.action === "CREATE") return result({ action: "CREATE", targetName: normalized, confidence: 90, reason: "Previously classified as a New Brand, but it was not found in the currently loaded Root/FPA tables", evidence: [`Historical mapping: ${historical.brand} · ${historical.originalAction} · ${new Date(historical.date).toLocaleDateString()}`, "Confirm the current Root table is complete before creating again", `Source: ${historical.sourceFilename}`], status: "needs-review", decisionSource: "Historical new-brand evidence" });

  if (settings.offlineRules) {
    if (!normalized || PLACEHOLDERS.test(normalized)) return { ...result({ action: "DELETE", confidence: 100, reason: "Placeholder text, not a brand", evidence: ["Matched local non-brand language rule"], status: "ready", decisionSource: "Offline rule" }), normalized: normalized || "—" };
    const suspicious = /\b(parts?|auto|motors?|outlet|store|shop|direct)\b/i.test(normalized) && normalized.split(" ").length > 2;
    if (suspicious) return result({ action: "SKIP", confidence: 70, reason: "Possible seller, retailer, or generic storefront", evidence: ["Matched local retailer wording rule"], status: "needs-review", decisionSource: "Offline rule" });
  }

  return result({ action: "CREATE", targetName: normalized, confidence: 65, reason: "No enabled local module found an existing brand", evidence: ["No previous, alias, existing-brand, ACA, or FPA match", "Offline fallback decision"], status: "needs-review", decisionSource: "Offline fallback" });
}

export function parseRows(text: string): string[][] {
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
    const idIndex = index("id", "brandid"); const nameIndex = index("name", "brandname"); const aliasIndex = index("aliases", "alias"); const sameAsIndex = index("sameas"); const sourceIndex = index("source"); const statusIndex = index("status");
    if (idIndex < 0 || nameIndex < 0) return [];
    rows.slice(1).forEach((row) => {
      const id = row[idIndex]?.trim(); const name = row[nameIndex]?.trim(); const status = statusIndex >= 0 ? row[statusIndex]?.trim().toUpperCase() : "ACTIVE";
      if (!id?.startsWith("brand_") || !name || status !== "ACTIVE") return;
      const aliases = aliasIndex >= 0 ? (row[aliasIndex] || "").split(",").map((alias) => alias.trim()).filter((alias) => alias && alias.toLowerCase() !== name.toLowerCase()) : [];
      result.set(id, { id, name, aliases: [...new Set(aliases)], category: "Automotive", source: "Root", sameAs: sameAsIndex >= 0 ? row[sameAsIndex]?.trim() || undefined : undefined, rootSource: sourceIndex >= 0 ? row[sourceIndex]?.trim() || undefined : undefined, rootStatus: status || "ACTIVE" });
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

export interface AiReviewChange {
  recordId: string;
  action: Action;
  targetId?: string;
  targetName?: string;
  confidence: number;
  reason: string;
  evidence: string[];
}

export interface AiReviewParseResult {
  changes: AiReviewChange[];
  errors: string[];
}

export function buildAiReviewPrompt(records: BrandRecord[]) {
  const rootCleanup = records.some((record) => record.workflowSource === "ROOT");
  const rows = records.map((record) => ({
    unmappedBrandId: record.id,
    unmappedBrandName: record.name,
    normalizedName: record.normalized,
    currentAction: record.action,
    currentTargetBrandId: record.targetId || null,
    currentTargetBrandName: record.targetName || null,
    currentConfidence: record.confidence,
    currentReason: record.reason,
    currentEvidence: record.evidence,
    relatedUbqNames: record.relatedUbq || [],
    suggestedUbqCanonical: record.ubqFamilyCanonicalId ? { unmappedBrandId: record.ubqFamilyCanonicalId, unmappedBrandName: record.ubqFamilyCanonicalName } : null,
    permittedMergeTarget: record.targetId?.startsWith("brand_") && record.targetName
      ? { targetBrandId: record.targetId, targetBrandName: record.targetName }
      : null,
  }));
  const example = {
    schemaVersion: "brandmaster.ai-review.v1",
    decisions: [{
      unmappedBrandId: "draft_brand_example",
      unmappedBrandName: "Example Brand",
      action: "CREATE",
      targetBrandId: null,
      targetBrandName: "Example Brand",
      confidence: 95,
      reason: "Real automotive fitment-product manufacturer confirmed by official sources.",
      evidence: ["https://manufacturer.example/automotive-catalog"],
    }],
  };
  return `You are validating automotive, motorcycle, marine, tractor, and heavy-equipment fitment brands for Brandmaster.

WORKFLOW: ${rootCleanup ? "ROOT TABLE CLEANUP. Input IDs are existing BrandIDs. Preserve them exactly. CREATE means keep or rename the record as canonical; MERGE means make it an alias of a different existing BrandID; DELETE means recommend blocking/deleting the source record; SKIP means no Root change." : "UNMAPPED BRAND TRIAGE. Input IDs are UBQ UnmappedBrandIDs used by the bulk mapping upload."}

Review every input row. Decide CREATE, MERGE, SKIP, or DELETE.

Rules:
- CREATE only for a real manufacturer or distinct product brand that sells fitment products.
- MERGE only when permittedMergeTarget is present. Copy that exact TargetBrandID and TargetBrandName. Never invent a brand ID.
- Do not MERGE because one generic word overlaps. Words such as performance, automotive, auto, parts, tools, quality, commercial, motors, and products are not identity evidence by themselves.
- A fuzzy MERGE needs an exact alias, a near-identical spelling, or distinctive brand tokens that identify the same company. JS Performance is not Performance Tool; EFI Automotive is not a brand named Automotive.
- A MERGE target must never equal the input row ID.
- relatedUbqNames are evidence that values may belong to one brand family, but their draft_brand_ IDs are never valid MERGE targets.
- When a UBQ family has no permittedMergeTarget, recommend one canonical CREATE at most; do not recommend duplicate CREATE decisions for its variations.
- If a brand probably needs MERGE but no permitted target is supplied, use SKIP with confidence below 90 and explain that a human must locate the canonical TargetBrandID.
- SKIP sellers, retailers, storefronts, generic businesses, ambiguous abbreviations, and brands unrelated to fitment products.
- DELETE placeholders, instructions, description text, and values that are clearly not brands.
- OEM wording such as OE, OEM, Genuine, and Original OE is not a separate brand.
- Search official manufacturer sources first when search tools are available. Marketplace listings are supporting evidence only.
- Confidence must be an integer from 0 to 100.
- Return exactly one decision for every input row, preserving each UnmappedBrandID and UnmappedBrandName exactly.
- For CREATE, TargetBrandID must be null and TargetBrandName must be the canonical brand name.
- For SKIP and DELETE, both target fields must be null.
- Return raw JSON only. Do not use Markdown fences or add commentary.

Required JSON shape:
${JSON.stringify(example, null, 2)}

INPUT ROWS:
${JSON.stringify(rows, null, 2)}`;
}

export function parseAiReviewJson(text: string, records: BrandRecord[], knownBrandIds: Set<string> = new Set()): AiReviewParseResult {
  const errors: string[] = [];
  const changes: AiReviewChange[] = [];
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let payload: unknown;
  try { payload = JSON.parse(cleaned); } catch { return { changes: [], errors: ["The response is not valid JSON."] }; }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { changes: [], errors: ["The JSON root must be an object with schemaVersion and decisions."] };
  const root = payload as Record<string, unknown>;
  if (root.schemaVersion !== "brandmaster.ai-review.v1") errors.push("schemaVersion must be brandmaster.ai-review.v1.");
  if (!Array.isArray(root.decisions)) return { changes: [], errors: [...errors, "decisions must be a JSON array."] };

  const byId = new Map(records.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const validActions = new Set<Action>(["CREATE", "MERGE", "SKIP", "DELETE"]);
  root.decisions.forEach((item, index) => {
    const label = `Decision ${index + 1}`;
    if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(`${label} must be an object.`); return; }
    const decision = item as Record<string, unknown>;
    const recordId = typeof decision.unmappedBrandId === "string" ? decision.unmappedBrandId.trim() : "";
    const record = byId.get(recordId);
    if (!record) { errors.push(`${label} has an unknown UnmappedBrandID: ${recordId || "missing"}.`); return; }
    if (seen.has(recordId)) { errors.push(`${label} duplicates ${recordId}.`); return; }
    seen.add(recordId);
    const returnedName = typeof decision.unmappedBrandName === "string" ? decision.unmappedBrandName.trim() : "";
    if (returnedName !== record.name.trim()) { errors.push(`${record.name}: UnmappedBrandName was changed.`); return; }
    const action = typeof decision.action === "string" ? decision.action.toUpperCase() as Action : "" as Action;
    if (!validActions.has(action)) { errors.push(`${record.name}: action must be CREATE, MERGE, SKIP, or DELETE.`); return; }
    const confidence = Number(decision.confidence);
    if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) { errors.push(`${record.name}: confidence must be an integer from 0 to 100.`); return; }
    const reason = typeof decision.reason === "string" ? decision.reason.trim() : "";
    if (!reason) { errors.push(`${record.name}: reason is required.`); return; }
    const evidence = Array.isArray(decision.evidence) ? decision.evidence.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()) : [];
    const targetId = typeof decision.targetBrandId === "string" ? decision.targetBrandId.trim() : "";
    const targetName = typeof decision.targetBrandName === "string" ? decision.targetBrandName.trim() : "";

    if (action === "MERGE") {
      if (!targetId.startsWith("brand_") || !targetName) { errors.push(`${record.name}: MERGE requires a real TargetBrandID and TargetBrandName.`); return; }
      if (targetId === record.id) { errors.push(`${record.name}: MERGE cannot target the same source BrandID.`); return; }
      if (!knownBrandIds.has(targetId)) { errors.push(`${record.name}: MERGE target ${targetId} is not in the loaded local brand tables.`); return; }
      const compatibility = assessMergeCompatibility(record.name, targetName);
      const trustedExistingMatch = record.action === "MERGE" && record.targetId === targetId && ["Alias table", "Brand table exact", "FPA exact", "Previous manual decision", "Admin-verified previous decision"].includes(record.decisionSource);
      if (!compatibility.safe && !trustedExistingMatch) { errors.push(`${record.name}: weak MERGE to ${targetName}. ${compatibility.reason}. Choose CREATE/SKIP or manually select and override a verified alias.`); return; }
    } else if (targetId) { errors.push(`${record.name}: only MERGE may contain TargetBrandID.`); return; }
    if (action === "CREATE" && !targetName) { errors.push(`${record.name}: CREATE requires TargetBrandName.`); return; }
    if ((action === "SKIP" || action === "DELETE") && targetName) { errors.push(`${record.name}: ${action} cannot contain TargetBrandName.`); return; }
    changes.push({ recordId, action, targetId: action === "MERGE" ? targetId : undefined, targetName: action === "MERGE" || action === "CREATE" ? targetName : undefined, confidence, reason, evidence });
  });

  records.forEach((record) => { if (!seen.has(record.id)) errors.push(`${record.name}: decision is missing from the JSON.`); });
  return { changes, errors };
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

export interface BulkExportReadiness {
  ready: boolean;
  invalidIds: BrandRecord[];
  needsReview: BrandRecord[];
  incompleteMerges: BrandRecord[];
  incompleteCreates: BrandRecord[];
  duplicateSourceMappings: BrandRecord[];
}

/** The admin-tool CSV contract is intentionally kept separate from these safety checks. */
export function getBulkExportReadiness(records: BrandRecord[]): BulkExportReadiness {
  const invalidIds = records.filter((record) => !record.ubqVerified || !record.id.startsWith("draft_brand_"));
  const needsReview = records.filter((record) => record.status === "needs-review");
  const incompleteMerges = records.filter((record) => record.action === "MERGE" && (!record.targetId?.startsWith("brand_") || !record.targetName?.trim() || (!record.mergeOverride && record.decisionSource === "AI review JSON" && !assessMergeCompatibility(record.name, record.targetName || "").safe)));
  const incompleteCreates = records.filter((record) => record.action === "CREATE" && !record.targetName?.trim());
  const sourceCounts = new Map<string, number>();
  records.forEach((record) => sourceCounts.set(record.id, (sourceCounts.get(record.id) || 0) + 1));
  const duplicateSourceMappings = records.filter((record) => (sourceCounts.get(record.id) || 0) > 1);
  return {
    ready: records.length > 0 && invalidIds.length === 0 && needsReview.length === 0 && incompleteMerges.length === 0 && incompleteCreates.length === 0 && duplicateSourceMappings.length === 0,
    invalidIds,
    needsReview,
    incompleteMerges,
    incompleteCreates,
    duplicateSourceMappings,
  };
}

export interface CatalogConflict {
  value: string;
  brandIds: string[];
  brandNames: string[];
  kind: "ALIAS" | "CANONICAL" | "ALIAS_AND_CANONICAL";
}

export function findCatalogConflicts(brands: CatalogBrand[]): CatalogConflict[] {
  const occurrences = new Map<string, { value: string; brands: Map<string, CatalogBrand>; canonicalIds: Set<string>; aliasIds: Set<string> }>();
  brands.forEach((brand) => {
    const add = (value: string, canonical: boolean) => {
      const key = normalizeBrand(value).toLowerCase();
      if (!key) return;
      const item = occurrences.get(key) || { value, brands: new Map(), canonicalIds: new Set(), aliasIds: new Set() };
      item.brands.set(brand.id, brand);
      (canonical ? item.canonicalIds : item.aliasIds).add(brand.id);
      occurrences.set(key, item);
    };
    add(brand.name, true);
    brand.aliases.forEach((alias) => add(alias, false));
  });
  return [...occurrences.values()]
    .filter((item) => item.brands.size > 1)
    .map((item) => {
      const kind: CatalogConflict["kind"] = item.canonicalIds.size > 1 ? "CANONICAL" : item.canonicalIds.size && item.aliasIds.size ? "ALIAS_AND_CANONICAL" : "ALIAS";
      return { value: item.value, brandIds: [...item.brands.keys()], brandNames: [...item.brands.values()].map((brand) => brand.name), kind };
    })
    .sort((a, b) => a.value.localeCompare(b.value));
}

export function adminBrandUrl(id: string, name: string) {
  const base = "https://myfitmentadminui.muse.vip.ebay.com/brand";
  return `${base}/${encodeURIComponent(id.trim())}?name=${encodeURIComponent(name.trim())}`;
}

export function adminUnknownBrandUrl(name: string) {
  return `https://myfitmentadminui.muse.vip.ebay.com/unknown-brand-queue?name=${encodeURIComponent(name.trim())}`;
}

export function reconcileRootRecommendations(brands: CatalogBrand[], changes: Record<string, RootTableChange>, checkedAt = new Date().toISOString()) {
  const imported = new Map(brands.map((brand) => [brand.id, brand]));
  const reconciled = { ...changes };
  Object.values(changes).forEach((change) => {
    if (change.adminStatus === "REJECTED" || change.adminStatus === "SUPERSEDED") {
      reconciled[change.id] = { ...change, lastCheckedAt: checkedAt };
      return;
    }
    const sourceBrand = imported.get(change.id);
    const sourceStatus = sourceBrand?.rootStatus || "ACTIVE";
    const sourceAliases = [...(sourceBrand?.aliases || [])].map((value) => value.toLowerCase()).sort().join("|");
    const targetAliases = [...change.after.aliases].map((value) => value.toLowerCase()).sort().join("|");
    const applied = change.after.sameAs
      ? !sourceBrand || sourceBrand.sameAs === change.after.sameAs || sourceStatus === "INACTIVE" || sourceStatus === "BLOCKED"
      : change.after.rootStatus === "BLOCKED"
        ? !sourceBrand || sourceStatus === "BLOCKED"
        : Boolean(sourceBrand
          && (!change.changedFields.includes("name") || sourceBrand.name === change.after.name)
          && (!change.changedFields.includes("aliases") || sourceAliases === targetAliases));
    reconciled[change.id] = { ...change, status: applied ? "APPLIED" : "PENDING", lastCheckedAt: checkedAt, adminStatus: applied ? "VERIFIED" : change.adminStatus || "RECOMMENDED", verificationNote: applied ? "Verified against the latest Root table import" : change.adminStatus === "COMPLETED" ? "Marked completed in Admin, but the latest Root import does not show the full recommendation yet" : change.verificationNote };
    if (!applied) imported.set(change.id, change.after);
  });
  return { rootBrands: [...imported.values()], rootChanges: reconciled };
}

export function toRootChangesCsv(changes: RootTableChange[]) {
  const header = ["aliases", "id", "name", "sameAs", "source", "status"];
  return [header.join(","), ...changes.map(({ after }) => [
    after.aliases.join(","),
    after.id,
    after.name,
    after.sameAs || "",
    after.rootSource || "BRANDMASTER",
    after.rootStatus || "ACTIVE",
  ].map(escapeCsv).join(","))].join("\n");
}
