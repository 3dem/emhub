---
name: emflow-components
description: Reference for the emflow viewer (the React project page embedded in EMhub) - its components, what each one is expected to do, the ProjectService contract with the host, output/analyze viewer routing, the table viewer protocol, style isolation and embedding rules. Use when changing, debugging or adding components in emflow (src/components, ProjectPage, widget/), when an output viewer or protocol form misbehaves in EMhub, when changing EMhub's project_widget_svc*.html, or when syncing code from ScipionWeb. Keep this skill updated in the same change as the components.
---

# emflow components

emflow is a frontend-only React viewer compiled to a UMD bundle
(`dist/emflow.js` + `dist/emflow.css`, global `EMFlow`) that EMhub mounts in
its pages. It was extracted from ScipionWeb's project-page widget
(branch `jm_new_integrated_viewer`): **it has no backend**, every data access
goes through the `service` object the host passes in.

Read the reference that matches the task:

- [references/components.md](references/components.md): every component,
  what it renders, its expected behavior and the service methods it calls.
- [references/service-contract.md](references/service-contract.md): the
  ProjectService methods (who calls them, required vs optional, defaults),
  the analyze-viewer decision and the table-viewer protocol, and how EMhub
  implements them.
- [references/embedding.md](references/embedding.md): mounting, overlays and
  portals, theme, CSS isolation rules, and how EMhub loads the bundle.

## Architecture in one picture

```
EMhub page
  project_widget_shell.html      card + #project-page-host
  project_widget_svc*.html       var svc = {...}   (ProjectService implementation)
  project_widget_bootstrap.html  loads emflow.js/css once, EMFlow.mountProjectPage(...)
        |
src/index.tsx  mountProjectPage({container, service, projectName, theme})
  widget/shell.ts           .emflow-root shell inside the container
  widget/overlay.tsx        .emflow-root overlay root on <body> (MUI portals, drawer)
  widget/normalizeService   svc -> ProjectService (aliases + harmless defaults)
  ProjectServiceProvider -> CacheProvider(emotion "emflow") -> ThemeProvider
    -> OverlayRootProvider (MUI theme with portal container) -> DragProvider
      pages/Dashboard/projects/ProjectPage.tsx   (the whole viewer)
        ProtocolNodeCard (graph nodes) / ProtocolForm (dock panel)
        ProtocolsDrawer, workflows panel, tags, RemoteFileDialog
        output viewers: TableViewerDialog | AnalyzeOutputDialog -> analyze/*
      <Toaster/> (react-hot-toast)
```

## Rules that must hold (check them on every change)

1. **No server code.** Never add HTTP calls, `fetch`, axios, auth or base URLs.
   New data needs a new (optional) ProjectService method, declared in
   `src/services/ProjectService.ts`, with a default in
   `src/widget/normalizeService.ts` if the viewer must work without it, and
   implemented in EMhub's `templates/project_widget_svc.html`.
2. **No host mutations.** Do not touch `<html>`, `<body>`, host stylesheets or
   un-prefixed localStorage keys. Theme = `dark` class on the emflow roots only
   (`context/ThemeContext.tsx`). localStorage keys start with `emflow:`.
3. **Stay inside `.emflow-root`.** All CSS is scoped by `postcss.config.js`.
   Anything rendered outside the container must go to the overlay root
   (`useOverlayRoot()`) or `#emflow-portal-root` (`PORTAL_ROOT_ID`), never
   `document.body`. MUI portals already default to the overlay root; a nested
   MUI theme must be created with `useEmflowMuiTheme()` to keep that.
4. **Use the constants.** `ROOT_CLASS` / `PORTAL_ROOT_ID` from
   `src/widget/constants.ts`, never literal class names or ids.
5. **One bundle, no extra files.** Workers are imported with `?worker&inline`,
   assets are inlined; EMhub only gets `emflow.js` and `emflow.css`.
6. **Contracts with EMhub are shared.** Changing a ProjectService method,
   the analyze decision or the table-viewer protocol requires the matching
   change in EMhub's `project_widget_svc*.html` (and the fake service in
   `dev/fakeService.js`).

## Workflow for changing or adding a component

1. Locate it in [references/components.md](references/components.md) and read
   its expected behavior and service calls.
2. Make the change; for new UI follow rules 1-5 (portals, theme, constants).
3. If the host contract changed, update `ProjectService.ts`,
   `normalizeService.ts`, `dev/fakeService.js` and EMhub's svc template, and
   document it in [references/service-contract.md](references/service-contract.md).
4. Verify:
   ```bash
   npm run typecheck
   npm run build
   npm run dev     # / (source) and /dev/umd.html (built bundle), fake project 43
   ```
   The dev pages wrap the viewer in Bootstrap 4 to reveal style collisions.
   Check the browser console and that overlays render styled.
5. `./build_and_copy.sh` copies the bundle into EMhub
   (`emhub/static/libs/{js,css}`); EMhub commits the built files.
6. **Update this skill** (the relevant reference file) in the same change:
   new component rows, changed behavior, new service methods. Bump
   `package.json` version for releases (shown in the Build info dialog).

## Syncing code from ScipionWeb

emflow keeps ScipionWeb's file layout under `src/`, so files can be compared
with `diff`. When porting changes: drop anything using `@/api/*`, adapters,
react-router, React Query or `document.body` portals; replace literal
`projectpage-widget-root` / `projectpage-portal-root` with the constants;
re-check the service contract (ScipionWeb has changed method names and
payloads before, e.g. `table-viewer-pane` -> `viewer: "table"`).
