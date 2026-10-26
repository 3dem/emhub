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

// Fake Tomograms table (as EMhub's get_table_view_data builds it), opened on
// outputs with pointerClass "Tomograms" (none in the fake project) or on any
// output when the page url has ?tomoTable
const fakeTomogramsTable = () => ({
  title: "Tomograms (3 items)",
  columns: [
    { id: "tomoName", label: "Tomo name" },
    { id: "starFile", label: "Metadata", actions: [{ id: "metadata", label: "metadata" }] },
    { id: "tsTomo", label: "TS / Tomogram", width: 110 },
    { id: "plots", label: "Plots" },
  ],
  rows: ["TS_0001", "TS_0002", "TS_0003"].map((name, i) => ({
    id: name,
    cells: { tomoName: name, starFile: `${name}.star` },
    data: { tomoName: name },
    cellContexts: {
      plots: {
        actions: [
          { id: "tilt-angles", label: "tilt angles" },
          { id: "motion", label: "motion" },
          { id: "defocus", label: "defocus" },
        ],
      },
      tsTomo: {
        actions: [
          { id: "ts-view", label: "Tilt series", icon: "tilt-series" },
          // TS_0003 has no tomogram yet
          ...(i < 2 ? [{ id: "tomo-view", label: "Tomogram", icon: "tomogram" }] : []),
        ],
      },
    },
  })),
});

// Base64 PNG slices (no data: prefix) with the slice number drawn on them
const fakeSlices = (count, label) => {
  const slices = {};
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = `hsl(210, 15%, ${20 + (50 * i) / count}%)`;
    ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = "#fff";
    ctx.font = "20px sans-serif";
    ctx.fillText(`${label} ${i + 1}`, 20, 40);
    slices[String(i)] = canvas.toDataURL("image/png").split(",")[1];
  }
  return slices;
};

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

    fetchProject: async () => structuredClone(workflow),

    fetchProtocolDetails: async (projectId, protocolId) => {
      const data = { info: {}, values: {}, form: {} };
      const prot = protocols[protocolId];
      if (prot) {
        data.info = prot.info;
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

    resolveTableViewerAction: async (context, request) => {
      log("resolveTableViewerAction", request);
      const name = request.rowData?.tomoName ?? request.rowId;
      if (request.actionId === "ts-view") {
        // Other grid layouts with ?gridLayout=cols|rows|span-top|span-bottom|span-left|span-right
        const layout = new URLSearchParams(location.search).get("gridLayout") ?? "2x2";
        const contents = [
          { kind: "imageSlider", title: "Slices", sliderPrefix: "Tilt: ",
            sliceLabelOffset: 1, slices: fakeSlices(41, `${name} tilt`) },
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
        return { kind: "imageSlider", title: `Tomogram — ${name}`, sliderPrefix: "Slice: ",
                 slices: fakeSlices(32, `${name} slice`) };
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
