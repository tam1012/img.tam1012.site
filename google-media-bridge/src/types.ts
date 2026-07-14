export type AccountStatus =
  | "healthy"
  | "busy"
  | "cooldown"
  | "reauth_required"
  | "blocked"
  | "disabled";

export type JobStatus = "queued" | "scheduled" | "active" | "completed" | "failed";
export type JobKind = "text_video" | "image_video" | "start_end_video";

export type FlowErrorCode =
  | "FLOW_POOL_UNAVAILABLE"
  | "FLOW_REAUTH_REQUIRED"
  | "FLOW_QUOTA_EXCEEDED"
  | "FLOW_RECAPTCHA_FAILED"
  | "FLOW_UPSTREAM_REJECTED"
  | "FLOW_JOB_TIMEOUT"
  | "FLOW_INVALID_REQUEST"
  | "FLOW_UNAUTHORIZED";

export type AccountRecord = {
  id: string;
  alias: string;
  encryptedStorageState: string;
  status: AccountStatus;
  activeLeases: number;
  cooldownUntil: string | null;
  lastVerifiedAt: string | null;
  lastUsedAt: string | null;
  failureCode: string | null;
  projectId: string | null;
  siteKey: string | null;
  createdAt: string;
  updatedAt: string;
};

export type JobRecord = {
  id: string;
  idempotencyKey: string;
  kind: JobKind;
  status: JobStatus;
  accountId: string;
  encryptedUpstreamState: string | null;
  outputPath: string | null;
  progress: number;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export type FlowImageModel = "flow-nano-banana-2" | "NARWHAL";
export type FlowVideoModel = "flow-video-fast-4s" | "grok-imagine-video";
