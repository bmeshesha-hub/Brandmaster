import assert from "node:assert/strict";
import test from "node:test";
import { adminBrandUrl, buildAiReviewPrompt, classifyBrand, findCatalogConflicts, getBulkExportReadiness, normalizeBrand, parseAiReviewJson, parseCsv, parseDecisionCsv, parseReferenceCsv, toCsv, toRootChangesCsv } from "../lib/brand-engine";
import { EMPTY_DATA } from "../lib/storage";
import { syncLoginUrl } from "../lib/sync";
import { base64ToText, decideGitHubSync, mergeWorkspaceSnapshots, textToBase64 } from "../lib/github-workspace";

test("normalizes common OEM language and separators", () => {
  assert.equal(normalizeBrand("Toyota Original OE"), "Toyota");
  assert.equal(normalizeBrand("Daelim (Original OE)"), "Daelim");
  assert.equal(normalizeBrand("EDA\\\\Cooling"), "EDA Cooling");
  assert.equal(normalizeBrand("ST Suspension"), "ST Suspensions");
});

test("parses headers, quoted values, and optional statistics", () => {
  const rows = parseCsv('UnmappedBrandID,UnmappedBrandName,Listing Count,SKU Count\nbrand_1,"AC, Delco",12,8');
  assert.deepEqual(rows, [{ id: "brand_1", name: "AC, Delco", listingCount: 12, skuCount: 8 }]);
});

test("merges known brands and deletes placeholder text", () => {
  const merge = classifyBrand({ id: "1", name: "BMW OE" }, EMPTY_DATA);
  assert.equal(merge.action, "MERGE");
  assert.equal(merge.targetName, "BMW");
  assert.equal(merge.targetId, "brand_bbRDNMtVVPeqthpbpvJEiS");
  assert.equal(merge.confidence, 100);
  const remove = classifyBrand({ id: "2", name: "Details in Description" }, EMPTY_DATA);
  assert.equal(remove.action, "DELETE");
  assert.equal(remove.confidence, 100);
});

test("merges case variants and suggests canonical brands for model names", () => {
  const exact = classifyBrand({ id: "draft_toyota", name: "toyota" }, EMPTY_DATA);
  assert.equal(exact.action, "MERGE");
  assert.equal(exact.targetName, "Toyota");
  assert.equal(exact.confidence, 100);

  const model = classifyBrand({ id: "draft_camry", name: "Toyota Camry" }, EMPTY_DATA);
  assert.equal(model.action, "MERGE");
  assert.equal(model.targetId, "brand_r6SKqPwxGUKM4bRhMR5ZKm");
  assert.equal(model.targetName, "Toyota");
  assert.equal(model.confidence, 92);
  assert.equal(model.status, "needs-review");
  assert.equal(model.decisionSource, "FPA family match");
});

test("learned decisions take precedence", () => {
  const result = classifyBrand({ id: "3", name: "HOBI" }, {
    ...EMPTY_DATA,
    learned: { hobi: { action: "SKIP", reason: "Previously reviewed", reviewedAt: "2026-07-13" } },
  });
  assert.equal(result.action, "SKIP");
  assert.equal(result.confidence, 100);
});

test("manual catalog corrections override built-in brand metadata", () => {
  const result = classifyBrand({ id: "draft_manual", name: "BMW OE" }, {
    ...EMPTY_DATA,
    customBrands: [{ id: "brand_bbRDNMtVVPeqthpbpvJEiS", name: "BMW Group", aliases: ["BMW OE"], category: "Automotive", source: "Manual" }],
  });
  assert.equal(result.action, "MERGE");
  assert.equal(result.targetName, "BMW Group");
  assert.match(result.evidence.join(" "), /Manual brand table/);
});

test("automatically skips question marks and suspicious symbols", () => {
  for (const name of ["TOPMV?", "Unknown!", "Brand@Store", "Part#123", "Maybe~Brand"]) {
    const result = classifyBrand({ id: "draft_symbol", name }, EMPTY_DATA);
    assert.equal(result.action, "SKIP", name);
    assert.equal(result.confidence, 100, name);
    assert.equal(result.decisionSource, "Offline symbol rule", name);
  }
  assert.notEqual(classifyBrand({ id: "draft_ampersand", name: "B & P Rods" }, EMPTY_DATA).decisionSource, "Offline symbol rule");
  assert.notEqual(classifyBrand({ id: "draft_hyphen", name: "Holpsai-Autoparts" }, EMPTY_DATA).decisionSource, "Offline symbol rule");
});

test("exports the required five columns", () => {
  const record = classifyBrand({ id: "draft_1", name: "BMW OE" }, EMPTY_DATA);
  const csv = toCsv([record]);
  assert.equal(csv.split("\n")[0], "UnmappedBrandID,UnmappedBrandName,Action,TargetBrandID,TargetBrandName");
  assert.match(csv, /"draft_1","BMW OE","MERGE","brand_bbRDNMtVVPeqthpbpvJEiS","BMW"/);
});

test("keeps the admin bulk CSV schema and action field rules locked", () => {
  const base = { normalized: "Example", confidence: 100, reason: "Reviewed", evidence: [], status: "reviewed" as const, decisionSource: "Manual", ubqVerified: true };
  const csv = toCsv([
    { ...base, id: "draft_create", name: "New Brand", action: "CREATE", targetName: "New Brand" },
    { ...base, id: "draft_merge", name: "Old Brand", action: "MERGE", targetId: "brand_existing", targetName: "Existing Brand" },
    { ...base, id: "draft_skip", name: "Seller Store", action: "SKIP" },
    { ...base, id: "draft_delete", name: "See Description", action: "DELETE" },
  ]);
  assert.deepEqual(csv.split("\n"), [
    "UnmappedBrandID,UnmappedBrandName,Action,TargetBrandID,TargetBrandName",
    '"draft_create","New Brand","CREATE","","New Brand"',
    '"draft_merge","Old Brand","MERGE","brand_existing","Existing Brand"',
    '"draft_skip","Seller Store","SKIP","",""',
    '"draft_delete","See Description","DELETE","",""',
  ]);
});

test("blocks bulk export until every required admin field is valid", () => {
  const base = { name: "Example", normalized: "Example", confidence: 100, reason: "Reviewed", evidence: [], status: "reviewed" as const, decisionSource: "Manual", ubqVerified: true };
  assert.equal(getBulkExportReadiness([{ ...base, id: "draft_brand_ok", action: "CREATE", targetName: "Example" }]).ready, true);
  const result = getBulkExportReadiness([
    { ...base, id: "missing_id_1", action: "SKIP", ubqVerified: false },
    { ...base, id: "draft_brand_merge", action: "MERGE", targetName: "Target" },
    { ...base, id: "draft_brand_create", action: "CREATE", targetName: "" },
  ]);
  assert.equal(result.ready, false);
  assert.equal(result.invalidIds.length, 1);
  assert.equal(result.incompleteMerges.length, 1);
  assert.equal(result.incompleteCreates.length, 1);
});

test("detects aliases that point to multiple BrandIDs and refuses automatic merge", () => {
  const rootBrands = [
    { id: "brand_one", name: "Brand One", aliases: ["Shared Alias"], category: "Automotive", source: "Root" as const },
    { id: "brand_two", name: "Brand Two", aliases: ["Shared Alias"], category: "Automotive", source: "Root" as const },
  ];
  const conflicts = findCatalogConflicts(rootBrands);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].brandIds, ["brand_one", "brand_two"]);
  const result = classifyBrand({ id: "draft_conflict", name: "Shared Alias" }, { ...EMPTY_DATA, rootBrands });
  assert.equal(result.action, "SKIP");
  assert.equal(result.decisionSource, "Alias conflict");
  assert.equal(result.status, "needs-review");
});

test("builds the admin brand URL without breaking names that contain ampersands", () => {
  assert.equal(
    adminBrandUrl("brand_ip8q1j4ZTrZJQHPU8AB81p", "1&1"),
    "https://myfitmentadminui.muse.vip.ebay.com/brand/brand_ip8q1j4ZTrZJQHPU8AB81p?name=1%261",
  );
});

test("builds a safe sync sign-in URL with the complete Pages return address", () => {
  assert.equal(
    syncLoginUrl("https://sync.example.test/", "https://pages.example.test/Brandmaster/?mode=shared&name=1%261"),
    "https://sync.example.test/auth/login?return_to=https%3A%2F%2Fpages.example.test%2FBrandmaster%2F%3Fmode%3Dshared%26name%3D1%25261",
  );
});

test("sets TargetBrandName for CREATE and accepts Seller Count", () => {
  const [row] = parseCsv('Brand ID,Brand Name,Seller Count\ndraft_9,Motrio,7');
  assert.equal(row.listingCount, 7);
  const record = classifyBrand(row, EMPTY_DATA);
  assert.equal(record.action, "CREATE");
  assert.equal(record.targetId, undefined);
  assert.equal(record.targetName, "Motrio");
  assert.match(toCsv([record]), /"draft_9","Motrio","CREATE","","Motrio"/);
});

test("executes previous decisions before lower-priority modules", () => {
  const result = classifyBrand({ id: "draft_10", name: "BMW OE" }, {
    ...EMPTY_DATA,
    learned: { bmw: { action: "SKIP", reason: "Manual exception", reviewedAt: "2026-07-13" } },
  });
  assert.equal(result.action, "SKIP");
  assert.equal(result.decisionSource, "Previous manual decision");
});

test("module toggles disable alias and FPA matching without breaking offline output", () => {
  const result = classifyBrand({ id: "draft_11", name: "BMW OE" }, {
    ...EMPTY_DATA,
    validationSettings: { ...EMPTY_DATA.validationSettings, aliasTable: false, fpaTable: false },
  });
  assert.equal(result.action, "CREATE");
  assert.equal(result.decisionSource, "Offline fallback");
  assert.match(toCsv([result]), /"draft_11","BMW OE","CREATE","","BMW"/);
});

test("loads offline ACA and FPA reference CSVs", () => {
  const brands = parseReferenceCsv("BrandID,BrandName\nbrand_motrio,Motrio", "FPA");
  const result = classifyBrand({ id: "draft_12", name: "Motrio" }, { ...EMPTY_DATA, fpaBrands: brands });
  assert.equal(result.action, "MERGE");
  assert.equal(result.targetId, "brand_motrio");
  assert.equal(result.decisionSource, "FPA exact");
});

test("groups the real FPA alias schema by canonical brand ID", () => {
  const brands = parseReferenceCsv("aliases,id,name\nchrysler,brand_1,chrysler\nchrylser,brand_1,chrysler\nchrysler oe,brand_1,chrysler", "FPA");
  assert.equal(brands.length, 1);
  assert.deepEqual(brands[0].aliases, ["chrylser", "chrysler oe"]);
  const result = classifyBrand({ id: "draft_13", name: "chrylser" }, { ...EMPTY_DATA, fpaBrands: brands });
  assert.equal(result.action, "MERGE");
  assert.equal(result.decisionSource, "Alias table");
});

test("uses ACA IDs as evidence rather than invalid MERGE target IDs", () => {
  const aca = parseReferenceCsv("RecordID,BrandID,BrandName,SubBrandID,SubBrandName\n1,GWWQ,034MOTORSPORT,,", "ACA");
  const result = classifyBrand({ id: "draft_14", name: "034MOTORSPORT" }, { ...EMPTY_DATA, acaBrands: aca });
  assert.equal(result.action, "CREATE");
  assert.equal(result.targetId, undefined);
  assert.equal(result.decisionSource, "ACA exact");
});

test("imports previous decision history with valid FPA merge targets", () => {
  const parsed = parseDecisionCsv("listing_brand,action,merge_target,fpa_brand_id\nlemark,MERGE,lemark,brand_123\nukatex,CREATE,,\nunknown,DELETE,,");
  assert.equal(parsed.imported, 3);
  assert.deepEqual(parsed.decisions.lemark, { action: "MERGE", targetId: "brand_123", targetName: "lemark", reason: "Imported from Previous Decisions CSV", reviewedAt: parsed.decisions.lemark.reviewedAt, origin: "imported" });
  const result = classifyBrand({ id: "draft_15", name: "lemark" }, { ...EMPTY_DATA, learned: parsed.decisions });
  assert.equal(result.action, "MERGE");
  assert.equal(result.decisionSource, "Previous Decisions CSV");
});

test("loads only ACTIVE brands from the authoritative root table", () => {
  const root = parseReferenceCsv("aliases,id,name,sameAs,source,status\n\"AP Auto,AP Auto Electric\",brand_ap,AP Auto Electric,,SYSTEM,ACTIVE\nUnknown,brand_unknown,UNKNOWN,,,BLOCKED", "ROOT");
  assert.equal(root.length, 1);
  assert.deepEqual(root[0].aliases, ["AP Auto"]);
  const exact = classifyBrand({ id: "draft_16", name: "AP Auto Electric" }, { ...EMPTY_DATA, rootBrands: root, validationSettings: { ...EMPTY_DATA.validationSettings, aliasTable: false } });
  assert.equal(exact.action, "MERGE");
  assert.equal(exact.targetId, "brand_ap");
  assert.equal(exact.decisionSource, "Brand table exact");
});

test("preserves Root metadata and exports import-ready changed rows", () => {
  const [brand] = parseReferenceCsv("aliases,id,name,sameAs,source,status\nOld Alias,brand_root,Old Name,brand_parent,SYSTEM,ACTIVE", "ROOT");
  assert.equal(brand.sameAs, "brand_parent");
  assert.equal(brand.rootSource, "SYSTEM");
  assert.equal(brand.rootStatus, "ACTIVE");
  const after = { ...brand, name: "Correct Name", aliases: ["Old Alias", "Correct Name OE"], rootSource: "BRANDMASTER" };
  const csv = toRootChangesCsv([{ id: brand.id, type: "UPDATE", before: brand, after, changedFields: ["name", "aliases", "source"], updatedAt: "2026-07-14T00:00:00.000Z" }]);
  assert.equal(csv.split("\n")[0], "aliases,id,name,sameAs,source,status");
  assert.match(csv, /"Old Alias,Correct Name OE","brand_root","Correct Name","brand_parent","BRANDMASTER","ACTIVE"/);
});

test("does not use blocked Root brands as merge targets", () => {
  const blocked = { id: "brand_blocked", name: "Blocked Brand", aliases: ["Blocked Alias"], category: "Automotive", source: "Root" as const, rootStatus: "BLOCKED" };
  const result = classifyBrand({ id: "draft_blocked", name: "Blocked Brand" }, { ...EMPTY_DATA, rootBrands: [blocked] });
  assert.notEqual(result.action, "MERGE");
});

test("unimplemented online settings never claim external evidence", () => {
  const result = classifyBrand({ id: "draft_17", name: "Totally New Brand" }, {
    ...EMPTY_DATA,
    validationSettings: { ...EMPTY_DATA.validationSettings, officialWebsiteSearch: true, marketplaceSearch: true, googleSearch: true, aiValidator: true },
  });
  assert.equal(result.decisionSource, "Offline fallback");
  assert.deepEqual(result.evidence, ["No previous, alias, existing-brand, ACA, or FPA match", "Offline fallback decision"]);
});

test("builds a complete JSON-only AI review prompt", () => {
  const record = classifyBrand({ id: "draft_18", name: "Motrio" }, EMPTY_DATA);
  const prompt = buildAiReviewPrompt([record]);
  assert.match(prompt, /brandmaster\.ai-review\.v1/);
  assert.match(prompt, /Return raw JSON only/);
  assert.match(prompt, /"unmappedBrandId": "draft_18"/);
  assert.match(prompt, /Never invent a brand ID/);
});

test("parses a safe complete AI review JSON response", () => {
  const record = classifyBrand({ id: "draft_19", name: "Motrio" }, EMPTY_DATA);
  const result = parseAiReviewJson(JSON.stringify({
    schemaVersion: "brandmaster.ai-review.v1",
    decisions: [{ unmappedBrandId: "draft_19", unmappedBrandName: "Motrio", action: "CREATE", targetBrandId: null, targetBrandName: "Motrio", confidence: 98, reason: "Confirmed manufacturer brand", evidence: ["https://example.test/motrio"] }],
  }), [record]);
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.changes[0], { recordId: "draft_19", action: "CREATE", targetId: undefined, targetName: "Motrio", confidence: 98, reason: "Confirmed manufacturer brand", evidence: ["https://example.test/motrio"] });
});

test("rejects invented merge IDs and incomplete AI responses", () => {
  const bmw = classifyBrand({ id: "draft_20", name: "BMW OE" }, EMPTY_DATA);
  const motrio = classifyBrand({ id: "draft_21", name: "Motrio" }, EMPTY_DATA);
  const result = parseAiReviewJson(JSON.stringify({
    schemaVersion: "brandmaster.ai-review.v1",
    decisions: [{ unmappedBrandId: "draft_20", unmappedBrandName: "BMW OE", action: "MERGE", targetBrandId: "brand_invented", targetBrandName: "BMW", confidence: 99, reason: "Looks like BMW", evidence: [] }],
  }), [bmw, motrio], new Set([bmw.targetId!].filter(Boolean)));
  assert.equal(result.changes.length, 0);
  assert.ok(result.errors.some((error) => error.includes("not in the loaded local brand tables")));
  assert.ok(result.errors.some((error) => error.includes("Motrio: decision is missing")));
});

test("round-trips Unicode workspaces through GitHub base64", () => {
  const value = JSON.stringify({ brand: "Škoda 日本", note: "B & P Rods" });
  assert.equal(base64ToText(textToBase64(value)), value);
});

test("protects GitHub workspace updates with revision-aware sync plans", () => {
  assert.equal(decideGitHubSync(null, null), "create");
  assert.equal(decideGitHubSync("remote-a", null), "pull");
  assert.equal(decideGitHubSync("remote-a", "remote-a"), "push");
  assert.equal(decideGitHubSync("remote-b", "remote-a"), "conflict");
});

test("merges incremental workspace changes without dropping a teammate's edits", () => {
  const base = { schemaVersion: "brandmaster.workspace.v1" as const, exportedAt: "2026-07-14T10:00:00.000Z", data: { ...EMPTY_DATA, learned: { alpha: { action: "SKIP" as const, reason: "base", reviewedAt: "2026-07-14" } }, customBrands: [{ id: "brand_a", name: "Alpha", aliases: [], category: "Automotive", source: "Manual" as const }] }, ubq: null };
  const local = { ...base, data: { ...base.data, learned: { ...base.data.learned, local: { action: "CREATE" as const, targetName: "Local", reason: "local", reviewedAt: "2026-07-14" } } } };
  const remote = { ...base, data: { ...base.data, customBrands: [...base.data.customBrands, { id: "brand_b", name: "Remote", aliases: [], category: "Automotive", source: "Manual" as const }] } };
  const merged = mergeWorkspaceSnapshots(base, local, remote);
  assert.equal(merged.workspace.data.learned.local.action, "CREATE");
  assert.deepEqual(merged.workspace.data.customBrands.map((brand) => brand.id), ["brand_a", "brand_b"]);
  assert.ok(merged.localChanges > 0);
  assert.ok(merged.remoteChanges > 0);
});
