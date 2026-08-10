---
title: Section Categories
description: Metadata for TypeORM skill rule categories and their priorities
---

# TypeORM Skill Categories

| Priority | Category      | Impact      | Prefix      | Rules | Description                              |
|----------|---------------|-------------|-------------|-------|------------------------------------------|
| 1        | Configuration | CRITICAL    | `config-`   | 2     | DataSource setup and TypeScript settings  |
| 2        | Entity Design | CRITICAL    | `entity-`   | 3     | Entity structure, PKs, and column types   |
| 3        | Relationships | HIGH        | `rel-`      | 2     | OneToOne, OneToMany, ManyToMany           |
| 4        | Query Patterns| HIGH        | `query-`    | 3     | Repository, custom repo, QueryBuilder     |
| 5        | Migrations    | HIGH        | `migration-`| 2     | CLI workflow and file structure            |
| 6        | Transactions  | MEDIUM-HIGH | `tx-`       | 1     | Transaction management with QueryRunner   |
| 7        | Integration   | MEDIUM      | `integ-`    | 1     | NestJS TypeORM integration                |
| 8        | Conventions   | MEDIUM      | `conv-`     | 2     | Loading strategies, indexes, naming       |

## File Naming Convention

`{prefix}{rule-name}.md`

Examples:
- `config-datasource-setup.md`
- `entity-define-proper-structure.md`
- `rel-one-to-one-and-many.md`
