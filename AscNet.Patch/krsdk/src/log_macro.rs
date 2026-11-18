/// Non-blocking stand-in for `kr_log!`. SDK exports run on game threads; a raw `kr_log!`
/// blocks in `NtWriteFile` once the launcher's undrained stdout pipe fills, freezing the client.
/// This forwards to the shared diag queue instead, which drops lines rather than blocking.
macro_rules! kr_log {
    ($($arg:tt)*) => { $crate::diag::log(&format!($($arg)*)) };
}