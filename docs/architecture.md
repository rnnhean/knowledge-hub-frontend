# Knowledge Hub 全链路架构

> 依据：`knowledge-hub-backend/src` 与 `knowledge-hub-frontend/src` 的真实实现，逐模块阅读后归纳。
> 写法约定：**「设计稿」= 早期设计图的口径；「代码」= 仓库里真实存在的实现**。两者不一致处单独列出，正文一律以代码为准。

---

## 一、一句话概括

这是一个**文档型 RAG 知识库**：文档经过「上传 → 多格式解析 → 双库存储 → 人工审核 → 发布」，发布动作投递到 RabbitMQ，由三条消费者并行构建**三种索引**（ES 片段向量 + ES 文档全文 + Neo4j 知识图谱）；读取侧提供四条递进路径——关键词搜索、混合检索、非流式问答、Agent 流式问答，全部叠加以「用户可见性」为准的数据级过滤，并配 Redis 短期记忆、Mem0 长期记忆和 LangFuse 全链路观测。

---

## 二、整体拓扑

```
                         ┌──────────── 前端 (React + Vite + antd) ────────────┐
                         │ 文档管理 / 智能搜索 / AI 问答 / 知识图谱 / 系统管理  │
                         └──────────────────────┬─────────────────────────────┘
                                                │ HTTP  Bearer Token
                                    ┌───────────▼────────────┐
                                    │ 入口层  NestJS Controller │
                                    │ DTO + 全局 ValidationPipe │
                                    └───────────┬────────────┘
                                                │
                     ┌──────────────────────────┼──────────────────────────┐
                     ▼                          ▼                          ▼
              ┌─────────────┐           ┌──────────────┐           ┌─────────────┐
              │ 鉴权三守卫   │           │  写入 / 读取  │           │  图谱检索    │
              │ JWT→Roles→  │           │   业务服务    │           │  /graph     │
              │ Permissions │           └──────┬───────┘           └─────────────┘
              └─────────────┘                  │
                                                │ 发布事件
                                    ┌───────────▼────────────┐
                                    │   RabbitMQ 三组交换机    │
                                    └───┬────────┬───────────┬┘
                          ┌─────────────┘        │           └──────────────┐
                          ▼                      ▼                          ▼
                   RAG 队列                Search 队列                  KG 队列
              查库→分块→嵌入            整篇快照→写 ES              查库→分块→抽实体
                          │                      │                          │
                          ▼                      ▼                          ▼
                  ES kh_chunk            ES kh_document                 Neo4j
             (dense_vector + 倒排)        (文档级倒排)          Document→Chunk→Entity
                          └──────────────┬───────┴──────────────────────────┘
                                         ▼
                              ┌──────────────────────┐
                              │ 读取：关键词 / 混合检索 │
                              │ RRF → rerank → LLM    │
                              │ → Agent 工具循环 → SSE │
                              └──────────┬───────────┘
                                         │
                      ┌──────────────────┼───────────────────┐
                      ▼                  ▼                   ▼
                Redis 短期记忆      Mem0 长期记忆        LangFuse 观测
```

---

## 三、能力演进顺序

这条时间线很重要：**很多「矛盾」其实是不同阶段的口径**。看架构时必须先确认它属于哪一版。

| 阶段 | 主题 | 引入的关键能力 | 对应分支 |
|---|---|---|---|
| 01 | 项目介绍、多模态 RAG 流程梳理 | 全景愿景图（含大量尚未落地的组件） | — |
| 02 | 文档模块数据库设计 | PG 存元数据 + Mongo 存正文 + RustFS 存原文件 | — |
| 03 | PDF/XLSX/DOCX/PPTX 解析为 md | 本地解析器矩阵、图片外置 OSS | v2 |
| 04 | 基于 MQ 的异步 RAG 流水线 | RabbitMQ 三队列、分块 + 嵌入写 `kh_chunk` | — |
| 05 | 全文检索链路 | `kh_document` 索引、INDEX 消息、失败分支 | — |
| 06 | 文档抽取 Neo4j 知识图谱 | 三级实体模型、10 类实体 / 12 种关系 | v5 |
| 07 | 文档审核机制、四种状态流转 | 状态机、`kh_document_review`、索引清理 | — |
| 08 | 用户鉴权流程 | JWT + RefreshToken、`APP_GUARD` 全局守卫 | v7 |
| 09 | 用户模块功能完善 | 邮箱注册激活、验证码重置密码 | v8 |
| 10 | RBAC 权限系统 | 用户-角色-权限三表 + 三层守卫 | v9 |
| 11 | 关键词高亮检索 + 图谱检索 | `/search` 高亮、`/graph/search` 子图 | v10 |
| 12 | RAG 混合检索、引用溯源 | BM25 ∥ kNN → RRF → rerank → 带 `[n]` 引用 | — |
| 13 | 前端界面、前后端联调 | 路由结构、三级权限在前端的落地 | — |
| 14 | AI 问答对话历史 | `kh_ai_session` / `kh_ai_message`、外键级联 | — |
| 15 | SSE 流式 UI 组件渲染 | Vercel AI SDK 的 UI Message Stream Protocol | — |
| 16 | 文档检索可见性控制 | 召回阶段过滤（ES filter + SQL where） | v15 |
| 17 | Mem0 + Redis 长短期双层记忆 | 滑动窗口、TTL 回填、事实抽取分类器 | v16 |
| 18 | Agentic RAG 大模型自主检索 | 意图路由 5 类、工具循环、切题评估、查询改写 | v17 |
| 19 | Graph RAG | `retrieve_graph` 工具、双 tool 并行、`data-graph` 事件 | v18 |
| 20 | LangFuse 评测与 tracing | OTel 自动上报 + 离线评测实验 | — |
| 21 | MinerU 解析文档 | 复杂格式外挂解析、zip 产物处理、图片回传 OSS | — |
| 22 | 产品体验完善 | 分类 / 版本 / 评论 / 点赞 / 收藏 / 分享 / 通知 | — |

---

## 四、写入链路

### 4.1 三种存储的分工

| 数据 | 存储 | 理由 |
|---|---|---|
| 原始二进制（PDF / 视频 / 音频） | RustFS 对象存储 | 大体积、不可变、可重解析 |
| 元数据（标题/作者/状态/分类/统计） | PostgreSQL `kh_document` | 强关联、要事务、要分页与权限统计 |
| 解析后的 Markdown 正文 | MongoDB `document_content` | 大文本、按 id 整块读写 |

关联方式：`kh_document.content_id` ↔ `document_content._id`，一对一。
读路径做了冷热分离：**列表只查 PG，点开详情才去 Mongo 拉正文**。

> 注意：MongoDB 单文档上限 16MB，所以图片一律外置到对象存储，正文里只留链接。按换算，16MB ≈ 500 万汉字，《红楼梦》70 万字约 2MB。

### 4.2 上传解析

```
POST /documents/upload/parse（单文件 ≤ 50MB）
        │
        ▼
  FileParserService 按扩展名分派
        ├── MINERU_EXTENSIONS 命中 → MinerU 精准解析 API
        └── 其余 → 本地 parser
                    ├── pdf   : pdf-parse，按页抽文本 + 抽图
                    ├── docx  : mammoth → HTML → turndown+GFM → md
                    ├── xlsx  : exceljs（失败降级 officeparser）
                    ├── pptx  : ZIP 解 OOXML → slideN.xml（失败降级 officeparser）
                    └── txt/md: 直读
```

**关键设计：两套解析器并存，按扩展名分派，而不是「全量替换」**。本地 parser 依赖少、快、零成本；MinerU 解决扫描件 OCR、复杂公式表格这类本地做不到的情况。

MinerU 链路是 7 步严格串行：

```
获取 uploadUrl + batchId → 上传文件 → 轮询 /batch/{batchId}/status
  → 下载 result.zip → 解出 full.md + images/
  → images 上传到本地 OSS → 替换 md 内图片链接 → 输出最终 md
```

轮询参数：间隔 5000ms，超时 600000ms（10 分钟）；MinerU 侧产物保留 30 天。

### 4.3 状态机

| 值 | 状态 | 含义 | 是否进索引 |
|---|---|---|---|
| 0 | Draft 草稿 | 编辑中，仅作者/协作者可见 | 否 |
| 1 | Published 已发布 | 正式对外，可被检索与问答 | **是** |
| 2 | Archived 已归档 | 下线保留，历史可查 | 否（归档时清索引） |
| 3 | PendingReview 待审核 | 已提交，等审核员处理 | 否 |

迁移边：

```
Draft ──publish/submit──▶ PendingReview ──approve──▶ Published ──archive──▶ Archived
  ▲                              │                      │
  └──────────reject──────────────┘                      │
  └────────────────save-draft（下架编辑，清索引）────────┘
```

三条铁律：

1. **只有 Published 会写三套索引**，Draft / PendingReview / Archived 都不参与；
2. 离开 Published（archive / save-draft / 重新 submit）**先清旧索引**；
3. 索引写入是**异步**的——状态先落库，再投 MQ。

`DOCUMENT_REQUIRE_APPROVAL` 环境变量控制是否走审核：不设置时默认 `true`。

审核记录表 `kh_document_review` 的一个细节值得单独看：待办列表用**部分索引**实现——

```sql
CREATE INDEX idx_kh_document_review_pending
  ON kh_document_review(review_result)
  WHERE review_result IS NULL;
```

即「`review_result IS NULL` 就是待办」。approve/reject 后字段被填值，自然移出待办，不需要额外的状态位。

### 4.4 产品层增强

这些功能与 RAG 主链路正交，但都会改数据库：

- **版本管理** `kh_document_version`：每次保存**追加**一条新版本，恢复历史版本 = 把旧正文写成新版本，历史不删；
- **分类管理** `kh_category`：`parent_id` 自关联的树（一级 → 二级）；
- **互动** `kh_comment`（`parent_id` 支持楼中楼）、`kh_document_like`、收藏表；
- **分享** `kh_document_share`：token + 可选密码 + 有效期，`revoked` 关闭；
- **通知** `kh_message`：5 类（站内活动 / 站内普通 / 评论 / 点赞 / 管理员群发）。

---

## 五、异步编排

### 5.1 三组交换机 / 三个队列

| 交换机 | 队列 | Routing Key | 载荷类型 |
|---|---|---|---|
| `rag.reindex.exchange` | `kh.rag.reindex.queue` | `rag.reindex.by_ids` / `rag.reindex.delete` | `BY_DOC_IDS` / `DELETE_BY_DOC_IDS` |
| `search.index.exchange` | `kh.search.index.queue` | `search.index.document` / `search.index.delete` | `INDEX`（**带整篇文档**）/ `DELETE` |
| `kg.graph.exchange` | `kh.kg.graph.queue` | `kg.graph.build.by_ids` / `kg.graph.delete` | `BUILD_BY_DOC_IDS` / `DELETE_BY_DOC_IDS` |

> 对照：早期设计稿里写的是 `kh.document.exchange` / `kh.document.search.queue`，代码常量是 `search.index.exchange` / `kh.search.index.queue`。两者是同一套东西的不同命名，**以代码为准**。

### 5.2 三种消息载荷的本质差异

这是三条队列最容易被忽略、但最关键的差别：

- **Search 队列带整篇快照**（元数据 + 正文）——消费者拿到就能直接写 ES，不用回库；
- **RAG / KG 队列只带文档 ID 列表**——查库、分块、嵌入、抽实体全部在消费者侧完成。

早期 Search 链路因为「消息体积限制」只截了正文前 1000 字，导致只能搜到前 1000 字；后来统一改成传 ID、消费者回库拉全文。

### 5.3 失败语义

处理失败时 `nack(msg, false, false)`——不重回队列，避免毒消息形成热循环。补偿靠显式的 `POST /documents/:id/reindex` 重放三条链路（代码 `src/mq/rabbitmq.service.ts`）。这是「不自动重试 + 显式补偿」的取舍：外部依赖（MinerU、LLM）故障时长不可预测，自动重试会把队列和内存吃满。

发布入口统一走 `afterPublish`，内部并行投递：

```ts
await Promise.all([
  triggerRagReindex(document.id),
  triggerSearchIndex(document, content),
])
```

---

## 六、三条索引链路

### 6.1 RAG 链路：分块 → 嵌入 → `kh_chunk`

- 分块：LangChain `RecursiveCharacterTextSplitter`，按 Markdown 标题层级优先切，再按 token 上限合并；
  `RAG_CHUNK_SIZE=512`、`RAG_CHUNK_OVERLAP=64`；
- 嵌入：`text-embedding-v3`，1024 维；
- 写入：ES `kh_chunk`，**同一份 chunk 同时存两个字段**——
  - `content`：`text`，写入 `ik_max_word`、检索 `ik_smart`
  - `embedding`：`dense_vector`，`dims: 1024`，`similarity: cosine`

这个「双字段」设计是后面双路召回能成立的前提：一次写入、两路可查，融合时按 chunk id 去重。

### 6.2 全文链路：整篇 → `kh_document`

不做分块，直接存整篇文档快照（标题、摘要、正文、标签、作者、时间、分类）。支撑 `/search` 的精确命中、分类筛选、分页。

高亮配置：

| 字段 | fragment_size | number_of_fragments | 说明 |
|---|---|---|---|
| `title` | — | 0 | 整段高亮 |
| `content` | 160 | 3 | 取 3 段摘要 |
| `summary` | 120 | 1 | 取 1 段 |

列表查询用 `_source.excludes: ['content']` 不回传全文，但仍用 content 做匹配与高亮。

### 6.3 图谱链路：分块 → 抽实体关系 → Neo4j

**三级实体模型**是这套图谱的骨架，不是可选项：

```
(:KnowledgeDocument) -[:HAS_CHUNK]-> (:DocumentChunk) -[:MENTIONS]-> (:KnowledgeEntity)
                                                                          │
                                                              [:RELATED_TO] │
                                                                          ▼
                                                                   (:KnowledgeEntity)
```

- 实体 `type` 共 10 类：`PERSON` / `ORGANIZATION` / `CONCEPT` / `DOCUMENT` / `PROCESS` / `PRODUCT` / `LOCATION` / `TIME` / `POLICY` / `RESOURCE`
- 关系 `RELATED_TO.relation` 共 12 种：`HAS_PART` / `BELONGS_TO` / `RELATED_TO` / `DEFINES` / `REQUIRES` / `USES` / `RESPONSIBLE_FOR` / `PARTICIPATES_IN` / `LOCATED_IN` / `OCCURS_AT` / `CAUSES` / `CONFLICTS_WITH`

为什么不省略 Chunk 层：因为要做**溯源**——从实体能回到具体段落、再回到原文，少了 Chunk 这一层就断链了。

建图顺序：文档节点 → chunk 节点 → `HAS_CHUNK` → LLM 抽实体（structured output）→ 建实体节点 + `MENTIONS` → 实体间 `RELATED_TO`。
删图顺序：先按 docId 删文档与 chunk，再删没有 chunk 指向的孤儿实体。

---

## 七、读取链路

四条路径，成本从低到高递进：

| 路径 | 接口 | 用到什么 | 典型场景 |
|---|---|---|---|
| 关键词搜索 | `POST /search` | ES `kh_document` BM25 + 高亮 | 知道找哪篇，要精确命中 |
| 混合检索 | `POST /rag/search` | `kh_chunk` BM25 ∥ kNN → RRF → rerank | 找相关段落，不做生成 |
| 非流式问答 | `POST /ai/chat` | 混合检索 + LLM，一次性返回 | 早期跑通流程（当时未做 SSE） |
| 流式问答 | `POST /ai/chat/stream` | Agent 工具循环 + SSE | 当前主路径 |

### 7.1 混合检索四步

```
query ─┬─▶ 关键词检索（BM25 / multi_match，ik_smart）─▶ Top N
       └─▶ 向量检索（kNN，dense_vector）───────────────▶ Top N
                                                          │
                              RRF 融合（应用层，不在 ES 内）│
                                                          ▼
                                          Reranker 精排（cross-encoder）
                                                          │
                                              minScore 过滤 → Top K
```

默认参数（代码 `src/ai/hybrid-retrieval.service.ts:38-40`）：

- `RAG_HYBRID_TOP_K = 20`（每路召回条数）
- `RAG_RRF_C = 60`（RRF 平滑常数）
- `RAG_MIN_SCORE = 0.4`（精排后过滤阈值）
- `topK = 5`（最终返回条数）

**RRF 公式**：`score(d) = Σ 1 / (C + rank_i(d))`。只用名次不用分数，天然规避 BM25 分（8.3）和 cosine 相似度（0.72）量纲不可比的问题。

**降级**：rerank 不可用时回退 RRF 排序，并在响应头带 `X-Rag-Degraded: rerank`。降级时**不套 minScore**——RRF 分（≈1/(C+rank)）和 rerank 分（0–1）量纲不同，硬套阈值会把结果全过滤光。

### 7.2 引用溯源

`/ai/chat` 返回 `{ answer, sources }`，正文里每个论断后用 `[1]`、`[2]` 标注，`sources[i]` 按下标对应。sources 每项含：

```
index / documentId / documentTitle / heading / excerpt / score
```

提示词里做了硬约束：只根据检索到的资料回答、资料不足要明说「不知道」、每条结论后必须标 `[n]` 且编号与资料列表一致。

### 7.3 SSE 流式

前端 `useChat` + `DefaultChatTransport`，后端 `createUIMessageStream` + `pipeUIMessageStreamToResponse`，协议是 **Vercel AI SDK 的 UI Message Stream Protocol**（原名 Data Stream Protocol）。

事件顺序（代码 `writer.write` 的调用顺序）：

```
start
 → data-session        （sessionId，前端据此改 URL）
 → data-status         （stage: 'retrieve'，占位「正在检索知识库...」）
 → data-retrieve       （query + 命中的 items[]）
 → data-sources        （完整 sources 数组）
 → source-document ×N  （每个来源一条）
 → start-step
 → reasoning-start / reasoning-delta ×N / reasoning-end   （思考过程）
 → text-start / text-delta ×N                             （正文）
 → message-end
```

设计要点：**先写业务自定义事件，再把 LangChain Agent 的流 merge 进来**。merge 时 `sendStart: false`、`sendFinish: false`，因为外层 `execute` 已经写了 start，结束由 `createUIMessageStream` 收口，避免重复事件。

模型参数：`temperature: 0.2`、`timeout: 60000`、`maxRetries: 0`、`useResponsesApi: false`、`streamUsage: false`。
中间件：`modelCallLimitMiddleware({ runLimit: 4, exitBehavior: 'end' })`——单次 invoke 最多 4 次模型调用。

### 7.4 Agentic RAG

进入 Agent Loop 之前先做一次**意图路由**，产出 `intent` + `standalone_query`，再决定挂哪几个工具：

| 意图 | 含义 | 挂载工具 |
|---|---|---|
| `chitchat` | 寒暄闲聊 | 不挂检索 |
| `profile` | 只改用户自己的名字/偏好 | 不挂检索 |
| `kb` | 制度、流程、岗位、内部系统 | `retrieve_knowledge` + `retrieve_graph` |
| `web` | 只要公开时效信息 | `web_search` |
| `kb_then_web` | 先查知识库，不够再联网 | 三个都挂 |

意图识别失败时**默认按知识库处理**——宁可多查一次，也别把内部问题漏检。

循环约束（写进工具描述，而不是硬编码）：

- `retrieve_knowledge` 最多两次；
- 切题评估不足才 `rewrite_query`，改写结果与上次不同且不超过 40 字；
- 仍不足且意图允许才 `web_search`，最多一次；
- 纯知识库仍没有 → 明确告诉用户「库里没有」，**禁止用记忆编造制度**。

切题评估返回结构化结果 `{ relevant: boolean, reason: string }`。为什么要单独一步评估：空结果好判断，但「有条数但答非所问」才是真正的坑——比如问「加班餐补」命中了「差旅报销」，条数不为 0 但完全不能当依据。

### 7.5 Graph RAG

在 7.4 的基础上，意图对象增加 `graphQueries: string[]` 和 `allowGraph: boolean`，并把 `retrieve_graph` 作为与 `retrieve_knowledge` **并列**的工具挂上去。

进入循环后，两个工具**并行调用**，结果合并进上下文再生成：

```
Agent ─┬─▶ retrieve_knowledge（文本 + 向量混合检索）
       └─▶ retrieve_graph（graphQueries 拼 cypher → Neo4j → 实体/关系/文档）
                    │
                    └─▶ type: 'data-graph' 事件 → 前端 ECharts 力导图
```

`retrieve_graph` 返回 `{ query, entities, relations, documents, context, insufficient }`；当 entities 与 relations 都为空时置 `insufficient`。

图谱检索同样要做可见性过滤——只查「当前用户可见文档抽出来的图」，过滤条件写在 cypher 里，比 ES filter 复杂。

---

## 八、鉴权与可见性

### 8.1 三层守卫

三层都是 `APP_GUARD` 全局注册，按注册顺序**串行短路**：

```
请求 → JwtAuthGuard → RolesGuard → PermissionsGuard → Controller
        │               │              │
        │ 401           │ 403          │ 403
```

| 守卫 | 判定 | 短路条件 |
|---|---|---|
| `JwtAuthGuard` | 有 `@Public()` 直接放行；否则验签 | token 缺失/无效/过期 → 401 |
| `RolesGuard` | 无 `@Roles()` 跳过；有则比对 | 角色**命中任一**即可（`some`） |
| `PermissionsGuard` | 无 `@RequirePermission()` 跳过；Admin 直接放行 | 普通用户需**包含全部**所需权限（`every`） |

作者特意强调的口径：**角色用 `some`、权限用 `every`**。

### 8.2 RBAC 数据模型

```
用户 ──N:N── kh_user_role ──N:N── 角色 ──N:N── kh_role_permission ──N:N── 权限
  │                                                                        ▲
  └────────────────── kh_user_permission（直赋权限，绕过角色）─────────────┘

最终权限 = 角色权限 ∪ 直赋权限（去重合并）
```

`kh_permission` 有个 `permission_type`：**1 菜单 / 2 按钮 / 3 接口**。无论哪种，判断依据都是 `permission_code`；`menu_url`、`api_url` 只是用来说明「这个权限是什么」，不参与判定。

### 8.3 数据级可见性

接口级鉴权回答「你能不能调这个接口」，数据级过滤回答「这条数据你能不能看到」。后者必须下沉到存储查询里，**在召回阶段就过滤**，不能先查出来再内存 filter。

三个条件「或」关系，命中任一即可见：

1. `isPublic = true`（公开）
2. `authorId = 当前 userId`（自己写的）
3. `teamId ∈ 用户所在团队列表`（团队可见）

ES 侧（`kh_chunk` snake_case / `kh_document` camelCase，两个索引字段命名不同）：

```json
{
  "bool": {
    "should": [
      { "term": { "is_public": true } },
      { "term": { "author_id": "<userId>" } },
      { "terms": { "team_id": ["<teamId1>", "<teamId2>"] } }
    ],
    "minimum_should_match": 1
  }
}
```

SQL 侧：

```sql
author_id = :me
OR (status = 1 AND is_public = true)
OR (status = 1 AND team_id IN (:myTeamIds))
```

管理员/审核员走 `unrestricted` 分支，不加过滤。

一个实现细节：过滤函数**不判断 status**，而是假定「未发布的不会进索引」——这个假定能成立，靠的正是第四节的「只有 Published 才写索引」。

---

## 九、记忆

### 9.1 短期记忆：Redis 滑动窗口

- Key：`kh:chat:{userId}:{sessionId}:messages`
- 内容：最近约 **20 条** user / assistant 原文
- TTL：**24 小时**
- Miss 时从 PostgreSQL 取最近 N 条（通常 20–50）回填 Redis

这是标准的 cache-aside：缓存不是数据源，丢了只影响性能不影响正确性。

### 9.2 长期记忆：Mem0 双层

| 层 | 标识 | 存什么 | 生命周期 |
|---|---|---|---|
| 用户层 | `user_id` | 身份、岗位、团队、回答偏好、长期约束 | 长期保留 |
| 会话层 | `user_id` + `run_id = sessionId` | 当前任务、进度、待办 | 随会话删除 |

**存的是抽取出来的「事实」，不是聊天原文**。写入是异步的：一轮问答结束后由分类器判断是否值得沉淀、归到哪一层。分类器明确**不写**：寒暄、助手根据文档说出的制度内容、网络搜索结果——「知识库内容不能当成用户画像」。

副作用：刚写完整立刻追问，可能暂时搜不到（异步尚未落库）。

删除会话只清会话层，用户层记忆保留。

### 9.3 一轮问答的完整顺序

```
① 加载短期窗口（Redis Hit / Miss → PG 回填）
② 改写 query（把「那个/这个」替换成具体指代，生成独立 query）
③ 并行：知识库检索 ∥ Mem0 Search
④ Agent 组装上下文：用户画像 + 会话记忆 + 最近几轮 + 本轮检索资料 + 当前原问题
⑤ 流式回答
⑥ 写 PostgreSQL → 回写 Redis
⑦ 异步分类器 → 写入 Mem0
```

注意第 ④ 步：上下文里放的是**当前原问题**，不是改写后的 query。改写结果只用来检索，不污染对话本身。

---

## 十、可观测与评测

### 10.1 Tracing

两条上报通路并存：

- **自动**：OpenTelemetry `NodeSDK` + `LangFuseSpanProcessor`，LangChain 的 Runnable 调用自动生成 span；
- **手工**：`startActiveObservation` 包裹非 Runnable 的调用（embedding / rerank），因为拿不到 callbacks。

为什么混用两套：`Embeddings` 不是 Runnable，CallbackHandler 覆盖不到，只能用 OTel 手工包一层。这是「能力边界决定实现方式」，不是随意混搭。

trace 树形如：

```
agentic-rag (session)
 └─ ModelCallLimitMiddleware.before_model
     └─ ChatOpenAI (generation)
         └─ tools
             ├─ retrieve_knowledge
             └─ retrieve_graph
```

### 10.2 离线评测

```
pingpuao_eval.jsonl（id / question / expect_answer / retriev_docs / metadata）
        │
        ▼
LangFuse Dataset → experiment.run({ data, task, evaluators, maxConcurrency: 2 })
        │
        ▼
task 调用线上同一个 Agent（一次 invoke，不落会话、不写记忆）
        │
        ▼
Evaluator 计算 → metric_name: score → LangFuse 上报 → 看板
```

指标分两层：

- **检索层**（客观，依赖标注）：Recall@K / Precision@K / MRR / Hit@K
- **生成层**（需 LLM as Judge 或人工复核）：Faithfulness / Answer Relevancy / Answer Completeness / Context Utilization

公式类指标本地算，语义类走 LLM 打分——全交给 Judge 成本高且不稳定，全用公式又覆盖不了语义质量。

评测入口与线上入口必须分开：线上走 SSE，评测只需要一次性返回，且**不能写会话历史和记忆**，否则会污染评测集与用户画像。

---

## 十一、设计稿与代码的不一致处

核对后发现以下几处，**正文一律以代码为准**，设计稿仅作背景：

| # | 不一致点 | 设计稿/简历口径 | 实际实现 | 采用 |
|---|---|---|---|---|
| 1 | 向量库 | PGVector、Milvus | ES `kh_chunk` 的 `dense_vector` 字段 | ES |
| 2 | 对象存储 | MinIO | RustFS，bucket `knowledge-hub` | RustFS |
| 3 | 解析服务 | 简历写「FastAPI 微服务」 | NestJS 的 `FileParserService` | NestJS |
| 4 | 图片描述 | 简历写「VLM 生成描述 + MinIO」 | 只做到「images 传 OSS + 替换 md 链接」 | 仅替换链接 |
| 5 | 消息队列命名 | `kh.document.exchange` | `search.index.exchange` | 代码常量 |
| 6 | MongoDB 集合 | `document_content` | 初始化脚本建的是 `kh_document` / `kh_chunk` | 以代码为准 |
| 7 | 用户表方言 | 「MySQL（用户表）」 | PostgreSQL `init-scripts/postgresql/init.sql` | PostgreSQL |
| 8 | 问答接口 | `/ai/chat` 同步 | 后新增 `/ai/chat/stream` | 两者并存 |
| 9 | 多轮对话 | 早期只构造一条 `HumanMessage` | 后补上短期记忆 | 补充后才成立 |
| 10 | 图谱进 RAG | 早期「尚未接入」 | 后加入 `retrieve_graph` 工具 | 加入后成立 |

> 第 6 项存疑：设计稿的存储结构图写 `document_content`，同一份设计稿里的初始化脚本建的是 `kh_document` / `kh_chunk`。代码里 `src/document/schemas/document-content.schema.ts` 是 `document_content`，所以**以代码为准**。

---

## 十二、数据模型速查

### PostgreSQL 主要表

| 表 | 作用 | 关键字段 |
|---|---|---|
| `kh_document` | 文档元数据 | `content_id` → Mongo、`status`、`is_public`、`team_id`、`author_id` |
| `kh_document_version` | 版本（追加写） | `document_id` + `version` 唯一 |
| `kh_document_review` | 审核流水 | `review_result` NULL = 待办 |
| `kh_document_share` | 分享 | `token`、`require_password`、`password_hash`、`revoked` |
| `kh_category` | 分类树 | `parent_id` 自关联 |
| `kh_comment` / `kh_document_like` / 收藏表 | 互动 | — |
| `kh_message` | 站内通知 | 5 类消息 |
| `kh_user` | 用户 | `email_verified`、`status`、软删除 |
| `kh_role` / `kh_permission` | RBAC 定义 | `role_code` / `permission_code` |
| `kh_user_role` / `kh_role_permission` / `kh_user_permission` | 关联 | — |
| `kh_team` / `kh_team_member` | 组织架构 | `parent_id`、`leader_id` |
| `kh_ai_session` / `kh_ai_message` | 会话与消息 | `sources JSONB`，外键 `ON DELETE CASCADE` |

### MongoDB

- `document_content`：`_id` / `documentId` / `content`(Markdown) / `contentLength` / `version`

### Elasticsearch

- `kh_chunk`：`chunk_id` / `document_id` / `content`(ik) / `heading` / `chunk_index` / `category_id` / `author_id` / `team_id` / `doc_status` / `embedding`(dense_vector 1024 cosine)
- `kh_document`：整篇文档快照，文档级关键词检索

### Neo4j

- `KnowledgeDocument` -`HAS_CHUNK`→ `DocumentChunk` -`MENTIONS`→ `KnowledgeEntity` -`RELATED_TO`→ `KnowledgeEntity`

---

## 十三、设计取舍清单（面试/复盘可直接用）

| 决策 | 选择 | 关键理由 |
|---|---|---|
| 正文存哪 | MongoDB 而非 PG text | 列表查询不拖入大字段 IO |
| 向量库 | ES 内置 dense_vector | 少一个组件，少一套一致性负担 |
| 融合方式 | RRF 而非加权求和 | BM25 与 cosine 量纲不可比 |
| 精排 | cross-encoder 而非向量相似度 | 同时看到 query 和文档，做匹配判断 |
| 索引构建 | MQ 异步而非同步 | 分块+嵌入+抽取几十秒，同步必超时 |
| 队列拆分 | 一条链路一个交换机 | 故障隔离、可单独重放与限流 |
| 失败处理 | 不自动重试 + 显式 reindex | 外部依赖故障时长不可预测 |
| 状态模型 | 四态枚举而非布尔组合 | 3 个布尔就有 8 种组合，多数非法 |
| 可见性过滤位置 | 召回阶段（ES filter / SQL where） | 先召回再过滤会浪费名额且分页统计出错 |
| 角色 vs 权限 | 角色 `some`、权限 `every` | 角色是粗分类，权限是能力集合 |
| 记忆分层 | Redis 短期 + Mem0 长期 | 「本次聊了什么」和「这个用户是谁」策略不同 |
| 评测入口 | 与线上分离 | 评测不能写会话历史和记忆 |
| 解析器 | 本地 + MinerU 双轨 | 轻格式快且免费，复杂格式交给专用服务 |

---

## 十四、可核验线索

- 代码路径（后端 `knowledge-hub-backend/src/`）：
  - `mq/mq.constants.ts:9-26` — 三组交换机与 routing key
  - `document/document-status.ts` — 四态与迁移判定
  - `document/parser/file-parser.service.ts` — 扩展名分派
  - `pipeline/chunking.service.ts` / `embedding.service.ts` / `vector-index.service.ts` — RAG 链路
  - `ai/hybrid-retrieval.service.ts:38-88` — 混合检索与降级
  - `ai/ai-stream.service.ts` — SSE 流式与 Agent 工具
  - `ai/agentic-retrieve.ts` — Agentic / Graph RAG 检索工具
  - `auth/*.guard.ts` — 三层守卫
  - `document/document-access.ts` — 可见性过滤
  - `observability/langfuse.ts` — OTel 上报
