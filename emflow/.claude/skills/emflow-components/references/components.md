# emflow components and expected behavior

Paths are relative to `src/`. "svc" = methods of the host ProjectService
(see [service-contract.md](service-contract.md)). Keep this file in sync with
the code: add a row when adding a component, update the behavior when it
changes.

## Entry and embedding (`index.tsx`, `widget/`, `data/`, `context/`)

| File | Expected behavior |
| --- | --- |
| `index.tsx` | Library entry. `COMPONENTS` registry (`ProjectPage`, `VolumeViewer`, `Plot`, `ImageSlider`, `TableViewerContent`, `TableViewerGrid`), `mount(name, options)`, `mountProjectPage({container, service, projectName \| projectId, theme, cssHref?})` (= `mount("ProjectPage")` with `props: {projectName}`), `components` (the names), `DataLoader`, `Plotly`, `version`, `buildTimestamp`, `rootClass`. Sets `window.Plotly` to the bundled plotly.js if the page has none. Logs `[emflow] ready ...` once. |
| `widget/mount.tsx` | `mountComponent(entry, {container, props, theme="auto", cssHref?, fill?, loader?, service?})`: shell + overlay root + emotion cache + ThemeProvider + OverlayRootProvider + DataLoaderProvider (+ ProjectServiceProvider when `service` is given) + error boundary (red `<pre>`, never thrown to the host). Returns `{update(patch), props, instance, unmount, root}`: props live in a store (`update` re-renders without a new root); `instance` is the ref of a `forwardRef` component (its imperative API). Unmounts by itself when the shell leaves the document (e.g. jQuery `.html()`) or on page unload. |
| `widget/shell.ts` | `createWidgetShell(target, {fill})` (`.emflow-root` + mount point; `fill`: 100% of the target height, else the content height), `ensureStylesheet` (one `<link id="emflow-css">`, skipped if already linked), `observeRemoval`. |
| `widget/overlay.tsx` | One overlay root per mount: `<div class="emflow-root emflow-overlays" style="display:contents">` on `<body>`. `useOverlayRoot()` returns it (fallback `document.body`). Sets MUI default `container` for Modal/Dialog/Popover/Popper. `useEmflowMuiTheme(options)` for nested MUI themes. |
| `widget/normalizeService.ts` | `normalizeServiceAPI(svc)`: maps alternative method names (e.g. `listProjects` -> `fetchList`) and adds defaults for optional methods (empty lists, `{handled:false}`, "not configured" errors for write operations). Retries tag/execute/save calls with the legacy argument order. |
| `widget/constants.ts` | `ROOT_CLASS = "emflow-root"`, `PORTAL_ROOT_ID = "emflow-portal-root"`. |
| `data/DataLoader.ts` | `DataLoader`: `load(path, payload, {key?, cache?, signal?})` (LRU cache by path + payload, one request shared while in flight, failed requests not cached), `image(src)` (decoded `<img>` for a url or base64 PNG, cached), `invalidate(prefix?)`. Transport from the options: `request(path, payload, {signal})` from the host, or `fetch` POST JSON to `baseUrl + path` with `wrapPayload` / `unwrapResponse`. `DataLoader.emhub()`: `{attrs: payload}` body and the response `error` thrown; without options it is one shared loader (all the mounts of a page share its cache, e.g. a volume density is loaded once). `toDataLoader(loader \| options)`. |
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
  stored in localStorage under `emflow:project-<name>-node-positions...`
  (the viewport per view mode and direction: on every move end and, through
  `persistCurrentViewport`, after the programmatic moves of the zoom / fit /
  reorganize buttons, search and collapse; restored in `onInit` and when
  switching back to a view). A width change of the graph only re-snaps the
  grid view: the tree views keep the viewport. The key is shared by the tabs
  showing the same project: the last move wins.
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
| `ProtocolForm.tsx` (+ `ProtocolForm.module.css`) | Protocol editor: header (id, label, status, help `?`), tabs **Inputs and Parameters** (sections from `form`, sub-tabs), **Outputs**, **Logs**, **Metadata**; footer Close / Save / Launch with execute modes (`ExecuteModeButton`: launch, restart, schedule, from `info.executeMode`). Validates and shows `ValidationErrorsDialog` / `ExecErrorDialog`. Queue settings dialog when the host provides queues. Run name, comment, expert level. Wizards: a param with `wizard: <id>` (a Line: any of its params) shows a wand button; it calls `openWizard` with the current serialized (unsaved) params, shows its `errors` in `ValidationErrorsDialog` or opens `WizardDialog`; OK calls `applyWizard` and sets the returned `params` in the form (nothing saved), warnings as toasts. No wand without `svc.openWizard`/`applyWizard` (template editor). | `executeProtocol`, `openWizard`, `applyWizard`, `saveProtocol`, `executeProtocolWorkflow`, `getProtocolWorkflowExecutionPreflight`, `resolveBrowserPaths`, `listRemoteDirectory`, `previewRemoteEntry`, `buildProtocolDownloadUrl` |
| `ParamRow.tsx`, `MultiParamRow.tsx`, `TableParamRow.tsx`, `ProtocolFormRenderers.tsx` | One parameter row by param class: string/int/float, boolean switch, enum (radio/select), path (with file browser), pointer (input selection via `OutputSelectorDialog`, drag & drop from outputs with `WrapWithDrop` / `DragContext`), multi-pointer and table params. Help icon (`HelpText`); wand icon when `onOpenWizard` is given (see `components/wizards/`). `utils/protocolform.*` hold state, validation and ProtUnion helpers. | - |
| `ProtocolOutputsPanel.tsx` | Outputs tab: list of outputs, preview (`fetchOutputPreview`), "Analyze results" -> same decision logic as the node card (ctx has `outputRaw`), a toast when not handled. | `fetchOutputPreview`, `resolveAnalyzeViewer` |
| `ProtocolLogsPanel.tsx` + `hooks/useProtocolLogs.ts` | Logs tab: one tab per channel from `fetchProtocolLogChannels`; polls `fetchProtocolLogsChunk(projectId, protocolId, offsets)` incrementally (offset per channel), appends text, honours `resetOffset`/`truncated`. | `fetchProtocolLogChannels`, `fetchProtocolLogsChunk` |
| `ProtocolMetadataPanel.tsx`, `JsonTree.tsx` | Metadata tab: JSON tree of the protocol info with copy. | - |
| `ProtocolsDrawer.tsx` (+ `ProtocolsDrawer.module.css`, `ProtocolTree.tsx` + `ProtocolTree.module.css`) | Right drawer (portaled to the overlay root, bounded to the widget) with the protocol catalog tree (`loadProtocols`), package selector, search, NEW/BETA/UPDATED badges, help. Double click creates a new protocol. | `loadProtocols` |
| `ProtocolHelpDialog.tsx` | Protocol help text. | - |

## Wizards (`components/wizards/`)

Developer guide: `emwrap/docs/wizards.md` (server side, form JSON, adaptors).

| File | Expected behavior | svc |
| --- | --- | --- |
| `WizardDialog.tsx` | MUI dialog of a form wizard: title (`label`), warnings and OK errors as alerts, body = the component named by the server's `ui` (`WIZARD_COMPONENTS`, props `{inputs, data, onChange(outputs), preview?(outputs)}`; `preview` is `svc.previewWizard` for the open wizard, from `ProtocolForm`; width per component in `WIZARD_WIDTHS`), Cancel / OK (`onApply(outputs)` returns errors to keep it open). Add new wizard components to `WIZARD_COMPONENTS`. | (caller: `applyWizard`) |
| `ExportTomoParticlesWizard.tsx` | Box and pixel size of exported tomo particles: Input pane (tilt-series pixel size `data.in_angpix` read-only, box px), Binning (center; output pixel size = input × binning, editing either updates the other), Output pane (pixel size, box px, "Match input" = same box in Å). Each pane draws its box square at a common Å scale with the other box dashed and the particle diameter as an orange circle. The diameter (Å) is an editable field in the centre column (initial `inputs.diameter`: the form value or half of the input box); an empty field falls back to half of the input box (its placeholder). Each pane shows the diameter in px at its pixel size and in Å. Outputs `{in_box, out_box, out_angpix, diameter}`. Dev: protocols drawer "Wizards (dev)". | - |
| `MaskCreateWizard.tsx` | Parameters of a mask created from a map (server `MaskCreateWizard`, `emw-relion-mask_create` from volume): threshold (field + slider over `data.value_range`), lowpass (Å, empty: none), extend (px, negative shrinks), soft edge (px), invert on the left; the map (`data.volume`, `{kind: "volume", ..., density}`) in a `VolumeViewer` (3D volume first with `defaults.iso.threshold` = the first threshold, Slices; no select tool, crosshair or particles) with the tentative mask (`data.mask`, an inline VolumeDensity 0-1, threshold 0.5) over it. 400 ms after the values stop changing it calls the `preview` prop (svc.previewWizard) and shows the new `mask`, `mask_fraction` ("Tentative mask: x% of the box"), warnings or errors; older answers are ignored. Outputs `{threshold, lowpass, extend, soft_edge, invert}`. `xl` dialog. Dev: "Wizards (dev)" → Relion Mask Create (fake mask of the blobs map). | (prop `preview`) |
| `VolumeMaskWizard.tsx` | Mask of a map (server `VolumeMaskWizard`, Relion Class3D and Refine3D `fn_mask` / `particle_diameter`): the map and mask lines, and a `VolumeViewer` (3D volume first, then Slices; no particles, select tool or crosshair) of `data.volume` with `mask`: the map `data.mask` when there is one (it takes precedence), else a sphere of `inputs.diameter` (Å). `data.volume` / `data.mask` are `{kind: "volume", path, dimensions, voxelSize, density}`; EMhub's `/api/wizard_open` adds the `density` request to every data item with `kind: "volume"`. The diameter is changed in the viewer's mask panel; `onMaskChange` reports it and the outputs are `{mask_type, diameter}` (Å; px without a voxel size). Shown in a `lg` dialog (`WIZARD_WIDTHS`). Dev: "Wizards (dev)" → Relion Tomo 3D Classification (empty mask field: sphere; any value: a fake ellipsoid map). | - |

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
| `VolumeViewerDialog.tsx` | The `"volume"` analyze viewer (see service-contract.md): a map or mask output in a `VolumeViewer` inside a dialog styled like `TableViewerDialog` (title, pointerClass chip, protocol and the pane `title` below). The decision gives the pane content inline (`data`) or a request (`source`, loaded with the DataLoader; `{paneContent}` or the pane); its `viewerConfig` is spread on the viewer. Opened by `ProtocolNodeCard` and `ProtocolOutputsPanel`. Dev: the Volume outputs of the fake project (`?maskOutput`: as a VolumeMask, an ellipsoid over the map). | DataLoader (`source`) |
| `VolumeViewer.tsx` (+ `VolumeViewer.module.css`, `volume/VolumeSlices.tsx`, `volume/VolumeScene3D.ts`, `volume/ParticlesPanel.tsx`, `volume/templateSurface.ts`, `volume/IsoSurfaceView.tsx`, `volume/IsoSurfaceScene.ts`, `volume/DensityPanel.tsx`, `volume/MaskPanel.tsx`, `volume/densityGrid.ts`, `volume/trackball.ts`, `volume/volumeMath.ts`) | Volume viewer (tomograms, maps), mountable (`VolumeViewer`). Data: `data` (`{dimensions, axes: {x,y,z: {slice: base64}}, voxelSize, coordinates, density}`, or a pane / `{paneContent}`, see `volumeDataFromPane`) or `source: {path, payload}` loaded with the DataLoader. `axes` or `density` is needed: without `axes` the Slices tab draws the sections from the density grid (keys one per grid voxel), so a small map (3D class) is sent once for all the tabs; a `density` request (`{path, payload}`) is then loaded by the viewer before it shows. Config props (`VolumeViewerConfig`, also a pane's `viewerConfig`): `tabs {slices, view3d, volume3d}` (all by default; 3D volume only with a density), `initialTab`, `tools {select, ruler, zoom, pan, particles: "auto" (false: neither drawn nor in the toolbars), volume, invert, lines, crosshair (false: no slice lines at all and no lines button)}`, `initialTool`, `defaults {particles {show, nearSlices, near3d, tolerance, color, template}, planes, inverted, iso {threshold, enclosed, below, opacity, color, maxVoxels, dust, smooth}}`, `mask` (`VolumeMask`, see the 3D volume tab; drawn in Slices and 3D volume), `onMaskChange(VolumeMaskState)` (the mask options `{type, show, color, opacity, diameterPx, diameter (Å or null)}`, at first and on every change), `viewSize` (520), `particleTolerance` (10, = defaults.particles.tolerance), `debug` (default `DEBUG_TIMING` = true: a monospace line above the output bar with the density timing: server steps from `density.timing` and whether it was in the server cache, request time (or "sent with the pane"), MB sent and encoding, decode ms, grid and scaling method, dust removal ms and blobs hidden; set `DEBUG_TIMING` false to hide it everywhere). Uses: tomogram list (`processing_tomogram_card.html`): `tabs {volume3d: false}`, no density sent; tomogram panes of the table viewer (Tomograms, TomoCoordinates, TomoParticles; EMhub `TOMOGRAM_VIEWER_CONFIG`: `{tabs: {volume3d: false}}`): slices and 3D planes, no density sent; maps (EMhub `MAP_VIEWER_CONFIG`: `{tabs: {view3d: false}, initialTab: "volume3d", tools: {crosshair: false, particles: false}, defaults: {iso: {dust: 100}}}`): 3D classes with an inline density, WarpPopulation species volumes with a density request (`maxSize` 256) that the viewer loads before showing (the slices are drawn from it). Densities are decoded once (`densityGrid.prepareDensity`: base64, zlib with `DecompressionStream` when `encoding: "zlib"`) and shared by both tabs. **3D volume** tab (`IsoSurfaceView`, built when first opened; a density request is loaded then, with `maxVoxels` of the Detail select: 1 / 2 / 8 M): the density as an iso-surface ray-cast on the GPU (WebGL 2) from a 3D texture of the uint8 grid (`IsoSurfaceScene`: crossing refined by bisection, normal from the gradient, headlight + key light, front-to-back blending of the surfaces behind when transparent, box faces cap the enclosed density, longer steps while moving; threshold, opacity and color are uniforms, no mesh), box outline, trackball (`trackball.ts`, shared with 3D planes), pan tool, reset. Side panel (`DensityPanel`, below the scene when there is no room): histogram of the voxel values in map units (log counts; filled: full-resolution volume; line: the binned grid when binned) with the threshold line (click/drag to set it) and the enclosed side shaded, threshold number + slider, "mean ± kσ" and the share of voxels enclosed (from the binned counts, which the surface uses), Dark density (encloses the values below; switching moves the threshold to the same share from the other tail), Hide dust (default on, 20 grid voxels or `defaults.iso.dust`: blobs (6-connected grid voxels inside the surface) smaller than the size are set out of the surface in the grid given to the GPU, 120 ms after the threshold settles; the panel shows how many; as ScipionWeb's hide dust / ChimeraX's surface dust), Smooth the surface (display only: one [1 2 1] pass per axis of the grid; the threshold then encloses less), opacity, color (ChimeraX #b2b2ff), Detail (only for a density request), grid size / binning and full-volume statistics. First threshold: encloses 1% of the voxels (as ChimeraX). **Mask** (config `mask`, drawn in this tab and in Slices): `{type: "sphere", diameter (Å, needs the voxel size) | diameterPx (voxels; default 80% of the smallest side), center? (voxels, the box centre)}` or `{type: "map", density: VolumeDensity | {path, payload} (loaded with the DataLoader like the density; same box as the volume), threshold? (map units; 0.5 for a 0-1 mask, else the middle of its range)}`, plus `label`, `show` (true), `color` (#5fd38d green; #ffd166 if the volume has that color), `opacity` (0.3). Drawn translucent over the density in `IsoSurfaceScene`: the sphere as a shaded mesh, the map ray-cast with the same shader but only its first (front) surface (`uFirst`), both after the density so its depth hides what is behind the surface. In **Slices** (`VolumeSlices` prop `mask`, under the crosshair, with the same color and opacity): the sphere as the circle where the plane through the middle of the shown slice cuts it; the map as its voxels above the threshold (`densityGrid.maskSlice`, cached per axis, slice, color and level, drawn with the zoom window). A map mask is loaded and decoded once by `VolumeViewer` (`useMaskDensity`) for both tabs. A mask button (icon: a box with the outside of a circle shaded) in the Slices and 3D volume toolbars opens `MaskPanel` under it (like the particles panel: closed by a click outside or Esc): show/hide, color, opacity slider and, for a sphere, the diameter in px and Å (two linked fields, Å only with a voxel size) and a slider; for a map, its loading/error status. Dev: `/dev/components.html` 3D class (sphere 100 Å) and "3D class with a map mask". `info`, `height: "window"` (fit the room below it in the window) \| `"fill"` (the container height), `onSelect({x,y,z})`. **Slices** tab (IMOD-like: Y above Z, X on its right, same scale; sections stretched over their voxel extent, so screen -> voxel stays exact with downsampled images): sliders, crosshair lines, select (moves the position), ruler (Å when the voxel size is known), zoom (drag a rectangle, kept to the view aspect), pan, invert, hide lines, particles (click to select), undo button (zoom, ruler, invert and lines are steps; with nothing left it deactivates the tool). **3D planes** tab (three.js, on demand rendering; `tabs.view3d: false` hides it): planes textured with the current slices (at most two shown, with sliders), box, position marker, particles as points or the picking template surface (Å, scaled by the voxel size) at each particle rotated by its RELION `angles` (rot, tilt, psi) found by the matching, faint ray-marched volume from the Z slices with opacity, invert, pan / trackball / wheel, click to select. Output bar below (one thing at a time: ruler length, particle, position + Å/voxel), as wide as the visible pane. Expand button: the viewer is laid over the whole browser window (`position: fixed`, z-index 3000, above host pages and dialogs; not the Fullscreen API); Esc (captured, so it does not close a dialog around it) or the button go back. **Particles** button (both toolbars) opens `ParticlesPanel` under it, inside the viewer (not portaled, so it also works expanded; closed by a click outside or Esc): show/hide and the particle color (a color input; one color for the dots and the template in both tabs, default orange; the selected particle stays red), a Show select: near the sections / shown planes (with a distance slider ±1-50 voxels, default `particleTolerance`, shown only for this option) or all; set per tab, by default near the sections (±10 voxels) in Slices and all in 3D planes; in 3D "near" = near any shown plane, also for picking), draw as (a select: Dots / Template (oriented); only with `coordinates.template` and a voxel size; drawn in 3D), the template density threshold (1-99% of its maximum, only when the host sends `template.density`; the surface is rebuilt in the browser with `templateSurface.ts`, the same surface-nets algorithm as EMhub's `coords3d.py`). Particles are selected by clicking them (no prev/next). Images decoded once through the DataLoader. Handle (`instance`): `getPosition()`, `setPosition(p)`, `setTool(t)`. Fits its container with a ResizeObserver; dark mode from the theme tokens. | DataLoader (`source`, `image`) |
| `Plot.tsx` | A Plotly figure (`data`, `layout`, `config`) or `source` loaded with the DataLoader (`{figure}` or the figure), `height` (360), events `onClick`, `onHover`, `onUnhover`, `onSelected`, `onRelayout`. String titles (layout and axes) become `{text}` (`normalizeTitles`, plotly.js 3 drops strings). Mountable (`Plot`). | DataLoader (`source`) |
| `TableViewerActionIcons.tsx` | The icons of action buttons (`tilt-series`, `tomogram`). | - |

## Other components

| File | Expected behavior | svc |
| --- | --- | --- |
| `components/projects/ProjectWorkflowsPanel.tsx` (+ `.module.css`) | Lists predefined workflows (`fetchWorkflows` result), search, load one into the project. | `loadWorkflow` |
| `components/tags/TagManager.tsx`, `TagPicker.tsx`, `TagsDialog.tsx`, `stores/tag_store.ts` | Project tags (title, color, description): create/edit/delete, assign to protocols, filter the graph by tags. | `listProjectTags`, `createProjectTag`, `updateProjectTag`, `deleteProjectTag`, `listProtocolTagIds`, `setProtocolTagIds` |
| `components/files/RemoteFileDialog.tsx` | File browser rooted at `resolveBrowserPaths` (`rootAbs`, `startPath`), directory listing, preview (text/json/table/image/none kinds), save-as mode for exports. Portals into `#emflow-portal-root` (created fixed on `document.body` when missing; the ProjectPage one, already inside the widget scope, must not get `ROOT_CLASS`: its flex/min-height layout would take 400px of the page). | `resolveBrowserPaths`, `listRemoteDirectory`, `previewRemoteEntry` |
| `components/ui/*` | shadcn-style primitives: `Button` (cva variants), `Dialog` (Radix, portal to `#emflow-portal-root`), `DropdownMenu`, `ContextMenu`, `OverflowTooltipText`. | - |
| `lib/utils.ts`, `lib/plot.ts` | `cn()` (clsx + tailwind-merge); Plotly component bound to `plotly.js-dist-min` (3.x), and `Plotly` itself (exported as `EMFlow.Plotly`, `window.Plotly`). | - |
| `icons/index.ts` | Only the SVG icons in use, as React components (svgr). Add the SVG + export when needed. | - |
