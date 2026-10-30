// src/widget/shell.ts
// DOM helpers to host the viewer inside an arbitrary element of the host page.
import { ROOT_CLASS } from "./constants";

/**
 * Create the `.emflow-root` shell element (CSS scope) inside `target`. With
 * `fill` it takes the whole height of the target (the project page);
 * otherwise it is as high as its content (a viewer inside a host panel).
 */
export function createWidgetShell(target: HTMLElement, { fill = true }: { fill?: boolean } = {}) {
  const shell = document.createElement("div");
  shell.className = ROOT_CLASS;
  shell.style.display = "flex";
  shell.style.flexDirection = "column";
  shell.style.minHeight = "0";
  if (fill) shell.style.height = "100%";

  const mountPoint = document.createElement("div");
  mountPoint.style.minHeight = "0";
  mountPoint.style.display = "flex";
  mountPoint.style.flexDirection = "column";
  if (fill) mountPoint.style.flex = "1";

  shell.appendChild(mountPoint);
  target.appendChild(shell);

  return { shell, mountPoint };
}

/** Add a <link rel="stylesheet"> once; returns a cleanup function. */
export function ensureStylesheet(href?: string): () => void {
  if (!href) return () => {};

  const linkId = "emflow-css";
  const alreadyLinked =
    document.getElementById(linkId) ||
    Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')).some(
      (l) => l.href === new URL(href, document.baseURI).href,
    );
  if (alreadyLinked) return () => {};

  const link = document.createElement("link");
  link.id = linkId;
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);

  return () => link.remove();
}

/**
 * Call `onRemoved` when `el` is detached from the document (e.g. the host
 * replaced the container content) or the page unloads.
 */
export function observeRemoval(el: HTMLElement, onRemoved: () => void): () => void {
  const observer = new MutationObserver(() => {
    if (!document.contains(el)) onRemoved();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("beforeunload", onRemoved, true);

  return () => {
    observer.disconnect();
    window.removeEventListener("beforeunload", onRemoved, true);
  };
}
