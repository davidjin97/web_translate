import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { normalizeSettings } from "../extension/lib/settings.js";

export const multiSettings = () => normalizeSettings({
  provider: "openai", defaultApiId: "alpha",
  apiProfiles: [
    { id: "alpha", name: "硅基流动", endpoint: "https://alpha.example/v1", key: "alpha-test-key", models: ["qwen-small", "qwen-large"], defaultModel: "qwen-large" },
    { id: "beta", name: "内网模型", endpoint: "http://192.168.1.10:8000/v1", key: "beta-test-key", models: ["local-a", "local-b"], defaultModel: "local-b" }
  ]
});

export async function mountUI(t, page, initial, initialState = { enabled: false }) {
  const dom = new JSDOM(readFileSync(new URL(`../extension/${page}.html`, import.meta.url), "utf8"), { url: `https://extension.example/${page}.html` });
  const calls = [], grants = [];
  let stored = structuredClone(initial), state = structuredClone(initialState), allow = true;
  const replacements = {
    document: dom.window.document, window: dom.window, Option: dom.window.Option, FormData: dom.window.FormData,
    setInterval: () => 1, clearInterval: () => {},
    chrome: {
      runtime: {
        openOptionsPage: async () => {},
        async sendMessage(message) {
          calls.push(structuredClone(message));
          if (message.type === "GET_SETTINGS") return { ok: true, data: structuredClone(stored) };
          if (message.type === "SAVE_SETTINGS") { stored = structuredClone(message.settings); return { ok: true, data: {} }; }
          if (message.type === "TEST_CONNECTION") return { ok: true, data: { translation: "你好" } };
          if (message.type === "TAB_STATUS") return { ok: true, data: structuredClone(state) };
          if (message.type === "TAB_ACTION") {
            state = message.action === "stop" ? { enabled: false } : { enabled: true, selection: message.selection ?? state.selection };
            return { ok: true, data: structuredClone(state) };
          }
          return { ok: true, data: {} };
        }
      },
      permissions: { async request(input) { grants.push(input.origins); return allow; } },
      tabs: { query: async () => [{ id: 1, title: "Example page", url: "https://example.com/article" }] }
    }
  };
  const previous = new Map(Object.keys(replacements).map(key => [key, { owned: Object.hasOwn(globalThis, key), value: globalThis[key] }]));
  Object.assign(globalThis, replacements);
  dom.window.confirm = () => true;
  t.after(() => {
    dom.window.close();
    for (const [key, item] of previous) { if (item.owned) globalThis[key] = item.value; else delete globalThis[key]; }
  });
  await import(`../extension/${page}.js?test=${Math.random()}`);
  const $ = id => dom.window.document.getElementById(id);
  const change = (id, value, type = "input") => { $(id).value = value; $(id).dispatchEvent(new dom.window.Event(type, { bubbles: true })); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  const save = async () => { $("settings-form").dispatchEvent(new dom.window.Event("submit", { bubbles: true, cancelable: true })); await tick(); };
  return { dom, $, change, calls, grants, tick, save, stored: () => stored, denyPermission: () => { allow = false; } };
}
