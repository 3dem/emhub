# emflow components and expected behavior

Paths are relative to `src/`. "svc" = methods of the host ProjectService
(see [service-contract.md](service-contract.md)). Keep this file in sync with
the code: add a row when adding a component, update the behavior when it
changes.

## Entry and embedding (`index.tsx`, `widget/`, `context/`)

| File | Expected behavior |
| --- | --- |
| `index.tsx` | `mountProjectPage({container, service, projectName \| projectId, theme="auto", cssHref?})`: validates the container and project, normalizes the service, creates the shell and the overlay root, renders the provider tree + `ProjectPage` + `<Toaster>`, returns `{unmount, root}`. Unmounts by itself when the shell leaves the document or on page unload. Exposes `EMFlow.version`, `buildTimestamp`, `rootClass`. Logs `[emflow] ready ...` once. Errors inside the tree are shown by `WidgetErrorBoundary` (red `<pre>`), not thrown to the host. |
| `widget/shell.ts` | `createWidgetShell` (flex column `.emflow-root` + mount point), `ensureStylesheet` (one `<link id="emflow-css">`, skipped if already linked), `observeRemoval`. |
| `widget/overlay.tsx` | One overlay root per mount: `<div class="emflow-root emflow-overlays" style="display:contents">` on `<body>`. `useOverlayRoot()` returns it (fallback `document.body`). Sets MUI default `container` for Modal/Dialog/Popover/Popper. `useEmflowMuiTheme(options)` for nested MUI themes. |
| `widget/normalizeService.ts` | `normalizeServiceAPI(svc)`: maps alternative method names (e.g. `listProjects` -> `fetchList`) and adds defaults for optional methods (empty lists, `{handled:false}`, "not configured" errors for write operations). Retries tag/execute/save calls with the legacy argument order. |
| `widget/constants.ts` | `ROOT_CLASS = "emflow-root"`, `PORTAL_ROOT_ID = "emflow-portal-root"`. |
| `context/ThemeContext.tsx` | `ThemeProvider mode="auto"\|"light"\|"dark"`; auto follows `dark` class / `data-theme="dark"` on host `<html>`/`<body>` (MutationObserver). Applies `dark` only to the emflow roots. `useTheme()` -> `{theme, toggleTheme, setThemeMode}`. |
| `ProjectServiceContext.tsx` | `ProjectServiceProvider` / `useProjectService()` (throws outside the provider). |
| `buildInfo.ts` | Version and build time injected by `vite.config.ts` (`__EMFLOW_VERSION__`, `__EMFLOW_BUILD_TIMESTAMP__`). |

## Project page (`pages/Dashboard/projects/`)

`ProjectPage.tsx` (+ `ProjectPage.css`, the main stylesheet with Tailwind
imports and theme tokens) is the whole viewer. Prop: `projectName`.

Expected behavior:

- **Load**: `svc.fetchProject(projectName)` -> `{id, name, path, protocols: {id: ProtocolNode}}`
  (`PROJECT` is the root node). Also `fetchProjectEffectiveSettings` (optional),
  `getContextMenuVisibilityPolicy`, `listProjectTags`, `fetchWorkflows`.
- **Graph** (reactflow): nodes from `utils/graph_utils.ts` (`buildGraphElements`),
  edges parent -> child. View modes: tree top-bottom (`treeTb`, default),
  tree left-right (`treeLr`), grid, table. Minimap, fit view, focus mode
  (only the selected path), zoom controls. Node positions/viewport are
  stored in localStorage under `emflow:project-<name>-node-positions...`.
- **Auto refresh**: only while some protocol is active (running/launched/
  scheduled), every `workflowsAutoRefreshSec` (default 15 s from
  `config/settingsDefaults.ts`), refetching the project without rebuilding the
  graph. Elapsed-time counters tick locally.
- **Selection & shortcuts** (Cmd on macOS, Ctrl elsewhere): Space/Enter or
  double click open the protocol, Delete/Backspace delete, F2 annotate
  (rename/comment), Mod+D duplicate, Mod+B browse files, Mod+A select all,
  Mod+C / Mod+V copy / paste workflow, Mod+Shift+R restart all, Mod+Shift+C
  continue all, Mod+Shift+S stop, Alt+Down/Up select from/to.
- **Node menu** items (`types/protocol-node-menu-items.ts`): open, browse,
  rename, duplicate, copyWorkflow, pasteWorkflow, delete, restart, continue,
  reset, stop, selectFrom, selectTo, manageTags, export, upload, nextSteps.
  Visibility comes from `svc.getContextMenuVisibilityPolicy()`; hidden items
  must not be reachable by shortcut either.
- **Protocol panel**: opening a node (or a new protocol from the drawer)
  loads `svc.fetchProtocolDetails` / `fetchNewProtocolDetails` ->
  `{info, form, values}` and shows `ProtocolForm` docked on the right.
- **Search** box (finds protocols by name/label, arrows + Enter), **tags**
  filter (`TagPicker`), **Protocols** drawer, **Workflows** panel,
  **Build info** dialog (`emflow vX.Y.Z`, version, build time).
- Actions: `stopProtocol`, `deleteProtocol`, `duplicateProtocol`,
  `renameProtocol`, `restartAll`, `continueAll`, `resetFrom`,
  `exportWorkflowProtocols` / `importWorkflowProtocols`; results with
  `{status, errors, workflow}` update the graph.

## Protocol components (`components/protocol/`)

| File | Expected behavior | svc |
| --- | --- | --- |
| `ProtocolNodeCard.tsx` (+ `.module.css`, `ProtocolNodeCardWrapper.tsx`) | Graph node: id badge, label/run name, status color and badge, elapsed time, step progress bar, output list with eye icon (analyze), optional output thumbnails, tags chips, "..." dropdown and right-click context menu with the node menu items, export dialog, next-steps suggestions. Analyze: `resolveAnalyzeViewer(ctx)` with `ctx.value` = output value; `viewer:"table"` -> `TableViewerDialog`, external url -> open, otherwise `AnalyzeOutputDialog`. | `resolveAnalyzeViewer`, `listProjectTags`, `setProtocolTagIds`, `exportProtocols`, `getNextProtocolSuggestions`, file browser methods |
| `ProtocolForm.tsx` (+ `protocolform.module.css`) | Protocol editor: header (id, label, status, help `?`), tabs **Inputs and Parameters** (sections from `form`, sub-tabs), **Outputs**, **Logs**, **Metadata**; footer Close / Save / Launch with execute modes (`ExecuteModeButton`: launch, restart, schedule, from `info.executeMode`). Validates and shows `ValidationErrorsDialog` / `ExecErrorDialog`. Queue settings dialog when the host provides queues. Run name, comment, expert level. | `executeProtocol`, `saveProtocol`, `executeProtocolWorkflow`, `getProtocolWorkflowExecutionPreflight`, `resolveBrowserPaths`, `listRemoteDirectory`, `previewRemoteEntry`, `buildProtocolDownloadUrl` |
| `ParamRow.tsx`, `MultiParamRow.tsx`, `TableParamRow.tsx`, `ProtocolFormRenderers.tsx` | One parameter row by param class: string/int/float, boolean switch, enum (radio/select), path (with file browser), pointer (input selection via `outputSelectorDialog`, drag & drop from outputs with `WrapWithDrop` / `DragContext`), multi-pointer and table params. Help icon (`HelpText`), wizard button when the param has wizard metadata. `utils/protocolform.*` hold state, validation and ProtUnion helpers. | - |
| `ProtocolOutputsPanel.tsx` | Outputs tab: list of outputs, preview (`fetchOutputPreview`), "Analyze results" -> same decision logic as the node card (ctx has `outputRaw`). | `fetchOutputPreview`, `resolveAnalyzeViewer` |
| `ProtocolLogsPanel.tsx` + `hooks/useProtocolLogs.ts` | Logs tab: one tab per channel from `fetchProtocolLogChannels`; polls `fetchProtocolLogsChunk(projectId, protocolId, offsets)` incrementally (offset per channel), appends text, honours `resetOffset`/`truncated`. | `fetchProtocolLogChannels`, `fetchProtocolLogsChunk` |
| `ProtocolMetadataPanel.tsx`, `JsonTree.tsx` | Metadata tab: JSON tree of the protocol info with copy. | - |
| `ProtocolsDrawer.tsx` (+ `protocoltree.module.css`, `ProtocolTree.tsx`) | Right drawer (portaled to the overlay root, bounded to the widget) with the protocol catalog tree (`loadProtocols`), package selector, search, NEW/BETA/UPDATED badges, help. Double click creates a new protocol. | `loadProtocols` |
| `ProtocolHelpDialog.tsx` | Protocol help text. | - |
| `ProtocolStepsDeveloperDialog.tsx` | Developer view of protocol steps, change step status. | `fetchProtocolSteps`, `updateProtocolStepStatus` |
| `WizardDialogs.tsx`, `wizards/*` | Parameter wizards (`use_protocol_wizards.ts` runs `executeProtocolWizard`): option/input dialogs, CTF, downsample, filter previews, mask radius/radii, point in volume (three.js / react-three-fiber), loading dialog, `wizard-dialog-host.tsx`. | `executeProtocolWizard`, `resolveBackendUrl` |

## Output viewers (`components/analyze/`)

Routing (`analyze-output-dialog.tsx`, used when the host does not handle the
output): tomography classes (coordinates 3D, tilt series, CTF tomo series,
tomograms) -> `IntegratedTomographyViewer`; volumes -> `VolumeViewer`;
2D coordinates -> `Coords2dViewer`; FSCs -> `FscViewer`; other `SetOf*` ->
`MetadataViewer`; else an "unsupported" message. These viewers use the
Scipion-style svc methods (listOutput*, fetch*), which EMhub mostly does not
implement, so in EMhub most outputs are handled by `resolveAnalyzeViewer`
(table viewer or external page).

| File | Expected behavior | svc |
| --- | --- | --- |
| `table-viewer-dialog.tsx`, `table-viewer-pane.tsx` | Host-driven table: search, rows/columns from `decision.table`, column and row actions (click a cell / action buttons; actions with a known `icon` are icon buttons, see `table-viewer-action-icons.tsx`), right pane with the action result, boolean edit cells (checkboxes, cascade to children) with Reset and edit-action buttons (`requiresChanges` disables them until something changed), expandable child rows. Action id `metadata` is reserved: it opens `MetadataViewer` locally instead of calling the host. | `resolveTableViewerAction`, `executeTableViewerEditAction`, `resolveTableViewerChildren` |
| `table-viewer-grid.tsx` | Pane content `grid`: up to 4 action results in a 2 x 2 CSS grid, a cell may span two columns or rows (layouts `2x2`, `cols`, `rows`, `span-top/bottom/left/right`). Each cell has a header with the content title and renders the generic content (sliders fitted) or an `empty` message. | - (content comes from `resolveTableViewerAction`) |
| `table-viewer-generic-content.tsx`, `table-viewer-image-slider.tsx` | Pane contents: `text`, `html`, `iframe`, `image`, `plotly`, `imageSlider` (slices per axis); `coords3d`, `tiltSeries`, `volume`, `ctfTomo` open the matching viewers. | - |
| `integrated-tomography-viewer.tsx` | Tabs linking tilt series, CTF, tomogram and 3D coordinates of one item. | `fetchIntegratedAnalyzeContext` |
| `tiltseries-viewer.tsx` | Tilt series list, frames gallery, exclude views, create new set / re-stacked set. | `listOutputTiltSeries`, `fetchTiltSeriesFrames`, `fetchTiltSeriesViewImageObjectUrl`, `createNewSetOfTiltSeries` |
| `ctftomo-viewer.tsx` | CTF per view: plots (Plotly), PSD images, exclude, create new set. | `listOutputCTFTomoSeries`, `fetchCTFTomoSeriesViews`, `fetchCTFPsdImage`, `createNewSetOfCTFTomoSeries` |
| `volume-viewer.tsx`, `gpu-volume-view.tsx`, `mesh-volume-view.tsx`, `volume-axis-schematic.tsx`, `use-volume-regions.ts` (+ inlined `volume-region-worker.ts`), `volume-color-utils.ts` | Slices per axis, histogram/contrast, colormaps, 3D GPU rendering and iso-surface mesh (three.js), connected regions computed in a web worker. | `listOutputVolumes`, `getVolumeInfo`, `getVolumeHistogram`, `fetchVolumeSliceObjectUrl`, `getVolumeData`, `getVolumeSurfaceMesh` |
| `coords3d-viewer.tsx` | Tomogram slices with 3D coordinates, point editing, create output from points. | `listCoords3dTomograms`, `fetchCoords3dForTomogram`, `fetchCoords3dTomogramSliceObjectUrl`, `createCoords3dOutputFromPoints` |
| `coords2d-viewer.tsx` | Micrographs with 2D coordinates, thumbnails, picking edits, create output from current coordinates. | `listCoords2dMicrographs`, `fetchCoords2dForMicrograph`, `fetchCoords2dMicrographImageObjectUrl`, `fetchCoords2dMicrographThumbnailObjectUrl`, `createCoords2dOutputFromCurrentCoordinates` |
| `metadata-viewer.tsx`, `metadata-plotter-dialog.tsx` | Paged metadata tables (gallery/table, image cells, sort, actions such as subsets) and plots of columns (recharts). | `fetchOutputMetadataTables`, `fetchMetadataTableSchema`, `fetchMetadataTableWindow`, `fetchMetadataImageCellObjectUrl`, `runMetadataTableAction` |
| `fsc-viewer.tsx` | FSC curves, export. | `fetchFscRows` |
| `ExternalViewersBar.tsx` | Buttons to launch external viewers. | `listExternalViewers`, `launchExternalViewer` |

## Other components

| File | Expected behavior | svc |
| --- | --- | --- |
| `components/projects/workflows-panel.tsx` | Lists predefined workflows (`fetchWorkflows` result), search, load one into the project. | `loadWorkflow` |
| `components/tags/TagManager.tsx`, `TagPicker.tsx`, `TagsDialog.tsx`, `stores/tag_store.ts` | Project tags (title, color, description): create/edit/delete, assign to protocols, filter the graph by tags. | `listProjectTags`, `createProjectTag`, `updateProjectTag`, `deleteProjectTag`, `listProtocolTagIds`, `setProtocolTagIds` |
| `components/files/RemoteFileDialog.tsx` | File browser rooted at `resolveBrowserPaths` (`rootAbs`, `startPath`), directory listing, preview (text/json/table/image/none kinds), save-as mode for exports. Portals into `#emflow-portal-root`. | `resolveBrowserPaths`, `listRemoteDirectory`, `previewRemoteEntry` |
| `components/ui/*` | shadcn-style primitives: `button` (cva variants), `dialog` (Radix, portal to `#emflow-portal-root`), `dropdown-menu`, `context-menu`, `overflow-tooltip-text`. | - |
| `lib/utils.ts`, `lib/plot.ts` | `cn()` (clsx + tailwind-merge); Plotly component bound to `plotly.js-dist-min`. | - |
| `icons/index.ts` | Only the SVG icons in use, as React components (svgr). Add the SVG + export when needed. | - |
