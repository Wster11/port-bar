import {
  getSystemLocale,
  killProcess,
  listListeningPorts,
  onPanelShown,
  quitApp,
  runningInTauri,
} from "./api";
import { describeError, resolveLocale, setLocale, t } from "./i18n";
import type { ListeningPort, ProcessGroup } from "./types";

const CONFIRM_TIMEOUT_MS = 3000;
const TOAST_DURATION_MS = 2400;
const MAX_VISIBLE_PORTS = 4;

interface AppState {
  ports: ListeningPort[];
  query: string;
  loading: boolean;
  loadedOnce: boolean;
  error: string | null;
  /** PID currently waiting for a second click to confirm the kill. */
  pendingKillPid: number | null;
  killingPid: number | null;
}

const state: AppState = {
  ports: [],
  query: "",
  loading: false,
  loadedOnce: false,
  error: null,
  pendingKillPid: null,
  killingPid: null,
};

let confirmTimer: number | undefined;
let toastTimer: number | undefined;

function $<T extends HTMLElement>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`Missing element: ${selector}`);
  return el;
}

const els = {
  search: $<HTMLInputElement>("#search"),
  refresh: $<HTMLButtonElement>("#refresh"),
  quit: $<HTMLButtonElement>("#quit"),
  banner: $<HTMLDivElement>("#banner"),
  list: $<HTMLUListElement>("#list"),
  empty: $<HTMLDivElement>("#empty"),
  emptyText: $<HTMLParagraphElement>("#empty-text"),
  summary: $<HTMLParagraphElement>("#summary"),
  toast: $<HTMLDivElement>("#toast"),
  xmarkTemplate: $<HTMLTemplateElement>("#icon-xmark"),
};

function groupByProcess(ports: ListeningPort[]): ProcessGroup[] {
  const groups = new Map<number, ProcessGroup>();
  for (const entry of ports) {
    let group = groups.get(entry.pid);
    if (!group) {
      group = { pid: entry.pid, processName: entry.processName, user: entry.user, ports: [] };
      groups.set(entry.pid, group);
    }
    const existing = group.ports.find((p) => p.port === entry.port);
    if (existing) existing.addresses.push(entry.address);
    else group.ports.push({ port: entry.port, addresses: [entry.address] });
  }
  for (const group of groups.values()) group.ports.sort((a, b) => a.port - b.port);
  return [...groups.values()];
}

function matchesQuery(group: ProcessGroup, q: string): boolean {
  return (
    group.processName.toLowerCase().includes(q) ||
    String(group.pid).includes(q) ||
    group.ports.some((p) => String(p.port).includes(q) || p.addresses.some((a) => a.includes(q)))
  );
}

function visibleGroups(): ProcessGroup[] {
  const groups = groupByProcess(state.ports);
  const q = state.query.trim().toLowerCase();
  return q ? groups.filter((g) => matchesQuery(g, q)) : groups;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

type RowAction = "kill" | "cancel";

function actionButton(action: RowAction, pid: number, className: string): HTMLButtonElement {
  const button = el("button", className);
  button.dataset.action = action;
  button.dataset.pid = String(pid);
  return button;
}

function renderActions(pid: number): HTMLDivElement {
  const actions = el("div", "actions");
  const kill = actionButton("kill", pid, "kill-btn");

  if (state.killingPid === pid) {
    kill.classList.add("killing");
    kill.disabled = true;
    kill.setAttribute("aria-label", t().killing);
    kill.append(el("span", "spinner"));
  } else if (state.pendingKillPid === pid) {
    const cancel = actionButton("cancel", pid, "cancel-btn");
    cancel.textContent = t().cancel;
    actions.append(cancel);

    kill.classList.add("pending");
    kill.textContent = t().kill;
    kill.setAttribute("aria-label", t().killConfirm);
  } else {
    kill.title = t().killTitle;
    kill.setAttribute("aria-label", t().killTitle);
    kill.append(els.xmarkTemplate.content.cloneNode(true));
  }

  actions.append(kill);
  return actions;
}

function renderRow(group: ProcessGroup): HTMLLIElement {
  const li = el("li", "row");

  const name = group.processName || t().unknownProcess;
  const info = el("div", "info");
  const titleLine = el("div", "title-line");
  const nameEl = el("span", "name", name);
  nameEl.title = name;
  titleLine.append(nameEl, el("span", "pid", `PID ${group.pid}`));

  const portsLine = el("div", "ports");
  for (const { port, addresses } of group.ports.slice(0, MAX_VISIBLE_PORTS)) {
    const pill = el("span", "pill", `:${port}`);
    pill.title = addresses.map((a) => `${a}:${port}`).join("\n");
    portsLine.append(pill);
  }
  const hidden = group.ports.length - MAX_VISIBLE_PORTS;
  if (hidden > 0) {
    const more = el("span", "pill more", `+${hidden}`);
    more.title = group.ports
      .slice(MAX_VISIBLE_PORTS)
      .map((p) => `:${p.port}`)
      .join(" ");
    portsLine.append(more);
  }

  info.append(titleLine, portsLine);
  li.append(info, renderActions(group.pid));
  return li;
}

function render(): void {
  const groups = visibleGroups();
  els.list.replaceChildren(...groups.map(renderRow));
  els.list.hidden = groups.length === 0;
  els.refresh.classList.toggle("spinning", state.loading);

  els.banner.hidden = state.error === null;
  els.banner.textContent = state.error ?? "";

  const showEmpty = state.loadedOnce && groups.length === 0 && state.error === null;
  els.empty.hidden = !showEmpty;
  els.emptyText.textContent = state.query ? t().emptyNoMatch : t().emptyNone;

  if (state.loadedOnce) {
    const processCount = new Set(state.ports.map((p) => p.pid)).size;
    const portCount = new Set(state.ports.map((p) => p.port)).size;
    els.summary.textContent = t().summary(portCount, processCount);
  }
}

function showToast(message: string): void {
  window.clearTimeout(toastTimer);
  els.toast.textContent = message;
  els.toast.hidden = false;
  // Restart the enter animation even if a toast is already visible.
  els.toast.classList.remove("visible");
  void els.toast.offsetWidth;
  els.toast.classList.add("visible");
  toastTimer = window.setTimeout(() => {
    els.toast.classList.remove("visible");
  }, TOAST_DURATION_MS);
}

async function refresh(): Promise<void> {
  if (state.loading) return;
  state.loading = true;
  render();
  try {
    state.ports = await listListeningPorts();
    state.error = null;
  } catch (error) {
    state.error = t().loadFailed(describeError(error));
  } finally {
    state.loading = false;
    state.loadedOnce = true;
    render();
  }
}

function resetPendingKill(): void {
  window.clearTimeout(confirmTimer);
  state.pendingKillPid = null;
}

/** Returns whether there was a pending confirmation to cancel. */
function cancelPendingKill(): boolean {
  if (state.pendingKillPid === null) return false;
  resetPendingKill();
  render();
  return true;
}

async function handleKillClick(pid: number): Promise<void> {
  if (state.pendingKillPid !== pid) {
    resetPendingKill();
    state.pendingKillPid = pid;
    confirmTimer = window.setTimeout(() => {
      state.pendingKillPid = null;
      render();
    }, CONFIRM_TIMEOUT_MS);
    render();
    return;
  }

  resetPendingKill();
  state.killingPid = pid;
  render();

  const name = state.ports.find((p) => p.pid === pid)?.processName || t().unknownProcess;
  let killError: string | null = null;
  try {
    const outcome = await killProcess(pid);
    showToast(outcome === "forceKilled" ? t().forceKilled(name) : t().killed(name));
  } catch (error) {
    killError = t().killFailed(name, describeError(error));
  }

  state.killingPid = null;
  await refresh();
  // refresh() resets `error` on success; the kill failure must stay visible.
  if (killError && !state.error) {
    state.error = killError;
    render();
  }
}

function bindEvents(): void {
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    render();
  });

  els.refresh.addEventListener("click", () => void refresh());

  els.quit.addEventListener("click", () => {
    quitApp().catch((error: unknown) => {
      state.error = describeError(error);
      render();
    });
  });

  // Single delegated handler: row actions, or cancel a pending kill when
  // clicking anywhere else in the panel.
  document.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "button[data-action]",
    );
    const pid = Number(button?.dataset.pid);
    if (!button || button.disabled || !Number.isInteger(pid)) {
      cancelPendingKill();
      return;
    }
    if (button.dataset.action === "cancel") cancelPendingKill();
    else void handleKillClick(pid);
  });

  window.addEventListener("keydown", (event) => {
    if (event.metaKey && event.key.toLowerCase() === "r") {
      event.preventDefault();
      void refresh();
    } else if (event.metaKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      els.search.focus();
    } else if (event.key === "Escape") {
      // Esc peels back one layer: pending kill first, then the search query.
      if (cancelPendingKill() || !state.query) return;
      els.search.value = "";
      state.query = "";
      render();
    }
  });

  void onPanelShown(() => {
    resetPendingKill();
    // Re-read the language each time so system changes apply without a restart.
    void syncLocale().then(refresh);
  });
}

async function syncLocale(): Promise<void> {
  try {
    setLocale(resolveLocale(await getSystemLocale()));
  } catch {
    setLocale(resolveLocale(navigator.language));
  }
}

async function start(): Promise<void> {
  document.documentElement.classList.toggle("is-tauri", runningInTauri());
  await syncLocale();
  bindEvents();
  await refresh();
}

void start();
