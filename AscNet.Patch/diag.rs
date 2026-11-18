//! Shared by lucia and krsdk via `#[path]` (std only). Player-facing diagnostics: every line goes to
//! stdout (visible only when PGR.exe is started from a console/Wine) and is appended to
//! `ascnet-patch.log` beside PGR.exe.
//!
//! Logging must never block a game thread. PGR.exe is usually spawned by the launcher with a piped
//! stdout that nobody drains; once that pipe fills, a synchronous `println!` blocks in `NtWriteFile`
//! forever and (holding Rust's stdout lock) freezes the whole client. So `log` only hands the line to
//! a bounded queue and returns; a single background writer does the file append and stdout write. If
//! the writer stalls on a full pipe the queue fills and further lines are dropped — the game keeps running.

use std::{
    fs::OpenOptions,
    io::Write,
    sync::{mpsc, OnceLock},
    thread,
};

const LOG_FILE: &str = "ascnet-patch.log";
// Oversize check runs once per process (first write); not a true rotation.
const MAX_BYTES: u64 = 1 << 20;
const QUEUE_CAP: usize = 1024;

fn writer() -> &'static mpsc::SyncSender<String> {
    static TX: OnceLock<mpsc::SyncSender<String>> = OnceLock::new();
    TX.get_or_init(|| {
        let (tx, rx) = mpsc::sync_channel::<String>(QUEUE_CAP);
        let _ = thread::Builder::new()
            .name("ascnet-log".into())
            .spawn(move || {
                let path = std::env::current_exe()
                    .ok()
                    .and_then(|exe| exe.parent().map(|dir| dir.join(LOG_FILE)));
                let mut trimmed = false;
                while let Ok(line) = rx.recv() {
                    if let Some(path) = &path {
                        if !trimmed {
                            trimmed = true;
                            if std::fs::metadata(path).is_ok_and(|meta| meta.len() > MAX_BYTES) {
                                let _ = std::fs::remove_file(path);
                            }
                        }
                        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
                            let _ = writeln!(file, "{line}");
                        }
                    }
                    // File first so diagnostics survive even if this stdout write stalls on a full pipe.
                    println!("{line}");
                }
            });
        tx
    })
}

pub(crate) fn log(line: &str) {
    // Non-blocking: drop the line when the queue is full rather than ever blocking the caller.
    let _ = writer().try_send(line.to_owned());
}

/// `[tag] OK <what>[: detail]`
pub(crate) fn ok_line(tag: &str, what: &str, detail: &str) -> String {
    if detail.is_empty() { format!("[{tag}] OK {what}") } else { format!("[{tag}] OK {what}: {detail}") }
}

/// `[tag] FAILED <what>: <reason> | send: <log path hint>`
pub(crate) fn failed_line(tag: &str, what: &str, reason: &str) -> String {
    format!("[{tag}] FAILED {what}: {reason} | send: {LOG_FILE} (beside PGR.exe) and the client region")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_are_stable_and_greppable() {
        assert_eq!(ok_line("lucia", "x", ""), "[lucia] OK x");
        assert_eq!(ok_line("lucia", "x", "y"), "[lucia] OK x: y");
        assert_eq!(
            failed_line("krsdk", "KRSDK.bin", "missing"),
            "[krsdk] FAILED KRSDK.bin: missing | send: ascnet-patch.log (beside PGR.exe) and the client region"
        );
    }
}
