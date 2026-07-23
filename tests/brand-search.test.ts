import assert from "node:assert/strict";
import test from "node:test";
import { brandMatchLabel, matchCatalogBrand } from "../lib/brand-search";
import { CatalogBrand } from "../lib/types";

const brand = (id: string, name: string, aliases: string[] = []): CatalogBrand => ({
  id,
  name,
  aliases,
  category: "Automotive",
  source: "Root",
});

test("short text never matches accidental characters inside opaque BrandIDs", () => {
  const unrelated = brand("brand_sUuKaSTwCzm1G3W63mJTuN", "Automoded");
  assert.deepEqual(matchCatalogBrand("STW", unrelated), { score: 0, kind: "NONE" });
});

test("brand search prioritizes exact names and explains alias matches", () => {
  const exact = matchCatalogBrand("STW", brand("brand_123", "STW"));
  const alias = matchCatalogBrand("STW", brand("brand_456", "Stone Works", ["STW"]));
  assert.equal(exact.kind, "NAME_EXACT");
  assert.equal(exact.score, 120);
  assert.equal(brandMatchLabel(exact), "Exact name");
  assert.equal(alias.kind, "ALIAS_EXACT");
  assert.equal(brandMatchLabel(alias), "Exact alias: STW");
});

test("exact and intentional BrandID searches still work", () => {
  const candidate = brand("brand_sUuKaSTwCzm1G3W63mJTuN", "Automoded");
  assert.equal(matchCatalogBrand(candidate.id, candidate).kind, "ID_EXACT");
  assert.equal(matchCatalogBrand("brand_sUuKaSTw", candidate).kind, "ID_PARTIAL");
});

test("name prefix, containment, and fuzzy matching remain available", () => {
  const candidate = brand("brand_123", "STW Performance");
  assert.equal(matchCatalogBrand("STW", candidate).kind, "PREFIX");
  assert.equal(matchCatalogBrand("performance", candidate).kind, "CONTAINS");
  assert.ok(matchCatalogBrand("STX Performance", candidate).score >= 42);
});
