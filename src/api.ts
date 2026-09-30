import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { KillOutcome, ListeningPort } from "./types";

/** Emitted by the Rust side every time the tray panel is shown. */
const PANEL_SHOWN_EVENT = "panel-shown";

/** Thrown when the page is opened in a plain browser instead of the Tauri webview. */
export class NotInTauriError extends Error {
  constructor() {
    super("Not running inside a Tauri webview");
    this.name = "NotInTauriError";
  }
}

function ensureTauri(): void {
  if (!isTauri()) throw new NotInTauriError();
}

export function runningInTauri(): boolean {
  return isTauri();
}

export async function listListeningPorts(): Promise<ListeningPort[]> {
  ensureTauri();
  return invoke<ListeningPort[]>("list_listening_ports");
}

export async function killProcess(pid: number): Promise<KillOutcome> {
  ensureTauri();
  return invoke<KillOutcome>("kill_process", { pid });
}

/** System language as a BCP 47 tag; falls back to the webview's language outside Tauri. */
export async function getSystemLocale(): Promise<string> {
  if (!isTauri()) return navigator.language;
  return invoke<string>("system_locale");
}

export async function quitApp(): Promise<void> {
  ensureTauri();
  return invoke("quit_app");
}

export async function onPanelShown(handler: () => void): Promise<UnlistenFn | undefined> {
  if (!isTauri()) return undefined;
  return listen(PANEL_SHOWN_EVENT, handler);
}
