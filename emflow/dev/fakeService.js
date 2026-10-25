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
      return { handled: false };
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
