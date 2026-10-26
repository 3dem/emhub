// src/stores/tag_store.ts
import { useMemo, useSyncExternalStore } from "react";
import type { ProtocolTag } from "@/components/tags/tagTypes";

type StoredTagAssignments = Record<string, Record<string, string[]>>;

type TagStateV2 = {
  version: 2;
  updatedAt: number;
  tags: ProtocolTag[];
  assignments: StoredTagAssignments;
};

type TagStoreSnapshot = TagStateV2;

function uniqStrings(values: string[]): string[] {
  // uniqStrings
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values ?? []) {
    const s = String(v ?? "").trim();
    if (!s) continue;
    if (seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function buildTagsById(tags: ProtocolTag[]): Map<string, ProtocolTag> {
  // buildTagsById
  return new Map((tags ?? []).map((t) => [String(t.id), t]));
}

function reconcileAssignments(tags: ProtocolTag[], assignments: StoredTagAssignments): StoredTagAssignments {
  // reconcileAssignments
  const tagsById = buildTagsById(tags);
  const next: StoredTagAssignments = {};

  for (const [projectId, projectMap] of Object.entries(assignments ?? {})) {
    const nextProjectMap: Record<string, string[]> = {};
    for (const [protocolId, ids] of Object.entries(projectMap ?? {})) {
      const filtered = uniqStrings(ids).filter((id) => tagsById.has(String(id)));
      if (filtered.length > 0) nextProjectMap[protocolId] = filtered;
    }
    if (Object.keys(nextProjectMap).length > 0) next[projectId] = nextProjectMap;
  }

  return next;
}

let state: TagStateV2 = {
  version: 2,
  updatedAt: 0,
  tags: [],
  assignments: {},
};

const listeners = new Set<() => void>();

function notifyListeners(): void {
  // notifyListeners
  for (const l of listeners) l();
  if (typeof window !== "undefined") window.dispatchEvent(new Event("scipionTagsChanged"));
}

function setState(updater: (prev: TagStateV2) => TagStateV2): void {
  // setState
  const next = updater(state);
  if (next === state) return; // bailOutWhenNoChanges

  state = next;
  notifyListeners();
}

function getSnapshot(): TagStoreSnapshot {
  // getSnapshot
  return state;
}

function subscribe(listener: () => void): () => void {
  // subscribe
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setTags(nextTags: ProtocolTag[]): void {
  // setTags
  setState((prev) => {
    const tags = Array.isArray(nextTags) ? nextTags : [];

    const prevTagsEmpty = (prev.tags ?? []).length === 0;
    const nextTagsEmpty = tags.length === 0;
    const prevAssignmentsEmpty = Object.keys(prev.assignments ?? {}).length === 0;

    // bailOutWhenClearingAlreadyEmpty
    if (nextTagsEmpty && prevTagsEmpty && prevAssignmentsEmpty) return prev;

    const assignments = reconcileAssignments(tags, prev.assignments);
    return { ...prev, updatedAt: Date.now(), tags, assignments };
  });
}

function deleteTag(tagId: string): void {
  // deleteTag
  const id = String(tagId);
  setState((prev) => {
    const tags = (prev.tags ?? []).filter((t) => String(t.id) !== id);
    const assignments = reconcileAssignments(tags, prev.assignments);
    return { ...prev, updatedAt: Date.now(), tags, assignments };
  });
}

function setAssignedTagIds(
  projectId: string | number | undefined,
  protocolId: string | number | undefined,
  tagIds: string[],
): void {
  // setAssignedTagIds
  const pid = String(projectId ?? "global");
  const prId = String(protocolId ?? "");
  if (!prId) return;

  setState((prev) => {
    const tagsById = buildTagsById(prev.tags);
    const filtered = uniqStrings(tagIds).filter((x) => tagsById.has(String(x)));

    const nextAssignments: StoredTagAssignments = { ...(prev.assignments ?? {}) };
    const nextProjectMap = { ...(nextAssignments[pid] ?? {}) };

    if (filtered.length === 0) {
      delete nextProjectMap[prId];
    } else {
      nextProjectMap[prId] = filtered;
    }

    if (Object.keys(nextProjectMap).length === 0) {
      delete nextAssignments[pid];
    } else {
      nextAssignments[pid] = nextProjectMap;
    }

    return { ...prev, updatedAt: Date.now(), assignments: nextAssignments };
  });
}

function getAssignedTagIds(projectId: string | number | undefined, protocolId: string | number | undefined): string[] {
  // getAssignedTagIds
  const pid = String(projectId ?? "global");
  const prId = String(protocolId ?? "");
  if (!prId) return [];

  const raw = state.assignments?.[pid]?.[prId] ?? [];
  const tagsById = buildTagsById(state.tags);
  return uniqStrings(raw).filter((x) => tagsById.has(String(x)));
}

/**
 * Replace all assignments for a given project.
 * `projectMap` must be: { [protocolId]: [tagId, ...] }
 */
function setProjectAssignments(projectId: string | number | undefined, projectMap: Record<string, string[]>): void {
  // setProjectAssignments
  const pid = String(projectId ?? "");
  if (!pid || pid === "null" || pid === "undefined") return;

  setState((prev) => {
    const tagsById = buildTagsById(prev.tags);

    const nextProjectMap: Record<string, string[]> = {};
    for (const [protocolId, tagIds] of Object.entries(projectMap ?? {})) {
      const prId = String(protocolId ?? "").trim();
      if (!prId) continue;

      const filtered = uniqStrings(tagIds ?? []).filter((x) => tagsById.has(String(x)));
      if (filtered.length > 0) nextProjectMap[prId] = filtered;
    }

    const nextAssignments: StoredTagAssignments = { ...(prev.assignments ?? {}) };

    if (Object.keys(nextProjectMap).length === 0) {
      delete nextAssignments[pid];
    } else {
      nextAssignments[pid] = nextProjectMap;
    }

    // keepAssignmentsInSyncWithTags
    const reconciled = reconcileAssignments(prev.tags, nextAssignments);

    return { ...prev, updatedAt: Date.now(), assignments: reconciled };
  });
}

/**
 * Merge assignments for a given project (partial update).
 * Only protocols present in `projectMap` are updated.
 */
function mergeProjectAssignments(projectId: string | number | undefined, projectMap: Record<string, string[]>): void {
  // mergeProjectAssignments
  const pid = String(projectId ?? "");
  if (!pid || pid === "null" || pid === "undefined") return;

  setState((prev) => {
    const tagsById = buildTagsById(prev.tags);
    const prevAssignments = prev.assignments ?? {};
    const prevProjectMap = { ...(prevAssignments[pid] ?? {}) };

    for (const [protocolId, tagIds] of Object.entries(projectMap ?? {})) {
      const prId = String(protocolId ?? "").trim();
      if (!prId) continue;

      const filtered = uniqStrings(tagIds ?? []).filter((x) => tagsById.has(String(x)));
      if (filtered.length === 0) {
        delete prevProjectMap[prId];
      } else {
        prevProjectMap[prId] = filtered;
      }
    }

    const nextAssignments: StoredTagAssignments = { ...prevAssignments };
    if (Object.keys(prevProjectMap).length === 0) {
      delete nextAssignments[pid];
    } else {
      nextAssignments[pid] = prevProjectMap;
    }

    const reconciled = reconcileAssignments(prev.tags, nextAssignments);

    return { ...prev, updatedAt: Date.now(), assignments: reconciled };
  });
}

function clearProjectAssignments(projectId: string | number | undefined): void {
  // clearProjectAssignments
  const pid = String(projectId ?? "");
  if (!pid || pid === "null" || pid === "undefined") return;

  setState((prev) => {
    const nextAssignments: StoredTagAssignments = { ...(prev.assignments ?? {}) };
    delete nextAssignments[pid];

    const reconciled = reconcileAssignments(prev.tags, nextAssignments);

    return { ...prev, updatedAt: Date.now(), assignments: reconciled };
  });
}

function toggleAssignedTagId(
  projectId: string | number | undefined,
  protocolId: string | number | undefined,
  tagId: string,
): string[] {
  // toggleAssignedTagId
  const current = getAssignedTagIds(projectId, protocolId);
  const tid = String(tagId);
  const has = current.some((x) => String(x) === tid);
  const next = has ? current.filter((x) => String(x) !== tid) : [tid, ...current];
  setAssignedTagIds(projectId, protocolId, next);
  return next;
}

export function useTagStore() {
  // useTagStore
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return useMemo(() => {
    // buildDerivedApiFromSnapshot
    const tagsById = buildTagsById(snap.tags);

    const getAssignedTagIdsFromSnapshot = (
      projectId: string | number | undefined,
      protocolId: string | number | undefined,
    ): string[] => {
      // getAssignedTagIdsFromSnapshot
      const pid = String(projectId ?? "global");
      const prId = String(protocolId ?? "");
      if (!prId) return [];

      const raw = snap.assignments?.[pid]?.[prId] ?? [];
      return uniqStrings(raw).filter((x) => tagsById.has(String(x)));
    };

    return {
      tags: snap.tags,
      assignments: snap.assignments,
      tagsById,

      setTags,
      deleteTag,

      getAssignedTagIds: getAssignedTagIdsFromSnapshot,
      setAssignedTagIds,

      setProjectAssignments,
      mergeProjectAssignments,
      clearProjectAssignments,
      toggleAssignedTagId,
    };
  }, [snap.tags, snap.assignments]);
}
