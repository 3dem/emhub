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
// The template wizard of emw-pytom-create_template (PyTomTemplateWizard):
// the blobs map as template (fake operations) and a soft sphere as mask
const PYTOM_PROTOCOL = "emw-pytom-create_template";
const PT = "pytom_create_template.", PM = "pytom_create_mask.";
const PYTOM_FORM = {
  name: PYTOM_PROTOCOL,
  label: "PyTom Create Template",
  wizards: [{ id: "template", label: "Template and mask wizard",
              params: [PT + "input-voxel-size-angstrom", PT + "output-voxel-size-angstrom", PM + "radius", PM + "sigma"] }],
  sections: [{
    label: "Create",
    params: [
      { name: PT + "input-map", label: "Input map (MAP)", paramClass: "PathParam", default: "Refine3D/job020/run_class001.mrc" },
      { label: "Voxel Size (A)", paramClass: "Line", params: [
        { name: PT + "input-voxel-size-angstrom", label: "Input", paramClass: "FloatParam", default: 2, wizard: "template" },
        { name: PT + "output-voxel-size-angstrom", label: "Output", paramClass: "FloatParam", default: 4, wizard: "template" }] },
      { name: PT + "box-size", label: "Output box size (px)", paramClass: "IntParam", default: 32 },
      { name: PM + "radius", label: "Radius (px)", paramClass: "FloatParam", default: 12, wizard: "template" },
      { name: PM + "sigma", label: "Sigma (px)", paramClass: "FloatParam", default: 1, wizard: "template" },
    ],
  }],
};
const fakePyTomData = ({ box = 32, radius = 12, sigma = 1, invert = false, out_angpix = 4 }) => {
  const r = (2 * radius) / box, s = (2 * Math.max(sigma, 0.01)) / box;
  return {
    template: fakeGrid(box, (x, y, z) => (invert ? 1 - blobs(x, y, z) : blobs(x, y, z))),
    mask: fakeGrid(box, (x, y, z) => { const d = Math.hypot(x, y, z) - r; return d <= 0 ? 1 : Math.exp(-0.5 * (d / s) ** 2); }),
    binning: 1, box, angpix: out_angpix,
  };
};
// The geometry mask wizard of emw-geometry-mask (GeometryMaskWizard): the
// union of the shapes (as emwrap.base.geometry_mask) over the blobs map;
// an empty input volume uses the box size (the mask alone)
const GEOMETRY_PROTOCOL = "emw-geometry-mask";
const GEOMETRY_COLUMNS = ["shape", "center_x", "center_y", "center_z", "rot", "tilt", "psi",
                          "radius", "height", "size_x", "size_y", "size_z"];
const GEOMETRY_FORM = {
  name: GEOMETRY_PROTOCOL,
  label: "EMwrap Geometry Mask",
  wizards: [{ id: "geometry_mask", label: "Geometry mask wizard", params: ["soft_edge", "shapes"] }],
  sections: [{
    label: "Input",
    params: [
      { name: "input_volume", label: "Input volume (optional):", paramClass: "PathParam", default: "Refine3D/job020/run_class001.mrc" },
      { label: "Box size (px)", paramClass: "Line", params: ["x", "y", "z"].map((a) =>
        ({ name: `box_${a}`, label: `${a.toUpperCase()}:`, paramClass: "IntParam", default: 64 })) },
      { name: "soft_edge", label: "Soft edge (px):", paramClass: "FloatParam", default: 0, wizard: "geometry_mask" },
      { label: "Shapes", paramClass: "Group", params: [
        { name: "shapes", label: "Shapes", paramClass: "TableParam", wizard: "geometry_mask",
          params: GEOMETRY_COLUMNS.map((n) => ({ name: n, label: n, paramClass: n === "shape" ? "StringParam" : "FloatParam" })) }] },
    ],
  }],
};
const SIZES = { sphere: ["radius"], cylinder: ["radius", "height"], box: ["size_x", "size_y", "size_z"] };
const geometryShape = (kind, n) => ({ shape: kind, center_x: n / 2, center_y: n / 2, center_z: n / 2, rot: 0, tilt: 0, psi: 0,
  ...(kind === "sphere" ? { radius: n / 4 } : kind === "cylinder" ? { radius: n / 6, height: n / 2 }
      : { size_x: n / 3, size_y: n / 3, size_z: n / 3 }) });
function eulerMatrix(rot, tilt, psi) {
  const [a, b, g] = [rot, tilt, psi].map((v) => (v * Math.PI) / 180);
  const [ca, sa, cb, sb, cg, sg] = [Math.cos(a), Math.sin(a), Math.cos(b), Math.sin(b), Math.cos(g), Math.sin(g)];
  return [[cg * cb * ca - sg * sa, cg * cb * sa + sg * ca, -cg * sb],
          [-sg * cb * ca - cg * sa, -sg * cb * sa + cg * ca, sg * sb], [sb * ca, sb * sa, cb]];
}
// Signed distance (px) of local coordinates to the shape surface (negative inside)
function shapeDistance(s, u, v, w) {
  if (s.shape === "sphere") return Math.hypot(u, v, w) - s.radius;
  const q = s.shape === "cylinder" ? [Math.hypot(u, v) - s.radius, Math.abs(w) - s.height / 2]
    : [Math.abs(u) - s.size_x / 2, Math.abs(v) - s.size_y / 2, Math.abs(w) - s.size_z / 2];
  return Math.hypot(...q.map((c) => Math.max(c, 0))) + Math.min(Math.max(...q), 0);
}
function fakeGeometryMask(n, shapes, softEdge = 0) {
  const ms = shapes.map((s) => ({ s, A: eulerMatrix(+s.rot || 0, +s.tilt || 0, +s.psi || 0) }));
  return fakeGrid(n, (x, y, z) => {
    const p = [x, y, z].map((v) => ((v + 1) * (n - 1)) / 2);
    const d = Math.min(...ms.map(({ s, A }) => {
      const r = [p[0] - s.center_x, p[1] - s.center_y, p[2] - s.center_z];
      const [u, v, w] = A.map((a) => a[0] * r[0] + a[1] * r[1] + a[2] * r[2]);
      return shapeDistance(s, u, v, w);
    }));
    if (softEdge > 0) return 0.5 + 0.5 * Math.cos(Math.PI * Math.min(Math.max(d / softEdge, 0), 1));
    return d <= 0 ? 1 : 0;
  });
}
const geometryErrors = (shapes) => shapes.length ? shapes.flatMap((s, i) =>
  !SIZES[s.shape] ? [`Shape ${i + 1}: unknown shape '${s.shape}'.`]
    : SIZES[s.shape].filter((k) => !(s[k] > 0)).map((k) => `Shape ${i + 1} (${s.shape}): '${k}' should be a positive number.`))
  : ["Add at least one shape to the mask."];
const DEV_FORMS = { [WIZARD_PROTOCOL]: WIZARD_FORM, [MASK_PROTOCOL]: MASK_FORM,
                    [MASK_CREATE_PROTOCOL]: MASK_CREATE_FORM, [PYTOM_PROTOCOL]: PYTOM_FORM,
                    [GEOMETRY_PROTOCOL]: GEOMETRY_FORM };
const wizardMenu = {
  Wizards: { text: "Wizards (dev)", value: null, icon: null, tag: null, openItem: true, visible: true,
    childs: [{ text: "Warp - Export Particles", value: WIZARD_PROTOCOL, icon: null, tag: "protocol",
               openItem: true, visible: true, childs: [] },
             { text: "Relion Tomo 3D Classification", value: MASK_PROTOCOL, icon: null, tag: "protocol",
               openItem: true, visible: true, childs: [] },
             { text: "Relion Mask Create", value: MASK_CREATE_PROTOCOL, icon: null, tag: "protocol",
               openItem: true, visible: true, childs: [] },
             { text: "PyTom Create Template", value: PYTOM_PROTOCOL, icon: null, tag: "protocol",
               openItem: true, visible: true, childs: [] },
             { text: "Geometry Mask", value: GEOMETRY_PROTOCOL, icon: null, tag: "protocol",
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
// A 3D classes table of one Relion iteration (as EMhub's
// build_classes3d_table), with the job's iterations as variants
function fakeClasses3DTable(it) {
  const n = 4;
  const name = (k) => `run_it${String(k).padStart(3, "0")}_optimiser.star`;
  const rows = Array.from({ length: n }, (_, i) => {
    const particles = Math.round(4000 * (1 + Math.sin(i + it / 5)) + 500);
    return { id: i + 1, data: {}, cells: { classId: i + 1, volume: `run_it${String(it).padStart(3, "0")}_class00${i + 1}.mrc`,
      particles, percent: 25, resolution: Math.round((40 - it * 1.1 + i * 2.5) * 100) / 100 } };
  });
  return {
    title: `3D classes — Iteration ${it} (${n} classes)`,
    columns: [
      { id: "classId", label: "Class", sortable: true }, { id: "volume", label: "Volume" },
      { id: "particles", label: "Particles", sortable: true }, { id: "percent", label: "% Particles", sortable: true },
      { id: "resolution", label: "Resolution (Å)", sortable: true },
    ],
    rows,
    variants: { label: "Iteration", value: name(it), options: Array.from({ length: 26 }, (_, k) => ({ id: name(k), label: `Iteration ${k}` })) },
  };
}

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
  // &initialAction[=<row>:<action>] opens that action with the table
  // (default TS_0001:ts-view, an action of the TS / Tomogram column)
  ...fakeInitialAction(),
});

// Fake 'Coordinates Distances' job view of emw-coordinates-compare (as
// EMhub's CoordinatesCompareView builds it): ?compareTable for A vs B,
// ?compareTable=self for a set compared to itself (duplicates). Its
// tomogram pane has the particles in sets, recomputed at another distance
// by the fake DataLoader transport (fakeDataRequest, FAKE_SETS_PATH).
const compareMode = () => new URLSearchParams(location.search).get("compareTable");
const FAKE_SETS_PATH = "/fake/coordinates_compare_sets";
const FAKE_COMPARE_ANGPIX = 13.48;
const FAKE_EDGE_SET = { id: "edge", label: "Near edge", color: "#ff3b30" };
const FAKE_COMPARE_SELF = [
  { id: "kept", label: "Kept", color: "#ffa500" },
  { id: "duplicates", label: "Duplicates", color: "#ff2bd6" },
  FAKE_EDGE_SET,
];
const FAKE_COMPARE_DIMS = [256, 180, 64];
const FAKE_COMPARE_CROSS = [
  { id: "a-b", label: "A - B", color: "#ffa500" },
  { id: "b-a", label: "B - A", color: "#29b6f6" },
  { id: "a&b", label: "A & B", color: "#4cd964" },
  { id: "b&a", label: "B & A", color: "#4cd964", hidden: true },
  FAKE_EDGE_SET,
];

// Voxel positions of A and B of a tomogram: B has half of A, moved a little
// (1-6 voxels), and its own particles
function fakeComparePoints(name) {
  const seed = name.charCodeAt(name.length - 1);
  const a = [], b = [];
  // A different number of particles per tomogram (60, 70, 80)
  for (let i = 0; i < 60 + (seed % 3) * 10; i++) {
    a.push([20 + ((i * 37 + seed) % 216), 15 + ((i * 71 + seed) % 150), 8 + ((i * 13) % 48)]);
  }
  a.forEach((p, i) => { if (i % 2 === 0) b.push([p[0] + (i % 6) + 1, p[1], p[2]]); });
  for (let i = 0; i < 25; i++) b.push([30 + ((i * 53) % 200), 25 + ((i * 29) % 130), 10 + ((i * 7) % 44)]);
  // Self: A with a few duplicates (a later particle 1-3 voxels away)
  const self = [...a];
  for (let i = 0; i < 8; i++) self.splice(i * 7 + 1, 0, [a[i * 7][0] + 1 + (i % 3), a[i * 7][1], a[i * 7][2]]);
  return { a, b, self };
}

// As EMhub's: the particles closer than edge (A) to the box edges are in
// the Near edge set, and left out of the others
function fakeCompareSets(name, distance, self, edge = 0) {
  const { a, b, self: s } = fakeComparePoints(name);
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]) * FAKE_COMPARE_ANGPIX;
  const near = (p) => edge > 0 && Math.min(...p.map((v, i) => Math.min(v, FAKE_COMPARE_DIMS[i] - v)))
    * FAKE_COMPARE_ANGPIX < edge;
  let set;
  if (self) {
    // Relion's rule: a duplicate has a later particle within the distance
    set = s.map((p, i) => (near(p) ? 2
      : s.some((q, j) => j > i && !near(q) && d(p, q) <= distance) ? 1 : 0));
  } else {
    const a2 = a.filter((p) => !near(p)), b2 = b.filter((q) => !near(q));
    set = [...a.map((p) => (near(p) ? 4 : b2.some((q) => d(p, q) <= distance) ? 2 : 0)),
           ...b.map((q) => (near(q) ? 4 : a2.some((p) => d(p, q) <= distance) ? 3 : 1))];
  }
  return { set, sets: self ? FAKE_COMPARE_SELF : FAKE_COMPARE_CROSS, distance, edge };
}

// As EMhub's: the edge distance is the duplicates (or A & B) one by default
function fakeCompareTable(distance = 30, edge = distance) {
  const self = compareMode() === "self";
  const names = ["TS_0001", "TS_0002", "TS_0003"];
  const columns = self
    ? [["coords", "Coordinates"], ["edge", "Near edge"], ["duplicates", "Duplicates"], ["kept", "Kept"]]
    : [["a", "A"], ["b", "B"], ["edge", "Near edge"], ["aMinusB", "A - B"], ["bMinusA", "B - A"], ["aAndB", "A & B"]];
  const { a: pa, b: pb } = fakeComparePoints(names[0]);
  const rows = names.map((name) => {
    const { set } = fakeCompareSets(name, distance, self, edge);
    const n = (k) => set.filter((v) => v === k).length;
    const cells = self
      ? { coords: set.length, edge: n(2), duplicates: n(1), kept: n(0) }
      : { a: pa.length, b: pb.length, edge: n(4), aMinusB: n(0), bMinusA: n(1), aAndB: n(2) };
    return {
      id: name,
      cells: { ...cells, tomoName: name, distance, edgeDistance: edge },
      data: { tomoName: name, distance, edgeDistance: edge },
      actions: [],
      defaultAction: { id: "tomo-view", label: "Tomogram", icon: "tomogram" },
      cellContexts: {
        tomo: { actions: [{ id: "tomo-view", label: "Tomogram", icon: "tomogram" }] },
        // As EMhub's: the sets to merge, checked, next to their count
        ...(!self && Object.fromEntries(["aMinusB", "bMinusA", "aAndB"].map((col) => [
          col, { edit: { type: "boolean", field: col, checked: true, disabled: !cells[col] } }]))),
      },
    };
  });
  return {
    title: `Coordinates Distances — External/job012 (${self ? "duplicates" : "A vs B"}, ${distance} Å; 3 tomograms)`,
    columns: [
      { id: "tomoName", label: "Tomo name", align: "left", sortable: true },
      ...columns.map(([id, label]) => ({ id, label, align: "right", sortable: true })),
      { id: "tomo", label: "Tomogram" },
    ],
    rows,
    // The distances are those of the tomogram viewer (TableValuesContext)
    variants: { label: "Distance (Å)", value: `coordinates-compare:${distance}:${edge}`, options: [],
                template: "coordinates-compare:{distance}:{edge}", values: { distance, edge } },
    initialAction: { rowId: names[0], actionId: "tomo-view" },
    // As EMhub's (an emw-subset-ts job, Remove duplicate particles mode)
    editActions: self
      ? [{ id: "remove-duplicates", label: edge ? "Remove duplicates / edges" : "Remove duplicates",
           disabled: !rows.some((row) => row.cells.duplicates || row.cells.edge) }]
      : [{ id: "merge-sets", label: "Merge" }],
  };
}

function fakeComparePane(name, distance, edge = distance) {
  const self = compareMode() === "self";
  const { a, b, self: s } = fakeComparePoints(name);
  const points = self ? s : [...a, ...b];
  const { set, sets } = fakeCompareSets(name, distance, self, edge);
  const axis = (count, label, w, h) => ({ sliderPrefix: `${label}: `, slices: fakeSlices(count, `${name} ${label}`, w, h) });
  return {
    kind: "imageSlider", title: `Tomogram — ${name}`, layout: "volume",
    dimensions: [256, 180, 64], initialSlice: 32, voxelSize: FAKE_COMPARE_ANGPIX,
    axes: { x: axis(256, "X", 180, 64), y: axis(180, "Y", 256, 64), z: axis(64, "Z", 256, 180) },
    viewerConfig: { tabs: { volume3d: false }, defaults: { particles: { nearSlices: false } } },
    coordinates: {
      x: points.map((p) => p[0]), y: points.map((p) => p[1]), z: points.map((p) => p[2]),
      set, sets,
      // As EMhub's: each input in the group of the set it decides
      recompute: { inputs: [{ id: "distance", set: self ? "duplicates" : "a&b", label: "within", unit: "Å",
                              value: distance, title: "Distance of the " + (self ? "duplicates" : "coordinates in A & B") },
                            { id: "edge", set: "edge", label: "within", unit: "Å", value: edge, margin: true,
                              title: "Distance to the tomogram box edges (0: none)" }],
                   source: { path: FAKE_SETS_PATH, payload: { tomoName: name } } },
    },
  };
}

/** DataLoader transport of the dev page: the fake requests, else a POST of
 * the payload (as the default transport). */
export async function fakeDataRequest(path, payload, init) {
  if (path === FAKE_SETS_PATH) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    if (!(payload.distance > 0)) throw new Error(`Invalid distance: ${payload.distance}`);
    return { coordinates: fakeCompareSets(payload.tomoName, payload.distance,
                                          compareMode() === "self", payload.edge ?? 0) };
  }
  const r = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify(payload ?? {}), signal: init?.signal });
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

function fakeInitialAction() {
  const value = new URLSearchParams(location.search).get("initialAction");
  if (value === null) return {};
  const [rowId, actionId] = (value || "TS_0001:ts-view").split(":");
  return { initialAction: { rowId, actionId, columnId: "tsTomo" } };
}

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

// A tilt series pane (kind "tiltSeries") as build_tilt_series_viewer_pane_content
// sends it: gold beads at fixed 3D positions projected on each tilt
// (-60..60°, dose-symmetric movie order) and then rotated by rlnTomoZRot and
// shifted, as acquired. "Apply alignment" must undo exactly that: the beads
// then move only across a vertical tilt axis. Every 7th tilt is off by 40 Å.
export const fakeTiltSeries = (name, w = 360, h = 256, pixelSize = 10) => {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const beads = Array.from({ length: 14 }, (_, i) => [
    ((i * 73) % 200) - 100, ((i * 47) % 180) - 90, ((i * 31) % 60) - 30]);   // x, y, z (px)
  const zRot = -85.6, rot = (zRot * Math.PI) / 180;
  const order = [0];   // dose-symmetric: 0, 3, -3, -6, 6, 9, -9 ...
  for (let k = 1; order.length < 41; k++) order.push(...(k % 2 ? [3 * k, -3 * k] : [-3 * k, 3 * k]));
  const tilts = Array.from({ length: 41 }, (_, i) => {
    const angle = -60 + 3 * i, a = (angle * Math.PI) / 180;
    const sx = 60 * Math.sin(i / 5) + (i % 7 === 3 ? 40 : 0), sy = -40 * Math.cos(i / 6);   // Å
    ctx.fillStyle = "#6b7280";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#111";
    for (const [x, y, z] of beads) {
      // Aligned frame (axis along y): (x cos a + z sin a, y); acquired:
      // R(zRot) of it + the centre + the shift
      const fx = x * Math.cos(a) + z * Math.sin(a), fy = y;
      const px = Math.cos(rot) * fx - Math.sin(rot) * fy + w / 2 + sx / pixelSize;
      const py = Math.sin(rot) * fx + Math.cos(rot) * fy + h / 2 + sy / pixelSize;
      ctx.beginPath();
      ctx.arc(px, py, 4, 0, 2 * Math.PI);
      ctx.fill();
    }
    ctx.fillStyle = "#fff";
    ctx.font = "14px sans-serif";
    ctx.fillText(`${name} ${angle}°`, 8, 20);
    return {
      image: canvas.toDataURL("image/png").split(",")[1],
      movieIndex: order.indexOf(angle) + 1, tiltAngle: angle, xTilt: 0, yTilt: angle + 0.01 * Math.sin(i),
      zRot, shiftX: sx, shiftY: sy, dose: 3 * order.indexOf(angle),
      defocusU: 30000 + 50 * Math.abs(angle), defocusV: 30400 + 50 * Math.abs(angle),
      ctfMaxResolution: 6 + Math.abs(angle) / 10, section: i,
    };
  });
  return { kind: "tiltSeries", title: "Slices", tilts, imageSize: [w, h], pixelSize,
           tiltAxisAngle: zRot, hasAlignment: true };
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

// Cluster job ids of some fake jobs: 265 shows the recorded info (finished),
// 870 the live output of an LSF queue 'inspect' command (lsf_inspect_job.py --json)
const FAKE_CLUSTER_JOB_IDS = { "265": "330047105", "870": "330051234" };

function withFakeClusterJobIds(wf) {
  for (const [id, clusterJobId] of Object.entries(FAKE_CLUSTER_JOB_IDS)) {
    if (wf.protocols?.[id]) wf.protocols[id].clusterJobId = clusterJobId;
  }
  return wf;
}

function fakeClusterJobInspection(protocolId) {
  const clusterJobId = FAKE_CLUSTER_JOB_IDS[protocolId];
  if (!clusterJobId) throw new Error(`Job ${protocolId} has no cluster job id.`);
  if (protocolId !== "870") {
    return {
      run_id: protocolId, status: "finished", cluster_job_id: clusterJobId,
      mode: "recorded", format: "summary",
      data: {
        summary: { cluster: "LSF", queue: "gpu_rtx", host: "nodegpu267", cpus: 24, gpus: 2,
                   gpu_type: "RTX A6000", memory_max: "1253 MB", memory_avg: "73.00 MB",
                   node_cpus: 64, node_memory: "1 TB", node_gpus: 4, elapsed: 5420, runs: 1, source: "run" },
        report: { job_id: clusterJobId, hosts: "nodegpu267", cpus: 24, queue: "gpu_rtx" },
        runs: [{ launched: "2026-11-17 09:12:03", start: "2026-11-17 09:14:40",
                 end: "2026-11-17 10:45:00", elapsed: 5420, status: "finished" }],
      },
    };
  }
  return {
    run_id: protocolId, status: "launched", cluster_job_id: clusterJobId,
    mode: "live", format: "json", queue: "cryo",
    command: `lsf_inspect_job.sh ${clusterJobId} --json`,
    data: {
      schema: 1,
      job: { id: clusterJobId, user: "emhub", queue: "gpu_a100", name: "emw-relion-refine3d",
             status: "PEND", pending_seconds: 7260, submit_time: "Nov 18 08:01" },
      request: { slots: 64, layout: "1 host(s) x 64 slots", mem_per_slot_mb: 16000,
                 select: "type == any", gpu: { num: 4, per: "host", mig: null, gmodel: "NVIDIAA100_SXM4_80GB", exclusive: true } },
      reasons: [{ section: "job", reason: "Not enough processors to meet the job's spanning requirement", hosts: 12, category: "capacity" }],
      queue: { status: "Open:Active", hosts: 3, host_list: ["gpu_a100_hosts/"], specified_hosts: [] },
      hosts: [
        { host: "nodegpu301", status: "ok", capacity: 0, max_slots: 48, maxmem_mb: 1031000, gpus: 4, eligible_gpus: 4, state: "never", fails: ["slots: 48 < 64 per host"] },
        { host: "nodegpu302", status: "ok", capacity: 0, max_slots: 48, maxmem_mb: 1031000, gpus: 4, eligible_gpus: 4, state: "never", fails: ["slots: 48 < 64 per host"] },
        { host: "nodegpu303", status: "closed_Adm", capacity: 0, max_slots: 48, maxmem_mb: 515000, gpus: 4, eligible_gpus: 4, state: "never", fails: ["slots: 48 < 64 per host", "memory: 503.0 GB < 1000.0 GB"] },
      ],
      verdict: { code: "NEVER", summary: "No host in queue gpu_a100 can run 64 slots on a single host.",
                 details: ["slots: 3 host(s) have at most 48 slots, 64 needed on one host"],
                 suggestions: ["Request at most 48 CPUs (MPI x threads) for this queue"] },
      checks: [
        { check: "job_state", label: "Job state", status: "pass", detail: "status PEND" },
        { check: "queue", label: "Queue status", status: "pass", detail: "Open:Active" },
        { check: "capacity", label: "Static capacity", status: "fail", detail: "0 of 3 hosts can fit the request" },
      ],
      notes: ["GPU memory request gmem=80G was not checked."],
    },
  };
}

export function createFakeService() {
  return {
    fetchList: async () => [],

    fetchProject: async () => {
      log("fetchProject");
      return withFakeClusterJobIds(withFakeOutputPrefixes(structuredClone(workflow)));
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
    inspectClusterJob: async (projectId, protocolId) => {
      log("inspectClusterJob", protocolId);
      await new Promise((r) => setTimeout(r, 400));
      return fakeClusterJobInspection(String(protocolId));
    },
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
      // PDF files (or any output with ?pdfOutput): the PDF viewer dialog, the
      // file served as EMhub's /api/get_pdf_file does (here a static file)
      if (ctx.pointerClass === "PdfFile" || new URLSearchParams(location.search).has("pdfOutput")) {
        return {
          handled: true, viewer: "pdf", title: ctx.outputName, pointerClass: "PdfFile",
          url: new URL("./fake_logfile.pdf", import.meta.url).href,
        };
      }
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
      if (ctx.pointerClass === "Classes3D" || new URLSearchParams(location.search).has("classesTable")) {
        return {
          handled: true,
          viewer: "table",
          title: ctx.outputName,
          context: { projectId: ctx.projectId, protocolId: ctx.protocolId, outputName: ctx.outputName,
                     pointerClass: "Classes3D", outputPath: "Class3D/job055/run_it025_optimiser.star" },
          table: fakeClasses3DTable(25),
        };
      }
      if (compareMode() !== null) {
        return {
          handled: true,
          viewer: "table",
          title: ctx.outputName,
          context: { projectId: ctx.projectId, protocolId: ctx.protocolId, outputName: "Coordinates Distances",
                     pointerClass: "JobView", outputPath: "External/job012#coordinates-compare" },
          table: fakeCompareTable(),
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

    // Another iteration of the fake 3D classes table
    loadTableViewerVariant: async (context, variantId) => {
      log("loadTableViewerVariant", variantId);
      await new Promise((resolve) => setTimeout(resolve, 500));
      if (context.pointerClass === "JobView") {
        const [, distance, edge] = variantId.split(":").map(Number);
        return { context: { ...context, outputPath: `External/job012#${variantId}` },
                 table: fakeCompareTable(distance, Number.isFinite(edge) ? edge : distance) };
      }
      const it = Number(/_it(\d+)_/.exec(variantId)?.[1] ?? 0);
      return { context: { ...context, outputPath: `Class3D/job055/${variantId}` }, table: fakeClasses3DTable(it) };
    },
    executeTableViewerEditAction: async (context, request) => {
      log("executeTableViewerEditAction", request);
      if (request.actionId === "remove-duplicates")
        return { success: true, message: `Fake remove duplicates of ${context.outputPath}`, refreshProject: true };
      if (request.actionId === "merge-sets") {
        const excluded = request.edits.filter((edit) => !edit.value).map((edit) => `${edit.rowId}:${edit.columnId}`);
        return { success: true, message: `Fake merge without: ${excluded.join(" ") || "none"}`,
                 clearEdits: true, refreshProject: true };
      }
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
          fakeTiltSeries(name),
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
        if (compareMode() !== null) {
          return fakeComparePane(name, request.rowData?.distance ?? 30, request.rowData?.edgeDistance);
        }
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
      if (wizardId === "geometry_mask") {
        const n = 64, dims = [n, n, n];
        let shapes = [];
        try { shapes = JSON.parse(params.shapes || "[]"); } catch { shapes = []; }
        shapes = shapes.length ? shapes : [geometryShape("sphere", n)];
        const volume = params.input_volume ? { kind: "volume", path: params.input_volume, dimensions: dims,
                                               voxelSize: FAKE_MAP_ANGPIX, density: fakeMap(n) } : null;
        const softEdge = parseFloat(params.soft_edge) || 0;
        return { id: wizardId, label: "Geometry mask wizard", ui: "GeometryMaskWizard", inputs: { shapes, soft_edge: softEdge },
                 data: { volume, dimensions: dims, angpix: FAKE_MAP_ANGPIX, binning: 1,
                         defaults: Object.fromEntries(Object.keys(SIZES).map((k) => [k, geometryShape(k, n)])),
                         mask: fakeGeometryMask(n, shapes, softEdge), mask_fraction: 0.1 },
                 warnings: [] };
      }
      if (wizardId === "template") {
        if (!params[PT + "input-map"]) return { errors: ["Select the input map before opening the wizard."] };
        const inputs = { in_angpix: parseFloat(params[PT + "input-voxel-size-angstrom"]) || 2,
                         out_angpix: parseFloat(params[PT + "output-voxel-size-angstrom"]) || 4,
                         box: parseInt(params[PT + "box-size"]) || 32,
                         radius: parseFloat(params[PM + "radius"]) || 12, sigma: parseFloat(params[PM + "sigma"]) || 1,
                         center: false, invert: false, mirror: false };
        return { id: wizardId, label: "Template and mask wizard", ui: "PyTomTemplateWizard", inputs,
                 data: { input: { path: params[PT + "input-map"], dimensions: [64, 64, 64], voxelSize: 2 },
                         ...fakePyTomData(inputs) },
                 warnings: [] };
      }
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
      if (wizardId === "geometry_mask") {
        const errors = geometryErrors(outputs.shapes ?? []);
        if (errors.length) return { errors };
        return { data: { mask: fakeGeometryMask(64, outputs.shapes, outputs.soft_edge), mask_fraction: 0.1 }, warnings: [] };
      }
      if (wizardId === "template") {
        if (!(outputs.box > 0) || !(outputs.radius > 0)) return { errors: ["The box size and mask radius should be positive numbers."] };
        return { data: fakePyTomData(outputs), warnings: [] };
      }
      if (!Number.isFinite(outputs.threshold)) return { errors: ["The initial threshold should be a number."] };
      const mask = fakeCreatedMask(64, outputs);
      const u8 = Uint8Array.from(atob(mask.data), (c) => c.charCodeAt(0));
      const fraction = u8.reduce((a, v) => a + v, 0) / (255 * u8.length);
      return { data: { mask, mask_fraction: fraction },
               warnings: fraction === 0 ? ["The mask is empty: lower the threshold."] : [] };
    },
    applyWizard: async (projectId, protocolId, cls, wizardId, params, outputs) => {
      log("applyWizard", { wizardId, params, outputs });
      if (wizardId === "geometry_mask") {
        const errors = geometryErrors(outputs.shapes ?? []);
        if (errors.length) return { errors };
        return { params: { shapes: outputs.shapes, soft_edge: outputs.soft_edge }, warnings: [] };
      }
      if (wizardId === "template") {
        return { params: { [PT + "input-voxel-size-angstrom"]: outputs.in_angpix, [PT + "output-voxel-size-angstrom"]: outputs.out_angpix,
                           [PT + "box-size"]: outputs.box, [PT + "center"]: outputs.center, [PT + "invert"]: outputs.invert,
                           [PT + "mirror"]: outputs.mirror, [PM + "radius"]: outputs.radius, [PM + "sigma"]: outputs.sigma },
                 warnings: [] };
      }
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
