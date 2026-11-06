# ProjectService contract (emflow <-> host)

The full TypeScript interface is `src/services/ProjectService.ts`. The host
object goes through `src/widget/normalizeService.ts`, which maps alternative
names and fills defaults, so **only a few methods are strictly required**.
EMhub implements the service in three templates:

| Template | Used by | Notes |
| --- | --- | --- |
| `templates/project_widget_svc.html` | `project_widget.html` (processing projects, tomo sessions) | Real implementation over EMhub's API (`Api.urls.*`) |
| `templates/project_widget_svc_workflow.html` | `project_widget_workflow.html` (workflow template editor) | Edits a workflow JSON in memory; launch is disabled |
| `templates/project_widget_svc_fake.html` | `project_widget_fake.html` (fake project 43) | Static data, for UI testing |

The dev pages use `dev/fakeService.js` (same fake project; open any output
with `?tomoTable` in the url to get a fake Tomograms table viewer with the
Selected column, Create subset and the TS / Tomogram icon column; its tilt-series icon opens a fake `2x2`
grid, with `&gridLayout=<layout>` for the other layouts; `?tomoTable=coords`
gives a TomoCoordinates table whose tomogram icon shows particles on the
slices; `?outputPrefix` gives the outputs a label prefix, `Out01`... for
all but the first output of each protocol). Actions take 0.7 s there, to show the pane's loading state. Update
it when the contract changes.

## Methods by area

Argument names: `projectId` is the `projectName` passed to `mountProjectPage`
(EMhub's project/entry id), `protocolId` is the node id.

| Area | Method | Default if missing | Called from |
| --- | --- | --- | --- |
| Project | `fetchProject(projectId)` -> `{id, name, path, protocols}` | demo project | ProjectPage (load + auto refresh) |
| | Protocol timing fields (optional): `elapsedTime` (total seconds of all runs), `elapsedSessionId` (changes with each new run, e.g. its start), `elapsedRuns` (`[{launched, queued, start, end, elapsed, status}]`, queued = launched to start and elapsed in seconds, null if unknown), `launched` (pending launch, not started yet) and `queued` (its waiting seconds, only while Launched) | - | ProtocolNodeCard (time row + hover), ProjectPage (local timer) |
| | `fetchProjectEffectiveSettings(projectId)` | not used | ProjectPage |
| | `getContextMenuVisibilityPolicy(projectId)` -> `NodeMenuVisibility` | `{}` | ProjectPage |
| Protocol | `fetchProtocolDetails(projectId, protocolId)` -> `{info, form, values}` | demo | ProjectPage |
| | `fetchNewProtocolDetails(projectId, protocolClass)` | demo | ProjectPage |
| | `executeProtocol(projectId, protocolId, className, params, mode)` (`launch` / `restart` / `schedule` / `stop`) -> `{status, errors, workflow}` | throws "missing method" | ProtocolForm |
| | `getProtocolWorkflowExecutionPreflight(projectId, protocolId, mode)` (`continue` / `restart`) -> `{protocolId, mode, requiresConfirmation, affectedProtocols, activeProtocolIds}`; asks whether to run only this protocol or its downstream workflow | `requiresConfirmation: false` (falls back to `executeProtocol`) | ProtocolForm |
| | `executeProtocolWorkflow(projectId, protocolId, className, params, mode, scope)` (`single` / `all`), only called after a preflight with `requiresConfirmation` | throws "missing method" | ProtocolForm |
| | `saveProtocol(projectId, protocolId, className, params)` | throws | ProtocolForm |
| | `stopProtocol`, `deleteProtocol(projectId, ids)`, `duplicateProtocol(projectId, items)` -> `{status, errors, workflow, duplicated}`, `renameProtocol(projectId, protocolId, {runName, comment})` | - | ProjectPage |
| | `restartAll`, `continueAll`, `resetFrom` | - | ProjectPage (menu shortcuts) |
| Catalog | `loadProtocols(projectId)` (protocol tree for the drawer) | `[]` | ProtocolsDrawer |
| | `fetchWorkflows(category?)` (`builtin` default / `site` / `project`) -> `{workflows: WorkflowDescriptor[], folder}` (`WorkflowsListing`; `folder` = absolute folder of the category, shown in the panel and export dialog headers) or a plain `WorkflowDescriptor[]` (`id` = file name without `.json`, `name`, `description`, `category`, `file`, `protocolsCount`, `parseError`); hosts without categories may ignore it (items without `category` are shown in every category) | `[]` | ProjectPage (workflows panel), WorkflowExportDialog |
| | `loadWorkflow(projectId, {workflowId, category?})` -> `{status, errors, workflow}` | success | workflows panel |
| | `saveWorkflow(projectId, {protocolIds, category: 'site'\|'project', workflowId, name, description, overwrite})` -> `{id, file, category, protocolsCount}`; rejects (Error message shown in the dialog) when it exists without `overwrite` | throws "missing method" | WorkflowExportDialog (protocol Export) |
| | `exportWorkflowProtocols(projectId, {protocolIds})` -> `{sourceProjectId, sourceProjectName, protocolIds, workflow}` (`workflow` is opaque: stored as is in the clipboard and given back to `importWorkflowProtocols`) | throws "missing method" | ProjectPage (Mod+C) |
| | `importWorkflowProtocols(projectId, {workflow, mode: 'append', sourceProjectId, sourceProjectName})` -> `{status, errors, workflow, created: [{sourceId, newId}], clearedInputs: [{sourceId, param, value}]}` | throws "missing method" | ProjectPage (Mod+V, Paste) |
| | `exportProtocols(projectId, {protocolIds, directoryPath, filename})` (legacy file export, no longer called by emflow) | - | - |
| | `getNextProtocolSuggestions(projectId, protocolId)` | `[]` | ProtocolNodeCard |
| Files | `resolveBrowserPaths(projectId, protocolId)` -> `{rootAbs, startPath, protocolRoot}`; `listRemoteDirectory(projectId, protocolId, path)` -> `[{name, path, isDir, size, mime}]`; `previewRemoteEntry(projectId, protocolId, path)` -> `{kind: text\|table\|image\|none, ...}` | - | RemoteFileDialog, ProtocolForm, ProjectPage |
| Logs | `fetchProtocolLogChannels(projectId, protocolId)` -> `{channels: [{id, label, order}]}`; `fetchProtocolLogsChunk(projectId, protocolId, offsets)` -> `{chunks: [{channel, content, offset, resetOffset?, truncated?}]}` | empty | useProtocolLogs |
| Tags | `listProjectTags`, `createProjectTag`, `updateProjectTag`, `deleteProjectTag`, `listProtocolTagIds`, `setProtocolTagIds` | `[]` / throws for writes | TagManager, ProtocolNodeCard, ProjectPage |
| Wizards | `openWizard(projectId, protocolId, protocolClassName, wizardId, params)` -> `WizardOpenResult` `{errors?} \| {id, label, ui, inputs, data, warnings}`; `applyWizard(..., wizardId, params, outputs)` -> `{errors?} \| {params, warnings}`. `previewWizard(..., wizardId, params, outputs)` -> `WizardPreviewResult` `{errors?} \| {data, warnings}` (optional; data for the values being chosen, e.g. a tentative mask; EMhub `/api/wizard_preview`). `protocolId` is null for a new protocol, `params` the unsaved form values. Optional: without them the wizard buttons are hidden. EMhub: `/api/wizard_open`, `/api/wizard_apply` (`emwrap.base.wizards.Wizards`), errors returned (not shown by the svc) | wand hidden | ProtocolForm |
| Outputs | `resolveAnalyzeViewer(ctx)` (see below) | `{handled:false}` | ProtocolNodeCard, ProtocolOutputsPanel |
| | `fetchOutputPreview` | - | ProtocolOutputsPanel |
| Table viewer | `resolveTableViewerAction`, `executeTableViewerEditAction`, `resolveTableViewerChildren` (see below) | empty pane / failure / no children | table-viewer-pane |

When adding a method: declare it in `ProjectService.ts`, add a default in
`normalizeService.ts` if it is optional, implement it in EMhub's svc template
(and `dev/fakeService.js`), and add a row here.

## Workflow categories (EMhub)

`fetchWorkflows` / `loadWorkflow` / `saveWorkflow` work on three folders
(`emhub/data/workflow_store.py`, `_workflows_dir` in `blueprints/api.py`):

| Category | Folder | Writable |
| --- | --- | --- |
| `builtin` | `emwrap/config/workflows` (`ProcessingConfig.get_workflows_dir()`), top-level `.json` only: `config/workflows/internal` (spa-otf, tomo-otf, test workflows) is for the code and tests, never listed or loaded as Built-in (`get_workflow_file(id, internal=False)`) | no |
| `site` | `<EMHUB_INSTANCE>/workflows` | managers only |
| `project` | `<project>/.emhub/workflows` | project editors |

`project_widget_svc.html` calls `/api/list_workflows` (`{category}` + the
project selector), `/api/load_workflow` (`{workflow_id, category}`) and
`/api/save_workflow` (`{run_ids, category, workflow_id, name, description,
overwrite}`; the jobs come from `ProjectManager.exportWorkflow`, written as
`{name, description, jobs}`; an existing file is only replaced with
`overwrite`). `workflowsRequest` throws the server error without the
traceback. A workflow id is a file name without `.json`
(`[A-Za-z0-9][A-Za-z0-9._-]*`, same check in `workflowCategories.ts`). The
template editor and fake-project services only list `builtin` and reject
`saveWorkflow`; `dev/fakeService.js` keeps site/project workflows in memory
(`loadWorkflow` only checks that it exists).

## Copy / paste of protocols (EMhub)

`exportWorkflowProtocols` posts `/api/get_workflow_jobs {run_ids}` (read
only): `ProjectManager.getWorkflowJobs` gives `{jobs: [{jobid, jobtype,
params}], project_path}`, the params as saved at copy time.
`importWorkflowProtocols` posts `/api/load_workflow {workflow}` (needs edit
permission on the target project) with its own request, since
`requestAction` reports server errors as success, and returns `created`
from `id_map` and `clearedInputs` from `cleared_inputs`.
`ProjectManager.loadWorkflow` creates the jobs parents first, remapping the
links between copied jobs. Params referencing a job folder not copied
(`<Type>/jobNNN[/...]`) are kept when `project_path` is the target project
(as Duplicate) and cleared otherwise (`external_inputs='clear'`, see
`emwrap/tests/test_workflow_import.py`). Other paths (`data/...`, gain
references) are copied as they are. The template editor and fake-project
services reject both methods; `dev/fakeService.js` reports new ids without
changing the graph, and `/?project=<name>` opens the fake project as
another project (clears Scipion-like `<id>.<output>` pointers).

## Protocol outputs

Each protocol (in `fetchProject` and in `fetchProtocolDetails` `info`) has
`outputs: [{outputName, pointerClass, info, value, parentId, prefix?}]`.
`info` is the output label (e.g. `Volume (112 x 112 x 112)`). `prefix`,
optional and possibly empty, tells apart outputs of the same kind of a
protocol: if not empty it is shown before the label,
`<prefix> - <info>` (`withOutputPrefix` in `src/utils/output_label.ts`):
in the node card outputs, the Outputs tab (`ProtocolOutputsPanel`), the
output selector and the selected input of a form (`gatherAllOutputs` in
`ProtocolForm`), and the dragged output's `info`. EMhub
(`processing_relion/project.py`, `_output_prefix`) sends `ClassNN` for the
class volumes of Relion 3D classifications (`relion.class3d`,
`relion.class3d.tomo`), e.g. `Class01 - Volume (112 x 112 x 112)`, and `''`
for the other outputs.

## Analyze decision

When the user clicks an output (eye icon on a node, or "Analyze results" in
the Outputs tab), emflow calls `svc.resolveAnalyzeViewer(ctx)`:

```ts
ctx = { projectId, protocolId, protocolLabel, outputName, pointerClass,
        paramClass?, info?, value?,   // from the node card
        outputRaw? }                  // from the Outputs tab
```

Return one of (`AnalyzeViewerResolveDecision`):

- `{handled: false}` -> emflow shows a "There is no viewer for this output"
  toast (the Scipion viewers that used to open here were removed).
- `{handled: true, viewer: "external", url?, target?: "_self"|"_blank"}` (the
  `viewer` field may be omitted) -> navigates / opens the url; without `url`
  emflow does nothing (the host already opened its own viewer). EMhub returns
  no url after opening its own viewer (`visualizeOutput`), and an OTF
  dashboard url for `TiltSeriesAnalysis`.
- `{handled: true, viewer: "table", title?, context, table}` -> `TableViewerDialog`.
- `{handled: true, viewer: "volume", title?, pointerClass?, data? | source?: {path, payload}}`
  -> `VolumeViewerDialog`: the VolumeViewer pane content inline or loaded
  with the DataLoader (its `viewerConfig` sets the viewer).
- `{handled: true, viewer: "pdf", url, title?, pointerClass?}` ->
  `PdfViewerDialog`: the browser's own PDF viewer in an iframe with
  `src = url` (emflow does not fetch it, the url is from the host), and a
  button to open it in a new tab.

EMhub (`project_widget_svc.html`) returns `viewer: "table"` for
`TiltSeriesMovies`, `TiltSeries`, `TiltSeriesAligned`, `Tomograms`,
`TomoCoordinates`, `TomoParticles`, `Movies`, `Micrographs`,
`MultiClasses2D`, `Classes3D`, `Particles` (table built by the server:
`get_table_view_data`), and for `JobView` outputs: views of a whole job that
EMhub adds as extra ("fake") outputs of finished jobs
(`emhub/data/processing/job_views.py`, `job_view_outputs` called from
`processing_relion/project.py`), with value `<job id>#<view id>`; they are
not files, so their pointerClass matches no input. `CTF Plots`
(`relion.ctffind.tomo`) and `Motion Plots` (`relion.motioncorr.tomo`) are
tables of the metrics of Relion's logfile.pdf (one row per STAR label, with
its statistics); a row (default action `plots`, opened for the first row
with `initialAction`) shows a `cols` grid: the values of all tilt images,
one trace per tilt series, and the histogram (`data/processing/star_columns.py`,
reusable for any STAR columns). New views subclass `JobView`, or
`StarColumnsPlotsView` with only their METRICS, and are registered with
`register_job_view`. It returns `viewer: "volume"` for `Volume` and `VolumeMask` outputs
(`.mrc`) with `source` = `/api/get_volume_viewer` `{root, path,
pointerClass}` (`build_volume_output_pane_content`, `VOLUME_OUTPUT_VIEWER_CONFIG`:
3D volume first, Slices without the select tool or crosshair, densities of
at most 256 px; a `VolumeMask` is shown over the map it was created from: the
input volume in the job.star of `emw-relion-mask_create`, or `<name>.mrc`
next to `<name>_mask.mrc` (PyTom); the mask alone if not found or not on the
same box). It returns `viewer: "pdf"` for `PdfFile` outputs (and `File`
outputs ending in `.pdf`, cached before emwrap had the type) with `url` =
`/api/get_pdf_file?root=&path=` (GET, login required, only `.pdf` files
inside the project, checked with `project_file_path`). Other files still
open EMhub's own viewer (`visualizeOutput`).

## Table viewer protocol

```ts
context: TableViewerContext = { projectId, protocolId, outputName, pointerClass?, tableKey?,
                                ...extra }   // extra fields are passed back untouched
table: TableViewerData = {
  title?, columns: [{id, label, align?, width?, sortable?, actions?}],   // action: {id, label, icon?, disabled?}
  rows: [{id, cells: {colId: value}, data?, actions?, defaultAction?,
          cellContexts?: {colId: {edit?: {type: "boolean", field}, actions?, children?}},
          children?}],
  actions?, editActions?: [{id, label, requiresChanges?}], page?,
  initialAction?: {rowId, actionId?, columnId?} }
```

- `initialAction`: when the table is shown, its row is selected and its
  action resolved as if clicked (once per table object): `actionId` is
  looked up in the cell context of `columnId`, the column actions, the row's
  `defaultAction` and `actions`; without `actionId` the cell's or row's
  `defaultAction`. Ignored if the row or action does not exist
  (`findInitialAction` in `TableViewerPane.tsx`). The dev page tries it with
  `?tomoTable&initialAction[=<row>:<action>]`.
- Cell/column/row action -> `resolveTableViewerAction(context, {actionId, rowId, columnId, rowData: row.data, cellContext})`
  -> `TableViewerPaneContent` (`empty`, `text`, `html`, `iframe`, `image`,
  `plotly`, `imageSlider`, `tiltSeries`, `grid`). A `tiltSeries` (`TableViewerTiltSeriesContent`:
  `tilts` sorted by tilt angle, each `{image (base64 PNG, unaligned), movieIndex, tiltAngle, xTilt,
  yTilt, zRot, shiftX, shiftY (Å), dose, defocusU, defocusV, ctfMaxResolution, section?}`,
  `imageSize`, `pixelSize` (Å/px of the images sent), `tiltAxisAngle`, `hasAlignment`, `deformation`
  `{type, gridSize, imageSize}` or null, with the per tilt `deformation` coefficients
  (rlnTomoDeformationCoefficients; type and grid from the series' row in the global STAR of the job
  that wrote its STAR, `_series_global_row`; imageSize from a full size tilt image header)) is shown by
  `TiltSeriesViewer`; EMhub builds it with `build_tilt_series_viewer_pane_content`. An `imageSlider` with `layout: "volume"`
  (dimensions and X, Y, Z slices, optional `voxelSize`, `coordinates` with
  `angles` / `template` — `{vertices, faces, density?}`, where `density` is
  `{shape: [z, y, x], data: base64 uint8, voxelSize, level}` from
  `coords3d.py` `_template_density`, ≤ 48³ — `density` of the volume for
  the 3D volume tab and `viewerConfig` for the VolumeViewer tabs, tools and
  defaults) is shown by `VolumeViewer`. The X, Y, Z slices may be missing
  when `density` is inline (the slices are drawn from it). The volume
  `density` is inline (`VolumeDensity`: `{shape: [z, y, x], binning, data:
  base64 uint8, valueRange, stats {min, max, mean, std}, histogram {range,
  counts, shown, below, above, shownBelow, shownAbove}}` from EMhub's
  `data/volume_density.py`: block-mean binned grid ≤ maxVoxels, or Fourier
  scaled (emtools `Image._fourier_rescale`) to a longest side ≤ maxSize for
  maps, then `binning` is the real factor and `method` says which; `data` may
  be zlib compressed (`encoding: "zlib"`); `timing` (seconds of each server
  step, `cached`) and `bytes {grid, sent}` for the debug line; histogram of
  every full-resolution voxel and of the binned grid in map units, computed
  from the float values before the uint8 conversion) or a request `{path,
  payload}` (EMhub: `/api/fetch_volume_density` with `{root, path,
  maxVoxels, maxSize}`, answering `{density}`) loaded with the DataLoader when
  needed.
  EMhub builds these panes with `build_volume_viewer_pane_content(root, rel,
  slices=, density='lazy' | 'inline' | None, max_voxels=, max_size=,
  viewer_config=)`; tomograms of the table viewer (Tomograms,
  TomoCoordinates, TomoParticles) get slices only and
  `TOMOGRAM_VIEWER_CONFIG` (`tabs {volume3d: false}`). A WarpPopulation output (EMhub `api_viewers_warp.py`,
  data from `data/warp_m.py`) is a table of the 3D volumes of its species
  (sharpened map first; species, volume, box, Å/px, resolution, particles; a
  species without maps still gets a row). Its row panes (`grid`s):
  - volume (default, `span-top`): the volume (VolumeViewer, density request
    with maxSize 256) above the Plotly FSC curves (`*_fsc.star`, the look of
    the former Highcharts plot: own title, dashed 0.5 / 0.143, reversed
    resolution, legend below) and the local resolution histogram
    (`*_localres.star`, with its median).
  - refinement (`span-top`): resolution and B-factor per round (a point per
    new species version), the species summary (html) and the rounds (html:
    job, program, options, resolution, B-factor, time, version). Rounds come
    from the chain of emwrap jobs (job.star input population, info.json
    time), or from the species versions Warp keeps when not in emwrap jobs.
  - tilt series (`rows`): score gain vs particles per tilt series (colored by
    time) and a table, lowest gain first, from the refine_*.log of the last
    M refinement (its own logs, or an earlier job's in the chain;
    EstimateWeights logs have no iterations and are skipped).
  A plotly figure with its own `layout.title` keeps it, its margins and font
  in grid cells. Plot titles may be strings or `{text}`.
- `grid` (`table-viewer-grid.tsx`) shows up to 4 panes in a 2 x 2 grid:
  `{kind: "grid", title?, layout, cells: {slot: paneContent}}`. The layout
  names the slots: `2x2` (topLeft, topRight, bottomLeft, bottomRight),
  `cols` (left, right), `rows` (top, bottom), `span-top` (top over both
  columns, bottomLeft, bottomRight), `span-bottom` (topLeft, topRight,
  bottom), `span-left` (left over both rows, topRight, bottomRight),
  `span-right` (topLeft, bottomLeft, right). Cells take the generic kinds
  (text, html, iframe, image, plotly, imageSlider, tiltSeries; single-axis sliders and the
  tilt series viewer are fitted to the cell) or `empty` with a message (a cell that failed); the
  content title becomes the cell header. Missing slots stay empty.
  Note: only `row.data` is sent back, not `row.cells`.
- Action `icon` names an icon of `components/analyze/table-viewer-action-icons.tsx`
  (`tilt-series`, `tomogram`): drawn as an icon button with the label as
  tooltip (highlighted while its result is shown), and never taken as the
  cell's link (a single text action makes the cell value a link). Unknown
  names show the label. Several icon actions in one column, set per row in
  `cellContexts[colId].actions`, give an icon column whose icons vary by row.
  Text action buttons never break inside a label; a cell with several
  actions wraps them onto more lines (e.g. a column of plot actions).
- Every action id goes to the host (`metadata` is no longer reserved).
- Edit action button -> `executeTableViewerEditAction(context, {actionId, edits: [{rowId, columnId, field, value}]})`
  (only the changed cells) -> `{success, message?, clearEdits?, refreshProject?}`;
  the message is shown as a toast. `refreshProject` (e.g. the action launched
  a job) refreshes the project page (`useProjectRefresh`, from
  `context/ProjectRefreshContext.tsx`, calls ProjectPage's refresh ->
  `fetchProject`); EMhub sets it for the subset actions and invalidates its
  project cache, so `fetchProject` gets the workflow with the new job.
- Expanding child rows -> `resolveTableViewerChildren(context, {rowId, childrenId, rowData, cellContext})`.

EMhub's adapter (`adaptTableViewData` in `project_widget_svc.html`):

- copies `row.cells` to `row.data` (sent back to `resolve_table_view_pane`
  as `row.cells`);
- renames the server's `metadata` action to `star-metadata` and maps it back
  (from when emflow reserved `metadata`; no longer needed, but harmless);
- for `TiltSeries`, `TiltSeriesAligned`, `Tomograms` and `TomoCoordinates`
  the server sends the columns Tomo name, Metadata, (TomoCoordinates only:
  **Coordinates**, `nCoords`) and **TS / Tomogram** (`tsTomo`); Tomo name
  and Coordinates are `sortable`. `tsTomo`
  has per-row icon actions: `ts-view` (`tilt-series`:
  a `2x2` grid: Slices = the `tiltSeries` pane (TiltSeriesViewer) of the
  stack, else of the tilt images of the series STAR, with the STAR's alignment, | tilt angles (dose vs tilt angle);
  motion | defocus (µm) plots; each cell an `empty` message if it fails) and `tomo-view` (`tomogram`, only rows with a tomogram: X/Y/Z volume
  slices, with the row's particle `coordinates` for TomoCoordinates). The
  plots are in the grid, so these rows have no row actions (spec
  `hide_row_actions` in `api_viewers.py`);
- for tilt-series / tomogram / TomoCoordinates / TomoParticles tables adds a
  **Selected** boolean column (id `include`, merged into the row's
  `cellContexts`) and a **Create subset** edit action, executed with
  `create_tomo_subset` (rows left checked; an `emw-subset-ts` job, which for
  an `optimisation_set.star` writes the tomograms and their particles, both
  registered as outputs); keeps the row ids per output path.
- for `Classes3D` (a Relion `run_itNNN_optimiser.star`; rows from the
  iteration's `_model.star` and particles counted from its `_data.star`) the
  server sends Class (id from the volume filename), **Volume** (column and
  default action `volume`: X/Y/Z slices of the class map, `layout: "volume"`)
  Particles and % Particles (of the total; Class, Particles and % are
  `sortable`); the adapter adds the same **Selected** column and **Create
  subset**, executed with `create_classes_subset` (`createClassesSubset`:
  an `emw-subset-classes` job with the checked class ids, from the
  iteration's `_optimisation_set.star` if there is one, else its
  `_data.star`; the toast adds the number of particles of those classes).

History: before ScipionWeb `d4d9c01` the protocol was `viewer:
"table-viewer-pane"` with `tableViewContext`/`tableViewData`,
`resolveTableViewPane(request)` and `createTableViewSubset(request)`.
