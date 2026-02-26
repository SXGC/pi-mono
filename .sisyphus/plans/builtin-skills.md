# 添加 Builtin Skills 功能

## TL;DR

> **Quick Summary**: 为 pi 添加 builtin skills 功能，随 npm 包分发一组开箱即用的 skills（如 git-commit, playwright 等），用户可覆盖。
>
> **Deliverables**:
> - `packages/coding-agent/builtin/skills/` 目录及初始 skills
> - `skills.ts` 支持 builtin 加载逻辑
> - `--no-builtin-skills` CLI 参数
> - `builtinSkills` settings 配置项
>
> **Estimated Effort**: Medium
> **Parallel Execution**: YES - 2 waves
> **Critical Path**: Task 1 → Task 2 → Task 3 → Task 4

---

## Context

### Original Request
用户希望添加 builtin skills 功能，让 pi 自带一组开箱即用的 skills，无需用户手动安装。

### Interview Summary
**Key Discussions**:
- 覆盖机制: 用户同名 skill 优先于 builtin（可覆盖）
- 分发方式: 打包到 npm，作为 `@mariozechner/pi-coding-agent` 的一部分
- 可见性: 只读，用户如需定制则复制到自己的 skills 目录
- 存放位置: `packages/coding-agent/builtin/skills/`（不放入 agent 包，因为 skills 是 coding 领域特定的）

### Design Decisions

**优先级模型（从低到高）**:
```
builtin < packages < user/project
```

**目录结构**:
```
packages/coding-agent/
├── src/core/
│   ├── skills.ts          # 添加 builtin 加载
│   └── resource-loader.ts # 传递 includeBuiltin 参数
├── builtin/
│   └── skills/            # builtin skills 目录
│       └── <skill-name>/SKILL.md
└── package.json           # 添加 builtin 到 files
```

---

## Work Objectives

### Core Objective
实现 builtin skills 功能，让 pi 自带一组常用 skills，用户开箱即用，同时保持可覆盖的灵活性。

### Concrete Deliverables
- `packages/coding-agent/builtin/skills/` 目录
- `packages/coding-agent/src/core/skills.ts` 修改
- `packages/coding-agent/src/core/resource-loader.ts` 修改
- `packages/coding-agent/src/cli/args.ts` 修改
- `packages/coding-agent/src/core/settings-manager.ts` 修改
- `packages/coding-agent/package.json` 修改

### Definition of Done
- [x] `pi` 启动后自动加载 builtin skills
- [x] 用户同名 skill 可覆盖 builtin
- [x] `pi --no-builtin-skills` 可禁用 builtin skills
- [x] `settings.json` 中 `"builtinSkills": false` 可禁用
- [x] `pnpm check` 通过

### Must Have
- Builtin skills 加载逻辑
- 优先级：builtin < packages < user/project
- CLI 参数 `--no-builtin-skills`
- Settings 配置 `builtinSkills`

### Must NOT Have (Guardrails)
- 不修改 `packages/agent` 包
- 不创建独立的 npm 包
- 不在启动时复制 builtin skills 到用户目录
- 不改变现有 skills 加载的优先级逻辑

---

## Verification Strategy

### Test Decision
- **Infrastructure exists**: YES (vitest)
- **Automated tests**: YES (TDD)
- **Framework**: vitest
- **TDD**: 每个任务遵循 RED → GREEN → REFACTOR

### QA Policy
每个任务包含 agent-executed QA scenarios。
- **Module/Library**: 使用 vitest 运行单元测试

---

## Execution Strategy

### Parallel Execution Waves

```
Wave 1 (Foundation - 可并行):
├── Task 1: 修改 skills.ts 添加 builtin 加载逻辑 [quick]
└── Task 2: 创建 builtin/skills/ 目录结构 [quick]

Wave 2 (Integration - 依赖 Wave 1):
├── Task 3: 修改 resource-loader.ts [quick]
├── Task 4: 添加 CLI 参数和 settings 配置 [quick]
└── Task 5: 修改 package.json 和文档 [quick]

Wave 3 (Verification):
└── Task 6: 集成测试和验证 [quick]

Critical Path: Task 1 → Task 3 → Task 6
Parallel Speedup: ~50% faster than sequential
Max Concurrent: 2 (Wave 1)
```

### Dependency Matrix

- **1**: — → 3
- **2**: — → 5
- **3**: 1 → 6
- **4**: — → 6
- **5**: 2 → 6
- **6**: 3, 4, 5 —

### Agent Dispatch Summary

- **Wave 1**: 2 — T1 → `quick`, T2 → `quick`
- **Wave 2**: 3 — T3 → `quick`, T4 → `quick`, T5 → `quick`
- **Wave 3**: 1 — T6 → `quick`

---

## TODOs

- [x] 1. 修改 skills.ts 添加 builtin 加载逻辑

  **What to do**:
  - 添加 `getBuiltinSkillsDir()` 函数，定位 `builtin/skills` 目录
  - 修改 `LoadSkillsOptions` 接口，添加 `includeBuiltin?: boolean` 选项（默认 true）
  - 修改 `loadSkills()` 函数，按优先级顺序加载：builtin → packages → user/project
  - 扩展 `Skill.source` 类型，添加 `"builtin"` 值
  - 添加单元测试

  **Must NOT do**:
  - 不修改现有的优先级逻辑（后加载覆盖先加载）
  - 不改变 `Skill` 接口的其他字段

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件修改，逻辑清晰，有明确的参考模式
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 2)
  - **Blocks**: Task 3
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/coding-agent/src/core/skills.ts:355-459` - `loadSkills()` 函数，理解现有加载逻辑
  - `packages/coding-agent/src/core/skills.ts:327-336` - `LoadSkillsOptions` 接口
  - `packages/coding-agent/src/core/skills.ts:73-80` - `Skill` 接口

  **Test References**:
  - `packages/coding-agent/test/skills.test.ts` - 现有 skills 测试模式

  **Acceptance Criteria**:
  - [ ] `getBuiltinSkillsDir()` 函数存在并返回正确路径
  - [ ] `LoadSkillsOptions.includeBuiltin` 选项存在，默认 true
  - [ ] `loadSkills()` 先加载 builtin，再加载其他
  - [ ] `Skill.source` 包含 "builtin" 类型
  - [ ] `bun test packages/coding-agent/test/skills.test.ts` → PASS

  **QA Scenarios**:

  ```
  Scenario: Builtin skills directory is resolved correctly
    Tool: Bash
    Preconditions: Running from pi-mono repo root
    Steps:
      1. Run: cd packages/coding-agent && bun test -t "getBuiltinSkillsDir" test/skills.test.ts
    Expected Result: Test passes, directory resolves to packages/coding-agent/builtin/skills
    Evidence: .sisyphus/evidence/task-1-builtin-dir.test.log

  Scenario: loadSkills includes builtin skills by default
    Tool: Bash
    Preconditions: builtin/skills directory exists with at least one skill
    Steps:
      1. Run: cd packages/coding-agent && bun test -t "loadSkills includes builtin" test/skills.test.ts
    Expected Result: Test passes, builtin skills are included in result
    Evidence: .sisyphus/evidence/task-1-load-builtin.test.log

  Scenario: loadSkills excludes builtin when includeBuiltin=false
    Tool: Bash
    Preconditions: builtin/skills directory exists
    Steps:
      1. Run: cd packages/coding-agent && bun test -t "loadSkills excludes builtin" test/skills.test.ts
    Expected Result: Test passes, no builtin skills in result
    Evidence: .sisyphus/evidence/task-1-exclude-builtin.test.log
  ```

  **Commit**: YES
  - Message: `feat(coding-agent): add builtin skills loading logic`
  - Files: `packages/coding-agent/src/core/skills.ts`, `packages/coding-agent/test/skills.test.ts`
  - Pre-commit: `cd packages/coding-agent && bun test test/skills.test.ts`

- [x] 2. 创建 builtin/skills/ 目录结构

  **What to do**:
  - 创建 `packages/coding-agent/builtin/skills/` 目录
  - 创建 1-2 个示例 builtin skills（如 `example-skill/SKILL.md`）
  - 确保 SKILL.md 符合 Agent Skills 规范（有 name, description frontmatter）

  **Must NOT do**:
  - 不创建太多 skills（此任务只需创建结构和一个示例）
  - 不创建需要外部依赖的 skills

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 创建目录和示例文件，简单直接
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 1 (with Task 1)
  - **Blocks**: Task 5
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/coding-agent/test/fixtures/skills/valid-skill/SKILL.md` - 有效的 skill 示例
  - `packages/coding-agent/docs/skills.md:108-128` - SKILL.md 格式规范

  **Acceptance Criteria**:
  - [ ] `packages/coding-agent/builtin/skills/` 目录存在
  - [ ] 至少有一个有效的 skill（符合规范）
  - [ ] skill 的 frontmatter 包含 name 和 description

  **QA Scenarios**:

  ```
  Scenario: Builtin skills directory exists
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: ls -la packages/coding-agent/builtin/skills/
    Expected Result: Directory exists and contains at least one skill subdirectory
    Evidence: .sisyphus/evidence/task-2-dir-exists.log

  Scenario: Builtin skill is valid
    Tool: Bash
    Preconditions: Builtin skill exists
    Steps:
      1. Run: cat packages/coding-agent/builtin/skills/*/SKILL.md | head -20
    Expected Result: Output shows valid frontmatter with name and description
    Evidence: .sisyphus/evidence/task-2-skill-valid.log
  ```

  **Commit**: YES
  - Message: `feat(coding-agent): add builtin skills directory with initial skills`
  - Files: `packages/coding-agent/builtin/skills/`
  - Pre-commit: None

- [x] 3. 修改 resource-loader.ts 集成 builtin skills

  **What to do**:
  - 在 `DefaultResourceLoaderOptions` 中添加 `noBuiltinSkills?: boolean` 选项
  - 在 `DefaultResourceLoader` 类中添加 `noBuiltinSkills` 属性
  - 修改 `updateSkillsFromPaths()` 方法，传递 `includeBuiltin` 参数给 `loadSkills()`
  - 添加单元测试

  **Must NOT do**:
  - 不修改 `loadSkills()` 的默认行为（默认加载 builtin）
  - 不改变现有的 skills 加载流程

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 单文件修改，跟随现有模式
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 2
  - **Blocks**: Task 6
  - **Blocked By**: Task 1

  **References**:

  **Pattern References**:
  - `packages/coding-agent/src/core/resource-loader.ts:450-475` - `updateSkillsFromPaths()` 方法
  - `packages/coding-agent/src/core/resource-loader.ts:114-148` - `DefaultResourceLoaderOptions` 接口

  **Test References**:
  - `packages/coding-agent/test/resource-loader.test.ts` - 现有 resource-loader 测试模式

  **Acceptance Criteria**:
  - [ ] `DefaultResourceLoaderOptions.noBuiltinSkills` 选项存在
  - [ ] `updateSkillsFromPaths()` 传递 `includeBuiltin` 参数
  - [ ] `bun test packages/coding-agent/test/resource-loader.test.ts` → PASS

  **QA Scenarios**:

  ```
  Scenario: ResourceLoader includes builtin skills by default
    Tool: Bash
    Preconditions: builtin/skills directory exists
    Steps:
      1. Run: cd packages/coding-agent && bun test -t "ResourceLoader builtin" test/resource-loader.test.ts
    Expected Result: Test passes, builtin skills are loaded
    Evidence: .sisyphus/evidence/task-3-include-builtin.test.log

  Scenario: ResourceLoader excludes builtin when noBuiltinSkills=true
    Tool: Bash
    Preconditions: builtin/skills directory exists
    Steps:
      1. Run: cd packages/coding-agent && bun test -t "ResourceLoader no builtin" test/resource-loader.test.ts
    Expected Result: Test passes, no builtin skills loaded
    Evidence: .sisyphus/evidence/task-3-exclude-builtin.test.log
  ```

  **Commit**: YES
  - Message: `feat(coding-agent): integrate builtin skills in resource loader`
  - Files: `packages/coding-agent/src/core/resource-loader.ts`, `packages/coding-agent/test/resource-loader.test.ts`
  - Pre-commit: `cd packages/coding-agent && bun test test/resource-loader.test.ts`

- [x] 4. 添加 CLI 参数和 settings 配置

  **What to do**:
  - 在 `args.ts` 中添加 `--no-builtin-skills` CLI 参数
  - 在 `settings-manager.ts` 中添加 `builtinSkills` 配置项（默认 true）
  - 在 `DefaultResourceLoader` 初始化时读取配置并传递 `noBuiltinSkills`
  - 添加单元测试

  **Must NOT do**:
  - 不改变现有的 CLI 参数解析逻辑
  - 不添加其他无关的配置项

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 跟随现有模式添加参数和配置
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3, 5)
  - **Blocks**: Task 6
  - **Blocked By**: None

  **References**:

  **Pattern References**:
  - `packages/coding-agent/src/cli/args.ts` - 现有 CLI 参数定义模式
  - `packages/coding-agent/src/core/settings-manager.ts` - 现有 settings 定义模式

  **Acceptance Criteria**:
  - [ ] `--no-builtin-skills` CLI 参数存在
  - [ ] `builtinSkills` settings 配置项存在
  - [ ] CLI 参数和 settings 正确传递给 ResourceLoader
  - [ ] `bun test` → PASS

  **QA Scenarios**:

  ```
  Scenario: --no-builtin-skills CLI flag works
    Tool: Bash
    Preconditions: pi built
    Steps:
      1. Run: cd packages/coding-agent && pi --no-builtin-skills --help 2>&1 | head -5
    Expected Result: No error, help output shown
    Evidence: .sisyphus/evidence/task-4-cli-flag.log

  Scenario: builtinSkills settings option works
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: cd packages/coding-agent && bun test -t "builtinSkills setting" test/settings-manager.test.ts
    Expected Result: Test passes
    Evidence: .sisyphus/evidence/task-4-settings.test.log
  ```

  **Commit**: YES
  - Message: `feat(coding-agent): add --no-builtin-skills CLI flag and settings option`
  - Files: `packages/coding-agent/src/cli/args.ts`, `packages/coding-agent/src/core/settings-manager.ts`
  - Pre-commit: `pnpm check`

- [x] 5. 修改 package.json 包含 builtin 目录

  **What to do**:
  - 在 `packages/coding-agent/package.json` 的 `files` 数组中添加 `builtin`
  - 更新 `packages/coding-agent/README.md` 文档说明 builtin skills
  - 更新 `packages/coding-agent/CHANGELOG.md` 添加变更记录

  **Must NOT do**:
  - 不修改 dependencies
  - 不修改其他无关的 package.json 字段

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 配置文件修改，简单直接
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: YES
  - **Parallel Group**: Wave 2 (with Task 3, 4)
  - **Blocks**: Task 6
  - **Blocked By**: Task 2

  **References**:

  **Pattern References**:
  - `packages/coding-agent/package.json:8-11` - 现有 `files` 配置
  - `packages/coding-agent/CHANGELOG.md` - 变更记录格式

  **Acceptance Criteria**:
  - [ ] `package.json` 的 `files` 包含 `builtin`
  - [ ] README.md 提及 builtin skills
  - [ ] CHANGELOG.md 有变更记录

  **QA Scenarios**:

  ```
  Scenario: package.json includes builtin directory
    Tool: Bash
    Preconditions: None
    Steps:
      1. Run: cat packages/coding-agent/package.json | grep -A5 '"files"'
    Expected Result: Output shows "builtin" in files array
    Evidence: .sisyphus/evidence/task-5-package-json.log
  ```

  **Commit**: YES
  - Message: `chore(coding-agent): include builtin directory in npm package`
  - Files: `packages/coding-agent/package.json`, `packages/coding-agent/README.md`, `packages/coding-agent/CHANGELOG.md`
  - Pre-commit: None

- [x] 6. 集成测试和验证

  **What to do**:
  - 添加端到端测试验证 builtin skills 加载
  - 添加测试验证用户 skill 可覆盖 builtin
  - 添加测试验证 `--no-builtin-skills` 禁用功能
  - 运行 `pnpm check` 确保无错误

  **Must NOT do**:
  - 不跳过任何验证步骤
  - 不忽略测试失败

  **Recommended Agent Profile**:
  - **Category**: `quick`
    - Reason: 测试验证，需要等待所有前置任务完成
  - **Skills**: []

  **Parallelization**:
  - **Can Run In Parallel**: NO
  - **Parallel Group**: Wave 3 (Final)
  - **Blocks**: None
  - **Blocked By**: Task 3, 4, 5

  **References**:

  **Pattern References**:
  - `packages/coding-agent/test/skills.test.ts` - 现有测试模式

  **Acceptance Criteria**:
  - [ ] 所有测试通过
  - [ ] `pnpm check` 无错误
  - [ ] Builtin skills 正确加载
  - [ ] 用户 skill 可覆盖 builtin
  - [ ] `--no-builtin-skills` 正常工作

  **QA Scenarios**:

  ```
  Scenario: All tests pass
    Tool: Bash
    Preconditions: All code changes complete
    Steps:
      1. Run: pnpm check
    Expected Result: No errors, all checks pass
    Evidence: .sisyphus/evidence/task-6-pnpm-check.log

  Scenario: Builtin skills load on startup
    Tool: Bash
    Preconditions: pi built
    Steps:
      1. Run: cd packages/coding-agent && bun test -t "builtin skills load" test/
    Expected Result: Test passes
    Evidence: .sisyphus/evidence/task-6-builtin-load.test.log

  Scenario: User skill overrides builtin
    Tool: Bash
    Preconditions: User has skill with same name as builtin
    Steps:
      1. Run: cd packages/coding-agent && bun test -t "override builtin" test/
    Expected Result: Test passes, user skill takes precedence
    Evidence: .sisyphus/evidence/task-6-override.test.log
  ```

  **Commit**: YES
  - Message: `test(coding-agent): add tests for builtin skills feature`
  - Files: `packages/coding-agent/test/skills.test.ts`
  - Pre-commit: `pnpm check`

---

- [x] F1. **Plan Compliance Audit** — `oracle`
  验证所有 Must Have 已实现，所有 Must NOT Have 未实现。
  验证所有 Must Have 已实现，所有 Must NOT Have 未实现。

- [x] F2. **Code Quality Review** — `unspecified-high`
  运行 `pnpm check`，确保无 type errors、lint errors。
  运行 `pnpm check`，确保无 type errors、lint errors。

- [x] F3. **Integration QA** — `unspecified-high`
  启动 pi，验证 builtin skills 加载、覆盖、禁用功能正常。
  启动 pi，验证 builtin skills 加载、覆盖、禁用功能正常。

- [x] F4. **Scope Fidelity Check** — `deep`
  确认修改范围符合预期，无 scope creep。
  确认修改范围符合预期，无 scope creep。

---

## Commit Strategy

- **1**: `feat(coding-agent): add builtin skills loading logic`
- **2**: `feat(coding-agent): add builtin skills directory with initial skills`
- **3**: `feat(coding-agent): integrate builtin skills in resource loader`
- **4**: `feat(coding-agent): add --no-builtin-skills CLI flag and settings option`
- **5**: `chore(coding-agent): include builtin directory in npm package`
- **6**: `test(coding-agent): add tests for builtin skills feature`

---

## Success Criteria

### Verification Commands
```bash
pnpm check                                    # Expected: no errors
pnpm test -- --filter builtin                 # Expected: all tests pass
pi --list-skills                              # Expected: shows builtin skills
pi --no-builtin-skills --list-skills          # Expected: no builtin skills
```

### Final Checklist
- [x] All "Must Have" present
- [x] All "Must NOT Have" absent
- [x] All tests pass
- [x] `pnpm check` passes
- [x] Builtin skills 加载正常
- [x] 用户 skill 可覆盖 builtin
- [x] `--no-builtin-skills` 正常工作
- [x] `builtinSkills: false` settings 正常工作
