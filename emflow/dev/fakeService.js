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
      form: forms[protocolClass] ?? {},
    }),

    loadProtocols: async () => menu.protocols,
    fetchWorkflows: async () => menu.workflows,
    loadWorkflow: async (projectId, info) => notImplemented("loadWorkflow", info),

    executeProtocol: async (projectId, protocolId, cls, params, mode) =>
      notImplemented(`executeProtocol(${mode})`, { protocolId, cls, params }),
    saveProtocol: async (projectId, protocolId, cls, params) =>
      notImplemented("saveProtocol", { protocolId, cls, params }),
    stopProtocol: async (projectId, ids) => notImplemented("stopProtocol", ids),
    deleteProtocol: async (projectId, ids) => notImplemented("deleteProtocol", ids),
    duplicateProtocol: async (projectId, items) => notImplemented("duplicateProtocol", items),
    exportProtocols: async (projectId, payload) => notImplemented("exportProtocols", payload),

    renameProtocol: async (projectId, protocolId, { runName = "", comment = "" } = {}) => ({
      id: String(protocolId),
      runName,
      comment,
    }),

    resolveAnalyzeViewer: async (ctx) => {
      log("resolveAnalyzeViewer", ctx);
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

    getContextMenuVisibilityPolicy: async () => ({
      open: true,
      browse: true,
      rename: true,
      duplicate: true,
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
