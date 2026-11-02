import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { DEFAULT_SETTINGS } from "../extension/lib/settings.js";

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
