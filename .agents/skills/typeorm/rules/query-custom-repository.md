---
title: Custom Repository Pattern
impact: HIGH
impactDescription: Query logic scattered in services creates duplication and makes testing harder
tags: query, repository, custom, encapsulation, data-mapper
---

## Custom Repository Pattern

**Impact: HIGH (scattered query logic in services creates duplication and hinders testing)**

Encapsulate domain-specific queries in custom repositories. This follows the Data Mapper pattern and keeps services focused on business logic.

**Incorrect (complex queries directly in services):**

```typescript
@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
  ) {}

  // Query logic leaked into service — duplicated if another service needs this
  async findActiveUsersWithRecentPosts(): Promise<User[]> {
    return this.usersRepository.find({
      where: { isActive: true },
      relations: ["posts"],
      order: { createdAt: "DESC" },
    });
  }
}
```

**Correct (encapsulated in custom repository):**

```typescript
import { Repository, DataSource } from "typeorm";
import { User } from "./entities/User";

export class UserRepository extends Repository<User> {
  constructor(private dataSource: DataSource) {
    super(User, dataSource.createEntityManager());
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.findOne({ where: { email } });
  }

  async findActiveUsers(): Promise<User[]> {
    return this.find({
      where: { isActive: true },
      order: { createdAt: "DESC" },
    });
  }

  async findWithPosts(userId: number): Promise<User | null> {
    return this.findOne({
      where: { id: userId },
      relations: ["posts"],
    });
  }
}
```

**Key points:**
- Extend `Repository<Entity>` for full access to base repository methods
- Place domain-specific queries (e.g., `findByEmail`, `findActiveUsers`) in the custom repository
- Services should delegate to the repository for data access
- Custom repositories are easier to mock in unit tests than scattered inline queries

Reference: [TypeORM Custom Repositories](https://typeorm.io/custom-repository)
