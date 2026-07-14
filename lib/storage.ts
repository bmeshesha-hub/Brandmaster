import { AppData, CatalogBrand, SharedWorkspaceSnapshot, ValidationSettings } from "./types";

export const DEFAULT_VALIDATION_SETTINGS: ValidationSettings = {
  previousDecisions: true,
  aliasTable: true,
  acaTable: true,
  fpaTable: true,
  rootBrandTable: true,
  offlineRules: true,
  aiValidator: false,
  officialWebsiteSearch: false,
  marketplaceSearch: false,
  googleSearch: false,
  openAiApiKey: "",
  searchApiKey: "",
};
export const EMPTY_DATA: AppData = { batches: [], ledger: [], learned: {}, customBrands: [], acaBrands: [], fpaBrands: [], rootBrands: [], rootChanges: {}, sourceMeta: {}, validationSettings: DEFAULT_VALIDATION_SETTINGS };
const KEY = "brandmaster-data-v1";

export function loadData(): AppData {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) || "{}");
    if (saved.learned) Object.values(saved.learned as AppData["learned"]).forEach((decision) => { if (!decision.origin && decision.reason?.toLowerCase().includes("imported from validated decision history")) decision.origin = "imported"; });
    return { ...EMPTY_DATA, ...saved, validationSettings: { ...DEFAULT_VALIDATION_SETTINGS, ...(saved.validationSettings || {}), aiValidator: false, officialWebsiteSearch: false, marketplaceSearch: false, googleSearch: false, openAiApiKey: "", searchApiKey: "" } };
  }
  catch { return EMPTY_DATA; }
}

export function saveData(data: AppData) {
  const { acaBrands: _acaBrands, fpaBrands: _fpaBrands, rootBrands: _rootBrands, ...smallData } = data;
  void _acaBrands; void _fpaBrands; void _rootBrands;
  localStorage.setItem(KEY, JSON.stringify(smallData));
}

const DB_NAME = "brandmaster-offline-data";
const STORE = "reference-tables";
export type StoredUbqRow = { id: string; name: string; listingCount?: number; skuCount?: number };
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function loadReferenceTables(): Promise<{ acaBrands: CatalogBrand[]; fpaBrands: CatalogBrand[]; rootBrands: CatalogBrand[] }> {
  const db = await openDb();
  const read = (key: string) => new Promise<CatalogBrand[]>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    request.onsuccess = () => resolve(request.result || []); request.onerror = () => reject(request.error);
  });
  const [acaBrands, fpaBrands, rootBrands] = await Promise.all([read("ACA"), read("FPA"), read("ROOT")]); db.close();
  return { acaBrands, fpaBrands, rootBrands };
}

export async function saveReferenceTable(source: "ACA" | "FPA" | "ROOT", brands: CatalogBrand[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(brands, source);
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  }); db.close();
}

export async function loadUbqReference(): Promise<{ filename: string; rows: StoredUbqRow[] } | null> {
  const db = await openDb();
  const value = await new Promise<{ filename: string; rows: StoredUbqRow[] } | null>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get("UBQ");
    request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
  });
  db.close(); return value;
}

export async function saveUbqReference(filename: string, rows: StoredUbqRow[]) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ filename, rows }, "UBQ");
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  });
  db.close();
}

export async function clearReferenceTables() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).clear();
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  }); db.close();
}

export async function loadGitHubBaseline(): Promise<SharedWorkspaceSnapshot | null> {
  const db = await openDb();
  const value = await new Promise<SharedWorkspaceSnapshot | null>((resolve, reject) => {
    const request = db.transaction(STORE, "readonly").objectStore(STORE).get("GITHUB_BASELINE");
    request.onsuccess = () => resolve(request.result || null); request.onerror = () => reject(request.error);
  });
  db.close(); return value;
}

export async function saveGitHubBaseline(snapshot: SharedWorkspaceSnapshot) {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(snapshot, "GITHUB_BASELINE");
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  }); db.close();
}

export async function clearGitHubBaseline() {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const request = db.transaction(STORE, "readwrite").objectStore(STORE).delete("GITHUB_BASELINE");
    request.onsuccess = () => resolve(); request.onerror = () => reject(request.error);
  }); db.close();
}

export function download(name: string, contents: string, type = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const anchor = document.createElement("a");
  anchor.href = url; anchor.download = name; anchor.click();
  URL.revokeObjectURL(url);
}
