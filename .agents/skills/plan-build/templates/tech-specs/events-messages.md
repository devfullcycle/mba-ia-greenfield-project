# Tech Spec subsection — Events/Messages

Applies when there are queues or async processing. TDs with `Scope: Backend | Cross-layer` that reference messaging (event bus, websockets, SSE, background jobs). Backend-only events use `Backend`; events visible to the frontend use `Cross-layer`.

````markdown
### Events/Messages

#### {event.name}

**Payload:**

```json
{ "field": "string", "userId": "uuid" }
```

**Producer:** `{ServiceName}` (per `{slug}/TD-XX`)
**Consumer:** `{WorkerName}` (per `{slug}/TD-XX`)
**Trigger:** {when/why this event fires}
**Delivery semantics:** {at-least-once | exactly-once | best-effort} (per `{slug}/TD-XX`)
````
