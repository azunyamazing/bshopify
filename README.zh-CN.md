# @standhigher/bshopify

> BestFulfill Shopify App Runner CLI · 统一接管 `shopify app xx` 入口，在真实 Shopify CLI 前后编排注入、恢复、校验与提交防护

[English](./README.md) | **中文**

## 简介

`@standhigher/bshopify` 是 BestFulfill 团队的 Shopify App Runner CLI。它统一接管团队项目中的 `shopify app xx` 入口，并在真实 Shopify CLI 执行之前/之后编排 Extension Entry、配置注入、运行期恢复、校验和提交防护，让多环境配置注入与密钥安全变成可复用的工程能力，而不是每个项目手写的脚本。

当前已接管的命令面：`app init`（项目初始化接入）、`app dev`（开发注入编排）、`app deploy`（部署注入编排）、`app guard`（提交防护）、`app clear`（还原接入）。bshopify 会优先接管已实现的命令；未接管的命令会按原参数降级执行本机 `shopify` CLI，不影响既有工作流。

## 核心能力

- **一键接入**：`bshopify app init` 自动生成配置文件、Extension Entry、Git hook / filter，幂等可重跑。
- **环境配置注入**：`dev` / `deploy` 期间按 `bshopify.config.mjs` 把扩展所需的真实值临时注入目标文件，结束后自动恢复占位符。
- **密钥不落库**：Git clean filter + pre-commit guard 双保险，注入值或持锁状态不会被提交。
- **降级兼容**：未接管命令原样透传 Shopify CLI；新命令接管只增不改。

## 环境要求

- Node.js >= 22.12.0
- npm
- Shopify CLI：接管命令内部通过 `execa` 优先调用项目本地 `node_modules/.bin/shopify`，找不到时回退到 PATH 中的 `shopify`

## 安装

在 Shopify app 项目中作为本地依赖安装（推荐），或全局安装：

```bash
# 项目内（推荐，devDependency 即可）
npm install -D @standhigher/bshopify

# 或全局
npm install -g @standhigher/bshopify
```

## 快速开始

在 Shopify app 项目根目录执行初始化：

```bash
bshopify app init
```

`init` 会做项目结构检查，并在缺失时生成以下内容：

- `bshopify.config.mjs` — runner 配置（只暴露团队需要关心的字段，带类型提示）
- `.gitignore` 追加 `# bshopify cli` 与 `.bshopify/`
- Git hooks 目录下的 `pre-commit`（插入带标记的 `bshopify app guard` block）
- `extensions/*/__entry.js` — 扩展生命周期入口（自带 `// @ts-check` + JSDoc 类型引用）
- `.bshopify/git-add-cleaner.js` + `.gitattributes` + Git local config `filter.bshopify.*` — clean/smudge filter（脚本位于被 ignore 的 `.bshopify/` 下，不随仓库提交）

`init` **不会改写 `package.json`**，scripts 由你自行维护。接入后在 `package.json` 里配置：

```json
{
  "scripts": {
    "dev": "bshopify app dev",
    "deploy": "bshopify app deploy"
  }
}
```

然后照常开发：

```bash
npm run dev
```

`dev` 期间 Git 会把注入值自动还原成占位符再进暂存区，真实 URL / 密钥不会进入提交。

## CLI 命令

### 命令总览

| 命令 | 用途 | 备注 |
|-|-|-|
| `bshopify app init` | 初始化接入 | `--check` 只检查不写文件；`--cwd <path>` 指定项目目录；幂等可重复执行 |
| `bshopify app dev` | 注入扩展配置并运行 `shopify app dev` | `--config <key>` 选择 `configFiles` 环境 |
| `bshopify app deploy` | 注入扩展配置并运行 `shopify app deploy` | `--config`、`--dry-run`、`--yes`、`--confirm-production` |
| `bshopify app guard` | 阻止真实注入值或持锁状态进入提交 | 由 pre-commit hook 自动调用 |
| `bshopify app clear` | 删除 bshopify 生成的全部文件，还原接入前状态 | `--yes` 跳过确认；不删你的代码 |
| 其它任意命令 | 降级执行本机 Shopify CLI | 例如 `bshopify theme dev` → `shopify theme dev` |

### 降级机制

未被接管的命令（如 `theme` 域、以及将来尚未接管的 `app` 子命令）会按原参数直接执行对应的 `shopify <command>`。后续 bshopify 接管某条命令时，会在保持 Shopify 命令格式的基础上增加注入、校验、恢复等编排。

### app init

```bash
bshopify app init              # 在项目根目录初始化
bshopify app init --check      # 只读检查，不写任何文件
bshopify app init --cwd ./path/to/shopify-app
```

行为要点：

- **幂等**：重复执行只补齐缺失的受管文件并刷新 manifest，已存在内容做安全增量——pre-commit guard block 刷新到当前模板，带生成标记的旧版 clean filter 脚本替换为最新模板；**已生成的 entry 不会被覆盖**，你改写过的自定义逻辑原样保留。
- **TOML 缺失不中断**：`configFiles` 指向的 TOML 不存在时，若项目已有任意 `shopify.app*.toml`，各环境直接复用该文件；一个都没有则调用一次 `shopify app config link` 生成默认 `shopify.app.toml`，dev / test / production 都指向它。`--check` 只读，不会触发生成。
- **升级 bshopify**：CLI 不提供自动迁移命令。升级后重跑 `init` 会自动刷新 guard block 与旧版 clean filter 脚本；其余受管文件（entry 模板、manifest 坐标等）不自动迁移，按 CHANGELOG / 迁移指南处理，必要时删除旧生成文件后重新 `init`。

### app dev

```bash
bshopify app dev                 # 默认使用 configFiles.dev
bshopify app dev --config test   # 切换到 test 环境
```

默认注入 `configFiles.dev` 指向的 TOML，并执行 `shopify app dev`。使用 `--config <key>` 时，bshopify 读取该 key 对应的 TOML 路径，并从文件名推导传给 Shopify CLI 的 config 名——例如 `configFiles.test = "shopify.app.preview.toml"` 会执行 `shopify app dev --config preview`；路径是默认文件 `shopify.app.toml` 时则不传 `--config`。

`dev` 结束后只恢复本轮注入的值；若进程被杀，下次运行会检测到残留锁并按 journal 自动恢复，不会把注入值留在工作区。

### app deploy

```bash
bshopify app deploy                       # 交互式选择 configFiles 中的部署环境
bshopify app deploy --config production   # 直接部署 production
bshopify app deploy --config production --dry-run   # 只做注入准备与校验，不调用 Shopify CLI
bshopify app deploy --confirm-production  # 非交互部署 production（CI）
bshopify app deploy --yes                 # 跳过最终部署确认（production 仍需 --confirm-production）
```

`deploy` 与 `dev` 共享注入编排：按 `configFiles` 选择 TOML、注入真实值、校验占位符是否全部解析，随后调用 Shopify CLI；结束时恢复注入并释放锁。未指定 `--config` 时交互式选择部署环境（`configFiles` 里必须至少配置一个目标）；选择 `production` 时需输入 `confirm` 确认，`--confirm-production` 或 `--dry-run` 可跳过该确认（`--yes` 不能跳过 production 确认）。`--dry-run` 用于 CI / 预检，不触发真实部署。

### app guard

guard 通常由 pre-commit hook 自动执行，也可手动运行：

```bash
bshopify app guard
```

当暂存内容包含仍未恢复的真实注入值、或 dev / deploy 的 prepare 锁仍被持有（有运行中的注入会话）时，guard 会拒绝提交。无风险时静默通过。

### app clear

```bash
bshopify app clear        # 交互确认后还原
bshopify app clear --yes  # 跳过确认
bshopify app clear --cwd ./path/to/shopify-app
```

`clear` 与 `init` 相反：删除 bshopify 生成的全部文件并还原其修改过的文件——`.bshopify/`、`bshopify.config.mjs`、仍是生成模板内容的 entry、`.gitignore` / `.gitattributes` 里追加的 `# bshopify cli` 块、pre-commit 里的 guard block、本地 git config 的 `filter.bshopify.*`。**不会删除你的代码**：改写过自定义逻辑的 entry 会保留并提示；若 dev / deploy 正在运行（锁被持有）会直接拒绝执行。

## 配置 `bshopify.config.mjs`

由 `init` 生成，按 app / extension 两段组织。生成的文件自带类型提示：首行 `// @ts-check`，并用 JSDoc 将默认导出标注为包的 `RunnerConfigInput` 类型，编辑字段时有补全与错误提示：

```js
// @ts-check
/**
 * bshopify runner config.
 *
 * @type {import('@standhigher/bshopify').RunnerConfigInput}
 */
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

### 字段说明

- **`configFiles`**（app 级）：环境名 → 项目根目录 Shopify app TOML 的映射。`dev` / `deploy` 的 `--config <name>` 按此选择。文件名须符合 Shopify CLI 命名规则（`shopify.app.toml` 或 `shopify.app.<name>.toml`）。
- **`envFiles`**（extension 级，可选）：自定义注入 env 的命名空间映射，key → 一个或多个相对项目根目录的 JSON/TOML 文件。每个 key 成为注入给 `__entry` 的 ctx 上的独立字段（如配置 `aEnv` → `ctx.aEnv`）；多个文件按顺序浅合并，后者覆盖同名 key；文件内容必须是 JSON/TOML 对象。key 必须是合法 JS 标识符且不与 `configPath` / `env` / `appConfig` 冲突；路径须位于项目根目录内（不支持绝对路径或 `../` 逃逸）。单个文件缺失只 warning 并跳过，不会中断命令；格式不支持、解析失败或内容不是对象会直接报错。
- **`failOnUnresolvedPlaceholders`**（extension 级）：注入后若目标文件仍残留模板占位符，是否直接报错。

`extensionsRoot`、`entryFileName`、`restoreMarkers` 是内部默认（`extensions`、`__entry.js`、`true`），新项目不再写入配置文件；已有配置仍可覆盖以向后兼容。`init` 对已存在的配置只做缺字段合并（补齐 `configFiles`、`failOnUnresolvedPlaceholders`），不会覆盖用户已有字段（含 `envFiles`）。

偏好 Vite 风格时，可显式用 `defineConfig` 包裹默认导出（包导出的 identity 帮助函数，只为类型检查与提示）：

```js
// @ts-check
import { defineConfig } from "@standhigher/bshopify";

export default defineConfig({
  restoreMarkers: false,
});
```

> 注意：`defineConfig` 写法要求项目里能 `import` 到 `@standhigher/bshopify`；若包只装全局、项目未安装，配置加载会失败，此时请用上面的 JSDoc 形式（`init` 生成的默认模板，无运行时依赖）。

## 编写 Extension Entry（`__entry.js`）

`init` 生成的 `extensions/*/__entry.js` 是扩展生命周期入口，自带类型：

```js
// @ts-check
/** @type {import('@standhigher/bshopify').ExtensionLifecycle} */
export default {
  async prepare(ctx) {
    return { injections: [ /* ... */ ] };
  },
  // validate / beforeDeploy / afterDeploy / onError 同享类型推导
};
```

`ctx`（`ExtensionContext`，含 `configPath` / `env` / `appConfig`）、`plan`（`PreparedExtensionPlan`）、`result`（`ExtensionDeployResult`）等参数在编辑器里都有补全与错误提示。类型来自包公开导出：`ExtensionLifecycle` / `ExtensionContext` / `InjectionPlan` / `PreparedExtensionPlan` / `ExtensionDeployResult` 等。

**占位 entry 自动跳过**：当某个 `__entry.js` 仍是未改动的生成模板（没有任何 injections 或 hook 逻辑）时，`dev` / `deploy` 会直接跳过它——不加载、不执行、不注入、不进 summary，只打印一行 `Skipped N placeholder extension entries ...`。改过模板（例如补一个 injection）后会自动回到执行链路，避免多 extension 项目里大量空模板的无效 import 与输出噪声。

## 安全与恢复机制

- **Restore marker**：`dev` / `deploy` 注入值后会按目标文件类型追加自描述 marker（占位符 + 注入值长度 + 校验和 + 随机串，不含注入值本身），并选择兼容注释语法（js/css 用 `/* */`、html 用 `<!-- -->`、liquid 用 `{% comment %}`、toml 用行尾 `#`），因此注入到 `shopify.app*.toml` 后仍是合法 TOML。marker 既是 Git clean filter 的还原依据，也是进程被杀后恢复的依据；校验和保证只信任 bshopify 真正写入的 marker，不会被形似文本或手改值误导。
- **Git clean filter**：dev 期间注入的真实值在 `git add` 时经 `.bshopify/git-add-cleaner.js` 还原成占位符再进暂存区。filter 配置写在本地 `.git/config`，脚本在被 ignore 的 `.bshopify/` 下——新 clone 必须跑过 `init` filter 才生效。脚本头带 bshopify 生成标记：重跑 `init` 时旧版脚本会被替换为最新模板，无标记的自定义脚本保留不动。无注入 marker 的文件（含二进制）原样透传；未配置 filter 的机器静默按原样暂存（`required` 默认 `false`）。
- **Pre-commit guard**：`init` 在 pre-commit 里插入带标记的 `bshopify app guard` block。若 `pre-commit` 已存在，会在 shebang 后插入，不覆盖原内容；hook 优先用项目本地 `./node_modules/.bin/bshopify`，否则回退 PATH。若项目配置了 `core.hooksPath` 则写入该目录，否则写 `.git/hooks/pre-commit`。

如遇不兼容的文件类型或注释语法，可在配置中显式关闭 marker（`restoreMarkers: false`）。关闭后 dev 结束仍会按注入值本身匹配恢复，但 dev 期间手写的相同值可能被一并还原，且 Git clean filter 无法再还原注入文件。

## 常见问题

- **pre-commit 没生效？** 确认项目跑过 `bshopify app init`（filter 与 hook 都写在本地 Git 配置里，新 clone 必须重跑一次）。
- **`defineConfig` 写法报 import 失败？** 项目里未安装 `@standhigher/bshopify`（只装了全局），改用 `init` 生成的 JSDoc 形式。
- **改了 entry 但 dev 不注入？** 确认 entry 已不是占位模板——模板文件会被跳过，改动后（加任一 injection）自动回到执行链路。

## 本地开发（本仓库）

```bash
npm install
npm run dev -- --help    # tsx 直跑 CLI
npm run typecheck        # TypeScript 类型检查
npm run test             # Vitest 测试
npm run build            # tsup 构建到 dist/
npm run check            # typecheck + test + build + dist smoke test
```

本地 link 调试：

```bash
npm run build && npm link                       # 在 bshopify 仓库
npm link @standhigher/bshopify                  # 在目标 Shopify app 项目
bshopify app init --check                       # 验证
npm unlink @standhigher/bshopify                # 取消
```

发布前验证：

```bash
npm run check
npm pack --dry-run   # 确认发布包内容（files: ["dist"]）符合预期
```
