# bshopify

`@bestfulfill/bshopify` 是 BestFulfill 团队的 Shopify App Runner CLI。它用于统一接管团队项目中的 `shopify app xx` 入口，并在真实 Shopify CLI 执行前后编排 Extension Entry、配置注入、恢复、校验和提交防护。

当前仓库处于 TypeScript CLI MVP 阶段：包名、bin、构建链路、测试链路和基础命令面已经接入，`app init` 已实现项目初始化。CLI 会优先接管 bshopify 已实现的命令；未接管的命令会按原参数降级执行本机 `shopify` CLI。

## 环境要求

- Node.js >= 22.12.0
- npm
- Shopify CLI，未接管命令会通过 `execa` 优先使用项目本地 `node_modules/.bin/shopify`，找不到时再使用用户 PATH 中的 `shopify`

## 私有 npm 云仓

项目已在 `.npmrc` 中配置阿里云 npm registry：

```ini
registry=https://packages.aliyun.com/686b883471b943e5958efa4c/npm/npm-registry/
```

安装或发布私有包前，需要先登录云仓：

```bash
npm login --registry=https://packages.aliyun.com/686b883471b943e5958efa4c/npm/npm-registry/
```

发布前请确保已更新 `package.json` 中的 `version`，并通过完整检查：

```bash
npm run check
npm publish --registry=https://packages.aliyun.com/686b883471b943e5958efa4c/npm/npm-registry/
```

## 本地开发

安装依赖：

```bash
npm install
```

如果当前本机没有云仓读取权限，可以临时使用公共 registry 安装公开依赖：

```bash
npm install --registry=https://registry.npmjs.org
```

常用命令：

```bash
npm run dev -- --help
npm run typecheck
npm run test
npm run build
npm run check
```

本地 link 调试：

```bash
# 在 bshopify 仓库中构建并注册全局 link
npm run build
npm link

# 在目标 Shopify app 项目中使用本地包
npm link @bestfulfill/bshopify
bshopify app init --check
```

取消本地 link：

```bash
# 在目标 Shopify app 项目中取消引用本地包
npm unlink @bestfulfill/bshopify

# 在 bshopify 仓库中取消全局 link
npm unlink -g @bestfulfill/bshopify
```

## CLI 命令

构建后可运行：

```bash
node dist/cli.js --help
```

当前已接管的 MVP 命令面：

| 命令 | 目标用途 |
|-|-|
| `bshopify app init` | 初始化项目接入文件、配置、Git hook 和 Extension Entry |
| `bshopify app dev` | 临时注入 Extension Entry 产物，按配置文件路径推导 Shopify config 名并执行 `shopify app dev --config <name>`，结束后恢复占位符 |
| `bshopify app guard` | 阻止真实注入值或持锁状态进入提交 |
| `bshopify app clear` | 删除当前 app 项目里 bshopify 生成的全部文件（`.bshopify/`、`bshopify.config.mjs`、生成的 entry 等），并还原 Git hook / filter / ignore 接入 |

未被 bshopify 接管的命令会降级到 Shopify CLI，例如：

```bash
bshopify app deploy
bshopify theme dev
```

以上命令会分别执行对应的 `shopify app deploy`、`shopify theme dev`。后续当 bshopify 接管某个命令时，会在保持 Shopify 命令格式的基础上增加注入、校验、恢复等编排。

## init 命令

在 Shopify app 项目根目录执行：

```bash
bshopify app init
```

`init` 会执行项目结构检查，并在缺失时生成以下内容：

- `bshopify.config.mjs`
- `.bshopify/` 的 `.gitignore` 忽略项
- 当前 Git hooks 目录下的 `pre-commit`
- `extensions/*/__entry.js`（自带 `// @ts-check` + JSDoc 类型引用，见 [Entry 类型提示](#entry-类型提示与占位跳过)）
- `.bshopify/git-add-cleaner.js`（Git clean/smudge filter，位于被 ignore 的 `.bshopify/` 下，不随仓库提交）
- `.gitattributes`（`extensions/** filter=bshopify`）
- Git local config `filter.bshopify.*`（clean / smudge / required=false）

`init` 不会改写 `package.json`：`dev`、`deploy` 等 scripts 由你自己决定，想用 bshopify 时在 `package.json` 里配 `"dev": "bshopify app dev"` 即可。

`configFiles` 指向的 Shopify app TOML 文件缺失时，`init` 不再直接停止。刚起步的项目没有分环境配置，因此**所有环境共享同一个配置文件**：如果项目里已存在任意 `shopify.app*.toml`（含配置中已存在的），直接复用该文件并让 `configFiles` 的各环境都指向它，不触发生成；如果项目里一个 TOML 都没有，则只调用一次 `shopify app config link` 生成默认 `shopify.app.toml`，并让 `configFiles` 的 dev / test / production 都指向它。生成成功会记入 created 摘要并继续后续流程，生成失败则仍按缺失文件报错。`--check` 只做只读检查，不会触发生成。

Git clean filter：dev 运行期间扩展文件里的占位符被临时替换成真实值，此时执行 `git add` 会先经过 `git-add-cleaner.js` 把注入值还原成占位符再进暂存区，避免真实 URL/密钥被提交。filter 命令写在本地 `.git/config`（由 `init` 写入），脚本存放在被 ignore 的 `.bshopify/` 下——新 clone 必须跑过 `init` filter 才会生效，`init --update` 会按 CLI 最新模板直接替换脚本。无注入 marker 的文件（含二进制）原样透传；`required` 默认为 `false`，未配置 filter 的机器会静默按原样暂存。`init` 不会对已跟踪文件做任何改写：首次接入时 bshopify 尚未注入过任何值，用户自己的改动保持原样。

Git hook 写入规则：如果当前项目配置了 `core.hooksPath`，会写入该目录；否则写入 Git 默认的 `.git/hooks/pre-commit`。如果 `pre-commit` 已存在，`init` 会在 shebang 后插入带标记的 `bshopify app guard` block，不会覆盖原有 hook 内容。hook 执行时会优先使用项目本地 `./node_modules/.bin/bshopify`，不存在时再回退到 PATH 中的 `bshopify`。

命令执行结束后会输出彩色 summary，用不同颜色区分检查结果、创建、更新、跳过、警告和错误。

只检查不写文件：

```bash
bshopify app init --check
```

已有项目同步 bshopify 受管文件：

```bash
bshopify app init --update
```

`init` 会在 `.bshopify/` 下写入 `bshopify.manifest.json` 作为受管资源索引，记录受管 entry 路径、Git hook 路径和 clean filter 脚本路径。`--update` 会读取当前 `bshopify.config.mjs` 和 manifest，先按旧坐标迁移或清理受管资源，再补齐缺失文件并写回 manifest。已有的 `bshopify.config.mjs` 不会被覆盖；entry 文件名属于内部默认（`__entry.js`），若旧配置改过它，`--update` 会按 manifest 记录的旧路径 rename 到新文件名；`.gitignore` 会写入 `# bshopify cli` 和 `.bshopify/`；clean filter 脚本在 update 时同步为最新模板。`package.json` 不在受管范围内，scripts 由你自行维护。

对指定目录执行初始化：

```bash
bshopify app init --cwd ./path/to/shopify-app
```

## clear 命令

`clear` 与 `init` 相反：把当前 app 项目恢复到接入 bshopify 之前的状态，删除 bshopify 生成的全部文件并还原其修改过的文件。**不会删除你自己的代码**：

```bash
bshopify app clear
```

执行后删除/还原以下内容：

- `.bshopify/` 状态目录（manifest、`git-add-cleaner.js`、dev/deploy 的 lock 与 transaction journal 等运行时文件）；
- `bshopify.config.mjs` runner 配置；
- manifest 中记录的、仍是生成模板内容的 extension entry（`__entry.js` 等）——**改写过自定义逻辑的 entry 会保留**，只给出提示；
- `.gitignore` / `.gitattributes` 里 `init` 追加的 `# bshopify cli` 块；
- pre-commit hook 里的 bshopify guard block（hook 本身是 bshopify 生成的模板时整文件删除，含用户内容的只去掉 guard block）；
- 本地 git config 的 `filter.bshopify.*`（值被改过的话保留并提示）。

若 `bshopify app dev` / `app deploy` 正在运行（prepare 锁被活跃进程持有），`clear` 会直接拒绝执行并提示先停止该进程，避免破坏运行中的注入会话；若存在崩溃遗留的未恢复注入事务（如 dev 被 kill 留下的 journal），`clear` 会先按 journal 还原注入值再删除状态目录。命令默认交互确认，`--yes` 跳过确认；可用 `--cwd <path>` 指定项目目录。

## 配置

项目接入后由 `init` 生成 `bshopify.config.mjs`,按 app / extension 两段组织,只暴露团队需要关心的字段:

```js
export default {
  // --- App: Shopify app config files by environment ---
  configFiles: {
    dev: "shopify.app.dev.toml",
    test: "shopify.app.test.toml",
    production: "shopify.app.production.toml",
  },

  // --- Extension: custom env injection (optional) ---
  // envFiles: {
  //   aEnv: ["config/a.json", "config/a.toml"],
  //   bEnv: "config/b.json",
  // },

  // --- Extension: injection behavior ---
  failOnUnresolvedPlaceholders: true,
};
```

- `configFiles`(app 级):环境名到项目根目录 Shopify app TOML 的映射,`bshopify app dev/deploy --config <name>` 按此选择。
- `envFiles`(extension 级,可选):自定义注入 env 的命名空间映射,key → 一个或多个相对项目根目录的 JSON/TOML 文件路径。每个 key 会成为注入给 `__entry` 的 ctx 上的独立字段(如配置 `aEnv` → `ctx.aEnv`),多个文件内容按顺序浅合并,后面的文件覆盖前面的同名 key;文件内容必须是 JSON/TOML 对象。key 必须是合法 JS 标识符,且不能与 `configPath`/`env`/`appConfig` 冲突;路径必须位于项目根目录内(不支持绝对路径或 `../` 逃逸)。dev/deploy 开始时会在终端输出一行"Custom env files injected"提示,列出每个 key 实际加载的文件(全部缺失的 key 显示 `(none)`);某个文件缺失只打印 warning 并跳过,对应 key 保留其余文件合并结果(全部缺失时为 `{}`),不会中断命令;`envFiles` 本身不是对象时也只会 warning 并按空对象处理。格式不支持、解析失败或内容不是对象仍会直接报错。
- `failOnUnresolvedPlaceholders`(extension 级):注入后若目标文件残留模板占位符则报错的行为开关。

`extensionsRoot`、`entryFileName`、`restoreMarkers` 是内部默认(分别为 `extensions`、`__entry.js`、`true`),新项目不再写入配置文件;已有配置仍可覆盖,用于向后兼容。`init --update` 合并时只补齐 `configFiles`、`failOnUnresolvedPlaceholders`,不会覆盖用户已有的同名字段(包括 `envFiles`)。

## dev 命令

默认使用 `shopify.app.dev.toml` 生成注入上下文，并执行 `shopify app dev --config dev`：

```bash
bshopify app dev
```

切换 Shopify app config 时，通过 bshopify 自己的 `--config` 参数选择 `bshopify.config.mjs` 里的 `configFiles` key。bshopify 会读取该 key 对应的 TOML 路径，并从文件名推导最终传给 Shopify CLI 的 config 名，所以注入上下文、summary 和最终 Shopify CLI 参数会保持一致：

```bash
bshopify app dev --config test
```

`configFiles` 必须指向项目根目录下符合 Shopify CLI 命名规则的文件，例如 `shopify.app.toml` 或 `shopify.app.preview.toml`。例如 `configFiles.test = "shopify.app.preview.toml"` 时，bshopify 会读取 `shopify.app.preview.toml`，并执行 `shopify app dev --config preview` 或 `shopify app deploy --config preview`。

如果配置路径是默认文件 `shopify.app.toml`，bshopify 会读取该文件，并执行不带 `--config` 的 Shopify CLI 命令，例如 `shopify app dev` 或 `shopify app deploy`。

`dev` 默认会在注入值后追加按文件类型生成的 restore marker（自描述格式：占位符 + 注入值长度 + 注入值校验和 + 随机串，不包含注入值本身），结束后只恢复本轮注入的值。marker 会按目标文件类型选择注释语法（如 js/css 用 `/* */`、html 用 `<!-- -->`、liquid 用 `{% comment %}`，toml 用 `#` 行注释并放到行尾），因此注入到 `shopify.app*.toml`、`shopify.extension.toml` 等 TOML 文件时仍是合法 TOML，Shopify CLI 可正常解析。marker 同时是 Git clean filter 的还原依据，也是进程被杀后恢复的依据。校验和用于只信任真正由 bshopify 写入的 marker：文件里形似 marker 的普通文本、或 dev 期间被手改过的注入值都不会被错误还原。若遇到未覆盖的文件类型或注释语法不兼容，仍可在 `bshopify.config.mjs` 显式写 `restoreMarkers: false` 关闭（内部默认，向后兼容）：

```js
export default {
  restoreMarkers: false,
};
```

关闭后仍会在 dev 结束时恢复占位符，但恢复会按注入值本身匹配，dev 期间手写的相同值也可能被一起还原；且文件不再携带 marker，Git clean filter 将无法在 `git add` 时还原注入文件。

## Entry 类型提示与占位跳过

`init` 生成的 `__entry.js` 是带类型的：文件顶部有 `// @ts-check`，并用 JSDoc 引用了包自带的类型：

```js
// @ts-check
/** @type {import('@bestfulfill/bshopify').ExtensionLifecycle} */
export default {
  async prepare(ctx) {
    return { injections: [ /* ... */ ] };
  },
  // validate / beforeDeploy / afterDeploy / onError 同享类型推导
};
```

因此编辑器里 `ctx`（`ExtensionContext`，含 `configPath` / `env` / `appConfig`）、`plan`（`PreparedExtensionPlan`）、`result`（`ExtensionDeployResult`）等参数都有补全与错误提示。类型来自 `@bestfulfill/bshopify` 的公开导出（`ExtensionLifecycle` / `ExtensionContext` / `InjectionPlan` / `PreparedExtensionPlan` / `ExtensionDeployResult` 等）；后续模板升级时，`init --update` 会把 manifest 里记录的生成 entry 刷新到最新模板。

当一个 `__entry.js` 仍是未改动过的生成模板（即占位 entry，没有任何 injections 或 hook 逻辑）时，`dev` / `deploy` 会**直接跳过它**：不加载模块、不执行 `prepare`、不注入、不在 deploy summary 中列出，只打印一行 `Skipped N placeholder extension entries ...`。只有真正编写了注入或 hook 的 entry 才会进入执行链路。这能避免多 extension 项目里大量空模板带来的无效 import 与输出噪声；若你改了模板（例如补一个 injection），它就不再是占位文件，会自动回到执行链路。

`deploy` 不会隐藏任何 `__entry.js`：`__entry.js` 对 Shopify 只是扩展目录里的多余文件，多一个文件不会导致 deploy 失败或被拦截，因此 entry（含占位 entry）在 deploy 期间原样保留，只恢复本轮真正写过的注入目标文件。

## 项目结构

```text
src/
  cli.ts           # bshopify bin 入口
  main.ts          # CLI program 工厂、fallback 分发和 Shopify CLI 透传
  index.ts         # package 对外导出面
  utils/           # 根通用能力：配置读取、package.json、路径、文件、对象校验、终端输出等
  app/             # app 域（编排层）：Shopify app 是 extension 的上级，负责整个项目的命令编排
    commands/      # app 子命令入口；负责参数解析、依赖注入和命令编排
      index.ts     # app 子命令注册和 app 层 fallback 判断
      dev/         # app dev 编排入口
      deploy/      # app deploy 编排入口
      init/        # app init 初始化流程，按 checks/files/git-hooks/manifest/types 拆分
    runner/        # app 运行管线：上下文、配置、envFiles 加载、锁、事务、注入执行、Shopify CLI 调用
  extension/       # extension 域（受管单元层）：Shopify extension 及其 entry，只被 app 依赖
    types.ts       # ExtensionInfo / ExtensionLifecycle / ManagedEntry 等扩展域类型
    entries.ts     # 扩展发现 + entry 加载 + 生命周期编排（prepare/validate/beforeDeploy/...）
    entry-loader.ts# 运行时加载扩展 entry 模块
    manage.ts      # init 时的 entry 写入/清理/重命名（与 app 通过结构化类型解耦）
    manage-stale.ts# entry 旧坐标清理与重命名
    manage-content.ts # entry 模板与内容哈希
    paths.ts       # 注入目标路径安全校验
tests/
  cli.test.ts      # CLI 元信息、命令面、fallback、目录结构和 dev/deploy 行为测试
  init.test.ts     # init 文件生成和 check 行为测试
```

层级上，Shopify 的项目模型是 app 包含 extension（`extensions/` 是其子目录），所以代码也按 "app 编排层 > extension 受管单元层" 组织：运行期只由 `src/app/` 依赖 `src/extension/`，extension 域不反向依赖 app 的运行逻辑（仅 context 组合点使用 app 的上下文类型）。`Entry`（`__entry.js`，bshopify 受管文件）与 `Extension`（Shopify 扩展）在类型与命名上区分开：`ManagedEntry` 表示前者，`ExtensionInfo` 表示后者。

目录边界上，根 `src/utils/` 只放与 Shopify app 域无关的通用能力；`src/app/` 放 app 域编排；`src/extension/` 放扩展域受管单元；具体命令目录只保留该命令自己的编排和局部细节。

跨层级引用优先使用 `#/*` 路径别名，例如 `#/utils/node`、`#/app/runner/config`、`#/extension/entries`；同目录或相邻模块可以继续使用相对路径。

## 验证

当前基础验收：

```bash
npm run check
npm pack --dry-run
```

`npm run check` 会依次执行 TypeScript 类型检查、Vitest 测试、tsup 构建和构建产物 CLI smoke test。`npm pack --dry-run` 用于确认发布包内容符合预期。
