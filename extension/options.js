import { $, send, fillLanguages, showMessage, settingsFromForm, grantEndpoint } from "./ui.js";
import { chatEndpoint } from "./lib/settings.js";

let settings, dirty = false;
const form = $("settings-form");
fillLanguages($("sourceLanguage"), $("targetLanguage"));

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
}
form.addEventListener("input", markDirty);
form.addEventListener("change", markDirty);

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
    const next = settingsFromForm(form, settings);
    await grantEndpoint(next);
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
    const next = settingsFromForm(form, settings);
    await grantEndpoint(next);
    const result = await send("TEST_CONNECTION", { settings: next });
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
  settings = await send("GET_SETTINGS");
  for (const [key, value] of Object.entries(settings)) {
    const element = form.elements[key];
    if (!element) continue;
    if (key === "provider") element.value = value;
    else if (element.type === "checkbox") element.checked = value;
    else element.value = value;
  }
  preview();
} catch (error) { showMessage($("message"), error.message, "error"); }
