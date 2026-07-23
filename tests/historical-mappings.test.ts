import assert from "node:assert/strict";
import test from "node:test";
import { classifyBrand } from "../lib/brand-engine";
import { mergeHistoricalMappings, mergeManualFpaIds, parseHistoricalMappingCsv } from "../lib/historical-mappings";
import { EMPTY_DATA, workspaceBackupFilename } from "../lib/storage";

const CSV = `Brand,Action,Date
"Smith, Jones",New Brand,7/1/2026
Toyota OE,Alias,7/2/2026
Not A Brand,Skipped,7/3/2026
"A ""Quoted"" Brand",Deleted,2026-07-04`;

const TEAM_CSV = `listing_brand,Action,Date,Assigned
apec braking,New Brand,7/1/2026,Mike
nicht zutreffend,Skipped,7/2/2026,Bef`;

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

test("preserves Assigned or Reviewer attribution for team analytics", () => {
  const result = parseHistoricalMappingCsv(TEAM_CSV, "team-progress.csv");
  assert.deepEqual(result.entries.map((entry) => entry.reviewer), ["Mike", "Bef"]);
});

test("imports the rich shared progress worksheet while ignoring redundant columns", () => {
  const rich = `listing_brand,live_listings,sellers,"Should
be Mapped?",Action,Date,Assigned,Notes,UBQ,Unmapped Brand ID,"Target
Brand ID","Target
Brand Name"
apec braking,"412,284",320,Yes,New Brand,7/1/2026,Mike,checked,Yes,draft_brand_source,,
baxter,206260,29,Yes,Alias,7/2/2026,Bef,,Yes,draft_brand_alias,brand_target,Baxter Group
unfinished,100,2,Yes,New Brand,,Mike,,Yes,draft_brand_unfinished,,`;
  const result = parseHistoricalMappingCsv(rich, "team-progress.csv", "2026-07-23T12:00:00.000Z");
  assert.equal(result.entries.length, 2);
  assert.equal(result.idReferences.length, 3);
  assert.equal(result.skipped, 1);
  assert.deepEqual(result.entries[0], {
    id: "historical:draft_brand_source:CREATE:2026-07-01",
    brand: "apec braking",
    normalized: "apec braking",
    sourceBrandId: "draft_brand_source",
    action: "CREATE",
    originalAction: "New Brand",
    date: "2026-07-01T12:00:00.000Z",
    reviewer: "Mike",
    targetBrandId: undefined,
    targetBrandName: undefined,
    listingCount: 412284,
    sellerCount: 320,
    notes: "checked",
    ubq: true,
    sourceRow: 2,
    sourceFilename: "team-progress.csv",
    importedAt: "2026-07-23T12:00:00.000Z",
  });
  assert.equal(result.entries[1].targetBrandId, "brand_target");
  assert.equal(result.entries[1].targetBrandName, "Baxter Group");
  assert.deepEqual(result.idReferences.find((reference) => reference.brand === "unfinished"), {
    id: "manual-fpa:draft_brand_unfinished",
    brand: "unfinished",
    normalized: "unfinished",
    sourceBrandId: "draft_brand_unfinished",
    ubq: true,
    listingCount: 100,
    sellerCount: 2,
    reviewer: "Mike",
    sourceRow: 4,
    sourceFilename: "team-progress.csv",
    importedAt: "2026-07-23T12:00:00.000Z",
  });
});

test("regular reconciliation updates Manual FPA ID and UBQ references by brand", () => {
  const first = parseHistoricalMappingCsv("listing_brand,Action,Date,UBQ,Unmapped Brand ID\nReturned,, ,No,draft_brand_old", "first.csv").idReferences;
  const latest = parseHistoricalMappingCsv("listing_brand,Action,Date,UBQ,Unmapped Brand ID\nReturned,,,Yes,draft_brand_new", "latest.csv").idReferences;
  const merged = mergeManualFpaIds(first, latest, "update");
  assert.equal(merged.length, 1);
  assert.equal(merged[0].sourceBrandId, "draft_brand_new");
  assert.equal(merged[0].ubq, true);
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

test("does not reuse an offline action while the Manual FPA row still says UBQ Yes", () => {
  const historicalMappings = parseHistoricalMappingCsv("listing_brand,Action,Date,UBQ,Unmapped Brand ID\nStill Open,Skipped,7/3/2026,Yes,draft_brand_open", "manual-fpa.csv").entries;
  const result = classifyBrand({ id: "draft_brand_open", name: "Still Open" }, { ...EMPTY_DATA, historicalMappings });
  assert.equal(result.action, "CREATE");
  assert.equal(result.decisionSource, "Offline fallback");
});

test("uses a sortable local date and time in workspace backup filenames", () => {
  assert.equal(workspaceBackupFilename(new Date(2026, 6, 15, 14, 32, 8)), "brandmaster-workspace-2026-07-15_14-32-08.json");
  assert.equal(workspaceBackupFilename(new Date(2026, 6, 15, 14, 32, 8), "Mike"), "brandmaster-workspace-mike-2026-07-15_14-32-08.json");
});
