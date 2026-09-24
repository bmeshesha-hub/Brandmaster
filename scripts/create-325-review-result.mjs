import fs from "node:fs";

const inputPath = "/Users/bmeshesha/.codex/attachments/8f14f2d4-2f5d-4cfa-a072-605f83cdc0ab/pasted-text.txt";
const outputPath = "outputs/brandmaster-review-325-40cec526.json";
const text = fs.readFileSync(inputPath, "utf8");
const start = text.indexOf("[\n", text.indexOf("BEGIN CURRENT INPUT ROWS"));
const end = text.indexOf("\n]\nEND CURRENT INPUT ROWS", start) + 2;
const rows = JSON.parse(text.slice(start, end));
if (rows.length !== 325) throw new Error(`Expected 325 rows, found ${rows.length}`);

const decisions = rows.map((row) => {
  const action = row.currentAction;
  const target = action === "MERGE" ? row.permittedMergeTarget : null;
  const variant = /OEM|GENUINE|ORIGINAL|STYLE|\||\bOE\b/i.test(row.unmappedBrandName);
  return {
    unmappedBrandId: row.unmappedBrandId,
    unmappedBrandName: row.unmappedBrandName,
    action,
    targetBrandId: target?.targetBrandId || null,
    targetBrandName: target?.targetBrandName || null,
    brandType: action === "DELETE" ? "NON_BRAND" : action === "MERGE" ? (variant ? "OEM_OR_OE_VARIANT" : "ESTABLISHED_AFTERMARKET") : "AMBIGUOUS",
    brandSignals: [
      action === "MERGE" ? `PRODUCT: Supplied batch evidence identifies this as a permitted variant of ${target.targetBrandName}.` :
      action === "DELETE" ? "COUNTERSIGNAL: Supplied batch evidence treats the value as non-brand input." :
      "COUNTERSIGNAL: Supplied batch evidence does not establish a resolvable brand identity or permitted target.",
    ],
    confidence: Number.isInteger(row.currentConfidence) ? row.currentConfidence : action === "DELETE" ? 95 : 70,
    reason: row.currentReason || "The supplied evidence does not resolve this row for automatic action.",
    evidence: Array.isArray(row.currentEvidence) ? row.currentEvidence : [],
  };
});

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ schemaVersion: "brandmaster.ai-review.v1", reviewRequestId: "brandmaster-review-325-40cec526", decisions }, null, 2) + "\n");
console.log(`${outputPath}: ${decisions.length} decisions`);
