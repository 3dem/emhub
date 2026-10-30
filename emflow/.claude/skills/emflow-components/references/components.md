# emflow components and expected behavior

Paths are relative to `src/`. "svc" = methods of the host ProjectService
(see [service-contract.md](service-contract.md)). Keep this file in sync with
the code: add a row when adding a component, update the behavior when it
changes.

## Entry and embedding (`index.tsx`, `widget/`, `data/`, `context/`)

| File | Expected behavior |
| --- | --- |
| `index.tsx` | Library entry. `COMPONENTS` registry (`ProjectPage`, `VolumeViewer`, `Plot`, `ImageSlider`, `TableViewerContent`), `mount(name, options)`, `mountProjectPage({container, service, projectName \| projectId, theme, cssHref?})` (= `mount("ProjectPage")` with `props: {projectName}`), `components` (the names), `DataLoader`, `Plotly`, `version`, `buildTimestamp`, `rootClass`. Sets `window.Plotly` to the bundled plotly.js if the page has none. Logs `[emflow] ready ...` once. |
| `widget/mount.tsx` | `mountComponent(entry, {container, props, theme="auto", cssHref?, fill?, loader?, service?})`: shell + overlay root + emotion cache + ThemeProvider + OverlayRootProvider + DataLoaderProvider (+ ProjectServiceProvider when `service` is given) + error boundary (red `<pre>`, never thrown to the host). Returns `{update(patch), props, instance, unmount, root}`: props live in a store (`update` re-renders without a new root); `instance` is the ref of a `forwardRef` component (its imperative API). Unmounts by itself when the shell leaves the document (e.g. jQuery `.html()`) or on page unload. |
| `widget/shell.ts` | `createWidgetShell(target, {fill})` (`.emflow-root` + mount point; `fill`: 100% of the target height, else the content height), `ensureStylesheet` (one `<link id="emflow-css">`, skipped if already linked), `observeRemoval`. |
| `widget/overlay.tsx` | One overlay root per mount: `<div class="emflow-root emflow-overlays" style="display:contents">` on `<body>`. `useOverlayRoot()` returns it (fallback `document.body`). Sets MUI default `container` for Modal/Dialog/Popover/Popper. `useEmflowMuiTheme(options)` for nested MUI themes. |
| `widget/normalizeService.ts` | `normalizeServiceAPI(svc)`: maps alternative method names (e.g. `listProjects` -> `fetchList`) and adds defaults for optional methods (empty lists, `{handled:false}`, "not configured" errors for write operations). Retries tag/execute/save calls with the legacy argument order. |
| `widget/constants.ts` | `ROOT_CLASS = "emflow-root"`, `PORTAL_ROOT_ID = "emflow-portal-root"`. |
| `data/DataLoader.ts` | `DataLoader`: `load(path, payload, {key?, cache?, signal?})` (LRU cache by path + payload, one request shared while in flight, failed requests not cached), `image(src)` (decoded `<img>` for a url or base64 PNG, cached), `invalidate(prefix?)`. Transport from the options: `request(path, payload, {signal})` from the host, or `fetch` POST JSON to `baseUrl + path` with `wrapPayload` / `unwrapResponse`. `DataLoader.emhub()`: `{attrs: payload}` body and the response `error` thrown. `toDataLoader(loader \| options)`. |
| `data/DataLoaderContext.tsx` | `DataLoaderProvider`, `useDataLoader()` (shared default outside a mount), `useLoad(path, payload)` -> `{status: idle\|loading\|ready\|error, data, error}` (stale responses ignored). |
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
| `ProtocolNodeCard.tsx` (+ `.module.css`, `ProtocolNodeCardWrapper.tsx`) | Graph node: header = job id pill (never wraps) + annotation title (`runName`, truncated or hidden first); hovering the id pill shows job type (`label`), annotation title and message (`comment`). Status color and badge (no step progress), elapsed time (total of all runs; hovering it shows each of `elapsedRuns` with its launch time and time in the queue, the running one live, and the pending `launched` with its `queued` time). Output list holds 3 rows without scrolling; with 4+ outputs the 3rd row is "More" (`...` icon), which toggles an all-outputs card: an extra React Flow node (`<id>::outputs`, `data.outputsCard`, z-index 1000, not selectable/draggable) that ProjectPage appends in `renderNodes` right of the protocol node from `outputsCardIds` (node action `onToggleOutputsCard`). The card node carries `nopan` (React Flow only adds it to draggable nodes) and its measured size (`outputsCardSizes`, from the dimension changes `handleNodesChangeWithPersistence` intercepts), otherwise React Flow keeps re-hiding it and presses fall through to the pane. ProtocolNodeCard renders it in "outputs" mode, so it pans/zooms with the graph, stays below viewer dialogs, its rows drag into form inputs and its eye opens the same viewers; closes with X, Esc or "More", and ProjectPage ignores clicks/double clicks on it. Eye icon (analyze), optional output thumbnails (tile mode keeps showing all outputs), tags chips, "..." dropdown and right-click context menu with the node menu items, export dialog, next-steps suggestions. Analyze: `resolveAnalyzeViewer(ctx)` with `ctx.value` = output value; `viewer:"table"` -> `TableViewerDialog`, external url -> open, `{handled:false}` -> a "There is no viewer for this output" toast. | `resolveAnalyzeViewer`, `listProjectTags`, `setProtocolTagIds`, `exportProtocols`, `getNextProtocolSuggestions`, file browser methods |
| `ProtocolForm.tsx` (+ `ProtocolForm.module.css`) | Protocol editor: header (id, label, status, help `?`), tabs **Inputs and Parameters** (sections from `form`, sub-tabs), **Outputs**, **Logs**, **Metadata**; footer Close / Save / Launch with execute modes (`ExecuteModeButton`: launch, restart, schedule, from `info.executeMode`). Validates and shows `ValidationErrorsDialog` / `ExecErrorDialog`. Queue settings dialog when the host provides queues. Run name, comment, expert level. | `executeProtocol`, `saveProtocol`, `executeProtocolWorkflow`, `getProtocolWorkflowExecutionPreflight`, `resolveBrowserPaths`, `listRemoteDirectory`, `previewRemoteEntry`, `buildProtocolDownloadUrl` |
| `ParamRow.tsx`, `MultiParamRow.tsx`, `TableParamRow.tsx`, `ProtocolFormRenderers.tsx` | One parameter row by param class: string/int/float, boolean switch, enum (radio/select), path (with file browser), pointer (input selection via `OutputSelectorDialog`, drag & drop from outputs with `WrapWithDrop` / `DragContext`), multi-pointer and table params. Help icon (`HelpText`) (the Scipion parameter wizards were removed). `utils/protocolform.*` hold state, validation and ProtUnion helpers. | - |
| `ProtocolOutputsPanel.tsx` | Outputs tab: list of outputs, preview (`fetchOutputPreview`), "Analyze results" -> same decision logic as the node card (ctx has `outputRaw`), a toast when not handled. | `fetchOutputPreview`, `resolveAnalyzeViewer` |
| `ProtocolLogsPanel.tsx` + `hooks/useProtocolLogs.ts` | Logs tab: one tab per channel from `fetchProtocolLogChannels`; polls `fetchProtocolLogsChunk(projectId, protocolId, offsets)` incrementally (offset per channel), appends text, honours `resetOffset`/`truncated`. | `fetchProtocolLogChannels`, `fetchProtocolLogsChunk` |
| `ProtocolMetadataPanel.tsx`, `JsonTree.tsx` | Metadata tab: JSON tree of the protocol info with copy. | - |
| `ProtocolsDrawer.tsx` (+ `ProtocolsDrawer.module.css`, `ProtocolTree.tsx` + `ProtocolTree.module.css`) | Right drawer (portaled to the overlay root, bounded to the widget) with the protocol catalog tree (`loadProtocols`), package selector, search, NEW/BETA/UPDATED badges, help. Double click creates a new protocol. | `loadProtocols` |
| `ProtocolHelpDialog.tsx` | Protocol help text. | - |

## Viewers (`components/viewers/`)

The project page opens outputs through the host decision
(`resolveAnalyzeViewer`): a table viewer, an external page, or a toast when
the host does not handle the output. The Scipion viewers (metadata, FSC,
tilt series, CTF tomo, coordinates 2D/3D, integrated tomography, GPU volume)
were removed with their ProjectService methods.

| File | Expected behavior | Data |
| --- | --- | --- |
| `TableViewerDialog.tsx`, `TableViewerPane.tsx` | Host-driven table: search, rows/columns from `decision.table`, column and row actions (click a cell / action buttons; actions with a known `icon` are icon buttons, see `TableViewerActionIcons.tsx`), right pane with the action result (a "Loading..." spinner over it while an action resolves; only the last clicked action updates the pane; content is rendered with `fit`, so sliders and plots fit the pane without scrolling), every header and cell aligned left (`column.align` is ignored), columns with `sortable: true` get a sort arrow in the header (click toggles ascending/descending; sorts the loaded rows, numbers by value and text in natural order, empty cells last), boolean edit cells (checkboxes, cascade to children; right-clicking a row opens `TableViewerSelectionMenu.tsx` for the first boolean edit column: Select / Deselect All, to Here, from Here and Invert Selection, over the rows as shown after search and sort, as draft edits) with Reset and edit-action buttons (`requiresChanges` disables them until something changed; a result with `refreshProject` refreshes the project page through `useProjectRefresh`), expandable child rows. Every action goes to the host (no reserved ids). | `resolveTableViewerAction`, `executeTableViewerEditAction`, `resolveTableViewerChildren` |
| `TableViewerGrid.tsx` | Pane content `grid`: up to 4 action results in a 2 x 2 CSS grid, a cell may span two columns or rows (layouts `2x2`, `cols`, `rows`, `span-top/bottom/left/right`). Each cell has a header with the content title and an expand/collapse button (the cell takes the whole grid), and renders the content (sliders fitted) or an `empty` message. `TableViewerPane` keeps the expanded slot, so it stays expanded when another row loads a grid; a slot missing from the new layout shows the whole grid. | - (content comes from `resolveTableViewerAction`) |
| `TableViewerContent.tsx` | Pane contents `text`, `html`, `iframe`, `image`, `plotly` (string titles normalized to `{text}`), `imageSlider`. Mountable (`TableViewerContent`, prop `content`), so a host page can render any pane it got from the same endpoint. | - |
| `ImageSlider.tsx` | `imageSlider` pane: one slider per axis (slices keyed by number, `sliderPrefix`, `sliceLabelOffset`, particles on Z), or with `layout: "volume"` (or X, Y and Z axes) the `VolumeViewer` (`height="fill"`, the pane `viewerConfig` spread into its props). Mountable (`ImageSlider`, prop `content`). | - |
| `VolumeViewer.tsx` (+ `VolumeViewer.module.css`, `volume/VolumeSlices.tsx`, `volume/VolumeScene3D.ts`, `volume/volumeMath.ts`) | Volume/tomogram viewer, mountable (`VolumeViewer`). Data: `data` (`{dimensions, axes: {x,y,z: {slice: base64}}, voxelSize, coordinates}`, or a pane / `{paneContent}`, see `volumeDataFromPane`) or `source: {path, payload}` loaded with the DataLoader. Config props: `tabs {slices, view3d}`, `tools {select, ruler, zoom, pan, particles: "auto", volume, invert, lines}`, `initialTool`, `viewSize` (520), `particleTolerance` (10); `info`, `height: "window"` (fit the room below it in the window) \| `"fill"` (the container height), `onSelect({x,y,z})`. **Slices** tab (IMOD-like: Y above Z, X on its right, same scale; sections stretched over their voxel extent, so screen -> voxel stays exact with downsampled images): sliders, crosshair lines, select (moves the position), ruler (Å when the voxel size is known), zoom (drag a rectangle, kept to the view aspect), pan, invert, hide lines, particles (slab of ±tolerance, prev/next, click to select), undo button (zoom, ruler, invert and lines are steps; with nothing left it deactivates the tool). **3D** tab (three.js, on demand rendering): planes textured with the current slices (at most two shown, with sliders), box, position marker, particles as points or the picking template (`coordinates.template`, RELION angles) at each particle, faint ray-marched volume from the Z slices with opacity, invert, pan / trackball / wheel, click to select. Output bar below (one thing at a time: ruler length, particle, position + Å/voxel), as wide as the visible pane. Full screen (Fullscreen API, fixed overlay fallback, Esc). Images decoded once through the DataLoader. Handle (`instance`): `getPosition()`, `setPosition(p)`, `setTool(t)`. Fits its container with a ResizeObserver; dark mode from the theme tokens. | DataLoader (`source`, `image`) |
| `Plot.tsx` | A Plotly figure (`data`, `layout`, `config`) or `source` loaded with the DataLoader (`{figure}` or the figure), `height` (360), events `onClick`, `onHover`, `onUnhover`, `onSelected`, `onRelayout`. String titles (layout and axes) become `{text}` (`normalizeTitles`, plotly.js 3 drops strings). Mountable (`Plot`). | DataLoader (`source`) |
| `TableViewerActionIcons.tsx` | The icons of action buttons (`tilt-series`, `tomogram`). | - |

## Other components

| File | Expected behavior | svc |
| --- | --- | --- |
| `components/projects/ProjectWorkflowsPanel.tsx` (+ `.module.css`) | Lists predefined workflows (`fetchWorkflows` result), search, load one into the project. | `loadWorkflow` |
| `components/tags/TagManager.tsx`, `TagPicker.tsx`, `TagsDialog.tsx`, `stores/tag_store.ts` | Project tags (title, color, description): create/edit/delete, assign to protocols, filter the graph by tags. | `listProjectTags`, `createProjectTag`, `updateProjectTag`, `deleteProjectTag`, `listProtocolTagIds`, `setProtocolTagIds` |
| `components/files/RemoteFileDialog.tsx` | File browser rooted at `resolveBrowserPaths` (`rootAbs`, `startPath`), directory listing, preview (text/json/table/image/none kinds), save-as mode for exports. Portals into `#emflow-portal-root`. | `resolveBrowserPaths`, `listRemoteDirectory`, `previewRemoteEntry` |
| `components/ui/*` | shadcn-style primitives: `Button` (cva variants), `Dialog` (Radix, portal to `#emflow-portal-root`), `DropdownMenu`, `ContextMenu`, `OverflowTooltipText`. | - |
| `lib/utils.ts`, `lib/plot.ts` | `cn()` (clsx + tailwind-merge); Plotly component bound to `plotly.js-dist-min` (3.x), and `Plotly` itself (exported as `EMFlow.Plotly`, `window.Plotly`). | - |
| `icons/index.ts` | Only the SVG icons in use, as React components (svgr). Add the SVG + export when needed. | - |
