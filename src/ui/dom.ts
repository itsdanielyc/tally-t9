// A small element builder: h("button", { type: "button", onclick: fn }, "Save").
// Attributes are strings; true sets an empty attribute; false, null and
// undefined skip it. "value" and "checked" are set as properties. Keys
// starting with "on" and holding a function become event listeners.

export type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value === null || value === undefined) continue;
    if (key.startsWith("on") && typeof value === "function") {
      el.addEventListener(key.slice(2).toLowerCase(), value as EventListener);
    } else if (key === "value" || key === "checked") {
      (el as unknown as Record<string, unknown>)[key] = value;
    } else {
      el.setAttribute(key, value === true ? "" : String(value));
    }
  }
  append(el, children);
  return el;
}

export function append(el: Element, children: (Child | Child[])[]): void {
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(typeof c === "number" ? String(c) : c);
  }
}

export function clear(el: Element): void {
  while (el.firstChild) el.firstChild.remove();
}
