import { DEFAULT_SETTINGS, normalizeSettings, publicSettings, endpointPermissionPattern, assertConfigured } from "./lib/settings.js";
import { translateTexts, TranslationCache, TaskQueue } from "./lib/providers.js";

const cache = new TranslationCache();
const queue = new TaskQueue(2);
const sessions = new Map();
const ready = Promise.all([
  chrome.storage.local.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }),
  chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })
]);
const sessionKey = id => `lingoSession:${id}`;
const isExtensionPage = sender => sender.url?.startsWith(chrome.runtime.getURL(""));

async function loadSettings() {
  await ready;
  const { settings } = await chrome.storage.local.get("settings");
  return normalizeSettings(settings ?? DEFAULT_SETTINGS);
}

async function requireEndpointPermission(settings) {
  if (settings.provider !== "openai") return;
  if (!await chrome.permissions.contains({ origins: [endpointPermissionPattern(settings.openaiEndpoint)] })) {
    throw new Error("尚未授权此 API 域名。请在设置中点击保存并允许访问。");
  }
}

async function cancelSession(id) {
  const session = sessions.get(id);
  if (session) for (const controller of session.controllers) controller.abort();
  sessions.delete(id);
  await chrome.storage.session.remove(sessionKey(id));
}

async function cancelTab(tabId) {
  await ready;
  const stored = await chrome.storage.session.get(null);
  const ids = new Set([
    ...[...sessions].filter(([, session]) => session.tabId === tabId).map(([id]) => id),
    ...Object.entries(stored).filter(([key, value]) => key.startsWith("lingoSession:") && value.tabId === tabId).map(([, value]) => value.sessionId)
  ]);
  await Promise.all([...ids].map(cancelSession));
}

async function getSession(message, sender) {
  if (typeof message.sessionId !== "string" || message.sessionId.length > 100) throw new Error("无效会话。");
  await ready;
  let session = sessions.get(message.sessionId);
  if (!session) {
    // Chrome can suspend its service worker between scrolls. Trusted session
    // storage preserves the user's snapshot without exposing keys to content scripts.
    const key = sessionKey(message.sessionId);
    const stored = (await chrome.storage.session.get(key))[key];
    if (stored) { session = { ...stored, controllers: new Set() }; sessions.set(message.sessionId, session); }
  }
  if (!session || session.tabId !== sender.tab?.id || session.documentId !== sender.documentId) {
    throw new Error("翻译会话已停止，请重新开始。");
  }
  return session;
}

async function ensureContent(tabId) {
  const tab = await chrome.tabs.get(tabId);
  if (!/^https?:\/\//.test(tab.url ?? "") || /^https:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(tab.url)) {
    throw new Error("此页面不允许插件翻译。请打开普通 HTTP / HTTPS 网页后再试。");
  }
  try { await chrome.tabs.sendMessage(tabId, { type: "LINGO_STATUS" }, { frameId: 0 }); }
  catch {
    try { await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] }); }
    catch { throw new Error("无法访问此页面，请刷新网页后再试。Chrome 内置页、商店和 PDF 不支持。"); }
  }
}

async function actOnTab(tabId, action) {
  if (!Number.isInteger(tabId)) throw new Error("找不到当前标签页。");
  await ensureContent(tabId);
  const result = await chrome.tabs.sendMessage(tabId, { type: "LINGO_ACTION", action }, { frameId: 0 });
  if (result?.error) throw new Error(result.error);
  return result;
}

async function handle(message, sender) {
  if (sender.id !== chrome.runtime.id || !message || typeof message.type !== "string") throw new Error("无效请求。");
  if (message.type === "GET_PUBLIC_SETTINGS") return publicSettings(await loadSettings());
  if (message.type === "BEGIN_SESSION") {
    if (!sender.tab || sender.frameId !== 0) throw new Error("只支持主网页翻译。");
    const settings = await loadSettings();
    assertConfigured(settings);
    await requireEndpointPermission(settings);
    await cancelTab(sender.tab.id);
    while (sessions.size >= 50) await cancelSession(sessions.keys().next().value);
    const sessionId = crypto.randomUUID();
    const snapshot = { sessionId, tabId: sender.tab.id, documentId: sender.documentId, settings };
    await chrome.storage.session.set({ [sessionKey(sessionId)]: snapshot });
    sessions.set(sessionId, { ...snapshot, controllers: new Set() });
    return { settings: publicSettings(settings), sessionId };
  }
  if (message.type === "CANCEL_SESSION") {
    await getSession(message, sender);
    await cancelSession(message.sessionId);
    return {};
  }
  if (message.type === "TRANSLATE") {
    const session = await getSession(message, sender);
    const texts = message.texts;
    if (!Array.isArray(texts) || !texts.length || texts.length > 6 || texts.some(t => typeof t !== "string" || !t.trim() || t.length > 8000) || texts.join("").length > 8000) {
      throw new Error("段落数量或长度超出限制。");
    }
    const settings = session.settings;
    const keys = texts.map(text => cache.key(text, settings));
    const results = keys.map(key => cache.get(key));
    const missing = texts.map((text, index) => ({ text, index })).filter(({ index }) => results[index] === undefined);
    if (missing.length) {
      const controller = new AbortController();
      session.controllers.add(controller);
      try {
        const translated = await queue.run(() => translateTexts(missing.map(item => item.text), settings, { signal: controller.signal }), controller.signal);
        if (controller.signal.aborted) throw new Error("翻译已停止。");
        missing.forEach(({ index }, offset) => { results[index] = translated[offset]; cache.set(keys[index], translated[offset]); });
      } finally { session.controllers.delete(controller); }
    }
    return { translations: results };
  }
  if (message.type === "STATUS_UPDATE") {
    if (!sender.tab || sender.frameId !== 0) return {};
    const text = message.enabled ? (message.pending > 0 ? "…" : "ON") : "";
    await chrome.action.setBadgeText({ tabId: sender.tab.id, text });
    await chrome.action.setBadgeBackgroundColor({ tabId: sender.tab.id, color: "#0f766e" });
    await chrome.action.setTitle({ tabId: sender.tab.id, title: "Lingo · 翻译此页 / 恢复原文" });
    return {};
  }
  // Full settings, credentials, tests and tab actions are only available to our own UI.
  if (!isExtensionPage(sender)) throw new Error("此操作仅可从插件设置页面执行。");
  if (message.type === "GET_SETTINGS") return await loadSettings();
  if (message.type === "SAVE_SETTINGS") {
    const settings = normalizeSettings(message.settings);
    await requireEndpointPermission(settings);
    await chrome.storage.local.set({ settings });
    cache.clear();
    return publicSettings(settings);
  }
  if (message.type === "TEST_CONNECTION") {
    const settings = normalizeSettings(message.settings);
    await requireEndpointPermission(settings);
    const translations = await queue.run(() => translateTexts(["Reading opens a window to the world."], settings, { retries: 0 }));
    return { translation: translations[0] };
  }
  if (message.type === "CLEAR_CACHE") { cache.clear(); return {}; }
  if (message.type === "OPEN_OPTIONS") { await chrome.runtime.openOptionsPage(); return {}; }
  if (message.type === "TAB_ACTION") return await actOnTab(message.tabId, message.action);
  if (message.type === "TAB_STATUS") {
    try { return await chrome.tabs.sendMessage(message.tabId, { type: "LINGO_STATUS" }, { frameId: 0 }); }
    catch { return { enabled: false, translated: 0, failed: 0, pending: 0, total: 0 }; }
  }
  throw new Error("未知操作。");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handle(message, sender).then(data => sendResponse({ ok: true, data }), error => sendResponse({ ok: false, error: error.message || "操作失败，请重试。" }));
  return true;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: "lingo-toggle", title: "Lingo · 翻译此页 / 恢复原文", contexts: ["page"], documentUrlPatterns: ["http://*/*", "https://*/*"] }));
});

async function toggleActiveTab(tab) {
  try { await actOnTab(tab.id, "toggle"); }
  catch (error) {
    await chrome.action.setBadgeText({ tabId: tab.id, text: "!" });
    await chrome.action.setTitle({ tabId: tab.id, title: `Lingo · ${error.message}` });
  }
}
chrome.contextMenus.onClicked.addListener((info, tab) => { if (info.menuItemId === "lingo-toggle" && tab?.id) void toggleActiveTab(tab); });
chrome.commands.onCommand.addListener(async command => {
  if (command !== "toggle-translation") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) await toggleActiveTab(tab);
});
chrome.tabs.onRemoved.addListener(tabId => { void cancelTab(tabId); });
chrome.tabs.onUpdated.addListener((tabId, change) => { if (change.status === "loading") void cancelTab(tabId); });
