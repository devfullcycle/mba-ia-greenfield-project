---
paths:
  - 'nestjs-project/**/*.controller.ts'
  - 'nestjs-project/**/*.guard.ts'
  - 'nestjs-project/**/*.interceptor.ts'
  - 'nestjs-project/**/*.pipe.ts'
  - 'nestjs-project/**/*.filter.ts'
description: 'Layer separation — business logic belongs exclusively in services; controllers, guards, interceptors, pipes, and filters must delegate to services'
---

# Layer Separation Rules

## Business Logic Lives in Services

Services are the single home for all business rules and core domain logic. No other artifact type may implement business logic directly.

## Controllers Are Thin

Controllers receive HTTP requests, delegate to services, and return the response. They must not contain conditionals, transformations, or decisions that encode business rules.

Controllers **may** contain simple request-level decisions that are not domain logic — such as checking if a service returned `null` and throwing an appropriate exception, or deciding which service to call based on a query parameter. These are HTTP-layer concerns, not business rules.

## Guards, Interceptors, Pipes, and Filters Must Delegate

When a Guard, Interceptor, Pipe, or Exception Filter needs access to business logic, it must inject and call a Service. These artifacts handle cross-cutting infrastructure concerns (authentication, logging, validation, error mapping) — not domain decisions.

### Bad: business logic in a guard

```typescript
@Injectable()
export class ChannelOwnerGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const channel = request.channel;
    // business rule leaked into guard
    return channel.ownerId === request.user.id && channel.status === 'active';
  }
}
```

### Good: guard delegates to a service

```typescript
@Injectable()
export class ChannelOwnerGuard implements CanActivate {
  constructor(private readonly channelsService: ChannelsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    return this.channelsService.isOwner(request.params.channelId, request.user.id);
  }
}
```

## The Rule

- **Services** own business logic — they are the only place where domain rules, validations, and decisions live
- **Controllers** are thin: receive request, call service(s), return response. Simple request-level decisions (null checks, choosing which service to call) are OK — domain rules are not
- **Guards, Interceptors, Pipes, Filters** handle infrastructure concerns only; when they need a business decision, they inject a Service
- If you find yourself writing `if` statements that encode domain rules outside a service, move that logic into the appropriate service
