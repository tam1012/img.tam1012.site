import { afterEach, describe, expect, it } from "vitest";
import {
  UserGenerationLimitError,
  UserGenerationLimiter,
  USER_GENERATION_BUSY_MESSAGE,
} from "@/lib/rate-limit";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("UserGenerationLimiter", () => {
  const limiters: UserGenerationLimiter[] = [];

  afterEach(() => {
    for (const l of limiters) l.reset();
    limiters.length = 0;
  });

  function makeLimiter(
    maxUnits = 3,
    windowMs = 60_000,
    maxWaitMs = 120_000,
  ): UserGenerationLimiter {
    const l = new UserGenerationLimiter(maxUnits, windowMs, maxWaitMs);
    limiters.push(l);
    return l;
  }

  it("serial: chỉ 1 job chạy cùng lúc cho 1 user", async () => {
    const limiter = makeLimiter(10, 60_000, 120_000);
    let concurrent = 0;
    let maxConcurrent = 0;

    const run = async () => {
      const release = await limiter.acquire("serial-user", 1);
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(40);
      concurrent -= 1;
      release();
    };

    await Promise.all([run(), run(), run()]);
    expect(maxConcurrent).toBe(1);
  });

  it("user khác không chặn nhau", async () => {
    const limiter = makeLimiter(3, 60_000, 120_000);
    let concurrent = 0;
    let maxConcurrent = 0;

    const run = async (userId: string) => {
      const release = await limiter.acquire(userId, 1);
      concurrent += 1;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await sleep(40);
      concurrent -= 1;
      release();
    };

    await Promise.all([run("a"), run("b"), run("c")]);
    expect(maxConcurrent).toBe(3);
  });

  it("tối đa 3 đơn vị / cửa sổ: job thứ 4 chờ rồi chạy khi stamp hết hạn", async () => {
    const windowMs = 150;
    const limiter = makeLimiter(3, windowMs, 2_000);

    // Chiếm 3 slot nối tiếp (nhả concurrency ngay, giữ stamp rate-limit).
    for (let i = 0; i < 3; i++) {
      const release = await limiter.acquire("cap-user", 1);
      release();
    }

    let fourthAt = 0;
    const startedAt = Date.now();
    await limiter.acquire("cap-user", 1).then((release) => {
      fourthAt = Date.now();
      release();
    });
    expect(fourthAt - startedAt).toBeGreaterThanOrEqual(windowMs - 30);
  });

  it("batch count=3 chiếm full slot; request units=1 sau đó phải chờ", async () => {
    const windowMs = 120;
    const limiter = makeLimiter(3, windowMs, 2_000);

    const batchRelease = await limiter.acquire("batch-user", 3);
    batchRelease();

    const startedAt = Date.now();
    let nextAt = 0;
    await limiter.acquire("batch-user", 1).then((r) => {
      nextAt = Date.now();
      r();
    });
    expect(nextAt - startedAt).toBeGreaterThanOrEqual(windowMs - 20);
  });

  it("batch lớn hơn max (5) chờ cửa sổ trống rồi chạy full, không cắt batch", async () => {
    const windowMs = 120;
    const limiter = makeLimiter(3, windowMs, 2_000);

    const first = await limiter.acquire("big-user", 1);
    first();

    const startedAt = Date.now();
    let bigAt = 0;
    await limiter.acquire("big-user", 5).then((r) => {
      bigAt = Date.now();
      r();
    });
    expect(bigAt - startedAt).toBeGreaterThanOrEqual(windowMs - 20);
  });

  it("hết hạn chờ thì ném UserGenerationLimitError message chung (không lộ job trùng)", async () => {
    const limiter = makeLimiter(3, 60_000, 50);
    const hold = await limiter.acquire("wait-user", 1);

    await expect(limiter.acquire("wait-user", 1)).rejects.toBeInstanceOf(UserGenerationLimitError);
    try {
      await limiter.acquire("wait-user", 1);
      throw new Error("should have rejected");
    } catch (e) {
      expect(e).toBeInstanceOf(UserGenerationLimitError);
      expect((e as UserGenerationLimitError).message).toBe(USER_GENERATION_BUSY_MESSAGE);
      expect((e as UserGenerationLimitError).status).toBe(429);
    }

    hold();
  });

  it("release 2 lần không làm hỏng hàng đợi", async () => {
    const limiter = makeLimiter(3, 60_000, 120_000);
    const release = await limiter.acquire("double-release", 1);
    release();
    release();

    const release2 = await limiter.acquire("double-release", 1);
    release2();
  });
});
