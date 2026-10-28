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
| | `fetchWorkflows()`, `loadWorkflow(projectId, {workflowId})` | `[]`, success | ProjectPage, workflows panel |
| | `exportProtocols(projectId, {protocolIds, directoryPath, filename})` | - | ProtocolNodeCard |
| | `getNextProtocolSuggestions(projectId, protocolId)` | `[]` | ProtocolNodeCard |
| Files | `resolveBrowserPaths(projectId, protocolId)` -> `{rootAbs, startPath, protocolRoot}`; `listRemoteDirectory(projectId, protocolId, path)` -> `[{name, path, isDir, size, mime}]`; `previewRemoteEntry(projectId, protocolId, path)` -> `{kind: text\|table\|image\|none, ...}` | - | RemoteFileDialog, ProtocolForm, ProjectPage |
| Logs | `fetchProtocolLogChannels(projectId, protocolId)` -> `{channels: [{id, label, order}]}`; `fetchProtocolLogsChunk(projectId, protocolId, offsets)` -> `{chunks: [{channel, content, offset, resetOffset?, truncated?}]}` | empty | useProtocolLogs |
| Tags | `listProjectTags`, `createProjectTag`, `updateProjectTag`, `deleteProjectTag`, `listProtocolTagIds`, `setProtocolTagIds` | `[]` / throws for writes | TagManager, ProtocolNodeCard, ProjectPage |
| Outputs | `resolveAnalyzeViewer(ctx)` (see below) | `{handled:false}` | ProtocolNodeCard, ProtocolOutputsPanel |
| | `fetchOutputPreview` | - | ProtocolOutputsPanel |
| Table viewer | `resolveTableViewerAction`, `executeTableViewerEditAction`, `resolveTableViewerChildren` (see below) | empty pane / failure / no children | table-viewer-pane |
| Wizards | `executeProtocolWizard`, `resolveBackendUrl` | - | use_protocol_wizards |
| Scipion viewers | `listOutputVolumes`, `getVolume*`, `listOutputTiltSeries`, `fetchTiltSeries*`, `listOutputCTFTomoSeries`, `listCoords3dTomograms`, `fetchOutputMetadataTables`, `fetchFscRows`, ... | mostly `[]` | analyze/* (only reached when the host does not handle the output) |

When adding a method: declare it in `ProjectService.ts`, add a default in
`normalizeService.ts` if it is optional, implement it in EMhub's svc template
(and `dev/fakeService.js`), and add a row here.

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

- `{handled: false}` -> emflow opens `AnalyzeOutputDialog` (Scipion viewers).
- `{handled: true, viewer: "external", url, target?: "_self"|"_blank"}` (the
  `viewer` field may be omitted) -> navigates / opens the url. EMhub uses
  `url: "#__external_viewer__", target: "_self"` after opening its own viewer
  (`visualizeOutput`), and an OTF dashboard url for `TiltSeriesAnalysis`.
- `{handled: true, viewer: "table", title?, context, table}` -> `TableViewerDialog`.

EMhub (`project_widget_svc.html`) returns `viewer: "table"` for
`TiltSeriesMovies`, `TiltSeries`, `TiltSeriesAligned`, `Tomograms`,
`TomoCoordinates`, `TomoParticles`, `Movies`, `Micrographs`,
`MultiClasses2D`, `Classes3D`, `Particles` (table built by the server:
`get_table_view_data`).

## Table viewer protocol

```ts
context: TableViewerContext = { projectId, protocolId, outputName, pointerClass?, tableKey?,
                                ...extra }   // extra fields are passed back untouched
table: TableViewerData = {
  title?, columns: [{id, label, align?, width?, sortable?, actions?}],   // action: {id, label, icon?, disabled?}
  rows: [{id, cells: {colId: value}, data?, actions?, defaultAction?,
          cellContexts?: {colId: {edit?: {type: "boolean", field}, actions?, children?}},
          children?}],
  actions?, editActions?: [{id, label, requiresChanges?}], page? }
```

- Cell/column/row action -> `resolveTableViewerAction(context, {actionId, rowId, columnId, rowData: row.data, cellContext})`
  -> `TableViewerPaneContent` (`empty`, `text`, `html`, `iframe`, `image`,
  `plotly`, `imageSlider`, `grid`, `coords3d`, `tiltSeries`, `volume`, `ctfTomo`).
- `grid` (`table-viewer-grid.tsx`) shows up to 4 panes in a 2 x 2 grid:
  `{kind: "grid", title?, layout, cells: {slot: paneContent}}`. The layout
  names the slots: `2x2` (topLeft, topRight, bottomLeft, bottomRight),
  `cols` (left, right), `rows` (top, bottom), `span-top` (top over both
  columns, bottomLeft, bottomRight), `span-bottom` (topLeft, topRight,
  bottom), `span-left` (left over both rows, topRight, bottomRight),
  `span-right` (topLeft, bottomLeft, right). Cells take the generic kinds
  (text, html, iframe, image, plotly, imageSlider; single-axis sliders are
  fitted to the cell) or `empty` with a message (a cell that failed); the
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
- Action id **`metadata` is handled by emflow** (opens `MetadataViewer`) and
  never reaches the host.
- Edit action button -> `executeTableViewerEditAction(context, {actionId, edits: [{rowId, columnId, field, value}]})`
  (only the changed cells) -> `{success, message?, clearEdits?}`; the message
  is shown as a toast.
- Expanding child rows -> `resolveTableViewerChildren(context, {rowId, childrenId, rowData, cellContext})`.

EMhub's adapter (`adaptTableViewData` in `project_widget_svc.html`):

- copies `row.cells` to `row.data` (sent back to `resolve_table_view_pane`
  as `row.cells`);
- renames the server's `metadata` action to `star-metadata` and maps it back;
- for `TiltSeries`, `TiltSeriesAligned`, `Tomograms` and `TomoCoordinates`
  the server sends the columns Tomo name, Metadata, (TomoCoordinates only:
  **Coordinates**, `nCoords`) and **TS / Tomogram** (`tsTomo`); Tomo name
  and Coordinates are `sortable`. `tsTomo`
  has per-row icon actions: `ts-view` (`tilt-series`:
  a `2x2` grid: slices of the aligned stack, or of the tilt images of the
  series STAR sorted by tilt angle, | tilt angles (dose vs tilt angle);
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
