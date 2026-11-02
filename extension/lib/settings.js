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
  for (const key of ["openaiEndpoint", "openaiKey", "openaiModel", "googleCloudKey", "prompt"]) {
    if (typeof settings[key] !== "string") throw new Error("配置字段格式不正确。");
    settings[key] = settings[key].trim();
  }
  if (settings.openaiKey.length > 512 || settings.googleCloudKey.length > 512 || settings.openaiModel.length > 200) throw new Error("API 配置过长。");
  if (settings.prompt.length > 2000) throw new Error("翻译要求不能超过 2000 字符。");
  // Allow user-configured HTTP services, but still reject non-web schemes,
  // embedded credentials and query parameters even for inactive endpoints.
  chatEndpoint(settings.openaiEndpoint);
  return settings;
}

export function publicSettings(settings) {
  const { openaiKey, googleCloudKey, ...safe } = settings;
  // Credentials and endpoint are unnecessary in the content-script context.
  delete safe.openaiEndpoint;
  delete safe.prompt;
  return { ...safe, configured: settings.provider === "google" || Boolean(settings.provider === "openai" ? openaiKey || isLocalEndpoint(settings.openaiEndpoint) : googleCloudKey) };
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
    throw new Error("请先在设置中填写 OpenAI API Key。");
  }
  if (settings.provider === "openai" && !settings.openaiModel) throw new Error("请先填写模型名称。");
  if (settings.provider === "google-cloud" && !settings.googleCloudKey) throw new Error("请先填写 Google Cloud API Key 并启用 Translation API。");
}
