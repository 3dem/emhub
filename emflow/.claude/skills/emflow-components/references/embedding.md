# Embedding, styles and EMhub integration

## Mount API

```js
const viewer = EMFlow.mountProjectPage({
  container: "#project-page-host",  // element or selector
  service: svc,                     // ProjectService implementation
  projectName: String(project_id),  // or projectId
  theme: "auto",                    // "auto" | "light" | "dark"
  cssHref: undefined,               // optional: emflow adds the <link> once
});
viewer.unmount();                   // also automatic when the container leaves the DOM
```

The viewer fills the container (`.h-app` is `height: 100%`), so the host
must give the container a height (the dev pages use `80vh`; EMhub fits it to
the window, see below).

Each mount creates: the shell `div.emflow-root` inside the container, an
overlay root `div.emflow-root.emflow-overlays` on `<body>`, an emotion cache
(key `emflow`) inside the shell, and a React root. `unmount()` removes all of
them. Several mounts on one page are possible, but `ProjectPage` renders a
single `#emflow-portal-root`, so keep one viewer per page.

## How EMhub loads it

- `project_widget_shell.html`: the card and `#project-page-host` only.
- `project_widget_bootstrap.html`: adds `emflow.css` and `emflow.js` to
  `<head>` **once per page** (shared `window.emflowLoading` promise), because
  the widget HTML is reloaded with jQuery `.html()` (tomo session tabs,
  workflow editor modal) and the bundle is ~8 MB. URLs come from
  `url_for_static()` (file mtime as `?v=`), so a rebuilt bundle is always
  reloaded. It mounts with `svc` and `project_id` from the svc template, and
  unmounts when a containing Bootstrap modal is hidden. It sets the height
  of `#project-page-host` to what is left of the window below it (minus the
  card padding and footer), refitted on window/content resize, so the EMhub
  page does not scroll (`85vh` inside a modal). The shell template removes
  the `.dashboard-wrapper` min-height while the viewer is shown.
- Built files live in EMhub's `emhub/static/libs/js/emflow.js` and
  `emhub/static/libs/css/emflow.css` (committed); `./build_and_copy.sh`
  updates them (`EMHUB_LIBS` to override the target).

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
