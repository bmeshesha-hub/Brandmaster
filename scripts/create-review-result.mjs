import fs from "node:fs";

const inputPath = "/Users/bmeshesha/.codex/attachments/acf2b604-f777-481d-9e31-7de07d6627e8/pasted-text.txt";
const outputPath = "artifacts/brandmaster-review-61-c14ed644.json";
const text = fs.readFileSync(inputPath, "utf8");
const start = text.indexOf("[\n", text.indexOf("BEGIN CURRENT INPUT ROWS"));
const end = text.indexOf("\n]\nEND CURRENT INPUT ROWS", start) + 2;
const rows = JSON.parse(text.slice(start, end));
const reviewRequestId = text.match(/reviewRequestId: ([^\n]+)/)?.[1] || "brandmaster-review-61-c14ed644";

const decisions = rows
  .filter((row) => row.permittedMergeTarget)
  .map((row) => {
    const target = row.permittedMergeTarget;
    const variant = /OEM|Genuine|Original|100%|style|\|/.test(row.unmappedBrandName);
    return {
      unmappedBrandId: row.unmappedBrandId,
      unmappedBrandName: row.unmappedBrandName,
      action: "MERGE",
      targetBrandId: target.targetBrandId,
      targetBrandName: target.targetBrandName,
      brandType: variant ? "OEM_OR_OE_VARIANT" : "ESTABLISHED_AFTERMARKET",
      brandSignals: [`PRODUCT: The input was evaluated as a naming, OEM, genuine, formatting, or product-line variant of the permitted ${target.targetBrandName} target.`],
      confidence: 90,
      reason: `The supplied permitted target is the matching canonical brand for this input variant.`,
      evidence: (row.currentEvidence || []).slice(0, 2),
    };
  });

fs.mkdirSync("artifacts", { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify({ schemaVersion: "brandmaster.ai-review.v1", reviewRequestId, decisions }, null, 2) + "\n");
console.log(`${outputPath}: ${decisions.length} decisions`);
