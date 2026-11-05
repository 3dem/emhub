// dev/fakeService.js
//
// Minimal in-memory ProjectService used by the dev pages (index.html, dev/umd.html).
// It mirrors EMhub's templates/project_widget_svc_fake.html and loads the same
// fake project (EMhub data/fake_projects/43). The real service lives in EMhub:
// templates/project_widget_svc.html.
import workflow from "./fake_project/workflow.json";
import protocols from "./fake_project/protocols.json";
import forms from "./fake_project/forms.json";
import menu from "./fake_project/menu.json";

const log = (...args) => console.log("[fake svc]", ...args);
const notImplemented = (what, payload) => {
  log(what, payload);
  return { status: 1, errors: [`${what}: not available in the dev fake service`] };
};

let tags = [
  { id: "t-picking", title: "Picking", description: null, color: "#3b82f6" },
  { id: "t-processing", title: "Processing", description: null, color: "#ef4444" },
];
const protocolTags = {};

// A protocol form with a wizard (as EMhub tags emw-warp-export_particles,
// emwrap.base.wizards): new "Warp - Export Particles" in the protocols drawer
const WIZARD_PROTOCOL = "emw-warp-export_particles";
const WIZARD_FORM = {
  name: WIZARD_PROTOCOL,
  label: "Warp - Export Particles",
  wizards: [{ id: "export_box", label: "Box and pixel size wizard",
              params: ["ts_export_particles.output_angpix", "ts_export_particles.box"] }],
  sections: [{
    label: "General",
    params: [
      { name: "input_tomograms", label: "Input tomograms:", paramClass: "StringParam",
        default: "Tomograms/job001/tomograms.star", help: "Empty: the wizard refuses to open." },
      { name: "ts_export_particles.diameter", label: "Particle diameter (A)", paramClass: "FloatParam", default: 150 },
      { label: "Output", paramClass: "Line", params: [
        { name: "ts_export_particles.output_angpix", label: "Pixel size", paramClass: "FloatParam", wizard: "export_box" },
        { name: "ts_export_particles.box", label: "Box size", paramClass: "FloatParam", wizard: "export_box" },
      ] },
    ],
  }],
};
// The mask wizard of relion.class3d.tomo (VolumeMaskWizard): with the mask
// field empty it shows a sphere of the mask diameter, else the mask map
const MASK_PROTOCOL = "relion.class3d.tomo";
const MASK_FORM = {
  name: MASK_PROTOCOL,
  label: "Relion Tomo 3D Classification",
  wizards: [{ id: "mask", label: "Mask wizard", params: ["fn_mask", "particle_diameter"] }],
  sections: [{
    label: "I/O",
    params: [
      { name: "fn_ref", label: "Reference map:", paramClass: "PathParam", default: "Refine3D/job010/run_class001.mrc",
        help: "Empty: the wizard refuses to open." },
      { name: "fn_mask", label: "Reference mask (optional):", paramClass: "PathParam", default: "", wizard: "mask",
        help: "Any value: the wizard shows a fake ellipsoid mask map." },
      { name: "particle_diameter", label: "Mask diameter (A):", paramClass: "FloatParam", default: 90, wizard: "mask" },
    ],
  }],
};
// The mask creation wizard of emw-relion-mask_create (MaskCreateWizard):
// a fake tentative mask of the blobs map for the threshold, extend, soft
// edge and invert
const MASK_CREATE_PROTOCOL = "emw-relion-mask_create";
const MC = "relion_mask_create.volume.";
const MASK_CREATE_PARAMS = ["ini_threshold", "extend_inimask", "width_soft_edge", "lowpass"].map((n) => MC + n);
const MASK_CREATE_FORM = {
  name: MASK_CREATE_PROTOCOL,
  label: "Relion Mask Create",
  wizards: [{ id: "mask_create", label: "Mask creation wizard", params: MASK_CREATE_PARAMS }],
  sections: [{
    label: "Mask creation",
    params: [
      { name: "relion_mask_create.denovo", label: "De novo creation:", paramClass: "BooleanParam", default: false,
        help: "On: the wizard refuses to open." },
      { name: MC + "i", label: "Input volume:", paramClass: "PathParam", default: "Refine3D/job020/run_class001.mrc" },
      ...[["ini_threshold", "Initial threshold:", 0.3], ["extend_inimask", "Extend mask (px):", 0],
          ["width_soft_edge", "Soft edge width (px):", 0], ["lowpass", "Lowpass (Å):", -1]]
        .map(([n, label, d]) => ({ name: MC + n, label, paramClass: "FloatParam", default: d, wizard: "mask_create" })),
      { name: MC + "invert", label: "Invert mask:", paramClass: "BooleanParam", default: false },
    ],
  }],
};
const DEV_FORMS = { [WIZARD_PROTOCOL]: WIZARD_FORM, [MASK_PROTOCOL]: MASK_FORM,
                    [MASK_CREATE_PROTOCOL]: MASK_CREATE_FORM };
const wizardMenu = {
  Wizards: { text: "Wizards (dev)", value: null, icon: null, tag: null, openItem: true, visible: true,
    childs: [{ text: "Warp - Export Particles", value: WIZARD_PROTOCOL, icon: null, tag: "protocol",
               openItem: true, visible: true, childs: [] },
             { text: "Relion Tomo 3D Classification", value: MASK_PROTOCOL, icon: null, tag: "protocol",
               openItem: true, visible: true, childs: [] },
             { text: "Relion Mask Create", value: MASK_CREATE_PROTOCOL, icon: null, tag: "protocol",
               openItem: true, visible: true, childs: [] }] },
};
const FAKE_MAP_ANGPIX = 2;

// A 0-1 grid (z, y, x, uint8 base64, as EMhub's volume_density) of n^3
// voxels from f(x, y, z), each coordinate -1..1
function fakeGrid(n, f) {
  const u8 = new Uint8Array(n * n * n), c = (n - 1) / 2;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    u8[(z * n + y) * n + x] = Math.round(Math.max(0, Math.min(1, f((x - c) / c, (y - c) / c, (z - c) / c))) * 255);
  }
  let bin = "";
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
  return { shape: [n, n, n], binning: 1, data: btoa(bin), valueRange: [0, 1] };
}
// The map: three blobs; the mask: a soft ellipsoid around them
const BLOBS = [[-0.25, 0, 0, 0.22], [0.2, 0.15, 0.05, 0.18], [0.05, -0.25, -0.1, 0.15]];
const blobs = (x, y, z, grow = 0) => BLOBS.reduce(
  (v, [bx, by, bz, r]) => v + Math.exp(-((x - bx) ** 2 + (y - by) ** 2 + (z - bz) ** 2) / ((r + grow) ** 2)), 0);
const fakeMap = (n) => fakeGrid(n, blobs);
// Tentative mask of the blobs map (extend and soft edge in px of an n box)
function fakeCreatedMask(n, { threshold, extend = 0, soft_edge = 0, invert = false }) {
  const grow = (2 * extend) / n, edge = (2 * Math.max(soft_edge, 0.5)) / n;
  return fakeGrid(n, (x, y, z) => {
    const v = blobs(x, y, z, grow);
    const inside = Math.min(1, Math.max(0, 0.5 + (v - threshold) / (edge * 4)));
    return invert ? 1 - inside : inside;
  });
}
const fakeEllipsoid = (n) => fakeGrid(n, (x, y, z) =>
  Math.min(1, Math.max(0, (1.15 - Math.hypot(x / 0.6, y / 0.5, z / 0.45)) / 0.15)));
const FAKE_TS_ANGPIX = 1.5;

// With ?outputPrefix in the page url, outputs get a label prefix (as EMhub
// sends "Class01", "Class02"... for 3D classes): all but the first output of
// each protocol (to show both), in the graph and in the protocol details
const hasFakeOutputPrefixes = () => new URLSearchParams(location.search).has("outputPrefix");
const setFakeOutputPrefixes = (outputs) => {
  (outputs ?? []).forEach((output, i) => {
    output.prefix = i ? `Out${String(i).padStart(2, "0")}` : "";
  });
};
const withFakeOutputPrefixes = (project) => {
  if (hasFakeOutputPrefixes()) {
    Object.values(project.protocols ?? {}).forEach((prot) => setFakeOutputPrefixes(prot.outputs));
  }
  return project;
};

// Fake Tomograms table (as EMhub's get_table_view_data builds it), opened on
// outputs with pointerClass "Tomograms" (none in the fake project) or on any
// output when the page url has ?tomoTable; ?tomoTable=coords gives a
// TomoCoordinates table (Coordinates column, particles on the tomogram slices)
const isCoordsTable = () => new URLSearchParams(location.search).get("tomoTable") === "coords";
const FAKE_NCOORDS = [12, 7, 0];
const fakeTomogramsTable = () => ({
  title: isCoordsTable() ? "Tomo coordinates (3 items)" : "Tomograms (3 items)",
  // "Selected" and "Create subset" as EMhub adds them (project_widget_svc.html)
  columns: [
    { id: "selected", label: "Selected", align: "center", width: 70 },
    { id: "tomoName", label: "Tomo name", sortable: true },
    { id: "starFile", label: "Metadata", actions: [{ id: "metadata", label: "metadata" }] },
    ...(isCoordsTable() ? [{ id: "nCoords", label: "Coordinates", align: "right", sortable: true }] : []),
    { id: "tsTomo", label: "TS / Tomogram", width: 110 },
  ],
  rows: ["TS_0001", "TS_0002", "TS_0003"].map((name, i) => ({
    id: name,
    cells: { selected: true, tomoName: name, starFile: `${name}.star`, nCoords: FAKE_NCOORDS[i] },
    data: { tomoName: name },
    cellContexts: {
      selected: { edit: { type: "boolean", field: "selected" } },
      tsTomo: {
        actions: [
          { id: "ts-view", label: "Tilt series", icon: "tilt-series" },
          // TS_0003 has no tomogram yet
          ...(i < 2 ? [{ id: "tomo-view", label: "Tomogram", icon: "tomogram" }] : []),
        ],
      },
    },
  })),
  editActions: [{ id: "create-subset", label: "Create subset", requiresChanges: true }],
});

// Base64 PNG slices (no data: prefix) with the slice number drawn on them
const fakeSlices = (count, label, width = 256, height = 256) => {
  const slices = {};
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `hsl(210, 15%, ${20 + (50 * i) / count}%)`;
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = "#fff";
    ctx.font = "20px sans-serif";
    ctx.fillText(`${label} ${i + 1}`, 20, 40);
    slices[String(i)] = canvas.toDataURL("image/png").split(",")[1];
  }
  return slices;
};

// Picking template as EMhub sends it (coords3d.py): a surface in Å, centered;
// a cone pointing along +Z, so the particle orientations are visible
const coneTemplate = (radius, height, n = 16) => {
  const vertices = [0, 0, height / 2, 0, 0, -height / 2];
  const faces = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    vertices.push(radius * Math.cos(a), radius * Math.sin(a), -height / 2);
    const v = 2 + i, w = 2 + ((i + 1) % n);
    faces.push(0, v, w, 1, w, v);
  }
  return { vertices, faces };
};

// Density of the cone (z, y, x grid, uint8 base64, as EMhub's _template_density)
// with a denser core at its base, so the threshold changes what is drawn
function coneDensity(radius, height, voxel = 10, n = 34) {
  const u8 = new Uint8Array(n * n * n), c = (n - 1) / 2;
  for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const X = (x - c) * voxel, Y = (y - c) * voxel, Z = (z - c) * voxel;
    const r = radius * (0.5 - Z / height), d = Math.hypot(X, Y);
    const cone = Z >= -height / 2 && Z <= height / 2 && r > 0 ? Math.max(0, 1 - d / r) : 0;
    const core = Math.exp(-(X * X + Y * Y + (Z + height / 3) ** 2) / (radius * radius / 3));
    u8[(z * n + y) * n + x] = Math.round(Math.min(1, 0.5 * cone + core) * 255);
  }
  let bin = "";
  for (let i = 0; i < u8.length; i += 8192) bin += String.fromCharCode(...u8.subarray(i, i + 8192));
  return { shape: [n, n, n], data: btoa(bin), voxelSize: voxel, level: 0.2 };
}
// Plotly pane content of a value per tilt angle (-60..60)
const fakePlot = (title, yTitle, f, type = "scatter") => {
  const x = Array.from({ length: 41 }, (_, i) => -60 + 3 * i);
  return {
    kind: "plotly",
    title,
    figure: {
      data: [{ type, mode: "lines+markers", x, y: x.map(f) }],
      layout: { xaxis: { title: { text: "Tilt angle (°)" } }, yaxis: { title: { text: yTitle } } },
    },
  };
};

// Workflows by category (EMhub /api/list_workflows): builtin from menu.json
// (read-only), site and project kept in memory, written by saveWorkflow
const fakeWorkflows = {
  site: [
    { id: "site-spa-preprocessing", name: "Site SPA preprocessing",
      description: "Motion correction and CTF of the facility.", jobs: 2 },
  ],
  project: [
    { id: "my-picking", name: "My picking",
      description: "Picking and extraction saved from this project.", jobs: 3 },
  ],
};
const WORKFLOW_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const listFakeWorkflows = (category = "builtin") => {
  if (category === "builtin")
    return menu.workflows.map((wf) => ({ ...wf, id: wf.id ?? wf.name, category }));
  const list = fakeWorkflows[category];
  if (!list) throw new Error(`Invalid workflow category '${category}'`);
  return list.map((wf) => ({ ...wf, file: `${wf.id}.json`, category }))
    .sort((a, b) => a.id.localeCompare(b.id));
};

// Folders of the categories, as EMhub returns them with the list
const fakeWorkflowsFolder = (category = "builtin") => ({
  builtin: "/opt/emwrap/config/workflows",
  site: "/data/emhub/instance/workflows",
  project: `${fakeProjectPath()}/.emhub/workflows`,
})[category] ?? null;

// ?project=<name> opens the fake project as another project (same data,
// another path), to paste protocols copied in a tab without it
const fakeProjectPath = () => {
  const other = new URLSearchParams(location.search).get("project");
  return other ? `${workflow.path}-${other}` : workflow.path;
};
let fakeNextJobId = 9000;

export function createFakeService() {
  return {
    fetchList: async () => [],

    fetchProject: async () => {
      log("fetchProject");
      return withFakeOutputPrefixes(structuredClone(workflow));
    },

    fetchProtocolDetails: async (projectId, protocolId) => {
      const data = { info: {}, values: {}, form: {} };
      const prot = protocols[protocolId];
      if (prot) {
        data.info = structuredClone(prot.info);
        if (hasFakeOutputPrefixes()) setFakeOutputPrefixes(data.info.outputs);
        data.values = prot.values;
        data.form = forms[prot.info.protocolClassName] ?? {};
      }
      return data;
    },

    fetchNewProtocolDetails: async (projectId, protocolClass) => ({
      info: { protocolClassName: protocolClass },
      values: {},
      form: DEV_FORMS[protocolClass] ? structuredClone(DEV_FORMS[protocolClass]) : forms[protocolClass] ?? {},
    }),

    loadProtocols: async () => ({ ...wizardMenu, ...menu.protocols }),
    fetchWorkflows: async (category) => {
      log("fetchWorkflows", category);
      await new Promise((r) => setTimeout(r, 150));
      return { workflows: listFakeWorkflows(category), folder: fakeWorkflowsFolder(category) };
    },
    // Only checks that the workflow exists: no protocols are created
    loadWorkflow: async (projectId, info) => {
      const category = info.category ?? "builtin";
      const found = listFakeWorkflows(category).some((wf) => String(wf.id) === String(info.workflowId));
      log("loadWorkflow", category, info.workflowId, found);
      return found
        ? { status: 0, errors: [] }
        : { status: 1, errors: [`Workflow not found: ${category}/${info.workflowId}`] };
    },
    saveWorkflow: async (projectId, payload) => {
      log("saveWorkflow", payload);
      const { category, workflowId, overwrite } = payload;
      const list = fakeWorkflows[category];
      if (!list) throw new Error(`Invalid workflow category '${category}'`);
      if (!WORKFLOW_ID_RE.test(workflowId)) throw new Error(`Invalid workflow name '${workflowId}'`);
      if (!payload.protocolIds?.length) throw new Error("Missing protocols");
      const index = list.findIndex((wf) => wf.id === workflowId);
      if (index >= 0 && !overwrite) throw new Error(`Workflow '${workflowId}' already exists`);
      const wf = { id: workflowId, name: payload.name || workflowId,
                   description: payload.description ?? "", jobs: payload.protocolIds.length };
      if (index >= 0) list[index] = wf; else list.push(wf);
      return { id: workflowId, file: `${workflowId}.json`, category, protocolsCount: wf.jobs };
    },

    executeProtocol: async (projectId, protocolId, cls, params, mode) =>
      notImplemented(`executeProtocol(${mode})`, { protocolId, cls, params }),
    saveProtocol: async (projectId, protocolId, cls, params) =>
      notImplemented("saveProtocol", { protocolId, cls, params }),
    stopProtocol: async (projectId, ids) => notImplemented("stopProtocol", ids),
    deleteProtocol: async (projectId, ids) => notImplemented("deleteProtocol", ids),
    duplicateProtocol: async (projectId, items) => notImplemented("duplicateProtocol", items),
    exportProtocols: async (projectId, payload) => notImplemented("exportProtocols", payload),

    // Copy / paste of protocols (EMhub /api/get_workflow_jobs and
    // /api/load_workflow with a workflow): the paste only reports the new
    // ids, the fake graph does not change
    exportWorkflowProtocols: async (projectId, { protocolIds }) => {
      const jobs = protocolIds.map((id) => ({
        jobid: String(id),
        jobtype: workflow.protocols[id]?.label ?? "unknown",
        params: structuredClone(protocols[id]?.values ?? {}),
      }));
      log("exportWorkflowProtocols", jobs);
      return {
        sourceProjectId: projectId,
        sourceProjectName: `${workflow.name}${fakeProjectPath() === workflow.path ? "" : " (other)"}`,
        protocolIds: protocolIds.map(String),
        workflow: { jobs, project_path: fakeProjectPath() },
      };
    },
    importWorkflowProtocols: async (projectId, { workflow: copied }) => {
      await new Promise((r) => setTimeout(r, 300));
      const jobs = copied?.jobs ?? [];
      const copiedIds = new Set(jobs.map((j) => j.jobid));
      const same = copied?.project_path === fakeProjectPath();
      // Scipion-like pointers "<protocolId>.<output>" to protocols not copied
      const clearedInputs = same ? [] : jobs.flatMap((j) =>
        Object.entries(j.params ?? {})
          .filter(([, v]) => typeof v === "string" && /^\d+\./.test(v) && !copiedIds.has(v.split(".")[0]))
          .map(([param, value]) => ({ sourceId: j.jobid, param, value })));
      const created = jobs.map((j) => ({ sourceId: j.jobid, newId: String(fakeNextJobId++) }));
      log("importWorkflowProtocols", { same, created, clearedInputs });
      return { status: 0, errors: [], created, protocolsCount: created.length, clearedInputs };
    },

    renameProtocol: async (projectId, protocolId, { runName = "", comment = "" } = {}) => ({
      id: String(protocolId),
      runName,
      comment,
    }),

    resolveAnalyzeViewer: async (ctx) => {
      log("resolveAnalyzeViewer", ctx);
      // Volumes (and, with ?maskOutput, as masks): the volume viewer dialog,
      // as EMhub's /api/get_volume_viewer answers (inline here)
      if (ctx.pointerClass === "Volume" || ctx.pointerClass === "VolumeMask") {
        const asMask = ctx.pointerClass === "VolumeMask" || new URLSearchParams(location.search).has("maskOutput");
        const n = 64;
        return {
          handled: true, viewer: "volume", title: ctx.outputName, pointerClass: asMask ? "VolumeMask" : "Volume",
          data: { kind: "imageSlider", layout: "volume", dimensions: [n, n, n], voxelSize: FAKE_MAP_ANGPIX,
                  density: fakeMap(n), title: asMask ? "Mask MaskCreate/job011/mask.mrc over map.mrc" : "map.mrc",
                  viewerConfig: { tabs: { view3d: false }, initialTab: "volume3d",
                                  tools: { select: false, crosshair: false, particles: false },
                                  ...(asMask ? { mask: { type: "map", density: fakeEllipsoid(n), label: "mask.mrc" } } : {}) } },
        };
      }
      if (ctx.pointerClass === "Tomograms" || new URLSearchParams(location.search).has("tomoTable")) {
        return {
          handled: true,
          viewer: "table",
          title: ctx.outputName,
          context: { projectId: ctx.projectId, protocolId: ctx.protocolId, outputName: ctx.outputName },
          table: fakeTomogramsTable(),
        };
      }
      return { handled: false };
    },

    executeTableViewerEditAction: async (context, request) => {
      log("executeTableViewerEditAction", request);
      const deselected = request.edits.filter((edit) => !edit.value).map((edit) => edit.rowId);
      return {
        success: true,
        message: `Fake subset without: ${deselected.join(", ") || "none"}`,
        clearEdits: true,
        refreshProject: true,
      };
    },
    resolveTableViewerAction: async (context, request) => {
      log("resolveTableViewerAction", request);
      // A host round trip, so the pane shows its loading state
      await new Promise((resolve) => setTimeout(resolve, 700));
      const name = request.rowData?.tomoName ?? request.rowId;
      if (request.actionId === "ts-view") {
        // Other grid layouts with ?gridLayout=cols|rows|span-top|span-bottom|span-left|span-right
        const layout = new URLSearchParams(location.search).get("gridLayout") ?? "2x2";
        const contents = [
          { kind: "imageSlider", title: "Slices", sliderPrefix: "Tilt: ",
            sliceLabelOffset: 1, slices: fakeSlices(41, `${name} tilt`, 360, 256) },
          fakePlot("Tilt angles", "Dose (e-/Å²)", (a) => 3.1 * Math.abs(a) / 3),
          fakePlot("Motion", "Accumulated motion (Å)", (a) => 2 + Math.abs(a) / 20),
          // TS_0003: a cell that failed on the host
          name === "TS_0003"
            ? { kind: "empty", title: "Defocus", message: "STAR file is missing columns: rlnDefocusU, rlnDefocusV" }
            : fakePlot("Defocus", "Defocus (µm)", (a) => 3 + Math.abs(a) / 60),
        ];
        const slots = {
          "2x2": ["topLeft", "topRight", "bottomLeft", "bottomRight"],
          cols: ["left", "right"],
          rows: ["top", "bottom"],
          "span-top": ["top", "bottomLeft", "bottomRight"],
          "span-bottom": ["topLeft", "topRight", "bottom"],
          "span-left": ["left", "topRight", "bottomRight"],
          "span-right": ["topLeft", "bottomLeft", "right"],
        }[layout] ?? [];
        return {
          kind: "grid",
          title: `Tilt series — ${name}`,
          layout,
          cells: Object.fromEntries(slots.map((slot, i) => [slot, contents[i]])),
        };
      }
      if (request.actionId === "tomo-view") {
        if (isCoordsTable()) {
          // X/Y/Z volume slices with the particles of this tomogram
          const n = FAKE_NCOORDS[["TS_0001", "TS_0002"].indexOf(name)] ?? 0;
          // RELION angles (rot, tilt, psi) and the template: the 3D tab can
          // show the template at each particle with its orientation
          const coordinates = { x: [], y: [], z: [], angles: [], template: { ...coneTemplate(60, 220), density: coneDensity(60, 220) } };
          for (let i = 0; i < n; i++) {
            coordinates.x.push(40 + ((i * 37) % 180));
            coordinates.y.push(20 + ((i * 71) % 140));
            coordinates.z.push(20 + ((i * 5) % 24));
            coordinates.angles.push([(i * 47) % 360, (i * 29) % 180, (i * 13) % 360]);
          }
          // Slices with the volume aspect: Z is X x Y, Y is X x Z, X is Y x Z
          const axis = (count, label, w, h) => ({ sliderPrefix: `${label}: `, slices: fakeSlices(count, `${name} ${label}`, w, h) });
          return { kind: "imageSlider", title: `Tomogram — ${name}`, layout: "volume",
                   dimensions: [256, 180, 64], initialSlice: 32, voxelSize: 13.48,
                   axes: { x: axis(256, "X", 180, 64), y: axis(180, "Y", 256, 64), z: axis(64, "Z", 256, 180) },
                   coordinates };
        }
        return { kind: "imageSlider", title: `Tomogram — ${name}`, sliderPrefix: "Slice: ",
                 slices: fakeSlices(32, `${name} slice`, 360, 256) };
      }
      return { kind: "text", title: request.actionId, text: `Fake ${request.actionId} of ${name}` };
    },

    resolveBrowserPaths: async (projectId, protocolId) => ({
      rootAbs: workflow.path,
      startPath: protocolId ?? ".",
      protocolRoot: protocolId,
    }),
    listRemoteDirectory: async () => [
      { name: "extra", path: "extra", isDir: true, size: null, mime: null },
      { name: "logs", path: "logs", isDir: true, size: null, mime: null },
      { name: "run.out", path: "run.out", isDir: false, size: 2048, mime: "text" },
    ],
    previewRemoteEntry: async (projectId, protocolId, path) => ({
      kind: "text",
      mime: "text/plain",
      meta: { name: path },
      truncated: false,
      text: `Fake content of ${path}\n`,
    }),

    fetchProtocolLogChannels: async () => ({
      channels: [
        { id: "run.out", label: "run.out", order: 0 },
        { id: "run.err", label: "run.err", order: 1 },
      ],
    }),
    fetchProtocolLogsChunk: async (projectId, protocolId, offsets) => ({
      chunks: [
        {
          channel: "run.out",
          content: offsets?.["run.out"] ? "" : `Simulated log of protocol ${protocolId}\n`,
          offset: 40,
        },
        { channel: "run.err", content: "", offset: 0 },
      ],
    }),

    listProjectTags: async () => tags,
    createProjectTag: async (projectId, payload) => {
      const tag = { ...payload, id: `t-${Date.now()}` };
      tags = [...tags, tag];
      return tag;
    },
    updateProjectTag: async (projectId, tagId, payload) => {
      tags = tags.map((t) => (t.id === tagId ? { ...t, ...payload, id: tagId } : t));
      return tags.find((t) => t.id === tagId);
    },
    deleteProjectTag: async (projectId, tagId) => {
      tags = tags.filter((t) => t.id !== tagId);
      return { success: true };
    },
    listProtocolTagIds: async (projectId, protocolId) => ({
      protocolId,
      tagIds: protocolTags[protocolId] ?? [],
    }),
    setProtocolTagIds: async (projectId, protocolId, tagIds) => {
      protocolTags[protocolId] = tagIds;
      return { tagIds };
    },

    // Fake ExportTomoParticlesWizard with the Warp adaptor, and
    // VolumeMaskWizard with the Relion Class3D one
    openWizard: async (projectId, protocolId, cls, wizardId, params) => {
      log("openWizard", { protocolId, cls, wizardId, params });
      if (wizardId === "mask_create") {
        if (params["relion_mask_create.denovo"] === true || params["relion_mask_create.denovo"] === "Yes")
          return { errors: ["The wizard creates masks from a volume: turn off 'De novo creation'."] };
        if (!params[MC + "i"]) return { errors: ["Select the input volume before opening the wizard."] };
        const n = 64, lowpass = parseFloat(params[MC + "lowpass"]);
        const inputs = { threshold: parseFloat(params[MC + "ini_threshold"]) || 0.3,
                         lowpass: lowpass > 0 ? lowpass : null,
                         extend: parseInt(params[MC + "extend_inimask"]) || 0,
                         soft_edge: parseInt(params[MC + "width_soft_edge"]) || 0,
                         invert: params[MC + "invert"] === true };
        const mask = fakeCreatedMask(n, inputs);
        return {
          id: wizardId, label: "Mask creation wizard", ui: "MaskCreateWizard", inputs,
          data: { volume: { kind: "volume", path: params[MC + "i"], dimensions: [n, n, n], voxelSize: FAKE_MAP_ANGPIX,
                            density: fakeMap(n) },
                  angpix: FAKE_MAP_ANGPIX, binning: 1, value_range: [0, 1], mask, mask_fraction: 0.1 },
          warnings: [],
        };
      }
      if (wizardId === "mask") {
        if (!params.fn_ref) return { errors: ["Select the input map before opening the wizard."] };
        const n = 64, dims = [n, n, n];
        const volume = { kind: "volume", path: params.fn_ref, dimensions: dims, voxelSize: FAKE_MAP_ANGPIX,
                         density: fakeMap(n) };
        const mask = params.fn_mask ? { kind: "volume", path: params.fn_mask, dimensions: dims,
                                        voxelSize: FAKE_MAP_ANGPIX, density: fakeEllipsoid(n) } : null;
        return {
          id: wizardId, label: "Mask wizard", ui: "VolumeMaskWizard",
          inputs: { mask_type: mask ? "map" : "sphere",
                    diameter: parseFloat(params.particle_diameter) || 0.8 * n * FAKE_MAP_ANGPIX },
          data: { volume, mask, angpix: FAKE_MAP_ANGPIX, box_angst: n * FAKE_MAP_ANGPIX },
          warnings: mask ? ["The mask map is used, the spherical mask (diameter) is not shown."] : [],
        };
      }
      if (!params.input_tomograms)
        return { errors: ["Select the input tomograms (or an optimisation set with tomograms) before opening the wizard."] };
      const outAngpix = parseFloat(params["ts_export_particles.output_angpix"]) || FAKE_TS_ANGPIX;
      const outBox = parseInt(params["ts_export_particles.box"]) || 0;
      const inBox = Math.round(outBox * outAngpix / FAKE_TS_ANGPIX);
      return {
        id: wizardId, label: "Box and pixel size wizard", ui: "ExportTomoParticlesWizard",
        inputs: { in_box: inBox, out_angpix: outAngpix, out_box: outBox, binning: outAngpix / FAKE_TS_ANGPIX,
                  // Form diameter, else half of the input box
                  diameter: parseFloat(params["ts_export_particles.diameter"])
                    || (inBox ? inBox * FAKE_TS_ANGPIX / 2 : null) },
        data: { tomograms: params.input_tomograms, tomograms_count: 12, in_angpix: FAKE_TS_ANGPIX },
        warnings: [],
      };
    },
    previewWizard: async (projectId, protocolId, cls, wizardId, params, outputs) => {
      log("previewWizard", { wizardId, outputs });
      await new Promise((resolve) => setTimeout(resolve, 1000));
      if (!Number.isFinite(outputs.threshold)) return { errors: ["The initial threshold should be a number."] };
      const mask = fakeCreatedMask(64, outputs);
      const u8 = Uint8Array.from(atob(mask.data), (c) => c.charCodeAt(0));
      const fraction = u8.reduce((a, v) => a + v, 0) / (255 * u8.length);
      return { data: { mask, mask_fraction: fraction },
               warnings: fraction === 0 ? ["The mask is empty: lower the threshold."] : [] };
    },
    applyWizard: async (projectId, protocolId, cls, wizardId, params, outputs) => {
      log("applyWizard", { wizardId, params, outputs });
      if (wizardId === "mask_create") {
        return { params: { [MC + "ini_threshold"]: outputs.threshold, [MC + "lowpass"]: outputs.lowpass ?? -1,
                           [MC + "extend_inimask"]: outputs.extend, [MC + "width_soft_edge"]: outputs.soft_edge,
                           [MC + "invert"]: outputs.invert }, warnings: [] };
      }
      if (wizardId === "mask") {
        if (params.fn_mask) return { params: {}, warnings: [] };
        if (!(outputs.diameter > 0)) return { errors: ["The mask diameter should be a positive number."] };
        return { params: { particle_diameter: Math.round(outputs.diameter * 100) / 100 }, warnings: [] };
      }
      const errors = [];
      if (!(outputs.out_angpix > 0)) errors.push("The output pixel size should be a positive number.");
      if (!(outputs.in_box > 0)) errors.push("The input box size should be a positive integer.");
      if (!(outputs.out_box > 0)) errors.push("The output box size should be a positive integer.");
      if (errors.length) return { errors };
      return {
        params: { "ts_export_particles.output_angpix": outputs.out_angpix,
                  "ts_export_particles.box": Math.round(outputs.out_box),
                  "ts_export_particles.diameter": outputs.diameter },
        warnings: outputs.out_box % 2 ? [`The output box size (${outputs.out_box} px) is odd.`] : [],
      };
    },

    getContextMenuVisibilityPolicy: async () => ({
      open: true,
      browse: true,
      rename: true,
      duplicate: true,
      copyWorkflow: true,
      pasteWorkflow: true,
      delete: true,
      restart: false,
      continue: false,
      reset: false,
      stop: true,
      selectFrom: true,
      selectTo: true,
      manageTags: true,
      openProtocolClass: true,
      export: true,
      upload: false,
      nextSteps: false,
    }),
  };
}
