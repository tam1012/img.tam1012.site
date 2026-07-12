import { prisma } from "./prisma";

const TIMEZONE = "Asia/Ho_Chi_Minh";

export type StatsPeriodKey = "day" | "week" | "month";

export type ModelStatRow = {
  model: string;
  total: number;
  generate: number;
  edit: number;
};

export type PeriodStat = {
  key: StatsPeriodKey;
  label: string;
  from: string;
  to: string;
  total: number;
  generate: number;
  edit: number;
  by_model: ModelStatRow[];
};

export type ImageStatsResult = {
  timezone: string;
  scope: "mine" | "all";
  model: string | null;
  models: string[];
  periods: PeriodStat[];
};

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

function getVnYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Việt Nam không DST, cố định UTC+7. */
function vnWallToUtcDate(y: number, m: number, d: number, hour = 0, minute = 0, second = 0) {
  return new Date(`${y}-${pad2(m)}-${pad2(d)}T${pad2(hour)}:${pad2(minute)}:${pad2(second)}+07:00`);
}

function startOfVnDay(date = new Date()) {
  const { y, m, d } = getVnYmd(date);
  return vnWallToUtcDate(y, m, d);
}

function startOfVnWeekMonday(date = new Date()) {
  const start = startOfVnDay(date);
  const weekday = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    weekday: "short",
  }).format(date);
  const offsetFromMonday: Record<string, number> = {
    Mon: 0,
    Tue: 1,
    Wed: 2,
    Thu: 3,
    Fri: 4,
    Sat: 5,
    Sun: 6,
  };
  const days = offsetFromMonday[weekday] ?? 0;
  return new Date(start.getTime() - days * 24 * 60 * 60 * 1000);
}

function startOfVnMonth(date = new Date()) {
  const { y, m } = getVnYmd(date);
  return vnWallToUtcDate(y, m, 1);
}

function periodBounds(now = new Date()) {
  const to = now;
  return {
    day: { label: "Hôm nay", from: startOfVnDay(now), to },
    week: { label: "Tuần này", from: startOfVnWeekMonday(now), to },
    month: { label: "Tháng này", from: startOfVnMonth(now), to },
  } as const;
}

type AggregateRow = {
  model: string;
  isEdit: boolean;
  count: number;
};

function emptyModelMap() {
  return new Map<string, { total: number; generate: number; edit: number }>();
}

function applyRows(map: Map<string, { total: number; generate: number; edit: number }>, rows: AggregateRow[]) {
  for (const row of rows) {
    const model = row.model || "unknown";
    const cur = map.get(model) || { total: 0, generate: 0, edit: 0 };
    cur.total += row.count;
    if (row.isEdit) cur.edit += row.count;
    else cur.generate += row.count;
    map.set(model, cur);
  }
}

function mapToSortedRows(map: Map<string, { total: number; generate: number; edit: number }>): ModelStatRow[] {
  return [...map.entries()]
    .map(([model, v]) => ({ model, ...v }))
    .sort((a, b) => b.total - a.total || a.model.localeCompare(b.model));
}

function sumRows(rows: ModelStatRow[]) {
  return rows.reduce(
    (acc, row) => {
      acc.total += row.total;
      acc.generate += row.generate;
      acc.edit += row.edit;
      return acc;
    },
    { total: 0, generate: 0, edit: 0 },
  );
}

/**
 * Thống kê sản lượng ảnh đã tạo/sửa thành công.
 * Nguồn: bảng ImageUsage (bất biến) — hard-delete gallery không làm tụt số.
 */
export async function getImageStats(opts: {
  userId?: string;
  scope: "mine" | "all";
  model?: string | null;
}): Promise<ImageStatsResult> {
  const now = new Date();
  const bounds = periodBounds(now);
  const modelFilter = opts.model?.trim() || null;

  const baseWhere = {
    ...(opts.userId ? { userId: opts.userId } : {}),
    ...(modelFilter ? { model: modelFilter } : {}),
  };

  async function splitEdit(from: Date, to: Date): Promise<AggregateRow[]> {
    const [generate, edit] = await Promise.all([
      prisma.imageUsage.groupBy({
        by: ["model"],
        where: {
          ...baseWhere,
          createdAt: { gte: from, lte: to },
          kind: "generate",
        },
        _count: { _all: true },
      }),
      prisma.imageUsage.groupBy({
        by: ["model"],
        where: {
          ...baseWhere,
          createdAt: { gte: from, lte: to },
          kind: "edit",
        },
        _count: { _all: true },
      }),
    ]);
    return [
      ...generate.map((r) => ({ model: r.model, isEdit: false, count: r._count._all })),
      ...edit.map((r) => ({ model: r.model, isEdit: true, count: r._count._all })),
    ];
  }

  const [daySplit, weekSplit, monthSplit, modelRows] = await Promise.all([
    splitEdit(bounds.day.from, bounds.day.to),
    splitEdit(bounds.week.from, bounds.week.to),
    splitEdit(bounds.month.from, bounds.month.to),
    prisma.imageUsage.findMany({
      where: opts.userId ? { userId: opts.userId } : {},
      distinct: ["model"],
      select: { model: true },
      orderBy: { model: "asc" },
      take: 100,
    }),
  ]);

  function buildPeriod(key: StatsPeriodKey, label: string, from: Date, to: Date, split: AggregateRow[]): PeriodStat {
    const map = emptyModelMap();
    applyRows(map, split);
    const by_model = mapToSortedRows(map);
    const sums = sumRows(by_model);
    return {
      key,
      label,
      from: from.toISOString(),
      to: to.toISOString(),
      total: sums.total,
      generate: sums.generate,
      edit: sums.edit,
      by_model,
    };
  }

  const models = [...new Set(modelRows.map((r) => r.model).filter(Boolean))].sort((a, b) => a.localeCompare(b));

  return {
    timezone: TIMEZONE,
    scope: opts.scope,
    model: modelFilter,
    models,
    periods: [
      buildPeriod("day", bounds.day.label, bounds.day.from, bounds.day.to, daySplit),
      buildPeriod("week", bounds.week.label, bounds.week.from, bounds.week.to, weekSplit),
      buildPeriod("month", bounds.month.label, bounds.month.from, bounds.month.to, monthSplit),
    ],
  };
}
