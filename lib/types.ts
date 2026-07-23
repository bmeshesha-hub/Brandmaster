export type Action = "CREATE" | "MERGE" | "SKIP" | "DELETE";
export type WorkflowSource = "IMPORT" | "UBQ" | "ROOT";
export type View = "dashboard" | "imports" | "review" | "output" | "cleanup" | "quality" | "brands" | "aliases" | "ledger" | "analytics" | "artifacts" | "settings";

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
  adminStatus?: "RECOMMENDED" | "OPENED" | "COMPLETED" | "VERIFIED" | "REJECTED" | "SUPERSEDED";
  adminUpdatedAt?: string;
  adminUpdatedBy?: string;
  verificationNote?: string;
}

export interface ValidationSettings {
  previousDecisions: boolean;
  historicalMappings: boolean;
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

export type ValidationSource = "UBQ" | "MANUAL_FPA" | "DECISIONS" | "HISTORICAL" | "ROOT" | "ACA" | "FPA";
export interface SourceMetadata { filename: string; updatedAt: string; rowCount?: number; fingerprint?: string; }

export type ReconciliationStatus = "AWAITING_NEWER_DATA" | "VERIFIED" | "NOT_APPLIED" | "PARTIALLY_APPLIED" | "CONFLICT" | "CANNOT_VERIFY";
export interface AdminUpdateItem {
  id: string;
  source: "UBQ" | "ROOT";
  sourceId: string;
  originalName: string;
  action: Action;
  targetId?: string;
  targetName?: string;
  expectedAliases?: string[];
  status: ReconciliationStatus;
  detail: string;
  lastCheckedAt?: string;
  checkedAgainst?: string;
  actualTargetId?: string;
  actualTargetName?: string;
  returnedAt?: string;
  returnedBy?: string;
  returnDestination?: "HIGH_PRIORITY" | "REVIEW";
}
export interface AdminUpdateRun {
  id: string;
  filename: string;
  exportedAt: string;
  exportedBy: string;
  batchId?: string;
  source: "UBQ" | "ROOT";
  items: AdminUpdateItem[];
}
export interface UserWorkspaceState {
  activeBatchId?: string;
  /** Last safe place this teammate reached in the 1-2-3 workflow. */
  activeView?: "imports" | "review" | "output";
  /** Optional focused rows returned from Step 3 or a reconciliation report. */
  reviewFocusIds?: string[];
  checkpointAt?: string;
  pinnedQueueIds: string[];
  uploads: { id: string; filename: string; at: string; rows: number }[];
  updatedAt: string;
}

export interface TeamPresenceEntry {
  user: string;
  area: "STEP_1" | "STEP_2" | "STEP_3" | "ADMIN";
  lastSeenAt: string;
  deviceId?: string;
}

export interface TeamActivityEntry {
  id: string;
  at: string;
  by: string;
  type: "QUEUE_ADDED" | "ASSIGNED" | "REVIEWED" | "EXPORTED" | "SYNC_PAUSED" | "SYNC_RESUMED" | "STATUS";
  message: string;
  count?: number;
  batchId?: string;
}

export interface HistoricalMappingEntry {
  id: string;
  brand: string;
  normalized: string;
  /** Stable UBQ identity from the shared progress sheet, preferred over name matching. */
  sourceBrandId?: string;
  action: Action;
  originalAction: string;
  date: string;
  reviewer?: string;
  targetBrandId?: string;
  targetBrandName?: string;
  listingCount?: number;
  sellerCount?: number;
  notes?: string;
  ubq?: boolean;
  sourceRow?: number;
  sourceFilename: string;
  importedAt: string;
}

export interface ManualFpaIdReference {
  id: string;
  brand: string;
  normalized: string;
  sourceBrandId: string;
  ubq?: boolean;
  listingCount?: number;
  sellerCount?: number;
  reviewer?: string;
  sourceRow?: number;
  sourceFilename: string;
  importedAt: string;
}

export type PriorityQueueStatus = "UNASSIGNED" | "ASSIGNED" | "IN_REVIEW" | "BLOCKED" | "COMPLETED";
export type PriorityQueueSource = "CSV" | "PASTE" | "UBQ" | "ROOT";
export type PriorityQueueEventType = "CREATED" | "ASSIGNED" | "STATUS" | "READY" | "EXPORTED" | "VERIFIED" | "REOPENED" | "REMOVED";
export interface PriorityQueueEvent {
  id: string;
  type: PriorityQueueEventType;
  at: string;
  by: string;
  message: string;
}
export interface PriorityQueueItem {
  id: string;
  taskKey?: string;
  brandId: string;
  name: string;
  source: PriorityQueueSource;
  listingCount?: number;
  skuCount?: number;
  status: PriorityQueueStatus;
  assignedTo?: string;
  assignedAt?: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
  completedAt?: string;
  finalAction?: Action;
  finalTargetId?: string;
  finalTargetName?: string;
  finalReason?: string;
  exportedAt?: string;
  exportedBy?: string;
  exportFilename?: string;
  externalStatus?: "NOT_STARTED" | "DONE_PENDING_VERIFICATION" | "EXPORTED_PENDING_VERIFICATION" | "VERIFIED";
  verifiedAt?: string;
  verifiedBy?: string;
  resolvedWithoutMappingAt?: string;
  resolvedWithoutMappingBy?: string;
  triageResolution?: "ALREADY_DONE" | "NOT_FOUND_IN_UBQ" | "OTHER";
  triageResolutionNote?: string;
  activity?: PriorityQueueEvent[];
}

export interface CleanupConfirmation {
  id: string;
  source: "ROOT" | "UBQ";
  brandId: string;
  name: string;
  fingerprint: string;
  status: "CONFIRMED" | "REOPENED";
  confirmedAt: string;
  confirmedBy: string;
  reopenedAt?: string;
  reopenedBy?: string;
}

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
  researchChecks?: string[];
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
  suggestedAliases?: string[];
  canonicalTargetChain?: string[];
  blockedByTargetCreation?: boolean;
  priorityQueueId?: string;
  excludedFromExport?: boolean;
  triageResolution?: "ALREADY_DONE" | "NOT_FOUND_IN_UBQ" | "OTHER";
  triageResolutionNote?: string;
  triageResolvedAt?: string;
  triageResolvedBy?: string;
  adminUploadStatus?: "SUCCESS" | "FAILED";
  adminUploadedAt?: string;
  adminUploadedBy?: string;
  adminUploadResultFile?: string;
  adminUploadMessage?: string;
  createdBrandId?: string;
  mergeOverride?: boolean;
}

export interface ImportBatch {
  id: string;
  filename: string;
  createdAt: string;
  rows: number;
  records: BrandRecord[];
  /** Preserves the outcome of every Step 1 submission so rows are never silently omitted. */
  intakeDecisions?: ImportIntakeDecision[];
  workflowSource?: WorkflowSource;
  owner?: string;
  adminCompletedAt?: string;
  adminSuccessCount?: number;
  adminFailureCount?: number;
  adminResultFilename?: string;
  /** Closed personal runs remain available to analytics/history but can never become the active triage again. */
  archivedAt?: string;
  archivedBy?: string;
}

export interface ImportIntakeDecision {
  id: string;
  brand: string;
  outcome: "IMPORTED" | "NOT_IMPORTED";
  reason: string;
  /** Explicit reruns are allowed unless another teammate currently owns the task. */
  reviewAgainAllowed?: boolean;
  action?: Action | "COMPLETED";
  date?: string;
}

export interface LedgerEntry extends BrandRecord {
  ledgerId: string;
  date: string;
}

export interface AppData {
  batches: ImportBatch[];
  ledger: LedgerEntry[];
  historicalMappings: HistoricalMappingEntry[];
  manualFpaIds: ManualFpaIdReference[];
  priorityQueue: PriorityQueueItem[];
  cleanupConfirmations: CleanupConfirmation[];
  learned: Record<string, Pick<BrandRecord, "action" | "targetId" | "targetName" | "reason"> & { reviewedAt: string; origin?: "imported" | "manual"; verification?: "HUMAN" | "ADMIN_VERIFIED"; verifiedAt?: string }>;
  customBrands: CatalogBrand[];
  acaBrands: CatalogBrand[];
  fpaBrands: CatalogBrand[];
  rootBrands: CatalogBrand[];
  rootChanges: Record<string, RootTableChange>;
  adminUpdateRuns: AdminUpdateRun[];
  userWorkspaces: Record<string, UserWorkspaceState>;
  teamPresence: Record<string, TeamPresenceEntry>;
  teamActivity: TeamActivityEntry[];
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
    pause?: { pausedAt: string; pausedBy: string };
  };
}
