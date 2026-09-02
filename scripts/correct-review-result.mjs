import fs from "node:fs";

const input = "artifacts/brandmaster-review-61-c14ed644.json";
const output = "artifacts/brandmaster-review-61-c14ed644-corrected.json";
const rejected = new Set([
  "ABS OEM",
  "ACL Bearings",
  "ACL OEM",
  "aer",
  "AGA Tools",
  "AJP",
  "AMD Auto Metel Direct",
  "AMI",
  "AMK Products",
  "APS Inc.",
  "Arena",
  "ATK Engines",
  "Atlantic Automotive",
  "Beru 100% New",
  "best USA, ?ILONPA",
  "Bilstein B4 + Lemfoerder + Vaico",
]);
const result = JSON.parse(fs.readFileSync(input, "utf8"));
result.decisions = result.decisions.filter((decision) => !rejected.has(decision.unmappedBrandName));
fs.writeFileSync(output, JSON.stringify(result, null, 2) + "\n");
console.log(`${output}: ${result.decisions.length} decisions`);
