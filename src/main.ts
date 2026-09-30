import {
  copyToClipboard,
  getHomeDir,
  getSystemLocale,
  killProcess,
  listListeningPorts,
  onPanelShown,
  openInBrowser,
  quitApp,
  revealInFinder,
  runningInTauri,
  showContextMenu,
  type ContextMenuEntry,
} from "./api";
import { displayCommand, displayDirectory } from "./format";
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
  homeDir: string;
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
  homeDir: "",
  pendingKillPid: null,
  killingPid: null,
};

/** Groups from the last render, for context-menu lookups. */
let renderedGroups = new Map<number, ProcessGroup>();
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
  folderTemplate: $<HTMLTemplateElement>("#icon-folder"),
};

function groupByProcess(ports: ListeningPort[]): ProcessGroup[] {
  const groups = new Map<number, ProcessGroup>();
  for (const entry of ports) {
    let group = groups.get(entry.pid);
    if (!group) {
      group = {
        pid: entry.pid,
        processName: entry.processName,
        user: entry.user,
        command: entry.command,
        cwd: entry.cwd,
        ports: [],
      };
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
    group.command.toLowerCase().includes(q) ||
    (group.cwd?.toLowerCase().includes(q) ?? false) ||
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

type RowAction = "kill" | "cancel" | "open" | "more-ports";

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

function renderPorts(group: ProcessGroup): HTMLDivElement {
  const line = el("div", "ports");
  for (const { port, addresses } of group.ports.slice(0, MAX_VISIBLE_PORTS)) {
    const pill = actionButton("open", group.pid, "pill");
    pill.dataset.port = String(port);
    pill.textContent = `:${port}`;
    pill.title = `${t().openPortHint(port)}\n${addresses.map((a) => `${a}:${port}`).join("\n")}`;
    line.append(pill);
  }
  const hidden = group.ports.length - MAX_VISIBLE_PORTS;
  if (hidden > 0) {
    const more = actionButton("more-ports", group.pid, "pill more");
    more.textContent = `+${hidden}`;
    more.title = group.ports
      .slice(MAX_VISIBLE_PORTS)
      .map((p) => `:${p.port}`)
      .join(" ");
    line.append(more);
  }
  return line;
}

function renderRow(group: ProcessGroup): HTMLLIElement {
  const li = el("li", "row");
  li.dataset.pid = String(group.pid);

  const name = group.processName || t().unknownProcess;
  const info = el("div", "info");
  const titleLine = el("div", "title-line");
  const nameEl = el("span", "name", name);
  nameEl.title = name;
  titleLine.append(nameEl, el("span", "pid", `PID ${group.pid}`));
  info.append(titleLine);

  const command = displayCommand(group.command, state.homeDir);
  if (command && command !== name) {
    const commandEl = el("div", "command", command);
    commandEl.title = group.command;
    info.append(commandEl);
  }

  const directory = displayDirectory(group.cwd, state.homeDir);
  if (directory && group.cwd) {
    const dirEl = el("div", "cwd");
    dirEl.title = group.cwd;
    dirEl.append(els.folderTemplate.content.cloneNode(true), el("span", "", directory));
    info.append(dirEl);
  }

  info.append(renderPorts(group));
  li.append(info, renderActions(group.pid));
  return li;
}

function render(): void {
  const groups = visibleGroups();
  renderedGroups = new Map(groups.map((g) => [g.pid, g]));
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

function showError(error: unknown): void {
  state.error = describeError(error);
  render();
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

function requestKillConfirmation(pid: number): void {
  resetPendingKill();
  state.pendingKillPid = pid;
  confirmTimer = window.setTimeout(() => {
    state.pendingKillPid = null;
    render();
  }, CONFIRM_TIMEOUT_MS);
  render();
}

async function handleKillClick(pid: number): Promise<void> {
  if (state.pendingKillPid !== pid) {
    requestKillConfirmation(pid);
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

function openPort(port: number): void {
  openInBrowser(port).catch(showError);
}

function copy(text: string): void {
  copyToClipboard(text)
    .then(() => showToast(t().copied))
    .catch(showError);
}

function portMenu(port: number): ContextMenuEntry[] {
  const url = `http://localhost:${port}`;
  return [
    { label: t().openInBrowser(port), action: () => openPort(port) },
    "separator",
    { label: t().copyUrl, action: () => copy(url) },
    { label: t().copyPort, action: () => copy(String(port)) },
  ];
}

function processMenu(group: ProcessGroup): ContextMenuEntry[] {
  const { cwd } = group;
  const hasDirectory = displayDirectory(cwd, state.homeDir) !== null;
  return [
    ...group.ports.slice(0, MAX_VISIBLE_PORTS).map(({ port }) => ({
      label: t().openInBrowser(port),
      action: () => openPort(port),
    })),
    "separator",
    { label: t().copyPid, action: () => copy(String(group.pid)) },
    { label: t().copyCommand, action: () => copy(group.command), enabled: !!group.command },
    { label: t().copyPath, action: () => cwd && copy(cwd), enabled: hasDirectory },
    {
      label: t().revealInFinder,
      action: () => cwd && revealInFinder(cwd).catch(showError),
      enabled: hasDirectory,
    },
    "separator",
    { label: t().killEllipsis, action: () => requestKillConfirmation(group.pid) },
  ];
}

function hiddenPortsMenu(group: ProcessGroup): ContextMenuEntry[] {
  return group.ports.slice(MAX_VISIBLE_PORTS).map(({ port }) => ({
    label: t().openInBrowser(port),
    action: () => openPort(port),
  }));
}

function handleAction(button: HTMLButtonElement): void {
  const pid = Number(button.dataset.pid);
  const group = renderedGroups.get(pid);
  switch (button.dataset.action as RowAction) {
    case "kill":
      void handleKillClick(pid);
      return;
    case "cancel":
      cancelPendingKill();
      return;
    case "open":
      cancelPendingKill();
      openPort(Number(button.dataset.port));
      return;
    case "more-ports":
      cancelPendingKill();
      if (group) void showContextMenu(hiddenPortsMenu(group));
      return;
  }
}

function handleContextMenu(event: MouseEvent): void {
  const target = event.target as Element | null;
  // Keep the native Copy/Paste menu inside the search field.
  if (target?.closest("input")) return;
  event.preventDefault();
  cancelPendingKill();

  const pill = target?.closest<HTMLElement>(".pill[data-port]");
  if (pill) {
    void showContextMenu(portMenu(Number(pill.dataset.port)));
    return;
  }
  const row = target?.closest<HTMLElement>(".row");
  const group = row && renderedGroups.get(Number(row.dataset.pid));
  if (group) void showContextMenu(processMenu(group));
}

function bindEvents(): void {
  els.search.addEventListener("input", () => {
    state.query = els.search.value;
    render();
  });

  els.refresh.addEventListener("click", () => void refresh());

  els.quit.addEventListener("click", () => {
    quitApp().catch(showError);
  });

  // Single delegated handler: row actions, or cancel a pending kill when
  // clicking anywhere else in the panel.
  document.addEventListener("click", (event) => {
    const button = (event.target as Element | null)?.closest<HTMLButtonElement>(
      "button[data-action]",
    );
    if (!button || button.disabled) {
      cancelPendingKill();
      return;
    }
    handleAction(button);
  });

  document.addEventListener("contextmenu", handleContextMenu);

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
  state.homeDir = await getHomeDir().catch(() => "");
  await syncLocale();
  bindEvents();
  await refresh();
}

void start();
