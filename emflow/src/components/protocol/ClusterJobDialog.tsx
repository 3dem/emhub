// src/components/protocol/ClusterJobDialog.tsx
// Where a protocol runs, opened by clicking its cluster job id or local pid
// pill. Launched/running cluster jobs show the output of the queue 'inspect'
// command (e.g. lsf_inspect_job.py --json), running local jobs their process
// tree (if EMhub runs in the same host), other jobs the info recorded in the
// job files (no query to the queueing system). Profiled runs add a
// "Resource usage" tab (JobResourceUsage).
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from "@mui/material";
import { Maximize, Minimize } from "lucide-react";

import type { ClusterJobInspection, JobProfileRun, LocalProcessInfo } from "@/services/ProjectService";
import JobResourceUsage, { latestSampleText } from "./JobResourceUsage";

type ClusterJobDialogProps = {
  open: boolean;
  protocolId: string | null;
  onClose: () => void;
  inspect?: (protocolId: string) => Promise<ClusterJobInspection>;
};

const VERDICT_COLORS: Record<string, string> = {
  NEVER: "#c62828",
  BLOCKED: "#8e24aa",
  WAITING: "#ef6c00",
  READY: "#2e7d32",
  NOT_PENDING: "#00838f",
};

const CHECK_COLORS: Record<string, string> = {
  pass: "#2e7d32",
  fail: "#c62828",
  warn: "#ef6c00",
  info: "#1565c0",
  skip: "#9e9e9e",
};

const HOST_STATE_ORDER: Record<string, number> = { free: 0, busy: 1, down: 2, never: 3 };

function fmtMb(mb?: number | null): string {
  if (mb == null) return "-";
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`;
}

function fmtSeconds(seconds?: number | null): string {
  if (seconds == null) return "-";
  const s = Math.round(seconds);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

function Field({ label, value }: { label: string; value?: any }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <Box sx={{ display: "flex", gap: 1, minWidth: 0 }}>
      <Typography variant="body2" sx={{ color: "text.secondary", minWidth: 110, flexShrink: 0 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ fontFamily: "ui-monospace, Menlo, monospace", wordBreak: "break-all" }}>
        {String(value)}
      </Typography>
    </Box>
  );
}

function FieldsGrid({ children }: { children: ReactNode }) {
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, columnGap: 3, rowGap: 0.5 }}>
      {children}
    </Box>
  );
}

/** Analysis from lsf_inspect_job.py --json */
function LsfInspection({ data }: { data: any }) {
  const [showHosts, setShowHosts] = useState(false);
  const job = data.job || {};
  const req = data.request || {};
  const verdict = data.verdict || {};
  const checks: any[] = (data.checks || []).filter((c: any) => c.status !== "skip");
  const hosts: any[] = [...(data.hosts || [])].sort(
    (a, b) => (HOST_STATE_ORDER[a.state] ?? 9) - (HOST_STATE_ORDER[b.state] ?? 9) || String(a.host).localeCompare(String(b.host)),
  );
  const jobReasons: any[] = (data.reasons || []).filter((r: any) => r.section === "job");
  const gpu = req.gpu;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
        <Chip
          label={verdict.code || "?"}
          size="small"
          sx={{ bgcolor: VERDICT_COLORS[verdict.code] || "#616161", color: "#fff", fontWeight: 700 }}
        />
        <Typography variant="body2" sx={{ fontWeight: 600 }}>{verdict.summary}</Typography>
      </Box>
      {(verdict.details?.length > 0 || verdict.suggestions?.length > 0) && (
        <Box component="ul" sx={{ m: 0, pl: 3 }}>
          {(verdict.details || []).map((d: string, i: number) => (
            <li key={`d${i}`}><Typography variant="body2">{d}</Typography></li>
          ))}
          {(verdict.suggestions || []).map((s: string, i: number) => (
            <li key={`s${i}`}><Typography variant="body2" sx={{ color: "primary.main" }}>{s}</Typography></li>
          ))}
        </Box>
      )}

      <FieldsGrid>
        <Field label="Status" value={job.status} />
        <Field label="Queue" value={job.queue} />
        <Field label="User" value={job.user} />
        <Field label="Pending" value={job.pending_seconds && ["PEND", "PSUSP"].includes(job.status) ? fmtSeconds(job.pending_seconds) : undefined} />
        <Field label="Submitted" value={job.submit_time} />
        <Field label="Started" value={job.start_time} />
        <Field label="Exec host" value={job.exec_host} />
        <Field label="Run time" value={job.run_time} />
        <Field label="Memory used" value={job.max_mem || job.avg_mem ? `max ${job.max_mem || "-"}, avg ${job.avg_mem || "-"}` : undefined} />
        <Field label="Slots" value={req.slots != null ? `${req.slots} (${req.layout})` : undefined} />
        <Field label="Mem / slot" value={req.mem_per_slot_mb ? fmtMb(req.mem_per_slot_mb) : undefined} />
        <Field
          label="GPUs"
          value={gpu ? `${gpu.num} per ${gpu.per}${gpu.gmodel ? `, ${gpu.gmodel}` : ""}${gpu.mig ? `, MIG ${gpu.mig}` : ""}${gpu.exclusive ? ", exclusive" : ""}` : undefined}
        />
        <Field label="Select" value={req.select} />
        <Field label="Hosts (-m)" value={req.specified_hosts?.join(" ")} />
        <Field label="Queue hosts" value={data.queue ? `${data.queue.hosts} (${data.queue.status})` : undefined} />
      </FieldsGrid>

      {jobReasons.length > 0 && (
        <Box>
          <Typography variant="subtitle2">Pending reasons</Typography>
          {jobReasons.map((r, i) => (
            <Typography key={i} variant="body2" sx={{ fontFamily: "ui-monospace, Menlo, monospace" }}>
              {r.reason}{r.hosts ? ` (${r.hosts} hosts)` : ""}
            </Typography>
          ))}
        </Box>
      )}

      {checks.length > 0 && (
        <Box>
          <Typography variant="subtitle2">Checks</Typography>
          {checks.map((c) => (
            <Box key={c.check} sx={{ display: "flex", gap: 1, alignItems: "baseline" }}>
              <Typography variant="caption" sx={{ color: CHECK_COLORS[c.status] || "text.secondary", fontWeight: 700, minWidth: 40, textTransform: "uppercase" }}>
                {c.status}
              </Typography>
              <Typography variant="body2" sx={{ minWidth: 150 }}>{c.label}</Typography>
              <Typography variant="body2" sx={{ color: "text.secondary" }}>{c.detail}</Typography>
            </Box>
          ))}
        </Box>
      )}

      {(data.notes || []).map((n: string, i: number) => (
        <Alert key={i} severity="info" sx={{ py: 0 }}>{n}</Alert>
      ))}

      {hosts.length > 0 && (
        <Box>
          <Button size="small" onClick={() => setShowHosts((v) => !v)}>
            {showHosts ? "Hide" : "Show"} queue hosts ({hosts.length})
          </Button>
          <Collapse in={showHosts} unmountOnExit>
            <Box sx={{ maxHeight: 320, overflow: "auto" }}>
              <Table size="small" stickyHeader>
                <TableHead>
                  <TableRow>
                    {["Host", "State", "Status", "Slots", "Memory", "GPUs", "Free", "Why not"].map((h) => (
                      <TableCell key={h}>{h}</TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {hosts.map((h) => (
                    <TableRow key={h.host}>
                      <TableCell sx={{ fontFamily: "monospace" }}>{h.host}</TableCell>
                      <TableCell>{h.state}</TableCell>
                      <TableCell>{h.status}</TableCell>
                      <TableCell>{h.max_slots ?? "-"}</TableCell>
                      <TableCell>{fmtMb(h.maxmem_mb)}</TableCell>
                      <TableCell>{h.gpus ? `${h.eligible_gpus}/${h.gpus}` : "-"}</TableCell>
                      <TableCell>
                        {h.state === "never" ? "-" : `${h.free_slots ?? "-"} slots, ${fmtMb(h.free_mem_mb)}, ${h.free_gpus ?? "-"} GPUs`}
                      </TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>
                        {[...(h.fails || []), ...(h.busy || [])].join("; ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );
}

/** Info recorded in the job files (no query to the queueing system) */
function LocalProcess({ process }: { process: LocalProcessInfo }) {
  const children = process.children || [];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <FieldsGrid>
        <Field label="Process" value={`${process.pid}${process.status ? ` (${process.status})` : ""}`} />
        <Field label="Uptime" value={process.uptime != null ? fmtSeconds(process.uptime) : undefined} />
        <Field label="CPU now" value={process.cpu != null ? `${(process.cpu / 100).toFixed(1)} cores` : undefined} />
        <Field label="Memory (RSS)" value={process.rss_gb != null ? `${process.rss_gb.toFixed(2)} GiB` : undefined} />
        <Field label="Processes" value={process.procs} />
        <Field label="Threads" value={process.threads} />
      </FieldsGrid>
      {children.length > 0 && (
        <Table size="small">
          <TableHead>
            <TableRow>
              {["PID", "Name", "Status", "CPU %", "RSS", "Threads"].map((h) => (
                <TableCell key={h}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {children.map((c) => (
              <TableRow key={c.pid} title={c.cmdline || undefined}>
                <TableCell>{c.pid}</TableCell>
                <TableCell sx={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</TableCell>
                <TableCell>{c.status || "-"}</TableCell>
                <TableCell>{c.cpu != null ? c.cpu.toFixed(1) : "-"}</TableCell>
                <TableCell>{fmtMb(c.rss_mb)}</TableCell>
                <TableCell>{c.threads ?? "-"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        Process tree of the job right now (CPU over half a second); the busiest
        {children.length >= 10 ? " 10" : ""} child processes, hover a row for its command.
      </Typography>
    </Box>
  );
}

function ScheduleInfo({ data }: { data: any }) {
  const process: LocalProcessInfo | null = data?.process || null;
  const log: string[] = data?.log || [];
  const logRef = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    // Show the end of the log: the last dependency check
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {process && (
        <FieldsGrid>
          <Field label="Watcher" value={`${process.pid}${process.status ? ` (${process.status})` : ""}`} />
          <Field label="Uptime" value={process.uptime != null ? fmtSeconds(process.uptime) : undefined} />
        </FieldsGrid>
      )}
      <Typography variant="subtitle2">Schedule log</Typography>
      <Box
        component="pre"
        ref={logRef}
        sx={{ m: 0, p: 1.5, bgcolor: "action.hover", borderRadius: 1, fontSize: "0.78rem", maxHeight: "var(--cjd-pre-max, 340px)", overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-all" }}
      >
        {log.length ? log.join("\n") : "(no schedule log)"}
      </Box>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        The job is waiting for its inputs: the schedule watcher checks its parent
        jobs periodically and launches it once they have finished (job.log since
        the job was scheduled).
      </Typography>
    </Box>
  );
}

function RecordedInfo({ data }: { data: any }) {
  const s = data.summary || {};
  const r = data.report || {};
  const runs: any[] = data.runs || [];
  const sources: Record<string, string> = {
    run: "the computing info recorded by the run (info.json)",
    report: "the cluster report at the end of run.out",
    params: "the job params / submission script (requested resources)",
  };
  // Recorded by the run in GiB (a number), the cluster reports have units
  const nodeMemory = typeof s.node_memory === "number" ? `${s.node_memory} GiB` : s.node_memory || "-";
  const isLocal = !s.cluster && !!s.pid;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      <FieldsGrid>
        <Field label="Cluster" value={s.cluster} />
        <Field label="Queue" value={s.queue || r.queue} />
        <Field label="Host(s)" value={s.host || r.hosts} />
        {s.pid && <Field label="PID" value={s.pid} />}
        <Field label="CPUs" value={s.cpus != null ? `${s.cpus}${s.requested ? " (requested)" : ""}` : undefined} />
        <Field label="GPUs" value={s.gpus != null ? `${s.gpus}${s.gpu_type ? ` ${s.gpu_type}` : ""}` : undefined} />
        <Field label="Max memory" value={s.memory_max || r.max_mem} />
        <Field label="Avg memory" value={s.memory_avg || r.avg_mem} />
        <Field label="Node" value={s.node_cpus ? `${s.node_cpus} CPUs, ${nodeMemory}, ${s.node_gpus || 0} GPUs` : undefined} />
        <Field label="Elapsed" value={s.elapsed ? fmtSeconds(s.elapsed) : undefined} />
        <Field label="Runs" value={s.runs} />
      </FieldsGrid>
      {runs.length > 0 && (
        <Box sx={{ maxHeight: 200, overflow: "auto" }}>
          <Table size="small" stickyHeader>
            <TableHead>
              <TableRow>
                {["Run", "Launched", "Start", "End", "Elapsed", "Status"].map((h) => (
                  <TableCell key={h}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run, i) => (
                <TableRow key={i}>
                  <TableCell>{i + 1}</TableCell>
                  <TableCell>{run.launched || "-"}</TableCell>
                  <TableCell>{run.start || "-"}</TableCell>
                  <TableCell>{run.end || "-"}</TableCell>
                  <TableCell>{run.elapsed != null ? fmtSeconds(run.elapsed) : "-"}</TableCell>
                  <TableCell>{run.status || "-"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        Recorded information, taken from {sources[s.source] || "the job files"}.
        {isLocal ? "" : " The queueing system is not queried."}
      </Typography>
    </Box>
  );
}

export default function ClusterJobDialog({ open, protocolId, onClose, inspect }: ClusterJobDialogProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ClusterJobInspection | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const [tab, setTab] = useState(0);
  // Expanded to the whole browser window (as in VolumeViewer)
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!open || !protocolId) return;
    if (!inspect) {
      setError("Cluster job inspection is not available.");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    inspect(protocolId)
      .then((res) => { if (!cancelled) setResult(res); })
      .catch((e) => { if (!cancelled) setError(e?.message || String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, protocolId, inspect, reloadTick]);

  useEffect(() => {
    if (!open) {
      setResult(null);
      setError(null);
      setTab(0);
      setFull(false);
    }
  }, [open]);

  const data = result?.data;
  const jsonError = result?.format === "json" ? data?.error : null;
  const isLocal = !result?.cluster_job_id && !!result?.local_pid;
  const isScheduled = !!result?.scheduled;
  const where = result?.cluster_job_id
    ? ` · cluster job ${result.cluster_job_id}`
    : isLocal
      ? ` · ${isScheduled ? "schedule watcher" : "pid"} ${result!.local_pid}${result!.local_host ? ` on ${result!.local_host}` : ""}`
      : "";
  const title = `Job ${protocolId ?? ""}${where}`;
  const profiles: JobProfileRun[] = result?.profiles || [];
  const lastProfile = profiles[profiles.length - 1];
  const recording = !!lastProfile?.latest;
  const process: LocalProcessInfo | null = data?.process || null;
  const showUsage = tab === 1 && profiles.length > 0;

  return (
    <Dialog
      open={open}
      // Esc first goes back from the expanded size
      onClose={(_e, reason) => (reason === "escapeKeyDown" && full ? setFull(false) : onClose())}
      maxWidth="md"
      fullWidth
      fullScreen={full}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1.5, py: 1.5 }}>
        <Box component="span" sx={{ flex: 1, fontWeight: 700 }}>{title}</Box>
        {result && (
          <Chip
            size="small"
            variant="outlined"
            label={result.mode === "live"
              ? `live · ${isScheduled ? "scheduler" : isLocal ? "local" : result.queue || "queue"}`
              : "recorded"}
            title={result.command || undefined}
          />
        )}
        {result?.status && <Chip size="small" label={result.status} />}
        <IconButton size="small" onClick={() => setFull((v) => !v)}
                    aria-label={full ? "Back to normal size" : "Expand to the browser window"}
                    title={full ? "Back to normal size (Esc)" : "Expand to the browser window"}
                    sx={{ color: "text.secondary", "&:hover": { color: "primary.main" } }}>
          {full ? <Minimize size={16} /> : <Maximize size={16} />}
        </IconButton>
      </DialogTitle>
      <DialogContent
        dividers
        sx={full ? { display: "flex", flexDirection: "column", "--cjd-pre-max": "calc(100vh - 300px)" } : undefined}
      >
        {loading && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, py: 3, justifyContent: "center" }}>
            <CircularProgress size={24} />
            <Typography variant="body2">
              Inspecting the job…
            </Typography>
          </Box>
        )}
        {!loading && error && <Alert severity="error">{error}</Alert>}
        {!loading && !error && result && profiles.length > 0 && (
          <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ minHeight: 36, mt: -1, mb: 1 }}>
            <Tab label="Overview" sx={{ minHeight: 36, py: 0 }} />
            <Tab label={recording ? "Resource usage · recording" : "Resource usage"} sx={{ minHeight: 36, py: 0 }} />
          </Tabs>
        )}
        {!loading && !error && result && showUsage && <JobResourceUsage profiles={profiles} fill={full} />}
        {!loading && !error && result && !showUsage && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {result.note && <Alert severity="info" sx={{ py: 0 }}>{result.note}</Alert>}
            {process && !isScheduled && <LocalProcess process={process} />}
            {!process && recording && (
              <Alert severity="info" icon={false} sx={{ py: 0 }}>
                Latest sample, {lastProfile.latest!.age ?? "?"} s ago: {latestSampleText(lastProfile.latest!, lastProfile.gpus)}
              </Alert>
            )}
            {jsonError && <Alert severity="error">{jsonError}</Alert>}
            {result.format === "json" && !jsonError && data && <LsfInspection data={data} />}
            {result.format === "text" && (
              <Box
                component="pre"
                sx={{ m: 0, p: 1.5, bgcolor: "action.hover", borderRadius: 1, fontSize: "0.8rem", maxHeight: "var(--cjd-pre-max, 420px)", overflow: "auto", whiteSpace: "pre-wrap" }}
              >
                {result.text || "(no output)"}
              </Box>
            )}
            {result.format === "summary" && data && <RecordedInfo data={data} />}
            {result.format === "schedule" && <ScheduleInfo data={data} />}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        {(result?.mode === "live" || recording || isScheduled) && (
          <Button onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>Refresh</Button>
        )}
        <Button onClick={onClose} variant="contained">Close</Button>
      </DialogActions>
    </Dialog>
  );
}
