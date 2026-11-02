// Run the REAL production content script against fixture translations in preview.
import "/scripts/demo-bridge.js";
const script = document.createElement("script");
script.src = "/extension/content.js";
await new Promise((resolve, reject) => { script.onload = resolve; script.onerror = reject; document.head.append(script); });
const button = document.getElementById("demo-translate");
const dynamic = document.getElementById("demo-dynamic");
document.getElementById("demo-note").textContent = "开发预览 · 使用示例译文，运行真实网页插入逻辑；不调用 API。";
button.disabled = false; dynamic.disabled = false;
button.textContent = "开启双语阅读";
let active = false;
button.addEventListener("click", async () => {
  const result = await chrome.lingoPreviewDispatch({ type: "LINGO_ACTION", action: active ? "stop" : "start" });
  active = result.enabled; button.textContent = active ? "恢复原文" : "开启双语阅读";
});
dynamic.addEventListener("click", () => {
  const paragraph = document.createElement("p");
  paragraph.textContent = "This paragraph was added after translation started. Dynamic pages deserve a seamless reading experience too.";
  document.getElementById("dynamic-content").append(paragraph);
  paragraph.scrollIntoView({ behavior: "smooth", block: "center" });
});
