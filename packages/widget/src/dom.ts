/**
 * A 30-line DOM helper instead of a framework.
 *
 * React plus react-dom would add roughly 45 kB to a bundle that is already 414 kB because of
 * the SDK, for a widget whose entire job is a grid, some chips and a stepper. The brief is
 * explicit that the widget stays small and does not become an e-commerce app in an iframe.
 */

type Attrs = Record<string, string | number | boolean | EventListener | undefined | null>;
type Child = Node | string | number | false | null | undefined;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "class") {
      el.className = String(v);
    } else if (k === "html") {
      el.innerHTML = String(v);
    } else {
      el.setAttribute(k, String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(parent: Node, children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    parent.appendChild(typeof c === "object" ? c : document.createTextNode(String(c)));
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function mount(root: Element, ...children: Child[]): void {
  clear(root);
  append(root, children);
}
