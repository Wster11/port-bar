/** `/Applications/Google Chrome.app/Contents/MacOS/` and similar bundle prefixes. */
const APP_BUNDLE_EXEC = /\/(?:[^/]+\/)*[^/]+\.app\/Contents\/MacOS\//g;
const SCRIPT_EXT = /\.(?:[cm]?js|ts)$/;

function basename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

export function tildify(path: string, home: string): string {
  if (!home) return path;
  if (path === home) return "~";
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

/**
 * Shortens a command line for display, e.g.
 * `/Users/me/.nvm/.../bin/node /Users/me/app/node_modules/.bin/vite --port 5173`
 * → `node vite --port 5173`. Tooltips and copying keep the raw command.
 */
export function displayCommand(command: string, home: string): string {
  return command
    .replace(APP_BUNDLE_EXEC, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((token, index) => {
      if (token.includes("node_modules/")) return basename(token).replace(SCRIPT_EXT, "");
      if (index === 0 && token.startsWith("/")) return basename(token);
      return tildify(token, home);
    })
    .join(" ");
}

/** Working directory worth showing, or null for `/` and app sandbox containers. */
export function displayDirectory(cwd: string | null, home: string): string | null {
  if (!cwd || cwd === "/") return null;
  const short = tildify(cwd, home);
  return short.startsWith("~/Library/") ? null : short;
}
