import {
  MAX_PART_COUNT,
  MAX_PART_SIZE_BYTES,
  MIN_PART_SIZE_BYTES,
  computeUploadPlan,
} from './upload-plan';

const MIB = 1024 * 1024;
const TEN_GB = 10_737_418_240;

describe('computeUploadPlan', () => {
  it('should use a single 5 MiB part for a 1-byte file', () => {
    expect(computeUploadPlan(1)).toEqual({
      part_size: 5_242_880,
      part_count: 1,
    });
  });

  it('should keep a 10GB file within the S3 part limits', () => {
    const plan = computeUploadPlan(TEN_GB);

    expect(plan.part_count).toBeLessThanOrEqual(MAX_PART_COUNT);
    expect(plan.part_size).toBeLessThanOrEqual(MAX_PART_SIZE_BYTES);
    expect(plan.part_size * plan.part_count).toBeGreaterThanOrEqual(TEN_GB);
  });

  it('should use exactly one part for a file of exactly 5 MiB', () => {
    expect(computeUploadPlan(5 * MIB)).toEqual({
      part_size: MIN_PART_SIZE_BYTES,
      part_count: 1,
    });
  });

  it('should add a part as soon as the size crosses a multiple of the part size', () => {
    expect(computeUploadPlan(5 * MIB + 1).part_count).toBe(2);
    expect(computeUploadPlan(10 * MIB).part_count).toBe(2);
    expect(computeUploadPlan(10 * MIB + 1).part_count).toBe(3);
  });

  it('should grow the part size above 5 MiB once 10,000 minimum-size parts are not enough', () => {
    const size = MAX_PART_COUNT * MIN_PART_SIZE_BYTES + 1;

    const plan = computeUploadPlan(size);

    expect(plan.part_size).toBe(Math.ceil(size / MAX_PART_COUNT));
    expect(plan.part_count).toBe(MAX_PART_COUNT);
  });

  it('should cap the part size at 100 MiB for very large sizes', () => {
    const plan = computeUploadPlan(MAX_PART_COUNT * MAX_PART_SIZE_BYTES * 2);

    expect(plan.part_size).toBe(MAX_PART_SIZE_BYTES);
  });
});
