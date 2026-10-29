# 前端可观测性接入方案（埋点 / 性能 / 错误 / 报警）

- 日期：2026-10-29
- 项目：knowledge-hub-frontend（React 19 + Vite 8 + Ant Design 6 + TypeScript）
- 状态：设计稿，待评审后实施

> 现状描述已对照源码核对（2026-10-29）；标注为计划的项尚未实现。

---

## 1. 为什么做

当前项目没有任何上报与聚合能力；唯一的本地观测是 `SearchPage.tsx:44,56` 用 `performance.now()` 展示检索耗时。出了问题是这样的：

- 用户说「白屏了」→ 只能让人截图 / 开控制台，复现不了就查不出来
- 某个接口挂了 → 只有用户反馈才知道，且不知道影响面有多大
- 页面慢 → 没有 LCP/FCP 数据，优化全靠感觉
- 改版后效果如何 → 没有埋点，说不清「新搜索框上线后使用率涨没涨」

目标是建立四条链路：**错误监控、性能监控、行为埋点、报警**。这是企业前端项目的标准配置，不是加分项。

## 2. 目标与非目标

### Goals

1. 生产环境的 JS 异常、Promise rejection、资源加载失败、React 渲染崩溃，**100% 捕获并可还原堆栈**（Source Map 上传）
2. 采集 Web Vitals（FCP/LCP/CLS/INP/TTFB）与 SPA 路由切换耗时
3. 检测页面白屏并上报，能关联到同一时刻的错误
4. 接口请求的耗时与失败率可观测，路径已归一化
5. 核心业务动作可埋点：登录、检索、问答、文档上传、文档发布
6. 有可执行的报警规则，接钉钉/飞书/企微通知

### Non-goals（本期不做）

- 不做会话录制 / DOM 回放（rrweb），成本高，等有真实排查需求再加
- 不做全量自动埋点（全局 click 采集），先手动声明式埋点，避免脏数据
- 不接 `product-tour`、`Session Replay`、`Profiling` 等 Sentry 增值功能
- 不做后端监控（本期只做浏览器侧）
- **不做埋点看板 / 漏斗分析 UI**：本期交付到「事件可靠落地」为止。数据怎么存、用什么查（后端日志表 / Elasticsearch / BI 工具）由后端侧决定，不在本仓库新增看板页

### Anti-goals（做成了也算失败）

- **埋点拖慢业务**：SDK 初始化阻塞首屏、上报阻塞页面卸载
- **数据不可用**：同一错误上报 10 万条不聚合、接口 path 带 id 导致全是长尾
- **泄露敏感信息**：token / 密码出现在上报数据里（这是红线，见 §7.3）
- **报警刷屏**：发版后群里被预期内报错淹没，最后所有人屏蔽告警

## 3. 现状盘点

| 位置 | 现状 | 对监控的意义 |
|---|---|---|
| [src/main.tsx](../../../src/main.tsx) | 唯一渲染入口 | SDK 唯一初始化位置 |
| [src/api/client.ts](../../../src/api/client.ts) | 除 `tryRefresh()` 的裸 fetch（`client.ts:30`）与 SSE 外，REST 均收敛在 `request()` | 接口监控的理想埋点位置 |
| [src/pages/ChatPage.tsx](../../../src/pages/ChatPage.tsx#L44) | `ChatPage.tsx:41-53` 用 `new DefaultChatTransport({ api: '/api/ai/chat/stream', headers })`，再传给 `useChat({ id, transport, onData, onFinish, onError })`；`useChat` 本身没有 `api` 参数 | **不经过 `request()`，必须单独处理** |
| [src/App.tsx](../../../src/App.tsx) | 路由平铺，无错误边界 | 任一页面组件崩溃 = 整站白屏 |
| [src/layouts/AppLayout.tsx](../../../src/layouts/AppLayout.tsx) | 已用 `useLocation`，有统一布局层 | 路由切换打点的天然位置 |
| [vite.config.ts](../../../vite.config.ts) | 基础 Vite 配置，无 Source Map 上传 | 需接 `@sentry/vite-plugin` |
| `.env` | 仅有 `VITE_API_BASE` | 需新增 DSN / 环境 / 版本号 |

## 4. 总体架构

```
┌─────────────── 浏览器 ───────────────┐
│                                      │
│  errors.ts      perf.ts    track.ts  │
│      │             │           │     │
│      └──────┬──────┘           │     │
│             ▼                  ▼     │
│        Sentry SDK        自研上报器   │
│    (错误/性能/接口 span)  (业务埋点)   │
└─────────────┬────────────────┬───────┘
              │                │
              ▼                ▼
      Sentry SaaS      knowledge-hub-backend
   (错误聚合/看板/报警)   (POST /api/telemetry/events)
                                │
                                ▼
                         数仓 / 看板 / 报警
```

### 选型决策（已定）

- **错误 + 性能 + 接口监控 → Sentry**（`@sentry/react@11` + `@sentry/vite-plugin@11`）
  - 理由：免费额度够用；错误指纹聚合、Issue 跟踪、Source Map 还原、性能看板开箱即用；是业界主流方案，符合企业实践
- **业务埋点 → 自研 `track()`**
  - 理由：Sentry 不是埋点平台，没有漏斗/留存分析；埋点字段与业务强耦合，需要落自己的数仓
  - 过渡方案：后端接口就绪前，`track()` 先写 `console.debug` + 内存缓冲，接口就绪后切换上报目标，调用方无感

## 5. 模块设计

### 5.1 目录结构

```
src/monitoring/
├── index.ts          # initMonitoring()：统一初始化，main.tsx 调用一次
├── config.ts         # DSN、environment、release、采样率等配置
├── errors.ts         # 全局错误监听（error / unhandledrejection）
├── perf.ts           # web-vitals + 路由切换耗时
├── white-screen.ts   # 白屏检测
├── track.ts          # 业务埋点 API
└── reporter.ts       # 埋点上报器（队列 + 批量 + sendBeacon + 重试 + 脱敏）

src/components/
└── AppErrorBoundary.tsx   # React 渲染错误边界
```

### 5.2 初始化

`main.tsx` 在 `createRoot(...).render()` **之前**调用 `initMonitoring()`。

```ts
// src/monitoring/index.ts
export function initMonitoring() {
  if (import.meta.env.DEV && !import.meta.env.VITE_MONITOR_DEV) return
  initSentry()
  installGlobalErrorHandlers()
  initWebVitals()
  initWhiteScreenDetection()
}
```

- 开发环境默认不初始化（避免本地调试被上报干扰），需要调试时设 `VITE_MONITOR_DEV=true`
- Sentry 初始化使用 `lazyLoadIntegration` 等异步能力时，必须保证不阻塞首屏；`Sentry.init()` 本身是同步轻量操作，可接受

### 5.3 错误监控

四个采集入口，缺一不可：

| 入口 | 实现 | 说明 |
|---|---|---|
| JS 运行时错误 | `window.addEventListener('error', handler, true)` | `capture: true` 才能收到资源加载错误 |
| 资源加载失败 | 同上，用 `event.target instanceof HTMLElement` 区分 | 上报资源 URL，过滤掉被广告拦截插件屏蔽的第三方资源 |
| 未捕获 Promise | `window.addEventListener('unhandledrejection')` | `e.reason` 可能是任意类型，需序列化保护 |
| React 渲染错误 | `AppErrorBoundary`（`componentDidCatch`） | `window.onerror` 收不到 React 吞掉的错误 |

`AppErrorBoundary` 行为：

- `componentDidCatch` 中调用 `Sentry.captureException(error, { contexts: { react: { componentStack } } })`
- 渲染降级 UI：标题「页面出错了」+ 「刷新重试」按钮 + 错误 ID（即 Sentry event id，方便用户报障时提供）
- 隔离粒度：**包裹整个 `<App />`**，并额外包裹每个路由页面（路由级边界，避免单个页面崩溃影响布局与导航）

### 5.4 性能监控

使用 `web-vitals@6`，不用手写。

```ts
import { onLCP, onFCP, onCLS, onINP, onTTFB } from 'web-vitals'
```

- 每个指标通过 `Sentry.metrics` 或自定义 span 上报，附带 `route` tag（当前路径模板）
- **CLS / INP 是全程累计值**，必须在页面隐藏时上报最终值：统一挂 `visibilitychange`（`document.visibilityState === 'hidden'`）+ `pagehide`
- LCP 启用 `attribution: true`，上报 `element` / `url`，知道慢在哪
- 兼容性：Safari 对部分指标支持不全，缺失的指标不上报，不补 0

**路由切换耗时**（SPA 必需，Web Vitals 的 FCP/LCP 只反映首屏）：

- 在 `AppLayout` 中监听 `location.pathname` 变化，记录 `performance.now()` 起点
- 目标页面在 `useEffect` 中打结束点（或用 `requestAnimationFrame` 双帧后打点，近似「首屏渲染完成」）
- 上报 `route-change` 指标：`{ from, to, duration }`
- 跨页面传参用 `sessionStorage` 或模块级变量，避免每个页面都改代码——**优先模块级工具函数 `markRouteStart()` / `markRouteEnd()`**

**接口耗时**：Sentry 的 `browserTracingIntegration` 默认自动采集 `fetch` / XHR 的 span，**无需手写耗时统计**。需要配置：

- `tracePropagationTargets`：只对同源 API 注入 trace header
- 在 `request()` 中对 5xx 额外 `captureMessage`，带上归一化后的 path 与 status

### 5.5 白屏检测

白屏是**结果状态**，不是错误事件，必须主动检测。

检测时机与判定：

1. `window.load` 后延迟 3 秒（可配置）执行首次检查
2. 同时用 `MutationObserver` 监听 `#root`，记录变更次数
3. 判定为白屏的条件（全部满足）：
   - `#root` 无 `firstElementChild`，或被判定元素 `getBoundingClientRect().height === 0`
   - `document.body.innerText.trim().length < 10`
   - 超时窗口内 DOM 变更次数为 0（避免「正在加载」误判）
4. 白屏时上报：`captureMessage('white_screen', { level: 'fatal' })`，附带
   - 当前路由
   - 资源加载失败列表
   - 最近 5 条 breadcrumb
5. 上报后**只报一次**（`sessionStorage` 标记），避免轮询式重复上报

### 5.6 接口监控

在 `request()` 中补充三件事：

1. **路径归一化**：`/documents/123` 与 `/documents/456` 必须聚为 `/documents/:id`
   - 实现：维护正则数组，按序替换数字段、UUID 段；未知路径原样保留（会暴露在新 path 上，便于发现遗漏）
2. **错误上报**：`!res.ok` 时 `captureMessage`，`tags: { api: 'GET /documents/:id', status: 500 }`，`level` 按状态码分级（5xx = error，4xx = warning）
3. **网络错误**：`fetch` throw（断网、超时）单独标记 `network_error`，与 HTTP 错误区分
4. **refresh 请求单独打点**：`tryRefresh()` 用的是裸 `fetch`（`client.ts:30`），不经过 `request()`，需单独打点；否则刷新失败不会被上报覆盖

**SSE（AI 问答）单独处理**：

- `useChat` 的 `onError` 回调中 `captureException`
- 额外记录：首字节耗时（TTFB）、流中断（已开始输出但未收到结束标记）、流总时长
- 这些指标不进 `request()`，在 `ChatPage` 内用 `performance.now()` 打点后上报

### 5.7 业务埋点

```ts
track(event: string, props?: Record<string, unknown>): void
```

**事件字典**（首期，白名单管理，新增事件需在此登记）：

| 事件名 | 触发时机 | 关键属性 |
|---|---|---|
| `login_success` / `login_fail` | 登录请求返回 | `{ method: 'password' }` |
| `search_submit` | 发出检索请求 | `{ queryLength, category, hasFilter }` |
| `chat_message_send` | 发送问答 | `{ sessionId, messageLength }` |
| `chat_answer_done` | 流式回答结束 | `{ duration, citationCount }` |
| `document_upload` | 上传解析接口返回 | `{ fileType, fileSizeBucket, success }` |
| `document_publish` | 点击发布且接口成功 | `{ docId }` |
| `route_view` | 路由切换 | `{ path, from }` |

**口径约定（粗粒度，已定）**：

- `document_publish` **不区分**「提交审核」与「审核通过」，统一记为「触发了发布动作」；需要看审核漏斗时再加 `document_review_approve`
- `document_upload` 记为「解析接口成功返回」，不追踪用户后续是否保存
- `login_fail` **不细分失败原因**：后端对密码错误、账号禁用、未激活统一返回 401 + 中文 message，前端无法可靠区分。需要细分时必须先推动后端补 `errorCode`

约束：

- 事件名只允许 `snake_case`，白名单外的 `track()` 调用在开发环境直接 `console.warn`，生产环境丢弃
- **不采集正文内容、查询词原文**（隐私）；只采集长度、分类、数量等派生值
- 属性值只允许 `string | number | boolean`，嵌套对象需展平

### 5.8 上报器（reporter）

业务埋点的上报通道，设计要点：

| 能力 | 实现 |
|---|---|
| 批量 | 攒 20 条或 5 秒发一次，`flush()` 手动触发 |
| 卸载上报 | `visibilitychange` → hidden / `pagehide` 时 `navigator.sendBeacon` |
| 失败重试 | 失败写入 `localStorage` 队列（上限 100 条，超限丢最旧） |
| 补传 | 下次初始化时读取本地队列并发送 |
| 采样 | 埋点全量；性能 20%（生产）；错误 100% |
| 传输格式 | `text/plain`，body 为 `JSON.stringify(events)`（避免 CORS 预检） |

**后端待建接口**：`POST /api/telemetry/events`，body `{ events: TelemetryEvent[] }`。接口未就绪时，`reporter` 使用 `noop` 传输层，数据只进内存，不影响业务。

**鉴权方案（实施者定）**：`navigator.sendBeacon` 无法携带自定义请求头，而项目的 `Authorization` 是 Bearer header，两者天然冲突。三种解法及取舍：

| 方案 | 做法 | 取舍 |
|---|---|---|
| **A. 匿名同源 + 服务端限流（采用）** | 端点不校验 access token，同源 + 后端按 IP / 设备 ID 限流与去重 | 实现最简单；登录前的埋点也可上报；需后端加防刷 |
| B. token 放 body | `{ token, events }` | 与「token 不进上报数据」的红线冲突，**否决** |
| C. `fetch(keepalive: true)` | 能带 header，但要走 `Authorization` | 页面卸载时送达可靠性低于 sendBeacon，且埋点不应依赖登录态 |

设备维度用前端生成的 `anonymousId`（`crypto.randomUUID()` 存 `localStorage`），用户维度用**哈希后的 userId**，均不含明文 PII。

## 6. 配置与环境变量

**实施前置**：`.env` 当前已被 git 跟踪（`.gitignore` 未忽略），加 `VITE_SENTRY_DSN` 前必须先把 `.env` 移出版本库并新建 `.env.example`；`SENTRY_AUTH_TOKEN` 只走构建机环境变量，不得写入任何入库文件。

新增 `.env.example`（示例值必须是假值）：

```bash
# Sentry DSN（在 Sentry 项目 Settings → Client Keys 获取）
VITE_SENTRY_DSN=https://xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx@o0.ingest.sentry.io/0

# 环境标识：development | staging | production
VITE_APP_ENV=production

# 应用版本，用于 Source Map 关联与发布追踪
VITE_APP_VERSION=0.0.0

# 本地开发时是否启用监控（默认关闭）
VITE_MONITOR_DEV=false
```

- DSN 是公开的（会出现在打包产物里），但**不要把 auth token 写进任何 `VITE_` 变量**——`VITE_` 前缀的变量会全部打进前端包
- Source Map 上传所需的 `SENTRY_AUTH_TOKEN` **只放构建机环境变量**，不落仓库、不做 `VITE_` 前缀

### 配额与采样策略

Sentry 的 **errors 与 performance/spans 是分开计量的**，只核算 5k errors/月 不够。默认按免费版设定：

| 采集项 | 采样 | 配额吃紧时的降级 |
|---|---|---|
| 错误（exception / message） | 100% | 不降级，错误是最重要的 |
| Web Vitals | 生产 10% | 降至 5%，或只在 P75 超阈值时上报 |
| `browserTracingIntegration` 自动 fetch span | 生产 10% | **关闭自动 span**，改为 reporter 自己统计接口耗时 |
| 业务埋点 | 100% | 走自研通道，不占 Sentry 配额 |

**对报警的影响**：Sentry 原生的「5xx 率 > 1%」需要全量请求数做分母，采样后算不准。两种处置，二选一：

1. 接口成功率改由**后端统计**（后端有全量日志，最准确）
2. 前端 reporter 全量计数（只上报聚合值，不上报每条请求），在自建看板上配规则

**结论**：Sentry 负责「有什么错、错在哪、堆栈是什么」，阈值型报警（错误率、5xx 率）由后端或自建统计负责。这个分工要在 P3 前确认。

## 7. 安全与脱敏

### 7.1 客户端脱敏（上报前）

在 Sentry 的 `beforeSend` / `beforeBreadcrumb` 与自研 reporter 的统一出口做：

- 请求头：抹掉 `Authorization`、`Cookie`
- 已知敏感字段名：`token`、`accessToken`、`refreshToken`、`password`、`sid`、`sign`
- URL 查询串：整体替换为 `?redacted`
- 裸 32 位 / 40 位十六进制字符串：替换为 `[REDACTED]`

> 遵循既有规范：**脱敏靠函数构造保证**，所有上报必须经过同一个出口函数，不依赖调用方自觉。

### 7.2 不采集的内容

- 文档正文、检索词原文、聊天内容
- 用户名、手机号、邮箱等 PII（需要用户维度时用哈希后的 userId）
- 表单输入内容

### 7.3 Source Map

- 构建时开启 `build.sourcemap: 'hidden'`
- 用 `@sentry/vite-plugin` 上传后删除 `.map` 文件，**禁止把 Source Map 部署到公网**

## 8. 报警设计（P3 暂缓，设计保留备查）

> 已定：本期**不接外部通知渠道**。Sentry 只配站内邮件告警。下列规则留作后续接入时的依据。

Sentry 中配置 Alert Rules，通知渠道接钉钉/飞书/企微 Webhook（或用 Sentry 的 Slack 集成）。

| 规则 | 条件 | 级别 | 通知 |
|---|---|---|---|
| 新增错误指纹 | 近 5 分钟出现新的 Issue | P1 | 群 @所有人 |
| 错误量突增 | 5 分钟内错误数 > 50 且同比前 1 小时均值 +200% | P1 | 群 |
| 白屏 | `white_screen` 事件 > 0 | P0 | 群 @所有人 + 电话（有值班时） |
| 接口 5xx | 5xx 率 > 1% 持续 5 分钟 | P0 | 群 @所有人 |
| 关键接口不可用 | `/auth/login` 失败率 > 10% | P0 | 群 @所有人 |
| LCP P75 | 生产环境 30 分钟窗口 P75 > 2.5s | P2 | 群（不 @） |
| Source Map 缺失 | 出现无法解析的 issue | P2 | 群 |

**降噪机制（必须配）**：

- 同指纹 5 分钟内只通知一次
- 发布后 10 分钟静默窗口（`release` 变更后自动跳过告警）
- 告警解除时发送恢复通知

## 9. 分阶段实施

| 阶段 | 内容 | 产出 | 预计 |
|---|---|---|---|
| **P0 错误可观测** | Sentry 初始化、`AppErrorBoundary`、全局错误监听、`request()` 错误上报、Source Map 上传脚本 | 报错能自动聚合、堆栈可读 | 0.5 天（CI 接入另计） |
| **P1 性能可观测** | web-vitals、路由切换耗时、白屏检测 | 能看到 FCP/LCP/CLS/INP 与白屏率 | 0.5 天 |
| **P2 业务埋点** | `track()` + reporter + 事件字典（粗粒度 7 个事件） + 核心动作埋点 | 登录/检索/问答/上传四个漏斗可看 | 1 天（含后端接口） |
| **P3 报警（暂缓）** | Sentry 站内告警规则 + 降噪；外部通知渠道暂不接 | 出问题能在 Sentry 中看到 | 0.5 天 |

每阶段独立可验收，P0 完成后即可上线，不必等全部做完。

## 10. 验收标准

**P0**

- [ ] 在 dev 环境手动抛错，Sentry 控制台能看到带完整调用栈的 issue
- [ ] 故意让某个页面组件在渲染期抛错，页面显示降级 UI 而非白屏，Sentry 收到错误
- [ ] 断网状态下调用接口，Sentry 收到 `network_error`
- [ ] 构建产物上传后，Sentry 中的堆栈能映射到源码文件与行号（有 CI 由 CI 执行，无 CI 本地执行 `pnpm build:sentry`（脚本待新增，当前 package.json 无此命令）；Source Map 上传后删除，不部署到公网）
- [ ] 抓包确认上报数据中没有 token

**P1**

- [ ] Sentry Performance 中能看到 FCP/LCP/CLS/INP/TTFB 分布
- [ ] 路由切换能在 Performance 中看到独立指标
- [ ] 在 dev 中让 `#root` 清空，能触发一次白屏上报（且只报一次）

**P2**

- [ ] 完成一次登录 + 一次检索 + 一次问答，埋点数据在接收端可见且字段完整
- [ ] 关闭网络后产生的埋点，恢复后能补传
- [ ] 白名单外的事件名在开发环境有警告

**P3（暂缓）**

- [ ] 制造一次 5xx（后端 mock），Sentry 中触发告警 Issue 并发送站内邮件
- [ ] 连续制造同样错误 10 次，只收到 1 条通知

## 11. 风险与待定项

| 项 | 说明 | 处置 |
|---|---|---|
| **部署与 CI 尚未落地** | 目前只有内网 / 公网部署的打算，是否执行未定，也没有实际流水线 | 方案按「两套路径」设计：Source Map 上传做成独立的 `pnpm build:sentry` 脚本，CI 就绪后直接复用；无 CI 时本地手工执行 |
| **`release` 来源待定** | 无 CI 时用 git sha 手工注入 | `vite define` 注入 git sha；后续接 CI 再自动化 |
| **Sentry 网络可达性** | 国内环境直连 `sentry.io` 可能不稳定，企业内网通常禁止 | 若不可直连：启用 Sentry `tunnel`（需后端提供一个转发端点），或改自建 Sentry |
| AI SDK 的 fetch 拦截 | `@ai-sdk/react` 可能绕过全局 fetch，Sentry 的自动 span 采集不一定覆盖 | P0 阶段验证；不覆盖则在 `useChat` 的 `onData`/`onFinish` 手动打点（当前 AI SDK 版本没有 `onResponse`） |
| 白屏误判 | 弱网下 3 秒窗口可能仍在加载 | 用 MutationObserver 变更次数做二次判定；阈值可配置 |
| 后端埋点接口未建 | P2 依赖后端新增 `/api/telemetry/events` | 先用 noop 传输层，不阻塞前端开发 |
| 路由级 ErrorBoundary 工作量 | 每个页面都要包，容易漏 | 在 `AppLayout` 的 `<Outlet />` 外包一次即可覆盖所有子路由 |

## 12. 决策记录与待拍板项

### 已由实施者决定（记录备查，可推翻）

- 埋点上报端点采用**匿名同源 + 服务端限流**，不携带 access token（§5.8）
- 埋点看板 / 漏斗分析**不在本期范围**，本期只保证事件可靠落地（§2）
- 免费版配额下的**采样与降级策略**（§6）
- `track()` 白名单机制、路径归一化规则、白屏判定阈值、ErrorBoundary 挂载位置

### 仍需作者回答（会影响实施计划）

1. **部署形态（已部分澄清）**：目前只有内网 / 公网部署的打算，不一定执行，也没有现成 CI。方案已按「无 CI 也能跑」设计，Source Map 上传保留手工脚本入口；若后续确定部署，再接入流水线。
2. **Sentry 形态与网络可达性**：浏览器能否直连 `sentry.io`？用免费版、付费版还是国内云 / 自建？——决定是否需要在 P0 就动后端（tunnel 转发）。
3. **埋点口径**：`document_publish` 算「提交审核」还是「审核通过」；`document_upload` 算「解析成功」还是「用户最终保存」；`login_fail` 后端只返回 401 + 中文 message，是否需要推动后端补错误码。——口径定错会让历史数据不可比。
4. **报警通知渠道**：钉钉 / 飞书 / 企微？——决定 P3 的 Webhook 实现。
