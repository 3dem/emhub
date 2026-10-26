import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type LogChannel = {
  id: string;
  label: string;
  order?: number;
};

export type LogOffsets = Record<string, number>;

export type LogChunkItem = {
  channel: string;
  content?: string;
  text?: string; // backward compatibility
  offset?: number;
  resetOffset?: boolean;
  truncated?: boolean;
  exists?: boolean;
  path?: string;
  bytesRead?: number;
  linesRead?: number;
  sizeBytes?: number;
};

export type LogsChunkResponse = {
  chunks?: LogChunkItem[] | Record<string, { text?: string; offset?: number }>;
  done?: boolean;
};

type ProtocolLogsService = {
  fetchProtocolLogChannels: (projectId: string | number, protocolId: string | number) => Promise<any>;
  fetchProtocolLogsChunk: (
    projectId: string | number,
    protocolId: string | number,
    offsets: Record<string, number>
  ) => Promise<LogsChunkResponse>;
};

type UseProtocolLogsParams = {
  svc: ProtocolLogsService;
  enabled: boolean;
  projectId: string | number | null | undefined;
  protocolId: string | number | null | undefined;
  protocolStatus?: string | null;
};

const defaultLogChannels: LogChannel[] = [];
const maxLogCharsPerChannel = 300_000;
const autoScrollThresholdPx = 24;

function isTerminalStatus(status: unknown): boolean {
  return [
    "finished",
    "success",
    "done",
    "failed",
    "error",
    "cancelled",
    "canceled",
    "stopped",
    "aborted",
  ].includes(String(status || "").toLowerCase());
}

function mergeLogChannels(base: LogChannel[], extra: LogChannel[]) {
  const map = new Map<string, LogChannel>();

  for (const ch of base) map.set(ch.id, ch);
  for (const ch of extra) {
    const prev = map.get(ch.id);
    map.set(ch.id, { ...prev, ...ch });
  }

  return Array.from(map.values());
}

function buildLogBuffers(channels: LogChannel[], prev?: Record<string, string>) {
  const next: Record<string, string> = {};
  for (const ch of channels) {
    next[ch.id] = typeof prev?.[ch.id] === "string" ? prev[ch.id] : "";
  }
  return next;
}

function buildOffsets(channels: LogChannel[], prev?: Record<string, number>) {
  const next: Record<string, number> = {};
  for (const ch of channels) {
    const v = prev?.[ch.id];
    next[ch.id] = typeof v === "number" ? v : 0;
  }
  return next;
}

function buildOffsetsPayload(requestChannels: LogChannel[], offsets: Record<string, number>) {
  const payload: Record<string, number> = {};
  for (const ch of requestChannels) {
    payload[ch.id] = typeof offsets[ch.id] === "number" ? offsets[ch.id] : 0;
  }
  return payload;
}

function normalizeLogChannels(raw: any): LogChannel[] {
  if (!raw) return defaultLogChannels;

  if (Array.isArray(raw)) {
    const arr = raw
      .map((x) => ({
        id: String(x?.id ?? x?.key ?? x?.name ?? ""),
        label: String(x?.label ?? x?.title ?? x?.name ?? ""),
        order: typeof x?.order === "number" ? x.order : undefined,
      }))
      .filter((x) => x.id.length > 0)
      .map((x) => ({
        ...x,
        label: x.label.trim().length > 0 ? x.label : x.id,
      }));

    return arr.length > 0 ? arr : defaultLogChannels;
  }

  if (raw && typeof raw === "object") {
    const channelsArr = Array.isArray(raw.channels) ? raw.channels : null;
    if (channelsArr) return normalizeLogChannels(channelsArr);

    const dict = raw.logs && typeof raw.logs === "object" ? raw.logs : raw;
    const entries = Object.entries(dict as Record<string, any>);

    const arr = entries
      .map(([id, meta]) => ({
        id: String(id),
        label: String(meta?.label ?? meta?.name ?? meta?.title ?? id),
        order: typeof meta?.order === "number" ? meta.order : undefined,
      }))
      .filter((x) => x.id.length > 0);

    return arr.length > 0 ? arr : defaultLogChannels;
  }

  return defaultLogChannels;
}

function sortLogChannels(channels: LogChannel[]): LogChannel[] {
  const arr = Array.isArray(channels) ? [...channels] : [];
  arr.sort((a, b) => {
    const ao = typeof a.order === "number" ? a.order : 1_000_000;
    const bo = typeof b.order === "number" ? b.order : 1_000_000;
    if (ao !== bo) return ao - bo;
    return String(a.label || a.id).localeCompare(String(b.label || b.id));
  });
  return arr.length > 0 ? arr : defaultLogChannels;
}

function trimLogBuffer(text: string, maxChars: number): string {
  if (maxChars <= 0) return text;
  if (text.length <= maxChars) return text;

  const start = text.length - maxChars;
  const nl = text.indexOf("\n", start);
  if (nl >= 0 && nl + 1 < text.length) return text.slice(nl + 1);

  return text.slice(start);
}

export function useProtocolLogs({
  svc,
  enabled,
  projectId,
  protocolId,
  protocolStatus,
}: UseProtocolLogsParams) {
  const logsContainerRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef<boolean>(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const idleStreakRef = useRef<number>(0);

  const [logChannels, setLogChannels] = useState<LogChannel[]>(defaultLogChannels);
  const sortedLogChannels = useMemo(() => sortLogChannels(logChannels), [logChannels]);

  const uiChannelsRef = useRef<LogChannel[]>(defaultLogChannels);
  const requestChannelsRef = useRef<LogChannel[]>(defaultLogChannels);

  const [activeLogChannelId, setActiveLogChannelId] = useState<string>("");
  const [logBuffers, setLogBuffers] = useState<Record<string, string>>(() =>
    buildLogBuffers(defaultLogChannels)
  );
  const offsetsRef = useRef<Record<string, number>>(buildOffsets(defaultLogChannels));
  const [logsError, setLogsError] = useState<string | null>(null);

  const updateStickToBottom = useCallback(() => {
    const el = logsContainerRef.current;
    if (!el) return;

    const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    stickToBottomRef.current = distanceToBottom <= autoScrollThresholdPx;
  }, []);

  useEffect(() => {
    if (!sortedLogChannels || sortedLogChannels.length === 0) return;

    setActiveLogChannelId((prev) => {
      if (prev && sortedLogChannels.some((c) => c.id === prev)) return prev;
      return sortedLogChannels[0].id;
    });
  }, [sortedLogChannels]);

  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }

    setLogsError(null);

    if (!enabled || !projectId || !protocolId) return;

    let cancelled = false;
    idleStreakRef.current = 0;

    const ensureChannelState = (channels: LogChannel[]) => {
      setLogBuffers((prev) => {
        const next = { ...prev };
        for (const id of channels.map((c) => c.id)) {
          if (typeof next[id] !== "string") next[id] = "";
        }
        return next;
      });

      for (const id of channels.map((c) => c.id)) {
        if (typeof offsetsRef.current[id] !== "number") offsetsRef.current[id] = 0;
      }
    };

    const appendChunks = (chunksRaw: any): boolean => {
      if (!chunksRaw) return false;

      const items: Array<{ id: string; text: string; nextOffset: number | null; reset: boolean }> = [];

      if (Array.isArray(chunksRaw)) {
        for (const c of chunksRaw) {
          const id = String(c?.channel ?? "");
          if (!id) continue;

          const text =
            typeof c?.content === "string" ? c.content : typeof c?.text === "string" ? c.text : "";

          const nextOffset = typeof c?.offset === "number" ? c.offset : null;
          const reset = Boolean(c?.resetOffset);

          items.push({ id, text, nextOffset, reset });
        }
      } else if (typeof chunksRaw === "object") {
        for (const [idRaw, chunk] of Object.entries(chunksRaw)) {
          const id = String(idRaw ?? "");
          if (!id) continue;

          const text = typeof (chunk as any)?.text === "string" ? (chunk as any).text : "";
          const nextOffset = typeof (chunk as any)?.offset === "number" ? (chunk as any).offset : null;

          items.push({ id, text, nextOffset, reset: false });
        }
      } else {
        return false;
      }

      if (items.length === 0) return false;

      let gotNew = false;
      const patches: Record<string, { reset: boolean; text: string }> = {};

      for (const it of items) {
        const curOffset =
          typeof offsetsRef.current[it.id] === "number" ? offsetsRef.current[it.id] : 0;

        const offsetKnown = typeof it.nextOffset === "number";
        const nextOffset = offsetKnown ? (it.nextOffset as number) : curOffset;
        const mustReset = it.reset || (offsetKnown && nextOffset < curOffset);

        if (mustReset) {
          offsetsRef.current[it.id] = offsetKnown ? nextOffset : 0;
          patches[it.id] = { reset: true, text: it.text };
          if (it.text.length > 0) gotNew = true;
          continue;
        }

        if (offsetKnown && nextOffset > curOffset) {
          offsetsRef.current[it.id] = nextOffset;

          if (it.text.length > 0) {
            patches[it.id] = { reset: false, text: it.text };
            gotNew = true;
          }
        }
      }

      if (gotNew) {
        setLogBuffers((prev) => {
          const next = { ...prev };
          for (const [id, p] of Object.entries(patches)) {
            const base = p.reset ? "" : String(next[id] ?? "");
            next[id] = trimLogBuffer(base + p.text, maxLogCharsPerChannel);
          }
          return next;
        });
      }

      return gotNew;
    };

    void (async () => {
      try {
        const rawChannels: any = await svc.fetchProtocolLogChannels(projectId, protocolId);
        if (cancelled) return;

        const serverChannels = sortLogChannels(normalizeLogChannels(rawChannels));
        const uiChannels = sortLogChannels(mergeLogChannels(defaultLogChannels, serverChannels));
        const requestChannels = serverChannels.length > 0 ? serverChannels : defaultLogChannels;

        uiChannelsRef.current = uiChannels;
        requestChannelsRef.current = requestChannels;

        setLogChannels(uiChannels);
        setLogBuffers((prev) => buildLogBuffers(uiChannels, prev));
        offsetsRef.current = buildOffsets(uiChannels, offsetsRef.current);

        const offsetsPayload = buildOffsetsPayload(requestChannelsRef.current, offsetsRef.current);
        const rawChunk: LogsChunkResponse = await svc.fetchProtocolLogsChunk(
          projectId,
          protocolId,
          offsetsPayload
        );
        if (cancelled) return;

        ensureChannelState(uiChannels);
        appendChunks(rawChunk?.chunks);
      } catch (err: any) {
        if (!cancelled) {
          setLogsError(err?.message || "Failed to load logs");
        }
      }
    })();

    pollRef.current = setInterval(async () => {
      try {
        const offsetsPayload = buildOffsetsPayload(requestChannelsRef.current, offsetsRef.current);
        const rawChunk: LogsChunkResponse = await svc.fetchProtocolLogsChunk(
          projectId,
          protocolId,
          offsetsPayload
        );
        if (cancelled) return;

        const gotNew = appendChunks(rawChunk?.chunks);

        if (isTerminalStatus(protocolStatus)) {
          idleStreakRef.current = gotNew ? 0 : idleStreakRef.current + 1;
          if (idleStreakRef.current >= 2 && pollRef.current) {
            clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } else if (gotNew) {
          idleStreakRef.current = 0;
        }
      } catch (err: any) {
        if (!cancelled) {
          setLogsError(err?.message || "Failed to poll logs");
        }
      }
    }, 2000);

    return () => {
      cancelled = true;
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [enabled, projectId, protocolId, protocolStatus, svc]);

  const activeLogText = logBuffers[activeLogChannelId] ?? "";

  useEffect(() => {
    requestAnimationFrame(() => {
      updateStickToBottom();

      if (!stickToBottomRef.current) return;
      const el = logsContainerRef.current;
      if (!el) return;
      el.scrollTop = el.scrollHeight;
    });
  }, [activeLogChannelId, updateStickToBottom]);

  useEffect(() => {
    if (!stickToBottomRef.current) return;

    const el = logsContainerRef.current;
    if (!el) return;

    requestAnimationFrame(() => {
      const el2 = logsContainerRef.current;
      if (!el2) return;
      el2.scrollTop = el2.scrollHeight;
    });
  }, [activeLogText]);

  return {
    sortedLogChannels,
    activeLogChannelId,
    setActiveLogChannelId,
    activeLogText,
    logsError,
    logsContainerRef,
    updateStickToBottom,
  };
}

export default LogChannel