# Tech Spec subsection — Authorization Matrix

Applies when behavior depends on auth/roles.

````markdown
### Authorization Matrix

| Endpoint | Anonymous | Authenticated | Owner |
|----------|-----------|---------------|-------|
| GET /path | ✓ | ✓ | ✓ |
| DELETE /path/:id | ✗ | ✗ | ✓ |
````
