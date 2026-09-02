import fs from "node:fs";
import path from "node:path";

const appRoot = process.cwd();
const dataRoot = path.resolve(appRoot, "../GitHub/Brandmaster-data");
const jobs = JSON.parse(fs.readFileSync(path.join(appRoot, "enrichment-service/data/jobs.json"), "utf8"));
const latest = [...jobs.jobs].filter((job) => job.status === "COMPLETED").sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))[0];
if (!latest) throw new Error("No completed enrichment job found.");
const candidates = jobs.candidates.filter((candidate) => candidate.jobId === latest.id);
const resources = candidates.map((candidate) => ({
  brandId: candidate.brandId,
  rootName: candidate.currentName || "",
  rootAliases: candidate.currentAliases || [],
  proposedName: candidate.suggestedName || candidate.currentName || "",
  proposedAliases: candidate.suggestedAliases || candidate.currentAliases || [],
  confidence: Number(candidate.confidence || 0),
  recommendation: candidate.suggestedName === candidate.currentName && JSON.stringify(candidate.suggestedAliases || []) === JSON.stringify(candidate.currentAliases || []) ? "NO_CHANGE" : "REVIEW",
  evidence: (candidate.evidence || []).map((e) => ({ source: e.title || e.source || "Brand Enrichment", url: e.url, detail: e.detail })),
  generatedAt: latest.completedAt || new Date().toISOString(),
}));
const chunkDir = path.join(dataRoot, "brandmaster/workspace-data");
fs.writeFileSync(path.join(chunkDir, "enrichment-resources-0000.json"), JSON.stringify(resources));
const manifestPath = path.join(dataRoot, "brandmaster/workspace.json");
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
manifest.arrays = { ...manifest.arrays, enrichmentResources: ["brandmaster/workspace-data/enrichment-resources-0000.json"] };
manifest.exportedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
const corePath = path.join(chunkDir, "core.json");
const core = JSON.parse(fs.readFileSync(corePath, "utf8"));
core.sourceMeta = { ...core.sourceMeta, ENRICHMENT: { filename: `Brand Enrichment · ${latest.filename}`, updatedAt: latest.completedAt || new Date().toISOString(), rowCount: resources.length } };
fs.writeFileSync(corePath, JSON.stringify(core));
console.log(`Backfilled ${resources.length} enrichment resources from ${latest.id}.`);
