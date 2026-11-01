# 企业级知识库 · RAG 智能问答系统

> 本文档分两部分:
> **Part 1 项目介绍**(门面,可发给面试官 / 贴简历)
> **Part 2 技术问答清单**(个人备考底稿,带代码行号,面试前自己背)
> 两部分同一口径,核心都围绕四个工程判断:**引用溯源、可见性下推、评估量化、上下文与记忆分层**。

---
---

# Part 1 · 项目介绍

> 一个面向企业内部制度/文档的知识中台:上传文档即可自动解析、建立多路索引,支持全文检索、带引用溯源的 RAG 智能问答,以及知识图谱探索。覆盖文档全生命周期管理、RBAC 权限与数据可见性控制。

---

## 一、项目背景(解决什么问题)

企业内部有大量制度文档(差旅报销、发布流程、信息安全规范……),员工查阅靠"翻文件 / 问同事",低效且容易拿到过期版本。本项目做的是一个**能听懂人话、答案可溯源、权限可控**的知识库:

- 员工用自然语言提问 → 系统检索相关制度 → 生成答案并**标注引用来源**(哪篇文档的哪一段)。
- 答案严格基于检索到的内容,检索不到就拒答,**不编造**。
- 不同角色/团队看到的文档范围不同,**检索结果自动按权限过滤**。

---

## 二、技术栈

**后端**:NestJS 11 + TypeScript
**前端**:React 19 + Vite + Ant Design 6
**数据与中间件**(7 种,事件驱动协作):

| 组件 | 用途 |
|---|---|
| PostgreSQL | 业务关系数据(用户/权限/文档元数据/会话) |
| MongoDB | 文档正文与解析产物 |
| Elasticsearch 8.17 | 全文检索(IK 中文分词)+ 向量检索(`dense_vector` kNN) |
| Neo4j | 知识图谱(实体/关系) |
| Redis | 缓存 + 对话短期记忆热窗口 |
| RabbitMQ | 文档发布后异步建索引管线 |
| RustFS(S3 兼容) | 原文件 / PDF 抽图对象存储 |

**AI 能力**:通义千问(`qwen-plus` 对话与实体抽取、`text-embedding-v3` 向量、`qwen3-rerank` 重排)、LangChain、Vercel AI SDK(流式)、Mem0(长期记忆)、Langfuse(链路追踪 + 评测)。

---

## 三、核心功能

**文档管理**:多格式上传解析(PDF / DOCX / PPTX / XLSX,含 MinerU 精准解析扫描件)→ Markdown;草稿/发布/归档/审核四状态流转;版本历史与回滚;分类;点赞、收藏、评论、分享链接(带密码+有效期)。

**检索与问答**(核心):
- 全文检索:ES + IK 分词,关键词高亮。
- RAG 问答:混合检索(关键词+向量)→ RRF 融合 → rerank 重排 → 引用溯源;Agentic 自主检索(模型自行决定检不检、要不要改写再检);SSE 流式输出;追问指代消解。
- 对话记忆:PostgreSQL 全量落库 + Redis 短期热窗口 + Mem0 长期语义记忆三层;窗口失效从库无缝重建,记忆只补上下文、不作事实来源。

**知识图谱**:文档实体/关系自动抽取入 Neo4j,支持图谱检索与可视化。

**权限与协作**:JWT 鉴权、RBAC(用户-角色-权限三层)、文档数据可见性控制、团队、站内通知。

---

## 四、架构与开发流程

**事件驱动的异步管线**是整个系统的骨架:

```
上传 → 解析成 Markdown → 发布
                          ↓ (RabbitMQ 并行三路)
        ┌─────────────┬─────────────┬─────────────┐
     向量索引       全文索引       知识图谱
   (ES dense_vector) (ES IK分词)  (LLM抽实体→Neo4j)
        └─────────────┴─────────────┴─────────────┘
                          ↓
              混合检索 → rerank → RAG 问答(引用溯源)
```

发布文档不是同步建完索引才返回,而是往 MQ 投递消息、由消费者异步处理——三路索引耗时差异大(全文秒级、图谱分钟级),拆开独立队列互不阻塞。

**开发流程**:采用迭代式开发,共 21 个版本递进,遵循"数据流优先"——先打通「解析 → 索引 → 检索 → 问答」的核心管线,再逐层叠加审核、鉴权/RBAC、可见性控制、社交互动、对话记忆、评估体系等能力。

---

## 五、技术亮点

> 以下三点是本项目区别于"常规 RAG 教程实现"的核心设计——**引用溯源、可见性下推、评估量化**(第六章),体现的不是"用了什么框架",而是"针对 RAG 的真实问题做了哪些工程判断"。

**1. 引用溯源:让答案可核验、杜绝"一本正经地编造"**
RAG 最大的风险是模型把检索内容和自己的"记忆"混在一起、生成看似合理实则虚构的答案,用户无从分辨。本项目的解法:给每个检索块编号,Prompt 强制模型"依据某条必须标注 `[1][2]`、不得编造来源标题",生成后用正则抽出编号映射回真实文档块,对越界编号做过滤。这样每句答案都能点开看到出处,**答案从"你信不信我"变成"你自己核验"**。(诚实边界:这是 prompt 约束 + 编号校验,非逐句强校验,是可继续加固的点。)

**2. 文档可见性"一次定义,下推三存储"**
企业知识库里"谁能看到哪篇文档"是硬性安全要求,而 RAG 有三条检索链路(全文/向量在 ES、图谱在 Neo4j、元数据在 PG),若每条各写一套权限判断,极易不一致、出现越权泄露。本项目把"公开 ∪ 所在团队 ∪ 自己创建"的可见规则抽象成一个 `scope` 对象,翻译成 **ES filter 子句 / Neo4j Cypher where / PG SQL 条件**,统一下推到三条链路、源头一致。且权限条件放 filter 而非 must——**既过滤无权文档,又不污染相关性打分**。

**3. 混合检索 + RRF 融合 + 重排**
关键词(BM25)与向量(kNN)并行召回,用 RRF(`score=Σ1/(C+rank)`)融合——因为两种分数量纲不同不能直接加权,RRF 只用排名天然归一;再经 `qwen3-rerank` 精排 + 阈值过滤。rerank 不可用时自动回退 RRF 结果,不阻断问答。

**4. Agentic 自主检索**
把检索、改写、图谱查询、联网搜索封装成工具(tool),由模型自主决策调用;配合"检索次数上限 + 模型调用轮数上限 + 超长对话自动摘要"防止失控。

**5. 可降级设计**
ES / Neo4j / Mem0 / Langfuse 均为弱依赖——不可用时静默跳过,不影响核心问答。强依赖(PG/Mongo)与弱依赖边界清晰。

**6. 上下文工程:检索只拼切题块 + 记忆三层正交**
常规 RAG 把召回全部塞进上下文让模型自己筛,本项目先评估切题再进上下文,并用 `invokeIsolated` 隔离内部模型调用防止结构化 JSON 混进正文。记忆分三层——PG 全量真源 / Redis 定长热窗口 / Mem0 语义事实——Redis 挂了读库无缝重建,Mem0 写入前有 LLM 分类器判层 + 只抽用户原话 + 硬禁制度条文三道闸门,防止知识库内容污染用户画像。详见第五节第九节。

---

## 六、质量保障:RAG 评估体系

RAG 系统的质量不在"代码对不对",而在"检索准不准、答得对不对"——本项目构建了**可量化的评估体系**(多数同类项目缺失的一环):

- **接真实链路**:评估直接调用线上同一个流式 Agent,非 mock。
- **检索层指标**(确定性):`hit@5`、`precision@5`、`false_hit`(库空题误检)。
- **生成层指标**(LLM-as-judge):`groundedness` 忠实度(答案是否超出检索内容编造)、`completeness` 要点覆盖、`refusal_quality` 拒答质量。
- **路由/护栏指标**:意图识别、工具调用策略、改写死循环检测。
- **支持消融实验**:rerank、RRF 参数、检索 topK 等均为开关,可对比"开/关 rerank"等配置对指标的影响,用数据验证每个组件的价值。
- **链路追踪**:集成 Langfuse,可视化每次问答的检索/生成全过程。

> 现状说明:评估框架与指标体系已完成,标注测试集正在从初始规模扩充至数十条,以产出统计上可信的对比数据。

---

## 七、项目规模

- 后端 14 个控制器、约 100 个 API 接口,按领域模块化拆分。
- 7 种中间件事件驱动协作,Docker Compose 一键编排。
- 21 个版本迭代开发。
- 前端 13 个功能页面,统一请求层(自动鉴权 + token 刷新)。

---
---

# Part 2 · 技术问答清单(个人备考底稿)

> 基于项目真实代码整理(带 `文件:行号`,面试时能翻到就不虚)。
> 核心原则:**每个技术点都知道"怎么实现的 + 弱点在哪 + 被追问怎么答"**。弱点主动说,比被挖出来强。

## 🎯 主动引导:把面试官往这三个"工程判断"上带

和 Part 1 同一口径。别等面试官问,主动抛这三点——它们是你区别于"跟着教程做一遍"的地方:

1. **引用溯源**(见下文第五节)——为什么做:RAG 最大风险是编造,溯源让答案可核验。
2. **文档可见性下推三存储**(第十二节)——一个 scope 翻译成 ES filter / Neo4j Cypher / PG 条件,源头统一不越权。
3. **eval 量化 + 消融**(第六/十四节 + Part 1 第六章)——用数据证明 rerank/混合检索的价值,多数同类项目没有这一环。

展开讲透这三个,其余技术点作为"被追问时接得住"的储备。

**第四点可选(被问记忆/上下文时抛)**:上下文与记忆分层(第九节)——PG 真源 + Redis 热窗口 + Mem0 语义事实三层正交,Mem0 写入有 LLM 分类器闸门防止知识库内容污染用户画像。

---

## ⚠️ 先记住这几条"别讲错"的真相(对着代码会露馅)

1. **向量不存 pgvector,存在 Elasticsearch 的 `dense_vector`**(kNN cosine)。装了 pgvector 镜像,但 RAG 向量检索实际走 ES。别说"用 pgvector 做向量检索"。
2. **没有"本地哈希向量降级"**。embedding 无 key 直接抛错(`embedding.service.ts:41-45`),KG 抽取无 key 也抛错。`.env` 注释里"不配 key 用哈希"是旧说法,代码没实现。
3. **流式问答才是真 Agent**(langchain `createAgent` + 工具 + 轮数限制);非流式 `ai-chat.service.ts` 走固定"查→评→改写再查一次"循环,**不是真 Agent**。两者别讲混。
4. **MQ 失败直接丢弃**:`nack(requeue=false)`,无重试、无死信队列(DLQ)、无真幂等(靠"先删后建"重建)。这是真实短板,主动说。

---

## 一、RAG 混合检索(项目核心,面试必问)

**一句话**:BM25 关键词 + kNN 向量**并行召回** → 按 chunkId 做 **RRF 融合** → **rerank 精排** → 阈值过滤。

**实现细节**
- 并行召回:`Promise.all([keywordSearch, knnSearch])`,各取 `hybridTopK=20`(`vector-index.service.ts:283-288`)。
- 关键词:ES `multi_match`,字段 `document_title^2 + content`,`ik_smart` 分词(`:198-204`)。
- 向量:ES `dense_vector` cosine,`num_candidates=max(k*10,50)`(`:242-247`)。
- RRF 公式 `score(d)=Σ 1/(C+rank+1)`,C 默认 60(`RAG_RRF_C`)(`:325-359`)。
- rerank:DashScope `qwen3-rerank` 打分,`RAG_MIN_SCORE=0.4` 过滤后再 slice topK(`reranker.service.ts` + `hybrid:53-57`)。

**问答对**
- Q:为什么用 RRF 不用加权分数相加?
  A:BM25 分和 cosine 分**量纲不同、不可直接加权**;RRF 只用排名,天然归一,C 控制高排名的平滑度。
- Q:关键词和向量命中同一个块怎么办?
  A:用 Map 按 chunkId 合并,两路 RRF 分相加,等于双路命中加权(`:339-351`)。
- Q:rerank 挂了会怎样?
  A:返回 null,直接用 RRF 粗排结果,不阻断问答(`reranker:59-96`)。**降级设计**。

---

## 二、Agentic 自主检索

**一句话**:用 langchain `createAgent` 把"检索/图谱/联网/改写"做成 **tool**,模型自己决定调哪个、调几次(仅流式)。

**实现细节**
- 四个 tool:`retrieve_knowledge`/`rewrite_query`/`retrieve_graph`/`web_search`(`ai-stream.service.ts:176-361`)。
- **硬约束(不是纯自主)**:检索工具内 `retrieveCount>=2` 拒绝(`:180`);`modelCallLimitMiddleware({runLimit:8})` 封顶轮数(`:375`);消息超 12 条 `summarizationMiddleware` 自动摘要(`:368`)。

**问答对**
- Q:怎么防止模型无限检索?
  A:双保险——工具内计数器限两次检索 + 中间件限 8 轮模型调用,超了强制结束。
- Q:Agentic 和普通 RAG 区别?
  A:普通 RAG 固定"检索一次→生成";Agentic 让模型按需决定要不要检、要不要改写再检、要不要查图谱/联网。**但注意:非流式接口是固定循环,不是真 Agent,只有流式是。**

---

## 三、流式问答(SSE)

**一句话**:Vercel AI SDK `createUIMessageStream` + `@ai-sdk/langchain`,把 LangChain Agent 流转成 UI Message 协议推给前端。

- `pipeUIMessageStreamToResponse` 推送(`ai-stream.service.ts:472,624`)。
- 自定义 `data-*` 事件(intent/eval/graph/sources/status)推过程条(`:60-92`)。
- `streamMode:['messages','tools']` 同时流 token 和工具调用(`:562`)。
- **诚实点**:不是裸手写 SSE,是 SDK 封装的 UI Message 流。

---

## 四、检索改写 / 指代消解

**一句话**:追问时消解"这个/他"等指代,首轮检索不切题时换问法再查。

- 入口 `classify`:一次 LLM 调用同时做**意图路由(5类)+ 生成 standalone_query + 图谱实体名**,`withStructuredOutput`+zod(`chat-query-rewrite.service.ts:85-98,219`)。
- 不足改写 `rewriteAfterRetrieve`:换一句≠上次的词再查(`:311`)。
- 降级:意图识别失败 fallback 到 `kb`(宁可多检索);改写失败回退原问题;`distinctQuery` 保证不重复、返回空则停(`:386`)。

**问答对**
- Q:改写失败会不会死循环?
  A:`distinctQuery` 返回空则停,且整体受"两次检索上限"约束,不会无限。

---

## 五、引用溯源(可追问的弱点,想好怎么答)

**一句话**:prompt 要求模型在句末标 `[1][2]`,再用正则抽编号映射回源块。

- `buildContext` 给每块编号 `[i] 标题\n正文`(`ai-chat.service.ts:377`);prompt 强制"依据某条必须标编号、不得编造标题"(`:402-405`)。
- `toCitedSources`:正则 `/\[(\d+)\]/g` 抽编号 → 映射到 hits(`:347`)。

**问答对**
- Q:模型标了不存在的编号怎么办?
  A:范围过滤,只保留 `1~N` 内的,越界丢弃(`:354-355`)。
- Q(弱点):这个溯源可靠吗?
  A:**诚实说**——靠 prompt 约束不是强校验,模型可能标错;且未标注时回退"全部召回块"当来源,可能虚高。要做强,得对答案句子和块做相似度校验。

---

## 六、异步处理管线(MQ + 三路索引)

**一句话**:文档发布 → 并行投 3 条 MQ 消息 → 消费 → 编排 → 向量/全文/图谱三路独立建索引。

**数据流**
`afterPublish` 用 `Promise.all` 并行投三消息(`document-pipeline.publisher.ts:35-41`)→ 3 个 topic 交换机/队列 → `DocumentPipelineConsumer` 三 handler(`:31-37`)→ `PipelineOrchestrator` 回查 PG 元数据+Mongo 正文(`:200-213`)→ 分头做 RAG/Search/KG。

**关键点**
- **为什么异步**:建索引含 embedding、逐块调 LLM 抽实体,单篇几十秒~分钟,同步会阻塞发布请求。
- **为什么拆三条消息**:三路耗时差异大(ES 写秒级,KG 分钟级),拆开独立队列互不阻塞,KG 慢不拖累搜索可用。
- **消息体极简**:`{taskId, type, documentId(s)}`,**只传 ID 不传正文**,消费者回查库(避免 MQ 塞大正文)。
- 拓扑:3 个 topic 交换机 + 3 个 `kh.` 前缀队列,durable + persistent(`rabbitmq.service.ts:159,172-193`)。

**问答对(弱点,主动说)**
- Q:消费失败怎么处理?
  A:**诚实说**——目前 `nack(msg,false,false)` 直接丢弃,**无重试、无 DLQ**(`rabbitmq.service.ts:209`)。改进方向:加死信队列 + 重试次数上限 + 告警。
- Q:重复消费会不会重复建索引?
  A:靠"先删后建"(`deleteByDocId` / graph clear)做**重建式幂等**,不是真幂等(没有去重表/版本号)。

---

## 七、文档切块 & Embedding

- 切块:LangChain `RecursiveCharacterTextSplitter`,Markdown 感知分隔符;`RAG_CHUNK_SIZE=512` token、`OVERLAP=64` token,按 `CHARS_PER_TOKEN=2` 换算(`chunking.service.ts:36-60`)。亮点:跨块继承标题、chunkId=sha256(docId:index)。
- Embedding:LangChain `OpenAIEmbeddings` → DashScope `text-embedding-v3`,1024 维,batchSize 钳死 ≤10(DashScope 上限)(`embedding.service.ts:24-35`)。

---

## 八、三路索引落地 + 可降级

- **向量**:ES `kh_chunk`,`dense_vector` dims=1024 cosine,bulk 写(`vector-index.service.ts:148-170`)。
- **全文**:ES `kh_document` 整篇一条,IK 分词(写 `ik_max_word`/查 `ik_smart`),title^3/summary^2/content 加权 + 高亮(`search-index.service.ts:184-217`)。
- **图谱**:逐 chunk 调 qwen-plus `withStructuredOutput`(zod)抽实体关系,Cypher `MERGE` 写 Neo4j,模型 `(Document)-[:HAS_CHUNK]->(Chunk)-[:MENTIONS]->(Entity)-[:RELATED_TO]->(Entity)`(`graph-build.service.ts:116-277`)。
- **可降级实现**:每个服务构造时读 `XXX_ENABLED` + `onModuleInit` try 连接,连不上把 client 置 null;读写方法开头 `if (!client) { warn; return }`,**降级=静默跳过不抛错**,不阻断 MQ 消费。

---

## 九、上下文与对话记忆(三层存储 + 两层压缩)

**一句话**:上下文分**本轮**和**跨轮**两条线。本轮上下文由 Agent 循环动态组装(检索到什么就拼什么),不靠"把整段历史塞进去";跨轮记忆分三层——**PG 全量原文 / Redis 定长热窗口 / Mem0 语义事实**,三者正交,容量、时效、精度各不相同。

### 9.1 本轮上下文:Agent 编排而非静态拼接

上下文不是一次性拼好的字符串,而是每轮由 Agent 按意图动态生产:

1. **意图分类**(`chat-query-rewrite.service.ts:219`)——`classify()` 一次结构化输出给出 `intent`(5 类)+ `standalone_query`(消解指代后的独立查询)+ `graph_queries`(图谱短实体名)。这三样共同决定了本轮"允许用哪些工具、用什么词查"。
2. **按意图挂工具**(`ai-stream.service.ts:176-361`)——`allowRetrieve/allowGraph/allowWeb` 三个开关决定挂哪几个 tool。闲聊和个人偏好**一个检索工具都不挂**,从源头杜绝"答谢谢却回知识库没有"。
3. **检索结果装填**——知识库只把**切题**的块编号成 `[n] 标题\n正文` 写进 tool 返回值;不切题时返回 `insufficient: true` 而不是把噪声塞进去。
4. **最终 messages 顺序**:`systemPrompt(意图约束) → [Mem0 记忆 SystemMessage] → history(Redis 窗口) → HumanMessage(本轮问题)`(`ai-stream.service.ts:554-559`,非流式见 `ai-chat.service.ts:278-286`)。

**关键取舍**:检索**只拼切题的块**,评估不通过的块连上下文都不进。常规 RAG 是"先拼进去让模型自己判断",本项目是"先判切题再进上下文"——用一次额外的 LLM 调用换上下文纯净度,避免模型被噪声误导。

**一个实现坑(能讲)**:工具内部再调用模型(评估器、改写器)时,若不清空 callbacks,结构化 JSON 会顺着 `streamMode: ['messages']` 混进回答正文。解法是 `invokeIsolated()` 用 `AsyncLocalStorageProviderSingleton.runWithConfig` 把 callbacks 换成空数组并打 `kh-internal` tag(`chat-query-rewrite.service.ts:17-27`),跑完自动恢复。

### 9.2 短期记忆:Redis 热窗口 + PG 真源回填

**不是"Redis 存短期、PG 存长期",而是同一份数据两个视图。**

| 层 | 存什么 | 容量/生命周期 | 角色 |
|---|---|---|---|
| PostgreSQL `kh_ai_message` | user/assistant 原文 + `sources` jsonb | 永久,删会话才删 | **真源**,不丢 |
| Redis `kh:chat:{userId}:{sessionId}:messages` | 只存 human/ai 原文 | TTL 86400s,窗口 20 条 | **加速层**,挂了不丢数据 |

- 读路径 `loadWorkingHistory`(`ai-stream.service.ts:627-643`):Redis 命中直接返回 → miss **或 Redis 抛异常** → `listRecentMessages` 从 PG 倒序取 20 条再 reverse → 回写 Redis。Redis 故障是**降级不是失败**。
- 写路径 `onFinish`:先 `sessions.appendTurn` 落 PG,再 `shortMemory.appendTurn` 把 `[...history, 新问, 新答]` 整体 `slice(-20)` **覆盖写** Redis(`chat-short-memory.service.ts:63`)——窗口靠整段覆盖滚动,不是 append。
- **只存 human/ai 原文**:检索资料、思考过程、Mem0 注入的 SystemMessage 全部排在窗口外(`isWorkingMessage` 过滤,`chat-memory.util.ts:24`)。否则库里条文会挤占窗口、还污染下一轮改写。

**真正边界是"最近 20 条 ≈ 10 轮"**,和 TTL 无关——TTL 只是缓存寿命,过期了从 PG 无缝重建。

### 9.3 长期记忆:Mem0 双写 + LLM 分类器闸门

长期记忆不是"把对话存起来",而是**先判该不该记、记到哪一层,再去重写入**。

**写入三道闸门**(`chat-long-memory.service.ts:163-207`):
1. **分类器判层**——qwen-plus + zod 结构化输出 `write_user` / `write_session` / `reason`。user 层存身份、岗位、回答偏好、长期约束(跨会话);session 层存本轮任务、进度、临时约定(当前会话)。
2. **只从用户原话抽取**——`extractFrom = [{ role: 'user', content: question }]`,助手回答只在 `slice(0, 300)` 后给分类器"看上下文",**永不进 Mem0**。
3. **customInstructions 硬禁止**——"不要保存制度条文、流程、时限、负责人、系统名、引用编号"。

这三道闸门针对的是同一个风险:**知识库事实污染用户画像**。没有它们,LLM 会把检索到的"李明负责发布窗口"当成用户记忆写进 user 层,下次换会话还在,事实来源就乱了。

**读取**(`search()`):用当前问题的向量召回 user 层 topK=5 + session 层 topK=5,`buildSystemMessage` 拼成一条 SystemMessage,尾巴强制加"以上仅作背景,制度以本轮检索资料为准"(`,:158-160`)。

**session 层为什么需要**:窗口挤掉第 21 轮之后原文就没了,但 session 记忆靠向量召回能把"这次只看住宿上限"这种任务约束捞回来。**窗口是"固定保证最近",session 记忆是"模糊召回较远"**,互补而非重复。

**清理**:删会话时 `shortMemory.clear` + `longMemory.clearSession`(Mem0 `deleteAll { userId, runId }`),user 层不动(`chat-session.service.ts:67-74`)。

### 9.4 两层压缩:窗口截断 + Agent 内摘要

`ai-stream.service.ts:368` 的 `summarizationMiddleware({ trigger: { messages: 12 }, keep: { messages: 6 } })` 在 Agent 内部做摘要——超过 12 条消息就把早期部分压成一段中文摘要,保留最近 6 条。摘要 prompt 明确要求"话题、已确认结论、待办,**不要写入知识库条文**"。

这是第二层压缩:第一层是 Redis 按条数截断(20 条),第二层是 Agent 内按语义摘要(12 条触发)。两者作用域不同,前者跨轮持久,后者只在单次 stream 内有效。

### 问答对

- Q:短期记忆和长期记忆什么关系?为什么不用一个?
  A:**正交,不是缓存关系**。短期要**逐字原文**保多轮连贯(指代"这个""他"要靠原话消解);长期要**抽成事实**换个说法也能召回,而且跨会话。原文存不下(窗口有限)、事实存不下(太长)、语义事实又替代不了原文(改写器需要原句),所以必须两层。
- Q:Redis 挂了怎么办?
  A:**读库回填**。窗口在 PG 有全量真源,miss 或异常就 `listRecentMessages` 取最近 20 条重建,用户无感。Redis 在这里是纯加速层。
- Q:为什么要单独存 session 层记忆,不是有短期窗口了吗?
  A:窗口是**定长截断**,第 21 轮开始最早的内容就没了。session 记忆靠语义召回,能把几轮前"这次只看住宿"这种任务约束捞回来。一个是"固定保证最近",一个是"模糊召回较远"。
- Q:怎么防止记忆把知识库内容当成用户画像写进去?
  A:**三道闸门**:① 分类器先判该不该写、写哪层;② 只从用户原话抽取,助手回答不进 Mem0;③ customInstructions 硬禁止保存制度条文/负责人/引用编号。测试清单里有专门的用例验这条(`chat-memory.md` 第 3 节)。
- Q:上下文怎么控制长度?
  A:两层——**窗口按条数截断**(20 条,超了最早的丢)+ **Agent 内按语义摘要**(超 12 条压成摘要,保留 6 条)。外加检索只拼切题块,不把所有召回都塞进去。

**弱点(诚实,主动说)**
1. **两套压缩互不知情**:Agent 内的摘要**不落盘**,只在单次 stream 内有效;下一轮又从 20 条原文重新开始。等于摘要的收益一轮之后就归零——真省 token 得把 summary 存回 Redis/PG。
2. **窗口按条数不按 token**:20 条短问答可能才 2k token,20 条带制度引用的长回答可能直接顶穿。没有 token 预算裁剪。
3. **同会话并发无保护**:`appendTurn` 是"读 history → 拼 → 覆盖写",两个并发请求互相覆盖。前端一次只发一条没暴露,API 层无锁。
4. **Mem0 写入 fire-and-forget**:流式路径 `void this.longMemory.rememberTurn(...)` 不 await(`ai-stream.service.ts:613`),进程在分类+写入完成前重启就丢。测试文档让"等 30 秒"就是在等这个异步窗口。
5. **流式与非流式召回 query 不一致**:流式用原始 `question`、非流式用改写后的 `plan.query`(`ai-chat.service.ts:148`)。后者更准,前者更忠实原话,小差异但会体现在评测对比里。
6. **未配 `MEM0_API_KEY` 时静默降级**,`enabled=false` 全线跳过,用户侧没有任何"我不记得你的偏好"的提示——可观测性缺口。

---

## 十、JWT 鉴权

**一句话**:Passport-JWT 双 token,全局 `JwtAuthGuard` 默认拦截,`@Public` 放行登录类。

- access 2h / refresh 7d,payload 带 `type` 字段(`auth.service.ts:42-89`)。
- **防混用**:`JwtStrategy.validate` 拒绝 `type!=='access'`,refresh 接口只认 `type==='refresh'`(`jwt.strategy.ts:27`)。

**问答对(弱点)**
- Q:怎么登出 / token 失效?
  A:**诚实说**——目前无服务端吊销(无黑名单/无 refresh 轮换),登出仅前端删 token,旧 token 有效期内仍可用。改进:Redis 黑名单或 refresh 轮换。

---

## 十一、RBAC 权限

**一句话**:用户-角色-权限三层,**用户直接权限 ∪ 角色权限**(Set 去重),admin 短路放行。

- 三张关联表:`user_role`、`role_permission`、`user_permission`。
- 合并逻辑(`permission.service.ts:209-252`):两条 join SQL 查直接权限 + 角色权限,`Set` 并集;含 admin 角色则追加操作权限全集。
- 两级守卫(JWT→Roles→Permissions):`@Roles` 校角色、`@RequirePermission` 校权限码,admin 直接放行。
- **性能点**:权限在登录 `buildAuthUser` 时算好塞进 token,请求时守卫只读内存不查库。

---

## 十二、文档可见性贯穿检索(面试加分项,讲透)

**一句话**:可见规则 = **公开 ∪ 所在团队 ∪ 自己写的**(admin/reviewer 不限),同一个 scope 对象翻译成 **ES filter / Neo4j Cypher where / PG 条件**,下推到三条检索链路。

- scope 来自 AuthUser:`{unrestricted, userId, teamIds}`,teamIds 在登录时查好塞进 token(`document-access.ts:13-21`)。
- 内存判定 `canReadDocument`:admin/reviewer→true;作者→true;非 Published→false;isPublic→true;否则看 teamId 是否在用户团队内(`:23-32`)。
- **三种翻译**:ES `esVisibilityFilter` 生成 `bool.should` 放 **filter 上下文**(`:59-74`);Neo4j `neo4jDocumentAccessWhere` 拼 Cypher(`:90-104`);PG 拼 SQL 条件。

**问答对**
- Q:RAG 检索怎么保证用户看不到无权文档?
  A:**不在应用层查完再过滤,而是把可见性下推到各存储**——ES 作 filter 子句、Neo4j 作 Cypher where、PG 作 SQL 条件,三者共用同一个 `DocumentAccessScope`,源头统一不走样。
- Q:为什么放 filter 不放 must?
  A:权限是硬条件、**不该参与相关性打分**,放 filter 既过滤又不污染 BM25/向量得分。
- Q(弱点):可见性正确性依赖什么?
  A:依赖"发布才进索引、下架即清索引"这个管线不变量,查询层不判 status。若管线失败导致索引脏数据,可见性会出问题。

---

## 十三、文档四状态流转 + 审核

- 四状态:`Draft / Published / Archived / PendingReview`,流转规则是纯函数(`document-status.ts:35-66`)。
- 审核开关 `DOCUMENT_REQUIRE_APPROVAL`(默认 true):submit→PendingReview,approve→Published + 重投索引,reject→回 Draft(驳回意见必填)(`document-review.service.ts`)。
- 幂等:同文档同时只允许一条待审记录。

**问答对(弱点)**
- Q:审核通过后索引失败怎么办?
  A:**诚实说**——当前 `safePublish` 只 catch+warn,**不重试不回滚**,状态与索引可能不一致。生产应补重试或对账任务。

---

## 十四、其他速答

- **密码**:bcryptjs 加盐哈希(cost 10),compare 常量时间比对,不存明文(`user.service.ts:165`)。
- **可观测**:Langfuse 全链路 tracing + 基于 golden dataset 的 RAG 自动评测(`observability/langfuse.ts`、`ai/eval/`)。
- **ID**:Snowflake 雪花 ID。

---

## 面试策略提醒

1. **主动暴露 6 个弱点**(无 DLQ / 无 token 吊销 / 溯源无强校验 / 索引失败不回滚 / 摘要不落盘 / 窗口按条数不按 token),显得你懂生产、不是只会跟课。
2. **讲透 2 个亮点**:文档可见性用一个 scope 下推到三存储(真有设计感);记忆分层 + 分类器闸门(防知识库污染用户画像,同类项目常踩坑)。
3. **别吹**:向量是 ES 不是 pgvector,非流式不是真 Agent,Mem0 是可选挂件。这些对着代码一问就穿,老实说反而加分。
4. **记忆这块别说过头**:窗口确实有 `summarizationMiddleware` 摘要,但摘要**不落盘**、一轮就失效——别讲成"已经做了超长会话压缩"。
