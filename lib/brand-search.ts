import { normalizeBrand } from "./brand-engine";
import { CatalogBrand } from "./types";

export type BrandMatchKind = "ID_EXACT" | "NAME_EXACT" | "ALIAS_EXACT" | "ID_PARTIAL" | "PREFIX" | "CONTAINS" | "FUZZY" | "NONE";

export interface BrandMatch {
  score: number;
  kind: BrandMatchKind;
  matchedValue?: string;
}

const noMatch: BrandMatch = { score: 0, kind: "NONE" };

function normalized(value: string) {
  return normalizeBrand(value).toLowerCase();
}

function bigrams(value: string) {
  return new Set(Array.from({ length: Math.max(0, value.length - 1) }, (_, index) => value.slice(index, index + 2)));
}

/**
 * Matches human brand text against names and aliases. Opaque BrandIDs match
 * exactly, or by an intentional substantial fragment, but never by a short
 * accidental sequence such as "STW" inside a generated ID.
 */
export function matchCatalogBrand(query: string, brand: CatalogBrand): BrandMatch {
  const rawNeedle = query.trim().toLowerCase();
  const needle = normalized(query);
  if (!needle) return noMatch;

  const id = brand.id.toLowerCase();
  if (id === rawNeedle) return { score: 130, kind: "ID_EXACT", matchedValue: brand.id };

  const name = normalized(brand.name);
  if (name === needle) return { score: 120, kind: "NAME_EXACT", matchedValue: brand.name };

  const aliases = (brand.aliases || []).map((value) => ({ raw: value, normalized: normalized(value) })).filter((value) => value.normalized);
  const exactAlias = aliases.find((value) => value.normalized === needle);
  if (exactAlias) return { score: 118, kind: "ALIAS_EXACT", matchedValue: exactAlias.raw };

  const intentionalIdLookup = rawNeedle.length >= 8 && (rawNeedle.includes("_") || rawNeedle.startsWith("brand") || rawNeedle.startsWith("draft"));
  if (intentionalIdLookup && id.includes(rawNeedle)) return { score: 110, kind: "ID_PARTIAL", matchedValue: brand.id };

  const candidates = [{ raw: brand.name, normalized: name }, ...aliases];
  const prefix = candidates.find((value) => value.normalized.startsWith(needle));
  if (prefix) return { score: 105, kind: "PREFIX", matchedValue: prefix.raw };

  if (needle.length >= 3) {
    const contains = candidates.find((value) => value.normalized.includes(needle) || (value.normalized.length >= 3 && needle.includes(value.normalized)));
    if (contains) return { score: 98, kind: "CONTAINS", matchedValue: contains.raw };
  }

  if (needle.length < 3) return noMatch;
  const left = bigrams(needle);
  let best = noMatch;
  candidates.forEach((candidate) => {
    const right = bigrams(candidate.normalized);
    let overlap = 0;
    left.forEach((part) => { if (right.has(part)) overlap += 1; });
    const similarity = left.size && right.size ? (2 * overlap) / (left.size + right.size) : 0;
    const score = Math.round(similarity * 90);
    if (score > best.score) best = { score, kind: "FUZZY", matchedValue: candidate.raw };
  });
  return best;
}

export function brandMatchLabel(match: BrandMatch) {
  if (match.kind === "ID_EXACT") return "Exact BrandID";
  if (match.kind === "NAME_EXACT") return "Exact name";
  if (match.kind === "ALIAS_EXACT") return `Exact alias: ${match.matchedValue}`;
  if (match.kind === "ID_PARTIAL") return "BrandID match";
  if (match.kind === "PREFIX") return `Starts with: ${match.matchedValue}`;
  if (match.kind === "CONTAINS") return `Contains: ${match.matchedValue}`;
  if (match.kind === "FUZZY") return `Similar: ${match.matchedValue}`;
  return "No match";
}

