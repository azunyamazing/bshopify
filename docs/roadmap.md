# bshopify CLI 版本计划方案（Roadmap）

> 状态：待评审。`@bestfulfill/bshopify` 是团队内部的 **Shopify CLI 增强层**：统一接管 `shopify app/theme` 入口，
> 在真实 Shopify CLI（当前基准 4.7.0）执行前后编排 Extension Entry 注入、配置/环境注入、恢复、校验和提交防护。
> 本文按三期给出每期**具体实现什么**，每项都标注对应的 Shopify CLI 命令与其增强点。
> 当前版本：`0.1.0`（TS CLI MVP）。

---

## 0. 定位与增强原则

- **不重造轮子**：所有能力都以"包装/增强 `shopify xxx`"实现，底层执行仍走官方 CLI，保证平台行为一致。
- **团队价值点**：官方 CLI 是"单人单环境"视角；bshopify 加的是"多环境、多人、可追溯、可防护"的编排层。
- **每期闭环**：新增能力必须配套 校验（validate）→ 防护（guard）→ 恢复（restore）之一，不允许只有"注入没有恢复"。

---

## 1. 现状盘点（v0.1.x 已实现）

| 能力 | 对应 Shopify CLI | 说明 |
|-|-|-|
| CLI 骨架 / 降级透传 | 全部命令 | ESM+TS+commander+tsup；未接管命令透传 `shopify`，bin 提供 `bshopify`/`bs` |
| `app init` | `app init` 前置 | 生成 config、gitignore、pre-commit hook、`__entry.js`、manifest；`--check/--update/--cwd` |
| `app dev` | `app dev` | config 推导、entry 注入 + restore marker、锁、事务 journal、崩溃恢复 |
| `app deploy` | `app deploy` | 注入、占位符校验、确认流程、`--dry-run`、before/after/onError 钩子 |
| `app guard` | — | **仅命令占位（no-op）**，pre-commit hook 已写入但本体逻辑未实现 |
| Runner 架构 | — | app 域 context/injections/lock/transaction + extension 域 entries/entry-loader/manage/manage-stale/manage-content/context/paths 已模块化 |

**主要缺口**：guard 无真实逻辑；无 validate/restore/status 命令面；dev 不支持 watch；无 CI/发布流水线；无 env 管理；theme 域纯透传。

---

## 2. 版本规划总览

| 期 | 版本 | 主题 | 核心交付 |
|-|-|-|-|
| 第 1 期 | v0.2.x | **核心闭环** | guard 真实现、validate、restore、status、dev watch/build 接管、CI 发布 |
| 第 2 期 | v0.3.x | **多环境与协作** | env 管理、config 编排、部署链路（多 config/版本记录）、theme 域、doctor、git 感知 |
| 第 3 期 | v1.0.0 | **生产就绪** | create 一体化、logs/webhook/open 增强、hooks/插件体系、配置 Schema、兼容矩阵、文档站 |

---

## 3. 第 1 期：v0.2.x —— 核心闭环（可验证 / 可恢复 / 可防护）

**目标**：dev/deploy 能跑但"防护是空的、校验和恢复缺命令面、CI 用不了"。这一期把提交前防护、独立校验、手动恢复、项目体检做成闭环，并让 dev 贴近真实开发。

### 3.1 `app guard` 真实现（最高优先级，补 pre-commit 短板）

现状：init 已写入 pre-commit hook，但 `guard` 是 no-op，等于防护形同虚设。

- 检查点：
  - 注入值残留：restore marker（`bshopify-restore:*`）或已知注入 pattern 出现在受管文件
  - 锁文件：`.bshopify/extension-prepare.lock` 存在（dev/deploy 未正常退出）
  - 未解析占位符：`.liquid` 中残留 `__[A-Z0-9_]+__`
  - manifest 与磁盘不一致：受管文件被改/删
- 命令形态：`bshopify app guard`；`--json` 结构化输出（hook 与 CI 复用）；`--ignore <glob>` 白名单
- 联动：错误时退出码非 0 → pre-commit 拦截，输出"修复命令"提示（如 `bshopify app restore`）
- 增强点：官方 CLI 无任何提交防护概念，这是纯团队价值。

### 3.2 `app validate`（独立校验命令）

现状：校验逻辑散落在 dev/deploy 内部，无法单独运行，CI 无法当门禁。

- 校验内容：`bshopify.config.mjs` 合法性 → `configFiles` 指向的 TOML 存在且命名合规（复用现有校验）→ extension 目录与 `__entry.js` 存在且导出 `prepare` → 注入 plan 静态预演（pattern 在目标文件中唯一匹配、value 非空）
- 串联官方校验：校验通过后调用 `shopify app config validate`，一层管"团队编排层"、一层管"平台配置层"
- 命令形态：`bshopify app validate [--config <name>]`；`--json` 输出，CI 门禁直接消费

### 3.3 `app restore`（手动恢复，基于现有 journal）

现状：事务 journal 机制已存在（崩溃自动恢复），但没有命令面，用户无法手动干预。

- `bshopify app restore`：恢复最新事务；`--run-id <id>` 定位历史；`restore --list` 列出事务清单
- 幂等：重复执行无副作用；与 dev/deploy 自动恢复共用锁互斥
- 价值：解决"dev 被 kill 后残留注入值"的手动兜底，也是 guard 提示的修复入口

### 3.4 `app status`（项目体检）

- 对齐 `shopify app info` 风格：列出 configFiles 映射与各 TOML 解析结果、entries 清单、manifest、锁/journal 状态、本机 shopify CLI 版本
- 命令形态：`bshopify app status [--config <name>]`；`--json`
- 价值：新成员 onboarding 与排障第一步

### 3.5 `app dev` 增强

- `--no-inject`：只跑 `shopify app dev` 不注入（纯透传场景）
- `--json`：注入摘要结构化输出
- **watch 模式**：dev 运行期间监听 `__entry.js`/TOML 变更 → 重新注入（官方 dev 只 watch 应用源码，entry 层由 bshopify 联动）；这是多 extension 团队 dev 的日常刚需
- 信号处理：SIGINT/SIGTERM 下保证事务恢复（现有 finally 补信号路径）

### 3.6 `app build` 接管（CI 构建刚需）

- 注入 → `shopify app build` → 恢复，与 dev 同一套 transaction
- 命令形态：`bshopify app build [--config production]`（CI 用 production 配置产出带正确 entry 的构建物）
- 增强点：官方 build 不会注入 entry，团队 CI 直接跑 `shopify app build` 产物缺 entry

### 3.7 工程化底座

- 统一退出码/错误分类；`--verbose` 调试日志
- GitHub Actions：typecheck / test / build / verify / smoke + 云仓 publish 流水线
- 测试加固：guard / validate / restore / transaction 回放测试

**验收**：`npm run check` 全绿；guard 在注入残留/锁/占位符三类场景下正确拦截；`bshopify app validate --json` 可在 CI 当门禁；dev watch 在 entry 变更时重新注入；CI 自动发布 0.2.x。

---

## 4. 第 2 期：v0.3.x —— 多环境与团队协作

**目标**：单项目单环境跑通后，解决"多环境变量、config 切换、可追溯部署、店铺侧主题、环境体检"。

### 4.1 env 管理（对齐 `shopify app env pull/show`）

官方 v4 只有 `env pull` / `env show`，且是单 config 视角；bshopify 做成**多 config 版本化**：

- `bshopify env pull --config <name>`：调用 `shopify app env pull` 并写入 `.env.<name>`（补 gitignore：`.env.*`）
- `bshopify env push --config <name>`：官方无 push，实现为"从 `.env.<name>` 生成注入值"，注入到 Extension env（扩展 `extensionEnv`）
- `bshopify env show --config <name>`：脱敏输出（secret 打码）
- 注入合并：dev/deploy 时自动合并 `.env.<name>` 与 TOML 推导的上下文

### 4.2 config 编排（对齐 `shopify app config use/link/pull/validate`）

- `bshopify app config list`：列出 `bshopify.config.mjs` 全部 configFiles + 状态（TOML 存在性、是否已 link）
- `bshopify app config use <name>`：切换当前 config，联动 `.env.<name>` 与 `shopify app config use`
- `bshopify app config pull`：按 configFiles 批量 `shopify app config pull`

### 4.3 部署链路增强（对齐 `shopify app deploy / versions list / release`）

- 多 config 批量：`bshopify app deploy --config dev,test` 或 `--all`，逐环境确认
- 部署前 diff：先 `shopify app versions list` 对比当前版本，输出将变更的 config 摘要（复用 `importantConfig` 提取）
- 部署记录：deploy 成功后写 `.bshopify/deployments.json`（时间/config/commit/hash），`bshopify app versions` 包装展示**团队部署历史**（官方只给平台侧版本，无团队侧记录）

### 4.4 git 感知与并发

- dev/deploy 前检测脏工作区并警告（防止恢复覆盖手写改动）
- 跨进程锁：不同终端并发 dev 互相排斥（现有锁是项目内单锁，补会话/进程维度）
- 可选：pre-push hook 自动跑 `validate`

### 4.5 theme 域接管

- `bshopify theme dev`：注入主题相关上下文后 `shopify theme dev`，结束恢复
- `bshopify theme push`：push 前自动 `shopify theme check`（Liquid lint），失败阻断；`--theme-id` 支持团队默认值
- `bshopify theme list / info`：团队主题台账（哪些店铺、哪个主题在推）

### 4.6 `app generate extension` 增强（对齐 `shopify app generate extension`）

- 生成新 extension 后自动补 `__entry.js` 模板并注册到 manifest → 新 extension 免手写 entry，开箱即用

### 4.7 `bshopify doctor`（环境体检）

- 一键检查：Node 版本、shopify CLI 版本与兼容范围、`shopify auth status` 登录态、`shopify organization list`、项目接入完整性（复用 validate 汇总）
- `--fix` 尝试自动修复（提示安装 CLI、补 init、补登录）

**验收**：两个以上团队项目日常使用；多环境 dev/deploy 全流程可重复执行；env/config 切换无手工步骤；theme push 前 lint 拦截生效；doctor 可定位 90% 环境问题；发布 0.3.x。

---

## 5. 第 3 期：v1.0.0 —— 生产就绪

**目标**：团队规模扩大，需要"从创建到上线"全链路一致 + 可扩展体系 + 稳定 API。

### 5.1 创建链路一体化

- `bshopify create app <name>`：`shopify app init` + bshopify init 一键化，内置团队模板（org、URL、默认 configFiles）
- `bshopify init --template <t>`：接入模板化

### 5.2 运行期辅助（对齐 `shopify app logs / webhook trigger / open`）

- `bshopify app logs --config <name>`：注入 config 上下文后 `shopify app logs`
- `bshopify webhook trigger <topic> --config <name>`：从当前 TOML 的 `webhooks.subscriptions` 取地址触发（对齐 `shopify app webhook trigger`）
- `bshopify app open`：打开当前 config 的 app URL / 预览地址

### 5.3 可扩展体系

- 生命周期钩子规范化：init/validate/guard/dev/deploy 各阶段事件发布，支持项目级 hooks 文件（不止 extension entry）
- 轻量插件机制（对齐官方 plugin 思路）：团队可注册自定义编排步骤
- 配置 Schema：`bshopify.config.mjs` 提供 JSON Schema + `bshopify config` 命令（校验、默认值、文档化）

### 5.4 稳定性与发布

- 兼容矩阵：Node 版本 × Shopify CLI 4.x 各 minor × OS，自动化 smoke
- semantic-release：自动版本 + CHANGELOG + 云仓发布
- 文档站 + 从 v0 的迁移指南
- 性能优化：20+ extension 项目的启动与注入耗时
- 可选遥测：默认关闭的错误上报/使用统计

**验收**：`create app` 一次成型；兼容矩阵全绿；对外发布 1.0.0，API 冻结，迁移指南可用。

---

## 6. 建议执行顺序

1. **v0.2 先做 `app guard` 真逻辑**（防护是最大短板，风险最高，其余都是增量）。
2. 随后 `validate` → `restore` → `status`，形成"校验-防护-恢复"闭环。
3. `dev watch` 与 `app build` 与团队实际 dev/CI 流程强相关，按团队节奏排。
4. CI 与测试加固不阻塞功能，尽早接入。
5. v0.3 优先 env 管理与 config 编排（协作刚需），theme 域视团队是否有主题开发场景。
6. v1.0 冻结前至少跑满一个完整版本周期（两个项目 × dev/deploy/guard 全流程）。

## 7. 风险与依赖

- **Shopify CLI 版本漂移**：v4 命令面在演进（如 env push 官方暂无），v0.3 建立兼容矩阵；接管命令以 `--help` 探测降级。
- **guard 误伤**：白名单与忽略规则需充分设计，避免阻断正常提交。
- **事务恢复边界**：restore 手动恢复与自动恢复需明确幂等语义。
- **依赖**：v0.2 不新增依赖；v0.3 的 `.env` 解析与 schema 校验评估轻量依赖。
