# nettools — CLAUDE.md

开发者工具集 Web 应用。将 SSH 终端、PCAP 分析器、HTTP 服务器、API 测试器、文件管理器整合在单一 UI 中提供。

---

## 自维护规则
每当对话即将被compact，或我说"更新记忆"时，请将以下内容更新到本文件：
- 当前项目状态和进度
- 本次会话的关键决策和原因
- 我表达过的偏好和习惯
- 未完成的任务和下一步计划

## 项目结构

```
nettools/
├── backend/          Node.js (CommonJS, Fastify)
│   ├── src/
│   │   ├── index.js            入口点 — 端口 3001，注册路由
│   │   ├── routes/
│   │   │   ├── pcap.js         PCAP 上传/解析/过滤/统计 API
│   │   │   ├── ssh.js          SSH 终端 (ssh2 + WebSocket)
│   │   │   ├── scp.js          SCP 文件传输
│   │   │   ├── httpserver.js   入站 HTTP 接收服务器（动态实例）
│   │   │   ├── request.js      出站 HTTP 请求代理
│   │   │   ├── anpr.js         ANPR HTTP 服务器（动态实例，含图片缓存）
│   │   │   ├── tcpLprClient.js ANPR TCP 客户端（动态连接）
│   │   │   └── cache.js        缓存信息查询与清理 API
│   │   └── services/
│   │       ├── pcapParser.js   核心解析引擎（dissect、重组、异常检测、过滤、统计）
│   │       └── sessions.js     SSH 会话管理
│   ├── uploads/                上传的 .pcap/.pcapng 及 ANPR/LPR 图片临时文件
│   └── package.json
└── frontend/         React 18 + Vite (ESM)
    ├── src/
    │   ├── App.jsx             标签路由、整体布局、主题、beforeunload 自动清理
    │   ├── App.css             单一 CSS 文件 — 所有组件样式
    │   ├── i18n.js             多语言支持（LANGS map + LangContext + useT() hook）
    │   └── components/
    │       ├── PcapAnalyzer.jsx  数据包表格、过滤器、图表、详情弹窗
    │       ├── SSHTerminal.jsx   基于 xterm.js 的终端
    │       ├── SSHWorkspace.jsx  SSH 会话管理 UI
    │       ├── HttpServer.jsx    入站 HTTP 服务器控制 + 请求日志
    │       ├── ApiTester.jsx     出站 HTTP 客户端
    │       ├── FileManager.jsx   SCP 文件管理器
    │       ├── AnprServer.jsx    ANPR HTTP 服务器 + 记录列表（分页）
    │       ├── AnprTcpClient.jsx ANPR TCP 客户端 + 记录列表（分页）
    │       └── Settings.jsx      设置页（颜色模式、缓存管理、退出自动清理）
    └── package.json
```

---

## 启动方式

```bash
# 后端（端口 3001）
cd backend && npm run dev

# 前端（端口 5173，/api/* → 3001 代理）
cd frontend && npm run dev
```

Vite 将 `/api/ssh/terminal`、`/api/httpserver/stream`（WebSocket）以及其余 `/api/*`（HTTP）分别代理到 3001。

---

## 核心设计决策

### PCAP 解析流水线（`pcapParser.js`）

数据包处理顺序固定，不可更改：

```
dissect()               每帧 → 提取以太网/IP/TCP/UDP/HTTP 字段
  ↓
packets.forEach(分配 pktIndex)
  ↓
reassembleHttpStreams()  TCP 分段重组 → HTTP 提升
  ↓
detectTcpAnomalies()    检测重传/乱序/DupACK/Zero Window
  ↓
pairHttpPackets()       HTTP 请求-响应配对（httpPairIndex）
```

### TCP 重组模型（参照 Wireshark 行为）

- **完成分段**（关闭 HTTP 消息的最后一个 TCP 包）→ `protocol: 'HTTP'`
- **前驱分段** → `protocol: 'TCP'`，`tcpContinuation: true`，`reassemblyHead: 完成分段的 pktIndex`
- 完成分段保存 `reassembledSegments: [{pktIndex, len}, ...]`、`reassembledTotalBytes`
- 单包 HTTP（无分片）走同一路径，提升时不带 `reassembledSegments`

**核心函数：**
- `isHttpComplete(http, buf)` — 通过 Content-Length 判断是否完整；无头部则立即视为完成
- `promoteToHttp(p, http, segs, packets)` — 提升完成包 + 反向记录前驱包的 reassemblyHead

### pcapStore（内存存储）

```js
// pcapId → { filePath, packets }
const pcapStore = new Map();
```

服务器重启后清空。上传的文件保留在 `uploads/` 目录中。

`clearStore()` 只清内存 map，不删磁盘文件（磁盘清理由 `clearDir()` 负责）。

### HTTP 过滤

使用 `filter=http` 查询时，仅返回 `protocol === 'HTTP'` 的数据包。  
TCP 重组前驱分段为 `protocol: 'TCP'`，自动排除 → 过滤器只暴露完整 HTTP 消息。

### ANPR / TCP Client 记录列表

- 不再使用滑动窗口（已移除 `MAX_RECORDS = 100`）
- 所有记录累积于 `allRecords[]`，序号由 `seqRef`（`useRef`）单调递增分配，赋值到 `record._seq`
- 客户端分页：`PAGE_SIZE = 50`，`onLivePage` 控制是否自动跟随最新页
- 浮动翻页条（底部 pill）：Prev / N/N / Next / Latest 按钮，仅在 `totalPages > 1` 时显示

### Settings 页（`Settings.jsx`）

- **颜色模式**：dark / light / auto 三张卡片，含硬编码颜色缩略 UI 预览，点选后持久化到 `localStorage('nt-theme')`，通过 `setTheme` prop 实时切换
- **缓存管理**：`GET /api/cache/info` 显示大小；`POST /api/cache/clear` 清除后返回 `{ freed, count }`；清除成功后广播 `nt-cache-cleared` 自定义事件
- **退出自动清理**：`localStorage('nt-auto-clean')`，默认 `true`；`App.jsx` 的 `beforeunload` 监听器在开启时调用 `navigator.sendBeacon('/api/cache/clear')`

### nt-cache-cleared 事件

`Settings.jsx` 清理成功后 dispatch `window.dispatchEvent(new CustomEvent('nt-cache-cleared'))`，以下组件监听并自行清理：
- `PcapAnalyzer`：重置所有状态（关闭当前 PCAP）
- `AnprServer`：清空 allRecords、重置分页
- `AnprTcpClient`：清空 allRecords、重置分页

### PCAP 内存管理

- `PcapAnalyzer` 始终挂载（CSS display:none 隐藏），导航离开不卸载，不丢失分析状态
- 上传新文件前自动 `DELETE /api/pcap/:pcapId` 释放旧文件内存
- 工具栏有 "Close PCAP" 按钮手动释放
- `getTimeline()` 中 idx 已 clamp 到 `[0, buckets-1]`，修复乱序时间戳导致的 500 崩溃

### 入站 HTTP 服务器

每个实例在独立 TCP 端口上以 Node.js `http.Server` 启动，通过 WebSocket 流式推送请求。  
页面卸载时通过 `navigator.sendBeacon` 停止服务器。

### i18n 多语言支持

- `frontend/src/i18n.js` — LANGS map + LangContext + useT() hook
- **master 分支**：仅英文（`LANGS = { en }`），Settings 无语言选择器，LangContext 固定值 `'en'`
- **multi-lang 分支**：英文 + 简体中文，Settings 含语言选择器，lang 持久化至 `localStorage('nt-lang')`
- 所有组件均使用 `useT()`，零硬编码 UI 字符串

### 版本号规则

`X.Y.Z[-suffix]`
- X：大版本（大功能/UI 大变更）
- Y：Minor（新功能，向后兼容）
- Z：Patch（bug 修复、小调整）
- suffix：语言标记（`-en` = 英文单语言版，无后缀 = 多语言版）
- 当前版本：master = `1.0.1-en`，multi-lang = `1.0.1`

---

## Git 分支 & CI

- **master**：英文单语言版（1.0.1-en）
- **multi-lang**：多语言版（1.0.1，含简体中文）
- **GitHub**：https://github.com/HeyJeale/nettools
- **GitHub Actions**：`.github/workflows/build.yml` — tag 触发（`v*`）+ 手动触发，构建 macOS ARM64 + Windows x64，自动创建 GitHub Release

---

## 技术栈 & 版本

| 领域 | 技术 |
|------|------|
| 后端运行时 | Node.js（CommonJS `'use strict'`） |
| 后端框架 | Fastify v5 |
| PCAP 解析 | `@cto.af/pcap-ng-parser`（支持 PCAP-NG） |
| SSH | `ssh2` |
| 前端 | React 18、Vite、ESM |
| 样式 | 单一 `App.css`（基于 CSS custom properties 的深色/浅色主题） |
| 图表 | Recharts |
| XML 解析 | `fast-xml-parser` |
| 终端 | `@xterm/xterm` |

---

## UI / 样式规范

- **单一 CSS 文件** `App.css` — 不按组件拆分，所有样式统一添加到此文件
- 使用基于 **CSS custom properties** 的主题 token（`var(--text-1)`、`var(--glass-border)` 等）
- 深色模式为默认，通过 `[data-theme="light"]` 选择器覆盖浅色
- 图标仅使用内联 SVG — 禁止使用 emoji 和外部图标字体
- 协议颜色通过 `PROTO_COLORS` 映射统一管理：
  ```js
  TCP: '#79c0ff', UDP: '#56d364', HTTP: '#e3b341',
  HTTPS: '#f0883e', DNS: '#bc8cff', ICMP: '#ff7b72', ARP: '#8b949e'
  ```

---

## PcapAnalyzer 主要功能（当前已实现）

| 功能 | 状态 |
|------|------|
| 数据包表格 + 分页 | 完成 |
| BPF 风格过滤器（proto、ip.src==、port==、contains、&&/\|\|/!） | 完成 |
| 按协议着色行（可切换） | 完成 |
| TCP 重组 HTTP（Wireshark 模型） | 完成 |
| TCP 前驱分段半透明显示 | 完成 |
| TCP 异常检测 + 红色高亮（重传/乱序/DupACK/Zero Window） | 完成 |
| HTTP 请求-响应配对（箭头列、→请求/←响应） | 完成 |
| 数据包详情弹窗（按层级展示字段） | 完成 |
| XML 正文 → 可折叠树视图（等宽字体，横向滚动） | 完成 |
| 重组分段信息展示（"Reassembled TCP segments…"） | 完成 |
| TCP continuation 包详情引导横幅 | 完成 |
| 协议统计饼图 | 完成 |
| 流量时间线图表 | 完成 |
| ONVIF 检测标签（Protocol 列附加 ONVIF badge） | 完成 |
| ONVIF 分析视图（工具栏 toggle，主表格切换，双行 req/resp，XML 树展开） | 完成 |
| 左侧 sidebar 可收起（图标模式，hover 显示折叠按钮） | 完成 |
| 右侧面板可收起（0 宽度，右边缘 hover 触发展开按钮） | 完成 |
| Close PCAP 按钮（手动释放内存） | 完成 |

---

## ANPR / TCP Client 主要功能（当前已实现）

| 功能 | 状态 |
|------|------|
| ANPR HTTP 服务器（动态实例，Basic Auth，图片存储） | 完成 |
| ANPR TCP 客户端（连接管理，LPR 协议解析） | 完成 |
| 记录列表稳定编号（seqRef，不受翻页/清空影响） | 完成 |
| 客户端分页（PAGE_SIZE=50，浮动 pill 翻页条） | 完成 |
| 图片预览弹窗（点击放大，保存功能） | 完成 |
| 字段过滤面板（含时间范围过滤） | 完成 |

---

## Settings 页主要功能（当前已实现）

| 功能 | 状态 |
|------|------|
| 颜色模式切换（dark/light/auto 卡片 + 缩略预览） | 完成 |
| 缓存大小显示与手动清理（释放空间反馈） | 完成 |
| 退出自动清理开关（localStorage 持久化） | 完成 |
| 清理缓存时同步清空 PCAP/ANPR 列表 | 完成 |

---

## 已知限制

- `pcapStore` 为内存存储 — 服务器重启后所有分析结果丢失
- 仅支持 PCAP-NG 格式（`@cto.af/pcap-ng-parser`）。旧版 `.pcap` 格式解析器行为可能不同
- TCP 重组基于捕获顺序而非序列号排序 — 在严重乱序环境下可能不准确
- `pcapParser.js` 以 Unicode 转义形式保存（`\u2192`、`\u003e` 等），使用 Edit 工具时字符串匹配可能失败 → 修改时建议用 Write 工具整体重写文件

---

## 工作风格（给 Claude）

- 添加代码前必须先读取目标文件
- CSS 只添加到 `App.css` — 禁止新建 CSS 文件
- 禁止创建不必要的抽象/辅助/工具函数 — 只实现被要求的内容
- 完成后禁止罗列总结 — 只简洁说明改动了什么
- 后端使用 CommonJS（`require`/`module.exports`），前端使用 ESM（`import`/`export`）— 禁止混用
- 修改 `pcapParser.js` 时：用 Write 整体重写更安全（Edit 工具存在 Unicode 问题）
- 不要每次修改后自动 commit，只在用户明确要求时才 commit，一次性提交所有改动
- 用户发送单独的 "." 表示"继续"，直接执行下一步，不需要任何回复文字
