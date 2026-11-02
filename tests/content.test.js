import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { DEFAULT_SETTINGS, publicSettings } from "../extension/lib/settings.js";
const script = readFileSync(new URL("../extension/content.js", import.meta.url), "utf8");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(predicate, timeout = 3500) {
  const start = Date.now();
  while (!predicate()) { if (Date.now() - start > timeout) throw new Error("Timed out waiting for content script"); await sleep(15); }
}

function harness(html, config = {}, translate = texts => texts.map(text => `译文：${text}`)) {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { url: "https://example.com/article", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom; const listeners = [], requests = [], observers = [];
  const settings = { ...DEFAULT_SETTINGS, lazyLoad: false, ...config };
  window.HTMLElement.prototype.getClientRects = function () {
    let parent = this;
    while (parent) { if (window.getComputedStyle(parent).display === "none") return []; parent = parent.parentElement; }
    return [{ width: 600, height: 20 }];
  };
  window.IntersectionObserver = class {
    constructor(callback) { this.callback = callback; this.elements = new Set(); observers.push(this); }
    observe(element) { this.elements.add(element); }
    unobserve(element) { this.elements.delete(element); }
    disconnect() { this.elements.clear(); }
    trigger(elements = [...this.elements]) { this.callback(elements.map(target => ({ target, isIntersecting: true }))); }
  };
  window.chrome = { runtime: {
    onMessage: { addListener: listener => listeners.push(listener) },
    async sendMessage(message) {
      requests.push(message);
      if (message.type === "BEGIN_SESSION") return { ok: true, data: { settings: publicSettings(settings), sessionId: `run-${requests.length}` } };
      if (message.type === "TRANSLATE") {
        try { return { ok: true, data: { translations: await translate(message.texts) } }; }
        catch (error) { return { ok: false, error: error.message }; }
      }
      return { ok: true, data: {} };
    }
  } };
  window.eval(script);
  const action = action => new Promise(resolve => listeners[0]({ type: "LINGO_ACTION", action }, {}, resolve));
  const status = () => { let value; listeners[0]({ type: "LINGO_STATUS" }, {}, result => { value = result; }); return value; };
  const translations = () => [...window.document.querySelectorAll("lingo-translation")].map(el => el.shadowRoot.querySelector(".text").textContent);
  return { dom, window, document: window.document, requests, observers, action, status, translations, close: async () => { await action("stop"); dom.window.close(); } };
}

test("inserts translations under original paragraphs while preserving links and markup", async () => {
  const h = harness('<article><h1>A meaningful title</h1><p id="p">Hello <strong>beautiful</strong> <a href="/docs">world</a>. Reading expands our perspective and brings us closer to each other.</p></article>');
  try {
    await h.action("start"); await until(() => h.status().translated === 2);
    const p = h.document.getElementById("p");
    assert.equal(p.lastElementChild.tagName, "LINGO-TRANSLATION");
    assert.equal(p.querySelector("strong").textContent, "beautiful");
    assert.equal(p.querySelector("a").getAttribute("href"), "/docs");
    assert.match(h.translations()[1], /Hello beautiful world/);
    assert.equal(p.lastElementChild.getAttribute("lang"), "zh-CN");
  } finally { await h.close(); }
});
test("page status reports only the current API/model selection, never credentials", async () => {
  const h = harness('<p>A paragraph for the current model.</p>', { provider: "openai", activeApiId: "chosen-api", openaiModel: "chosen-model", openaiKey: "private-key", openaiEndpoint: "https://private.example/v1" });
  try {
    await h.action("start");
    assert.deepEqual({ ...h.status().selection }, { provider: "openai", apiId: "chosen-api", model: "chosen-model", sourceLanguage: "auto", targetLanguage: "zh-CN" });
    assert.ok(!JSON.stringify(h.status()).includes("private"));
    await h.action("stop");
    assert.equal(Object.hasOwn(h.status(), "selection"), false);
  } finally { await h.close(); }
});
test("ignores inputs, code, controls, navigation, hidden and opted-out elements", async () => {
  const h = harness('<nav><p>Navigation links</p></nav><p translate="no">Private original</p><div contenteditable="true">Draft in progress</div><input value="secret"><textarea>private draft</textarea><pre><code>console.log("code")</code></pre><button>Do not translate</button><div style="display:none"><p>Hidden text</p></div><p>Translate only this visible paragraph.</p>');
  try { await h.action("start"); await until(() => h.status().translated === 1); assert.equal(h.translations().length, 1); assert.equal(h.requests.filter(r => r.type === "TRANSLATE").flatMap(r => r.texts).join(""), "Translate only this visible paragraph."); }
  finally { await h.close(); }
});
test("smart content scope excludes unrelated sidebars", async () => {
  const h = harness(`<aside><p>Unrelated sidebar text.</p></aside><main><p>${"Article content. ".repeat(10)}</p></main><footer><p>Footer content</p></footer>`);
  try { await h.action("start"); await until(() => h.status().translated === 1); assert.ok(!h.translations().join("").includes("sidebar")); }
  finally { await h.close(); }
});
test("all-page scope includes sidebars and respects opt-outs", async () => {
  const h = harness('<aside><p>Sidebar text to translate.</p></aside><article><p>Article to translate.</p></article>', { scope: "all" });
  try { await h.action("start"); await until(() => h.status().translated === 2); }
  finally { await h.close(); }
});
test("nested blocks do not create duplicate ancestor translations", async () => {
  const h = harness('<div><blockquote><p>A nested paragraph that should appear exactly once.</p></blockquote><ul><li><p>A list paragraph.</p></li><li>Direct list item.</li></ul></div>');
  try { await h.action("start"); await until(() => h.status().translated === 3); assert.equal(h.document.querySelectorAll("lingo-translation").length, 3); assert.ok(!h.document.querySelector("lingo-translation lingo-translation")); }
  finally { await h.close(); }
});
test("tables stay structurally valid", async () => {
  const h = harness('<table><tbody><tr><th>Original heading</th><td>Original table cell</td></tr></tbody></table>');
  try { await h.action("start"); await until(() => h.status().translated === 2); assert.equal(h.document.querySelector("tr").children.length, 2); assert.equal(h.document.querySelector("td").lastElementChild.tagName, "LINGO-TRANSLATION"); }
  finally { await h.close(); }
});
test("restoring original removes every injected element and cancels requests", async () => {
  const html = '<p>Hello world.</p><p>Another paragraph.</p>';
  const h = harness(html);
  try {
    await h.action("start"); await until(() => h.status().translated === 2); await h.action("stop");
    assert.equal(h.document.body.innerHTML, html); assert.equal(h.status().enabled, false);
    assert.equal(h.document.querySelector("lingo-toolbar"), null); assert.ok(h.requests.some(r => r.type === "CANCEL_SESSION"));
  } finally { await h.close(); }
});
test("repeated injection is idempotent and translated text never feeds back into requests", async () => {
  const h = harness('<p>Original paragraph.</p>');
  try { h.window.eval(script); await h.action("start"); await until(() => h.status().translated === 1); h.window.dispatchEvent(new h.window.Event("resize")); await sleep(300); assert.equal(h.requests.filter(r => r.type === "TRANSLATE").length, 1); }
  finally { await h.close(); }
});
test("new dynamic paragraphs are translated automatically", async () => {
  const h = harness('<div id="root"><p>First paragraph.</p></div>');
  try {
    await h.action("start"); await until(() => h.status().translated === 1);
    const p = h.document.createElement("p"); p.textContent = "New dynamic paragraph."; h.document.getElementById("root").append(p);
    await until(() => h.status().translated === 2); assert.match(h.translations().join(""), /New dynamic paragraph/);
  } finally { await h.close(); }
});
test("changed source text replaces stale translations", async () => {
  const h = harness('<p id="p">First version.</p>');
  try {
    await h.action("start"); await until(() => h.status().translated === 1);
    h.document.getElementById("p").firstChild.textContent = "Updated version.";
    await until(() => h.translations()[0]?.includes("Updated version."));
    assert.equal(h.document.querySelectorAll("lingo-translation").length, 1);
  } finally { await h.close(); }
});
test("source block changing into nested paragraphs retires its ancestor translation", async () => {
  const h = harness('<div id="root">Original direct text.</div>');
  try {
    await h.action("start"); await until(() => h.status().translated === 1);
    h.document.getElementById("root").innerHTML = '<p>First nested text.</p><p>Second nested text.</p>';
    await until(() => h.status().translated === 2); assert.equal(h.translations().length, 2);
  } finally { await h.close(); }
});
test("lazy loading does not translate offscreen paragraphs before intersection", async () => {
  const h = harness('<p>Visible content.</p><p>Offscreen content.</p>', { lazyLoad: true });
  try {
    await h.action("start"); await sleep(90); assert.equal(h.requests.filter(r => r.type === "TRANSLATE").length, 0);
    const observer = h.observers.at(-1); observer.trigger([h.document.querySelector("p")]);
    await until(() => h.status().translated === 1); assert.equal(h.status().total, 2);
  } finally { await h.close(); }
});
test("provider output is inserted as text, never interpreted as HTML", async () => {
  const h = harness('<p>Original content.</p>', {}, texts => texts.map(() => '<img src=x onerror="alert(1)"><script>alert(1)</script>'));
  try {
    await h.action("start"); await until(() => h.status().translated === 1);
    const shadow = h.document.querySelector("lingo-translation").shadowRoot;
    assert.equal(shadow.querySelector("img"), null); assert.equal(shadow.querySelector("script"), null); assert.match(h.translations()[0], /<img/);
  } finally { await h.close(); }
});
test("late responses cannot reinsert translations after restore", async () => {
  let release;
  const h = harness('<p>Original content.</p>', {}, texts => new Promise(resolve => { release = () => resolve(texts.map(() => "late translation")); }));
  try {
    await h.action("start"); await until(() => Boolean(release)); await h.action("stop"); release(); await sleep(80);
    assert.equal(h.document.querySelector("lingo-translation"), null); assert.equal(h.status().enabled, false);
  } finally { await h.close(); }
});
test("provider failure is visible and retry replaces errors", async () => {
  let fail = true;
  const h = harness('<p>Original content.</p>', {}, texts => { if (fail) throw new Error("Network unavailable"); return texts.map(() => "Recovered translation"); });
  try {
    await h.action("start"); await until(() => h.status().failed === 1); assert.match(h.translations()[0], /Network unavailable/);
    fail = false; await h.action("retry"); await until(() => h.status().translated === 1); assert.equal(h.translations()[0], "Recovered translation");
  } finally { await h.close(); }
});
test("continuous failures pause the pipeline instead of charging for a full page", async () => {
  const h = harness(Array.from({ length: 36 }, (_, i) => `<p>Paragraph ${i}.</p>`).join(""), {}, () => { throw new Error("Quota exceeded"); });
  try {
    await h.action("start"); await until(() => h.status().paused); await sleep(100);
    assert.equal(h.requests.filter(r => r.type === "TRANSLATE").length, 2); assert.ok(h.status().pending > 0);
  } finally { await h.close(); }
});
test("long paragraphs are split into bounded batches and reassembled into one block", async () => {
  const text = "Long paragraph content. ".repeat(500);
  const h = harness(`<p>${text}</p>`);
  try {
    await h.action("start"); await until(() => h.status().translated === 1);
    assert.equal(h.translations().length, 1);
    for (const request of h.requests.filter(r => r.type === "TRANSLATE")) { assert.ok(request.texts.length <= 6); assert.ok(request.texts.join("").length <= 6500); }
  } finally { await h.close(); }
});
test("Chinese originals and non-linguistic strings are skipped conservatively", async () => {
  const h = harness('<p>这是一段中文原文，不需要再翻译成中文。</p><p>https://example.com/docs</p><p>1234567890</p><p>English text with a useful meaning.</p>');
  try { await h.action("start"); await until(() => h.status().translated === 1); assert.equal(h.translations().length, 1); }
  finally { await h.close(); }
});
test("SPA navigation stops translation instead of sending a new page silently", async () => {
  const h = harness('<p>First page.</p>');
  try {
    await h.action("start"); await until(() => h.status().translated === 1);
    h.window.history.pushState({}, "", "/next-page"); h.document.querySelector("p").firstChild.textContent = "Another page.";
    await until(() => !h.status().enabled); assert.equal(h.document.querySelector("lingo-translation"), null);
  } finally { await h.close(); }
});
