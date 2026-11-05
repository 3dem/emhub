// Clipboard of copied protocols (Ctrl/Cmd+C on the graph), pasted with
// Ctrl/Cmd+V in the same or another project. It is kept in localStorage so
// it survives opening another project (a new page in EMhub) and is shared
// by the open tabs of the same host (the "storage" event).
// useWorkflowClipboard() re-renders on every change (this tab or others).

import { useSyncExternalStore } from "react";

export type WorkflowClipboardState = {
  sourceProjectId: string | number;
  sourceProjectName?: string;
  protocolIds: string[];
  /** Opaque for emflow: what the host's exportWorkflowProtocols returned. */
  workflow: unknown;
  copiedAt: string;
};

const STORAGE_KEY = "emflow:workflowClipboard";
const VERSION = 1;

// Fallback when localStorage is not available (or the copy is too big)
let memory: WorkflowClipboardState | null = null;

function parse(raw: string | null): WorkflowClipboardState | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.version !== VERSION || !data.clipboard?.workflow) return null;
    const c = data.clipboard;
    return {
      sourceProjectId: c.sourceProjectId,
      sourceProjectName: c.sourceProjectName ?? undefined,
      protocolIds: Array.isArray(c.protocolIds) ? c.protocolIds.map(String) : [],
      workflow: c.workflow,
      copiedAt: String(c.copiedAt ?? ""),
    };
  } catch {
    return null;
  }
}

export function readWorkflowClipboard(): WorkflowClipboardState | null {
  try {
    return parse(window.localStorage.getItem(STORAGE_KEY)) ?? memory;
  } catch {
    return memory;
  }
}

// Snapshot for useSyncExternalStore (stable between changes)
let snapshot: WorkflowClipboardState | null | undefined;
const listeners = new Set<() => void>();

function setSnapshot(next: WorkflowClipboardState | null) {
  snapshot = next;
  listeners.forEach((l) => l());
}

export function writeWorkflowClipboard(next: WorkflowClipboardState | null) {
  setSnapshot(next);
  memory = next;
  try {
    if (next) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: VERSION, clipboard: next }));
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch (e) {
    // Quota or disabled storage: the copy only lives in this page
    console.warn("[emflow] workflow clipboard not persisted", e);
    try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }
}

// Another tab copied (or cleared) protocols
const onStorage = (e: StorageEvent) => {
  if (e.key === STORAGE_KEY || e.key === null) setSnapshot(parse(e.newValue));
};

function subscribe(listener: () => void): () => void {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): WorkflowClipboardState | null {
  if (snapshot === undefined) snapshot = readWorkflowClipboard();
  return snapshot;
}

/** The current clipboard, updated when this or another tab copies. */
export function useWorkflowClipboard(): WorkflowClipboardState | null {
  return useSyncExternalStore(subscribe, getSnapshot, () => null);
}
