import { useEffect, useMemo, useState, type ReactElement } from "react";
import { Box, CircularProgress, Divider, IconButton, Paper, Stack, Tooltip, Typography } from "@mui/material";
import { Activity, Box as BoxIcon, GitBranch, Layers, Table as TableIcon } from "lucide-react";
import { useProjectService } from "@/ProjectServiceContext";
import type { IntegratedAnalyzeContext, IntegratedContextItemRelation, IntegratedContextLink } from "@/services/ProjectService";
import { MetadataViewer } from "./metadata-viewer";
import VolumeViewer from "./volume-viewer";
import Coords3dViewer from "./coords3d-viewer";
import TiltSeriesViewer from "./tiltseries-viewer";
import CTFTomoViewer from "./ctftomo-viewer";

type IntegratedTomographyViewerProps = {
  projectId: string | number;
  protocolId: string | number;
  protocolLabel?: string;
  outputName: string;
  pointerClass?: string;
};

type IntegratedSection = "tiltSeries" | "ctf" | "tomogram" | "coordinates" | "metadata";
type ContextKey = "tiltSeries" | "ctf" | "tomogram" | "coordinates3d";
type ContextStatus = "source" | "linked" | "planned" | "unavailable";
type RelationSource = "coordinates" | "tomogram" | "tiltSeries" | "ctf";

type ContextNode = {
  key: Exclude<IntegratedSection, "metadata">;
  contextKey?: ContextKey;
  label: string;
  description: string;
  status: ContextStatus;
  icon: ReactElement;
};

function normalizedKind(value?: string) {
  return (value ?? "").replace(/\s+/g, "").toLowerCase();
}

function isTomogramKind(value?: string) {
  return normalizedKind(value) === "setoftomograms";
}

function isCoords3dKind(value?: string) {
  return normalizedKind(value).includes("setofcoordinates3d");
}

function isTiltSeriesKind(value?: string) {
  const kind = normalizedKind(value);
  return kind.includes("setoftiltseries") && kind !== "setoftiltseriesm";
}

function isCTFTomoKind(value?: string) {
  return normalizedKind(value).includes("setofctftomoseries");
}

function getInitialSection(pointerClass?: string): IntegratedSection {
  if (isCoords3dKind(pointerClass)) return "coordinates";
  if (isTomogramKind(pointerClass)) return "tomogram";
  if (isCTFTomoKind(pointerClass)) return "ctf";
  if (isTiltSeriesKind(pointerClass)) return "tiltSeries";
  return "metadata";
}


function isAvailableLink(link?: IntegratedContextLink | null) {
  return Boolean(
    link?.outputName &&
    (
      link.status === "available" ||
      link.status === "related" ||
      link.status === "derived" ||
      link.status === "inferred"
    ),
  );
}

function getNodeStatus(isSource: boolean, link: IntegratedContextLink | null | undefined, canBeLinked: boolean): ContextStatus {
  if (isSource) return "source";
  if (isAvailableLink(link)) return "linked";
  if (canBeLinked) return "planned";
  return "unavailable";
}

function getLinkedProtocolId(link: IntegratedContextLink | null | undefined, fallbackProtocolId: number) {
  const next = Number(link?.publicProtocolId ?? link?.protocolId);
  return Number.isFinite(next) ? next : fallbackProtocolId;
}

function getLinkedOutputName(link: IntegratedContextLink | null | undefined, fallbackOutputName: string) {
  return link?.outputName || fallbackOutputName;
}

function getSummarySize(summary?: Record<string, unknown> | null) {
  const rawSize = summary?.size;
  const size = typeof rawSize === "number" ? rawSize : Number(rawSize);

  return Number.isFinite(size) ? size : null;
}

function formatContextSize(section: Exclude<IntegratedSection, "metadata">, size: number | null) {
  if (size == null) return null;

  const value = new Intl.NumberFormat().format(size);

  if (section === "coordinates") return `${value} coordinates`;
  if (section === "tomogram") return `${value} volumes`;
  if (section === "tiltSeries") return `${value} tilt series`;
  if (section === "ctf") return `${value} CTF series`;

  return value;
}

function getRelationSourceLabel(source: RelationSource | null) {
  if (source === "coordinates") return "COORDINATES";
  if (source === "tomogram") return "TOMOGRAM";
  if (source === "tiltSeries") return "TILT SERIES";
  if (source === "ctf") return "CTF";

  return null;
}

function ContextNavigatorCard({
  node,
  outputName,
  sizeLabel,
  active,
  metadataActive,
  connected,
  onSelect,
  onMetadataSelect,
}: {
  node: ContextNode;
  outputName: string;
  sizeLabel?: string | null;
  active: boolean;
  metadataActive: boolean;
  connected: boolean;
  onSelect: () => void;
  onMetadataSelect: () => void;
}) {
  const source = node.status === "source";

  return (
    <Box>
      <Paper
        variant="outlined"
        onClick={onSelect}
        sx={{
          position: "relative",
          overflow: "hidden",
          cursor: "pointer",
          borderRadius: 2,
          borderColor: active ? "primary.main" : "divider",
          bgcolor: active ? "action.selected" : "background.paper",
          boxShadow: active ? 2 : 0,
          transition: "border-color 120ms ease, background-color 120ms ease, box-shadow 120ms ease",
          "&:hover": {
            borderColor: "primary.main",
            bgcolor: active ? "action.selected" : "action.hover",
          },
        }}
      >
        <Box
          sx={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            bgcolor: source || active ? "primary.main" : "divider",
          }}
        />

        <Box sx={{ p: 1.1, pl: 1.4 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.8 }}>
            <Box
              sx={{
                width: 32,
                height: 32,
                borderRadius: 1.5,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
                color: source || active ? "primary.main" : "text.secondary",
                bgcolor: source || active ? "action.selected" : "action.hover",
              }}
            >
              {node.icon}
            </Box>

            <Box sx={{ minWidth: 0, flex: 1 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.6 }}>
                <Typography
                  variant="body2"
                  sx={{
                    minWidth: 0,
                    flex: 1,
                    fontWeight: 900,
                    lineHeight: 1.15,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {node.label}
                </Typography>

                <Box
                  sx={{
                    px: 0.65,
                    py: 0.18,
                    borderRadius: 20,
                    bgcolor: source ? "primary.main" : "action.hover",
                    color: source ? "primary.contrastText" : "text.secondary",
                    fontSize: 9,
                    lineHeight: 1.3,
                    fontWeight: 900,
                    letterSpacing: 0.5,
                    flexShrink: 0,
                  }}
                >
                  {source ? "SOURCE" : "LINKED"}
                </Box>
              </Box>

              <Typography
                variant="caption"
                sx={{
                  display: "block",
                  mt: 0.3,
                  color: "text.secondary",
                  fontFamily: "monospace",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {outputName}
              </Typography>
            </Box>

            <Tooltip title="Metadata" placement="right" arrow>
              <IconButton
                size="small"
                aria-label={`Open ${node.label} metadata`}
                onClick={(event) => {
                  event.stopPropagation();
                  onMetadataSelect();
                }}
                sx={{
                  width: 28,
                  height: 28,
                  color: metadataActive ? "primary.main" : "text.disabled",
                  bgcolor: metadataActive ? "action.selected" : "transparent",
                  flexShrink: 0,
                  "&:hover": {
                    color: "primary.main",
                    bgcolor: "action.hover",
                  },
                }}
              >
                <TableIcon size={15} />
              </IconButton>
            </Tooltip>
          </Box>

          <Box
            sx={{
              mt: 0.8,
              pt: 0.7,
              borderTop: "1px solid",
              borderColor: "divider",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 1,
            }}
          >
            <Typography
              variant="caption"
              sx={{
                minWidth: 0,
                color: "text.secondary",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {node.description}
            </Typography>

            {sizeLabel ? (
              <Typography
                variant="caption"
                sx={{
                  color: "text.primary",
                  fontWeight: 800,
                  whiteSpace: "nowrap",
                }}
              >
                {sizeLabel}
              </Typography>
            ) : null}
          </Box>
        </Box>
      </Paper>

      {connected ? (
        <Box
          sx={{
            height: 20,
            ml: 3,
            borderLeft: "2px solid",
            borderColor: "divider",
            position: "relative",
          }}
        >
          <Box
            sx={{
              position: "absolute",
              width: 6,
              height: 6,
              borderRadius: "50%",
              bgcolor: "primary.main",
              left: -4,
              top: 7,
            }}
          />
        </Box>
      ) : null}
    </Box>
  );
}

export default function IntegratedTomographyViewer({
  projectId,
  protocolId,
  protocolLabel,
  outputName,
  pointerClass,
}: IntegratedTomographyViewerProps) {
  const svc = useProjectService();
  const projectIdNum = useMemo(() => Number(projectId), [projectId]);
  const protocolIdNum = useMemo(() => Number(protocolId), [protocolId]);
  const [context, setContext] = useState<IntegratedAnalyzeContext | null>(null);
  const resolvedPointerClass = context?.root?.outputClass || pointerClass;
  const initialSection = useMemo(
    () => getInitialSection(resolvedPointerClass),
    [resolvedPointerClass],
  );
  const [activeSection, setActiveSection] = useState<IntegratedSection>(initialSection);
  const [metadataTargetSection, setMetadataTargetSection] = useState<IntegratedSection>(initialSection);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [selectedRelation, setSelectedRelation] = useState<IntegratedContextItemRelation | null>(null);
  const [selectedRelationSource, setSelectedRelationSource] = useState<RelationSource | null>(null);
  const [mountedSections, setMountedSections] = useState<Set<IntegratedSection>>(
    () => new Set([initialSection]),
  );
  const hideMetadataAction = true;

  useEffect(() => {
    setSelectedRelation(null);
    setSelectedRelationSource(null);
    setMetadataTargetSection(initialSection);
    setMountedSections(new Set([initialSection]));
  }, [projectIdNum, protocolIdNum, outputName, initialSection]);


  const normalizeSelectionValue = (value: unknown) => {
    if (value == null) return null;
    const text = String(value);
    return text ? text : null;
  };

  const relationValueMatches = (value: unknown, candidates: string[]) => {
    const text = normalizeSelectionValue(value);
    return text != null && candidates.includes(text);
  };

  const selectRelationByCandidates = (source: RelationSource, rawCandidates: unknown[]) => {
    const candidates = rawCandidates
      .map(normalizeSelectionValue)
      .filter((value): value is string => Boolean(value));

    if (!candidates.length) {
      setSelectedRelationSource(source);
      setSelectedRelation(null);
      return;
    }

    const items = context?.relations?.items ?? [];

    const sourceMatch = items.find((item) => {
      if (source === "coordinates") {
        return (
          relationValueMatches(item.coordinatesTomogramId, candidates) ||
          relationValueMatches(item.tomogramId, candidates)
        );
      }

      if (source === "tomogram") {
        return (
          relationValueMatches(item.tiltSeriesId, candidates) ||
          relationValueMatches((item as any).tsId, candidates) ||
          relationValueMatches(item.ctfSeriesId, candidates) ||
          relationValueMatches(item.tomogramId, candidates) ||
          relationValueMatches((item as any).sourceTomoId, candidates) ||
          relationValueMatches(item.tomogramVolumeId, candidates)
        );
      }

      if (source === "tiltSeries") {
        return relationValueMatches(item.tiltSeriesId, candidates);
      }

      return (
        relationValueMatches(item.ctfSeriesId, candidates) ||
        relationValueMatches(item.tiltSeriesId, candidates)
      );
    });

    const fallbackMatch =
      sourceMatch ??
      items.find(
        (item) =>
          relationValueMatches(item.key, candidates) ||
          relationValueMatches(item.label, candidates),
      );

    setSelectedRelationSource(source);
    setSelectedRelation((prev) => {
      if (!fallbackMatch) return null;
      return prev?.key === fallbackMatch.key ? prev : fallbackMatch;
    });
  };

  const handleCoordinatesTomogramSelect = (tomogram: any) => {
    selectRelationByCandidates("coordinates", [
      tomogram?.tomoId,
      tomogram?.id,
      tomogram?.label,
      tomogram?.name,
      tomogram?.tsId,
    ]);
  };

  const handleVolumeSelect = (volume: any) => {
    selectRelationByCandidates("tomogram", [
      volume?.tsId,
      volume?.tiltSeriesId,
      volume?.tomoId,
      volume?.tomogramId,
      volume?.id,
    ]);
  };

  const handleTiltSeriesSelect = (series: any) => {
    selectRelationByCandidates("tiltSeries", [
      series?.tiltSeriesId,
      series?.tsId,
      series?.id,
      series?.label,
    ]);
  };

  const handleCtfSeriesSelect = (series: any) => {
    selectRelationByCandidates("ctf", [
      series?.ctfSeriesId,
      series?.tiltSeriesId,
      series?.tsId,
      series?.id,
      series?.label,
    ]);
  };

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection, outputName]);

  useEffect(() => {
    if (!Number.isFinite(projectIdNum) || !Number.isFinite(protocolIdNum) || !outputName) {
      setContext(null);
      setContextLoading(false);
      setContextError(null);
      return;
    }

    const abort = new AbortController();
    setContextLoading(true);
    setContextError(null);

    svc.fetchIntegratedAnalyzeContext(projectIdNum, protocolIdNum, outputName, {
      signal: abort.signal,
      cache: "no-store",
    })
      .then((nextContext) => {
        if (!abort.signal.aborted) setContext(nextContext);
      })
      .catch((error) => {
        if (abort.signal.aborted) return;
        setContext(null);
        setContextError(error instanceof Error ? error.message : "Failed to load integrated context");
      })
      .finally(() => {
        if (!abort.signal.aborted) setContextLoading(false);
      });

    return () => abort.abort();
  }, [svc, projectIdNum, protocolIdNum, outputName]);

  const nodes = useMemo<ContextNode[]>(() => {
    const tiltIsSource = isTiltSeriesKind(resolvedPointerClass);
    const ctfIsSource = isCTFTomoKind(resolvedPointerClass);
    const tomogramIsSource = isTomogramKind(resolvedPointerClass);
    const coordsIsSource = isCoords3dKind(resolvedPointerClass);
    const links = context?.links;

    return [
      {
        key: "tiltSeries",
        contextKey: "tiltSeries",
        label: "Tilt series",
        description: tiltIsSource ? "Selected output" : "Upstream input",
        status: getNodeStatus(tiltIsSource, links?.tiltSeries, coordsIsSource || tomogramIsSource || ctfIsSource),
        icon: <Layers size={16} />,
      },
      {
        key: "ctf",
        contextKey: "ctf",
        label: "CTF tomo",
        description: ctfIsSource ? "Selected output" : "Upstream input",
        status: getNodeStatus(ctfIsSource, links?.ctf, coordsIsSource || tomogramIsSource),
        icon: <Activity size={16} />,
      },
      {
        key: "tomogram",
        contextKey: "tomogram",
        label: "Tomogram",
        description: coordsIsSource ? "Selected output" : "Upstream input",
        status: getNodeStatus(tomogramIsSource, links?.tomogram, coordsIsSource),
        icon: <BoxIcon size={16} />,
      },
      {
        key: "coordinates",
        contextKey: "coordinates3d",
        label: "Coordinates 3D",
        description: coordsIsSource ? "Particle coordinates" : links?.coordinates3d?.label || "Particles and picked points",
        status: getNodeStatus(coordsIsSource, links?.coordinates3d, false),
        icon: <GitBranch size={16} />,
      },
    ];
  }, [context, resolvedPointerClass]);

  const visibleNodes = useMemo(() => nodes.filter((node) => node.status === "source" || node.status === "linked"), [nodes]);


  const sourceSections = useMemo(
    () => ({
      tiltSeries: isTiltSeriesKind(resolvedPointerClass),
      ctf: isCTFTomoKind(resolvedPointerClass),
      tomogram: isTomogramKind(resolvedPointerClass),
      coordinates: isCoords3dKind(resolvedPointerClass),
    }),
    [resolvedPointerClass],
  );

  const getSectionLink = (
    section: Exclude<IntegratedSection, "metadata">,
  ): IntegratedContextLink | null | undefined => {
    const links = context?.links;

    if (sourceSections[section]) {
      return null;
    }

    if (section === "tiltSeries") return links?.tiltSeries;
    if (section === "ctf") return links?.ctf;
    if (section === "tomogram") return links?.tomogram;
    if (section === "coordinates") return links?.coordinates3d;

    return null;
  };

  const isSectionAvailable = (
    section: Exclude<IntegratedSection, "metadata">,
  ): boolean => {
    return sourceSections[section] || isAvailableLink(getSectionLink(section));
  };

  const navigatorNodes = useMemo<ContextNode[]>(() => {
    const bySection = new Map(
      visibleNodes.map((node) => [node.key, node] as const),
    );

    let order: Array<Exclude<IntegratedSection, "metadata">>;

    if (isCoords3dKind(resolvedPointerClass)) {
      order = ["coordinates", "tomogram", "tiltSeries", "ctf"];
    } else if (isTomogramKind(resolvedPointerClass)) {
      order = ["tomogram", "tiltSeries", "ctf", "coordinates"];
    } else if (isCTFTomoKind(resolvedPointerClass)) {
      order = ["ctf", "tiltSeries", "tomogram", "coordinates"];
    } else if (isTiltSeriesKind(resolvedPointerClass)) {
      order = ["tiltSeries", "ctf", "tomogram", "coordinates"];
    } else {
      return visibleNodes;
    }

    return order
      .map((section) => bySection.get(section))
      .filter((node): node is ContextNode => Boolean(node));
  }, [visibleNodes, resolvedPointerClass]);

  const activateNavigatorSection = (
    section: Exclude<IntegratedSection, "metadata">,
  ) => {
    setMountedSections((prev) => {
      if (prev.has(section)) return prev;

      const next = new Set(prev);
      next.add(section);
      return next;
    });

    setActiveSection(section);
    setSelectedRelationSource(null);
  };

  const openNavigatorMetadata = (
    section: Exclude<IntegratedSection, "metadata">,
  ) => {
    setMountedSections((prev) => {
      if (prev.has("metadata")) return prev;

      const next = new Set(prev);
      next.add("metadata");
      return next;
    });

    setMetadataTargetSection(section);
    setActiveSection("metadata");
    setSelectedRelationSource(null);
  };

  const getNavigatorOutputName = (node: ContextNode) => {
    if (node.status === "source") return outputName;

    return getSectionLink(node.key)?.outputName || node.description;
  };

  const getNavigatorSizeLabel = (node: ContextNode) => {
    const summary = node.contextKey
      ? context?.summaries?.[node.contextKey]
      : null;

    return formatContextSize(
      node.key,
      getSummarySize(summary),
    );
  };

  const focusItems = useMemo(
    () => [
      {
        section: "tiltSeries" as const,
        label: "Tilt series",
        value: selectedRelation?.tiltSeriesId,
      },
      {
        section: "ctf" as const,
        label: "CTF",
        value: selectedRelation?.ctfSeriesId,
      },
      {
        section: "tomogram" as const,
        label: "Tomogram",
        value: selectedRelation?.tomogramId,
      },
      {
        section: "coordinates" as const,
        label: "Coords 3D",
        value: selectedRelation?.coordinatesTomogramId,
      },
    ],
    [selectedRelation],
  );

  const renderSection = (section: IntegratedSection = activeSection) => {
    if (section === "tiltSeries") {
      const link = getSectionLink("tiltSeries");

      if (isSectionAvailable("tiltSeries")) {
        return (
          <TiltSeriesViewer
            projectId={projectIdNum}
            protocolId={getLinkedProtocolId(link, protocolIdNum)}
            outputName={getLinkedOutputName(link, outputName)}
            protocolLabel={protocolLabel}
            selectedTiltSeriesId={selectedRelationSource === "tiltSeries" ? null : selectedRelation?.tiltSeriesId ?? null}
            onTiltSeriesSelect={handleTiltSeriesSelect}
            hideMetadataAction={hideMetadataAction}
          />
        );
      }
    }

    if (section === "ctf") {
      const link = getSectionLink("ctf");

      if (isSectionAvailable("ctf")) {
        return (
          <CTFTomoViewer
            projectId={projectIdNum}
            protocolId={getLinkedProtocolId(link, protocolIdNum)}
            outputName={getLinkedOutputName(link, outputName)}
            protocolLabel={protocolLabel}
            selectedCtfSeriesId={selectedRelationSource === "ctf" ? null : selectedRelation?.ctfSeriesId ?? null}
            selectedTiltSeriesId={selectedRelationSource === "ctf" ? null : selectedRelation?.tiltSeriesId ?? null}
            onCtfSeriesSelect={handleCtfSeriesSelect}
            hideMetadataAction={hideMetadataAction}
          />
        );
      }
    }

    if (section === "tomogram") {
      const link = getSectionLink("tomogram");

      if (isSectionAvailable("tomogram")) {
        return (
          <VolumeViewer
            projectId={projectIdNum}
            protocolId={getLinkedProtocolId(link, protocolIdNum)}
            protocolLabel={protocolLabel}
            outputName={getLinkedOutputName(link, outputName)}
            pointerClass={isTomogramKind(resolvedPointerClass) ? resolvedPointerClass : "SetOfTomograms"}
            selectedVolumeId={
              selectedRelationSource === "tomogram"
                ? null
                : selectedRelation?.tomogramVolumeId ??
                selectedRelation?.tomogramId ??
                (selectedRelation as any)?.sourceTomoId ??
                selectedRelation?.tiltSeriesId ??
                (selectedRelation as any)?.tsId ??
                selectedRelation?.ctfSeriesId ??
                null
            }
            onVolumeSelect={handleVolumeSelect}
            hideMetadataAction={hideMetadataAction}
            active={activeSection === "tomogram"}
          />
        );
      }
    }

    if (section === "coordinates") {
      const link = getSectionLink("coordinates");

      if (isSectionAvailable("coordinates")) {
        return (
          <Coords3dViewer
            projectId={projectIdNum}
            protocolId={getLinkedProtocolId(link, protocolIdNum)}
            protocolLabel={protocolLabel}
            outputName={getLinkedOutputName(link, outputName)}
            selectedTomogramId={
              selectedRelationSource === "coordinates"
                ? null
                : selectedRelation?.coordinatesTomogramId ??
                selectedRelation?.tomogramId ??
                (selectedRelation as any)?.sourceTomoId ??
                selectedRelation?.tiltSeriesId ??
                (selectedRelation as any)?.tsId ??
                selectedRelation?.ctfSeriesId ??
                null
            }
            onTomogramSelect={handleCoordinatesTomogramSelect}
            hideMetadataAction={hideMetadataAction}
          />
        );
      }
    }

    if (section === "metadata") {
      const metadataLink =
        metadataTargetSection === "metadata"
          ? null
          : getSectionLink(metadataTargetSection as Exclude<IntegratedSection, "metadata">);

      return (
        <MetadataViewer
          projectId={projectIdNum}
          protocolId={getLinkedProtocolId(metadataLink, protocolIdNum)}
          outputName={getLinkedOutputName(metadataLink, outputName)}
          embedded
        />
      );
    }

    return <MetadataViewer projectId={projectIdNum} protocolId={protocolIdNum} outputName={outputName} embedded />;
  };

  return (
    <Box
      sx={{
        height: "100%",
        minHeight: 0,
        minWidth: 0,
        display: "grid",
        gridTemplateColumns: "300px minmax(0, 1fr)",
        overflow: "hidden",
        bgcolor: "background.default",
      }}
    >
      <Paper
        square
        elevation={0}
        sx={{
          minHeight: 0,
          overflow: "hidden",
          borderRight: "1px solid",
          borderColor: "divider",
          bgcolor: "background.paper",
          p: 1.25,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0, mb: 0.75 }}>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="overline" sx={{ display: "block", color: "text.secondary", fontWeight: 800, letterSpacing: 0.7, lineHeight: 1.1 }}>
              Tomography context
            </Typography>
            <Typography variant="caption" sx={{ display: "block", color: "text.disabled", lineHeight: 1.15, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {pointerClass || "Integrated viewer"}
            </Typography>
          </Box>
          {contextLoading ? <CircularProgress size={14} /> : null}
        </Box>

        {contextError ? (
          <Typography variant="caption" sx={{ display: "block", color: "error.main", mb: 0.65 }}>
            {contextError}
          </Typography>
        ) : null}

        <Box
          sx={{
            minHeight: 0,
            flex: 1,
            overflowY: "auto",
            overflowX: "hidden",
            pr: 0.25,
            pb: 1,
          }}
        >
          <Stack spacing={0}>
            {navigatorNodes.map((node, index) => (
              <ContextNavigatorCard
                key={node.key}
                node={node}
                outputName={getNavigatorOutputName(node)}
                sizeLabel={getNavigatorSizeLabel(node)}
                active={activeSection === node.key}
                metadataActive={
                  activeSection === "metadata" &&
                  metadataTargetSection === node.key
                }
                connected={index < navigatorNodes.length - 1}
                onSelect={() => activateNavigatorSection(node.key)}
                onMetadataSelect={() => openNavigatorMetadata(node.key)}
              />
            ))}
          </Stack>

          {selectedRelation ? (
            <>
              <Divider sx={{ my: 1.5 }} />

              <Box>
                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 1,
                  }}
                >
                  <Typography
                    variant="overline"
                    sx={{
                      color: "text.secondary",
                      fontWeight: 900,
                      letterSpacing: 0.8,
                      lineHeight: 1,
                    }}
                  >
                    Focus
                  </Typography>

                  {selectedRelationSource ? (
                    <Typography
                      variant="caption"
                      sx={{
                        color: "primary.main",
                        fontWeight: 900,
                        fontSize: 9,
                        letterSpacing: 0.5,
                      }}
                    >
                      FROM {getRelationSourceLabel(selectedRelationSource)}
                    </Typography>
                  ) : null}
                </Box>

                <Typography
                  variant="body2"
                  sx={{
                    mt: 0.55,
                    fontWeight: 900,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {selectedRelation.label || selectedRelation.key}
                </Typography>

                <Box
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
                    gap: 0.65,
                    mt: 0.9,
                  }}
                >
                  {focusItems.map((item) => {
                    const available = navigatorNodes.some(
                      (node) => node.key === item.section,
                    );
                    const active = activeSection === item.section;
                    const hasValue = item.value != null && String(item.value) !== "";

                    return (
                      <Box
                        key={item.section}
                        onClick={() => {
                          if (available) {
                            activateNavigatorSection(item.section);
                          }
                        }}
                        sx={{
                          minWidth: 0,
                          p: 0.75,
                          borderRadius: 1.5,
                          border: "1px solid",
                          borderColor: active ? "primary.main" : "divider",
                          bgcolor: active ? "action.selected" : "background.default",
                          opacity: available ? 1 : 0.45,
                          cursor: available ? "pointer" : "default",
                          transition: "border-color 120ms ease, background-color 120ms ease",
                          "&:hover": available
                            ? {
                              borderColor: "primary.main",
                              bgcolor: "action.hover",
                            }
                            : undefined,
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                            color: "text.secondary",
                            fontWeight: 800,
                            fontSize: 9.5,
                            lineHeight: 1.1,
                          }}
                        >
                          {item.label}
                        </Typography>

                        <Typography
                          variant="caption"
                          sx={{
                            display: "block",
                            mt: 0.35,
                            color: hasValue ? "text.primary" : "text.disabled",
                            fontWeight: 900,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {hasValue ? String(item.value) : "—"}
                        </Typography>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </>
          ) : null}
        </Box>
      </Paper>

      <Box sx={{ minHeight: 0, minWidth: 0, overflow: "hidden", position: "relative" }}>
        {Array.from(mountedSections).map((section) => (
          <Box
            key={section}
            sx={{
              display: activeSection === section ? "block" : "none",
              height: "100%",
              minHeight: 0,
              minWidth: 0,
              overflow: "hidden",
            }}
          >
            {renderSection(section)}
          </Box>
        ))}
      </Box>
    </Box>
  );
}