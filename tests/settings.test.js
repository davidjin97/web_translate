import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_SETTINGS, normalizeSettings, publicSettings, chatEndpoint, endpointPermissionPattern, assertConfigured } from "../extension/lib/settings.js";

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
