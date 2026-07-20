import type { JobRepository } from "./repository.js";

export type VideoPollFn = (jobId: string) => Promise<void>;

// Số lần poll liên tiếp gặp reauth trước khi bỏ cuộc. Một cú blip mạng thoáng qua
// (401/403 chớp nhoáng, googleapis timeout) không được giết job đang render — chỉ
// khi reauth kéo dài nhiều nhịp mới coi là hỏng thật.
const MAX_CONSECUTIVE_REAUTH = 3;

// Omni Flash 8–10s + proxy hay >10 phút (render ACTIVE + tải mp4). Timeout 10p
// từng fail oan khi bridge complete ~10–11p. Đồng bộ app 20p.
const DEFAULT_TIMEOUT_MS = 20 * 60_000;

export function createJobPoller(deps: {
  jobs: JobRepository;
  poll: VideoPollFn;
  intervalMs?: number;
  timeoutMs?: number;
  maxConsecutiveReauth?: number;
}) {
  const intervalMs = deps.intervalMs ?? 5_000;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxReauth = deps.maxConsecutiveReauth ?? MAX_CONSECUTIVE_REAUTH;
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  // Tránh tick chồng nhau: 1 poll (nhiều payload evaluate) có thể > intervalMs.
  let ticking = false;
  // Job đang poll dở — bỏ qua nếu tick sau còn thấy trong list.
  const inFlight = new Set<string>();
  // Đếm reauth liên tiếp theo job; reset khi poll thành công. In-memory là đủ vì
  // restart tiến trình thì job tự resume lại từ đầu.
  const reauthStreak = new Map<string, number>();

  async function tick(): Promise<void> {
    if (stopped || ticking) return;
    ticking = true;
    try {
      const jobs = deps.jobs.listResumable();
      const live = new Set<string>();
      for (const job of jobs) {
        live.add(job.id);
        const age = Date.now() - new Date(job.createdAt).getTime();
        if (age > timeoutMs) {
          deps.jobs.update(job.id, {
            status: "failed",
            errorCode: "FLOW_JOB_TIMEOUT",
            errorMessage: "timeout",
            progress: 100,
          });
          reauthStreak.delete(job.id);
          inFlight.delete(job.id);
          continue;
        }
        if (inFlight.has(job.id)) continue;
        inFlight.add(job.id);
        try {
          await deps.poll(job.id);
          reauthStreak.delete(job.id);
        } catch (error) {
          const message = error instanceof Error ? error.message : "poll failed";
          if (message.includes("FLOW_REAUTH_REQUIRED")) {
            const streak = (reauthStreak.get(job.id) ?? 0) + 1;
            reauthStreak.set(job.id, streak);
            if (streak >= maxReauth) {
              deps.jobs.update(job.id, {
                status: "failed",
                errorCode: "FLOW_REAUTH_REQUIRED",
                errorMessage: "reauth required",
                progress: 100,
              });
              reauthStreak.delete(job.id);
            }
            // else: giữ job đang chạy, thử lại nhịp poll sau.
          }
        } finally {
          inFlight.delete(job.id);
        }
      }
      // Dọn bộ đếm cho job không còn resumable (đã completed/failed).
      for (const id of reauthStreak.keys()) {
        if (!live.has(id)) reauthStreak.delete(id);
      }
      for (const id of [...inFlight]) {
        if (!live.has(id)) inFlight.delete(id);
      }
    } finally {
      ticking = false;
    }
  }

  return {
    start() {
      if (timer) return;
      stopped = false;
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
      // unref so tests/process can exit if nothing else is running
      timer.unref?.();
    },
    async stop() {
      stopped = true;
      if (timer) clearInterval(timer);
      timer = null;
    },
    tick,
  };
}
