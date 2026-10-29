# 项目经历：企业知识库 RAG 智能问答系统（从 0 到 1 全栈）

> 说明：文中所有数字均为对仓库代码的实测统计（文件行数、装饰器计数、检索参数默认值），不是估算。

## 一句话

从 0 到 1 独立完成一套企业知识库：文档上传 → 解析 → 审核 → 发布 → 异步建索引（向量 / 全文 / 知识图谱）→ Agent 自助检索问答 → 离线评测闭环。
**全栈**：React 19 前端 19 个页面，NestJS 11 后端 100 个接口；其中 AI 检索链路（混合检索 + RRF 融合 + rerank + 查询改写 + 拒答）与 Agent 工具编排由我设计实现。

## 技术栈

- **前端**：React 19.2 · TypeScript 6.0 · Vite 8.2 · Ant Design 6.6 · React Router 7.18 · ECharts 6.1
- **AI 交互**：`ai` 7.0 + `@ai-sdk/react` 4.0（`useChat` 流式） · `react-markdown` 10.1（GFM / 数学公式 / 代码）
- **后端**：NestJS 11 · TypeScript · TypeORM
- **存储**：PostgreSQL（19 表） · MongoDB（正文与元数据分离） · Elasticsearch（IK 中文分词 + dense_vector） · Neo4j（知识图谱） · Redis（会话热窗口 / 验证码） · RabbitMQ（索引异步化） · RustFS（S3 兼容对象存储）
- **AI 能力**：LangChain v1 `createAgent` · DashScope 向量（text-embedding-v3，1024 维）与 rerank（qwen3-rerank） · Mem0 长期记忆
- **可观测 / 评测**：Langfuse + OpenTelemetry · 自建金标集与 9 个 evaluator

## 项目规模

| 维度 | 实测 |
| --- | --- |
| 后端 | 146 个 TS 文件 / 14,829 行 / 14 个 Controller / 100 个 HTTP 接口 |
| 前端 | 6,031 行 TS/TSX / 19 个页面（6 个管理端）/ 7 个公共组件 |
| 数据模型 | PostgreSQL 19 张表 / 19 个实体，ES 2 个索引，Neo4j 3 类节点 + 3 类关系 |
| 基础设施 | docker-compose 11 个服务（PG / Mongo / Redis / RabbitMQ / ES / Neo4j / RustFS 等） |

## 核心工作

### 1. 从 0 到 1 搭起文档生产管线（问题：15 种格式怎么写进库里，才不会让检索和权限互相打架）

- **解析**：上传接口同步解析，`txt/md` 本地直读，其余 14 种格式（PDF / Office / 图片）接 MinerU 做 OCR 与版面还原；解析结果里的图片逐张转存对象存储并把 Markdown 相对路径替换为 URL。
- **切分**：`RecursiveCharacterTextSplitter`，512 token / 64 token overlap，按 Markdown 标题层级递归；做了 **heading 继承**——块内无标题行时自动前缀上一级标题，避免「这条规定属于哪一章」在检索时丢失。chunkId 用 `sha256(documentId:index)` 保证幂等重跑。
- **异步化**：发布/归档事件通过 RabbitMQ 投递到 3 个队列（RAG 重建、全文索引、图谱重建），消息体只带文档 ID 不塞正文；仅修改可见性时走快路径，只刷新三条索引的权限字段而不重算向量，避免全量重跑。
- **存储分工**：元数据进 PostgreSQL，正文（Markdown）进 MongoDB，两者用 `content_id` 关联；向量块进 ES `kh_chunk`（dense_vector 1024 维 cosine），整篇检索进 ES `kh_document`。

### 2. 混合检索：两路召回 + RRF + rerank（问题：单靠向量，型号、故障码这类精确词召不回）

- ES 内并行跑两路：**BM25**（`ik_smart` 分词，标题权重 ×2）+ **kNN 向量**（`num_candidates = max(k*10, 50)`）。
- 用 **RRF（k=60）** 融合两路排名，融合时保留 `bm25Score` / `vectorScore` 便于排障；候选 20 条，再经 DashScope rerank 精排，分数低于 **0.4** 直接丢弃，最终取 top5。
- 每一级都有降级：向量化失败退回纯关键词；rerank 失败回退 RRF 结果；整个检索不可用时明确告知而不是硬编。

### 3. Agent：让模型自己决定查几次、怎么改写（问题：一查就空就编，反复重查又烧钱）

- 用 LangChain v1 `createAgent` 编排 **4 个工具**：`retrieve_knowledge`（带切题评估）、`rewrite_query`、`retrieve_graph`（图谱实体检索）、`web_search`（联网兜底）；工具按意图动态挂载，闲聊类问题不挂检索，避免无意义调用。
- 前置一次结构化输出同时完成 **意图识别（5 类）+ 问题改写 + 图谱查询词生成**，temperature 0、15s 超时，失败默认按 kb 处理。
- 硬性收敛：单轮 `retrieve_knowledge` 最多 2 次（第 3 次直接返回 insufficient 让模型转向），模型调用上限 8 次，上下文超 12 条自动摘要压缩到 6 条。
- **三层记忆**：Redis 热窗口（TTL 1 天 / 20 条）→ PostgreSQL 会话持久化 → Mem0 长期记忆；写入长期记忆前让 LLM 判断该写用户层、会话层还是都不写，并明确禁止把制度条文存入记忆（否则会绕开知识库、答出过期版本）。
- **拒答是设计的一部分**：检索为空或切题评估不过时要求模型回答「知识库里没有」，金标集里专门有 2 条空库用例校验这一点。

### 4. 权限贯穿到检索层（问题：接口挡住了，但问答把私有文档念出来）

- RBAC 三层：用户 → 角色 → 权限码，另有用户直授权；全局 Guard 链 JWT → Roles → Permissions；9 个运行时权限码。
- 可见性规则统一收敛到一个文件，并**下推到每条数据通道**：ES 查询用 `bool.should`（公开 / 作者 / 所属团队）、Neo4j 用 Cypher 条件、列表与详情用 TS 判断、AI 检索复用同一份规则——避免「接口挡住了但问答把私有文档念出来」这类越权。
- 文档分享：12 位随机 token + 可选 bcrypt 密码 + 过期时间 + 吊销，访问时二次校验文档仍为已发布状态。

### 5. 前端：19 个页面，从登录到知识图谱（问题：流式回答只有一段文字，用户不知道答案从哪来）

- **流式对话**：`useChat` + `DefaultChatTransport` 对接 `/api/ai/chat/stream`，在文本流之外自定义 **8 种 data part**（status / think / sources / retrieve / intent / eval / graph / session），把「正在检索 → 改写问题 → 命中 3 篇 → 引用了哪一段」的过程可视化，而不是只吐一段答案。
- **认证**：localStorage 存双 token，401 时**单飞刷新**——并发请求共享同一次 refresh，成功只重试一次，失败统一跳登录，杜绝刷新风暴。
- **知识图谱**：ECharts `graph` / force 布局，5 类节点着色、3 类边、节点大小按度数映射，点击联动详情与「当前节点」高亮，支持导出 PNG。
- **文档生命周期**：上传、分类筛选、审核、发布、归档、下架编辑六步状态机，操作按钮由当前状态推导，从 UI 层杜绝非法流转。
- **管理端**：用户 / 角色 / 权限 / 团队 / 通知广播，共 6 个管理页面。

### 6. 可观测与离线评测（问题：答错了，说不清是解析、召回还是生成的问题）

- Langfuse + OTel 接入，手动埋 5 个命名 span（意图识别、切题评估、改写、检索、整轮对话），trace 带上 userId / sessionId 便于定位单次答错。
- 自建 **9 条金标用例 / 5 个 suite / 9 个 evaluator**（意图匹配、工具策略、改写循环、拒答质量、hit@5、precision@5、false_hit、完整性、groundedness），其中 4 个走 LLM judge。
- 评测跑的是**线上同一个 Agent**（不走另一套简化链路），但不建会话、不写记忆，保证测的就是用户实际用的东西。
- 实测（kb-hit suite，3 条）：**hit@5 = 1.000、precision@5 = 0.889、intent_match = 1.000、tool_policy = 1.000、groundedness = 1.000**（样本量小，仅作回归基线用）。

## 技术决策（面试可展开的取舍）

1. **为什么不用一套索引**：全文、向量、图谱的更新代价和查询语义不同，分开建索引、用 MQ 解耦，任一路失败不影响文档发布本身。
2. **为什么 RRF 而不是加权分数相加**：BM25 与 cosine 分数量纲不可比，加权需要反复调参；RRF 只用排名，跨 query 更稳。
3. **为什么检索次数要硬上限**：Agent 会陷入「再查一次说不定有」的循环，2 次上限 + 改写后才允许重查，是从成本和延迟倒推的约束。
4. **为什么拒答要单独评测**：RAG 最危险的失败不是答不出，而是答得流畅但没有出处；golden 集里 mustNotContain 字段专门防「张冠李戴」。
5. **为什么权限下推到检索层**：只在接口层鉴权，等于假设 AI 链路可信；实际检索结果是拼进 prompt 的，必须在这一层就过滤。

## 已知短板（⚠️ 这一节是给你面试自述用的，投递版本请整节删除）

- 自动化测试薄弱：后端 `src` 下 0 个单测，仅 1 个脚手架 e2e；质量主要靠离线评测集兜。
- 前端未做路由级 code splitting，未引入虚拟滚动，长列表性能未优化。
- 4 个本地格式解析器（pdf/docx/pptx/xlsx）写好但未接入链路，当前统一走 MinerU。
- 评测集只有 9 条，样本量不足以谈准确率，只能做回归。

## 待补充（发出去前请你确认）

- 起止时间、投入时长、是否为团队项目（几人）
- 是否可写「已在公司内部试用 / 有 N 位用户」——若没有，保持「个人从 0 到 1 项目」表述
- 是否附 GitHub 地址或演示环境
