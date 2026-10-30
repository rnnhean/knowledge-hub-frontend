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

## 技术选型（每个位置上的候选池，以及为什么留下的不是别的）

> 选型分三步：① 先定约束——内网单实例、无专职运维、AI 链路是重头、一个人能维护；② 把每个位置的候选池按**语言生态 / 运维成本 / 心智负担**划开；③ 选在这个约束下代价最小的那个。下面每行都写清淘汰了谁、为什么淘汰。

| 层 | 选了 | 被淘汰的候选，以及为什么 |
| --- | --- | --- |
| **后端与数据层** | | |
| 后端语言与框架 | Node 20 + NestJS 11 | **同语言**：Express / Fastify 更轻，但分层、DI、Guard、参数校验都要自己拼，鉴权链会散落在各个 handler。**Java**（Spring Boot + Spring AI）是企业里最主流的写法，事务与权限生态最成熟，但 JVM 内存与冷启动对单机内网不友好，Spring AI 尚在早期；**Python**（FastAPI + LangChain）在 RAG 上生态第一，但前后端无法共享类型，同一套契约要用 Zod 和 Pydantic 各写一遍；**Go**（Gin / Echo）部署最省、并发最好，可 Agent 编排、SSE、结构化输出全得手搓；**C# / .NET**（Semantic Kernel）与 **Rust**（Axum）在开发效率或 AI 生态上更差 |
| 向量 + 关键词检索 | ES `dense_vector`（与 BM25 同索引） | **pgvector** 省一个组件，但中文全文检索要靠 zhparser / pg_jieba 另行编译，两路查询和权限过滤要写两遍；**Weaviate / Qdrant / Milvus** 都自带 hybrid（稀疏 + dense），但中文分词不敌 ES 的 IK，且权限过滤要在第二套 DSL 里再实现一次；**Chroma / FAISS** 属原型工具，缺持久化与过滤；**Redis Stack** 全内存、成本高；**MongoDB Atlas Vector Search** 自建版不提供 |
| 正文存储 | MongoDB `document_content` | **PostgreSQL TEXT / JSONB** 少一个组件，但正文是数百 KB 级 Markdown，和 19 张元数据表挤在一个实例会让列表页、备份、连接池都变重；**存对象存储（RustFS）** 成本最低，但缺按块查询与前缀匹配；**直接塞进 ES** 会让 `_source` 膨胀、内存被打爆 |
| 知识图谱 | Neo4j | **NebulaGraph** 更适合十亿级，但要独立集群 + 学 nGQL；**ArangoDB** 多模但生态小；**JanusGraph** 要配 HBase / Cassandra，运维过重；**关系表递归 CTE** 只能到 2～3 跳且不可读；**ES 存关系** 只能一跳，多跳要在应用层拼；**RDF 三元组库**（Jena）建模与查询成本更高 |
| 消息队列 | RabbitMQ | **Kafka** 吞吐与回放更强，但延迟高、组件重，本项目的 QPS 用不上；**RocketMQ** 国内主流、事务消息强，运维组件更多；**NATS** 轻量但持久化与重试弱；**BullMQ / Redis Streams** 零新增组件，可索引任务的重试会堵住缓存实例；**同步直调**最简单，但任一路索引失败就会让上传整体失败 |
| **AI 编排与评测** | | |
| Agent 编排 | LangChain v1 `createAgent` | **LangGraph** 的状态图、断点恢复、人工介入是给多 Agent 用的，单 Agent 引它等于给直线套一层状态机；**LlamaIndex Workflows** 事件驱动更灵活，但工具与中间件生态不如 LangChain；**Dify / Coze / FastGPT** 低代码上手最快，可权限体系、索引链路、SSE 协议都得绕过平台重做；**Mastra / OpenAI Agents SDK** 更轻，但摘要压缩、调用上限、data stream 全要自己补；**Spring AI / LangChain4j** 绑死 JVM；**完全手写 tool loop** 最可控，代价是中间件与流式协议全自研 |
| 记忆层 | Redis 热窗口 + PostgreSQL 会话 + Mem0 | **Zep（Graphiti）** 做时序知识图谱记忆更先进，但要再引入一套图存储；**LangMem** 与框架耦合过深；**只做 PostgreSQL 会话** 最简单，但每轮都要全量读历史，首 token 延迟随会话长度线性上升；**干脆不做记忆、全靠长上下文** 在 128K 窗口下成立，但成本按 token 线性涨、跨会话不连续 |
| 检索评测 | 自建金标 + 9 个 evaluator | **RAGAS** 开箱、指标全，但都是通用指标（faithfulness / answer relevancy），覆盖不了本项目的工具策略、拒答质量、false_hit、mustNotContain；**DeepEval** 是 pytest 风格、断言能力强，仍缺业务判据；**TruLens / Phoenix / Langfuse** 偏观测追踪，评测只是附属；**纯人工** 无法回归 |
| 检索融合 | RRF（k=60）+ rerank | **加权分数相加** 要先做量纲归一，BM25 与 cosine 不可比，权重只能靠反复调参；**学习型稀疏（SPLADE / ColBERT）** 效果更好但要 GPU 与训练；**GraphRAG（微软）** 全局摘要强，建索引成本是数量级差距；**HyDE** 能补语义鸿沟，但每次检索多一次 LLM 调用 |
| **前端与文档** | | |
| 前端框架与构建 | React 19 + Vite 8（纯 CSR） | **Vue 3 + Element Plus** 上手快，但 AI SDK 的 `useChat` / `@ai-sdk/react` 只对 React 成熟；**Svelte** 更轻、生态小；**Angular** 对单页后台过重；**Next.js / Remix（SSR / RSC）** 内网后台没有 SEO 与首屏指标，SSR 是纯负担；构建上 **Webpack** 慢，**Rspack / Turbopack** 更快但插件生态还在补 |
| UI 组件库 | Ant Design 6 | **MUI** 是 Material 风格，表格与表单能力弱于 AntD；**shadcn/ui** 自由度高但要自己维护样式与交互；**Element Plus / Naive UI** 绑 Vue；**Tailwind + 自研组件** 对 19 个页面是负债 |
| 前端数据层 | 手写 `useEffect` + `AbortController` | **TanStack Query** 有缓存、去重、重试、乐观更新，是这个规模**本该选**的方案——没选是前期低估了页面数；**SWR** 更轻但同样要补；**RTK Query** 要求引入 Redux 全家桶；AI SDK 的 `useChat` 已接管问答流，但表格类页面用不上它 |
| 文档解析 | MinerU | **LlamaParse** 版式与表格很强，但按页计费、内容要出内网；**Unstructured.io** 通用性好、表格与公式弱；**Docling（IBM）** 开源、版面模型不错，但中文扫描件弱于 MinerU；**Azure Document Intelligence** 效果最好、成本与出网风险最高；**PyMuPDF / pdfplumber** 只能拿文本流，版面与表格要自己拼；**Tika** 只做文本抽取；**本地四个解析器**（pdf-parse / docx / pptx / xlsx）已写好，但复杂版面会崩，只能当兜底 |

## 被认真否掉的几条路线

这几条是面试最容易追问的，答案不是「不好」，而是「**在这个约束下它的代价更高**」。

1. **Java（Spring Boot + Spring AI）** —— 最像「正经企业级」的选项：事务、权限、审计、多模块工程化都比 NestJS 成熟，招人也容易。真正的卡点是**部署形态**：内网单机、运维只靠我一个人，JVM 常驻内存和冷启动直接把机器的余量吃掉；而且 Spring AI 的 Agent 抽象与流式协议成熟度落后 LangChain / AI SDK 一到两个版本，等于用更重的栈换更少的能力。
2. **Python（FastAPI + LangChain）** —— 在 RAG 这件事上，Python 的生态是真的更强：切分、rerank、评测工具全都是一等公民。但代价是**前后端割裂**：接口契约、枚举、错误码要在 Pydantic 和 TypeScript 里各维护一份，改一次字段两边都动；前端本来就只能选 JS，后端再换语言，一个人维护两套类型系统是我承受不起的负担。
3. **低代码平台（Dify / Coze / FastGPT）** —— 三四天就能做出一个能问答的 RAG，演示效果甚至更好。这条值得认真对待，所以否掉它的不是「不好用」，而是**六个具体的错位**：
   - **权限下推不了**：可见性是「公开 / 团队 / 作者 + 9 个权限码」的组合，且必须在 BM25 与 kNN 两路召回时就过滤，不能召回后再筛。平台的 metadata filter 能表达一部分，但过滤条件要业务侧每次自己拼，权限变更后还要再同步一遍平台索引——等于维护两套权限逻辑，两套迟早不一致。
   - **Agent 循环不是画出来的图**：模型自己决定查几次、何时改写、查空了转 web 搜索，外加摘要压缩（12 轮 → 6 轮）与调用上限（8 次）。平台是节点编排，这几个中间件控制点没有对等物。
   - **流式事件拿不到**：前端 token 流里混着 8 种 data part（status / think / sources / retrieve / intent / eval / graph / session），用户要看到「命中了哪 5 段、意图是什么」。平台只给最终文本和几个粗粒度事件。
   - **评测判不了**：9 个 evaluator 里的 tool_policy、false_hit、rewrite_loop 判的是**内部 trace**（调了哪些工具、召回了什么），不是最终答案。
   - **一致性要双写**：19 张业务表在自建 PG，平台有自己的库；文档删除、转公开、换团队都得双写，且没有跨库事务。
   - **运维反而更重**：已经跑了 7 个中间件，上平台再加 web + api + worker + 它自己的 db / redis / 向量库。
   
   **什么时候该选平台**：没有权限体系、不需要自定义流式 UI、不需要按内部 trace 做评测——这时自己写才是浪费。这个项目六条刚好全反着。
4. **只用 pgvector** —— 一个 PostgreSQL 就能同时拿元数据、权限、向量，运维面最小。放弃它是因为**关键词这一路绕不开**：型号、故障码、制度编号这类精确词必须靠 BM25 兜，而 PG 的中文全文检索要另装分词扩展、且与向量查询是两套 SQL，权限条件要写两遍——省下的运维成本，会以「两套过滤逻辑迟早不一致」的形式还回来。
5. **不做记忆层，靠长上下文** —— 上下文窗口动辄 128K，看起来三层记忆是过度设计。但内网走的是按 token 计费的 API，全量历史每轮都重发，长会话的成本是线性增长；而且跨会话、跨设备的连续性是产品需求，不是技术偏好。所以最终做成三层：Redis 热窗口控住每轮 token，PostgreSQL 兜持久化，Mem0 抽长期偏好。

**用法**：面试官问「为什么用 X」时，别只讲 X 的好处，要答**在这个约束下 X 的代价最小**，并且能说出被淘汰方案的**具体问题**——只说「因为快 / 因为生态好」是背书，说不出淘汰理由才是没选过。

## 项目规模

| 维度 | 实测 |
| --- | --- |
| 后端 | 146 个 TS 文件 / 14,829 行 / 14 个 Controller / 100 个 HTTP 接口 |
| 前端 | 6,031 行 TS/TSX / 19 个页面（6 个管理端）/ 7 个公共组件 |
| 数据模型 | PostgreSQL 19 张表 / 19 个实体，ES 2 个索引，Neo4j 3 类节点 + 3 类关系 |
| 基础设施 | docker-compose 11 个服务（PG / Mongo / Redis / RabbitMQ / ES / Neo4j / RustFS 等） |

## 数据建模

19 张表按域切三块，**全部手写 DDL，不让 ORM 自动同步**。

| 域 | 表 | 关键设计 |
| --- | --- | --- |
| 文档域 | `kh_document` / `kh_document_review` / `kh_document_version` / `kh_category` / `kh_comment` / `kh_document_like` / `kh_document_favorite` / `kh_document_share` / `kh_notification` | **正文不在这**：`kh_document.content_id` 指向 MongoDB `document_content` 的 `_id`，主表只留元数据；`view_count / like_count / comment_count / favourite_count` 冗余在主表，列表页不做聚合；审核记录一次提交一行，`review_result` 非空即出待办 |
| 权限域 | `kh_user` / `kh_role` / `kh_user_role` / `kh_permission` / `kh_role_permission` / `kh_user_permission` / `kh_team` / `kh_team_member` | 权限是 `parent_id` 自关联的树，`permission_type` 区分菜单 / 按钮 / 接口三档，接口档带 `api_url + method`；`kh_user_permission` 支持在角色之外单独给某个人授权 |
| AI 域 | `kh_ai_session` / `kh_ai_message` | 会话与消息分表，按 `session_id` 建索引，长会话分页加载 |

**建表方式**：一个手写文件 —— `knowledge-hub-backend/init-scripts/postgresql/init.sql`，340 行 DDL + 权限菜单种子数据，挂到 Postgres 官方的 `/docker-entrypoint-initdb.d` 目录，**只有数据卷为空时**（首次初始化）自动执行；种子用 `INSERT ... ON CONFLICT (id) DO NOTHING` 保证幂等。应用侧 `synchronize: false`，19 个 `*.entity.ts` 只做「类字段 ↔ 表字段」映射，不建表也不改表。

**为什么这么做**：表结构要能被 review、能进 diff。`synchronize: true` 开发期方便，但改列名会变成一次悄悄的 `DROP COLUMN`，等发现时数据已经没了。

**代价（面试要主动说）**：没有 migration 体系，增量改表（如 v21 加字段）是手写 SQL 手动执行，schema 没有版本号——这是这套方案最实在的债。

**ID 与审计**：主键统一雪花算法（`src/common/snowflake-id.ts`），库内 `BIGINT`、传输用 `STRING`（超出 JS 安全整数范围）；业务表统一带 `created_at / updated_at / create_by / update_by / deleted`，删除一律软删。其余存储的初始化各不相同：MongoDB 用 `init-scripts/mongodb/init.js` 建集合与唯一索引；Elasticsearch 的两个索引（`kh_document`、`kh_chunk`）是**代码启动时**「存在则跳过、不存在才建」；Neo4j 没有 DDL，节点靠 `MERGE` 幂等创建。

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

1. **为什么检索索引和主库分开**：元数据与权限在 PostgreSQL，正文在 MongoDB，检索在 ES——三者的写入代价和失败影响面不同，用 MQ 解耦，任一路索引任务失败都不影响文档本身发布成功。
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
