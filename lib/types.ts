export type Action = "CREATE" | "MERGE" | "SKIP" | "DELETE";
export type WorkflowSource = "IMPORT" | "UBQ" | "ROOT";
export type View = "dashboard" | "imports" | "review" | "output" | "brands" | "aliases" | "ledger" | "analytics" | "artifacts" | "settings";

export interface CatalogBrand {
  id: string;
  name: string;
  aliases: string[];
  category: string;
  website?: string;
  country?: string;
  source?: "ACA" | "FPA" | "Root" | "Built-in" | "Manual";
  sameAs?: string;
  rootSource?: string;
  rootStatus?: string;
}

export interface RootTableChange {
  id: string;
  type: "CREATE" | "UPDATE";
  before?: CatalogBrand;
  after: CatalogBrand;
  changedFields: string[];
  updatedAt: string;
  status?: "PENDING" | "APPLIED";
  lastCheckedAt?: string;
}

export interface ValidationSettings {
  previousDecisions: boolean;
  aliasTable: boolean;
  acaTable: boolean;
  fpaTable: boolean;
  rootBrandTable: boolean;
  offlineRules: boolean;
  aiValidator: boolean;
  officialWebsiteSearch: boolean;
  marketplaceSearch: boolean;
  googleSearch: boolean;
  openAiApiKey: string;
  searchApiKey: string;
}

export type ValidationSource = "UBQ" | "DECISIONS" | "ROOT" | "ACA" | "FPA";
export interface SourceMetadata { filename: string; updatedAt: string; }

export interface BrandRecord {
  id: string;
  name: string;
  listingCount?: number;
  skuCount?: number;
  normalized: string;
  action: Action;
  targetId?: string;
  targetName?: string;
  confidence: number;
  reason: string;
  evidence: string[];
  status: "ready" | "reviewed" | "needs-review";
  reviewer?: string;
  reviewedAt?: string;
  notes?: string;
  ubqVerified?: boolean;
  decisionSource: string;
  workflowSource?: WorkflowSource;
  sourceBrandId?: string;
  relatedUbq?: { id: string; name: string; score: number; reason: string }[];
  ubqFamilyCanonicalId?: string;
  ubqFamilyCanonicalName?: string;
  priorFamilyTargetId?: string;
  priorFamilyTargetName?: string;
  previouslyMergedStillPresent?: boolean;
}

export interface ImportBatch {
  id: string;
  filename: string;
  createdAt: string;
  rows: number;
  records: BrandRecord[];
  workflowSource?: WorkflowSource;
}

export interface LedgerEntry extends BrandRecord {
  ledgerId: string;
  date: string;
}

export interface AppData {
  batches: ImportBatch[];
  ledger: LedgerEntry[];
  learned: Record<string, Pick<BrandRecord, "action" | "targetId" | "targetName" | "reason"> & { reviewedAt: string; origin?: "imported" | "manual" }>;
  customBrands: CatalogBrand[];
  acaBrands: CatalogBrand[];
  fpaBrands: CatalogBrand[];
  rootBrands: CatalogBrand[];
  rootChanges: Record<string, RootTableChange>;
  sourceMeta: Partial<Record<ValidationSource, SourceMetadata>>;
  validationSettings: ValidationSettings;
}

export interface SharedWorkspaceSnapshot {
  schemaVersion: "brandmaster.workspace.v1";
  exportedAt: string;
  data: AppData;
  ubq: { filename: string; rows: { id: string; name: string; listingCount?: number; skuCount?: number }[] } | null;
  sync?: {
    lastSyncedAt: string;
    lastSyncedBy: string;
    history: { syncedAt: string; syncedBy: string; changeCount: number }[];
  };
}
