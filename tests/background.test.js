import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS } from "../extension/lib/settings.js";
import { multiSettings } from "./ui-harness.js";

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

test("named APIs route temporary selections securely and keep durable snapshots independent", async t => {
  const f = fixture(), originalChrome = globalThis.chrome, originalFetch = globalThis.fetch;
  globalThis.chrome = f.chrome;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"translations":["测试译文"]}' } }] }));
  };
  t.after(() => { globalThis.chrome = originalChrome; globalThis.fetch = originalFetch; });
  f.chrome.storage.local.values.settings = multiSettings();
  await f.restart();
  let active;
  const startSelection = async selection => {
    f.chrome.tabs.sendMessage = async (id, message) => {
      if (message.type === "LINGO_STATUS") return { enabled: false };
      assert.deepEqual(message, { type: "LINGO_ACTION", action: "start" });
      const result = await f.send({ type: "BEGIN_SESSION" }, { ...f.content, tab: { id } });
      if (!result.ok) return { error: result.error };
      active = result.data;
      return { enabled: true };
    };
    return f.send({ type: "TAB_ACTION", tabId: 1, action: "start", selection }, f.ui);
  };
  await t.test("only configured selections are allowed and no credentials enter tab messages", async () => {
    for (const selection of [{ apiId: "missing" }, { apiId: "beta", model: "qwen-small" }, { endpoint: "https://evil.example", key: "injected" }]) {
      assert.equal((await startSelection(selection)).ok, false);
    }
    assert.equal((await f.send({ type: "BEGIN_SESSION", selection: { apiId: "beta" } })).ok, false);
    assert.equal(requests.length, 0);
  });
  await t.test("non-default API must have domain permission before it can be selected", async () => {
    f.chrome.permissions.contains = async ({ origins }) => !origins.includes("http://192.168.1.10/*");
    assert.equal((await startSelection({ apiId: "beta", model: "local-a" })).ok, false);
    assert.equal((await f.send({ type: "SAVE_SETTINGS", settings: multiSettings() }, f.ui)).ok, false);
    f.chrome.permissions.contains = async () => true;
  });
  let selectedSession;
  await t.test("selected API uses its own key, endpoint and model without changing defaults", async () => {
    assert.equal((await startSelection({ apiId: "beta", model: "local-a" })).ok, true);
    selectedSession = active.sessionId;
    assert.equal(active.settings.apiId, "beta");
    assert.equal(active.settings.openaiModel, "local-a");
    assert.ok(!JSON.stringify(active).includes("test-key"));
    assert.ok(!Object.hasOwn(active.settings, "apiProfiles"));
    const durable = JSON.stringify(f.chrome.storage.session.values);
    assert.ok(durable.includes("beta-test-key"));
    assert.ok(!durable.includes("alpha-test-key"));
    assert.ok(!durable.includes("apiProfiles"));
    assert.equal((await f.send({ type: "TRANSLATE", sessionId: selectedSession, texts: ["Hello"] })).ok, true);
    assert.equal(requests[0].url, "http://192.168.1.10:8000/v1/chat/completions");
    assert.equal(requests[0].headers.Authorization, "Bearer beta-test-key");
    assert.equal(requests[0].body.model, "local-a");
    assert.equal(f.chrome.storage.local.values.settings.defaultApiId, "alpha");
    assert.equal(f.chrome.storage.local.values.settings.apiProfiles[1].defaultModel, "local-b");
  });
  await t.test("saved profile edits and worker suspension do not change an active session", async () => {
    const changed = multiSettings();
    changed.apiProfiles[1].endpoint = "https://changed.example/v1";
    changed.apiProfiles[1].key = "changed-test-key";
    assert.equal((await f.send({ type: "SAVE_SETTINGS", settings: changed }, f.ui)).ok, true);
    await f.restart();
    assert.equal((await f.send({ type: "TRANSLATE", sessionId: selectedSession, texts: ["Another paragraph"] })).ok, true);
    assert.equal(requests.at(-1).url, "http://192.168.1.10:8000/v1/chat/completions");
    assert.equal(requests.at(-1).headers.Authorization, "Bearer beta-test-key");
    assert.equal(requests.at(-1).body.model, "local-a");
  });
  await t.test("next default start ignores prior one-shot selection and model caches stay separate", async () => {
    assert.equal((await startSelection(undefined)).ok, true);
    assert.equal(active.settings.apiId, "alpha");
    assert.equal(active.settings.openaiModel, "qwen-large");
    await f.send({ type: "TRANSLATE", sessionId: active.sessionId, texts: ["Hello"] });
    assert.equal(requests.at(-1).url, "https://alpha.example/v1/chat/completions");
    assert.equal(requests.at(-1).headers.Authorization, "Bearer alpha-test-key");
    const before = requests.length;
    assert.equal((await startSelection({ apiId: "alpha", model: "qwen-small" })).ok, true);
    await f.send({ type: "TRANSLATE", sessionId: active.sessionId, texts: ["Hello"] });
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).body.model, "qwen-small");
    await f.send({ type: "CANCEL_SESSION", sessionId: active.sessionId });
  });
  await t.test("connection testing can target a non-default API without saving it", async () => {
    const before = structuredClone(f.chrome.storage.local.values.settings);
    const result = await f.send({ type: "TEST_CONNECTION", settings: multiSettings(), selection: { apiId: "beta", model: "local-b" } }, f.ui);
    assert.equal(result.ok, true);
    assert.equal(requests.at(-1).headers.Authorization, "Bearer beta-test-key");
    assert.equal(requests.at(-1).body.model, "local-b");
    assert.deepEqual(f.chrome.storage.local.values.settings, before);
  });
});
