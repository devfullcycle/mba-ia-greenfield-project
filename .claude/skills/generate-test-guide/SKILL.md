---
name: generate-test-guide
description: >
  Analyzes a project's tech stack, searches the web for testing best practices,
  asks the user clarifying questions, and generates a project-specific testing
  multi-file skill at `.claude/skills/testing-guide-<project>/` with main SKILL.md and artifact/reference sub-files. Invoke with `/generate-test-guide <project-folder>`.
disable-model-invocation: true
---

# Generate Test Guide

You are a testing architecture expert. Your job is to analyze a project, research its stack, consult the user, and produce a **concrete, project-specific testing skill** file.

**Input:** `$ARGUMENTS` is the path to the project folder (default: current working directory).

**Output:** a multi-file skill at `.claude/skills/testing-guide-<project>/` (e.g., `testing-guide-nestjs-project`) with a main `SKILL.md` (~200-250 lines) and detailed guides in `artifacts/` and `references/` subdirectories. Each project gets its own skill, enabling monorepo support.

---

## Phase 1 — Project Analysis

First, read `.claude/skills/generate-test-guide/testing-fundamentals.md` — this contains universal testing principles that serve as the foundation. Having these loaded early allows you to filter web research results against them in Phase 2.

Then explore the project at the given path. Collect the following:

### 1.1 Languages & Frameworks
- Read manifest files: `package.json`, `go.mod`, `requirements.txt`, `pyproject.toml`, `Cargo.toml`, `pom.xml`, `build.gradle`, `composer.json`, `Gemfile`, etc.
- Identify the primary language(s), framework(s), and their versions.

### 1.2 Test Runner & Framework
- Detect test tooling: jest, vitest, pytest, go test, mocha, jasmine, RSpec, PHPUnit, JUnit, cargo test, etc.
- Read test configuration files: `jest.config.*`, `vitest.config.*`, `pytest.ini`, `setup.cfg`, `tsconfig.spec.json`, test sections in `package.json`, etc.

### 1.3 Application Artifacts

Detect the ecosystem's **artifact identification strategy** — how does this ecosystem organize and name its artifact types? This determines how artifact types are grouped and labeled throughout the guide.

Identify which strategy applies using this reference table:

| Strategy | When it applies | Example |
|---|---|---|
| **Suffix convention** | Framework enforces naming (NestJS, Angular, Laravel) | `*.service.ts`, `*.controller.ts` |
| **Filename convention** | Framework uses well-known filenames (Django, Flask) | `views.py`, `models.py` |
| **Directory convention** | Structure determined by folder (Go packages, some Python) | `handlers/*.go` |
| **Partial suffix** | Framework uses trailing name pattern (Rails) | `*_controller.rb` |
| **Decorator/base-class** | No naming convention; type identified by code pattern (plain Python/JS, FastAPI) | `@router.get decorated functions` |
| **Mixed** | Ecosystem uses a combination | Use the most specific identifier available for each type |

When a single file contains multiple artifact types (common in Python, plain JS/TS), identify types by **code construct** (class, function, decorator, signature) rather than file pattern. Examples:
- Python FastAPI: `Dependency Injectors (functions used in Depends(...))` — code pattern, not file pattern
- Django: `Model classes (classes in models.py inheriting django.db.models.Model)` — file + code pattern
- Plain TS: `Express middleware (functions matching (req, res, next) signature)` — signature-based

Then perform the artifact inventory:

1. **Group artifacts by type** using the detected identification strategy
2. **For each type:** list instances, classify each against the fundamentals' Layer Assignment Table patterns (has branching? crosses system boundary? configured lib? etc.)
3. **Identify the dominant testing pattern** per type — what layer(s) most instances of this type should be tested at
4. **Note exceptions** — instances that deviate from the dominant pattern for their type (e.g., a service that only delegates without branching, unlike most services)
5. **Identify common framework artifact types NOT yet present** in the project — e.g., NestJS has pipes, interceptors, filters; Django has signals, management commands, template tags. These will receive proactive guidance in the generated guide.

### 1.4 External Systems
- Identify all external dependencies: databases (PostgreSQL, MySQL, MongoDB, SQLite), caches (Redis, Memcached), message queues (RabbitMQ, Kafka, SQS, BullMQ), email (SMTP, SendGrid), object storage (S3, MinIO), external HTTP APIs, payment gateways, etc.
- Check Docker Compose files, `.env` files, and configuration modules for clues.

### 1.5 Existing Test Patterns
- Find existing test files and identify naming conventions: `*.spec.ts`, `*.test.ts`, `*.e2e-spec.ts`, `*_test.go`, `test_*.py`, etc.
- Note directory structure: colocated tests vs `test/` or `tests/` directories.
- Count existing tests to understand current coverage level.

### 1.6 Existing Test Skills & Rules
- Check if `.claude/skills/` already has testing-related skills (e.g., `test-guide`).
- Check if `.claude/rules/` already has testing-related rules.
- Read them to understand what's already documented and avoid contradictions.

Compile all findings into a structured summary (keep it internal — do not output to the user yet).

---

## Phase 2 — Web Research

For each major technology/framework detected, use **WebSearch** to find:

1. **Testing best practices** for the framework — search both broadly and version-specifically to maximize useful results (e.g., "NestJS testing best practices" AND "NestJS 11 testing best practices", using the version detected in Phase 1)
2. **How to test each artifact type** — search for testing guidance specific to each artifact type in the detected framework (e.g., "how to test NestJS guards", "testing NestJS pipes best practices", "testing NestJS interceptors"). Also search for types not yet present in the project, as these will receive proactive guidance.
3. **Mock vs real strategies** for the external systems detected (e.g., "testing with real PostgreSQL Docker vs mocking", "NestJS testing with TypeORM real database")
4. **Common testing pitfalls** for the stack (e.g., "Jest common mistakes NestJS", "e2e testing gotchas Express")

**Version-aware curation:** when evaluating search results, use the framework and library versions detected in Phase 1 as a compatibility filter. Discard advice that references APIs, decorators, configuration options, or patterns introduced in versions newer than what the project uses — this applies to frameworks (e.g., NestJS), ORMs (e.g., TypeORM), test runners (e.g., Jest), and any other dependency in the stack. If a result doesn't specify which version it applies to, cross-check its recommendations against the project's actual dependency versions before including them. This is especially important for projects using older versions, where modern best practices may reference features that don't exist in the project's stack.

Extract actionable insights — concrete patterns, recommended libraries, configuration tips, and pitfalls to avoid. Discard advice that applies to any project regardless of technology (e.g., "write small focused tests", "use descriptive names") — keep only advice specific to the detected frameworks, versions, or external systems that goes beyond what the fundamentals already cover.

---

## Phase 3 — User Questions

Output a structured message to the user with your findings and all questions below. Then use **AskUserQuestion** to wait for their response before proceeding to Phase 4.

### Summary to present (required elements)

The summary must include:
1. Detected languages, framework names, and versions
2. Detected test runner and configuration files
3. Type-grouped artifact summary showing instance counts and dominant testing patterns per type (e.g., "Services (*.service.ts): 2 instances — AuthService [branching → unit], UsersService [DB access → integration]. Dominant pattern: depends on characteristics."). Also list common framework artifact types not yet present in the project (e.g., "Not yet present: pipes, interceptors, filters, exception filters").
4. List of all external systems found
5. Summary of existing test file patterns and naming conventions
6. Any contradictions found between existing skills/rules (if any — ask the user for resolution)

### Questions to ask

1. **Confirmation** — "I detected [technologies/frameworks/external systems]. Is this accurate? Anything missing?"
2. **Test layers** — "Which test layers do you want covered? (unit / integration / e2e / all three)"
   - Note: always include module compilation and configured-lib tests in the generated guide regardless of the user's layer selection — these are mandatory per the fundamentals.
3. **External system strategy** — "For each external system, how should tests interact with it?"
   - Provide a pre-filled table based on your analysis with recommended defaults from the fundamentals' "Real vs Fake" table.
   - For any external system not covered in the fundamentals' table, apply the decision rule: if it can run locally in Docker in under 5 seconds with no external cost or flakiness risk, default to real; otherwise default to fake.
   - Ask the user to confirm or override each row.
4. **Team conventions** — "Are there any team-specific testing rules, naming conventions, or policies I should incorporate?"
5. **Coverage philosophy** — "What's the team's testing philosophy?"
   - **Pragmatic** — test what matters: focus on business-critical paths and system boundaries; skip tests for trivial or low-risk code.
   - **Thorough** — high coverage targets: include coverage targets in the File Conventions section; test more edge cases.
   - **Specific guidance** — let the user describe their own approach.

---

## Phase 4 — Generate the Testing Skill

### 4.1a Compose the main SKILL.md

The skill directory and name are derived from the project folder name: `.claude/skills/testing-guide-<project>/`.

For example, if `$ARGUMENTS` is `nestjs-project`, the output directory is `.claude/skills/testing-guide-nestjs-project/`. This allows multiple project-specific testing guides to coexist in a monorepo.

The generated skill uses a **multi-file structure** — the main `SKILL.md` stays compact (~200-250 lines) while detailed guides live in sub-files:

```
.claude/skills/testing-guide-<project>/
├── SKILL.md                        (~200-230 lines — core rules + quick reference)
├── artifacts/                      (1 file per artifact type)
│   ├── entities.md
│   ├── services.md
│   ├── modules.md
│   ├── controllers.md
│   ├── dtos.md
│   ├── guards.md
│   └── ...                         (one file per detected or anticipated type)
└── references/                     (supporting content)
    ├── external-systems.md
    ├── mock-health-rules.md
    ├── file-conventions.md
    └── gotchas.md
```

Sub-files are **not loaded automatically** — Claude reads them only when the SKILL.md's instructions direct it to, based on the artifact type being worked on.

**Critical: use code-inline references, NOT markdown links.** All references to sub-files in the generated SKILL.md must use backtick notation (`` `artifacts/entities.md` ``) instead of markdown links (`[artifacts/entities.md](artifacts/entities.md)`). Markdown links risk the agent proactively loading all linked files, defeating the lazy-loading design. The SKILL.md is an index — the agent reads sub-files on demand based on the task context.

**Critical: the generated skill is a reference document only.** It must NOT include Writing mode, Audit mode, or any workflow/orchestration sections. Those modes live exclusively in the existing `test-guide` skill. The generated skill contains only concrete rules and tables for the specific project.

Generate the main `SKILL.md` with the following structure:

#### Frontmatter

```yaml
---
name: testing-guide-<project>
description: >
  Testing guide for <project>. Reference this skill when planning features,
  implementing code, creating tests, or reviewing changes in <project>.
  Covers what to test, at which layer, and how to set up each test —
  organized by artifact type.
  Triggers on: planning <project> features, implementing <project> features,
  writing tests for <project>, reviewing <project> code, reviewing <project> tests,
  what should I test in <project>, how to test <project>, <project> test guide.
---
```

Replace `<project>` with the actual project folder name. The trigger phrases must be **project-scoped** — do NOT use generic triggers like "write tests" or "add tests for" because those are already registered by the existing `test-guide` skill. Technologies are documented inside the guide body (Testability Foundations), not in the trigger description. Triggers must cover the full development lifecycle — planning, implementation, testing, and review — not just test writing. The testing guide is most valuable when loaded BEFORE code is written, during planning, so test strategy informs the implementation. Include triggers for feature planning and implementation alongside test-specific triggers.

#### Body Sections

**§0. Purpose**

State the guide's objective and explain the multi-file structure. Template:

> This guide helps you decide **what to test**, at **which layer**, and **how to set up tests** for each type of artifact in `<project>`. When working on a specific artifact type, read the corresponding guide in `artifacts/` for the complete recipe. Supporting references (mock strategies, file conventions, gotchas) are in `references/`.

Adapt the artifact type names mentioned to match the actual types found in the project and common framework types.

**§1. Testability Foundations**

Bridge the universal testing fundamentals with the framework-specific research findings. This section explains the "why" behind the testing decisions in the guide — not just rules, but the reasoning that connects the fundamentals to the specific framework.

Content must include:
- The core testability principles from the fundamentals, adapted to the project's framework (e.g., "In NestJS, the DI container makes it natural to mock owned services via `useValue` providers — this is why unit tests mock service boundaries rather than internal methods")
- Key findings from the web research that reinforce or nuance the fundamentals for this specific framework/stack — noting version-specific behaviors or limitations when relevant (e.g., API differences between major versions, deprecated patterns, features not yet available in the project's version)
- The mock boundary principle translated to concrete framework terms (e.g., "Mock across module boundaries, not within. If AuthService depends on UsersService, mock UsersService in AuthService's unit test because UsersService has its own tests. But use real JwtModule because it's a configured lib — mocking it hides config bugs.")
- Why certain layers exist for this framework (e.g., "NestJS module compilation tests exist because the DI container resolves at runtime, not compile time — a missing import or wrong provider only fails when the module initializes")

This section provides the foundation that justifies every decision in the artifact guides that follow. Do NOT write generic platitudes — every statement must be concrete reasoning for THIS stack.

**§2. Testing Criteria**

Adapt the "Worth testing" and "NOT worth testing" lists from the fundamentals to the project's specific context. Anchor bullets to **artifact types and code patterns** rather than individual instances. For example, use "Services with branching logic (e.g., AuthService)" instead of listing each service separately. Each bullet must either (a) name a specific artifact type or pattern from the project or (b) be removed if that pattern does not appear in the project. Do not include generic bullets with no project-specific anchor.

**§3. Feature Implementation Checklist**

Produce a checklist template that developers use when implementing a new feature. The checklist maps each artifact type to its required test layers, with **backtick paths to the corresponding artifact guides** (not markdown links) instead of section numbers. Format:

```
## 3. Feature Implementation Checklist

When implementing a new feature, use this checklist to ensure all artifacts have appropriate test coverage. For each artifact created or modified, check the required test layers:

| Artifact created | Required tests | Guide |
|---|---|---|
| Entity (`*.entity.ts`) | Integration: constraints, defaults, select:false | `artifacts/entities.md` |
| Service with branching + DB | Unit: branch logic (mock repo) + Integration: DB contract | `artifacts/services.md` |
| Service with DB only | Integration: DB contract | `artifacts/services.md` |
| Service with configured lib | Unit: real lib with test config | `artifacts/services.md` |
| Module with configured imports | Unit: compilation test | `artifacts/modules.md` |
| Controller | E2E only — do NOT write unit tests | `artifacts/controllers.md` |
| DTO | E2E: one validation wiring test per endpoint | `artifacts/dtos.md` |
| Guard (simple, delegates to Passport) | E2E only | `artifacts/guards.md` |

**How to use:** After implementing a feature, walk through each row. For each artifact you created or modified, read the corresponding guide and verify the tests exist. If a row doesn't apply (you didn't create that artifact type), skip it.
```

The generator should adapt the artifact types, identification patterns, and guide paths to match the project's stack (detected in Phase 1.3).

**§4. Artifact Type Quick Reference**

Generate a compact navigation table that directs to the corresponding artifact guide file. This is the key section — it replaces the inline artifact guides (~657 lines) with on-demand sub-files. Format:

```markdown
## 4. Artifact Type Testing Guide

When creating or modifying an artifact, read the corresponding guide for the complete recipe.

| Artifact Type | Pattern | Test Layer(s) | Guide |
|---|---|---|---|
| Entities | `*.entity.ts` | Integration (real DB) | `artifacts/entities.md` |
| Services | `*.service.ts` | Unit and/or Integration | `artifacts/services.md` |
| Modules | `*.module.ts` | Unit (compilation) | `artifacts/modules.md` |
| Controllers | `*.controller.ts` | E2E only | `artifacts/controllers.md` |
| DTOs | `*.dto.ts` | E2E (validation wiring) | `artifacts/dtos.md` |
| Guards | `*.guard.ts` | E2E or Unit (depends) | `artifacts/guards.md` |
| Pipes | `*.pipe.ts` | Unit | `artifacts/pipes.md` |
| Interceptors | `*.interceptor.ts` | Unit and/or E2E | `artifacts/interceptors.md` |
| Filters | `*.filter.ts` | Unit and/or E2E | `artifacts/filters.md` |
| Middleware | `*.middleware.ts` | E2E | `artifacts/middleware.md` |
| Strategies | `*.strategy.ts` | E2E (via guard) | `artifacts/strategies.md` |
| Future types | — | — | `artifacts/future-types.md` |
```

The table must use the artifact identification strategy detected in Phase 1.3. Include all types found in the project AND common framework types not yet present. Use kebab-case filenames derived from the type name.

**§5. Anti-patterns — Do NOT Do This**

Produce an explicit list of testing anti-patterns specific to the project's stack. This section consolidates prohibitions, referencing artifact guides and reference files instead of section numbers. Template:

```
## 5. Anti-patterns — Do NOT Do This

- ❌ **Unit test controllers** — controllers are thin delegation layers; test via E2E only (see `artifacts/controllers.md`)
- ❌ **Mock configured libs** (JwtService, CacheManager, ThrottlerGuard) — use real instances with test config; mocking hides configuration bugs (§1 Testability Foundations)
- ❌ **Skip integration tests for services with DB access** — unit tests with mocked repos don't prove queries are correct (see `artifacts/services.md`)
- ❌ **Skip module compilation tests** — TypeScript catches type errors but cannot catch DI wiring errors; a missing import only fails at runtime (see `artifacts/modules.md`)
- ❌ **Use `repository.delete({})` for cleanup** — throws on empty criteria; use `dataSource.query('DELETE FROM table')` (see `references/gotchas.md`)
- ❌ **Write mirror tests** — assertions that copy the implementation's return value prove nothing (§2 Testing Criteria)
- ❌ **Forget `afterAll(() => app.close())`** — causes Jest to hang (see `references/gotchas.md`)
```

The generator should derive anti-patterns from:
1. The "NOT worth testing" criteria
2. The Layer Assignment Table prohibitions (❌ marks)
3. Stack-specific gotchas from web research
4. The mock boundary principle (what NOT to mock)

Adapt the anti-pattern list to the project's specific stack, referencing the correct artifact guides and reference files.

**§6. E2E Terminology Note**

Include a note clarifying that this guide uses "E2E" to mean HTTP-layer integration tests (e.g., supertest-style request-to-response chain), not browser-based or multi-service end-to-end tests. This prevents confusion when developers cross-reference industry sources that use "E2E" differently.

**§7. References**

Generate an index of the reference files in `references/`. Format:

```markdown
## 7. References

| Topic | File |
|---|---|
| External system mock strategies | `references/external-systems.md` |
| Mock health rules & boundary principle | `references/mock-health-rules.md` |
| File naming, directory structure, coverage | `references/file-conventions.md` |
| Stack-specific gotchas & pitfalls | `references/gotchas.md` |
```

**§8. How to Use This Guide**

Include instructions for navigating the multi-file structure. Template:

```markdown
## 8. How to Use This Guide

This guide is organized as a multi-file skill:
- **This file (SKILL.md)** — always loaded. Contains core rules, quick reference, and anti-patterns.
- **`artifacts/`** — one file per artifact type. Read the relevant file when creating or modifying that type.
- **`references/`** — supporting content. Read when you need details on mock strategies, file conventions, or gotchas.

When working on a feature:
1. Check §3 (Feature Implementation Checklist) to identify which artifacts need tests
2. Read the corresponding `artifacts/*.md` file for the complete testing recipe
3. Consult `references/` files as needed for mock strategies, conventions, or pitfalls
```

---

### 4.1b Compose artifact guide files

Create one file per artifact type in the `artifacts/` directory. Use kebab-case filenames derived from the type name (e.g., `entities.md`, `services.md`, `controllers.md`).

Each artifact guide file follows this template:

```markdown
> Part of the `testing-guide-<project>` skill (see `../SKILL.md`).

# [Artifact Type] (`<identification pattern>`)

## What to test
(cross fundamentals + web research — concrete aspects to verify for this type)

## Layer assignment
(when unit / integration / e2e, with conditions — ALL possible combinations)

## Setup pattern
(reusable code template — not tied to a specific instance)

## When to skip
(NOT worth testing criteria applied to this type)

## Examples from project
(instances classified with reasoning)
```

Key principles for artifact guides:

- The `<identification pattern>` must use the artifact identification strategy detected in Phase 1.3. Use the strategy consistently:
  - Suffix convention: `Services (*.service.ts)`
  - Filename convention: `Views (views.py)`
  - Directory convention: `Handlers (handlers/*.go)`
  - Partial suffix: `Controllers (*_controller.rb)`
  - Decorator/base-class: `Route Handlers (@router.get decorated functions)`
- **No YAML frontmatter** — these are reference documents, not standalone skills
- Include a back-reference to the main SKILL.md at the top
- Setup patterns must be **reusable templates**, not instance-specific. A developer creating a new artifact of that type should be able to copy the template and adapt it.
- Layer assignments must trace back to fundamentals' Layer Assignment Table.
- **Multi-layer coverage**: An artifact type can require MORE than one test layer depending on its characteristics. The layer assignment section of each type must present all possible combinations, not just a single layer. For example, a service type should cover:
  - Branching only, no system boundary → unit only
  - DB access only, no branching → integration only
  - Branching + DB access → unit (test branches with mocked DB) AND integration (test DB contract with real DB)
  - Branching + configured lib (JWT, cache) → unit with real lib + test config
  - The guide must make clear WHEN a component needs tests at multiple layers and what each layer validates (unit tests the logic, integration tests the contract — neither substitutes the other)

Start with the most common artifact types found in the project (by instance count). Always generate a **`future-types.md`** file as the last artifact guide, covering common framework types not yet present in the project (e.g., interceptors, pipes, filters for NestJS). Include proactive guidance for when they are added.

The list of artifact files to generate must match exactly the types listed in the §4 Quick Reference table in the main SKILL.md.

---

### 4.1c Compose reference files

Create reference files in the `references/` directory. Each file follows the same pattern: no YAML frontmatter, with a back-reference at the top using `> Part of the testing-guide-<project> skill (see ../SKILL.md).` — this applies to **all** reference files.

**`references/external-systems.md`**
For each external system in the project, specify:
- Whether to use real (Docker) or fake (mock/in-memory)
- Which library or approach to use for faking
- How to set up and tear down test state
- Base this on the user's answers from Phase 3, informed by the fundamentals' "Real vs fake" table.

**`references/mock-health-rules.md`**
Adapt mock health rules to the project's test framework. Include:
- The boundary-based mock rule from the fundamentals, translated to project-specific terms (e.g., "mock owned services and side-effect deps; use real configured libs; if a test needs many mocks to set up, it signals a missing integration test or a unit that should be split")
- Framework-specific mocking patterns (e.g., `jest.spyOn` vs `jest.mock`, `unittest.mock.patch` vs `pytest-mock`)
- What to mock vs what to use real in unit tests (owned services vs configured libs vs side-effect deps)

**`references/file-conventions.md`**
Document the project's actual test file patterns:
- Naming convention for each layer (unit, integration, e2e)
- Directory placement (colocated vs centralized)
- Configuration files and any special setup (e.g., `moduleNameMapper` for path resolution)
- If the user chose "thorough" coverage philosophy, include concrete coverage targets here

**`references/gotchas.md`**
Include concrete pitfalls and tips from:
- Web research findings
- Analysis of existing test patterns
- Known issues with the project's specific framework + test runner combination

---

### 4.2 Quality Checks

Before writing the files, verify:
- [ ] The skill frontmatter has a clear `name` and descriptive `description`
- [ ] Description focuses on the full development lifecycle (planning features, implementing code, creating/reviewing tests) — does NOT list technologies in the description
- [ ] Trigger phrases are **project-scoped** and do NOT duplicate triggers from `test-guide` or other existing skills
- [ ] The generated skill contains NO Writing mode or Audit mode workflow sections
- [ ] No contradiction with existing skills in `.claude/skills/` or rules in `.claude/rules/`
- [ ] **Main SKILL.md is under 250 lines**
- [ ] **All artifact types are in individual files in `artifacts/`**
- [ ] **All reference content is in individual files in `references/`**
- [ ] **Quick Reference table (§4) lists every artifact type with the correct path to its sub-file**
- [ ] **All sub-file references use backtick notation (`` `path` ``), NOT markdown links (`[text](path)`)**
- [ ] **Every path referenced in the SKILL.md corresponds to a file actually generated**
- [ ] **Every sub-file includes a back-reference to the main SKILL.md (using backtick, not link)**
- [ ] **Sub-files do NOT have YAML frontmatter**
- [ ] Every external system has a clear real/fake strategy in `references/external-systems.md`
- [ ] Artifact guides cover all types from Phase 1.3 AND common framework types not yet present
- [ ] Every bullet in Testing Criteria references an artifact type or code pattern, not an individual instance
- [ ] Each artifact guide includes: what to test, layer assignment, setup pattern, when to skip, and project examples
- [ ] Purpose section exists and explains the multi-file structure
- [ ] Testability Foundations section bridges universal fundamentals with framework-specific research findings — not generic platitudes, but concrete reasoning for THIS stack
- [ ] Gotchas in `references/gotchas.md` are specific and actionable, not generic advice
- [ ] Reading the main SKILL.md + the relevant artifact guide gives a developer a complete picture of how to test that type
- [ ] Feature Implementation Checklist maps all artifact types to required test layers with correct paths to artifact guides
- [ ] Anti-patterns section consolidates prohibitions from Layer Assignment Table, mock rules, and gotchas — with correct file path references
- [ ] Generated skill triggers include planning and implementation phases, not just test activities
- [ ] Anti-patterns section includes at minimum: no controller unit tests, no mocking configured libs, no skipping integration tests for DB services, no skipping module compilation tests
- [ ] E2E Terminology Note (§6) is present and clarifies that "E2E" means supertest HTTP-layer tests, not browser-based tests
- [ ] "How to Use This Guide" section (§8) is present and explains the three-tier navigation (SKILL.md → artifacts/ → references/)
- [ ] Generated advice (setup patterns, API usage, library recommendations) is compatible with the project's detected framework and library versions — no references to APIs, features, or patterns from newer versions than what the project uses

### 4.3 Write the Files

Write the generated skill as a multi-file structure:

1. Create the skill directory `.claude/skills/testing-guide-<project>/` (if it doesn't already exist)
2. Create the subdirectories `artifacts/` and `references/`
3. Write the main `SKILL.md`
4. Write each artifact guide file in `artifacts/`
5. Write each reference file in `references/`

If a monolithic `SKILL.md` already exists in the directory (from a previous generation), inform the user that it will be replaced by the new multi-file structure and ask whether to proceed.

Replace `<project>` with the actual project folder name throughout all files.

---

## Constraints

- **Do not modify** any existing files in `.claude/skills/` other than the generated `.claude/skills/testing-guide-<project>/` directory.
- **Do not modify** any existing files in `.claude/rules/`.
- **Do not create** test files — this skill only generates the testing skill documents.
- **Do not skip** any phase — all four phases (analysis, web research, user questions, generation) are mandatory.
- If `$ARGUMENTS` is empty, use the current working directory as the project path. However, if the current directory contains multiple sub-projects (multiple manifest files like `package.json` at different depths), do not analyze the root automatically — ask the user to specify the target sub-project.
- If the project path doesn't exist or has no recognizable project structure, inform the user and stop.
