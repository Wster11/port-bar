/** Mirrors `ports::ListeningPort` in src-tauri/src/ports.rs (camelCase via serde). */
export interface ListeningPort {
  port: number;
  protocol: string;
  address: string;
  pid: number;
  processName: string;
  user: string;
}

/** Mirrors `ports::KillOutcome` in src-tauri/src/ports.rs. */
export type KillOutcome = "terminated" | "forceKilled";

/** Mirrors `error::ErrorPayload` in src-tauri/src/error.rs. */
export type AppErrorCode =
  | "lsofSpawn"
  | "lsofFailed"
  | "protectedPid"
  | "noSuchProcess"
  | "permissionDenied"
  | "signal"
  | "task";

export interface AppErrorPayload {
  code: AppErrorCode;
  pid?: number;
  detail?: string;
}

/** Frontend-only view model: one row per process. */
export interface ProcessGroup {
  pid: number;
  processName: string;
  user: string;
  /** Unique port numbers, ascending, each with every address it listens on. */
  ports: { port: number; addresses: string[] }[];
}
