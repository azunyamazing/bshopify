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
| `bshopify app init` | 初始化项目接入文件、配置、Git hook、推荐 scripts 和 Extension Entry |
| `bshopify app dev` | 临时注入 Extension Entry 产物，执行 `shopify app dev --config <name>`，结束后恢复占位符 |
| `bshopify app guard` | 阻止真实注入值或持锁状态进入提交 |

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
- `.bshopify-tmp/` 的 `.gitignore` 忽略项
- 当前 Git hooks 目录下的 `pre-commit`
- `extensions/*/__entry.js`
- `package.json` 中的 `dev`、`deploy` scripts，分别写为 `bshopify app dev` 和 `bshopify app deploy`；已有同名脚本会被替换，并在摘要中提示

Git hook 写入规则：如果当前项目配置了 `core.hooksPath`，会写入该目录；否则写入 Git 默认的 `.git/hooks/pre-commit`。如果 `pre-commit` 已存在，`init` 会在 shebang 后插入带标记的 `bshopify app guard` block，不会覆盖原有 hook 内容。hook 执行时会优先使用项目本地 `./node_modules/.bin/bshopify`，不存在时再回退到 PATH 中的 `bshopify`。

命令执行结束后会输出彩色 summary，用不同颜色区分检查结果、创建、更新、跳过、警告和错误。

只检查不写文件：

```bash
bshopify app init --check
```

对指定目录执行初始化：

```bash
bshopify app init --cwd ./path/to/shopify-app
```

## dev 命令

默认使用 `shopify.app.dev.toml` 生成注入上下文，并执行 `shopify app dev --config dev`：

```bash
bshopify app dev
```

切换 Shopify app config 时，通过 bshopify 自己的 `--config` 参数指定，注入上下文和最终 Shopify CLI 参数会保持一致：

```bash
bshopify app dev --config test
```

## 项目结构

```text
src/
  cli.ts           # bshopify bin 入口
  main.ts          # CLI program 工厂、fallback 分发和 Shopify CLI 透传
  index.ts         # package 对外导出面
  utils/           # 根通用能力：配置读取、package.json、路径、文件、对象校验、终端输出等
  app/
    commands/      # app 域命令入口；负责参数解析、依赖注入和命令编排
      index.ts     # app 子命令注册和 app 层 fallback 判断
      dev/         # app dev 编排入口
      init/        # app init 初始化流程，按 checks/files/git-hooks/paths/types 拆分
    runner/        # app dev/deploy 可复用 runner 能力：上下文、配置、entries、注入、锁、事务、Shopify CLI 调用
    utils/         # app 域共享工具，例如 Extension 路径处理
tests/
  cli.test.ts      # CLI 元信息、命令面、fallback、目录结构和 dev 行为测试
  init.test.ts     # init 文件生成和 check 行为测试
```

目录边界上，根 `src/utils/` 只放与 Shopify app 域无关的通用能力；`src/app/utils/` 放 app 域内多个模块会共用的方法；具体命令目录只保留该命令自己的编排和局部细节。

跨层级引用优先使用 `#/*` 路径别名，例如 `#/utils/node`、`#/app/runner/config`；同目录或相邻模块可以继续使用相对路径。

## 验证

当前基础验收：

```bash
npm run check
npm pack --dry-run
```

`npm run check` 会依次执行 TypeScript 类型检查、Vitest 测试、tsup 构建和构建产物 CLI smoke test。`npm pack --dry-run` 用于确认发布包内容符合预期。
