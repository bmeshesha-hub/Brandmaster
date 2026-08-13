import { analyzeRootBrands, CleanupIssue } from "./smart-cleanup";
import { CatalogBrand, RootTableChange } from "./types";

export type OfflineRootReport = {
  schemaVersion: "brandmaster.offline-root-cleanup.v1";
  generatedAt: string;
  inputRows: number;
  issueCounts: Record<string, number>;
  issues: CleanupIssue[];
  suggestedChanges: RootTableChange[];
};

export function normalizeRootRows(value: unknown): CatalogBrand[] {
  const root = value as Record<string, unknown>;
  const rows = Array.isArray(value) ? value : Array.isArray(root?.rootBrands) ? root.rootBrands : Array.isArray(root?.brands) ? root.brands : Array.isArray(root?.rows) ? root.rows : null;
  if (!rows) throw new Error("Expected a JSON array or an object containing rootBrands, brands, or rows.");
  return rows.map((item, index) => {
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? row.brandId ?? row.BrandID ?? "").trim();
    const name = String(row.name ?? row.brandName ?? row.BrandName ?? "").trim();
    if (!id || !name) throw new Error(`Root row ${index + 1} is missing id or name.`);
    const aliases = Array.isArray(row.aliases) ? row.aliases.map(String) : String(row.aliases ?? "").split(/[|;]\s*/).filter(Boolean);
    return { id, name, aliases, category: String(row.category ?? "Automotive"), country: row.country ? String(row.country) : undefined, website: row.website ? String(row.website) : undefined, source: "Root", sameAs: row.sameAs ? String(row.sameAs) : undefined, rootSource: row.rootSource ? String(row.rootSource) : undefined, rootStatus: row.rootStatus ? String(row.rootStatus) : "ACTIVE" };
  });
}

function counts(issues: CleanupIssue[]) { return issues.reduce<Record<string, number>>((out, issue) => { out[issue.type] = (out[issue.type] || 0) + 1; return out; }, {}); }

export function buildOfflineRootReport(brands: CatalogBrand[], limitPerSeverity = 10000): OfflineRootReport {
  const issues = analyzeRootBrands(brands, limitPerSeverity);
  const byId = new Map(brands.map((brand) => [brand.id, brand]));
  const suggestedChanges: RootTableChange[] = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (seen.has(issue.brandId)) continue;
    const before = byId.get(issue.brandId); if (!before) continue;
    let after: CatalogBrand | undefined;
    if (issue.type === "DUPLICATE" && issue.targetId) after = { ...before, sameAs: issue.targetId, rootStatus: "INACTIVE" };
    else if (issue.type === "JUNK" || issue.type === "SYMBOLS") after = { ...before, rootStatus: "BLOCKED" };
    else if (issue.type === "NAME_CLEANUP" && issue.suggestion) after = { ...before, name: issue.suggestion };
    else if (issue.type === "ALIAS_CONFLICT") continue; // requires a human owner decision
    if (!after) continue;
    seen.add(issue.brandId);
    suggestedChanges.push({ id: before.id, type: "UPDATE", before, after, changedFields: ["name", "sameAs", "status", "aliases"].filter((field) => field === "name" ? before.name !== after!.name : field === "sameAs" ? before.sameAs !== after!.sameAs : field === "status" ? before.rootStatus !== after!.rootStatus : JSON.stringify(before.aliases) !== JSON.stringify(after!.aliases)), updatedAt: new Date().toISOString(), status: "PENDING", adminStatus: "RECOMMENDED", verificationNote: `Offline suggestion from ${issue.type}: ${issue.title}` });
  }
  return { schemaVersion: "brandmaster.offline-root-cleanup.v1", generatedAt: new Date().toISOString(), inputRows: brands.length, issueCounts: counts(issues), issues, suggestedChanges };
}
