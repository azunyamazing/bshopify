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
| `bshopify app guard` | 阻止真实注入值或持锁状态进入提交 |

未被 bshopify 接管的命令会降级到 Shopify CLI，例如：

```bash
bshopify app dev
bshopify app deploy
bshopify theme dev
```

以上命令会分别执行对应的 `shopify app dev`、`shopify app deploy`、`shopify theme dev`。后续当 bshopify 接管某个命令时，会在保持 Shopify 命令格式的基础上增加注入、校验、恢复等编排。

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

## 项目结构

```text
src/
  cli.ts        # bshopify bin 入口
  index.ts      # CLI program 工厂与可测试导出
  commands/
    app/
      index.ts    # app 命令聚合、子命令注册和 app 层 fallback 判断
      init/
        index.ts     # app init 命令实现
        constants.ts # app init 常量、模板和推荐 scripts
        utils.ts     # app init 工具方法
tests/
  cli.test.ts   # CLI 元信息、app init 命令面和 Shopify fallback 测试
  init.test.ts  # init 文件生成和 check 行为测试
```

## 验证

当前基础验收：

```bash
npm run check
npm pack --dry-run
```

`npm run check` 会依次执行 TypeScript 类型检查、Vitest 测试和 tsup 构建。`npm pack --dry-run` 用于确认发布包内容符合预期。
