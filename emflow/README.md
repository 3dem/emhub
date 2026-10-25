# emflow

Embeddable React viewer for processing workflows (the "project page": workflow
graph, protocol forms, outputs/analysis viewers, logs, tags), compiled into a
single JS + CSS bundle that EMhub loads in its pages.

It is a clean extraction of the project-page widget from
[ScipionWeb](https://github.com/fonsecareyna82/ScipionWeb) (branch
`jm_new_integrated_viewer`). Everything not reachable from that widget was
removed: the ScipionAPI HTTP client and authentication, routing, the full web
app (dashboard, project list, plugins, settings, auth pages), React Query,
Helmet, test setup and the other widget builds.

**The viewer has no backend of its own.** All data access goes through a
`service` object passed by the host page (in EMhub: `svc` in
`templates/project_widget_svc.html`). The interface is declared in
[`src/services/ProjectService.ts`](src/services/ProjectService.ts); optional
methods the host does not implement get harmless defaults in
[`src/widget/normalizeService.ts`](src/widget/normalizeService.ts).

## Usage

```bash
npm install
npm run dev        # dev page at http://localhost:5173 (from source, fake project)
npm run build      # dist/emflow.js + dist/emflow.css
npm run typecheck  # tsc --noEmit
```

The dev server also serves `/dev/umd.html`, which loads the *built* bundle
(`dist/`) exactly as EMhub does. Both dev pages use Bootstrap 4 around the
viewer to catch style collisions, and a fake in-memory service
([`dev/fakeService.js`](dev/fakeService.js)) with EMhub's fake project 43.

### Build and copy into EMhub

```bash
./build_and_copy.sh
```

Builds and copies `dist/emflow.js` and `dist/emflow.css` to
`../emhub/emhub/static/libs/{js,css}/` (set `EMHUB_LIBS` to use another EMhub
checkout).

### Mounting in a page

The bundle is a UMD library that includes React, exposed as `window.EMFlow`:

```html
<link rel="stylesheet" href="{{ url_for('static', filename='libs/css/emflow.css') }}" />
<script src="{{ url_for('static', filename='libs/js/emflow.js') }}"></script>
<script>
  const viewer = EMFlow.mountProjectPage({
    container: "#project-page-host", // element or selector
    service: svc,                    // host ProjectService implementation
    projectName: String(project_id), // passed to svc.fetchProject()
    theme: "auto",                   // "auto" (follow host .dark), "light" or "dark"
  });
  // viewer.unmount();  (also automatic when the container leaves the DOM)
</script>
```

For a drop-in replacement of the ScipionWeb bundle, the entry also registers
`window.MyProjectsWidget.mountProjectPageWidget` (same options), so EMhub's
current `project_widget_bootstrap.html` works unchanged: only the `<link>` and
`<script>` paths in `project_widget_shell.html` need to point to
`emflow.css` / `emflow.js`.

## Style isolation

The viewer uses Tailwind CSS v4 utilities, CSS modules, MUI (emotion) and
React Flow styles, while EMhub uses Bootstrap 4. To avoid collisions in both
directions ([`postcss.config.js`](postcss.config.js), [`src/widget/`](src/widget)):

- **Scoped CSS**: every selector of `emflow.css` is prefixed with
  `.emflow-root` (`:root`/`html`/`body` map to the root itself), so nothing
  applies outside the viewer. Tailwind preflight (global reset) is not included.
- **No cascade layers**: Tailwind v4 emits `@layer` blocks, and layered rules
  always lose against unlayered host CSS. Layers are flattened so the scoped
  rules (higher specificity) win inside the viewer.
- **Bootstrap `!important` utilities**: Bootstrap declares `mt-3`, `p-2`,
  `border`, `rounded`, `shadow`, `bg-*`, `text-*`... with `!important`, with
  the same names as Tailwind but different values. Tailwind utilities of those
  families, and all variant utilities (`hover:`, `dark:`, `md:`...), are made
  `!important` too. Custom CSS (`ProjectPage.css`, CSS modules) is untouched.
- **Prefixed names**: `@keyframes` get an `emflow-` prefix, CSS-module classes
  are `emflow_<name>_<hash>`, MUI/emotion uses the cache key `emflow`, and
  localStorage keys start with `emflow:`.
- **Overlays**: MUI dialogs/menus/poppers and the protocols drawer portal to an
  overlay root (`<div class="emflow-root emflow-overlays">` on `<body>`, one per
  mount); Radix menus/dialogs portal to `#emflow-portal-root` inside the viewer.
- **No host mutations**: dark mode is a `dark` class on the viewer roots only
  (Tailwind `dark:` follows that class, not the OS preference). Unlike
  ScipionWeb, nothing is written to `<html>`/`<body>` or to host stylesheets.

## Project layout

```
src/
  index.tsx                 library entry: EMFlow.mountProjectPage()
  widget/                   embedding: shell, overlay root, service normalization
  pages/Dashboard/projects/ ProjectPage.tsx (+ ProjectPage.css, main stylesheet)
  components/protocol/      workflow graph nodes, protocol form, drawer, wizards, logs
  components/analyze/       output viewers (tables, tilt series, volumes, coords, FSC...)
  components/tags/          protocol tags
  components/projects/      workflows panel
  components/files/         remote file browser dialog
  components/ui/            small shadcn/Radix primitives (button, dialog, menus)
  services/ProjectService.ts  service interface implemented by the host
  context/ThemeContext.tsx  widget-scoped light/dark theme
dev/                        dev pages' fake service and fake project data
```

## Main dependencies

Everything below is bundled into `emflow.js` (EMhub does not provide any of it).

| Library | Used for | Where |
| --- | --- | --- |
| `react`, `react-dom` (18) | UI runtime | everywhere; mounted in `src/index.tsx` |
| `reactflow` (11) | workflow graph (nodes, edges, minimap, controls) | `pages/Dashboard/projects/ProjectPage.tsx`, `components/protocol/ProtocolNodeCard*.tsx`, `components/protocol/ProtocolStepsDeveloperDialog.tsx`, `utils/graph_utils.ts` |
| `@mui/material` (7) + `@emotion/react`, `@emotion/styled`, `@emotion/cache` | most widgets: dialogs, tabs, forms, menus, tables, tooltips | protocol form and dialogs (`components/protocol/**`), all viewers (`components/analyze/**`), tags (`components/tags/**`), `ProjectPage.tsx`; emotion cache/theme in `src/index.tsx`, `widget/overlay.tsx` |
| `@mui/icons-material` | a few icons | `components/protocol/ExecuteModeButton.tsx`, `components/analyze/{ExternalViewersBar,ctftomo-viewer,tiltseries-viewer}.tsx` |
| `@radix-ui/react-context-menu`, `-dropdown-menu`, `-dialog`, `-slot` | shadcn-style primitives (node menus, dialogs, button) | `components/ui/{context-menu,dropdown-menu,button}.tsx`, `components/ui/dialog/dialog.tsx` |
| `tailwindcss` (4, build only) + `clsx`, `tailwind-merge`, `class-variance-authority` | utility CSS and class composition | `ProjectPage.css` (`@import`), `lib/utils.ts` (`cn`), `components/form/Label.tsx`, `components/ui/button.tsx` |
| `three` (0.160) | 3D volume rendering, meshes, 3D coordinates | `components/analyze/{gpu-volume-view,mesh-volume-view,coords3d-viewer}.tsx`, `components/protocol/wizards/PointInVolumeWizardDialog.tsx` |
| `@react-three/fiber` (8) | React renderer for three.js | `components/protocol/wizards/PointInVolumeWizardDialog.tsx` |
| `react-plotly.js` + `plotly.js-dist-min` | 2D plots (CTF, volume histograms, generic table plots) | `lib/plot.ts`, used by `components/analyze/{ctftomo-viewer,volume-viewer,table-viewer-generic-content}.tsx` |
| `recharts` (3) | metadata plotter (histograms, scatter) | `components/analyze/metadata-plotter-dialog.tsx` |
| `lucide-react` | icons | ~20 components (`ProjectPage.tsx`, `components/protocol/**`, `components/analyze/**`, `components/ui/**`) |
| `react-hot-toast` | toast notifications | `<Toaster>` in `src/index.tsx`; `toast()` in `ProjectPage.tsx`, `components/protocol/{ProtocolForm,ProtocolNodeCard}.tsx`, `components/analyze/**`, tags, workflows panel |
| `vite` (6) + `@vitejs/plugin-react`, `vite-plugin-svgr`, `postcss` | build (UMD library), SVG icons as components, CSS scoping | `vite.config.ts`, `postcss.config.js`, `src/icons/index.ts` |

## License

GPL-3.0, as ScipionWeb, from which this code is derived (see [LICENSE](LICENSE)).
