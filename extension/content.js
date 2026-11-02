(() => {
  "use strict";
  if (globalThis.__lingoTranslator) return;

  const SKIP = 'script,style,noscript,textarea,input,select,option,button,pre,code,kbd,samp,svg,canvas,math,iframe,video,audio,lingo-translation,lingo-toolbar,[hidden],[aria-hidden="true"],[translate="no"],.notranslate,[contenteditable]:not([contenteditable="false"]),[role="textbox"],[role="button"],[role="menu"],[role="navigation"],nav';
  const BLOCK = "p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,dd,dt,figcaption,div,section,article,main,summary";
  const STRONG_BLOCK = "p,h1,h2,h3,h4,h5,h6,li,blockquote,td,th,dd,dt,figcaption";
  const entries = new Map();
  let settings, sessionId, enabled = false, epoch = 0, working = 0;
  let mutationObserver, intersectionObserver, mutationTimer, scanTimer, pumpTimer, toolbar;
  let lastURL = location.href;
  let failureStreak = 0, paused = false, notice = "";
  const queued = [];

  const send = async message => {
    const response = await chrome.runtime.sendMessage(message);
    if (!response?.ok) throw new Error(response?.error || "插件连接中断，请刷新页面。");
    return response.data;
  };
  const sourceText = element => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        return node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT;
      }
    });
    let text = "", node;
    while ((node = walker.nextNode())) text += node.textContent;
    return text.replace(/\s+/g, " ").trim();
  };

  function shouldTranslate(text) {
    if (text.length < 3 || !/\p{L}/u.test(text) || text.length > 32000) return false;
    if (/^(https?:\/\/|www\.)\S+$/.test(text) || /^[\w.+-]+@[\w.-]+\.[a-z]+$/i.test(text)) return false;
    // Conservative script heuristic: never skip mixed CJK/Latin technical paragraphs.
    const letters = text.match(/\p{L}/gu) ?? [];
    const cjk = text.match(/[\p{Script=Han}]/gu) ?? [];
    if (settings.targetLanguage.startsWith("zh") && settings.sourceLanguage === "auto" && cjk.length / letters.length > 0.8 && !/[\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text)) return false;
    return true;
  }

  function visible(element) {
    if (!element.isConnected || element.closest(SKIP)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
  }

  function roots() {
    if (settings.scope === "all") return [document.body];
    const candidates = [...document.querySelectorAll("article,main,[role='main']")].filter(el => !el.closest(SKIP) && sourceText(el).length > 80);
    const outermost = candidates.filter(el => !candidates.some(other => other !== el && other.contains(el)));
    return outermost.length ? outermost : [document.body];
  }

  function candidateFor(node, root) {
    const element = node.parentElement;
    if (!element || element.closest(SKIP)) return null;
    let candidate = element.closest(BLOCK);
    if (!candidate || !root.contains(candidate)) candidate = element;
    if (candidate === document.body || candidate === root && !candidate.matches(STRONG_BLOCK)) return null;
    // Avoid grouping an entire card, list, or article with its nested paragraphs.
    if (candidate.querySelector(STRONG_BLOCK) || (candidate.querySelector(BLOCK) && !candidate.matches(STRONG_BLOCK))) {
      candidate = element;
      if (candidate.matches("a,span,strong,em,b,i") && candidate.parentElement && !candidate.parentElement.querySelector(STRONG_BLOCK)) candidate = candidate.parentElement;
      if (candidate.querySelector(STRONG_BLOCK) || candidate === root) return null;
    }
    if (settings.scope === "main" && candidate.closest("header,footer,aside")) return null;
    return candidate;
  }

  function createEntry(element, text) {
    const host = document.createElement("lingo-translation");
    host.setAttribute("translate", "no");
    host.setAttribute("lang", settings.targetLanguage);
    const shadow = host.attachShadow({ mode: "open" });
    const isHeading = /^H[1-6]$/.test(element.tagName);
    // Shadow DOM prevents webpage CSS from affecting our text; textContent prevents XSS.
    const style = document.createElement("style");
    style.textContent = `:host{all:initial!important;display:block!important;box-sizing:border-box!important;margin:8px 0 3px!important;font-family:inherit!important;font-size:${isHeading ? "max(14px, 0.65em)" : `${settings.fontSize}%`}!important;line-height:1.75!important;font-weight:400!important;text-align:start!important;letter-spacing:normal!important;color:inherit!important;white-space:normal!important;overflow-wrap:anywhere!important;direction:${settings.targetLanguage === "ar" ? "rtl" : "ltr"}!important} .text{display:block;white-space:pre-wrap;${settings.style === "line" ? "border-left:2px solid #5ba99b;padding-left:12px;" : settings.style === "soft" ? "background:rgba(79,156,141,.09);border-radius:6px;padding:10px 14px;" : ""}} .pending{opacity:.5;font-size:13px}.error{color:#c25a49;font-size:13px}button{font:inherit;border:0;border-bottom:1px solid currentColor;background:none;color:inherit;padding:0;cursor:pointer;margin-left:8px}:host([data-hidden]){display:none!important}`;
    const output = document.createElement("span");
    output.className = "text pending";
    output.textContent = "正在翻译…";
    shadow.append(style, output);
    host.setAttribute("data-hidden", "");
    const entry = { element, text, host, output, state: "waiting", chunks: splitText(text), results: [], version: 0 };
    entries.set(element, entry);
    // Appending within the block keeps tables, lists, links, flex and grid structurally valid.
    element.append(host);
    if (settings.lazyLoad && intersectionObserver) intersectionObserver.observe(element);
    else enqueue(entry);
  }

  function splitText(text, limit = 2400) {
    const result = [];
    while (text.length > limit) {
      const prefix = text.slice(0, limit);
      let end = Math.max(prefix.lastIndexOf(". "), prefix.lastIndexOf("。"), prefix.lastIndexOf(" "));
      end = end > limit / 2 ? end + 1 : limit;
      if (/[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      result.push(text.slice(0, end)); text = text.slice(end);
    }
    if (text) result.push(text);
    return result;
  }

  function enqueue(entry) {
    if (!enabled || entry.state !== "waiting" || !entry.element.isConnected) return;
    entry.state = "queued";
    entry.host.removeAttribute("data-hidden");
    entry.chunks.forEach((text, index) => queued.push({ entry, text, index, version: entry.version }));
    schedulePump();
  }

  function scan() {
    if (!enabled || !document.body) return;
    const candidates = new Set();
    for (const root of roots()) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) { return node.textContent.trim() && !node.parentElement?.closest(SKIP) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT; }
      });
      let node;
      while ((node = walker.nextNode())) {
        const candidate = candidateFor(node, root);
        if (candidate) candidates.add(candidate);
      }
    }
    for (const [element, entry] of entries) {
      if (!element.isConnected || !candidates.has(element) || !visible(element)) {
        entry.version++; intersectionObserver?.unobserve(element); entry.host.remove(); entries.delete(element);
      }
    }
    for (const element of candidates) {
      if (!visible(element)) continue;
      const text = sourceText(element);
      const current = entries.get(element);
      if (current?.text === text && current.host.isConnected) continue;
      if (current) { current.version++; intersectionObserver?.unobserve(element); current.host.remove(); entries.delete(element); }
      if (!shouldTranslate(text)) continue;
      // Do not translate overlapping ancestors/descendants twice.
      if ([...entries.keys()].some(other => other !== element && (other.contains(element) || element.contains(other)))) continue;
      createEntry(element, text);
    }
    for (const [element, entry] of entries) {
      if (!element.isConnected) { entry.version++; intersectionObserver?.unobserve(element); entry.host.remove(); entries.delete(element); }
    }
    updateStatus();
  }

  function scheduleScan() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(scan, 200);
  }
  function schedulePump() {
    if (pumpTimer || !enabled || paused) return;
    pumpTimer = setTimeout(() => { pumpTimer = null; pump(); }, 45);
  }

  function failEntry(entry, message) {
    entry.state = "failed";
    entry.output.className = "text error";
    entry.output.textContent = message;
    const retry = document.createElement("button");
    retry.type = "button"; retry.textContent = "重试";
    retry.addEventListener("click", event => { event.preventDefault(); event.stopPropagation(); retryFailed(); });
    entry.output.append(retry);
  }

  async function pump() {
    if (!enabled || paused) return;
    while (working < 2 && queued.length) {
      const batch = [];
      let size = 0;
      while (queued.length && batch.length < 6) {
        const item = queued[0];
        if (!item.entry.element.isConnected || item.version !== item.entry.version || item.entry.state === "failed") { queued.shift(); continue; }
        if (batch.length && size + item.text.length > 6500) break;
        queued.shift(); batch.push(item); size += item.text.length;
        item.entry.state = "translating";
      }
      if (!batch.length) break;
      working++;
      const run = epoch;
      const runSession = sessionId;
      (async () => {
        try {
          const data = await send({ type: "TRANSLATE", sessionId: runSession, texts: batch.map(item => item.text) });
          if (run !== epoch || !enabled) return;
          if (!Array.isArray(data?.translations) || data.translations.length !== batch.length || data.translations.some(t => typeof t !== "string")) throw new Error("服务返回的译文格式不正确。");
          failureStreak = 0;
          batch.forEach((item, index) => {
            const entry = item.entry;
            if (item.version !== entry.version || !entry.element.isConnected || entry.state === "failed") return;
            entry.results[item.index] = data.translations[index];
            if (entry.chunks.every((_, i) => typeof entry.results[i] === "string")) {
              entry.output.className = "text";
              entry.output.textContent = entry.results.join(" ");
              entry.state = "translated";
            }
          });
        } catch (error) {
          if (run !== epoch || !enabled) return;
          for (const item of batch) if (item.version === item.entry.version && item.entry.element.isConnected) failEntry(item.entry, error.message);
          failureStreak++;
          if (failureStreak >= 2) { paused = true; notice = "服务连续失败，已暂停请求。请检查网络或设置后重试。"; }
        } finally {
          if (run === epoch) { working--; updateStatus(); schedulePump(); }
        }
      })();
    }
    updateStatus();
  }

  function state() {
    const all = [...entries.values()];
    return {
      enabled, paused, notice,
      translated: all.filter(entry => entry.state === "translated").length,
      failed: all.filter(entry => entry.state === "failed").length,
      pending: all.filter(entry => ["queued", "translating"].includes(entry.state)).length,
      total: all.length
    };
  }

  function updateStatus() {
    const current = state();
    if (toolbar) {
      toolbar.label.textContent = paused ? "请求已暂停" : current.pending ? `正在翻译 · ${current.translated}` : `已译 ${current.translated} 段`;
      toolbar.retry.hidden = !current.failed && !paused;
      toolbar.host.title = notice || "Lingo · 双语阅读";
    }
    void send({ type: "STATUS_UPDATE", ...current }).catch(() => {});
  }

  function createToolbar() {
    if (!settings.showFloatingButton) return;
    const host = document.createElement("lingo-toolbar");
    const shadow = host.attachShadow({ mode: "open" });
    const css = document.createElement("style");
    css.textContent = ':host{all:initial!important;position:fixed!important;right:22px!important;bottom:22px!important;z-index:2147483647!important;display:block!important} .bar{display:flex;gap:9px;align-items:center;padding:9px 10px 9px 14px;background:#fff;color:#204940;border:1px solid #d4e6df;border-radius:14px;box-shadow:0 5px 24px #183e4020;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif} .logo{font-weight:800;font-size:17px;color:#0f766e} button{border:0;background:#edf5f1;border-radius:7px;color:#245b4f;padding:6px 9px;font:inherit;cursor:pointer}button:hover{background:#dfede5}button[hidden]{display:none}.close{background:transparent;font-size:17px;padding:0 4px}';
    const bar = document.createElement("div"); bar.className = "bar";
    const logo = document.createElement("span"); logo.className = "logo"; logo.textContent = "L";
    const label = document.createElement("span"); label.textContent = "准备翻译";
    const retry = document.createElement("button"); retry.textContent = "重试"; retry.hidden = true; retry.addEventListener("click", retryFailed);
    const restore = document.createElement("button"); restore.textContent = "恢复原文"; restore.addEventListener("click", stop);
    const close = document.createElement("button"); close.className = "close"; close.textContent = "×"; close.setAttribute("aria-label", "隐藏悬浮工具栏"); close.addEventListener("click", () => { host.remove(); toolbar = null; });
    bar.append(logo, label, retry, restore, close); shadow.append(css, bar); document.documentElement.append(host);
    toolbar = { host, label, retry };
  }

  function retryFailed() {
    if (!enabled) return;
    paused = false; failureStreak = 0; notice = "";
    // Discard remaining pieces for failed entries before enqueuing their fresh versions.
    for (const entry of entries.values()) if (entry.state === "failed") {
      entry.version++; entry.results = []; entry.state = "waiting";
      entry.output.className = "text pending"; entry.output.textContent = "正在翻译…";
      enqueue(entry);
    }
    schedulePump(); updateStatus();
  }

  function stop() {
    enabled = false; epoch++; working = 0; paused = false; notice = "";
    clearTimeout(mutationTimer); clearTimeout(scanTimer); clearTimeout(pumpTimer); pumpTimer = null;
    mutationObserver?.disconnect(); intersectionObserver?.disconnect();
    window.removeEventListener("scroll", onScroll); window.removeEventListener("resize", scheduleScan);
    for (const entry of entries.values()) entry.host.remove();
    entries.clear(); queued.length = 0;
    toolbar?.host.remove(); toolbar = null;
    if (sessionId) void send({ type: "CANCEL_SESSION", sessionId }).catch(() => {});
    sessionId = null; updateStatus();
    return state();
  }

  function onScroll() { if (!mutationTimer) mutationTimer = setTimeout(() => { mutationTimer = null; scheduleScan(); }, 400); }

  async function start() {
    stop();
    const run = epoch;
    const result = await send({ type: "BEGIN_SESSION" });
    if (run !== epoch) { void send({ type: "CANCEL_SESSION", sessionId: result.sessionId }).catch(() => {}); return state(); }
    settings = result.settings; sessionId = result.sessionId; enabled = true; lastURL = location.href;
    if (settings.lazyLoad && typeof IntersectionObserver !== "undefined") {
      intersectionObserver = new IntersectionObserver(items => {
        for (const item of items) if (item.isIntersecting) { const entry = entries.get(item.target); if (entry) enqueue(entry); }
      }, { rootMargin: "500px 0px" });
    }
    mutationObserver = new MutationObserver(records => {
      if (!enabled) return;
      if (location.href !== lastURL) {
        // SPA navigation requires a new explicit translation action: do not silently
        // transmit the next page's content under an old user gesture.
        stop(); return;
      }
      const relevant = records.some(record => {
        const element = record.target.nodeType === Node.ELEMENT_NODE ? record.target : record.target.parentElement;
        if (element?.closest("lingo-translation,lingo-toolbar")) return false;
        if (record.type === "childList") return [...record.addedNodes, ...record.removedNodes].some(node => !(node.nodeType === Node.ELEMENT_NODE && node.matches("lingo-translation,lingo-toolbar")));
        return true;
      });
      if (relevant) scheduleScan();
    });
    mutationObserver.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "hidden", "aria-hidden", "translate"] });
    window.addEventListener("scroll", onScroll, { passive: true }); window.addEventListener("resize", scheduleScan);
    createToolbar(); scan();
    if (!entries.size) notice = "未找到需要翻译的正文，可尝试在设置中选择“整个页面”。";
    updateStatus(); return state();
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "LINGO_STATUS") { sendResponse(state()); return false; }
    if (message?.type !== "LINGO_ACTION") return false;
    const action = message.action;
    Promise.resolve().then(() => {
      if (action === "stop" || action === "toggle" && enabled) return stop();
      if (action === "retry") { retryFailed(); return state(); }
      if (["start", "toggle"].includes(action)) return start();
      throw new Error("未知的页面操作。");
    }).then(data => sendResponse(data), error => sendResponse({ ...state(), error: error.message }));
    return true;
  });
  window.addEventListener("pagehide", stop);
  globalThis.__lingoTranslator = { version: "0.1.0" };
})();
