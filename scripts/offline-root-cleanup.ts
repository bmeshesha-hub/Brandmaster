import fs from "node:fs";
import path from "node:path";
import { buildOfflineRootReport, normalizeRootRows } from "../lib/offline-root-cleanup";
import { parseReferenceCsv } from "../lib/brand-engine";

const input = process.argv[2];
if (!input) throw new Error("Usage: npm run offline:root-cleanup -- <root.json> [output.json]");
const output = process.argv[3] || `${input.replace(/\.[^.]+$/, "")}-offline-cleanup.json`;
const raw = fs.readFileSync(input, "utf8");
let brands;
if (/\.csv$/i.test(input)) brands = parseReferenceCsv(raw, "ROOT");
else {
  const payload = JSON.parse(raw);
  if (payload?.schemaVersion === "brandmaster.ai-review.v1" && Array.isArray(payload.decisions)) throw new Error("This is an AI review decision file, not a Root table. Supply the Root export containing brand IDs, names, and aliases.");
  brands = normalizeRootRows(payload);
}
const report = buildOfflineRootReport(brands);
fs.writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(`Processed ${report.inputRows.toLocaleString()} Root rows.`);
console.log(`Found ${report.issues.length.toLocaleString()} review issues and ${report.suggestedChanges.length.toLocaleString()} conservative suggestions.`);
console.log(`Report: ${path.resolve(output)}`);
