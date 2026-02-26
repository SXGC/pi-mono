---
name: git-commit
description: Generate semantic git commit messages that provide a complete narrative for future code archaeology.
---

# Git Commit Guide

Use this skill when the user asks to commit changes, create a commit, or write a commit message.

## Purpose

Generate commit messages that serve as historical documentation. Each commit should tell a story that future developers (including yourself) can understand months or years later.

## Commit Message Format

```
<type>(<scope>): <subject>

[optional body]

[optional footer]
```

### Types

- `feat`: New feature
- `fix`: Bug fix
- `docs`: Documentation changes
- `style`: Code style changes (formatting, semicolons, etc.)
- `refactor`: Code restructuring without changing behavior
- `perf`: Performance improvement
- `test`: Adding or modifying tests
- `chore`: Build process, dependencies, tooling
- `ci`: CI/CD configuration changes
- `revert`: Revert a previous commit

### Scopes

Optional but recommended. Examples:
- `api`: API-related changes
- `ui`: User interface changes
- `db`: Database changes
- `auth`: Authentication/authorization
- `core`: Core functionality

### Subject Rules

1. Use imperative mood: "add feature" not "added feature"
2. No period at the end
3. Limit to 50 characters when possible
4. Do not capitalize first letter (unless it's a proper noun)
5. Be specific, not vague

### Body Rules

1. Separate from subject with blank line
2. Explain what and why, not how
3. Use bullet points for multiple changes
4. Wrap at 72 characters

### Footer

- Reference issues: `fixes #123`, `closes #456`, `refs #789`
- Breaking changes: `BREAKING CHANGE: description`

## Workflow

1. Run `git status` and `git diff` to understand changes
2. Identify the primary purpose of the change
3. Determine the type and scope
4. Write a clear, descriptive subject
5. Add body if changes are complex or non-obvious
6. Include issue references if applicable

## Examples

### Simple feature
```
feat(api): add rate limiting to user endpoints
```

### Bug fix with context
```
fix(auth): prevent session fixation on login

Session IDs were not being regenerated after successful
authentication, allowing potential session fixation attacks.

fixes #234
```

### Breaking change
```
refactor(db): migrate from MySQL to PostgreSQL

BREAKING CHANGE: All database connections must now use
PostgreSQL connection strings. MySQL is no longer supported.
```

### Multiple related changes
```
feat(dashboard): add real-time metrics display

- Add WebSocket connection for live updates
- Implement metric aggregation service
- Add chart components for visualization
- Update dashboard layout to accommodate new widgets

refs #89
```

## Anti-Patterns

Avoid these commit message styles:

- Too vague: "fix bug", "update code", "changes"
- Too generic: "misc", "various fixes", "cleanup"
- Describing how: "changed x to y" (explain why instead)
- Issue numbers only: "#123" without context
- WIP commits in main branch history

## Pre-Commit Checklist

Before committing, verify:

1. Changes are logically grouped (not mixing unrelated changes)
2. Commit message follows the format above
3. No secrets or credentials in the diff
4. Tests pass if applicable
5. Commit references the relevant issue if one exists
