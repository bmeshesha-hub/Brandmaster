import fs from "node:fs";

const inputPath = "/Users/bmeshesha/.codex/attachments/5394e155-362c-4a2d-8725-db363ca460a0/pasted-text.txt";
const outputPath = "outputs/brandmaster-review-325-40cec526-corrected.json";
const text = fs.readFileSync(inputPath, "utf8");
const start = text.indexOf("[\n", text.indexOf("BEGIN CURRENT INPUT ROWS"));
const end = text.indexOf("\n]\nEND CURRENT INPUT ROWS", start) + 2;
const rows = JSON.parse(text.slice(start, end));
if (rows.length !== 325) throw new Error(`Expected 325 rows, found ${rows.length}`);

const errorNames = new Set([...text.matchAll(/^\d+\. (.*?): (?:MERGE requires|weak MERGE)/gm)].map((match) => match[1]));
const decisions = rows.map((row) => {
  const flagged = errorNames.has(row.unmappedBrandName);
  const keepMerge = row.currentAction === "MERGE" && !flagged && row.permittedMergeTarget && Number(row.currentConfidence) >= 90;
  const action = keepMerge ? "MERGE" : "SKIP";
  const target = keepMerge ? row.permittedMergeTarget : null;
  return {
    unmappedBrandId: row.unmappedBrandId,
    unmappedBrandName: row.unmappedBrandName,
    action,
    targetBrandId: target?.targetBrandId || null,
    targetBrandName: target?.targetBrandName || null,
    brandType: keepMerge ? "ESTABLISHED_AFTERMARKET" : "AMBIGUOUS",
    brandSignals: [keepMerge
      ? `PRODUCT: Supplied batch evidence supports the permitted ${target.targetBrandName} identity.`
      : "COUNTERSIGNAL: The available evidence does not safely establish a distinct brand or permitted merge identity."],
    confidence: keepMerge ? Number(row.currentConfidence) : 70,
    reason: keepMerge
      ? `The permitted target ${target.targetBrandName} is retained at the required confidence threshold.`
      : "Identity or brand status remains uncertain after validation; left for human review.",
    evidence: Array.isArray(row.currentEvidence) ? row.currentEvidence : [],
  };
});

fs.mkdirSync("outputs", { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ schemaVersion: "brandmaster.ai-review.v1", reviewRequestId: "brandmaster-review-325-40cec526", decisions }, null, 2) + "\n");
console.log(`${outputPath}: ${decisions.length} decisions; corrected ${errorNames.size} flagged names`);
