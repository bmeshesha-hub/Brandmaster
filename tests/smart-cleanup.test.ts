import assert from "node:assert/strict";
import test from "node:test";
import { analyzeRootBrands, analyzeUbqBrands, cleanupIssueCounts, cleanupRecordFingerprint } from "../lib/smart-cleanup";
import { CatalogBrand } from "../lib/types";

const root = (values: Partial<CatalogBrand> & Pick<CatalogBrand, "id" | "name">): CatalogBrand => ({ aliases: [], category: "Automotive", source: "Root", ...values });

test("finds duplicate Root brands, junk values, damaged names, and broken targets", () => {
  const issues = analyzeRootBrands([
    root({ id: "brand_toyota", name: "TOYOTA", aliases: ["Toyota Genuine"] }),
    root({ id: "brand_toyota_2", name: "Toyota", aliases: [] }),
    root({ id: "brand_junk", name: "Unknown" }),
    root({ id: "brand_symbol", name: "@LUCHES" }),
    root({ id: "brand_broken", name: "Old Brand", sameAs: "brand_missing" }),
  ]);
  assert.equal(issues.some((issue) => issue.brandId === "brand_toyota_2" && issue.type === "DUPLICATE" && issue.targetId === "brand_toyota"), true);
  assert.equal(issues.some((issue) => issue.brandId === "brand_junk" && issue.type === "JUNK"), true);
  assert.equal(issues.some((issue) => issue.brandId === "brand_symbol" && issue.type === "SYMBOLS"), true);
  assert.equal(issues.some((issue) => issue.brandId === "brand_broken" && issue.type === "BROKEN_TARGET"), true);
});

test("detects conflicting Root aliases", () => {
  const issues = analyzeRootBrands([
    root({ id: "brand_one", name: "One", aliases: ["Shared Alias"] }),
    root({ id: "brand_two", name: "Two", aliases: ["shared-alias"] }),
  ]);
  assert.equal(issues.filter((issue) => issue.type === "ALIAS_CONFLICT").length, 2);
  assert.deepEqual(cleanupIssueCounts(issues), { HIGH: 2, MEDIUM: 0, LOW: 0 });
});

test("finds UBQ rows that match Root brands and groups related unknown names", () => {
  const issues = analyzeUbqBrands([
    { id: "draft_1", name: "Toyota Genuine" },
    { id: "draft_2", name: "Asanti Black Label" },
    { id: "draft_3", name: "ASANTI BLACK LABEL SERIES / ASANTI" },
    { id: "draft_4", name: "Details in Description" },
  ], [root({ id: "brand_toyota", name: "Toyota", aliases: ["Toyota Genuine"] })]);
  const match = issues.find((issue) => issue.brandId === "draft_1");
  assert.equal(match?.type, "EXISTING_BRAND");
  assert.equal(match?.targetId, "brand_toyota");
  assert.equal(issues.some((issue) => issue.brandId === "draft_2" && issue.type === "UBQ_FAMILY"), true);
  assert.equal(issues.some((issue) => issue.brandId === "draft_4" && issue.type === "JUNK"), true);
});

test("clean confirmations remain valid only while the source record is unchanged", () => {
  const before = root({ id: "brand_clean", name: "Clean Brand", aliases: ["Clean"] });
  const sameWithReorderedAliases = root({ id: "brand_clean", name: "Clean Brand", aliases: ["Clean"] });
  const changed = root({ id: "brand_clean", name: "Clean Brand USA", aliases: ["Clean"] });
  assert.equal(cleanupRecordFingerprint("ROOT", before), cleanupRecordFingerprint("ROOT", sameWithReorderedAliases));
  assert.notEqual(cleanupRecordFingerprint("ROOT", before), cleanupRecordFingerprint("ROOT", changed));
  assert.notEqual(cleanupRecordFingerprint("UBQ", { id: "draft_1", name: "Clean Brand" }), cleanupRecordFingerprint("UBQ", { id: "draft_1", name: "Clean Brand OE" }));
});
