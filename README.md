# knowledge-hub-frontend

`knowledge-hub-backend` 的管理端 / 使用端前端：React 19 + Vite 8 + Ant Design 6 + TypeScript，对接知识库的文档管理、全文检索、RAG 智能问答、知识图谱与权限审核体系。

## 技术栈

| 层 | 选型 |
|---|---|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 8 |
| UI | Ant Design 6 |
| 路由 | React Router |
| 可视化 | 知识图谱力导向图（可拖拽 / 缩放 / 导出 PNG） |
| 流式 | SSE（`fetch` + ReadableStream 逐块渲染） |
| 代码检查 | oxlint |

## 功能演示

以下动图按真实操作流程录制（1280×800，均为本地全栈运行时的实际画面）。演示用的制度文档见 [docs/samples/](docs/samples/)，均为虚构示例数据。

### 1. 登录

账号密码登录，签发 access / refresh token，前端持久化后自动续期。

![登录](docs/demo/login.gif)

### 2. 文档管理

文档列表 → 详情预览。文档有草稿 / 待审核 / 已发布 / 已归档四种状态；发布后异步构建索引，列表支持按标题、分类、状态过滤。

![文档管理](docs/demo/documents.gif)

删除文档：详情页删除需二次确认，删除后回到列表，列表不再出现该文档。

![删除文档](docs/demo/doc-delete.gif)

编辑正文：Markdown 编辑后保存，正文变更会写成新版本。

![编辑文档](docs/demo/doc-edit.gif)

历史版本：每次保存或发布留存一版，可回滚到任意历史版本（回滚会生成一条新版本）。

![版本回滚](docs/demo/doc-versions.gif)

评论与回复：详情页可发表评论，支持对评论回复，评论会带出作者与时间。

![评论回复](docs/demo/comment.gif)

### 3. 新建文档

Markdown 正文编辑，可选分类、标签、公开范围和所属团队，保存后进入详情页，可继续发布（开启审核时转入待审）。

![新建文档](docs/demo/doc-create.gif)

### 4. 上传解析

上传 PDF / Word，后端调用解析链路抽取正文生成草稿，并自动跳转到新文档详情；随后可点赞、收藏，收藏内容在「我的收藏」里汇总。

![上传解析](docs/demo/doc-upload.gif)

### 5. 全文检索

关键词检索走后端混合召回（BM25 + 向量 kNN），RRF 融合后重排，结果按相关度排序并高亮命中片段。

![全文检索](docs/demo/search.gif)

### 6. RAG 智能问答

流式输出答案，正文里的 `[1] [2]` 是可点击的引用溯源，落到具体文档与片段；答案下方附本次召回的资料列表。

检索侧是 Agentic 流程：query 改写 → 混合召回 → RRF 融合 → 重排 → 切题评估（不切题则带反馈重试）。

![RAG 智能问答](docs/demo/chat.gif)

### 7. 知识图谱

文档发布后异步抽取实体与关系入库，前端做力导向可视化，支持按关键词与节点类型检索、拖拽缩放、导出 PNG。

![知识图谱](docs/demo/graph.gif)

![图谱检索](docs/demo/graph-search.gif)

### 8. 用户与角色

管理员新建账号：填用户名 / 密码 / 姓名 / 邮箱并分配角色，创建后立即生效（默认角色「普通用户」）；列表支持重置密码、调整角色。

![新建用户](docs/demo/user-create.gif)

重置密码与分配角色：管理员可直接重置指定用户密码，并为其增减角色（立即生效）。

![重置密码与分配角色](docs/demo/user-admin.gif)

### 9. 审核工作台

文档发布后进入待审队列，审核人通过 / 驳回并填写意见；通过后触发索引重建，可在「已通过」页签回看结果。

![审核](docs/demo/review.gif)

驳回流程：选择驳回后必须填写意见，提交后进入「已驳回」页签，意见一并留存。

![驳回](docs/demo/review-reject.gif)

### 10. 系统管理

角色权限、团队管理、分类管理，以及给全员或指定用户发送站内通知。

![系统管理](docs/demo/admin-pages.gif)

角色 / 团队 / 分类的新增与编辑：新建角色（名称 + 编码）、新建团队（名称 + 编码）、新建分类后再编辑名称与说明。

![角色团队分类增改](docs/demo/admin-crud.gif)

角色权限：按权限树勾选后保存，角色拥有的功能点即时生效。

![角色权限](docs/demo/admin-perm.gif)

团队成员：按用户名搜索添加成员，成员列表可移除。

![团队成员](docs/demo/team-member.gif)

### 11. 个人中心与通知

查看个人资料与所在团队，修改姓名 / 邮箱与密码；站内通知支持未读角标与一键已读。

![个人中心与通知](docs/demo/profile.gif)

修改密码：校验原密码后更新（演示中先改为临时密码再改回，最终仍为原密码）。

![修改密码](docs/demo/password.gif)

通知已读：未读通知带角标，一键「全部已读」后角标消失。

![通知已读](docs/demo/notify-read.gif)

### 12. 免登录分享

给已发布文档生成带访问密码、带有效期的分享链接，对方未登录也能通过 `/share/:code` 阅读正文。

![免登录分享](docs/demo/share.gif)

撤销分享：分享被撤销后，同一链接立即失效，访问提示「分享链接不存在或已关闭」。

![撤销分享](docs/demo/share-revoke.gif)

### 13. 全链路观测（Langfuse）

每次问答的完整 trace 会上报到 Langfuse：可以看到 LangGraph 编排的每一层 span（意图分类 → 检索与切题评估 → 生成），以及改写后的 query、召回文档标题、评估结论与各阶段耗时。

![Langfuse 链路追踪](docs/demo/langfuse.gif)

## 示例数据

[docs/samples/](docs/samples/) 是演示时上传的 6 份虚构制度文档（差旅报销、生产发布、信息安全、供应商采购、客户数据分级、请假考勤），不涉及任何真实公司信息。按「上传解析」上传即可复现上面的检索与问答效果。

## 本地运行

后端先起在 `http://localhost:3000`。

```bash
pnpm install
pnpm dev
```

浏览器打开 `http://localhost:5173`。开发时 `/api` 会代理到 3000。

预置账号：`user` / `123456`（文档与检索），`admin` / `123456`（系统管理），`reviewer` / `123456`（审核）。

新增账号有两种方式：管理员在「用户管理」里新建；或直接调后端 `POST /auth/register`（后端已实现，支持可选的邮箱激活，`REQUIRE_EMAIL_VERIFICATION=true` 时生效，默认关闭）。前端目前没有注册 / 忘记密码页面。

## 已对接接口

- 登录 / 资料 / 改密（access + refresh token）
- 文档列表、新建、编辑、发布、归档、下架、删除、上传解析、版本、评论、点赞、收藏
- 全文搜索 `POST /search`
- RAG 问答 `POST /ai/chat`（SSE 流式）、仅检索 `POST /rag/search`
- 图谱检索 / 实体 / 关系
- 用户、角色权限、团队、分类、站内通知、审核工作台
- 分享链接创建 / 撤销、免登录访问
