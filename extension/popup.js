import { $, send, fillLanguages, showMessage } from "./ui.js";

let settings, tab, pageState = { enabled: false }, busy = false, saving = Promise.resolve();
fillLanguages($("sourceLanguage"), $("targetLanguage"));

function render() {
  $("translate-label").textContent = busy ? "请稍候…" : pageState.enabled ? "恢复原文" : "翻译此页";
  $("translate").classList.toggle("restore", Boolean(pageState.enabled));
  $("translate").disabled = busy || !tab || !settings;
  $("progress").hidden = !pageState.enabled;
  $("progress-text").textContent = pageState.paused ? "请求已暂停" : `${pageState.translated || 0} 段已译${pageState.pending ? ` · ${pageState.pending} 段处理中` : ""}`;
  $("retry").hidden = !pageState.failed && !pageState.paused;
  $("provider-hint").textContent = settings?.provider === "openai" ? `模型：${settings.openaiModel || "尚未配置"} · 使用你自己的 API 额度` : settings?.provider === "google-cloud" ? "需要启用 Google Cloud Translation API 及计费。" : "免 Key 接口仅供试用，需能访问 Google。";
  if (pageState.notice) showMessage($("message"), pageState.notice);
}

async function refresh() {
  if (!tab || busy) return;
  pageState = await send("TAB_STATUS", { tabId: tab.id }); render();
}

$("open-options").addEventListener("click", () => chrome.runtime.openOptionsPage());
for (const key of ["provider", "sourceLanguage", "targetLanguage"]) {
  $(key).addEventListener("change", () => {
    const value = $(key).value;
    saving = saving.catch(() => {}).then(async () => {
      busy = true; render();
      const previous = settings;
      try {
        const next = { ...settings, [key]: value };
        await send("SAVE_SETTINGS", { settings: next }); settings = next;
        showMessage($("message"), pageState.enabled ? "配置已保存；恢复原文后重新翻译即可生效。" : "");
      } catch (error) { $(key).value = previous[key]; showMessage($("message"), error.message, "error"); }
      finally { busy = false; render(); }
    });
  });
}

async function act(action) {
  await saving;
  busy = true; showMessage($("message"), ""); render();
  try {
    pageState = await send("TAB_ACTION", { tabId: tab.id, action });
    if (pageState.error) throw new Error(pageState.error);
  } catch (error) { showMessage($("message"), error.message, "error"); }
  finally { busy = false; render(); }
}
$("translate").addEventListener("click", () => act(pageState.enabled ? "stop" : "start"));
$("retry").addEventListener("click", () => act("retry"));

try {
  [settings, [tab]] = await Promise.all([send("GET_SETTINGS"), chrome.tabs.query({ active: true, currentWindow: true })]);
  for (const key of ["provider", "sourceLanguage", "targetLanguage"]) $(key).value = settings[key];
  $("page-title").textContent = tab?.title || "未找到网页";
  try { $("page-host").textContent = new URL(tab?.url).hostname; } catch { $("page-host").textContent = "此页面可能无法翻译"; }
  await refresh(); render();
  setInterval(() => refresh().catch(() => {}), 1200);
} catch (error) { showMessage($("message"), error.message, "error"); }
