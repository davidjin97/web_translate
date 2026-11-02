import { LANGUAGES, endpointPermissionPattern, normalizeSettings } from "./lib/settings.js";

export const $ = id => document.getElementById(id);
export async function send(type, payload = {}) {
  const result = await chrome.runtime.sendMessage({ type, ...payload });
  if (!result?.ok) throw new Error(result?.error || "插件未响应，请重新加载后再试。");
  return result.data;
}
export function fillLanguages(source, target) {
  if (source) source.append(new Option("自动检测", "auto"));
  for (const [code, name] of LANGUAGES) {
    source?.append(new Option(name, code));
    target?.append(new Option(name, code));
  }
}
export function showMessage(element, text, kind = "info") {
  element.textContent = text;
  element.dataset.kind = kind;
  element.hidden = !text;
}
export function settingsFromForm(form, previous) {
  const data = new FormData(form);
  const next = { ...previous };
  for (const [key, value] of data) next[key] = value;
  for (const key of ["lazyLoad", "showFloatingButton"]) next[key] = form.elements[key].checked;
  return normalizeSettings(next);
}
export async function grantEndpoint(settings) {
  if (settings.provider !== "openai") return;
  const origins = [endpointPermissionPattern(settings.openaiEndpoint)];
  // Called directly by Save/Test's user gesture; no prior async work.
  if (!await chrome.permissions.request({ origins })) throw new Error("未授予 API 域名访问权限，设置未保存。");
}
