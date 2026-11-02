import { $, send, fillLanguages, showMessage, settingsFromForm, grantEndpoint, grantAllEndpoints } from "./ui.js";
import { chatEndpoint, normalizeSettings, resolveTranslationSettings } from "./lib/settings.js";

let settings, profiles = [], editingId, dirty = false, loading = true;
const form = $("settings-form");
fillLanguages($("sourceLanguage"), $("targetLanguage"));

const editingApi = () => profiles.find(api => api.id === editingId);
function fillSelect(element, values, selected) {
  element.replaceChildren(...values.map(([value, label]) => new Option(label, value)));
  element.value = selected;
}
function readEditor() {
  const api = editingApi();
  if (!api) return;
  api.name = $("apiName").value;
  api.endpoint = $("openaiEndpoint").value;
  api.key = $("openaiKey").value;
  api.models = $("apiModels").value.split(/\r?\n/).map(model => model.trim()).filter(Boolean);
  api.defaultModel = api.models.includes($("apiDefaultModel").value) ? $("apiDefaultModel").value : api.models[0] ?? "";
}
function renderChoices() {
  const defaultId = $("defaultApiId").value || settings?.defaultApiId;
  const choices = profiles.map(api => [api.id, api.name.trim() || "未命名 API"]);
  fillSelect($("defaultApiId"), choices, profiles.some(api => api.id === defaultId) ? defaultId : profiles[0]?.id);
  fillSelect($("api-profile"), choices, editingId);
  const api = editingApi();
  fillSelect($("apiDefaultModel"), (api?.models ?? []).map(model => [model, model]), api?.defaultModel);
  $("apiDefaultModel").disabled = !api?.models.length;
  $("delete-api").disabled = profiles.length <= 1;
  $("add-api").disabled = profiles.length >= 20;
}
function renderEditor() {
  const api = editingApi();
  $("apiName").value = api.name;
  $("openaiEndpoint").value = api.endpoint;
  $("openaiKey").value = api.key;
  $("openaiKey").type = "password";
  document.querySelector('[data-for="openaiKey"]').textContent = "显示";
  $("apiModels").value = api.models.join("\n");
  renderChoices(); preview();
}
function preview() {
  const provider = new FormData(form).get("provider");
  for (const id of ["google", "google-cloud", "openai"]) $(`${id}-config`).hidden = provider !== id;
  let usesHTTP = false;
  try { usesHTTP = new URL(chatEndpoint($("openaiEndpoint").value)).protocol === "http:"; } catch { /* Show validation errors on Save/Test instead. */ }
  $("http-warning").hidden = provider !== "openai" || !usesHTTP;
  $("font-size-value").textContent = `${$("fontSize").value}%`;
  $("preview-translation").className = `preview-translation ${$("style").value}`;
  $("preview-translation").style.fontSize = `${Number($("fontSize").value) * 0.15}px`;
}
function markDirty() {
  dirty = true; $("save-status").textContent = "有未保存的更改"; preview();
  $("connection-status").textContent = "配置已更改，可重新测试连接。";
  delete $("connection-status").dataset.kind;
}
for (const type of ["input", "change"]) form.addEventListener(type, event => {
  if (loading || event.target.id === "api-profile") return;
  readEditor(); renderChoices(); markDirty();
});
$("api-profile").addEventListener("change", () => {
  if (loading) return;
  readEditor(); editingId = $("api-profile").value; renderEditor();
  $("connection-status").textContent = "可测试当前 API 和它的默认模型。";
  delete $("connection-status").dataset.kind;
});
$("add-api").addEventListener("click", () => {
  if (loading || profiles.length >= 20) return;
  readEditor();
  const api = { id: crypto.randomUUID(), name: `新 API ${profiles.length + 1}`, endpoint: "https://api.openai.com/v1", key: "", models: ["gpt-4.1-mini"], defaultModel: "gpt-4.1-mini" };
  profiles.push(api); editingId = api.id; renderEditor(); markDirty(); $("apiName").focus();
});
$("delete-api").addEventListener("click", () => {
  if (loading || profiles.length <= 1) return;
  if (!window.confirm(`删除「${editingApi().name || "未命名 API"}」及其模型？点击保存设置后生效。`)) return;
  profiles = profiles.filter(api => api.id !== editingId);
  editingId = profiles[0].id; renderEditor(); markDirty();
});
function nextSettings() {
  readEditor();
  return settingsFromForm(form, { ...settings, apiProfiles: profiles, defaultApiId: $("defaultApiId").value });
}

document.querySelectorAll(".reveal").forEach(button => button.addEventListener("click", () => {
  const input = $(button.dataset.for);
  input.type = input.type === "password" ? "text" : "password";
  button.textContent = input.type === "password" ? "显示" : "隐藏";
}));

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!settings) return;
  $("save").disabled = true;
  try {
    const next = nextSettings();
    await grantAllEndpoints(next);
    await send("SAVE_SETTINGS", { settings: next });
    settings = next; dirty = false;
    $("save-status").textContent = "设置已保存到本机 · 重新开启翻译即可生效";
    showMessage($("message"), "设置已保存。", "success");
  } catch (error) { showMessage($("message"), error.message, "error"); }
  finally { $("save").disabled = false; }
});

$("test-connection").addEventListener("click", async () => {
  if (!settings) return;
  $("test-connection").disabled = true; $("connection-status").textContent = "正在用示例句测试连接…";
  try {
    const next = nextSettings();
    const selection = next.provider === "openai" ? { apiId: editingId, model: editingApi().defaultModel } : {};
    await grantEndpoint(resolveTranslationSettings(next, selection));
    const result = await send("TEST_CONNECTION", { settings: next, selection });
    $("connection-status").textContent = `连接成功：${result.translation}`;
    $("connection-status").dataset.kind = "success";
  } catch (error) { $("connection-status").textContent = error.message; $("connection-status").dataset.kind = "error"; }
  finally { $("test-connection").disabled = false; }
});
$("clear-cache").addEventListener("click", async () => {
  try { await send("CLEAR_CACHE"); showMessage($("message"), "翻译缓存已清除，已插入的译文不受影响。", "success"); }
  catch (error) { showMessage($("message"), error.message, "error"); }
});
document.querySelectorAll(".settings-nav a").forEach(link => link.addEventListener("click", () => {
  document.querySelectorAll(".settings-nav a").forEach(item => item.classList.toggle("active", item === link));
}));
window.addEventListener("beforeunload", event => { if (dirty) { event.preventDefault(); event.returnValue = ""; } });

try {
  settings = normalizeSettings(await send("GET_SETTINGS"));
  profiles = structuredClone(settings.apiProfiles); editingId = settings.defaultApiId;
  for (const [key, value] of Object.entries(settings)) {
    const element = form.elements[key];
    if (!element || key === "defaultApiId") continue;
    if (key === "provider") element.value = value;
    else if (element.type === "checkbox") element.checked = value;
    else element.value = value;
  }
  renderEditor(); loading = false;
} catch (error) { showMessage($("message"), error.message, "error"); }
