// postcss.config.js
//
// Isolation of the bundle styles from the host page (EMhub):
//
//  1. Every selector is prefixed with `.emflow-root`, so nothing leaks out to
//     the host page (`:root`, `html`, `body` are mapped to the root itself).
//  2. Cascade layers (`@layer theme/utilities`, from Tailwind v4) are flattened:
//     layered rules always lose against unlayered host CSS (Bootstrap), no
//     matter their specificity. Unlayered + prefixed, our rules win inside the
//     widget for the properties they set.
//  3. Bootstrap 4 declares many utilities with `!important` using the same
//     names as Tailwind (`mt-2`, `p-3`, `border`, `rounded`, `shadow`,
//     `bg-white`, `text-center`, ...). Tailwind utilities of those families
//     get `!important` too (scoped + !important beats Bootstrap), and so do
//     all variant utilities (`hover:`, `dark:`, `md:`...), so that a variant
//     still overrides its base class. Custom (non-utility) CSS is untouched.
//  4. `@keyframes` are renamed with an `emflow-` prefix, since animation names
//     are global (e.g. Tailwind `spin` vs. other `spin` keyframes).
import tailwindcss from "@tailwindcss/postcss";

const ROOT = ".emflow-root";
const KEYFRAMES_PREFIX = "emflow-";

// Bootstrap 4 utility families declared with !important (bootstrap.min.css)
const BOOTSTRAP_IMPORTANT_UTILITIES = [
  /^-?[mp][trblxy]?-(\d+|auto)$/, // spacing (m-0 ... p-5, ml-auto)
  /^(border|rounded|shadow)(-.+)?$/,
  /^bg-.+$/,
  /^text-.+$/,
  /^(visible|invisible)$/,
  /^overflow-(auto|hidden)$/,
  /^flex-.+$/,
  /^float-(left|right|none)$/,
  /^align-(baseline|top|middle|bottom|text-top|text-bottom)$/,
  /^[wh]-(25|50|75|100|auto)$/,
];

function unescapeClass(name) {
  return name.replace(/\\(.)/g, "$1");
}

// Tailwind utility class targeted by a (scoped) selector, e.g. "hover:bg-white"
function utilityClassOf(selector) {
  const m = selector.match(/^\.emflow-root(?:\.dark)? \.((?:\\.|[\w-])+)/);
  return m ? unescapeClass(m[1]) : null;
}

function needsImportant(selector) {
  const name = utilityClassOf(selector);
  if (!name) return false;
  if (name.includes(":")) return true; // variant utility
  return BOOTSTRAP_IMPORTANT_UTILITIES.some((re) => re.test(name));
}

// Returns the scoped selector(s) for one selector of a rule
function scopeSelector(raw) {
  const selector = raw.trim();
  if (!selector || selector.includes(ROOT)) return [selector];

  // rewriteGlobalRoots
  const rooted = selector.replace(/^(:root|:host|html|body)(?![\w-])/, ROOT);
  if (rooted !== selector) return [rooted];

  // darkClassOnTheRootItselfOrOnADescendant (but not ".dark\:bg-x" utilities)
  const dark = selector.match(/^\.dark(?![\w\\-])(.*)$/);
  if (dark) return [`${ROOT}.dark${dark[1]}`, `${ROOT} .dark${dark[1]}`];

  return [`${ROOT} ${selector}`];
}

function isInsideKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === "atrule" && /keyframes$/i.test(p.name)) return true;
  }
  return false;
}

function emflowIsolation() {
  return {
    postcssPlugin: "emflow-isolation",
    OnceExit(root) {
      // The dev pages' own CSS (dev/host.css) plays the host: not scoped
      const file = root.source?.input?.file ?? "";
      if (/[\\/]dev[\\/][^\\/]+\.css$/.test(file)) return;

      // markTailwindUtilities
      root.walkAtRules("layer", (at) => {
        if (at.params.trim() !== "utilities") return;
        at.walkRules((rule) => {
          rule.raws.emflowUtility = true;
        });
      });

      // flattenCascadeLayers
      root.walkAtRules("layer", (at) => {
        if (at.nodes && at.nodes.length) at.replaceWith(at.nodes);
        else at.remove();
      });

      // renameKeyframes
      const renamed = new Map();
      root.walkAtRules(/keyframes$/i, (at) => {
        const name = at.params.trim();
        if (name.startsWith("emflow")) return;
        renamed.set(name, KEYFRAMES_PREFIX + name);
        at.params = KEYFRAMES_PREFIX + name;
      });
      if (renamed.size) {
        root.walkDecls(/^(animation|animation-name|--animate.*)$/, (decl) => {
          decl.value = decl.value.replace(/[A-Za-z_][\w-]*/g, (word) => renamed.get(word) ?? word);
        });
      }

      // scopeSelectors
      root.walkRules((rule) => {
        if (!rule.selector || isInsideKeyframes(rule)) return;
        rule.selectors = Array.from(new Set(rule.selectors.flatMap(scopeSelector)));

        // winOverBootstrapImportantUtilities
        if (rule.raws.emflowUtility && rule.selectors.every(needsImportant)) {
          rule.walkDecls((decl) => {
            if (!decl.prop.startsWith("--")) decl.important = true;
          });
        }
      });
    },
  };
}
emflowIsolation.postcss = true;

export default {
  plugins: [tailwindcss(), emflowIsolation()],
};
