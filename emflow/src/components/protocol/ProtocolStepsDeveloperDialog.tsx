import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, GitBranch, RefreshCw, RotateCcw } from "lucide-react";
import ReactFlow, {
    Background,
    Controls,
    Handle,
    Position,
    ReactFlowProvider,
    applyNodeChanges,
    type Edge,
    type Node,
    type NodeChange,
    type NodeMouseHandler,
    type NodeProps,
} from "reactflow";
import "reactflow/dist/style.css";

import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog/dialog";
import { Button } from "@/components/ui/button";
import { useProjectService } from "@/ProjectServiceContext";
import type { Id, ProtocolStep, ProtocolStepStatus } from "@/services/ProjectService";

type Props = {
    open: boolean;
    projectId?: Id;
    protocolId?: Id;
    protocolLabel?: string;
    container?: HTMLElement | null;
    onOpenChange: (open: boolean) => void;
};

type StepGraphData = {
    label: string;
    tooltip: string;
    kind: "root" | "step";
    step?: ProtocolStep;
};

function StepGraphNode({ data }: NodeProps) {
    const nodeData = data as StepGraphData;
    const isRoot = nodeData.kind === "root";

    return (
        <div
            title={nodeData.tooltip}
            className={[
                "relative flex items-center justify-center border text-slate-900 shadow-sm",
                isRoot
                    ? "h-[34px] min-w-[112px] border-sky-300 bg-[#a5e5f2] px-3 text-[13px] font-semibold"
                    : "h-[34px] min-w-[38px] border-sky-300 bg-[#a5e5f2] px-2 text-[13px] font-semibold",
            ].join(" ")}
        >
            <Handle
                id="top"
                type="target"
                position={Position.Top}
                isConnectable={false}
                style={{
                    top: -1,
                    width: 1,
                    height: 1,
                    minWidth: 1,
                    minHeight: 1,
                    border: "none",
                    background: "transparent",
                    opacity: 0,
                    pointerEvents: "none",
                }}
            />

            {nodeData.label}

            <Handle
                id="bottom"
                type="source"
                position={Position.Bottom}
                isConnectable={false}
                style={{
                    bottom: -1,
                    width: 1,
                    height: 1,
                    minWidth: 1,
                    minHeight: 1,
                    border: "none",
                    background: "transparent",
                    opacity: 0,
                    pointerEvents: "none",
                }}
            />
        </div>
    );
}

function formatElapsed(value: unknown): string {
    const total = Number(value ?? 0);
    if (!Number.isFinite(total) || total <= 0) return "0:00:00";

    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = Math.floor(total % 60);

    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const STEP_REFRESH_INTERVAL_MS = 5000;

function getDisplayedStepElapsedSeconds(step: ProtocolStep, nowMs: number, snapshotAtMs: number): number {
    const rawElapsed = Number(step.elapsedSeconds ?? 0);
    const storedElapsed = Number.isFinite(rawElapsed) && rawElapsed >= 0 ? rawElapsed : 0;
    const status = String(step.status ?? "").trim().toLowerCase();

    if (status !== "running") return storedElapsed;

    const localDeltaSeconds = Math.max(0, (nowMs - snapshotAtMs) / 1000);
    return storedElapsed + localDeltaSeconds;
}

function formatValue(value: unknown): string {
    if (value == null || value === "") return "";
    if (typeof value === "string") return value;

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function getStepClass(step: ProtocolStep): string {
    return String((step as any).className ?? (step as any).class ?? "FunctionStep");
}

function getStatusClass(status: string): string {
    const normalized = String(status ?? "").toLowerCase();

    if (normalized === "finished") return "bg-emerald-100 text-emerald-800 ring-emerald-200";
    if (normalized === "running") return "bg-sky-100 text-sky-800 ring-sky-200";
    if (normalized === "failed") return "bg-red-100 text-red-800 ring-red-200";
    if (normalized === "aborted") return "bg-orange-100 text-orange-800 ring-orange-200";

    return "bg-slate-100 text-slate-700 ring-slate-200";
}

function normalizePrerequisites(value: unknown): number[] {
    if (Array.isArray(value)) {
        return value
            .map((item) => Number(item))
            .filter((item) => Number.isFinite(item));
    }

    if (typeof value === "string") {
        const trimmed = value.trim();
        if (!trimmed) return [];

        try {
            const parsed = JSON.parse(trimmed);
            return normalizePrerequisites(parsed);
        } catch {
            return trimmed
                .split(/[,\s]+/)
                .map((item) => Number(item))
                .filter((item) => Number.isFinite(item));
        }
    }

    return [];
}

function getStepNodeId(index: number): string {
    return `step-${index}`;
}

function buildStepGraph(steps: ProtocolStep[]): { nodes: Node<StepGraphData>[]; edges: Edge[] } {
    const rootId = "protocol-root";
    const stepByIndex = new Map<number, ProtocolStep>();

    for (const step of steps) {
        const index = Number(step.index);
        if (Number.isFinite(index)) {
            stepByIndex.set(index, step);
        }
    }

    const getLevel = (step: ProtocolStep, visiting = new Set<number>()): number => {
        const index = Number(step.index);
        if (!Number.isFinite(index)) return 1;
        if (visiting.has(index)) return 1;

        visiting.add(index);

        const prerequisites = normalizePrerequisites(step.prerequisites).filter((prereq) =>
            stepByIndex.has(prereq),
        );

        if (prerequisites.length === 0) return 1;

        const maxParentLevel = Math.max(
            ...prerequisites.map((prereq) => getLevel(stepByIndex.get(prereq)!, new Set(visiting))),
        );

        return maxParentLevel + 1;
    };

    const levels = new Map<number, ProtocolStep[]>();

    for (const step of steps) {
        const level = getLevel(step);
        const current = levels.get(level) ?? [];
        current.push(step);
        levels.set(level, current);
    }

    for (const levelSteps of levels.values()) {
        levelSteps.sort((a, b) => Number(a.index) - Number(b.index));
    }

    const nodes: Node<StepGraphData>[] = [
        {
            id: rootId,
            type: "stepGraph",
            position: { x: 0, y: 0 },
            data: {
                label: "PROTOCOL",
                tooltip: "Protocol",
                kind: "root",
            },
            draggable: true,
            selectable: true,
        },
    ];

    const edges: Edge[] = [];
    const xSpacing = 150;
    const ySpacing = 96;

    const sortedLevelEntries = Array.from(levels.entries()).sort(([a], [b]) => a - b);

    for (const [level, levelSteps] of sortedLevelEntries) {
        const count = levelSteps.length;

        levelSteps.forEach((step, idx) => {
            const stepIndex = Number(step.index);
            const x = (idx - (count - 1) / 2) * xSpacing;
            const y = level * ySpacing;
            const stepTooltip = `${step.index} - ${step.name}`;

            nodes.push({
                id: getStepNodeId(stepIndex),
                type: "stepGraph",
                position: { x, y },
                data: {
                    label: String(step.index),
                    tooltip: stepTooltip,
                    kind: "step",
                    step,
                },
                draggable: true,
                selectable: true,
            });

            const prerequisites = normalizePrerequisites(step.prerequisites).filter((prereq) =>
                stepByIndex.has(prereq),
            );

            const parents = prerequisites.length > 0 ? prerequisites : [null];

            for (const parent of parents) {
                const source = parent == null ? rootId : getStepNodeId(parent);

                edges.push({
                    id: `${source}-${getStepNodeId(stepIndex)}`,
                    source,
                    target: getStepNodeId(stepIndex),
                    sourceHandle: "bottom",
                    targetHandle: "top",
                    type: "bezier",
                    animated: false,
                    style: {
                        stroke: "#9ca3af",
                        strokeWidth: 1.2,
                        strokeLinecap: "round",
                    },
                });
            }
        });
    }

    return { nodes, edges };
}

export default function ProtocolStepsDeveloperDialog({
    open,
    projectId,
    protocolId,
    protocolLabel,
    container,
    onOpenChange,
}: Props) {
    const svc = useProjectService();

    const [steps, setSteps] = useState<ProtocolStep[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [treeOpen, setTreeOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [statusUpdating, setStatusUpdating] = useState<ProtocolStepStatus | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [stepsSnapshotAtMs, setStepsSnapshotAtMs] = useState(() => Date.now());
    const [clockNowMs, setClockNowMs] = useState(() => Date.now());

    const selectedStep = steps[selectedIndex] ?? null;
    const selectedStepIndexRef = useRef<number | null>(null);

    useEffect(() => {
        const stepIndex = Number(selectedStep?.index);
        selectedStepIndexRef.current = Number.isFinite(stepIndex) ? stepIndex : null;
    }, [selectedStep]);

    const graph = useMemo(() => buildStepGraph(steps), [steps]);

    const nodeTypes = useMemo(() => ({ stepGraph: StepGraphNode }), []);

    const [treeNodes, setTreeNodes] = useState<Node<StepGraphData>[]>([]);
    const [treeEdges, setTreeEdges] = useState<Edge[]>([]);

    useEffect(() => {
        if (!treeOpen) return;

        setTreeNodes(graph.nodes);
        setTreeEdges(graph.edges);
    }, [treeOpen, graph]);

    const handleTreeNodesChange = useCallback((changes: NodeChange[]) => {
        setTreeNodes((current) => applyNodeChanges(changes, current) as Node<StepGraphData>[]);
    }, []);

    const loadSteps = useCallback(async (silent = false) => {
        if (!projectId || !protocolId) return;

        if (!silent) {
            setLoading(true);
            setError(null);
        }

        try {
            const items = await svc.fetchProtocolSteps(projectId, protocolId);
            const nextSteps = Array.isArray(items) ? items : [];
            const selectedStepIndex = selectedStepIndexRef.current;
            const snapshotAtMs = Date.now();

            setSteps(nextSteps);
            setStepsSnapshotAtMs(snapshotAtMs);
            setClockNowMs(snapshotAtMs);
            setError(null);

            setSelectedIndex((currentIndex) => {
                if (selectedStepIndex !== null) {
                    const matchingIndex = nextSteps.findIndex((step) => Number(step.index) === selectedStepIndex);
                    if (matchingIndex >= 0) return matchingIndex;
                }

                if (nextSteps.length === 0) return 0;
                return Math.min(currentIndex, nextSteps.length - 1);
            });
        } catch (err: any) {
            if (silent) {
                console.warn("Failed to refresh protocol steps.", err);
                return;
            }

            setSteps([]);
            setSelectedIndex(0);
            setError(err?.message || "Failed to load protocol steps.");
        } finally {
            if (!silent) setLoading(false);
        }
    }, [svc, projectId, protocolId]);

    const updateSelectedStepStatus = useCallback(
        async (nextStatus: ProtocolStepStatus) => {
            if (!projectId || !protocolId || !selectedStep) return;

            setStatusUpdating(nextStatus);
            setError(null);

            try {
                const updatedStep = await svc.updateProtocolStepStatus(
                    projectId,
                    protocolId,
                    Number(selectedStep.index),
                    nextStatus,
                );

                const updatedIndex = Number((updatedStep as any)?.index ?? selectedStep.index);
                const mergedStep: ProtocolStep =
                    updatedStep && typeof updatedStep === "object"
                        ? { ...selectedStep, ...updatedStep }
                        : { ...selectedStep, status: nextStatus };

                setSteps((current) =>
                    current.map((step) => Number(step.index) === updatedIndex ? mergedStep : step),
                );

                const snapshotAtMs = Date.now();
                setStepsSnapshotAtMs(snapshotAtMs);
                setClockNowMs(snapshotAtMs);
            } catch (err: any) {
                setError(err?.message || "Failed to update protocol step status.");
            } finally {
                setStatusUpdating(null);
            }
        },
        [svc, projectId, protocolId, selectedStep],
    );

    useEffect(() => {
        if (!open) return;
        void loadSteps();
    }, [open, loadSteps]);

    useEffect(() => {
        if (!open) return;

        setClockNowMs(Date.now());

        const intervalId = window.setInterval(() => {
            setClockNowMs(Date.now());
        }, 1000);

        return () => window.clearInterval(intervalId);
    }, [open]);

    useEffect(() => {
        if (!open) return;

        const intervalId = window.setInterval(() => {
            void loadSteps(true);
        }, STEP_REFRESH_INTERVAL_MS);

        return () => window.clearInterval(intervalId);
    }, [open, loadSteps]);

    useEffect(() => {
        if (!open) {
            setTreeOpen(false);
        }
    }, [open]);

    const handleTreeNodeClick: NodeMouseHandler = useCallback(
        (_, node) => {
            const step = (node.data as StepGraphData | undefined)?.step;
            if (!step) return;

            const index = steps.findIndex((item) => Number(item.index) === Number(step.index));
            if (index >= 0) {
                setSelectedIndex(index);
            }
        },
        [steps],
    );

    const resetBusy = statusUpdating === "new";
    const finishBusy = statusUpdating === "finished";
    const statusButtonsDisabled = loading || statusUpdating !== null || !selectedStep;

    return (
        <>
            <Dialog open={open} onOpenChange={onOpenChange}>
                <DialogContent
                    container={container ?? undefined}
                    className="max-w-[1020px] p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl"
                >
                    <DialogHeader
                        className="border-b border-border"
                        style={{
                            backgroundColor: "#333d49",
                            color: "white",
                            padding: "28px 52px 12px 16px",
                            boxSizing: "border-box",
                        }}
                    >
                        <DialogTitle className="text-sm font-semibold leading-6 text-white text-center">
                            Protocol steps{protocolLabel ? ` - ${protocolLabel}` : ""}
                        </DialogTitle>
                    </DialogHeader>

                    <div className="border-b border-border bg-slate-100 px-3 py-2 flex items-center gap-2 text-xs">
                        <button
                            type="button"
                            onClick={() => setTreeOpen(true)}
                            disabled={loading || steps.length === 0}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 disabled:hover:bg-white"
                            title="Show protocol steps tree"
                        >
                            <GitBranch className="h-3.5 w-3.5" />
                            Tree
                        </button>

                        <button
                            type="button"
                            onClick={() => void updateSelectedStepStatus("new")}
                            disabled={statusButtonsDisabled}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 disabled:hover:bg-white"
                            title="Reset selected step to new"
                        >
                            <RotateCcw className={`h-3.5 w-3.5 ${resetBusy ? "animate-spin" : ""}`} />
                            Reset
                        </button>

                        <button
                            type="button"
                            onClick={() => void updateSelectedStepStatus("finished")}
                            disabled={statusButtonsDisabled}
                            className="inline-flex h-8 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-2.5 text-xs font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60 disabled:hover:bg-white"
                            title="Mark selected step as finished"
                        >
                            <CheckCircle2 className={`h-3.5 w-3.5 ${finishBusy ? "animate-pulse" : ""}`} />
                            Finish
                        </button>

                        <Button
                            type="button"
                            variant="outline"
                            className="ml-auto h-8 px-2.5 text-xs bg-white"
                            onClick={() => void loadSteps()}
                            disabled={loading || statusUpdating !== null || !projectId || !protocolId}
                        >
                            <RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
                            Refresh
                        </Button>
                    </div>

                    <div className="h-[500px] bg-slate-100 p-3 flex gap-3">
                        <div className="flex-1 min-w-0 bg-white overflow-auto border border-slate-300 rounded-md">
                            <table className="w-full text-xs border-collapse">
                                <thead className="bg-slate-50 sticky top-0 z-10">
                                    <tr className="text-slate-700">
                                        <th className="border-b border-slate-300 px-2 py-1.5 text-left w-16">Index</th>
                                        <th className="border-b border-slate-300 px-2 py-1.5 text-left">Step</th>
                                        <th className="border-b border-slate-300 px-2 py-1.5 text-left w-28">Status</th>
                                        <th className="border-b border-slate-300 px-2 py-1.5 text-left w-24">Time</th>
                                        <th className="border-b border-slate-300 px-2 py-1.5 text-left w-32">Class</th>
                                    </tr>
                                </thead>

                                <tbody>
                                    {loading && (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-4 text-slate-600">
                                                Loading steps...
                                            </td>
                                        </tr>
                                    )}

                                    {error && (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-4 text-red-600">
                                                {error}
                                            </td>
                                        </tr>
                                    )}

                                    {!loading && !error && steps.length === 0 && (
                                        <tr>
                                            <td colSpan={5} className="px-3 py-4 text-slate-600">
                                                No steps.
                                            </td>
                                        </tr>
                                    )}

                                    {steps.map((step, idx) => {
                                        const selected = idx === selectedIndex;
                                        const status = String(step.status ?? "");

                                        return (
                                            <tr
                                                key={`${step.index}-${step.name}`}
                                                onClick={() => setSelectedIndex(idx)}
                                                className={[
                                                    "cursor-default border-b border-slate-100",
                                                    selected
                                                        ? "bg-[#4f7391] text-white"
                                                        : "hover:bg-slate-50 text-slate-900",
                                                ].join(" ")}
                                            >
                                                <td className="px-2 py-1 font-mono">{step.index}</td>
                                                <td className="px-2 py-1 min-w-0">
                                                    <div className="truncate" title={`${step.index} - ${step.name}`}>
                                                        {step.index} - {step.name}
                                                    </div>
                                                </td>
                                                <td className="px-2 py-1">
                                                    <span
                                                        className={[
                                                            "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1",
                                                            selected ? "bg-white/15 text-white ring-white/25" : getStatusClass(status),
                                                        ].join(" ")}
                                                    >
                                                        {status || "-"}
                                                    </span>
                                                </td>
                                                <td className="px-2 py-1 font-mono">
                                                    {formatElapsed(getDisplayedStepElapsedSeconds(step, clockNowMs, stepsSnapshotAtMs))}
                                                </td>
                                                <td className="px-2 py-1">{getStepClass(step)}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        <aside className="w-[315px] bg-white border border-slate-300 rounded-md overflow-hidden text-xs">
                            <div className="border-b border-slate-200 bg-slate-50 px-3 py-2 font-semibold text-slate-700">
                                Step details
                            </div>

                            <div className="p-3 overflow-auto h-[calc(100%-33px)] text-slate-800">
                                {selectedStep ? (
                                    <div className="space-y-2">
                                        <div>
                                            <div className="font-semibold">Prerequisites:</div>
                                            <pre className="m-0 whitespace-pre-wrap font-mono text-[11px]">
                                                {formatValue(selectedStep.prerequisites ?? [])}
                                            </pre>
                                        </div>

                                        <div>
                                            <div className="font-semibold">Arguments:</div>
                                            <pre className="m-0 whitespace-pre-wrap font-mono text-[11px]">
                                                {formatValue(selectedStep.args) || "-"}
                                            </pre>
                                        </div>

                                        {selectedStep.initTime && (
                                            <div>
                                                <span className="font-semibold">Init:</span> {selectedStep.initTime}
                                            </div>
                                        )}

                                        {selectedStep.endTime && (
                                            <div>
                                                <span className="font-semibold">End:</span> {selectedStep.endTime}
                                            </div>
                                        )}

                                        <div>
                                            <span className="font-semibold">Needs GPU:</span>{" "}
                                            {String(Boolean(selectedStep.needsGpu))}
                                        </div>

                                        <div>
                                            <span className="font-semibold">Interactive:</span>{" "}
                                            {String(Boolean(selectedStep.interactive))}
                                        </div>

                                        {selectedStep.event && (
                                            <div>
                                                <span className="font-semibold">Event:</span> {selectedStep.event}
                                            </div>
                                        )}

                                        {selectedStep.error && (
                                            <div className="rounded-md border border-red-200 bg-red-50 px-2 py-1 text-red-700">
                                                <span className="font-semibold">Error:</span> {selectedStep.error}
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <span className="text-slate-500">Select a step.</span>
                                )}
                            </div>
                        </aside>
                    </div>
                </DialogContent>
            </Dialog>

            <Dialog open={treeOpen} onOpenChange={setTreeOpen}>
                <DialogContent
                    container={container ?? undefined}
                    className="max-w-[820px] p-0 overflow-hidden border border-border bg-background shadow-xl rounded-xl"
                >
                    <DialogHeader
                        className="border-b border-border"
                        style={{
                            backgroundColor: "#333d49",
                            color: "white",
                            padding: "24px 52px 12px 16px",
                            boxSizing: "border-box",
                        }}
                    >
                        <DialogTitle className="text-sm font-semibold leading-6 text-white text-center">
                            Protocol steps tree
                        </DialogTitle>
                    </DialogHeader>

                    <div className="h-[560px] bg-white">
                        <ReactFlowProvider>
                            <ReactFlow
                                nodes={treeNodes}
                                edges={treeEdges}
                                nodeTypes={nodeTypes}
                                onNodesChange={handleTreeNodesChange}
                                fitView
                                fitViewOptions={{ padding: 0.25 }}
                                nodesDraggable
                                nodesConnectable={false}
                                elementsSelectable
                                panOnScroll
                                zoomOnScroll
                                onNodeClick={handleTreeNodeClick}
                                proOptions={{ hideAttribution: true }}
                            >
                                <Background color="#e5e7eb" gap={24} />
                                <Controls showInteractive={false} />
                            </ReactFlow>
                        </ReactFlowProvider>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}