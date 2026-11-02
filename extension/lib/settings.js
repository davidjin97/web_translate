export const LANGUAGES = [
  ["zh-CN", "简体中文"], ["zh-TW", "繁體中文"], ["en", "English"],
  ["ja", "日本語"], ["ko", "한국어"], ["fr", "Français"],
  ["de", "Deutsch"], ["es", "Español"], ["pt", "Português"],
  ["it", "Italiano"], ["ru", "Русский"], ["ar", "العربية"],
  ["hi", "हिन्दी"], ["vi", "Tiếng Việt"], ["th", "ไทย"]
];

export const DEFAULT_SETTINGS = Object.freeze({
  provider: "google", sourceLanguage: "auto", targetLanguage: "zh-CN",
  scope: "main", style: "line", fontSize: 100, lazyLoad: true,
  showFloatingButton: true, concurrency: 2,
  openaiEndpoint: "https://api.openai.com/v1", openaiKey: "",
  openaiModel: "gpt-4.1-mini", googleCloudKey: "",
  apiProfiles: null, defaultApiId: "default-api",
  prompt: "忠实、自然地翻译，保留专业术语、数字、链接文字和原文语气。不要添加解释。"
});

export function chatEndpoint(value) {
  let url;
  try { url = new URL(String(value).trim()); }
  catch { throw new Error("请输入有效的 API 地址。"); }
  if (!["https:", "http:"].includes(url.protocol)) {
    throw new Error("API 地址仅支持 HTTP 或 HTTPS。");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("API 地址不能含用户名、密码、查询参数或片段。");
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  if (!url.pathname.endsWith("/chat/completions")) {
    url.pathname += "/chat/completions";
  }
  return url.href;
}

export function normalizeSettings(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("配置字段格式不正确。");
  const settings = { ...DEFAULT_SETTINGS };
  // Only accept known fields; never let a webpage introduce extra configuration.
  for (const key of Object.keys(settings)) {
    if (Object.hasOwn(input, key)) settings[key] = input[key];
  }
  if (!["google", "google-cloud", "openai"].includes(settings.provider)) throw new Error("未知的翻译服务。");
  const codes = LANGUAGES.map(([code]) => code);
  if (!["auto", ...codes].includes(settings.sourceLanguage) || !codes.includes(settings.targetLanguage)) {
    throw new Error("请选择有效的源语言和目标语言。");
  }
  if (settings.sourceLanguage === settings.targetLanguage) throw new Error("源语言和目标语言不能相同。");
  if (!["main", "all"].includes(settings.scope)) throw new Error("无效的翻译范围。");
  if (!["line", "soft", "plain"].includes(settings.style)) throw new Error("无效的译文样式。");
  settings.fontSize = Number(settings.fontSize);
  if (!Number.isFinite(settings.fontSize) || settings.fontSize < 80 || settings.fontSize > 130) throw new Error("字号应在 80–130% 之间。");
  settings.concurrency = 2;
  settings.lazyLoad = Boolean(settings.lazyLoad);
  settings.showFloatingButton = Boolean(settings.showFloatingButton);
  for (const key of ["googleCloudKey", "prompt"]) {
    if (typeof settings[key] !== "string") throw new Error("配置字段格式不正确。");
    settings[key] = settings[key].trim();
  }
  if (settings.googleCloudKey.length > 512) throw new Error("API 配置过长。");
  if (settings.prompt.length > 2000) throw new Error("翻译要求不能超过 2000 字符。");
  // Migrate the original single-API configuration without losing its key.
  const legacyModel = typeof settings.openaiModel === "string" && !settings.openaiModel.trim() ? DEFAULT_SETTINGS.openaiModel : settings.openaiModel;
  const profiles = settings.apiProfiles ?? [{
    id: "default-api", name: "我的 API", endpoint: settings.openaiEndpoint,
    key: settings.openaiKey, models: [legacyModel], defaultModel: legacyModel
  }];
  if (!Array.isArray(profiles) || !profiles.length || profiles.length > 20) throw new Error("请配置 1–20 个 API。");
  const ids = new Set();
  settings.apiProfiles = profiles.map(profile => {
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("API 配置格式不正确。");
    const clean = {};
    for (const key of ["id", "name", "endpoint", "key"]) {
      if (typeof profile[key] !== "string") throw new Error("API 配置字段格式不正确。");
      clean[key] = profile[key].trim();
    }
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(clean.id) || ids.has(clean.id)) throw new Error("API 标识无效或重复。");
    ids.add(clean.id);
    if (!clean.name || clean.name.length > 80) throw new Error("API 名称应为 1–80 个字符。");
    if (clean.key.length > 512 || clean.endpoint.length > 2048) throw new Error("API 配置过长。");
    chatEndpoint(clean.endpoint);
    if (!Array.isArray(profile.models) || !profile.models.length || profile.models.length > 50) throw new Error(`「${clean.name}」需要配置 1–50 个模型。`);
    clean.models = profile.models.map(model => {
      if (typeof model !== "string" || !model.trim() || model.trim().length > 200) throw new Error("模型名称应为 1–200 个字符。");
      return model.trim();
    });
    if (new Set(clean.models).size !== clean.models.length) throw new Error(`「${clean.name}」的模型名称不能重复。`);
    clean.defaultModel = profile.defaultModel ?? clean.models[0];
    if (typeof clean.defaultModel !== "string" || !clean.models.includes(clean.defaultModel.trim())) throw new Error(`「${clean.name}」的默认模型必须在模型列表中。`);
    clean.defaultModel = clean.defaultModel.trim();
    return clean;
  });
  if (!Object.hasOwn(input, "defaultApiId")) settings.defaultApiId = settings.apiProfiles[0].id;
  const api = settings.apiProfiles.find(profile => profile.id === settings.defaultApiId);
  if (!api) throw new Error("默认 API 必须在 API 配置列表中。");
  // Flat fields remain derived aliases for legacy request/session compatibility.
  settings.openaiEndpoint = api.endpoint;
  settings.openaiKey = api.key;
  settings.openaiModel = api.defaultModel;
  return settings;
}

export function resolveTranslationSettings(input, selection = {}) {
  const settings = normalizeSettings(input);
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) throw new Error("无效的翻译选择。");
  const allowed = ["provider", "apiId", "model", "sourceLanguage", "targetLanguage"];
  if (Object.keys(selection).some(key => !allowed.includes(key))) throw new Error("翻译选择只能引用已保存的 API 和模型。");
  for (const key of ["provider", "sourceLanguage", "targetLanguage"]) {
    if (Object.hasOwn(selection, key)) settings[key] = selection[key];
  }
  const validated = normalizeSettings(settings);
  if (validated.provider !== "openai") return validated;
  const api = validated.apiProfiles.find(profile => profile.id === (selection.apiId ?? validated.defaultApiId));
  if (!api) throw new Error("所选 API 不存在，请重新打开弹窗或检查设置。");
  const model = selection.model ?? api.defaultModel;
  if (!api.models.includes(model)) throw new Error("所选模型不属于此 API，请检查设置。");
  return { ...validated, openaiEndpoint: api.endpoint, openaiKey: api.key, openaiModel: model, activeApiId: api.id };
}

export function publicSettings(settings) {
  // Explicit allowlist: no profile names, endpoint lists or nested credentials
  // are sent to webpage content scripts, including inactive API profiles.
  const safe = {};
  for (const key of ["provider", "sourceLanguage", "targetLanguage", "scope", "style", "fontSize", "lazyLoad", "showFloatingButton", "concurrency", "openaiModel"]) safe[key] = settings[key];
  if (settings.provider === "openai") safe.apiId = settings.activeApiId ?? settings.defaultApiId;
  return { ...safe, configured: settings.provider === "google" || Boolean(settings.provider === "openai" ? settings.openaiKey || isLocalEndpoint(settings.openaiEndpoint) : settings.googleCloudKey) };
}

export function isLocalEndpoint(endpoint) {
  return ["localhost", "127.0.0.1"].includes(new URL(chatEndpoint(endpoint)).hostname);
}

export function endpointPermissionPattern(endpoint) {
  const url = new URL(chatEndpoint(endpoint));
  // Domain-level match patterns work on older supported Chrome versions too;
  // keep the actual port only in the request URL, not in host permissions.
  return `${url.protocol}//${url.hostname}/*`;
}

export function assertConfigured(settings) {
  if (settings.provider === "openai" && !settings.openaiKey && !isLocalEndpoint(settings.openaiEndpoint)) {
    throw new Error("请先在设置中填写所选 API 的 API Key。");
  }
  if (settings.provider === "openai" && !settings.openaiModel) throw new Error("请先填写模型名称。");
  if (settings.provider === "google-cloud" && !settings.googleCloudKey) throw new Error("请先填写 Google Cloud API Key 并启用 Translation API。");
}
