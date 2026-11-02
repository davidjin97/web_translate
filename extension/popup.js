import { $, send, fillLanguages, showMessage } from "./ui.js";
import { normalizeSettings } from "./lib/settings.js";

let settings, tab, pageState = { enabled: false }, busy = false;
fillLanguages($("sourceLanguage"), $("targetLanguage"));

const selectedApi = () => settings?.apiProfiles.find(api => api.id === $("apiId").value);
function selection() {
  const value = { provider: $("provider").value, sourceLanguage: $("sourceLanguage").value, targetLanguage: $("targetLanguage").value };
  if (value.provider === "openai") Object.assign(value, { apiId: $("apiId").value, model: $("model").value });
  return value;
}
function fillModels(model) {
  const api = selectedApi();
  $("model").replaceChildren(...(api?.models ?? []).map(id => new Option(id, id)));
  $("model").value = api?.models.includes(model) ? model : api?.defaultModel ?? "";
}
function render() {
  $("translate-label").textContent = busy ? "请稍候…" : pageState.enabled ? "恢复原文" : "翻译此页";
  $("translate").classList.toggle("restore", Boolean(pageState.enabled));
  $("translate").disabled = busy || !tab || !settings;
  for (const key of ["provider", "apiId", "model", "sourceLanguage", "targetLanguage"]) $(key).disabled = busy || !settings;
  $("llm-selection").hidden = $("provider").value !== "openai";
  $("progress").hidden = !pageState.enabled;
  $("progress-text").textContent = pageState.paused ? "请求已暂停" : `${pageState.translated || 0} 段已译${pageState.pending ? ` · ${pageState.pending} 段处理中` : ""}`;
  $("retry").hidden = !pageState.failed && !pageState.paused;
  $("retry").disabled = busy;
  const changed = pageState.selection && Object.entries(selection()).some(([key, value]) => pageState.selection[key] !== value);
  $("retranslate").hidden = !pageState.enabled || !changed;
  $("retranslate").disabled = busy;
  $("provider-hint").textContent = $("provider").value === "openai" ? `${selectedApi()?.name || "尚未配置 API"} · 使用你的 API 账户额度` : $("provider").value === "google-cloud" ? "需要启用 Google Cloud Translation API 及计费。" : "免 Key 接口仅供试用，需能访问 Google。";
  if (pageState.notice && $("message").hidden) showMessage($("message"), pageState.notice);
}

async function refresh() {
  if (!tab || busy) return;
  pageState = await send("TAB_STATUS", { tabId: tab.id }); render();
}

$("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
for (const key of ["provider", "apiId", "model", "sourceLanguage", "targetLanguage"]) $(key).addEventListener("change", () => {
  if (key === "apiId") fillModels();
  showMessage($("message"), pageState.enabled ? "当前译文仍使用原配置。点击“使用新配置重新翻译”即可切换。" : "");
  render();
});

async function act(action) {
  if (busy || !settings || !tab) return;
  busy = true; showMessage($("message"), ""); render();
  try {
    pageState = await send("TAB_ACTION", { tabId: tab.id, action, ...(action === "start" ? { selection: selection() } : {}) });
    if (pageState.error) throw new Error(pageState.error);
  } catch (error) { showMessage($("message"), error.message, "error"); }
  finally { busy = false; render(); }
}
$("translate").addEventListener("click", () => act(pageState.enabled ? "stop" : "start"));
$("retranslate").addEventListener("click", () => act("start"));
$("retry").addEventListener("click", () => act("retry"));

try {
  let saved;
  [saved, [tab]] = await Promise.all([send("GET_SETTINGS"), chrome.tabs.query({ active: true, currentWindow: true })]);
  settings = normalizeSettings(saved);
  for (const key of ["provider", "sourceLanguage", "targetLanguage"]) $(key).value = settings[key];
  $("apiId").replaceChildren(...settings.apiProfiles.map(api => new Option(api.name, api.id)));
  $("apiId").value = settings.defaultApiId; fillModels();
  $("page-title").textContent = tab?.title || "未找到网页";
  try { $("page-host").textContent = new URL(tab?.url).hostname; } catch { $("page-host").textContent = "此页面可能无法翻译"; }
  await refresh();
  if (pageState.enabled && pageState.selection) {
    const active = pageState.selection;
    for (const key of ["provider", "sourceLanguage", "targetLanguage"]) $(key).value = active[key];
    if (settings.apiProfiles.some(api => api.id === active.apiId)) { $("apiId").value = active.apiId; fillModels(active.model); }
  }
  render();
  const timer = setInterval(() => refresh().catch(() => {}), 1200);
  window.addEventListener("pagehide", () => clearInterval(timer), { once: true });
} catch (error) { showMessage($("message"), error.message, "error"); }
