import { PublicIdService } from './public-id.service';

describe('PublicIdService', () => {
  let service: PublicIdService;

  beforeEach(() => {
    service = new PublicIdService();
  });

  it('generates an 11-char URL-safe id', () => {
    const id = service.newId();
    expect(id).toHaveLength(11);
    expect(id).toMatch(/^[0-9A-Za-z]{11}$/);
  });

  it('generates distinct ids on consecutive calls', () => {
    const ids = new Set(Array.from({ length: 100 }, () => service.newId()));
    expect(ids.size).toBe(100);
  });

  it('retries on collision and returns a free id', async () => {
    const exists = jest
      .fn<Promise<boolean>, [string]>()
      .mockResolvedValueOnce(true) // first id collides
      .mockResolvedValueOnce(false); // second id is free

    const id = await service.generateUnique(exists);

    expect(exists).toHaveBeenCalledTimes(2);
    expect(id).toMatch(/^[0-9A-Za-z]{11}$/);
  });

  it('throws when no free id is found within maxAttempts', async () => {
    const exists = jest
      .fn<Promise<boolean>, [string]>()
      .mockResolvedValue(true);
    await expect(service.generateUnique(exists, 3)).rejects.toThrow(
      /unique public_id/,
    );
    expect(exists).toHaveBeenCalledTimes(3);
  });
});
