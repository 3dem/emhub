import type { AnalyzeViewerResolveDecision } from "@/services/ProjectService";

export type TableViewerDecision = Extract<
  AnalyzeViewerResolveDecision,
  { handled: true; viewer: "table" }
>;

export function isTableViewerAnalyzeDecision(
  decision: AnalyzeViewerResolveDecision | null | undefined,
): decision is TableViewerDecision {
  return !!decision && decision.handled === true && decision.viewer === "table";
}

export function openExternalAnalyzeDecision(
  decision: AnalyzeViewerResolveDecision | null | undefined,
  defaultTarget: "_self" | "_blank" = "_blank",
): boolean {
  if (!decision || decision.handled !== true || decision.viewer === "table") {
    return false;
  }

  // Legacy hosts may omit `viewer: "external"` and only send a url.
  const external = decision as Extract<AnalyzeViewerResolveDecision, { viewer: "external" }>;
  const url = external.url;
  if (!url) return false;

  const target = external.target ?? defaultTarget;

  if (target === "_self") {
    if (url.startsWith("#")) {
      window.location.hash = url.slice(1);
    } else {
      window.location.assign(url);
    }
    return true;
  }

  window.open(url, "_blank", "noopener,noreferrer");
  return true;
}
