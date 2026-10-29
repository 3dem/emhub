import { createContext, useContext } from "react";

// Refresh the workflow of the ProjectPage that renders a component, e.g. after
// a table viewer action launched a new job (see TableViewerEditActionResult)
const ProjectRefreshContext = createContext<() => void>(() => {});

export const ProjectRefreshProvider = ProjectRefreshContext.Provider;

export function useProjectRefresh() {
  return useContext(ProjectRefreshContext);
}
