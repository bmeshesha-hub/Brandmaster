import { AppData } from "./types";

export interface LocalProfile {
  username: string;
  deviceId: string;
  createdAt: string;
  verifiedLogin?: string;
}

export const LOCAL_PROFILE_KEY = "brandmaster-local-profile";

export function normalizeLocalUsername(value: string) {
  return value.trim().replace(/^@+/, "");
}

export function validLocalUsername(value: string) {
  return /^[a-zA-Z0-9._-]{2,40}$/.test(normalizeLocalUsername(value));
}

export function localProfileIdentity(profile: LocalProfile) {
  return profile.verifiedLogin || `${profile.username} · ${profile.deviceId}`;
}

export function createDeviceId() {
  const bytes = new Uint8Array(3);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("").toUpperCase();
}

export function migrateAppIdentity(data: AppData, from: string[], to: string): AppData {
  const previous = new Set(from.filter(Boolean));
  const replace = (value?: string) => value && previous.has(value) ? to : value;
  return {
    ...data,
    batches: data.batches.map((batch) => ({ ...batch, records: batch.records.map((record) => ({ ...record, reviewer: replace(record.reviewer) })) })),
    ledger: data.ledger.map((entry) => ({ ...entry, reviewer: replace(entry.reviewer) })),
    priorityQueue: data.priorityQueue.map((item) => ({ ...item, assignedTo: replace(item.assignedTo), createdBy: replace(item.createdBy) || item.createdBy })),
    cleanupConfirmations: data.cleanupConfirmations.map((item) => ({ ...item, confirmedBy: replace(item.confirmedBy) || item.confirmedBy, reopenedBy: replace(item.reopenedBy) })),
    rootChanges: Object.fromEntries(Object.entries(data.rootChanges).map(([id, change]) => [id, { ...change, adminUpdatedBy: replace(change.adminUpdatedBy) }])),
  };
}
