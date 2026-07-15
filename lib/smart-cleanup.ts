import { normalizeBrand, resolveRootBrandTarget } from "./brand-engine";
import { CatalogBrand } from "./types";

export type CleanupSource = "ROOT" | "UBQ";
export type CleanupSeverity = "HIGH" | "MEDIUM" | "LOW";
export type CleanupIssueType = "JUNK" | "SYMBOLS" | "DUPLICATE" | "ALIAS_CONFLICT" | "NAME_CLEANUP" | "BROKEN_TARGET" | "EXISTING_BRAND" | "UBQ_FAMILY";

export interface CleanupIssue {
  key: string;
  source: CleanupSource;
  brandId: string;
  name: string;
  severity: CleanupSeverity;
  type: CleanupIssueType;
  title: string;
  reason: string;
  confidence: number;
  suggestion?: string;
  targetId?: string;
  targetName?: string;
  related?: { id: string; name: string }[];
}

type UbqRow = { id: string; name: string; listingCount?: number; skuCount?: number };
const PLACEHOLDER = /^(details? in description|see description|unknown|unbranded|no brand|not applicable|n\/?a|generic|other|none|null|-+)$/i;
const SUSPICIOUS = /[?¿‽!@#$%^*+=<>|~`]/u;
const GENERIC_TOKENS = new Set(["brand", "auto", "parts", "original", "genuine", "series", "store", "shop", "official"]);
const severityRank: Record<CleanupSeverity, number> = { HIGH: 3, MEDIUM: 2, LOW: 1 };

const clean = (value: string) => normalizeBrand(value).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const familyKeyFromClean = (value: string) => value.split(/\s+/).filter((token) => token.length >= 3 && !GENERIC_TOKENS.has(token)).slice(0, 2).join(" ");
const sortIssues = (issues: CleanupIssue[]) => issues.sort((left, right) => severityRank[right.severity] - severityRank[left.severity] || right.confidence - left.confidence || left.name.localeCompare(right.name));
const keepStrongestPerBrand = (issues: CleanupIssue[]) => {
  const byBrand = new Map<string, CleanupIssue>();
  sortIssues(issues).forEach((issue) => { if (!byBrand.has(issue.brandId)) byBrand.set(issue.brandId, issue); });
  return [...byBrand.values()];
};

function boundedIssueCollector(limitPerSeverity: number) {
  const issues: CleanupIssue[] = [];
  const counts: Record<CleanupSeverity, number> = { HIGH: 0, MEDIUM: 0, LOW: 0 };
  return {
    issues,
    add(issue: CleanupIssue) {
      if (counts[issue.severity] >= limitPerSeverity) return;
      counts[issue.severity] += 1; issues.push(issue);
    },
  };
}

export function analyzeRootBrands(brands: CatalogBrand[], limitPerSeverity = 2000): CleanupIssue[] {
  const { issues, add: addIssue } = boundedIssueCollector(limitPerSeverity);
  const active = brands.filter((brand) => (brand.rootStatus || "ACTIVE") === "ACTIVE");
  const normalizedGroups = new Map<string, CatalogBrand[]>();
  active.forEach((brand) => {
    const key = clean(brand.name);
    if (!key) return;
    const group = normalizedGroups.get(key); if (group) group.push(brand); else normalizedGroups.set(key, [brand]);
  });
  normalizedGroups.forEach((group) => {
    if (group.length < 2) return;
    const canonical = [...group].sort((left, right) => right.aliases.length - left.aliases.length || left.name.length - right.name.length)[0];
    group.filter((brand) => brand.id !== canonical.id).forEach((brand) => addIssue({ key: `ROOT:DUPLICATE:${brand.id}`, source: "ROOT", brandId: brand.id, name: brand.name, severity: "HIGH", type: "DUPLICATE", title: "Duplicate canonical brand", reason: `This normalizes to the same name as ${canonical.name}. Keeping both creates competing BrandIDs.`, confidence: 100, suggestion: `Consolidate into ${canonical.name}`, targetId: canonical.id, targetName: canonical.name }));
  });

  const ownerByAlias = new Map<string, CatalogBrand[]>();
  active.forEach((brand) => brand.aliases.forEach((alias) => {
    const key = clean(alias); if (!key) return;
    const owners = ownerByAlias.get(key); if (owners) owners.push(brand); else ownerByAlias.set(key, [brand]);
  }));
  ownerByAlias.forEach((owners, alias) => {
    const ids = new Set(owners.map((owner) => owner.id)); if (ids.size < 2) return;
    owners.forEach((brand) => addIssue({ key: `ROOT:ALIAS_CONFLICT:${brand.id}:${alias}`, source: "ROOT", brandId: brand.id, name: brand.name, severity: "HIGH", type: "ALIAS_CONFLICT", title: "Alias points to multiple brands", reason: `The alias “${alias}” is attached to ${owners.map((owner) => owner.name).join(", ")}.`, confidence: 100, suggestion: "Review and keep the alias on only one canonical BrandID", related: owners.filter((owner) => owner.id !== brand.id).map((owner) => ({ id: owner.id, name: owner.name })) }));
  });

  active.forEach((brand) => {
    const normalized = normalizeBrand(brand.name);
    if (PLACEHOLDER.test(brand.name.trim())) addIssue({ key: `ROOT:JUNK:${brand.id}`, source: "ROOT", brandId: brand.id, name: brand.name, severity: "HIGH", type: "JUNK", title: "Placeholder stored as a brand", reason: "This value describes missing information rather than a manufacturer.", confidence: 100, suggestion: "Recommend BLOCKED / DELETE in Admin" });
    else if (SUSPICIOUS.test(brand.name)) addIssue({ key: `ROOT:SYMBOLS:${brand.id}`, source: "ROOT", brandId: brand.id, name: brand.name, severity: "HIGH", type: "SYMBOLS", title: "Unsupported symbols in canonical name", reason: "Question marks or unsupported symbols usually indicate junk, seller text, or a damaged import.", confidence: 96, suggestion: normalized && normalized !== brand.name ? `Rename to ${normalized}` : "Review for block or correction" });
    else if (normalized && normalized !== brand.name.trim()) addIssue({ key: `ROOT:NAME:${brand.id}`, source: "ROOT", brandId: brand.id, name: brand.name, severity: "MEDIUM", type: "NAME_CLEANUP", title: "Canonical name needs cleanup", reason: "OEM wording, separators, or extra formatting can be removed consistently.", confidence: 94, suggestion: normalized });
    const duplicateAliases = brand.aliases.filter((alias, index) => brand.aliases.findIndex((candidate) => clean(candidate) === clean(alias)) !== index);
    if (duplicateAliases.length) addIssue({ key: `ROOT:ALIAS_DUPLICATE:${brand.id}`, source: "ROOT", brandId: brand.id, name: brand.name, severity: "MEDIUM", type: "ALIAS_CONFLICT", title: "Duplicate aliases on one brand", reason: `${duplicateAliases.length} alias value${duplicateAliases.length === 1 ? " is" : "s are"} repeated with casing or punctuation differences.`, confidence: 100, suggestion: "Deduplicate the alias list" });
    if (brand.sameAs) {
      const resolved = resolveRootBrandTarget(brand.id, brands);
      if (!resolved.brand || resolved.circular) addIssue({ key: `ROOT:BROKEN_TARGET:${brand.id}`, source: "ROOT", brandId: brand.id, name: brand.name, severity: "HIGH", type: "BROKEN_TARGET", title: resolved.circular ? "Circular consolidation chain" : "Broken consolidation target", reason: resolved.circular ? `The sameAs chain loops: ${resolved.chain.join(" → ")}.` : "The sameAs target is missing, blocked, or inactive.", confidence: 100, suggestion: "Choose a valid active canonical target" });
    }
  });
  return keepStrongestPerBrand(issues);
}

export function analyzeUbqBrands(rows: UbqRow[], rootBrands: CatalogBrand[], limitPerSeverity = 2000): CleanupIssue[] {
  const { issues, add: addIssue } = boundedIssueCollector(limitPerSeverity);
  const activeRoots = rootBrands.filter((brand) => (brand.rootStatus || "ACTIVE") === "ACTIVE");
  const rootLookup = new Map<string, CatalogBrand>();
  activeRoots.forEach((brand) => [brand.name, ...brand.aliases].forEach((value) => { const key = clean(value); if (key && !rootLookup.has(key)) rootLookup.set(key, brand); }));
  const prepared = rows.map((row) => { const normalized = normalizeBrand(row.name); const key = normalized.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(); return { row, normalized, key, family: familyKeyFromClean(key) }; });
  const families = new Map<string, UbqRow[]>();
  prepared.forEach(({ row, family }) => { if (!family) return; const group = families.get(family); if (group) group.push(row); else families.set(family, [row]); });
  prepared.forEach(({ row, normalized, key, family: keyFamily }) => {
    const root = rootLookup.get(key);
    if (PLACEHOLDER.test(row.name.trim()) || SUSPICIOUS.test(row.name)) addIssue({ key: `UBQ:JUNK:${row.id}`, source: "UBQ", brandId: row.id, name: row.name, severity: "HIGH", type: PLACEHOLDER.test(row.name.trim()) ? "JUNK" : "SYMBOLS", title: "Likely invalid unknown-brand value", reason: PLACEHOLDER.test(row.name.trim()) ? "This is a placeholder, not a manufacturer." : "Unsupported symbols make this unsafe to create as a canonical brand.", confidence: 100, suggestion: "Review for SKIP or DELETE" });
    else if (root) addIssue({ key: `UBQ:ROOT_MATCH:${row.id}`, source: "UBQ", brandId: row.id, name: row.name, severity: "HIGH", type: "EXISTING_BRAND", title: "Existing brand match found", reason: `${row.name} matches the canonical name or an alias of ${root.name}.`, confidence: 100, suggestion: `MERGE into ${root.name}`, targetId: root.id, targetName: root.name });
    else {
      const family = families.get(keyFamily) || [];
      if (family.length > 1) addIssue({ key: `UBQ:FAMILY:${row.id}`, source: "UBQ", brandId: row.id, name: row.name, severity: "MEDIUM", type: "UBQ_FAMILY", title: "Related UBQ names should be reviewed together", reason: `${family.length} unknown-brand rows share the same meaningful brand phrase.`, confidence: 90, suggestion: "Choose one canonical target and apply it to the family", related: family.slice(0, 6).filter((candidate) => candidate.id !== row.id).slice(0, 5).map((candidate) => ({ id: candidate.id, name: candidate.name })) });
      else if (normalized && normalized !== row.name.trim()) addIssue({ key: `UBQ:NAME:${row.id}`, source: "UBQ", brandId: row.id, name: row.name, severity: "LOW", type: "NAME_CLEANUP", title: "Unknown brand name can be normalized", reason: "OEM wording or separators can be removed before validation.", confidence: 88, suggestion: normalized });
    }
  });
  return keepStrongestPerBrand(issues);
}

export function cleanupIssueCounts(issues: CleanupIssue[]) {
  return issues.reduce((counts, issue) => ({ ...counts, [issue.severity]: counts[issue.severity] + 1 }), { HIGH: 0, MEDIUM: 0, LOW: 0 } as Record<CleanupSeverity, number>);
}
