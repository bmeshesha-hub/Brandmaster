import assert from "node:assert/strict";
import test from "node:test";
import { classifyBrand, normalizeBrand, parseCsv, parseDecisionCsv, parseReferenceCsv, toCsv } from "../lib/brand-engine";
import { EMPTY_DATA } from "../lib/storage";

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

test("learned decisions take precedence", () => {
  const result = classifyBrand({ id: "3", name: "HOBI" }, {
    ...EMPTY_DATA,
    learned: { hobi: { action: "SKIP", reason: "Previously reviewed", reviewedAt: "2026-07-13" } },
  });
  assert.equal(result.action, "SKIP");
  assert.equal(result.confidence, 100);
});

test("exports the required five columns", () => {
  const record = classifyBrand({ id: "draft_1", name: "BMW OE" }, EMPTY_DATA);
  const csv = toCsv([record]);
  assert.equal(csv.split("\n")[0], "UnmappedBrandID,UnmappedBrandName,Action,TargetBrandID,TargetBrandName");
  assert.match(csv, /"draft_1","BMW OE","MERGE","brand_bbRDNMtVVPeqthpbpvJEiS","BMW"/);
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

test("unimplemented online settings never claim external evidence", () => {
  const result = classifyBrand({ id: "draft_17", name: "Totally New Brand" }, {
    ...EMPTY_DATA,
    validationSettings: { ...EMPTY_DATA.validationSettings, officialWebsiteSearch: true, marketplaceSearch: true, googleSearch: true, aiValidator: true },
  });
  assert.equal(result.decisionSource, "Offline fallback");
  assert.deepEqual(result.evidence, ["No previous, alias, existing-brand, ACA, or FPA match", "Offline fallback decision"]);
});
