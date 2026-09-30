use std::collections::{HashMap, HashSet};
use std::process::Command;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::error::{AppError, AppResult};

const GRACEFUL_KILL_TIMEOUT: Duration = Duration::from_millis(1500);
const KILL_POLL_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    pub port: u16,
    pub protocol: String,
    pub address: String,
    pub pid: i32,
    pub process_name: String,
    pub user: String,
    /// Full command line (`ps args`); empty if it could not be read.
    pub command: String,
    /// Working directory of the process, if readable.
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
struct ProcessDetails {
    command: String,
    cwd: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum KillOutcome {
    /// Exited after SIGTERM.
    Terminated,
    /// Ignored SIGTERM and had to be SIGKILLed.
    ForceKilled,
}

/// Lists TCP sockets in LISTEN state. Without root, lsof only reports
/// processes owned by the current user.
pub fn list_listening_ports() -> AppResult<Vec<ListeningPort>> {
    let output = Command::new("/usr/sbin/lsof")
        // -n/-P: skip DNS and port-name lookups; +c0: untruncated command names;
        // -F: machine-readable fields (p=pid, c=command, L=login, P=protocol, n=name).
        .args(["-nP", "+c0", "-iTCP", "-sTCP:LISTEN", "-FpcLPn"])
        .output()?;

    // lsof exits with 1 and prints nothing when no socket matches; that is an
    // empty result, not a failure.
    let stderr = String::from_utf8_lossy(&output.stderr);
    if !output.status.success() && output.stdout.is_empty() && !stderr.trim().is_empty() {
        return Err(AppError::LsofFailed(stderr.trim().to_owned()));
    }

    let mut ports = parse_lsof_output(&String::from_utf8_lossy(&output.stdout));

    let pids: Vec<i32> = ports
        .iter()
        .map(|p| p.pid)
        .collect::<HashSet<_>>()
        .into_iter()
        .collect();
    let details = process_details(&pids);
    for port in &mut ports {
        if let Some(d) = details.get(&port.pid) {
            port.command.clone_from(&d.command);
            port.cwd.clone_from(&d.cwd);
        }
    }

    ports.sort_by(|a, b| a.port.cmp(&b.port).then(a.pid.cmp(&b.pid)));
    Ok(ports)
}

/// Command lines and working directories for `pids`, one `ps` and one `lsof`
/// call in total. Best-effort: failures leave fields empty instead of failing
/// the whole listing.
fn process_details(pids: &[i32]) -> HashMap<i32, ProcessDetails> {
    let mut details: HashMap<i32, ProcessDetails> = HashMap::new();
    if pids.is_empty() {
        return details;
    }
    let pid_list = pids.iter().map(i32::to_string).collect::<Vec<_>>().join(",");

    // -ww: never truncate the command line.
    if let Ok(out) = Command::new("/bin/ps")
        .args(["-ww", "-o", "pid=,args=", "-p", &pid_list])
        .output()
    {
        for (pid, args) in parse_ps_args(&String::from_utf8_lossy(&out.stdout)) {
            details.entry(pid).or_default().command = args;
        }
    }

    // -a: AND the filters, i.e. only the cwd descriptor of the given pids.
    if let Ok(out) = Command::new("/usr/sbin/lsof")
        .args(["-a", "-d", "cwd", "-Fpn", "-p", &pid_list])
        .output()
    {
        for (pid, cwd) in parse_lsof_cwd(&String::from_utf8_lossy(&out.stdout)) {
            details.entry(pid).or_default().cwd = Some(cwd);
        }
    }

    details
}

/// Parses `ps -o pid=,args=` lines such as `  512 node server.js`.
fn parse_ps_args(raw: &str) -> Vec<(i32, String)> {
    raw.lines()
        .filter_map(|line| {
            let line = line.trim_start();
            let (pid, args) = line.split_once(char::is_whitespace).unwrap_or((line, ""));
            Some((pid.parse().ok()?, args.trim().to_owned()))
        })
        .collect()
}

/// Parses `lsof -a -d cwd -Fpn` output into (pid, cwd) pairs.
fn parse_lsof_cwd(raw: &str) -> Vec<(i32, String)> {
    let mut result = Vec::new();
    let mut pid: Option<i32> = None;
    for line in raw.lines() {
        if let Some(value) = line.strip_prefix('p') {
            pid = value.parse().ok();
        } else if let (Some(value), Some(pid)) = (line.strip_prefix('n'), pid) {
            result.push((pid, value.to_owned()));
        }
    }
    result
}

/// Parses `lsof -F pcLPn` output. Process-level fields (p, c, L) are followed
/// by one or more file-level groups (f, P, n); each `n` line closes a socket.
fn parse_lsof_output(raw: &str) -> Vec<ListeningPort> {
    let mut result = Vec::new();
    // The same socket shows up once per fd/forked child sharing it.
    let mut seen: HashSet<(i32, String, u16)> = HashSet::new();

    let mut pid: Option<i32> = None;
    let mut command = String::new();
    let mut user = String::new();
    let mut protocol = String::new();

    for line in raw.lines() {
        let Some(tag) = line.chars().next() else { continue };
        let value = &line[tag.len_utf8()..];
        match tag {
            'p' => {
                pid = value.parse().ok();
                command.clear();
                user.clear();
            }
            'c' => command = value.to_owned(),
            'L' => user = value.to_owned(),
            'f' => protocol.clear(),
            'P' => protocol = value.to_owned(),
            'n' => {
                let (Some(pid), Some((address, port))) = (pid, split_address(value)) else {
                    continue;
                };
                if seen.insert((pid, address.clone(), port)) {
                    result.push(ListeningPort {
                        port,
                        protocol: protocol.clone(),
                        address,
                        pid,
                        process_name: command.clone(),
                        user: user.clone(),
                        command: String::new(),
                        cwd: None,
                    });
                }
            }
            _ => {}
        }
    }

    result
}

/// Splits `*:3000`, `127.0.0.1:5432` or `[::1]:8080` into (address, port).
fn split_address(name: &str) -> Option<(String, u16)> {
    let (address, port) = name.rsplit_once(':')?;
    let port = port.parse().ok()?;
    let address = address.trim_start_matches('[').trim_end_matches(']');
    Some((address.to_owned(), port))
}

/// Sends SIGTERM, waits briefly for a graceful exit, then falls back to SIGKILL.
/// Blocking: call from a blocking thread, never from the main thread.
pub fn kill_process(pid: i32) -> AppResult<KillOutcome> {
    if pid <= 1 || pid == std::process::id() as i32 {
        return Err(AppError::ProtectedPid(pid));
    }

    send_signal(pid, libc::SIGTERM)?;

    let deadline = Instant::now() + GRACEFUL_KILL_TIMEOUT;
    while Instant::now() < deadline {
        if !is_alive(pid) {
            return Ok(KillOutcome::Terminated);
        }
        thread::sleep(KILL_POLL_INTERVAL);
    }

    match send_signal(pid, libc::SIGKILL) {
        Ok(()) => Ok(KillOutcome::ForceKilled),
        // Exited between the last poll and SIGKILL.
        Err(AppError::NoSuchProcess(_)) => Ok(KillOutcome::Terminated),
        Err(err) => Err(err),
    }
}

fn send_signal(pid: i32, signal: libc::c_int) -> AppResult<()> {
    // SAFETY: kill(2) has no memory-safety preconditions.
    if unsafe { libc::kill(pid, signal) } == 0 {
        return Ok(());
    }
    let err = std::io::Error::last_os_error();
    Err(match err.raw_os_error() {
        Some(libc::ESRCH) => AppError::NoSuchProcess(pid),
        Some(libc::EPERM) => AppError::PermissionDenied(pid),
        _ => AppError::Signal { pid, source: err },
    })
}

fn is_alive(pid: i32) -> bool {
    // Signal 0 performs the permission/existence check without sending anything.
    // SAFETY: see `send_signal`.
    unsafe { libc::kill(pid, 0) == 0 }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = "\
p512
cnode
Lzhaoliang
f23
PTCP
n*:3000
f24
PTCP
n[::1]:3000
p777
cpostgres
Lzhaoliang
f7
PTCP
n127.0.0.1:5432
f8
PTCP
n127.0.0.1:5432
";

    #[test]
    fn parses_processes_and_sockets() {
        let ports = parse_lsof_output(SAMPLE);
        assert_eq!(ports.len(), 3);
        assert_eq!(
            ports[0],
            ListeningPort {
                port: 3000,
                protocol: "TCP".into(),
                address: "*".into(),
                pid: 512,
                process_name: "node".into(),
                user: "zhaoliang".into(),
                command: String::new(),
                cwd: None,
            }
        );
        assert_eq!(ports[1].address, "::1");
        assert_eq!(ports[2].process_name, "postgres");
        assert_eq!(ports[2].port, 5432);
    }

    #[test]
    fn parses_ps_args() {
        let raw = "  512 node /Users/me/app/node_modules/.bin/next dev\n  777 postgres -D /usr/local/var\n 900\n";
        assert_eq!(
            parse_ps_args(raw),
            vec![
                (512, "node /Users/me/app/node_modules/.bin/next dev".into()),
                (777, "postgres -D /usr/local/var".into()),
                (900, String::new()),
            ]
        );
    }

    #[test]
    fn parses_lsof_cwd() {
        let raw = "p512\nfcwd\nn/Users/me/app\np777\nfcwd\nn/\n";
        assert_eq!(
            parse_lsof_cwd(raw),
            vec![(512, "/Users/me/app".into()), (777, "/".into())]
        );
    }

    #[test]
    fn empty_output_yields_no_ports() {
        assert!(parse_lsof_output("").is_empty());
    }

    #[test]
    fn splits_addresses() {
        assert_eq!(split_address("*:80"), Some(("*".into(), 80)));
        assert_eq!(split_address("[fe80::1]:443"), Some(("fe80::1".into(), 443)));
        assert_eq!(split_address("garbage"), None);
    }

    #[test]
    fn refuses_protected_pids() {
        assert!(matches!(kill_process(1), Err(AppError::ProtectedPid(1))));
        let own = std::process::id() as i32;
        assert!(matches!(kill_process(own), Err(AppError::ProtectedPid(_))));
    }
}
