// src/ProjectServiceContext.tsx
//
// The viewer has no backend of its own: every data access goes through the
// ProjectService object provided by the host page (EMhub's `svc`).
import { createContext, useContext, useMemo } from "react";
import type { ReactNode, FC } from "react";
import type { ProjectService } from "./services/ProjectService";

const ProjectServiceContext = createContext<ProjectService | null>(null);

type ProviderProps = {
  service: ProjectService;
  children: ReactNode;
};

export const ProjectServiceProvider: FC<ProviderProps> = ({ service, children }) => (
  <ProjectServiceContext.Provider value={service}>{children}</ProjectServiceContext.Provider>
);

/**
 * Get the ProjectService instance provided by the host.
 *
 * You can optionally parameterize the expected shapes:
 *   const svc = useProjectService<MyProject, MyProjectList, MyProtocol>();
 */
export function useProjectService<
  TProject = any,
  TProjectList = any,
  TProtocol = any
>(): ProjectService<TProject, TProjectList, TProtocol> {
  const ctx = useContext(ProjectServiceContext) as
    | ProjectService<TProject, TProjectList, TProtocol>
    | null;

  if (!ctx) {
    throw new Error("useProjectService must be used within a ProjectServiceProvider");
  }

  return ctx;
}

/**
 * Select a specific slice of the service to minimize re-renders in consumers.
 * Example:
 *   const rename = useProjectServiceSelector(s => s.renameProject);
 */
export function useProjectServiceSelector<T>(
  selector: (svc: ProjectService) => T,
): T {
  const svc = useProjectService();
  return useMemo(() => selector(svc), [svc, selector]);
}
