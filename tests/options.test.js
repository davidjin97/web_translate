import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { DEFAULT_SETTINGS } from "../extension/lib/settings.js";
import { mountUI, multiSettings } from "./ui-harness.js";

test("HTTP settings UI warns without blocking Save or Test", async t => {
  const dom = new JSDOM(readFileSync(new URL("../extension/options.html", import.meta.url), "utf8"), { url: "https://extension.example/options.html" });
  const calls = [], grants = [];
  const replacements = {
    document: dom.window.document, window: dom.window, Option: dom.window.Option, FormData: dom.window.FormData,
    chrome: {
      runtime: { async sendMessage(message) {
        calls.push(message);
        if (message.type === "GET_SETTINGS") return { ok: true, data: { ...DEFAULT_SETTINGS } };
        if (message.type === "TEST_CONNECTION") return { ok: true, data: { translation: "你好" } };
        return { ok: true, data: {} };
      } },
      permissions: { async request(input) { grants.push(input.origins); return true; } }
    }
  };
  const previous = new Map(Object.keys(replacements).map(key => [key, { owned: Object.hasOwn(globalThis, key), value: globalThis[key] }]));
  Object.assign(globalThis, replacements);
  t.after(() => {
    dom.window.close();
    for (const [key, item] of previous) { if (item.owned) globalThis[key] = item.value; else delete globalThis[key]; }
  });
  await import(`../extension/options.js?test=${Math.random()}`);
  const document = dom.window.document;
  const change = element => element.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  const provider = document.querySelector('input[name="provider"][value="openai"]');
  provider.checked = true; change(provider);
  const endpoint = document.getElementById("openaiEndpoint"), warning = document.getElementById("http-warning");
  assert.equal(warning.hidden, true);
  endpoint.value = "http://192.168.1.10:8000/v1"; change(endpoint);
  assert.equal(warning.hidden, false);
  assert.match(warning.textContent, /不加密/);
  assert.equal(document.getElementById("save").disabled, false);
  endpoint.value = "https://gateway.example/v1"; change(endpoint);
  assert.equal(warning.hidden, true);
  endpoint.value = "http://192.168.1.10:8000/v1"; change(endpoint);

  document.getElementById("settings-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise(resolve => setTimeout(resolve, 0));
  const saved = calls.find(call => call.type === "SAVE_SETTINGS");
  assert.equal(saved.settings.openaiEndpoint, "http://192.168.1.10:8000/v1");
  assert.deepEqual(grants.at(-1), ["http://192.168.1.10/*"]);
  assert.equal(document.getElementById("message").textContent, "设置已保存。");

  document.getElementById("test-connection").click();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(calls.find(call => call.type === "TEST_CONNECTION").settings.openaiEndpoint, saved.settings.openaiEndpoint);
  assert.equal(document.getElementById("connection-status").textContent, "连接成功：你好");
  assert.deepEqual(grants.at(-1), ["http://192.168.1.10/*"]);
});

test("settings manages named APIs, multiple models and independent defaults", async t => {
  const h = await mountUI(t, "options", multiSettings());
  assert.equal(h.$("defaultApiId").value, "alpha");
  assert.equal(h.$("api-profile").value, "alpha");
  assert.equal(h.$("apiDefaultModel").value, "qwen-large");
  h.change("apiName", "我的 Qwen API");
  h.change("apiModels", "qwen-small\nqwen-large\nqwen-new");
  h.change("apiDefaultModel", "qwen-new", "change");
  h.change("api-profile", "beta", "change");
  assert.equal(h.$("apiName").value, "内网模型");
  assert.equal(h.$("openaiKey").value, "beta-test-key");
  assert.equal(h.$("apiDefaultModel").value, "local-b");
  h.change("defaultApiId", "beta", "change");
  await h.save();
  const saved = h.stored();
  assert.equal(saved.defaultApiId, "beta");
  assert.equal(saved.openaiModel, "local-b");
  assert.equal(saved.apiProfiles[0].name, "我的 Qwen API");
  assert.deepEqual(saved.apiProfiles[0].models, ["qwen-small", "qwen-large", "qwen-new"]);
  assert.equal(saved.apiProfiles[0].defaultModel, "qwen-new");
  assert.equal(saved.apiProfiles[0].key, "alpha-test-key");
  assert.deepEqual(h.grants.at(-1), ["https://alpha.example/*", "http://192.168.1.10/*"]);
  h.change("api-profile", "alpha", "change");
  assert.equal(h.$("apiDefaultModel").value, "qwen-new");
  assert.equal(h.$("defaultApiId").value, "beta");
});
test("connection test targets the edited API, not the globally default API", async t => {
  const h = await mountUI(t, "options", multiSettings());
  h.change("api-profile", "beta", "change");
  h.change("apiDefaultModel", "local-a", "change");
  h.$("test-connection").click(); await h.tick();
  const request = h.calls.find(call => call.type === "TEST_CONNECTION");
  assert.deepEqual(request.selection, { apiId: "beta", model: "local-a" });
  assert.equal(request.settings.defaultApiId, "alpha");
  assert.deepEqual(h.grants.at(-1), ["http://192.168.1.10/*"]);
  assert.equal(h.stored().apiProfiles[1].defaultModel, "local-b");
  assert.equal(h.calls.filter(call => call.type === "SAVE_SETTINGS").length, 0);
});
test("adding and deleting an API preserves other credentials and repairs deleted defaults", async t => {
  const h = await mountUI(t, "options", multiSettings());
  h.$("add-api").click();
  const addedId = h.$("api-profile").value;
  assert.notEqual(addedId, "alpha");
  h.change("apiName", "新服务商");
  h.change("openaiEndpoint", "http://localhost:11434/v1");
  h.change("apiModels", "qwen:7b\nqwen:14b");
  h.change("apiDefaultModel", "qwen:14b", "change");
  h.change("defaultApiId", addedId, "change");
  await h.save();
  assert.equal(h.stored().apiProfiles.length, 3);
  assert.equal(h.stored().defaultApiId, addedId);
  assert.equal(h.stored().openaiModel, "qwen:14b");
  h.$("delete-api").click();
  assert.equal(h.$("defaultApiId").value, "alpha");
  await h.save();
  assert.equal(h.stored().apiProfiles.length, 2);
  assert.equal(h.stored().apiProfiles[0].key, "alpha-test-key");
  h.change("api-profile", "beta", "change"); h.$("delete-api").click();
  assert.equal(h.$("delete-api").disabled, true);
});
test("removing the default model selects an available fallback, while duplicates cannot save", async t => {
  const h = await mountUI(t, "options", multiSettings());
  h.change("apiModels", "qwen-small");
  assert.equal(h.$("apiDefaultModel").value, "qwen-small");
  await h.save();
  assert.equal(h.stored().apiProfiles[0].defaultModel, "qwen-small");
  h.change("apiModels", "qwen-small\nqwen-small");
  const previousCalls = h.calls.length;
  await h.save();
  assert.equal(h.calls.length, previousCalls);
  assert.match(h.$("message").textContent, /不能重复/);
});
test("permission refusal leaves stored profiles and defaults unchanged", async t => {
  const h = await mountUI(t, "options", multiSettings());
  h.change("defaultApiId", "beta", "change");
  h.denyPermission(); await h.save();
  assert.equal(h.stored().defaultApiId, "alpha");
  assert.equal(h.calls.filter(call => call.type === "SAVE_SETTINGS").length, 0);
  assert.match(h.$("message").textContent, /未授予/);
});
