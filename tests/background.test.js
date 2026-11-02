import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../extension/lib/settings.js";

function area(initial = {}) {
  const values = structuredClone(initial);
  return {
    values, accessLevel: null,
    async setAccessLevel({ accessLevel }) { this.accessLevel = accessLevel; },
    async get(key) { return structuredClone(key === null ? values : { [key]: values[key] }); },
    async set(patch) { Object.assign(values, structuredClone(patch)); },
    async remove(key) { delete values[key]; }
  };
}
function fixture() {
  const listeners = { messages: [], removed: [], updated: [] };
  const badges = [];
  const chrome = {
    runtime: { id: "test-extension", getURL: path => `chrome-extension://test-extension/${path}`, onMessage: { addListener: fn => listeners.messages.push(fn) }, onInstalled: { addListener() {} }, openOptionsPage: async () => {} },
    storage: { local: area({ settings: { ...DEFAULT_SETTINGS, openaiKey: "local-secret", googleCloudKey: "cloud-secret" } }), session: area() },
    permissions: { contains: async () => true },
    tabs: { get: async id => ({ id, url: "https://example.com" }), sendMessage: async () => ({ enabled: false }), query: async () => [{ id: 1 }], onRemoved: { addListener: fn => listeners.removed.push(fn) }, onUpdated: { addListener: fn => listeners.updated.push(fn) } },
    scripting: { executeScript: async () => {} },
    action: { setBadgeText: async input => badges.push(input), setBadgeBackgroundColor: async () => {}, setTitle: async () => {} },
    commands: { onCommand: { addListener() {} } },
    contextMenus: { removeAll() {}, create() {}, onClicked: { addListener() {} } }
  };
  const content = { id: chrome.runtime.id, tab: { id: 1 }, frameId: 0, documentId: "doc-one", url: "https://example.com/article" };
  const ui = { id: chrome.runtime.id, tab: { id: 8 }, url: chrome.runtime.getURL("options.html") };
  let worker;
  const restart = async () => { await import(`../extension/background.js?test=${Math.random()}`); worker = listeners.messages.at(-1); };
  const send = (message, sender = content) => new Promise(resolve => worker(message, sender, resolve));
  return { chrome, listeners, badges, content, ui, restart, send };
}

test("background API authorization, credentials and durable sessions", async t => {
  const f = fixture(), originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
  globalThis.chrome = f.chrome;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls++; return new Response(JSON.stringify([[["你好世界", "Hello world"]]])); };
  t.after(() => { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; });
  await f.restart();

  await t.test("both storage areas are restricted to trusted extension contexts", () => {
    assert.equal(f.chrome.storage.local.accessLevel, "TRUSTED_CONTEXTS");
    assert.equal(f.chrome.storage.session.accessLevel, "TRUSTED_CONTEXTS");
  });
  await t.test("content scripts cannot read full configuration", async () => {
    assert.equal((await f.send({ type: "GET_SETTINGS" })).ok, false);
    const result = await f.send({ type: "GET_PUBLIC_SETTINGS" });
    assert.equal(result.ok, true); assert.ok(!JSON.stringify(result).includes("secret"));
    assert.equal((await f.send({ type: "GET_SETTINGS" }, f.ui)).data.openaiKey, "local-secret");
  });
  await t.test("content scripts and foreign callers cannot change settings or run connection tests", async () => {
    for (const type of ["SAVE_SETTINGS", "TEST_CONNECTION", "CLEAR_CACHE", "TAB_ACTION"]) assert.equal((await f.send({ type })).ok, false);
    assert.equal((await f.send({ type: "GET_PUBLIC_SETTINGS" }, { ...f.content, id: "foreign" })).ok, false);
  });
  let sessionId;
  await t.test("starting a translation creates a document-bound session without exposing keys", async () => {
    const result = await f.send({ type: "BEGIN_SESSION" });
    assert.equal(result.ok, true); sessionId = result.data.sessionId;
    assert.ok(!JSON.stringify(result).includes("secret"));
    assert.equal((await f.send({ type: "BEGIN_SESSION" }, { ...f.content, frameId: 1 })).ok, false);
  });
  await t.test("session cannot be used by a different tab or document", async () => {
    for (const sender of [{ ...f.content, tab: { id: 2 } }, { ...f.content, documentId: "other-doc" }]) {
      assert.equal((await f.send({ type: "TRANSLATE", sessionId, texts: ["Hello"] }, sender)).ok, false);
    }
    assert.equal(networkCalls, 0);
  });
  await t.test("oversized batches are rejected before any network request", async () => {
    for (const texts of [[], Array(7).fill("Hello"), ["x".repeat(8001)], [123], [""]]) {
      assert.equal((await f.send({ type: "TRANSLATE", sessionId, texts })).ok, false);
    }
    assert.equal(networkCalls, 0);
  });
  await t.test("translation is cached for repeated paragraphs", async () => {
    assert.deepEqual((await f.send({ type: "TRANSLATE", sessionId, texts: ["Hello world"] })).data.translations, ["你好世界"]);
    await f.send({ type: "TRANSLATE", sessionId, texts: ["Hello world"] });
    assert.equal(networkCalls, 1);
  });
  await t.test("service worker restart rehydrates the same user's session", async () => {
    await f.restart();
    const result = await f.send({ type: "TRANSLATE", sessionId, texts: ["Another paragraph"] });
    assert.equal(result.ok, true); assert.equal(networkCalls, 2);
  });
  await t.test("cancellation survives service worker restarts", async () => {
    assert.equal((await f.send({ type: "CANCEL_SESSION", sessionId })).ok, true);
    await f.restart();
    assert.equal((await f.send({ type: "TRANSLATE", sessionId, texts: ["Hello"] })).ok, false);
    assert.equal(Object.keys(f.chrome.storage.session.values).length, 0);
  });
  await t.test("custom API domains must be granted permission before saving", async () => {
    f.chrome.permissions.contains = async () => false;
    const result = await f.send({ type: "SAVE_SETTINGS", settings: { ...DEFAULT_SETTINGS, provider: "openai", openaiEndpoint: "https://custom.example/v1", openaiKey: "test-key" } }, f.ui);
    assert.equal(result.ok, false); assert.match(result.error, /授权/);
    f.chrome.permissions.contains = async () => true;
  });
  await t.test("tab navigation clears dormant durable sessions", async () => {
    await f.send({ type: "BEGIN_SESSION" });
    assert.equal(Object.keys(f.chrome.storage.session.values).length, 1);
    await f.restart(); f.listeners.updated.at(-1)(1, { status: "loading" });
    for (let attempt = 0; attempt < 10 && Object.keys(f.chrome.storage.session.values).length; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(Object.keys(f.chrome.storage.session.values).length, 0);
  });
  await t.test("HTTP settings require exact-domain permission and work for connection tests and translation", async () => {
    const settings = { ...DEFAULT_SETTINGS, provider: "openai", openaiEndpoint: "http://192.168.1.10:8000/v1", openaiKey: "test-only-key", openaiModel: "internal-model" };
    const origins = [];
    f.chrome.permissions.contains = async input => { origins.push(input.origins); return false; };
    assert.equal((await f.send({ type: "SAVE_SETTINGS", settings }, f.ui)).ok, false);
    assert.deepEqual(origins.at(-1), ["http://192.168.1.10/*"]);
    f.chrome.permissions.contains = async input => { origins.push(input.origins); return true; };
    assert.equal((await f.send({ type: "SAVE_SETTINGS", settings }, f.ui)).ok, true);
    assert.equal(f.chrome.storage.local.values.settings.openaiEndpoint, settings.openaiEndpoint);
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "http://192.168.1.10:8000/v1/chat/completions");
      assert.equal(init.headers.Authorization, "Bearer test-only-key");
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["你好"]}' } }] }));
    };
    assert.equal((await f.send({ type: "TEST_CONNECTION", settings }, f.ui)).data.translation, "你好");
    const started = await f.send({ type: "BEGIN_SESSION" });
    const result = await f.send({ type: "TRANSLATE", sessionId: started.data.sessionId, texts: ["Hello"] });
    assert.deepEqual(result.data.translations, ["你好"]);
    assert.ok(origins.every(origin => origin.length === 1 && origin[0] === "http://192.168.1.10/*"));
    await f.send({ type: "CANCEL_SESSION", sessionId: started.data.sessionId });
  });
});
