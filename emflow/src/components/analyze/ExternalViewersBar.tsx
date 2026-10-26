import { useEffect, useMemo, useState } from "react";
import {
  Box,
  Button,
  CircularProgress,
  Tooltip,
  Typography,
} from "@mui/material";
import { OpenInNew as OpenExternalIcon } from "@mui/icons-material";
import toast from "react-hot-toast";
import { useProjectService } from "@/ProjectServiceContext";
import type {
  ExternalViewerDescriptor,
  Id,
} from "@/services/ProjectService";

type ExternalViewersBarProps = {
  projectId: Id;
  protocolId: Id;
  outputName: string;
  objectId?: Id;
  objectKind?: string;
  disabled?: boolean;
  loadDelayMs?: number;
};

const externalViewersCache = new Map<string, ExternalViewerDescriptor[]>();

function buildExternalViewersCacheKey(params: {
  projectId: Id;
  protocolId: Id;
  outputName: string;
  objectKind?: string;
}) {
  return [
    String(params.projectId),
    String(params.protocolId),
    params.outputName,
    params.objectKind ?? "",
  ].join("::");
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const data = (error as any).data;
    const detail = data?.detail ?? (error as any).detail;
    const message = (error as any).message;

    if (Array.isArray(detail)) {
      return detail.map(String).join("\n");
    }

    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }

    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }

  return "Operation failed";
}

export default function ExternalViewersBar({
  projectId,
  protocolId,
  outputName,
  objectId,
  objectKind,
  disabled = false,
  loadDelayMs = 600,
}: ExternalViewersBarProps) {
  const svc = useProjectService();

  const [viewers, setViewers] = useState<ExternalViewerDescriptor[]>([]);
  const [loading, setLoading] = useState(false);
  const [launchingViewerId, setLaunchingViewerId] = useState<string | null>(null);

  const cacheKey = useMemo(
    () => buildExternalViewersCacheKey({ projectId, protocolId, outputName, objectKind }),
    [projectId, protocolId, outputName, objectKind],
  );

  const hasRequiredContext = useMemo(() => {
    return Boolean(
      projectId !== null &&
      projectId !== undefined &&
      protocolId !== null &&
      protocolId !== undefined &&
      outputName,
    );
  }, [projectId, protocolId, outputName]);

  useEffect(() => {
    if (!hasRequiredContext || typeof (svc as any).listExternalViewers !== "function") {
      setViewers([]);
      setLoading(false);
      return;
    }

    const cachedViewers = externalViewersCache.get(cacheKey);
    if (cachedViewers) {
      setViewers(cachedViewers);
      setLoading(false);
      return;
    }

    if (disabled) {
      setLoading(false);
      return;
    }

    const controller = new AbortController();
    let cancelled = false;
    let timer: number | null = null;

    async function loadExternalViewers() {
      try {
        setLoading(true);

        const result = await (svc as any).listExternalViewers(
          projectId,
          protocolId,
          outputName,
          {
            objectId,
            objectKind,
            signal: controller.signal,
          },
        );

        if (cancelled) return;

        const nextViewers = Array.isArray(result) ? result : [];
        externalViewersCache.set(cacheKey, nextViewers);
        setViewers(nextViewers);
      } catch (error: any) {
        if (controller.signal.aborted || cancelled) return;

        setViewers([]);

        if (error?.status !== 404) {
          console.warn("Failed to load external viewers", error);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    timer = window.setTimeout(() => {
      void loadExternalViewers();
    }, Math.max(0, loadDelayMs));

    return () => {
      cancelled = true;
      if (timer != null) {
        window.clearTimeout(timer);
      }
      controller.abort();
    };
  }, [hasRequiredContext, disabled, svc, projectId, protocolId, outputName, objectKind, cacheKey, loadDelayMs]);

  const handleLaunchViewer = async (viewer: ExternalViewerDescriptor) => {
    if (disabled || !viewer.available) return;

    if (typeof (svc as any).launchExternalViewer !== "function") {
      toast.error("External viewers are not available in this service.");
      return;
    }

    try {
      setLaunchingViewerId(viewer.id);

      const result = await (svc as any).launchExternalViewer(
        projectId,
        protocolId,
        outputName,
        viewer.id,
        {
          objectId,
          objectKind,
        },
      );

      toast.success(result?.message || `${viewer.label} launch requested.`);
    } catch (error) {
      console.error("Failed to launch external viewer", error);
      toast.error(getErrorMessage(error));
    } finally {
      setLaunchingViewerId(null);
    }
  };

  if (!loading && viewers.length === 0) {
    return null;
  }

  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        flexWrap: "wrap",
        minWidth: 0,
      }}
    >

      {loading ? (
        <CircularProgress size={16} />
      ) : (
        viewers.map((viewer) => {
          const isLaunching = launchingViewerId === viewer.id;
          const isDisabled = disabled || !viewer.available || isLaunching;

          const title =
            viewer.available
              ? `Open with ${viewer.label}`
              : viewer.reason || `${viewer.label} is not available`;

          return (
            <Tooltip key={viewer.id} title={title}>
              <span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={
                    isLaunching ? (
                      <CircularProgress size={14} />
                    ) : (
                      <OpenExternalIcon fontSize="small" />
                    )
                  }
                  disabled={isDisabled}
                  onClick={() => handleLaunchViewer(viewer)}
                  sx={{
                    textTransform: "none",
                    minHeight: 28,
                    px: 1,
                  }}
                >
                  {viewer.label}
                </Button>
              </span>
            </Tooltip>
          );
        })
      )}
    </Box>
  );
}
