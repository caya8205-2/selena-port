use std::ffi::CStr;
use std::os::raw::c_char;

#[no_mangle]
pub extern "C" fn kurosdk_uploadMarketingEvent(data: *const c_char) -> i64 {
    if data.is_null() {
        kr_log!("[KRSDK] uploadMarketingEvent(NULL)");
        return 0;
    }

    let s = unsafe { CStr::from_ptr(data) };
    let text = s.to_string_lossy();

    handle_marketing_event(&text);

    0
}

fn handle_marketing_event(json: &str) {
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(json) {
        if let Some(name) = v.get("eventName").and_then(|x| x.as_str()) {
            kr_log!("[KRSDK] eventName = {}", name);
            match name {
                "Version_Checking_Start" => {
                    kr_log!("[KRSDK] → version checking starting");
                }
                "Version_Checking_End" => {
                    kr_log!("[KRSDK] → version checking done");
                }
                "SDK_Initialize" => {
                    kr_log!("[KRSDK] → SDK initialized event");
                    // Don't need to do anything here, just log it
                }
                "SDK_Login" => {
                    kr_log!("[KRSDK] → SDK_Login event (already handled by kurosdk_login)");
                    // Don't call kurosdk_login here - game already calls it directly!
                }
                other => {
                    kr_log!("[KRSDK] → other event: {}", other);
                }
            }
        }
    }
}
