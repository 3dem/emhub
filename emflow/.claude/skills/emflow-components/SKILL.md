---
name: emflow-components
description: Reference for emflow, the React components embedded in EMhub (the project page, VolumeViewer, Plot, table viewer panes) - its components and naming convention, the mount API (EMFlow.mount), the DataLoader used to fetch data, the ProjectService contract with the host, output/analyze viewer routing, the table viewer protocol, Plotly shared with EMhub, style isolation and embedding rules. Use when changing, debugging or adding components in emflow (src/components, ProjectPage, widget/, data/), when mounting an emflow component from EMhub html/js, when an output viewer or protocol form misbehaves in EMhub, or when changing EMhub's project_widget_svc*.html. Keep this skill updated in the same change as the components.
---

# emflow components

emflow is a frontend-only set of React components compiled to a UMD bundle
(`dist/emflow.js` + `dist/emflow.css`, global `EMFlow`) that EMhub loads on
every page (`templates/main_javascript.html`). It started as ScipionWeb's
project-page widget; the Scipion-only viewers were removed and it no longer
tracks ScipionWeb. Data comes from the host: the project page through the
`service` object (ProjectService), the other components through a
`DataLoader` whose transport the host chooses.

Read the reference that matches the task:

- [references/components.md](references/components.md): every component,
  what it renders, its expected behavior and the data it uses.
- [references/service-contract.md](references/service-contract.md): the
  ProjectService methods (who calls them, required vs optional, defaults),
  the analyze-viewer decision and the table-viewer protocol, and how EMhub
  implements them.
- [references/embedding.md](references/embedding.md): the mount API, the
  DataLoader, overlays and portals, theme, CSS isolation rules, Plotly and
  how EMhub loads the bundle.

## Architecture in one picture

```
EMhub page (main_javascript.html loads emflow.css + emflow.js once)
  EMFlow.mount("VolumeViewer" | "Plot" | "TableViewerContent" | ..., {container, props, loader})
  project_widget_*.html -> EMFlow.mountProjectPage({container, service: svc, projectName})
  emhub_charts.js, OTF dashboard -> window.Plotly (the plotly.js bundled in emflow)
        |
src/index.tsx      registry of mountable components, mount(), mountProjectPage()
  widget/mount.tsx mountComponent(): per mount
      .emflow-root shell (widget/shell.ts) + overlay root on <body> (widget/overlay.tsx)
      CacheProvider(emotion "emflow") -> ThemeProvider -> OverlayRootProvider
        -> DataLoaderProvider (data/) -> [ProjectServiceProvider] -> error boundary
          -> the component, props from a store (update()), ref = handle.instance
  ProjectPage: + DragProvider, <Toaster/>; graph, ProtocolForm, ProtocolsDrawer,
      output viewers: TableViewerDialog -> TableViewerPane -> TableViewerContent
                      (ImageSlider -> VolumeViewer, Plot, text, html, grid ...)
```

## Naming convention

- `src/components/<area>/`: lowercase feature area (`protocol`, `viewers`,
  `tags`, `files`, `projects`, `ui`, `form`); `viewers/volume/` holds the
  parts of VolumeViewer.
- Component files are PascalCase and named after the component they export
  (`TableViewerPane.tsx` exports `TableViewerPane`); helpers of a component
  start with its name (`TableViewerGrid`, `TableViewerSelectionMenu`).
- CSS modules sit beside the component: `<Component>.module.css`; plain
  shared CSS of an area is `<area>.css` (`tags/tags.css`).
- Hooks are `useXxx.ts`; other modules camelCase (`volumeMath.ts`).
- Mountable components are registered in `src/index.tsx` (`COMPONENTS`)
  under their component name: `EMFlow.mount("VolumeViewer", ...)`.

## Rules that must hold (check them on every change)

1. **Network access only through the DataLoader** (`src/data/DataLoader.ts`)
   or the ProjectService. Never call `fetch`/axios elsewhere and never hard
   code EMhub urls: the host gives paths and the transport
   (`DataLoader.emhub()` posts `{attrs}` like `send_ajax_json`). Project-page
   data needs an (optional) ProjectService method, declared in
   `src/services/ProjectService.ts`, with a default in
   `src/widget/normalizeService.ts`, implemented in EMhub's
   `templates/project_widget_svc.html`.
2. **No host mutations.** Do not touch `<html>`, `<body>`, host stylesheets or
   un-prefixed localStorage keys. Theme = `dark` class on the emflow roots only
   (`context/ThemeContext.tsx`). localStorage keys start with `emflow:`.
   The one exception: `window.Plotly` is set to the bundled plotly.js when the
   page has none (EMhub's charts use it).
3. **Stay inside `.emflow-root`.** All CSS is scoped by `postcss.config.js`.
   Anything rendered outside the container must go to the overlay root
   (`useOverlayRoot()`) or `#emflow-portal-root` (`PORTAL_ROOT_ID`), never
   `document.body`. MUI portals already default to the overlay root; a nested
   MUI theme must be created with `useEmflowMuiTheme()` to keep that.
   Components mounted on their own (VolumeViewer, Plot...) must not use the
   Radix dialogs of `components/ui` (only ProjectPage renders their portal root).
4. **Use the constants.** `ROOT_CLASS` / `PORTAL_ROOT_ID` from
   `src/widget/constants.ts`, never literal class names or ids.
5. **One bundle, two files.** Workers are imported with `?worker&inline`,
   assets are inlined, three.js and plotly.js are bundled; EMhub only gets
   `emflow.js` and `emflow.css`.
6. **Contracts with EMhub are shared.** Changing a ProjectService method,
   the analyze decision, the table-viewer protocol or the props of a
   mountable component requires the matching change in EMhub
   (`project_widget_svc*.html`, the templates that call `EMFlow.mount`) and in
   the dev pages (`dev/fakeService.js`, `dev/components.html`).

## Workflow for changing or adding a component

1. Locate it in [references/components.md](references/components.md) and read
   its expected behavior and data.
2. Make the change; for new UI follow rules 1-5 (data, portals, theme,
   constants) and the naming convention. A component the host should mount:
   add it to `COMPONENTS` in `src/index.tsx`; give it `forwardRef` if the host
   needs an imperative API (`handle.instance`).
3. If the host contract changed, update `ProjectService.ts`,
   `normalizeService.ts`, the dev pages and EMhub, and document it in
   [references/service-contract.md](references/service-contract.md) or
   [references/embedding.md](references/embedding.md).
4. Verify:
   ```bash
   npm run typecheck
   npm run build
   npm run dev     # / (source, fake project 43), /dev/umd.html (built bundle),
                   # /dev/components.html (EMFlow.mount of the viewers, built bundle)
   ```
   The dev pages wrap the components in Bootstrap 4 to reveal style
   collisions. Check the browser console and that overlays render styled.
5. `./build_and_copy.sh` copies the bundle into EMhub
   (`emhub/static/libs/{js,css}`); EMhub commits the built files.
6. **Update this skill** (the relevant reference file) in the same change:
   new component rows, changed behavior, new service methods. Bump
   `package.json` version for releases (shown in the Build info dialog).
