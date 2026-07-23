import fs from "node:fs";
import path from "node:path";
import { parseHistoricalMappingCsv } from "../lib/historical-mappings";

const [, , input, output, capturedAt] = process.argv;
if (!input || !output || !capturedAt || Number.isNaN(Date.parse(capturedAt))) {
  throw new Error("Usage: node --import tsx scripts/generate-not-done-snapshot.ts <input.csv> <output.json> <capturedAt ISO>");
}

const parsed = parseHistoricalMappingCsv(fs.readFileSync(input, "utf8"), path.basename(input), capturedAt);
const rows = parsed.idReferences
  .filter((reference) => reference.ubq === true)
  .map((reference) => ({
    id: reference.sourceBrandId,
    name: reference.brand,
    listingCount: reference.listingCount,
    sellerCount: reference.sellerCount,
  }));
if (!rows.length) throw new Error("The CSV contains no valid rows marked UBQ = Yes with an Unmapped Brand ID.");

fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, `${JSON.stringify({
  schemaVersion: "brandmaster.not-done.v1",
  filename: path.basename(input),
  capturedAt: new Date(capturedAt).toISOString(),
  rows,
}, null, 2)}\n`);
console.log(`Wrote ${rows.length.toLocaleString()} authoritative not-done rows to ${output}`);
