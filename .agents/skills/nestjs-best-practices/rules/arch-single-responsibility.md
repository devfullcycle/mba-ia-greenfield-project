---
title: Single Responsibility for Services
impact: CRITICAL
impactDescription: "40%+ improvement in testability"
tags: architecture, services, single-responsibility
---

## Single Responsibility for Services

Each service should have a single, well-defined responsibility. Avoid "god services" that handle multiple unrelated concerns. If a service name includes "And" or handles more than one domain concept, it likely violates single responsibility. This reduces complexity and improves testability by 40%+.

**Incorrect (god service anti-pattern):**

```typescript
// God service anti-pattern
@Injectable()
export class UserAndOrderService {
  constructor(
    private userRepo: UserRepository,
    private orderRepo: OrderRepository,
    private mailer: MailService,
    private payment: PaymentService,
  ) {}

  async createUser(dto: CreateUserDto) {
    const user = await this.userRepo.save(dto);
    await this.mailer.sendWelcome(user);
    return user;
  }

  async createOrder(userId: string, dto: CreateOrderDto) {
    const order = await this.orderRepo.save({ userId, ...dto });
    await this.payment.charge(order);
    await this.mailer.sendOrderConfirmation(order);
    return order;
  }

  async calculateOrderStats(userId: string) {
    // Stats logic mixed in
  }

  async validatePayment(orderId: string) {
    // Payment logic mixed in
  }
}
```

**Correct (focused services with single responsibility):**

```typescript
// Focused services with single responsibility
@Injectable()
export class UsersService {
  constructor(private userRepo: UserRepository) {}

  async create(dto: CreateUserDto): Promise<User> {
    return this.userRepo.save(dto);
  }

  async findById(id: string): Promise<User> {
    return this.userRepo.findOneOrFail({ where: { id } });
  }
}

// OrdersService owns the full order creation workflow — that IS its single responsibility
@Injectable()
export class OrdersService {
  constructor(
    private readonly orderRepo: OrderRepository,
    private readonly payment: PaymentService,
    private readonly notifications: NotificationService,
  ) {}

  async create(userId: string, dto: CreateOrderDto): Promise<Order> {
    const order = await this.orderRepo.save({ userId, ...dto });
    await this.payment.charge(order);
    await this.notifications.sendOrderConfirmation(order);
    return order;
  }

  async findByUser(userId: string): Promise<Order[]> {
    return this.orderRepo.find({ where: { userId } });
  }
}

@Injectable()
export class OrderStatsService {
  constructor(private orderRepo: OrderRepository) {}

  async calculateForUser(userId: string): Promise<OrderStats> {
    // Focused stats calculation
  }
}

// Controller delegates to services — no business orchestration
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  async create(@CurrentUser() user: User, @Body() dto: CreateOrderDto) {
    return this.orders.create(user.id, dto);
    // OrdersService internally handles payment + notification
  }
}
```

Reference: [NestJS Providers](https://docs.nestjs.com/providers)
