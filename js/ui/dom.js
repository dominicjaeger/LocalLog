// Small DOM helpers: element builder, minimal inline SVG icon set, toast messages.
// No inline style attributes are used anywhere (the page's security policy forbids them);
// dynamic colours are set through element.style.setProperty from JS, which is allowed.

import { t } from '../i18n.js';

/** h('button', { class: 'btn', onclick: fn }, 'Text', childNode) */
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

export function clear(node) {
  node.replaceChildren();
  return node;
}

export function setColor(node, hex) {
  node.style.setProperty('--dot', hex);
}

export function colorDot(hex) {
  const dot = h('span', { class: 'color-dot', 'aria-hidden': 'true' });
  setColor(dot, hex);
  return dot;
}

// ---- Icons (outline, 24x24 grid, drawn by hand) ----

const ICON_PATHS = {
  edit: 'M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17v3z M13.5 7.5l3 3',
  delete: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  export: 'M12 4v11 M7.5 10.5L12 15l4.5-4.5 M5 19h14',
  settings: 'M4 7h9 M17 7h3 M4 17h3 M11 17h9 M15 4v6 M9 14v6',
  sun: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z M12 2.5v2 M12 19.5v2 M2.5 12h2 M19.5 12h2 M5.3 5.3l1.4 1.4 M17.3 17.3l1.4 1.4 M5.3 18.7l1.4-1.4 M17.3 6.7l1.4-1.4',
  moon: 'M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z',
  miniwindow: 'M3 5h18v14H3z M12 12h8v6h-8z'
};

export function icon(name) {
  const svgNs = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNs, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(svgNs, 'path');
  path.setAttribute('d', ICON_PATHS[name] || '');
  svg.append(path);
  return svg;
}

/** Replaces the contents of a button with an icon (and optional text). */
export function setIcon(button, name, text = '') {
  button.replaceChildren(icon(name));
  if (text) button.append(document.createTextNode(text));
}

// ---- Toast ----

let toastTimer = null;

export function toast(message, kind = 'info') {
  const box = document.getElementById('toast');
  if (!box) return;
  box.textContent = message;
  box.className = `toast toast-${kind}`;
  box.hidden = false;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, kind === 'error' ? 6000 : 4000);
}

/** Message for a validation error code. */
export function errorText(code) {
  return t(`err.${code}`);
}
