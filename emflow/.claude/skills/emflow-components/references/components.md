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
- **Graph layouts** (`utils/graph_layout/`): the tree node placement is a
  named layout, `GRAPH_LAYOUTS` in `index.ts` (`(GraphLayoutParams) =>
  positions`, shared size helpers in `common.ts`): `current` (`current.ts`,
  subtree-aligned with collision passes) and `ylevel` (the default,
  `ylevel.ts`, Scipion's `LevelTreeLayout`: one layout parent per node,
  subtrees packed by their per-level contours and centered under the parent).
  Chosen per direction with the page URL arguments `wtb=<name>` (top-bottom)
  and `wlr=<name>` (left-right); unknown names warn and fall back to
  `ylevel`. Saved positions use the key suffix `-hier-<name>`, except
  `current`, which keeps the old `-hier` key. ProjectPage still centers
  `PROJECT` over the whole graph afterwards, whatever the layout.
  Levels (`buildGraphElements`) are the longest path from `PROJECT`, computed
  in one topological pass (nodes in a cycle go one level below their deepest
  parent). After a duplicate, paste or add from the form (`pendingNewNodesRef`)
  with `ylevel`, `placePendingNewNodesWithYLevel` applies the whole layout
  again if no node was moved by hand (no manual origins); otherwise existing
  nodes keep their positions and only the new ones are placed, at their
  layout offset from their closest placed parent and shifted sideways out of
  overlaps (the manual origins are kept for the new topology). The `current`
  layout keeps its own placement (`placePendingNewNodesAtCanonicalTbPositions`,
  `tryResolveNewNodesCollisions`).
- **Auto refresh**: only while some protocol is active (running/launched/
  scheduled), every `workflowsAutoRefreshSec` (default 15 s from
  `config/settingsDefaults.ts`), refetching the project without rebuilding the
  graph. Elapsed-time counters tick locally only for running protocols
  (launched ones are waiting); a new `elapsedSessionId` (a new run) restarts
  the counter from the host value.
- **Selection & shortcuts** (Cmd on macOS, Ctrl elsewhere): Space/Enter or
  double click open the protocol, Delete/Backspace delete, F2 annotate
  (rename/comment), Mod+D duplicate, Mod+B browse files, Mod+A select all,
  Mod+C / Mod+V copy / paste workflow, Mod+Shift+R restart all, Mod+Shift+C
  continue all, Mod+Shift+S stop, Alt+Down/Up select from/to.
- **Node menu** items (`types/protocol-node-menu-items.ts`): open, browse,
  rename, duplicate, copyWorkflow, pasteWorkflow, delete, restart, continue,
  reset, stop, selectFrom, selectTo, collapse, manageTags, export, upload,
  nextSteps. Visibility comes from `svc.getContextMenuVisibilityPolicy()`
  (`collapse` is shown unless `false`); hidden items must not be reachable by
  shortcut either.
- **Collapsed groups** (tree views only): "Collapse" (jobs with children,
  `data.canCollapse`) hides the subtree of a job, the jobs of "Select from".
  `collapseProtocols` (`graph_utils.ts`) removes them at the start of the
  hierarchical `buildGraphElements` (option `collapsed`), before levels and
  layout: the root keeps its id, gets `collapsedCount` (jobs in the group) and
  as children the other group nodes its jobs feed; edges into hidden jobs
  go to the group node that shows them. It is drawn by
  `CollapsedGroupNodeCard` (same size, darker green, id pill with the
  title/comment tooltip, an "N jobs" row); its only action is expand
  (double-click or the [ ] button): no menu, and shortcuts are ignored while
  a group is selected. Jobs already in a group are left out of a new one:
  if the new root is an ancestor of the other group's root, that group is
  nested (hidden with it, shown again still collapsed on expand,
  `collapsedCount` includes its jobs); otherwise the two groups stay
  separate, with an edge from one group node to the other when its jobs feed
  the other's. Groups take their jobs in collapse order (nested ones first),
  so expanding a group can give its shared jobs to a separate group. Collapse and
  expand keep that node at the same place on screen (the viewport is shifted
  by its position change).
  Collapsed roots are saved in localStorage (`emflow:project-<name>-collapsed`)
  and the node positions are saved per collapse state (the topology signature
  includes the collapsed roots), so hand-moved positions are not kept across
  collapse/expand. Grid and table views show all jobs.
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
| `ProtocolNodeCard.tsx` (+ `.module.css`, `ProtocolNodeCardWrapper.tsx`) | Graph node: header = job id pill (never wraps) + annotation title (`runName`, truncated or hidden first); hovering the id pill shows job type (`label`), annotation title and message (`comment`). Status color and badge (no step progress), elapsed time (total of all runs; hovering it shows each of `elapsedRuns` with its launch time and time in the queue, the running one live, and the pending `launched` with its `queued` time). Output list holds 3 rows without scrolling; with 4+ outputs the 3rd row is "More" (`...` icon), which toggles an all-outputs card: an extra React Flow node (`<id>::outputs`, `data.outputsCard`, z-index 1000, not selectable/draggable) that ProjectPage appends in `renderNodes` right of the protocol node from `outputsCardIds` (node action `onToggleOutputsCard`). The card node carries `nopan` (React Flow only adds it to draggable nodes) and its measured size (`outputsCardSizes`, from the dimension changes `handleNodesChangeWithPersistence` intercepts), otherwise React Flow keeps re-hiding it and presses fall through to the pane. ProtocolNodeCard renders it in "outputs" mode, so it pans/zooms with the graph, stays below viewer dialogs, its rows drag into form inputs and its eye opens the same viewers; closes with X, Esc or "More", and ProjectPage ignores clicks/double clicks on it. Eye icon (analyze), optional output thumbnails (tile mode keeps showing all outputs), tags chips, "..." dropdown and right-click context menu with the node menu items, export dialog, next-steps suggestions. Analyze: `resolveAnalyzeViewer(ctx)` with `ctx.value` = output value; `viewer:"table"` -> `TableViewerDialog`, external url -> open, otherwise `AnalyzeOutputDialog`. | `resolveAnalyzeViewer`, `listProjectTags`, `setProtocolTagIds`, `exportProtocols`, `getNextProtocolSuggestions`, file browser methods |
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
| `table-viewer-dialog.tsx`, `table-viewer-pane.tsx` | Host-driven table: search, rows/columns from `decision.table`, column and row actions (click a cell / action buttons; actions with a known `icon` are icon buttons, see `table-viewer-action-icons.tsx`), right pane with the action result (a "Loading..." spinner over it while an action resolves; only the last clicked action updates the pane; generic content is rendered with `fit`, so sliders and plots fit the pane without scrolling), every header and cell aligned left (`column.align` is ignored), columns with `sortable: true` get a sort arrow in the header (click toggles ascending/descending; sorts the loaded rows, numbers by value and text in natural order, empty cells last), boolean edit cells (checkboxes, cascade to children; right-clicking a row opens `table-viewer-selection-menu.tsx` for the first boolean edit column: Select / Deselect All, to Here, from Here and Invert Selection, over the rows as shown after search and sort, as draft edits) with Reset and edit-action buttons (`requiresChanges` disables them until something changed; a result with `refreshProject` refreshes the project page through `useProjectRefresh`), expandable child rows. Action id `metadata` is reserved: it opens `MetadataViewer` locally instead of calling the host. | `resolveTableViewerAction`, `executeTableViewerEditAction`, `resolveTableViewerChildren` |
| `table-viewer-grid.tsx` | Pane content `grid`: up to 4 action results in a 2 x 2 CSS grid, a cell may span two columns or rows (layouts `2x2`, `cols`, `rows`, `span-top/bottom/left/right`). Each cell has a header with the content title and an expand/collapse button (the cell takes the whole grid), and renders the generic content (sliders fitted) or an `empty` message. `TableViewerPane` keeps the expanded slot, so it stays expanded when another row loads a grid; a slot missing from the new layout shows the whole grid. | - (content comes from `resolveTableViewerAction`) |
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
