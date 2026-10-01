'use strict';

// A small DOM for exercising the real page handlers. It intentionally does not
// claim to verify layout, canvas pixels, or browser performance.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const repo = path.resolve(__dirname, '..', '..');

function createPage(options = {}) {
  const storage = options.storage || {};
  const nodes = new Set();
  const ids = new Map();
  const raf = new Map();
  const timers = new Map();
  let clock = 1000, nextId = 0;

  function listeners() {
    const callbacks = new Map();
    return {
      addEventListener(type, callback) {
        if (!callbacks.has(type)) callbacks.set(type, new Set());
        callbacks.get(type).add(callback);
      },
      removeEventListener(type, callback) { callbacks.get(type)?.delete(callback); },
      dispatch(type, event = {}) {
        for (const callback of [...(callbacks.get(type) || [])]) {
          callback({ target: this, preventDefault() {}, ...event });
        }
      },
    };
  }

  const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  function attributes(text) {
    const result = {};
    for (const match of text.matchAll(/([^\s=<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g)) {
      result[match[1]] = decode(match[2] ?? match[3] ?? match[4] ?? '');
    }
    return result;
  }
  function inside(node, owner) {
    for (let cursor = node.parentNode; cursor; cursor = cursor.parentNode) {
      if (cursor === owner) return true;
    }
    return false;
  }
  function match(node, selector) {
    const tag = selector.match(/^[a-z][\w-]*/i)?.[0];
    if (tag && node.tagName !== tag.toUpperCase()) return false;
    const id = selector.match(/#([\w-]+)/)?.[1];
    if (id && node.id !== id) return false;
    for (const found of selector.matchAll(/\.([\w-]+)/g)) {
      if (!node.classList.contains(found[1])) return false;
    }
    for (const found of selector.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']*)["']?)?\]/g)) {
      if (!Object.hasOwn(node._attributes, found[1])) return false;
      if (found[2] !== undefined && node._attributes[found[1]] !== found[2]) return false;
    }
    return true;
  }
  function queryAll(selector, owner) {
    // The page's only descendant selector is cosmetic (#phaseBar .ph).
    const simple = selector.trim().split(/\s+/).at(-1);
    return [...nodes].filter((node) => (!owner || inside(node, owner)) && match(node, simple));
  }
  function canvasContext(canvas) {
    const noop = () => {};
    return new Proxy({
      canvas, measureText: () => ({ width: 10 }),
      createLinearGradient: () => ({ addColorStop() {} }),
    }, { get: (target, key) => target[key] ?? noop });
  }
  function element(tag = 'div', attrs = {}, owner = null) {
    const classes = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    let html = '';
    const node = {
      ...listeners(), tagName: tag.toUpperCase(), id: attrs.id || '',
      _attributes: attrs, parentNode: owner, dataset: {}, children: [],
      value: attrs.value || '', textContent: '', checked: 'checked' in attrs,
      disabled: 'disabled' in attrs, options: [], selectedIndex: 0,
      style: {}, width: Number(attrs.width) || 1100, height: Number(attrs.height) || 460,
      clientWidth: 1100, clientHeight: 460, offsetWidth: 1100, offsetHeight: 460,
      scrollTop: 0, scrollHeight: 0,
      classList: {
        add(...names) { names.forEach((name) => classes.add(name)); },
        remove(...names) { names.forEach((name) => classes.delete(name)); },
        contains(name) { return classes.has(name); },
        toggle(name, force) {
          const enabled = force === undefined ? !classes.has(name) : !!force;
          enabled ? classes.add(name) : classes.delete(name);
          return enabled;
        },
      },
      get innerHTML() { return html; },
      set innerHTML(value) {
        html = String(value);
        for (const child of [...nodes]) {
          if (inside(child, this)) {
            nodes.delete(child);
            if (child.id && ids.get(child.id) === child) ids.delete(child.id);
          }
        }
        this.children = [];
        if (this.tagName === 'SELECT') setOptions(this, html);
        else parse(html, this);
      },
      appendChild(child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild(child) { nodes.delete(child); this.children = this.children.filter((x) => x !== child); return child; },
      querySelector(selector) { return queryAll(selector, this)[0] || null; },
      querySelectorAll(selector) { return queryAll(selector, this); },
      setAttribute(key, value) { this._attributes[key] = String(value); },
      getAttribute(key) { return this._attributes[key] ?? null; },
      removeAttribute(key) { delete this._attributes[key]; },
      focus() {}, blur() {}, click() { if (!this.disabled) this.dispatch('click'); },
      getBoundingClientRect() { return { left: 0, top: 0, width: 1100, height: 460 }; },
      getContext() { return canvasContext(this); },
      toDataURL() { return 'data:image/png;base64,'; },
    };
    for (const [key, value] of Object.entries(attrs)) {
      if (key.startsWith('data-')) node.dataset[key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = value;
    }
    nodes.add(node);
    if (node.id) ids.set(node.id, node);
    return node;
  }
  function setOptions(node, html) {
    node.options = [...html.matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)].map((found) => {
      const attrs = attributes(found[1]);
      const label = decode(found[2].replace(/<[^>]*>/g, ''));
      return { value: attrs.value ?? label, textContent: label, selected: 'selected' in attrs };
    });
    node.selectedIndex = Math.max(0, node.options.findIndex((item) => item.selected));
    node.value = node.options[node.selectedIndex]?.value || '';
  }
  function parse(html, owner = null) {
    for (const found of html.matchAll(/<select\b([^>]*)>([\s\S]*?)<\/select>|<(button|input|canvas|div|section|span|tbody|table|tr)\b([^>]*)>/g)) {
      const node = element(found[3] || 'select', attributes(found[1] ?? found[4]), owner);
      if (!found[3]) setOptions(node, found[2]);
    }
  }

  const html = fs.readFileSync(path.join(repo, 'index.html'), 'utf8');
  // Script strings are not DOM elements and must not create ghost selectors.
  parse(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, ''));
  for (const found of html.matchAll(/id="([\w-]+)"/g)) {
    if (!ids.has(found[1])) element('div', { id: found[1] });
  }

  const math = Object.create(Math);
  let randomState = options.seed ?? 0x51a1;
  math.random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 4294967296;
  };
  const windowEvents = listeners();
  const context = {
    ...windowEvents, console, Math: math, Date, Number, String, Array, Object,
    JSON, parseInt, parseFloat, isNaN, isFinite, RegExp, Error, Set, Map,
    Promise, Boolean, Symbol, Intl, URLSearchParams,
    document: {
      ...listeners(), getElementById: (id) => ids.get(id) || null,
      querySelector: (selector) => queryAll(selector)[0] || null,
      querySelectorAll: (selector) => queryAll(selector), createElement: (tag) => element(tag),
      body: element('body'), documentElement: element('html'),
    },
    localStorage: {
      getItem: (key) => Object.hasOwn(storage, key) ? String(storage[key]) : null,
      setItem: (key, value) => { storage[key] = String(value); },
      removeItem: (key) => { delete storage[key]; },
    },
    location: { search: options.search || '', hash: options.hash || '', href: 'http://localhost/', reload() {} },
    performance: { now: () => clock },
    requestAnimationFrame: (callback) => { const id = ++nextId; raf.set(id, callback); return id; },
    cancelAnimationFrame: (id) => raf.delete(id),
    setTimeout: (callback, delay = 0) => { const id = ++nextId; timers.set(id, { callback, at: clock + delay }); return id; },
    clearTimeout: (id) => timers.delete(id),
    alert() {}, confirm: () => true,
  };
  context.window = context; context.self = context; context.globalThis = context;
  vm.createContext(context);
  for (const found of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
    const src = attributes(found[1]).src;
    vm.runInContext(src ? fs.readFileSync(path.join(repo, src.split(/[?#]/)[0]), 'utf8') : found[2], context,
      { filename: src || 'index-inline.js' });
  }
  context.dispatch('load');

  const runtime = {
    storage, context,
    evaluate: (code) => vm.runInContext(code, context),
    json(code) { return JSON.parse(JSON.stringify(this.evaluate(code))); },
    element(selector) {
      const node = ids.get(selector) || context.document.querySelector(selector);
      if (!node) throw new Error('Element not found: ' + selector);
      return node;
    },
    click(selector) { this.element(selector).click(); },
    set(selector, value, change = false) {
      const node = this.element(selector); node.value = String(value);
      if (change) node.dispatch('change');
    },
    emit(type, event) { context.dispatch(type, event); },
    tick(ms = 100) {
      clock += ms;
      const readyTimers = [...timers].filter(([, item]) => item.at <= clock);
      for (const [id, item] of readyTimers) { timers.delete(id); item.callback(); }
      const readyRaf = [...raf];
      for (const [id, callback] of readyRaf) { raf.delete(id); callback(clock); }
    },
    refresh({ emitPagehide = true } = {}) {
      if (emitPagehide) this.emit('pagehide');
      return createPage({ ...options, storage });
    },
  };
  return runtime;
}

module.exports = { createPage };
