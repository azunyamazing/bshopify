# bshopify

`@bestfulfill/bshopify` 是 BestFulfill 团队的 Shopify App Runner CLI。它用于统一接管团队项目中的 `shopify app xx` 入口，并在真实 Shopify CLI 执行前后编排 Extension Entry、配置注入、恢复、校验和提交防护。

当前仓库处于 TypeScript CLI 包骨架阶段：包名、bin、构建链路、测试链路和 MVP 命令面已经接入，具体命令业务逻辑会在后续迭代中补齐。

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

## CLI 命令

构建后可运行：

```bash
node dist/cli.js --help
```

当前已注册的 MVP 命令面：

| 命令 | 目标用途 |
|-|-|
| `bshopify init` | 初始化项目接入文件、配置和 Extension Entry |
| `bshopify dev` | 接管 `shopify app dev`，执行临时注入与恢复 |
| `bshopify deploy` | 接管 `shopify app deploy`，执行发布前校验、注入、恢复和生产确认 |
| `bshopify validate` | 校验配置文件、Entry、注入计划和占位符覆盖 |
| `bshopify guard` | 阻止真实注入值或持锁状态进入提交 |
| `bshopify restore <runId>` | 根据事务状态恢复异常中断的源码模板态 |

## 项目结构

```text
src/
  cli.ts        # bshopify bin 入口
  index.ts      # CLI program 工厂与可测试导出
tests/
  cli.test.ts   # CLI 元信息和命令面测试
```

## 验证

当前基础验收：

```bash
npm run check
npm pack --dry-run
```

`npm run check` 会依次执行 TypeScript 类型检查、Vitest 测试和 tsup 构建。`npm pack --dry-run` 用于确认发布包内容符合预期。
