import { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import { getImagePriceVnd, getVideoPriceVnd, quotaFromBalance } from "./pricing";

export const INSUFFICIENT_BALANCE = "INSUFFICIENT_BALANCE";

function assertPositiveAmount(amountVnd: number) {
  if (!Number.isInteger(amountVnd) || amountVnd <= 0) {
    throw new Error("Số tiền phải là số nguyên dương");
  }
}

export async function getWalletSummary(userId: string) {
  const wallet = await prisma.wallet.upsert({
    where: { userId },
    create: { userId, balanceVnd: 0 },
    update: {},
  });
  const imagePrice = getImagePriceVnd();
  const videoPrice = getVideoPriceVnd();
  return {
    balance_vnd: wallet.balanceVnd,
    image_price_vnd: imagePrice,
    video_price_vnd: videoPrice,
    remaining_images: quotaFromBalance(wallet.balanceVnd),
    remaining_videos: Math.floor(wallet.balanceVnd / videoPrice),
  };
}

export async function creditWalletManual(userId: string, amountVnd: number, adminId: string, idempotencyKey: string, note?: string) {
  assertPositiveAmount(amountVnd);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey } });
    if (existing) return tx.wallet.findUniqueOrThrow({ where: { userId } });

    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balanceVnd: amountVnd },
      update: { balanceVnd: { increment: amountVnd } },
    });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "topup_manual",
        amountVnd,
        balanceAfterVnd: wallet.balanceVnd,
        adminId,
        note: note?.trim() || null,
        idempotencyKey,
      },
    });
    return wallet;
  });
}

export async function creditWalletPayos(userId: string, amountVnd: number, orderCode: number) {
  assertPositiveAmount(amountVnd);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const order = await tx.payosOrder.findUnique({ where: { orderCode } });
    if (!order) throw new Error("PAYOS_ORDER_NOT_FOUND");
    if (order.userId !== userId) throw new Error("PAYOS_ORDER_OWNER_MISMATCH");
    if (order.amountVnd !== amountVnd) throw new Error("PAYOS_AMOUNT_MISMATCH");

    const idempotencyKey = `payos:${orderCode}`;
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey } });
    if (existing) return tx.wallet.findUniqueOrThrow({ where: { userId } });

    await tx.payosOrder.update({ where: { orderCode }, data: { status: "paid" } });

    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balanceVnd: amountVnd },
      update: { balanceVnd: { increment: amountVnd } },
    });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "topup_payos",
        amountVnd,
        balanceAfterVnd: wallet.balanceVnd,
        note: `PayOS #${orderCode}`,
        idempotencyKey,
      },
    });
    return wallet;
  });
}

export async function adjustWalletManual(userId: string, amountVnd: number, adminId: string, idempotencyKey: string, note?: string) {
  if (!Number.isInteger(amountVnd) || amountVnd === 0) {
    throw new Error("Số tiền điều chỉnh phải là số nguyên khác 0");
  }

  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey } });
    if (existing) return tx.wallet.findUniqueOrThrow({ where: { userId } });

    await tx.wallet.upsert({ where: { userId }, create: { userId, balanceVnd: 0 }, update: {} });
    if (amountVnd < 0) {
      const updated = await tx.wallet.updateMany({
        where: { userId, balanceVnd: { gte: Math.abs(amountVnd) } },
        data: { balanceVnd: { decrement: Math.abs(amountVnd) } },
      });
      if (updated.count === 0) throw new Error(INSUFFICIENT_BALANCE);
    } else {
      await tx.wallet.update({ where: { userId }, data: { balanceVnd: { increment: amountVnd } } });
    }

    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "adjust_manual",
        amountVnd,
        balanceAfterVnd: wallet.balanceVnd,
        adminId,
        note: note?.trim() || null,
        idempotencyKey,
      },
    });
    return wallet;
  });
}

export async function debitForImage(userId: string, imageId: string, amountVnd: number) {
  assertPositiveAmount(amountVnd);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey: `charge:${imageId}` } });
    if (existing) {
      if (existing.userId !== userId) throw new Error("CHARGE_OWNER_MISMATCH");
      return tx.wallet.findUniqueOrThrow({ where: { userId } });
    }

    await tx.wallet.upsert({ where: { userId }, create: { userId, balanceVnd: 0 }, update: {} });
    const updated = await tx.wallet.updateMany({
      where: { userId, balanceVnd: { gte: amountVnd } },
      data: { balanceVnd: { decrement: amountVnd } },
    });
    if (updated.count === 0) throw new Error(INSUFFICIENT_BALANCE);

    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "charge_image",
        amountVnd: -amountVnd,
        balanceAfterVnd: wallet.balanceVnd,
        relatedImageId: imageId,
        idempotencyKey: `charge:${imageId}`,
      },
    });
    return wallet;
  });
}

export async function debitForBatch(userId: string, batchId: string, count: number, pricePerImage: number) {
  const totalAmount = count * pricePerImage;
  assertPositiveAmount(totalAmount);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const idempotencyKey = `charge-batch:${batchId}`;
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.userId !== userId) throw new Error("CHARGE_OWNER_MISMATCH");
      return tx.wallet.findUniqueOrThrow({ where: { userId } });
    }

    await tx.wallet.upsert({ where: { userId }, create: { userId, balanceVnd: 0 }, update: {} });
    const updated = await tx.wallet.updateMany({
      where: { userId, balanceVnd: { gte: totalAmount } },
      data: { balanceVnd: { decrement: totalAmount } },
    });
    if (updated.count === 0) throw new Error(INSUFFICIENT_BALANCE);

    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "charge_image",
        amountVnd: -totalAmount,
        balanceAfterVnd: wallet.balanceVnd,
        note: `Batch ${count} ảnh`,
        idempotencyKey,
      },
    });
    return wallet;
  });
}

export async function refundForBatch(userId: string, batchId: string, amountVnd: number, reason?: string) {
  assertPositiveAmount(amountVnd);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const idempotencyKey = `refund-batch:${batchId}`;
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey } });
    if (existing) {
      if (existing.userId !== userId) throw new Error("REFUND_OWNER_MISMATCH");
      return tx.wallet.findUniqueOrThrow({ where: { userId } });
    }

    const charge = await tx.walletLedger.findUnique({ where: { idempotencyKey: `charge-batch:${batchId}` } });
    if (!charge || charge.userId !== userId || charge.type !== "charge_image") {
      throw new Error("REFUND_WITHOUT_CHARGE");
    }

    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balanceVnd: amountVnd },
      update: { balanceVnd: { increment: amountVnd } },
    });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "refund_image",
        amountVnd,
        balanceAfterVnd: wallet.balanceVnd,
        note: reason?.slice(0, 500) || null,
        idempotencyKey,
      },
    });
    return wallet;
  });
}

export async function refundForImage(userId: string, imageId: string, amountVnd: number, reason?: string) {
  assertPositiveAmount(amountVnd);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey: `refund:${imageId}` } });
    if (existing) {
      if (existing.userId !== userId) throw new Error("REFUND_OWNER_MISMATCH");
      return tx.wallet.findUniqueOrThrow({ where: { userId } });
    }

    const charge = await tx.walletLedger.findUnique({ where: { idempotencyKey: `charge:${imageId}` } });
    if (!charge || charge.userId !== userId || charge.type !== "charge_image" || charge.amountVnd !== -amountVnd) {
      throw new Error("REFUND_WITHOUT_CHARGE");
    }

    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balanceVnd: amountVnd },
      update: { balanceVnd: { increment: amountVnd } },
    });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "refund_image",
        amountVnd,
        balanceAfterVnd: wallet.balanceVnd,
        relatedImageId: imageId,
        note: reason?.slice(0, 500) || null,
        idempotencyKey: `refund:${imageId}`,
      },
    });
    return wallet;
  });
}

export async function debitForVideo(userId: string, videoId: string, amountVnd: number) {
  assertPositiveAmount(amountVnd);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey: `charge:video:${videoId}` } });
    if (existing) {
      if (existing.userId !== userId) throw new Error("CHARGE_OWNER_MISMATCH");
      return tx.wallet.findUniqueOrThrow({ where: { userId } });
    }
    await tx.wallet.upsert({ where: { userId }, create: { userId, balanceVnd: 0 }, update: {} });
    const updated = await tx.wallet.updateMany({
      where: { userId, balanceVnd: { gte: amountVnd } },
      data: { balanceVnd: { decrement: amountVnd } },
    });
    if (updated.count === 0) throw new Error(INSUFFICIENT_BALANCE);
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId } });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "charge_video",
        amountVnd: -amountVnd,
        balanceAfterVnd: wallet.balanceVnd,
        relatedVideoId: videoId,
        idempotencyKey: `charge:video:${videoId}`,
      },
    });
    return wallet;
  });
}

export async function refundForVideo(userId: string, videoId: string, amountVnd: number, reason?: string) {
  assertPositiveAmount(amountVnd);
  return prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    const existing = await tx.walletLedger.findUnique({ where: { idempotencyKey: `refund:video:${videoId}` } });
    if (existing) {
      if (existing.userId !== userId) throw new Error("REFUND_OWNER_MISMATCH");
      return tx.wallet.findUniqueOrThrow({ where: { userId } });
    }
    const charge = await tx.walletLedger.findUnique({ where: { idempotencyKey: `charge:video:${videoId}` } });
    if (!charge || charge.userId !== userId || charge.type !== "charge_video" || charge.amountVnd !== -amountVnd) {
      throw new Error("REFUND_WITHOUT_CHARGE");
    }
    const wallet = await tx.wallet.upsert({
      where: { userId },
      create: { userId, balanceVnd: amountVnd },
      update: { balanceVnd: { increment: amountVnd } },
    });
    await tx.walletLedger.create({
      data: {
        userId,
        type: "refund_video",
        amountVnd,
        balanceAfterVnd: wallet.balanceVnd,
        relatedVideoId: videoId,
        note: reason?.slice(0, 500) || null,
        idempotencyKey: `refund:video:${videoId}`,
      },
    });
    return wallet;
  });
}
