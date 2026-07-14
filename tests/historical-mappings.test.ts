import assert from "node:assert/strict";
import test from "node:test";
import { classifyBrand } from "../lib/brand-engine";
import { mergeHistoricalMappings, parseHistoricalMappingCsv } from "../lib/historical-mappings";
import { EMPTY_DATA } from "../lib/storage";

const CSV = `Brand,Action,Date
"Smith, Jones",New Brand,7/1/2026
Toyota OE,Alias,7/2/2026
Not A Brand,Skipped,7/3/2026
"A ""Quoted"" Brand",Deleted,2026-07-04`;

test("parses quoted historical mapping CSV rows and maps legacy action labels", () => {
  const result = parseHistoricalMappingCsv(CSV, "history.csv", "2026-07-14T12:00:00.000Z");
  assert.equal(result.entries.length, 4);
  assert.equal(result.skipped, 0);
  assert.deepEqual(result.entries.map((entry) => entry.action), ["CREATE", "MERGE", "SKIP", "DELETE"]);
  assert.equal(result.entries[0].brand, "Smith, Jones");
  assert.equal(result.entries[1].normalized, "Toyota");
  assert.equal(result.entries[3].brand, `A "Quoted" Brand`);
  assert.equal(result.entries[0].date, "2026-07-01T12:00:00.000Z");
});

test("supports append, matching-brand update, and full replacement", () => {
  const first = parseHistoricalMappingCsv(CSV, "first.csv").entries;
  const additional = parseHistoricalMappingCsv("Brand,Action,Date\nToyota,Skipped,7/8/2026\nFresh,New Brand,7/9/2026", "second.csv").entries;
  const appended = mergeHistoricalMappings(first, additional, "append");
  assert.equal(appended.entries.length, 6);
  const updated = mergeHistoricalMappings(first, additional, "update");
  assert.equal(updated.entries.length, 5);
  assert.equal(updated.entries.filter((entry) => entry.normalized === "Toyota").length, 1);
  assert.equal(updated.entries.find((entry) => entry.normalized === "Toyota")?.action, "SKIP");
  const replaced = mergeHistoricalMappings(first, additional, "replace");
  assert.deepEqual(replaced.entries, additional);
});

test("uses historical mapping memory without inventing an Alias target BrandID", () => {
  const historicalMappings = parseHistoricalMappingCsv(`${CSV}\nMemory Alias OE,Alias,7/5/2026`, "history.csv").entries;
  const skipped = classifyBrand({ id: "draft_1", name: "Not A Brand" }, { ...EMPTY_DATA, historicalMappings });
  assert.equal(skipped.action, "SKIP");
  assert.equal(skipped.status, "ready");
  assert.equal(skipped.decisionSource, "Historical mapping memory");

  const aliasWithoutTarget = classifyBrand({ id: "draft_2", name: "Memory Alias OE" }, { ...EMPTY_DATA, historicalMappings });
  assert.equal(aliasWithoutTarget.action, "SKIP");
  assert.equal(aliasWithoutTarget.status, "needs-review");
  assert.equal(aliasWithoutTarget.targetId, undefined);

  const aliasWithTarget = classifyBrand({ id: "draft_3", name: "Memory Alias OE" }, { ...EMPTY_DATA, historicalMappings, rootBrands: [{ id: "brand_memory", name: "MEMORY ALIAS", aliases: [], category: "Automotive", source: "Root", status: "ACTIVE" }] });
  assert.equal(aliasWithTarget.action, "MERGE");
  assert.equal(aliasWithTarget.targetId, "brand_memory");
});

test("can disable historical mapping memory independently", () => {
  const historicalMappings = parseHistoricalMappingCsv("Brand,Action,Date\nMemory Only,Skipped,7/3/2026", "history.csv").entries;
  const result = classifyBrand({ id: "draft_1", name: "Memory Only" }, { ...EMPTY_DATA, historicalMappings, validationSettings: { ...EMPTY_DATA.validationSettings, historicalMappings: false } });
  assert.equal(result.action, "CREATE");
  assert.equal(result.decisionSource, "Offline fallback");
});
