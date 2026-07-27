# bshopify

`@bestfulfill/bshopify` 是 BestFulfill 团队的 Shopify App Runner CLI。它用于统一接管团队项目中的 `shopify app xx` 入口，并在真实 Shopify CLI 执行前后编排 Extension Entry、配置注入、恢复、校验和提交防护。

当前仓库处于 TypeScript CLI MVP 阶段：包名、bin、构建链路、测试链路和基础命令面已经接入，`init` 已实现项目初始化，其余命令会在后续迭代中补齐具体业务编排。

## 环境要求

- Node.js >= 18.17
- npm
- Shopify CLI，后续执行真实 `dev` / `deploy` 流程时需要

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
bshopify init --check
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

当前已注册的 MVP 命令面：

| 命令 | 目标用途 |
|-|-|
| `bshopify init` | 初始化项目接入文件、配置、Git hook、推荐 scripts 和 Extension Entry |
| `bshopify dev` | 接管 `shopify app dev`，执行临时注入与恢复 |
| `bshopify deploy` | 接管 `shopify app deploy`，执行发布前校验、注入、恢复和生产确认 |
| `bshopify validate` | 校验配置文件、Entry、注入计划和占位符覆盖 |
| `bshopify guard` | 阻止真实注入值或持锁状态进入提交 |
| `bshopify restore <runId>` | 根据事务状态恢复异常中断的源码模板态 |

## init 命令

在 Shopify app 项目根目录执行：

```bash
bshopify init
```

`init` 会执行项目结构检查，并在缺失时生成以下内容：

- `bshopify.config.mjs`
- `.bshopify-tmp/` 的 `.gitignore` 忽略项
- 当前 Git hooks 目录下的 `pre-commit`
- `extensions/*/__entry.js`
- `package.json` 中的 `dev`、`deploy` scripts，已有同名脚本会被替换，并在摘要中提示

Git hook 写入规则：如果当前项目配置了 `core.hooksPath`，会写入该目录；否则写入 Git 默认的 `.git/hooks/pre-commit`。如果 `pre-commit` 已存在，`init` 会在 shebang 后插入带标记的 `bshopify guard` block，不会覆盖原有 hook 内容。hook 执行时会优先使用项目本地 `./node_modules/.bin/bshopify`，不存在时再回退到 PATH 中的 `bshopify`。

命令执行结束后会输出彩色 summary，用不同颜色区分检查结果、创建、更新、跳过、警告和错误。

只检查不写文件：

```bash
bshopify init --check
```

对指定目录执行初始化：

```bash
bshopify init --cwd ./path/to/shopify-app
```

## 项目结构

```text
src/
  cli.ts        # bshopify bin 入口
  index.ts      # CLI program 工厂与可测试导出
  commands/
    init/
      index.ts     # init 命令实现
      constants.ts # init 常量、模板和推荐 scripts
      utils.ts     # init 工具方法
tests/
  cli.test.ts   # CLI 元信息和命令面测试
  init.test.ts  # init 文件生成和 check 行为测试
```

## 验证

当前基础验收：

```bash
npm run check
npm pack --dry-run
```

`npm run check` 会依次执行 TypeScript 类型检查、Vitest 测试和 tsup 构建。`npm pack --dry-run` 用于确认发布包内容符合预期。
