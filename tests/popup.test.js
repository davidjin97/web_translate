import test from "node:test";
import assert from "node:assert/strict";
import { mountUI, multiSettings } from "./ui-harness.js";

test("popup uses saved defaults and only displays models belonging to selected API", async t => {
  const h = await mountUI(t, "popup", multiSettings());
  assert.equal(h.$("apiId").value, "alpha");
  assert.equal(h.$("model").value, "qwen-large");
  assert.equal(h.$("llm-selection").hidden, false);
  h.change("apiId", "beta", "change");
  assert.deepEqual([...h.$("model").options].map(option => option.value), ["local-a", "local-b"]);
  assert.equal(h.$("model").value, "local-b");
  h.change("model", "local-a", "change");
  h.$("translate").click(); await h.tick();
  const action = h.calls.find(call => call.type === "TAB_ACTION");
  assert.deepEqual(action.selection, { provider: "openai", apiId: "beta", model: "local-a", sourceLanguage: "auto", targetLanguage: "zh-CN" });
  assert.ok(!JSON.stringify(action).includes("test-key"));
  assert.equal(h.calls.filter(call => call.type === "SAVE_SETTINGS").length, 0);
  assert.equal(h.stored().defaultApiId, "alpha");
  assert.equal(h.stored().apiProfiles[0].defaultModel, "qwen-large");
});
test("popup reopens with active session model and explicitly retranslates after changes", async t => {
  const initialState = { enabled: true, translated: 3, selection: { provider: "openai", apiId: "beta", model: "local-a", sourceLanguage: "auto", targetLanguage: "zh-CN" } };
  const h = await mountUI(t, "popup", multiSettings(), initialState);
  assert.equal(h.$("apiId").value, "beta");
  assert.equal(h.$("model").value, "local-a");
  assert.equal(h.$("retranslate").hidden, true);
  h.change("model", "local-b", "change");
  assert.equal(h.$("retranslate").hidden, false);
  assert.equal(h.calls.filter(call => call.type === "TAB_ACTION").length, 0);
  h.$("retranslate").click(); await h.tick();
  assert.equal(h.calls.find(call => call.type === "TAB_ACTION").selection.model, "local-b");
  assert.equal(h.$("retranslate").hidden, true);
  h.$("translate").click(); await h.tick();
  const stopped = h.calls.filter(call => call.type === "TAB_ACTION").at(-1);
  assert.equal(stopped.action, "stop");
  assert.equal(Object.hasOwn(stopped, "selection"), false);
});
test("built-in Google remains available without an LLM model selector", async t => {
  const h = await mountUI(t, "popup", { ...multiSettings(), provider: "google" });
  assert.equal(h.$("llm-selection").hidden, true);
  h.$("translate").click(); await h.tick();
  assert.deepEqual(h.calls.find(call => call.type === "TAB_ACTION").selection, { provider: "google", sourceLanguage: "auto", targetLanguage: "zh-CN" });
});
