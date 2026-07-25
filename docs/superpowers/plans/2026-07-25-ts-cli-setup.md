# bshopify TypeScript CLI 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将空仓库初始化为 `@bestfulfill/bshopify` TypeScript CLI npm 包骨架，并对齐飞书技术方案中的包名、bin、私有 npm 云仓、基础命令入口和构建验证。

**Architecture:** 使用 ESM + TypeScript 编写 CLI，`src/cli.ts` 作为 bin 入口，`src/index.ts` 暴露可测试的命令构建函数。用 `commander` 管理命令，用 `tsup` 输出 `dist/cli.js` 和类型声明，用 `vitest` 验证基础 CLI 行为。

**Tech Stack:** TypeScript, Node.js >= 18.17, commander, tsup, vitest, npm, 阿里云 npm registry。

---

## 文件结构

- Create: `.npmrc`，配置阿里云云仓 registry。
- Create: `.gitignore`，忽略 `node_modules/`、`dist/`、coverage 和 `.bshopify-tmp/`。
- Create: `package.json`，声明 npm 包名、bin、exports、scripts、依赖和发布文件。
- Create: `tsconfig.json`，配置严格 TypeScript 编译。
- Create: `tsup.config.ts`，配置 ESM CLI 与类型声明构建。
- Create: `vitest.config.ts`，配置单元测试。
- Create: `src/index.ts`，导出 `createCliProgram`、`runCli` 和元信息。
- Create: `src/cli.ts`，作为 `bshopify` bin 入口。
- Create: `tests/cli.test.ts`，覆盖基础 help/version 和方案要求的命令注册。

### Task 1: CLI 测试先行

**Files:**
- Create: `tests/cli.test.ts`
- Create: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { createCliProgram, packageInfo } from "../src/index.js";

describe("bshopify CLI", () => {
  it("exposes the package name and version", () => {
    expect(packageInfo.name).toBe("@bestfulfill/bshopify");
    expect(packageInfo.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("registers the MVP command surface from the technical plan", () => {
    const program = createCliProgram();
    const commands = program.commands.map((command) => command.name()).sort();

    expect(commands).toEqual([
      "deploy",
      "dev",
      "guard",
      "init",
      "restore",
      "validate",
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/cli.test.ts`

Expected: FAIL because `src/index.ts` does not exist yet.

### Task 2: TypeScript CLI 最小实现

**Files:**
- Create: `src/index.ts`
- Create: `src/cli.ts`
- Create: `tsconfig.json`
- Create: `tsup.config.ts`
- Modify: `package.json`

- [ ] **Step 1: Write minimal implementation**

```ts
import { Command } from "commander";

export interface PackageInfo {
  name: string;
  version: string;
}

export const packageInfo: PackageInfo = {
  name: "@bestfulfill/bshopify",
  version: "0.1.0",
};

export function createCliProgram(): Command {
  const program = new Command();

  program
    .name("bshopify")
    .description("BestFulfill Shopify App Runner")
    .version(packageInfo.version);

  program.command("init").description("Initialize bshopify in the current Shopify app project.");
  program.command("dev").description("Run shopify app dev with temporary extension injections.");
  program.command("deploy").description("Run shopify app deploy with validation, injection, and restore.");
  program.command("validate").description("Validate runner config, Shopify config, entries, and injections.");
  program.command("guard").description("Prevent unsafe injected values or active locks from being committed.");
  program.command("restore <runId>").description("Restore files from a previous bshopify transaction.");

  return program;
}

export async function runCli(argv: string[] = process.argv): Promise<void> {
  await createCliProgram().parseAsync(argv);
}
```

- [ ] **Step 2: Run test to verify it passes**

Run: `npm test -- tests/cli.test.ts`

Expected: PASS.

### Task 3: npm 包与私有云仓配置

**Files:**
- Create: `.npmrc`
- Create: `.gitignore`
- Modify: `package.json`

- [ ] **Step 1: Configure registry and package metadata**

```toml
registry=https://packages.aliyun.com/686b883471b943e5958efa4c/npm/npm-registry/
```

`package.json` must include:

```json
{
  "name": "@bestfulfill/bshopify",
  "type": "module",
  "bin": {
    "bshopify": "./dist/cli.js"
  },
  "files": [
    "dist"
  ]
}
```

- [ ] **Step 2: Verify package checks**

Run: `npm run typecheck && npm run build`

Expected: PASS and `dist/` generated.

### Task 4: 最终校验

**Files:**
- All touched files

- [ ] **Step 1: Run full validation**

Run: `npm run check`

Expected: PASS for typecheck, tests, and build.

- [ ] **Step 2: Inspect Git status**

Run: `git status --short`

Expected: only intended project scaffold files are listed.

## 自检

- 覆盖飞书云仓：`.npmrc` 指向文档提供的阿里云 registry。
- 覆盖技术方案：包名、bin、推荐 scripts、ESM、TypeScript、tsup、vitest 与 MVP 命令面均落地。
- TypeScript 对象形状：使用 `interface PackageInfo`。
- 未把未知业务配置默认成 `0`、`Unknown`、测试地址或生产地址。
