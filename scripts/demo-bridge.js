// Development-only Chrome API shim. This file is NEVER included in the extension.
// Preview translations are deterministic fixtures, not live API calls.
import { DEFAULT_SETTINGS, publicSettings } from "/extension/lib/settings.js";

let settings = { ...DEFAULT_SETTINGS };
const listeners = [];
const fixtures = new Map([
  ["The quiet power of reading", "阅读，安静而有力量"],
  ["A few pages a day can change the way we see the world.", "每天读上几页，就能改变我们看世界的方式。"],
  ["Reading is more than a way to gather information. It is an invitation to slow down, pay attention, and discover a perspective different from our own.", "阅读不只是获取信息的方式。它邀请我们放慢脚步，专注当下，发现与自己不同的视角。"],
  ["When we read in another language, the world becomes a little larger. Ideas that once felt distant become familiar, and unfamiliar voices begin to feel like friends.", "当我们用另一种语言阅读，世界便又辽阔了一些。曾经遥远的想法渐渐熟悉，陌生的声音也开始像朋友一样亲切。"],
  ["A conversation across borders", "一场跨越边界的对话"],
  ["The best tools do not interrupt this conversation. They bring understanding closer while leaving the original words intact, so we can move naturally between languages.", "好的工具不会打断这场对话。它们在保留原文的同时，让理解触手可及，让我们在不同语言之间自然切换。"],
  ["A good translation is a bridge, not a replacement.", "好的翻译是一座桥，而不是对原文的替代。"],
  ["Start with something that makes you curious: a thoughtful essay, a piece of research, or a story from a place you have never visited. Let your questions guide the journey.", "从让你好奇的内容开始：一篇引人深思的文章、一项研究，或一个来自未曾到访之地的故事。让你的问题引领这段旅程。"],
  ["Small habits, lasting changes", "小习惯，长久的改变"],
  ["Make room for ten minutes of focused reading each day.", "每天留出十分钟，专心阅读。"],
  ["Keep the original text nearby and notice how different languages express the same idea.", "保留原文，留意不同语言如何表达同一个想法。"],
  ["Share one thing you learned with someone you care about.", "与在乎的人分享一件你学到的事。"],
  ["Technology should make knowledge more accessible, not make our attention more fragmented. Sometimes the most meaningful innovation is simply helping us understand one another.", "技术应该让知识更容易获得，而不是让我们的注意力更加碎片化。有时，最有意义的创新，不过是帮助我们彼此理解。"],
  ["A note for developers", "给开发者的一点提示"],
  ["Technical terms like API, JavaScript, and Shadow DOM should stay readable. This paragraph also includes an inline link to Chrome documentation that must remain clickable.", "API、JavaScript 和 Shadow DOM 等技术术语应保持清晰可读。这一段还包含指向 Chrome 文档的行内链接，翻译后仍应能够点击。"],
  ["Reading habit", "阅读习惯"], ["Why it matters", "为什么重要"],
  ["Read with curiosity", "带着好奇心阅读"], ["New questions lead to new understanding.", "新的问题带来新的理解。"],
  ["Keep both languages", "保留两种语言"], ["Context makes learning more natural.", "上下文让学习更自然。"],
  ["Reading opens a window to the world.", "阅读为我们打开一扇通往世界的窗。"],
  ["This paragraph was added after translation started. Dynamic pages deserve a seamless reading experience too.", "这一段是在开启翻译后动态添加的。动态网页同样值得拥有流畅的阅读体验。"]
]);
const dispatch = message => new Promise(resolve => {
  for (const listener of listeners) listener(message, {}, resolve);
});
window.chrome = {
  runtime: {
    id: "lingo-preview", getURL: path => `/extension/${path}`,
    onMessage: { addListener: listener => listeners.push(listener) },
    openOptionsPage: () => { location.href = "/extension/options.html"; },
    async sendMessage(message) {
      if (message.type === "GET_SETTINGS") return { ok: true, data: { ...settings } };
      if (message.type === "GET_PUBLIC_SETTINGS") return { ok: true, data: publicSettings(settings) };
      if (message.type === "SAVE_SETTINGS") { settings = { ...message.settings }; return { ok: true, data: publicSettings(settings) }; }
      if (message.type === "BEGIN_SESSION") return { ok: true, data: { settings: publicSettings(settings), sessionId: "preview" } };
      if (message.type === "TRANSLATE") {
        await new Promise(resolve => setTimeout(resolve, 220));
        return { ok: true, data: { translations: message.texts.map(text => fixtures.get(text) ?? `【开发示例】${text}`) } };
      }
      if (message.type === "TEST_CONNECTION") return { ok: true, data: { translation: "开发预览仅使用示例译文；安装后可测试真实接口。" } };
      if (message.type === "TAB_STATUS") return { ok: true, data: { enabled: false, translated: 0, pending: 0 } };
      if (message.type === "TAB_ACTION") return { ok: false, error: "弹窗开发预览不会操作真实标签页。请安装插件后测试。" };
      return { ok: true, data: {} };
    }
  },
  permissions: { request: async () => true },
  tabs: { query: async () => [{ id: 1, title: "The quiet power of reading", url: "http://localhost:4173/extension/demo.html" }] },
  lingoPreviewDispatch: dispatch
};
if (!location.pathname.endsWith("demo.html")) {
  const banner = document.createElement("div");
  banner.textContent = "开发预览 · 不调用真实 API，不保存 API Key";
  banner.style.cssText = "position:fixed;bottom:8px;left:50%;transform:translateX(-50%);z-index:99;font:10px sans-serif;background:#315d45;color:#fff;padding:7px 13px;border-radius:6px;pointer-events:none;white-space:nowrap";
  document.body.append(banner);
}
