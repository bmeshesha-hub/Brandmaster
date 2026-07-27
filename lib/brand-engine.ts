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
    const exactLedger = data.ledger
      .filter((entry) => entry.workflowSource !== "ROOT" && entry.id === raw.id)
      .sort((left, right) => right.date.localeCompare(left.date))[0];
    const selectedExactHistory = Boolean(exactLedger && (!learned || exactLedger.date >= learned.reviewedAt));
    const previous = selectedExactHistory
      ? { action: exactLedger.action, targetId: exactLedger.targetId, targetName: exactLedger.targetName, reason: exactLedger.reason, reviewedAt: exactLedger.date, reviewer: exactLedger.reviewer, origin: "manual" as const, verification: undefined }
      : learned;
    if (previous) {
      const previousDecision = { action: previous.action, targetId: previous.targetId, targetName: previous.targetName, reviewedAt: previous.reviewedAt, reviewer: "reviewer" in previous ? previous.reviewer : undefined };
      const learned = previous;
      const imported = learned.origin === "imported";
      const adminVerified = learned.verification === "ADMIN_VERIFIED";
      const learnedEvidence = adminVerified ? "Matched a decision verified by a later Admin source-table import" : imported ? "Matched the imported Previous Decisions CSV" : selectedExactHistory ? `Matched this exact UnmappedBrandID in review history from ${new Date(previous.reviewedAt).toLocaleDateString()}` : "Matched a prior reviewer override saved in the shared workspace";
      const learnedSource = adminVerified ? "Admin-verified previous decision" : imported ? "Previous Decisions CSV" : selectedExactHistory ? "Exact prior BrandID decision" : "Previous manual decision";
      if (learned.action === "MERGE" && learned.targetId && data.rootBrands.some((brand) => brand.id === learned.targetId)) {
        const resolved = resolveRootBrandTarget(learned.targetId, data.rootBrands);
        if (!resolved.brand) return result({ action: "SKIP", confidence: 45, reason: "The previous MERGE target is no longer an active canonical Root brand", evidence: [`Unsafe target chain: ${resolved.chain.join(" → ") || learned.targetId}`, resolved.circular ? "Circular sameAs chain detected" : "Target is blocked, inactive, or missing"], status: "needs-review", decisionSource: "Previous decision target check", previousDecision });
        return result({ ...learned, targetId: resolved.brand.id, targetName: resolved.brand.name, confidence: 100, evidence: [learnedEvidence, ...(resolved.chain.length > 1 ? [`Canonical target chain: ${resolved.chain.join(" → ")}`] : [])], status: "ready", decisionSource: learnedSource, canonicalTargetChain: resolved.chain, previousDecision });
      }
      return result({ ...learned, confidence: 100, evidence: [learnedEvidence], status: "ready", decisionSource: learnedSource, previousDecision });
    }
  }

  if (settings.offlineRules && SUSPICIOUS_SYMBOLS.test(raw.name)) {
    return result({ action: "SKIP", confidence: 100, reason: "Contains a question mark or unsupported symbol", evidence: ["Matched local suspicious-symbol rule"], status: "ready", decisionSource: "Offline symbol rule" });
  }

  const currentNotDoneAt = (data.manualFpaIds || [])
    .filter((reference) => reference.ubq === true && (reference.sourceBrandId === raw.id || reference.normalized.toLowerCase() === normalized.toLowerCase()))
    .map((reference) => reference.importedAt)
    .sort()
    .at(-1);
  const completedHistory = data.historicalMappings.filter((entry) => entry.ubq !== true && (!currentNotDoneAt || entry.date > currentNotDoneAt));
  const historicalNameMatches = completedHistory.filter((entry) => entry.normalized.toLowerCase() === normalized.toLowerCase());
  const historicalIdMatches = completedHistory.filter((entry) => entry.sourceBrandId === raw.id);
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
  // Choose the file delimiter from the first record only. Free-text fields in a
  // large comma-separated export may legitimately contain tab characters.
  const firstRecord = text.split(/\r?\n/, 1)[0];
  const delimiter = firstRecord.includes("\t") && !firstRecord.includes(",") ? "\t" : ",";
  let row: string[] = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { field += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === delimiter && !quoted) { row.push(field.trim()); field = ""; }
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
  const lower = rows[0].map((h) => h.replace(/^\uFEFF/, "").toLowerCase().replace(/[^a-z]/g, ""));
  const idIndex = lower.findIndex((h) => ["unmappedbrandid", "draftbrandid", "brandid"].includes(h));
  const nameIndex = lower.findIndex((h) => ["unmappedbrandname", "brandname", "brand", "listingbrand"].includes(h));
  const listingIndex = lower.findIndex((h) => ["listingcount", "sellercount", "livelistings"].includes(h));
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

/**
 * Accepts plain one-name-per-line input or rows pasted directly from the shared
 * Manual FPA spreadsheet. Spreadsheet-only columns are ignored; the source
 * brand name and exact draft_brand_ ID are preserved.
 */
export function parsePastedBrands(text: string, mode: "auto" | "names" | "spreadsheet" = "auto"): ReturnType<typeof parseCsv> {
  const containsEmbeddedDraftIds = /\bdraft_brand_[A-Za-z0-9]+\b/.test(text);
  if (mode === "names" && !containsEmbeddedDraftIds) {
    const unique = new Map<string, string>();
    text.split(/\r?\n/).map((name) => name.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim()).filter(Boolean).forEach((name) => {
      const key = normalizeBrand(name).toLowerCase();
      if (key && !unique.has(key)) unique.set(key, name);
    });
    return [...unique.values()].map((name, index) => ({ id: `missing_id_${String(index + 1).padStart(5, "0")}`, name }));
  }
  const rows = parseRows(text);
  if (!rows.length) return [];
  const clean = (value = "") => value.replace(/^\uFEFF/, "").replace(/\*\*/g, "").trim();
  const headerKey = (value = "") => clean(value).toLowerCase().replace(/[^a-z]/g, "");
  const headerRow = rows.findIndex((row) => row.some((cell) => ["listingbrand", "unmappedbrandname", "brandname"].includes(headerKey(cell))));
  const headers = headerRow >= 0 ? rows[headerRow].map(headerKey) : [];
  const nameIndex = headers.findIndex((header) => ["listingbrand", "unmappedbrandname", "brandname"].includes(header));
  const idIndex = headers.findIndex((header) => ["unmappedbrandid", "draftbrandid"].includes(header));
  const dataRows = headerRow >= 0 ? rows.slice(headerRow + 1) : rows;
  const parsed = dataRows.flatMap((row, index) => {
    const name = clean(row[nameIndex >= 0 ? nameIndex : 0]);
    if (!name || ["listingbrand", "unmappedbrandid", "targetbrandid", "targetbrandname", "bemapped"].includes(headerKey(name))) return [];
    const detectedId = idIndex >= 0 ? clean(row[idIndex]) : clean(row.find((cell) => /^draft_brand_[A-Za-z0-9]+$/.test(clean(cell))));
    return [{
      id: /^draft_brand_[A-Za-z0-9]+$/.test(detectedId) ? detectedId : `missing_id_${String(index + 1).padStart(5, "0")}`,
      name: name.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, ""),
    }];
  });
  const unique = new Map<string, (typeof parsed)[number]>();
  parsed.forEach((row) => {
    const key = row.id.startsWith("draft_brand_") ? `id:${row.id.toLowerCase()}` : `name:${normalizeBrand(row.name).toLowerCase()}`;
    if (!unique.has(key)) unique.set(key, row);
  });
  return [...unique.values()];
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
  brandType?: "ESTABLISHED_AFTERMARKET" | "SMALL_INDEPENDENT" | "PRIVATE_LABEL" | "OEM_OR_OE_VARIANT" | "NON_BRAND" | "AMBIGUOUS";
  brandSignals?: string[];
}

export interface AiReviewParseResult {
  changes: AiReviewChange[];
  errors: string[];
}

export function aiReviewRequestId(records: BrandRecord[]) {
  let hash = 2166136261;
  const signature = records.map((record) => [
    record.id,
    record.name,
    record.targetId || "",
    record.targetName || "",
    record.workflowSource || "IMPORT",
  ].join("\u0000")).join("\u0001");
  for (let index = 0; index < signature.length; index += 1) hash = Math.imul(hash ^ signature.charCodeAt(index), 16777619);
  return `brandmaster-review-${records.length}-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function buildAiReviewPrompt(records: BrandRecord[]) {
  const rootCleanup = records.some((record) => record.workflowSource === "ROOT");
  const reviewRequestId = aiReviewRequestId(records);
  const allowedIds = records.map((record) => record.id);
  const rows = records.map((record, index) => ({
    inputOrdinal: index + 1,
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
    reviewRequestId,
    decisions: [{
      unmappedBrandId: "draft_brand_example",
      unmappedBrandName: "Example Brand",
      action: "CREATE",
      targetBrandId: null,
      targetBrandName: "Example Brand",
      brandType: "PRIVATE_LABEL",
      brandSignals: [
        "MARKETPLACE: eBay product page identifies Example Brand as the brand on an automotive fitment product.",
        "PRODUCT: The exact brand name is presented on the product page and product imagery.",
      ],
      confidence: 95,
      reason: "Marketplace product evidence verifies a distinct white-label automotive fitment brand.",
      evidence: ["https://www.ebay.com/itm/example-private-label-part"],
    }],
  };
  return `NEW ISOLATED BRANDMASTER REQUEST
This message starts a new locked batch. It replaces every earlier Brandmaster prompt, brand list, draft response, correction, and selection in this conversation.
- Ignore all brands and IDs mentioned in earlier messages.
- Do not continue, repair, append to, or summarize an earlier response.
- Use prior conversation only for general research knowledge, never as an input-row source.
- The only allowed input IDs are the ${records.length} IDs in CURRENT BATCH ALLOWLIST below.

CURRENT BATCH LOCK
reviewRequestId: ${reviewRequestId}
expectedDecisionCount: ${records.length}
allowedUnmappedBrandIds: ${JSON.stringify(allowedIds)}

ROLE
You are a conservative evidence-based reviewer of automotive, motorcycle, marine, tractor, and heavy-equipment fitment brands for Brandmaster.

WORKFLOW
${rootCleanup ? "ROOT TABLE CLEANUP. Input IDs are existing BrandIDs. Preserve them exactly. CREATE means keep or rename the record as canonical; MERGE means make it an alias of a different existing BrandID; DELETE means recommend blocking/deleting the source record; SKIP means no Root change." : "UNMAPPED BRAND TRIAGE. Input IDs are UBQ UnmappedBrandIDs used by the bulk mapping upload."}

GOAL
Return one well-supported CREATE, MERGE, SKIP, or DELETE decision for every input row. Prefer an honest SKIP over an unsupported confident answer.

EVIDENCE POLICY
- Treat currentAction, currentTarget*, currentConfidence, and currentReason as untrusted prior suggestions, not facts. Re-evaluate them.
- "Imported from Previous Decisions CSV" is provenance, not independent proof that the decision is correct.
- relatedUbqNames and suggestedUbqCanonical show text similarity only. They do not prove that a brand exists or that two companies are identical.
- When search tools are available, verify CREATE claims with an official manufacturer, trademark owner, brand catalog, clearly branded product source, or a qualifying eBay/Amazon product page. A dedicated manufacturer website is not required for a private-label or white-label brand.
- Never invent evidence, URLs, company relationships, acronym expansions, translations, or product categories. If the necessary fact cannot be verified from supplied or retrieved evidence, SKIP.
- Put the decisive evidence in the evidence array. A reason such as "recognized brand", "likely white label", or "known manufacturer" without evidence is not sufficient.

WHITE-LABEL AND SMALL-BRAND PROTECTION
- A private-label, white-label, marketplace, regional, discontinued, or unfamiliar brand can still be a real brand. Unknown does not mean generic.
- Short names and acronyms can be real brands. Never DELETE a value merely because it is short, all caps, unfamiliar, or absent from a famous-brand list.
- Distinguish a named private-label brand from "unbranded" goods. CREATE a private-label brand only when evidence shows the exact name is used as a brand on fitment products.
- If a name could reasonably be either a brand or a product term and the evidence does not resolve that ambiguity, SKIP. Do not DELETE it.

BRAND-TYPE INVESTIGATION
Classify every row as exactly one of ESTABLISHED_AFTERMARKET, SMALL_INDEPENDENT, PRIVATE_LABEL, OEM_OR_OE_VARIANT, NON_BRAND, or AMBIGUOUS. This classification explains the research; it does not replace the ACTION GATES.
- WEBSITE: A substantial company site, About page, physical/contact information, fitment catalog, or support documentation supports an independent manufacturer. A missing or simple website is only a weak negative signal and never proves that a brand is fake.
- CATALOG/PART NUMBERS: ACES/PIES, TecDoc, distributor catalogs, structured part numbers, application guides, and technical PDFs support established or small-independent status. Absence from those systems does not disprove a private-label or niche brand.
- DISTRIBUTION: Warehouse distributors, parts stores, specialist racing/restoration catalogs, and multiple independent retailers support an independent brand. Marketplace-focused distribution can support PRIVATE_LABEL; it is not a reason to DELETE.
- TRADEMARK/LEGAL: A verifiable trademark owner or company registration supports brand identity. A recent filing, individual owner, cross-border company, or unusual coined name may indicate PRIVATE_LABEL but remains a real brand when exact branded fitment use is proven.
- PRODUCT/PACKAGING: Clearly branded product pages, manuals, labels, packaging, warranty pages, or catalog imagery can verify a private-label brand. Do not claim packaging evidence unless the retrieved source actually shows or describes it.
- MARKETPLACE: An eBay or Amazon product page can be decisive primary evidence for PRIVATE_LABEL when it clearly presents the exact input name as the product brand (for example in a Brand/By field, branded title, packaging, or product imagery) on an automotive or other fitment product. A dedicated brand website, trademark record, or second independent source is not required. A seller/store account name by itself, an unbranded product, or a listing that merely mentions the text in description/keywords is insufficient.
- Record concise findings in brandSignals using prefixes WEBSITE:, CATALOG:, DISTRIBUTION:, TRADEMARK:, PRODUCT:, MARKETPLACE:, or COUNTERSIGNAL:. State when a signal could not be verified.

LEXICAL SIGNAL SAFETY
- Never classify or DELETE from the string alone. All-caps text, few vowels, an unfamiliar acronym, or endings such as auto, parts, tech, direct, shop, store, club, planet, performance, engineering, industries, or corp are research hints only.
- Do not assume a pronounceable or professional-sounding name is a legitimate independent brand, and do not assume a random-looking name is fake.
- Vehicle makes are real brands. OEM/Genuine wording may indicate an alias of that make; a model or fitment phrase may be NON_BRAND, but DELETE still requires decisive contextual evidence.
- The presence of words such as hose, kit, set, front, rear, assembly, or parts does not prove the whole value is a product description; verify how the complete exact phrase is used.

ACTION GATES
- CREATE only for a verified real manufacturer or distinct named product/private-label brand that sells fitment products. TargetBrandID must be null; TargetBrandName must be the canonical brand name. CREATE requires confidence of at least 90 and at least one source URL in evidence. A qualifying eBay or Amazon product URL satisfies this gate when the listing clearly presents the exact name as the brand; no standalone manufacturer website is required. If no qualifying source URL can be retrieved, use SKIP.
- MERGE only when permittedMergeTarget is present. Copy that exact TargetBrandID and TargetBrandName; no other target is allowed. The evidence must establish an exact alias, near-identical spelling, OEM modifier, or distinctive identity—not just a shared generic word. Never invent a brand ID, use a draft_brand_ ID, or target the input row itself.
- ROOT PRECEDENCE: When permittedMergeTarget is present and represents a safe existing Root match, do not return CREATE. The external reviewer does not have the complete Root table; Brandmaster owns target discovery. Return MERGE using the exact permitted target when identity is supported, or SKIP when identity remains uncertain.
- Corporate suffixes such as AG, GmbH, Inc, Ltd, and LLC do not create a different brand. When removing only that suffix produces the exact permitted target (for example BMW AG → BMW), MERGE to that permitted target.
- SKIP when evidence is missing, conflicting, ambiguous, unrelated to fitment, based only on a seller/store account name, or when a likely MERGE has no permitted target. Do not SKIP solely because a verified white-label brand is sold only through eBay or Amazon. Keep confidence below 90 for unresolved cases and name the missing fact or target.
- DELETE only when the value is clearly and provably not a brand: a placeholder, instruction, pure product/description text, or equivalent non-brand value. DELETE requires confidence of at least 95 and at least one concrete evidence item. Unfamiliarity is never DELETE evidence.
- OEM wording such as OE, OEM, Genuine, and Original OE is not a separate brand. Remove that modifier when evaluating identity, but MERGE still requires the exact permitted target.
- Do not MERGE because one generic word overlaps. Words such as performance, automotive, auto, parts, tools, quality, commercial, motors, and products are not identity evidence by themselves. JS Performance is not Performance Tool; EFI Automotive is not a brand named Automotive.
- When a UBQ family has no permittedMergeTarget, recommend one verified canonical CREATE at most. SKIP its variations until a real TargetBrandID exists.

CALIBRATION CHECK
Before returning each row, test the opposite possibility:
- Before DELETE, ask whether this could be a small or private-label brand. If yes or uncertain, SKIP.
- Before CREATE, ask whether the evidence proves branded fitment use rather than merely a plausible name. If not, SKIP.
- Before MERGE, ask whether the exact permitted target and same-company identity are both proven. If not, SKIP.
- Confidence 95-100 means direct, decisive evidence. Confidence 90-94 means strong evidence with minor uncertainty. Any material unresolved ambiguity must be SKIP below 90.

OUTPUT CONTRACT
- Copy this exact reviewRequestId into the JSON root: ${reviewRequestId}
- Return exactly ${records.length} decisions: one for every CURRENT INPUT ROW, in inputOrdinal order, preserving each UnmappedBrandID and UnmappedBrandName exactly.
- Every returned UnmappedBrandID must be in CURRENT BATCH ALLOWLIST. Never include a brand or ID from an earlier message, even if it was omitted previously, needs correction, or appears related.
- Do not add relatedUbqNames, research discoveries, aliases, potential targets, examples, or remembered brands as extra decisions.
- Before responding, compare the returned ID set to allowedUnmappedBrandIds: there must be no missing, duplicate, substituted, or extra IDs.
- Confidence must be an integer from 0 to 100.
- brandType must be exactly one allowed BRAND-TYPE INVESTIGATION value.
- brandSignals must be a JSON array containing the strongest positive, negative, and missing research signals. Do not repeat unsupported name-pattern guesses as facts.
- evidence must be a JSON array of concise evidence statements or source URLs. MERGE and DELETE require at least one item. CREATE requires at least one valid http:// or https:// source URL; qualifying eBay and Amazon product URLs are valid CREATE evidence.
- For SKIP and DELETE, both target fields must be null.
- Return raw JSON only. Do not use Markdown fences or add commentary.
- The example below demonstrates the JSON shape only. Never copy its example ID, name, claim, or URL into a real decision.

Required JSON shape:
${JSON.stringify(example, null, 2)}

BEGIN CURRENT INPUT ROWS — IGNORE ALL OTHER BRAND LISTS
${JSON.stringify(rows, null, 2)}
END CURRENT INPUT ROWS

FINAL BATCH LOCK
Return raw JSON for reviewRequestId ${reviewRequestId} with exactly ${records.length} decisions and only these IDs:
${JSON.stringify(allowedIds)}
Any brand from an earlier conversation turn is forbidden in this response.`;
}

export function buildAiReviewCorrectionPrompt(originalPrompt: string, errors: string[]) {
  const numberedErrors = errors.map((error, index) => `${index + 1}. ${error}`).join("\n");
  return `Your previous Brandmaster response failed validation. Produce a corrected response for the current request below.

VALIDATION ERRORS
${numberedErrors}

CORRECTION RULES
- Fix every validation error, including errors not tied to a specific brand.
- Treat CURRENT LOCKED REQUEST as replacing every earlier batch, response, and correction in the conversation.
- Return the complete response for every input row, not only the rows named in the errors.
- Never include a brand or ID remembered from an earlier message unless it appears in the CURRENT LOCKED REQUEST allowlist.
- Preserve the exact reviewRequestId, UnmappedBrandID values, UnmappedBrandName values, row count, and row order required by the current request.
- If CREATE lacks a real source URL, verify the exact brand and add a valid http:// or https:// source URL to evidence. A qualifying eBay or Amazon product page is sufficient when it clearly presents the exact name as the product brand; do not require a standalone manufacturer website. If you cannot verify branded product use, change the action to SKIP, set both target fields to null, keep confidence below 90, and explain what could not be verified.
- Never invent a URL, source, BrandID, merge target, fact, or relationship just to satisfy validation.
- Recheck every decision against all ACTION GATES and OUTPUT CONTRACT rules in the current request.
- Return raw valid JSON only, with no Markdown fence, explanation, apology, or introductory text.

CURRENT LOCKED REQUEST
${originalPrompt}`;
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

  const expectedRequestId = aiReviewRequestId(records);
  const returnedRequestId = typeof root.reviewRequestId === "string" ? root.reviewRequestId.trim() : "";
  if (returnedRequestId && returnedRequestId !== expectedRequestId) {
    return { changes: [], errors: [`This JSON belongs to a different AI review request (${returnedRequestId}). Copy the current prompt and return the response for ${expectedRequestId}.`] };
  }
  const expectedIds = new Set(records.map((record) => record.id));
  const returnedIds = root.decisions.flatMap((item) => item && typeof item === "object" && !Array.isArray(item) && typeof (item as Record<string, unknown>).unmappedBrandId === "string" ? [(item as Record<string, string>).unmappedBrandId.trim()] : []);
  const returnedIdSet = new Set(returnedIds);
  const matched = [...returnedIdSet].filter((id) => expectedIds.has(id)).length;
  const sameSelection = returnedIds.length === records.length && returnedIdSet.size === expectedIds.size && [...expectedIds].every((id) => returnedIdSet.has(id));
  if (!sameSelection) {
    return { changes: [], errors: [`This JSON is for a different or incomplete brand selection: ${returnedIds.length} returned, ${records.length} expected, ${matched} IDs match. Copy the current AI prompt and paste only its response.`] };
  }

  const byId = new Map(records.map((record) => [record.id, record]));
  const seen = new Set<string>();
  const validActions = new Set<Action>(["CREATE", "MERGE", "SKIP", "DELETE"]);
  const validBrandTypes = new Set(["ESTABLISHED_AFTERMARKET", "SMALL_INDEPENDENT", "PRIVATE_LABEL", "OEM_OR_OE_VARIANT", "NON_BRAND", "AMBIGUOUS"]);
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
    const proposedAction = typeof decision.action === "string" ? decision.action.toUpperCase() as Action : "" as Action;
    if (!validActions.has(proposedAction)) { errors.push(`${record.name}: action must be CREATE, MERGE, SKIP, or DELETE.`); return; }
    const confidence = Number(decision.confidence);
    if (!Number.isInteger(confidence) || confidence < 0 || confidence > 100) { errors.push(`${record.name}: confidence must be an integer from 0 to 100.`); return; }
    let reason = typeof decision.reason === "string" ? decision.reason.trim() : "";
    if (!reason) { errors.push(`${record.name}: reason is required.`); return; }
    const brandType = typeof decision.brandType === "string" ? decision.brandType.trim().toUpperCase() as AiReviewChange["brandType"] : undefined;
    if (brandType && !validBrandTypes.has(brandType)) { errors.push(`${record.name}: brandType must be ESTABLISHED_AFTERMARKET, SMALL_INDEPENDENT, PRIVATE_LABEL, OEM_OR_OE_VARIANT, NON_BRAND, or AMBIGUOUS.`); return; }
    if (decision.brandSignals !== undefined && !Array.isArray(decision.brandSignals)) { errors.push(`${record.name}: brandSignals must be a JSON array.`); return; }
    const brandSignals = Array.isArray(decision.brandSignals) ? decision.brandSignals.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim()) : undefined;
    if (brandType && !brandSignals?.length) { errors.push(`${record.name}: brandType ${brandType} requires at least one concrete brandSignals item.`); return; }
    if (!Array.isArray(decision.evidence)) { errors.push(`${record.name}: evidence must be a JSON array, even when it is empty for SKIP.`); return; }
    let evidence = decision.evidence.filter((value): value is string => typeof value === "string" && Boolean(value.trim())).map((value) => value.trim());
    let targetId = typeof decision.targetBrandId === "string" ? decision.targetBrandId.trim() : "";
    let targetName = typeof decision.targetBrandName === "string" ? decision.targetBrandName.trim() : "";
    let action = proposedAction;
    const trustedRootSources = ["Alias table", "Brand table exact", "FPA exact", "Previous manual decision", "Admin-verified previous decision", "Exact prior BrandID decision"];
    const safePermittedMerge = record.action === "MERGE"
      && Boolean(record.targetId?.startsWith("brand_") && record.targetName && knownBrandIds.has(record.targetId))
      && (assessMergeCompatibility(record.name, record.targetName || "").safe || trustedRootSources.includes(record.decisionSource));
    if (proposedAction === "CREATE" && safePermittedMerge) {
      action = "MERGE";
      targetId = record.targetId!;
      targetName = record.targetName!;
      reason = `Brandmaster preserved the existing Root match ${targetName}; AI independently verified brand legitimacy. ${reason}`;
      evidence = [`ROOT PRECEDENCE: ${record.name} → ${targetName} · ${targetId}`, ...evidence];
    }

    if (action === "MERGE") {
      if (!targetId.startsWith("brand_") || !targetName) { errors.push(`${record.name}: MERGE requires a real TargetBrandID and TargetBrandName.`); return; }
      if (targetId === record.id) { errors.push(`${record.name}: MERGE cannot target the same source BrandID.`); return; }
      if (!knownBrandIds.has(targetId)) { errors.push(`${record.name}: MERGE target ${targetId} is not in the loaded local brand tables.`); return; }
      if (!record.targetId?.startsWith("brand_") || !record.targetName) { errors.push(`${record.name}: MERGE is not allowed because this row has no permittedMergeTarget. Use SKIP until a reviewer selects a verified Root BrandID.`); return; }
      if (targetId !== record.targetId || targetName.toLowerCase() !== record.targetName.trim().toLowerCase()) { errors.push(`${record.name}: MERGE must use the exact permitted target ${record.targetName} · ${record.targetId}.`); return; }
      const compatibility = assessMergeCompatibility(record.name, targetName);
      const trustedExistingMatch = record.action === "MERGE" && record.targetId === targetId && trustedRootSources.includes(record.decisionSource);
      if (!compatibility.safe && !trustedExistingMatch) { errors.push(`${record.name}: weak MERGE to ${targetName}. ${compatibility.reason}. Choose CREATE/SKIP or manually select and override a verified alias.`); return; }
    } else if (targetId) { errors.push(`${record.name}: only MERGE may contain TargetBrandID.`); return; }
    if (action === "CREATE" && !targetName) { errors.push(`${record.name}: CREATE requires TargetBrandName.`); return; }
    if ((action === "SKIP" || action === "DELETE") && targetName) { errors.push(`${record.name}: ${action} cannot contain TargetBrandName.`); return; }
    if (action !== "SKIP" && evidence.length === 0) { errors.push(`${record.name}: ${action} requires at least one concrete evidence item.`); return; }
    if (action === "CREATE" && !evidence.some((item) => /^https?:\/\/\S+$/i.test(item))) { errors.push(`${record.name}: CREATE requires at least one source URL in evidence. A qualifying eBay or Amazon branded-product URL is sufficient; a manufacturer website is not required.`); return; }
    if (action === "CREATE" && (brandType === "NON_BRAND" || brandType === "AMBIGUOUS")) { errors.push(`${record.name}: CREATE conflicts with brandType ${brandType}. Verify a real brand type or use SKIP.`); return; }
    if (action === "DELETE" && ["SMALL_INDEPENDENT", "PRIVATE_LABEL", "OEM_OR_OE_VARIANT"].includes(brandType || "")) { errors.push(`${record.name}: DELETE conflicts with protected brandType ${brandType}. Use CREATE, permitted MERGE, or SKIP.`); return; }
    if (action === "CREATE" && confidence < 90) { errors.push(`${record.name}: CREATE requires confidence of at least 90; use SKIP when brand evidence is uncertain.`); return; }
    if (action === "DELETE" && confidence < 95) { errors.push(`${record.name}: DELETE requires confidence of at least 95; use SKIP when the value could be a small or private-label brand.`); return; }
    if (action === "MERGE" && confidence < 90) { errors.push(`${record.name}: MERGE requires confidence of at least 90; use SKIP when identity is uncertain.`); return; }
    changes.push({ recordId, action, targetId: action === "MERGE" ? targetId : undefined, targetName: action === "MERGE" || action === "CREATE" ? targetName : undefined, confidence, reason, evidence, ...(brandType ? { brandType } : {}), ...(brandSignals ? { brandSignals } : {}) });
  });

  records.forEach((record) => { if (!seen.has(record.id)) errors.push(`${record.name}: decision is missing from the JSON.`); });
  return { changes: errors.length ? [] : changes, errors };
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
