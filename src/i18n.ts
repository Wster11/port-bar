import { NotInTauriError } from "./api";
import type { AppErrorCode, AppErrorPayload } from "./types";

export type Locale = "zh" | "en";

type ErrorMessages = Record<AppErrorCode, (e: AppErrorPayload) => string>;

const zhErrors: ErrorMessages = {
  lsofSpawn: (e) => `无法执行 lsof：${e.detail ?? ""}`,
  lsofFailed: (e) => `lsof 执行失败：${e.detail ?? ""}`,
  protectedPid: (e) => `不允许结束该进程 (PID ${e.pid})`,
  noSuchProcess: (e) => `进程 ${e.pid} 已不存在`,
  permissionDenied: (e) =>
    `权限不足，无法结束 PID ${e.pid}（进程属于其他用户或系统，需要管理员权限）`,
  signal: (e) => `发送信号失败 (PID ${e.pid})：${e.detail ?? ""}`,
  task: (e) => `后台任务异常：${e.detail ?? ""}`,
  openFailed: (e) => `打开失败：${e.detail ?? ""}`,
  invalidPath: (e) => `目录不存在：${e.detail ?? ""}`,
  clipboardFailed: (e) => `复制失败：${e.detail ?? ""}`,
};

const zh = {
  title: "监听端口",
  loading: "正在读取…",
  searchPlaceholder: "搜索",
  refresh: "刷新 (⌘R)",
  hint: "⌘R 刷新 · ⌘F 搜索",
  quit: "退出 PortBar",
  kill: "结束",
  cancel: "取消",
  killTitle: "结束进程",
  killConfirm: "确认结束进程",
  killing: "正在结束",
  unknownProcess: "未知进程",
  emptyNoMatch: "没有匹配的结果",
  emptyNone: "当前没有正在监听的端口",
  copyUrl: "复制 URL",
  copyPort: "复制端口",
  copyPid: "复制 PID",
  copyCommand: "复制启动命令",
  copyPath: "复制目录路径",
  revealInFinder: "在 Finder 中显示",
  killEllipsis: "结束进程…",
  copied: "已复制到剪贴板",
  openInBrowser: (port: number) => `在浏览器中打开 localhost:${port}`,
  openPortHint: (port: number) => `点击在浏览器中打开 http://localhost:${port}，右键查看更多`,
  notInTauri:
    "当前页面不在 Tauri 窗口中运行（请用 `pnpm tauri dev` 启动，并点击菜单栏图标打开，而不是在浏览器访问 localhost:1420）",
  summary: (ports: number, processes: number) => `${ports} 个端口 · ${processes} 个进程`,
  killed: (name: string) => `已结束 ${name}`,
  forceKilled: (name: string) => `已强制结束 ${name}`,
  loadFailed: (reason: string) => `获取端口失败：${reason}`,
  killFailed: (name: string, reason: string) => `结束 ${name} 失败：${reason}`,
  errors: zhErrors,
};

type Messages = typeof zh;

const en: Messages = {
  title: "Listening Ports",
  loading: "Loading…",
  searchPlaceholder: "Search",
  refresh: "Refresh (⌘R)",
  hint: "⌘R Refresh · ⌘F Search",
  quit: "Quit PortBar",
  kill: "Kill",
  cancel: "Cancel",
  killTitle: "Kill process",
  killConfirm: "Confirm kill process",
  killing: "Killing",
  unknownProcess: "Unknown process",
  emptyNoMatch: "No matching results",
  emptyNone: "No ports are being listened on",
  copyUrl: "Copy URL",
  copyPort: "Copy Port",
  copyPid: "Copy PID",
  copyCommand: "Copy Command",
  copyPath: "Copy Directory Path",
  revealInFinder: "Show in Finder",
  killEllipsis: "Kill Process…",
  copied: "Copied to clipboard",
  openInBrowser: (port) => `Open localhost:${port} in Browser`,
  openPortHint: (port) => `Click to open http://localhost:${port} in your browser; right-click for more`,
  notInTauri:
    "Not running inside the Tauri window. Start with `pnpm tauri dev` and open it from the menu bar icon instead of visiting localhost:1420 in a browser.",
  summary: (ports, processes) =>
    `${ports} ${ports === 1 ? "port" : "ports"} · ${processes} ${processes === 1 ? "process" : "processes"}`,
  killed: (name) => `Killed ${name}`,
  forceKilled: (name) => `Force killed ${name}`,
  loadFailed: (reason) => `Failed to load ports: ${reason}`,
  killFailed: (name, reason) => `Failed to kill ${name}: ${reason}`,
  errors: {
    lsofSpawn: (e) => `Could not run lsof: ${e.detail ?? ""}`,
    lsofFailed: (e) => `lsof failed: ${e.detail ?? ""}`,
    protectedPid: (e) => `This process cannot be killed (PID ${e.pid})`,
    noSuchProcess: (e) => `Process ${e.pid} no longer exists`,
    permissionDenied: (e) =>
      `Permission denied for PID ${e.pid} (owned by another user or the system; requires admin rights)`,
    signal: (e) => `Failed to send signal (PID ${e.pid}): ${e.detail ?? ""}`,
    task: (e) => `Background task failed: ${e.detail ?? ""}`,
    openFailed: (e) => `Failed to open: ${e.detail ?? ""}`,
    invalidPath: (e) => `Directory does not exist: ${e.detail ?? ""}`,
    clipboardFailed: (e) => `Failed to copy: ${e.detail ?? ""}`,
  },
};

/** Keys whose value is a plain string, usable from `data-i18n*` attributes. */
type StaticKey = { [K in keyof Messages]: Messages[K] extends string ? K : never }[keyof Messages];

let current: Messages = en;

/** Current message bundle. */
export function t(): Messages {
  return current;
}

export function resolveLocale(tag: string): Locale {
  return tag.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function setLocale(locale: Locale): void {
  current = locale === "zh" ? zh : en;
  document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  applyStaticText();
}

function lookup(key: string | undefined): string | undefined {
  if (!key || !(key in current)) return undefined;
  const value = current[key as StaticKey];
  return typeof value === "string" ? value : undefined;
}

/**
 * Fills static markup: `data-i18n` → textContent, `data-i18n-placeholder`,
 * `data-i18n-title` (also sets aria-label).
 */
function applyStaticText(): void {
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n]")) {
    const text = lookup(node.dataset.i18n);
    if (text !== undefined) node.textContent = text;
  }
  for (const node of document.querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")) {
    const text = lookup(node.dataset.i18nPlaceholder);
    if (text !== undefined) node.placeholder = text;
  }
  for (const node of document.querySelectorAll<HTMLElement>("[data-i18n-title]")) {
    const text = lookup(node.dataset.i18nTitle);
    if (text === undefined) continue;
    node.title = text;
    node.setAttribute("aria-label", text);
  }
}

function isAppErrorPayload(value: unknown): value is AppErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "code" in value &&
    typeof value.code === "string" &&
    value.code in current.errors
  );
}

/** Turns anything a command can reject with into a localized message. */
export function describeError(error: unknown): string {
  if (error instanceof NotInTauriError) return current.notInTauri;
  if (isAppErrorPayload(error)) return current.errors[error.code](error);
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  return String(error);
}
