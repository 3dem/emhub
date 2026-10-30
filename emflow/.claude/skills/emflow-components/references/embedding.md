# Embedding, data, styles and EMhub integration

## Mount API

Any registered component (`EMFlow.components`: `ProjectPage`, `VolumeViewer`,
`Plot`, `ImageSlider`, `TableViewerContent`) is mounted the same way:

```js
const h = EMFlow.mount("VolumeViewer", {
  container: "#viewer",              // element or selector
  props: { source: { path, payload }, tools: { ruler: false } },
  loader: EMFlow.DataLoader.emhub(), // optional: DataLoader or its options
  theme: "auto",                     // "auto" | "light" | "dark"
  fill: false,                       // true: fill the container height
  service: undefined,                // a ProjectService, for components that need it
  cssHref: undefined,                // optional: emflow adds the <link> once
});
h.update({ info: "..." });           // merge props, re-render
h.instance.setPosition({ x: 10 });   // imperative API (forwardRef components)
h.unmount();                         // also automatic when the container leaves the DOM

EMFlow.mountProjectPage({ container: "#project-page-host", service: svc,
                          projectName: String(project_id) });
```

Each mount creates: the shell `div.emflow-root` inside the container, an
overlay root `div.emflow-root.emflow-overlays` on `<body>`, an emotion cache
(key `emflow`) inside the shell, a React root, and the providers (theme,
overlay, DataLoader, error boundary; ProjectService when `service` is
given). `unmount()` removes all of them, and a MutationObserver does it when
the host replaces the container content (jQuery `.html()`), so templates need
no cleanup. Many mounts per page are fine; only ProjectPage renders
`#emflow-portal-root`, so keep one project page per page and do not use the
Radix dialogs (`components/ui`) in the other components.

The project page fills the container (`fill: true`), so the host must give it
a height (EMhub fits it to the window, see below). The other components take
their content height; VolumeViewer with `height: "fill"` fits the container
height instead of the window.

## DataLoader (`src/data/`)

The way components fetch data from the backend, with the host choosing the
transport:

```js
new EMFlow.DataLoader({ request: (path, payload, { signal }) => promise });  // host transport
new EMFlow.DataLoader({ baseUrl, wrapPayload, unwrapResponse, headers });   // fetch POST JSON
EMFlow.DataLoader.emhub();   // EMhub API: body {attrs: payload}, throws the response `error`
```

`load(path, payload)` caches responses (LRU, `maxEntries` 200) and shares a
request in flight; `image(src)` decodes and caches images (url or base64);
`invalidate(prefix?)`. Components get the mount's loader with
`useDataLoader()` / `useLoad(path, payload)`. Without `loader` a mount uses a
shared default (fetch, no base url). VolumeViewer and Plot take a
`source: {path, payload}`; VolumeViewer accepts EMhub's
`resolve_table_view_pane` response (`{paneContent}`) directly.

## How EMhub loads it

- `templates/main_javascript.html` adds `emflow.css` and `emflow.js` to every
  page (where the plotly.js CDN script was), with `url_for_static()` (file
  mtime as `?v=`), so a rebuilt bundle is always reloaded. `window.EMFlow`
  and `window.Plotly` are then available to every template.
- `project_widget_shell.html`: the card and `#project-page-host` only.
- `project_widget_bootstrap.html`: mounts the project page with `svc` and
  `project_id` from the svc template (it still loads the bundle itself if
  `window.EMFlow` is missing), and unmounts it when a containing Bootstrap
  modal is hidden. It sets the height of `#project-page-host` to what is left
  of the window below it (minus the card padding and footer), refitted on
  window/content resize, so the EMhub page does not scroll (`85vh` inside a
  modal). The shell template removes the `.dashboard-wrapper` min-height
  while the viewer is shown.
- Volume viewers: `tomo_otf_dashboard.html` (`otfOrthoViewer`, the pane from
  `resolve_table_view_pane` as `data`) and `processing_tomogram_card.html`
  mount `VolumeViewer`.
- Built files live in EMhub's `emhub/static/libs/js/emflow.js` and
  `emhub/static/libs/css/emflow.css` (committed); `./build_and_copy.sh`
  updates them (`EMHUB_LIBS` to override the target). `./track.sh off`
  marks them `assume-unchanged`, so local builds stay out of commits;
  `./track.sh on` before committing a new bundle.

## Plotly

plotly.js 3 (`plotly.js-dist-min`) is bundled once and used three ways: the
`Plot` component (react-plotly.js), `EMFlow.Plotly`, and `window.Plotly`
(set only if the page has none), which serves EMhub's own charts
(`emhub_charts.js` GridSquareCard and CTF plot, the OTF dashboard and
tilt-series pages: `newPlot`, `react`, `relayout`, `purge`, `Plots.resize`,
events). Those calls render the same as with plotly.js 2.32 (checked with
each of their figures). The one breaking change of 3.x that matters here:
**titles must be objects** (`title: {text: "..."}`); a string `title` (layout
or axis) is ignored. EMhub's figures already use objects, and emflow
normalizes the figures it renders (`normalizeTitles` in `Plot.tsx`).

## Portals and overlays

| Renders outside the viewer box | Goes to |
| --- | --- |
| MUI `Dialog`, `Menu`, `Popover`, `Popper`, `Tooltip`, `Select`, `Autocomplete` | overlay root (MUI theme default `container`) |
| `ProtocolsDrawer` | overlay root (`useOverlayRoot()`) |
| Radix `Dialog`, `DropdownMenu`, `ContextMenu` (`components/ui/*`) | `#emflow-portal-root` (inside ProjectPage) |
| `RemoteFileDialog` | `#emflow-portal-root` (creates it on `<body>` with the root class if missing) |
| `react-hot-toast` | inside the shell (fixed position) |

A new component that portals must use one of these targets. A nested MUI
`ThemeProvider` must get its theme from `useEmflowMuiTheme(options)`.

## CSS isolation (`postcss.config.js`, `vite.config.ts`)

- All selectors are prefixed with `.emflow-root` (`:root`, `html`, `body`
  become the root; `.dark X` becomes `.emflow-root.dark X, .emflow-root .dark X`).
- Tailwind v4 cascade layers are flattened (layered CSS always loses against
  EMhub's unlayered Bootstrap).
- Tailwind utilities whose names are also Bootstrap 4 `!important` utilities
  (spacing `m*-N`/`p*-N`, `border*`, `rounded*`, `shadow*`, `bg-*`, `text-*`,
  `flex-*`, `overflow-*`, `float-*`, `align-*`, `w/h-25..100`,
  `visible`/`invisible`) and all variant utilities (`hover:`, `dark:`, `md:`)
  are emitted with `!important`. Custom CSS (ProjectPage.css, modules) is not.
- `@keyframes` are renamed `emflow-*`; CSS modules are `emflow_<name>_<hash>`.
- Tailwind preflight is not included (host base styles apply); Tailwind only
  scans `src/` (`source("../../..")` in ProjectPage.css).
- `dark:` utilities follow the `dark` class (`@custom-variant dark`), never
  the OS preference.

Audit after style changes: every rule of `dist/emflow.css` must start with
`.emflow-root` (except `@keyframes` contents, `@font-face`, `@property`), and
there must be no `@layer`. The dev pages load Bootstrap 4 to spot collisions.

## Versioning

`package.json` `version` is the only source; injected at build time and shown
in the Build info dialog (`emflow vX.Y.Z`), the console and `EMFlow.version`.
Bump with `npm version patch --no-git-tag-version` before building a release.
