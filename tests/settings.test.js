import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS, normalizeSettings, resolveTranslationSettings, publicSettings, chatEndpoint, endpointPermissionPattern, assertConfigured } from "../extension/lib/settings.js";

test("defaults work without a key and unknown fields are discarded", () => {
  const settings = normalizeSettings({ injected: "no", targetLanguage: "ja" });
  assert.equal(settings.targetLanguage, "ja");
  assert.equal(settings.provider, "google");
  assert.equal(Object.hasOwn(settings, "injected"), false);
  assert.doesNotThrow(() => assertConfigured(settings));
});
test("public settings never expose credentials, endpoint or prompt", () => {
  const safe = publicSettings({ ...DEFAULT_SETTINGS, openaiKey: "SECRET", googleCloudKey: "SECRET", provider: "openai" });
  assert.equal(safe.configured, true);
  assert.ok(!JSON.stringify(safe).includes("SECRET"));
  assert.ok(!Object.hasOwn(safe, "openaiEndpoint"));
  assert.ok(!Object.hasOwn(safe, "prompt"));
});
test("base URLs and full Chat Completions endpoints normalize correctly", () => {
  assert.equal(chatEndpoint("https://api.openai.com/v1/"), "https://api.openai.com/v1/chat/completions");
  assert.equal(chatEndpoint("https://example.com/api/chat/completions"), "https://example.com/api/chat/completions");
  assert.equal(chatEndpoint("http://localhost:11434/v1"), "http://localhost:11434/v1/chat/completions");
});
test("endpoint permission patterns target one host regardless of local port", () => {
  assert.equal(endpointPermissionPattern("http://localhost:11434/v1"), "http://localhost/*");
  assert.equal(endpointPermissionPattern("http://192.168.1.10:8000/v1"), "http://192.168.1.10/*");
  assert.equal(endpointPermissionPattern("http://gateway.internal:8080/api"), "http://gateway.internal/*");
  assert.equal(endpointPermissionPattern("https://example.com:8443/api"), "https://example.com/*");
});
test("custom HTTP services accept IPs, domains, ports and full endpoints", () => {
  for (const base of ["http://192.168.1.10:8000/v1", "http://gateway.internal:8080/api", "http://example.com/v1"]) {
    assert.equal(chatEndpoint(base), `${base}/chat/completions`);
    assert.equal(chatEndpoint(`${base}/chat/completions/`), `${base}/chat/completions`);
    const settings = normalizeSettings({ provider: "openai", openaiEndpoint: base, openaiKey: "test-key" });
    assert.equal(settings.openaiEndpoint, base);
    assert.doesNotThrow(() => assertConfigured(settings));
    assert.throws(() => assertConfigured({ ...settings, openaiKey: "" }), /Key/);
  }
});
test("HTTP host access is optional and is never pre-granted to all sites", () => {
  const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));
  assert.ok(manifest.optional_host_permissions.includes("http://*/*"));
  assert.ok(!manifest.host_permissions.includes("http://*/*"));
  assert.ok(!manifest.host_permissions.includes("https://*/*"));
});
test("unsafe URLs are rejected", () => {
  for (const address of ["javascript:alert(1)", "ftp://example.com/v1", "https://user:key@example.com", "http://user:key@example.com/v1", "https://example.com?key=secret", "http://example.com?key=secret", "https://example.com/#secret", "http://example.com/#secret", "file:///tmp/model"]) {
    assert.throws(() => chatEndpoint(address));
  }
});
test("configuration validates languages, styles and limits", () => {
  for (const patch of [{ sourceLanguage: "xx" }, { provider: "other" }, { targetLanguage: "auto" }, { sourceLanguage: "en", targetLanguage: "en" }, { style: "evil" }, { fontSize: 140 }, { fontSize: "bad" }, { prompt: "x".repeat(2001) }]) {
    assert.throws(() => normalizeSettings(patch));
  }
});
test("LLM and Google Cloud require keys, but localhost models may be keyless", () => {
  assert.throws(() => assertConfigured({ ...DEFAULT_SETTINGS, provider: "openai" }), /Key/);
  assert.throws(() => assertConfigured({ ...DEFAULT_SETTINGS, provider: "google-cloud" }), /Key/);
  assert.doesNotThrow(() => assertConfigured({ ...DEFAULT_SETTINGS, provider: "openai", openaiEndpoint: "http://127.0.0.1:11434/v1" }));
  assert.throws(() => assertConfigured({ ...DEFAULT_SETTINGS, provider: "openai", openaiKey: "test", openaiModel: "" }), /模型/);
});

const apiProfiles = [
  { id: "first", name: "第一个 API", endpoint: "https://first.example/v1", key: "first-secret", models: ["model-a", "model-b"], defaultModel: "model-b" },
  { id: "second", name: "内网 API", endpoint: "http://192.168.1.10:8000/v1", key: "second-secret", models: ["model-c", "model-d"], defaultModel: "model-c" }
];
test("legacy configuration migrates to one named API without losing credentials or model", () => {
  const settings = normalizeSettings({ provider: "openai", openaiEndpoint: "http://gateway.internal/v1", openaiKey: "legacy-secret", openaiModel: "legacy-model" });
  assert.deepEqual(settings.apiProfiles, [{ id: "default-api", name: "我的 API", endpoint: "http://gateway.internal/v1", key: "legacy-secret", models: ["legacy-model"], defaultModel: "legacy-model" }]);
  assert.equal(settings.defaultApiId, "default-api");
  assert.deepEqual(normalizeSettings(settings), settings);
  assert.equal(normalizeSettings({ openaiModel: "" }).apiProfiles[0].defaultModel, DEFAULT_SETTINGS.openaiModel);
});
test("multiple APIs preserve independent models and derive aliases from the default", () => {
  const settings = normalizeSettings({ provider: "openai", apiProfiles, defaultApiId: "second" });
  assert.equal(settings.openaiEndpoint, apiProfiles[1].endpoint);
  assert.equal(settings.openaiKey, "second-secret");
  assert.equal(settings.openaiModel, "model-c");
  assert.equal(normalizeSettings({ ...settings, openaiKey: "stale-key" }).openaiKey, "second-secret");
  settings.apiProfiles[0].models.push("extra");
  assert.equal(apiProfiles[0].models.length, 2);
});
test("temporary API/model selection does not mutate saved defaults", () => {
  const saved = normalizeSettings({ provider: "openai", apiProfiles, defaultApiId: "first" });
  const selected = resolveTranslationSettings(saved, { apiId: "second", model: "model-d", targetLanguage: "ja" });
  assert.equal(selected.openaiEndpoint, apiProfiles[1].endpoint);
  assert.equal(selected.openaiKey, "second-secret");
  assert.equal(selected.openaiModel, "model-d");
  assert.equal(selected.activeApiId, "second");
  assert.equal(selected.defaultApiId, "first");
  assert.equal(saved.openaiModel, "model-b");
  assert.equal(saved.targetLanguage, "zh-CN");
  assert.equal(resolveTranslationSettings(saved, { apiId: "second" }).openaiModel, "model-c");
  assert.equal(resolveTranslationSettings(saved).openaiModel, "model-b");
});
test("public configuration strips every profile and secret, including inactive APIs", () => {
  const safe = publicSettings(resolveTranslationSettings({ provider: "openai", apiProfiles, defaultApiId: "first" }, { apiId: "second", model: "model-d" }));
  assert.equal(safe.apiId, "second");
  assert.equal(safe.openaiModel, "model-d");
  for (const text of ["secret", "first.example", "192.168.1.10", "内网", "apiProfiles", "prompt", "defaultApiId"]) assert.ok(!JSON.stringify(safe).includes(text));
});
test("selection only accepts configured API/model IDs and valid languages", () => {
  const saved = { provider: "openai", apiProfiles, defaultApiId: "first" };
  for (const selection of [{ apiId: "unknown" }, { apiId: "second", model: "model-a" }, { model: "missing" }, { endpoint: "https://evil.example" }, { key: "injected" }, { targetLanguage: "xx" }, { provider: "unknown" }, null, []]) {
    assert.throws(() => resolveTranslationSettings(saved, selection));
  }
});
test("nested API configuration validates limits, identities, URLs and default membership", () => {
  for (const patch of [{ id: "" }, { name: " " }, { name: "x".repeat(81) }, { endpoint: "http://user:secret@example.com" }, { key: "x".repeat(513) }, { models: [] }, { models: ["a", "a"] }, { models: [" "] }, { models: ["x".repeat(201)] }, { models: Array(51).fill("a") }, { defaultModel: "missing" }]) {
    assert.throws(() => normalizeSettings({ apiProfiles: [{ ...apiProfiles[0], ...patch }] }));
  }
  assert.throws(() => normalizeSettings({ apiProfiles: [] }));
  assert.throws(() => normalizeSettings({ apiProfiles: Array(21).fill(apiProfiles[0]) }));
  assert.throws(() => normalizeSettings({ apiProfiles: [apiProfiles[0], apiProfiles[0]] }));
  assert.throws(() => normalizeSettings({ apiProfiles, defaultApiId: "unknown" }));
  assert.throws(() => normalizeSettings({ apiProfiles: [apiProfiles[0], { ...apiProfiles[1], endpoint: "javascript:alert(1)" }] }));
  const settings = normalizeSettings({ apiProfiles: [{ ...apiProfiles[0], injected: "not-allowed" }] });
  assert.equal(Object.hasOwn(settings.apiProfiles[0], "injected"), false);
});
