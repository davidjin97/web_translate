# Lingo · 双语网页翻译

可直接加载的 Chrome Manifest V3 插件。参考沉浸式翻译的双语阅读方式：**保留原文，在段落下方插入译文**。不依赖后端，不需要编译，全部运行时代码均在本地。

## 直接安装（不需要 npm）

1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 开启右上角的「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择本仓库中的 **extension** 文件夹（不是仓库根目录）。
4. 在工具栏的拼图图标中固定 **Lingo · 双语网页翻译**。
5. 打开一个普通英文网页，点击 Lingo →「翻译此页」。默认翻译为简体中文。

插件目录：本仓库中的 `extension/` 文件夹。克隆或下载仓库后，选择该文件夹即可加载插件。

更新代码后，在扩展管理页点击 Lingo 的刷新按钮，并刷新已打开的网页。Chrome 商店安装版需要打包、发布和审核；本项目当前提供开发者模式本地安装，不提供签名 CRX。

HTTP 支持更新后，请在 `chrome://extensions` 重新加载插件，并刷新或重新打开插件设置页。首次保存或测试 HTTP API 地址时，批准该域名的访问权限。

## 翻译服务

| 服务 | 配置 | 说明 |
| --- | --- | --- |
| Google 翻译 · 免 Key | 无需 Key | 默认试用方式，使用 `translate.googleapis.com/translate_a/single` 非官方接口；无稳定性、配额或长期可用承诺，需可访问 Google 的网络。 |
| Google Cloud · 官方 API | Google Cloud API Key | 启用 **Cloud Translation API v2 / Basic** 与计费，按服务商规则收费。Key 通过 `X-Goog-Api-Key` 请求头传递，不放在 URL 中。 |
| OpenAI / LLM | API 地址、Key、模型名称 | 使用标准 **Chat Completions** 接口，支持 OpenAI 及兼容服务；调用消耗你的 API 账户额度。ChatGPT 订阅不等于 API 额度。 |

### 配置 OpenAI / 兼容模型

点击弹窗右上角齿轮 →「翻译服务」→「OpenAI / LLM」。

- API 地址：默认 `https://api.openai.com/v1`；支持自定义 HTTP / HTTPS 地址，也接受完整的 `/chat/completions` 地址。若服务商 Base URL 不含 `/v1`，请按其文档填写，插件不会擅自添加 `/v1`。
- API Key：填写你自己的 Key。禁止将真实 Key 写入源码或提交到 Git。
- 模型名称：默认示例 `gpt-4.1-mini`，可以填写账号实际可用的模型 ID。
- 额外翻译要求：例如「保留英文专业术语，采用技术文档风格」。
- 先点「测试连接」，再保存。自定义 API 域名第一次使用需要批准 Chrome 的域名访问权限。
- 保存后，恢复原文并重新开启翻译，新的配置才会用于当前页面。

本地兼容模型示例：Base URL `http://localhost:11434/v1`，模型填写本地实际已安装的模型名；localhost / 127.0.0.1 可以不填 Key。局域网服务也可填写 `http://192.168.1.10:8000/v1` 等地址；非 localhost / 127.0.0.1 的服务仍需填写 Key。当前不支持仅提供 Responses API 的服务，模型必须能按提示返回按段落排序的 JSON 译文；格式错误会显式提示，不会错位插入。

**HTTP 风险**：HTTP 不加密传输，API Key 和待翻译文字可能被网络中的其他人读取或篡改。插件允许使用 HTTP，同时会在设置中显示风险提示，不会自动升级或改写为 HTTPS。只在可信内网或自建服务中使用，公网服务建议采用 HTTPS。API 地址仍禁止嵌入用户名、密码、查询参数或片段。

OpenAI 接入依据：[Chat Completions 官方文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)、[认证与 API Key 安全](https://developers.openai.com/api/reference/overview)。官方建议公开生产应用使用服务端保护凭证；本项目是用户自带 Key 的本地插件，不应在公开分发版本中内置共享 Key。

## 网页阅读功能

- 保留原文、链接及已有 DOM；每个段落内末尾插入独立的块状译文，视觉上显示在原文下方。
- 支持文章、标题、列表、表格单元格及常见直接文本容器。
- 默认智能正文识别；可选择整页模式。
- 默认按可见区域及附近内容翻译，继续滚动时加载；可关闭懒加载。
- 已开启页面的新增或更新段落会自动处理，删除段落会清理状态。
- 批量请求、长段落拆分、全局最多 2 个并行任务、有限重试、15 分钟内存缓存。
- 连续服务失败后暂停队列，可在弹窗、错误段落或悬浮栏重试。
- 一键恢复原文、悬浮进度、页面右键菜单、`Alt+T` / macOS `⌥+T`。
- 3 种译文样式、80–130% 字号、15 种目标语言。
- Chrome 后台 Service Worker 休眠后，通过受保护的 `storage.session` 恢复已开启页面的配置快照，继续滚动不需重开。

## 权限、隐私与限制

- **activeTab / scripting**：只有用户通过插件弹窗、右键菜单或快捷键主动操作后，才向主网页注入翻译逻辑。没有全站常驻 content script，不读取浏览历史。
- **storage**：设置和 Key 保存于 `chrome.storage.local`，不云同步；明确限制为 `TRUSTED_CONTEXTS`。内容脚本不能读取 Key，只能向后台请求译文。当前阅读会话快照放在同样受保护的 `storage.session` 中，停止、导航或关闭标签页时清理；浏览器退出后清空。
- **host permissions**：预授权 3 个默认 HTTPS API 域名；其他 HTTP / HTTPS API 域名通过可选权限按需请求。保存或测试时只请求填写的协议与域名（例如 `http://192.168.1.10/*`），不会自动取得所有网站的访问权限。翻译请求在后台执行，不暴露给网页，但 HTTP 请求在网络传输中并未加密。禁止凭证随重定向转发。
- **外发数据**：主动开启的页面中待翻译的文本会发往所选服务商；滚动和动态内容亦属于该页面的已开启翻译会话。不要在含敏感信息的网页上开启第三方翻译。网页上的 `translate="no"`、`.notranslate` 会被尊重。服务商自身的数据政策以其条款为准。
- 缓存不写入磁盘，最多 500 个条目 / 15 分钟；设置改变会清空缓存。恢复原文会移除全部注入节点并取消未完成请求；已经被服务商接收的请求可能仍计费。
- Key 是本机插件存储中的明文，不是系统钥匙串；本地账号或设备被入侵时仍存在风险。API Key 应限制权限、设置费用上限并定期轮换。
- 不支持 Chrome 内置页、Chrome 商店、PDF、图片 OCR、视频字幕、文件翻译、iframe 或 Shadow DOM。输入框、代码、导航、隐藏内容会跳过。不是沉浸式翻译的完整克隆，任意复杂网站仍可能需要站点适配。
- 单段超过 32,000 字符会跳过。整页模式也不会翻译导航和交互控件。中文目标语言下自动检测会保守跳过基本纯中文的段落；简繁转换可明确选择源语言。
- SPA 的路径变化在下一次 DOM 更新时停止翻译，新页面需要主动重新开启；完整导航同样需要重新开启。

## 开发与验证

运行环境：Node.js 20+。安装插件本身不需要 Node。

```sh
npm install
npm test
npm run check
npm run package
npm run demo
```

- `npm test`：覆盖配置验证、三种服务请求格式、超时与重试、缓存、并发、后台权限和休眠恢复，以及 DOM 插入、懒加载、动态更新、恢复原文与 XSS 防护。测试仅使用公开示例文本和模拟接口，不消耗真实 Key 额度。
- `npm run check`：检查 Manifest V3、文件路径、JavaScript 语法和扩展 CSP。
- `npm run package`：生成 `dist/lingo/`（可直接加载）及 `dist/lingo-v0.1.0.zip`（解压后加载）。默认也可以直接加载 `extension/`。
- `npm run demo`：开发预览 `http://localhost:4173`，设置页 `/extension/options.html`，弹窗 `/extension/popup.html`。**预览使用示例译文，不调用真实 API**；运行的是同一份生产 content script，便于检查布局、动态段落和恢复原文。开发桥接代码只存在 `scripts/`，不会被打包进插件。

### 安装后的真实接口验收

1. 打开普通英文文章（不是 Chrome 内置页面），使用 Google 免 Key 服务，确认原文下方出现中文译文。
2. 滚动到页面下方，确认更多段落开始翻译，正文链接仍可点击，代码不被翻译。
3. 点击「恢复原文」，确认译文和悬浮栏移除；尝试快捷键和右键菜单。
4. 配置自己的 OpenAI Key、模型和地址，点「测试连接」确认返回中文示例，再重新翻译该网页。
5. 尝试错误 Key，确认提示 401 而不是无响应；模拟断网，确认有限重试并暂停。
6. 打开真实动态网页并追加内容，确认译文自动出现；静置超过 30 秒后滚动，确认后台休眠恢复。

没有真实 OpenAI / Google Cloud Key 的环境无法验证账户计费、模型权限或地区可用性，这些必须用你的实际账号与浏览器网络完成验收。

## 项目结构

```text
extension/          可直接安装，零运行时依赖
  manifest.json     Manifest V3、按需权限、快捷键
  background.js     可信请求代理、会话、全局并发与缓存
  content.js        段落识别、Shadow DOM 译文、动态内容与恢复
  lib/              配置校验和翻译服务实现
  popup.*           当前网页操作
  options.*         服务配置及阅读偏好
  demo.*            原创测试文章
scripts/            开发预览、检查、图标生成、打包
tests/              Node test + jsdom 自动化测试
```
