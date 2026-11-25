# Tech Spec subsection — Data Model

Applies when entities are new or modified. Each entity becomes a `#### {EntityName}` heading (fields, relations, indexes listed below).

````markdown
### Data Model

#### {EntityName}

| Field | Type | Constraints |
|-------|------|-------------|
| id | uuid | PK, generated |
| email | varchar(255) | unique, not null |
| created_at | timestamptz | default now() |

**Relations:** `User` has many `Channel` (one-to-many)
**Indexes:** unique on `email`
````
