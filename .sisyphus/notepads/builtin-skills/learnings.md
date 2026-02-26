
## 2026-02-25: Created builtin skills directory structure

- Created `packages/coding-agent/builtin/skills/git-commit/SKILL.md`
- Skill format follows Agent Skills standard with YAML frontmatter (name, description)
- Directory name must match skill name in frontmatter
- No emoji in commit messages (project convention)

## 2026-02-25: Builtin skills loading logic

### Implementation Pattern
- Use `import.meta.url` + `fileURLToPath` to get current module path in ESM
- Resolve builtin directory relative to compiled `dist/core` directory: `resolve(currentDir, "../../builtin/skills")`
- Builtin skills have lowest priority (loaded first), followed by user skills, then project skills

### Key Code Locations
- `packages/coding-agent/src/core/skills.ts`:
  - `getBuiltinSkillsDir()` - returns path to builtin/skills directory
  - `LoadSkillsOptions.includeBuiltin` - option to control builtin loading (default: true)
  - `loadSkills()` - loads builtin skills first before user/project skills
  - `Skill.source` - JSDoc documents valid values: "builtin", "user", "project", "path"

### Test Pattern
- Use `includeBuiltin: false` in existing tests to isolate test behavior from builtin skills
- Test builtin skills with `includeDefaults: false` to isolate from user/project skills
- Created test fixture at `packages/coding-agent/builtin/skills/test-builtin-skill/SKILL.md`

### Priority Order (lowest to highest)
1. builtin (from `packages/coding-agent/builtin/skills/`)
2. user (from `~/.pi/agent/skills/`)
3. project (from `.pi/skills/`)
4. explicit skillPaths

Later loaded skills with same name override earlier ones (collision detection with diagnostic).

## 2026-02-25: CLI and settings support for disabling builtin skills

### Implementation
- Added `--no-builtin-skills` CLI flag to `args.ts` (follows pattern of `--no-skills`)
- Added `noBuiltinSkills?: boolean` to `Args` interface
- Added `builtinSkills?: boolean` to `Settings` interface (default: true)
- Added `getBuiltinSkills(): boolean` and `setBuiltinSkills(enabled: boolean)` methods to `SettingsManager`

### Pattern Reference
- CLI flag pattern: `packages/coding-agent/src/cli/args.ts:139` - `--no-skills` parsing
- Settings getter pattern: `packages/coding-agent/src/core/settings-manager.ts:781-789` - `getEnableSkillCommands()`
