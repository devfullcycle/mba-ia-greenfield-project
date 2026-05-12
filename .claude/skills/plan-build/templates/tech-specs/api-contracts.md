# Tech Spec subsection — API Contracts

Applies when HTTP endpoints are exposed. Each endpoint becomes a `#### {METHOD} {/path}` heading (request shape, response shape, status codes listed below).

When validation rules exist and are broad enough to warrant a dedicated subsection, append them as `#### Validation Rules` **nested at the end of `### API Contracts`** (never as a sibling H3). Narrow validation rules may alternatively live inline under each endpoint as a bold-labeled block.

````markdown
### API Contracts

#### POST /path

**Request body:**

```json
{ "field": "string (required)" }
```

**Responses:**
- `201 Created` — `{ "id": "uuid", "field": "string" }`
- `400 Bad Request` — `{ "statusCode": 400, "errorCode": "VALIDATION_ERROR", "message": "..." }`
- `409 Conflict` — `{ "statusCode": 409, "errorCode": "EMAIL_ALREADY_EXISTS" }`

#### Validation Rules

- `field`: required, min 3 chars, max 255 chars
````
