use std::ffi::{c_char, c_void};
#[no_mangle]
pub extern "C" fn kr_sdk_account_bind() {
    kr_log!("[KRSDK] *** Account bind called ***");
}

#[no_mangle]
pub extern "C" fn kr_sdk_close_announcement() {
    kr_log!("[KRSDK] *** Close announcement called ***");
}

#[no_mangle]
pub extern "C" fn kr_sdk_close_webview(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Close webview called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_exit() {
    kr_log!("[KRSDK] *** Exit called ***");
}

#[no_mangle]
pub extern "C" fn kr_sdk_free_result(ptr: *mut c_void) {
    kr_log!("[KRSDK] *** Free result called with ptr: {:?} ***", ptr);

    if !ptr.is_null() {
        return;
    }
}

#[no_mangle]
pub extern "C" fn kr_sdk_get_sdk_params(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Get SDK params called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_init_announcement(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Init Announcement called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_initialize_postWebView(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Initialize PostWebView called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_is_customer_service_enable() -> u8 {
    kr_log!("[KRSDK] *** Is Customer Service Enable called ***");
    1
}

#[no_mangle]
pub extern "C" fn kr_sdk_log_marketing_event(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Log Marketing Event called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_notify_wnd_change() -> u8 {
    kr_log!("[KRSDK] *** Notify Window Change called ***");
    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_open_announcement(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Open Announcement called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_open_customer_service(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Open Customer Service called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_open_postWebView(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Open PostWebView called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_open_webView(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Open WebView called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_pay_order(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Pay Order called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_query_product(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Query Product called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_report_event(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Report Event called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_report_role_msg(a1: *const c_char, a2: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Report Role Message called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
        if !a2.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a2).to_str() {
                kr_log!("[KRSDK]   param2: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_setEnviorment(
    a1: *const c_char,
    a2: *const c_char,
    a3: *const c_char,
    a4: *const c_char,
) -> u32 {
    kr_log!("[KRSDK] *** Set Environment called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
        if !a2.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a2).to_str() {
                kr_log!("[KRSDK]   param2: {}", s);
            }
        }
        if !a3.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a3).to_str() {
                kr_log!("[KRSDK]   param3: {}", s);
            }
        }
        if !a4.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a4).to_str() {
                kr_log!("[KRSDK]   param4: {}", s);
            }
        }
    }

    0 // Return success
}

#[no_mangle]
pub extern "C" fn kr_sdk_setObserver(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Set Observer called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_set_cursor(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Set Cursor called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_set_font(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Set Font called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_set_game_hwnd(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Set Game Hwnd called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_set_gamepad_mode(a1: *const c_char) -> u8 {
    kr_log!("[KRSDK] *** Set Gamepad Mode called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_set_player_roleId(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Set Player RoleId called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_set_sdk_window_mode(a1: *const c_char) -> u8 {
    kr_log!("[KRSDK] *** Set SDK Window Mode called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kr_sdk_show_exit_gamedlg() {
    kr_log!("[KRSDK] *** Show Exit Game Dialog called ***");
}

#[no_mangle]
pub extern "C" fn kr_sdk_uninit() {
    kr_log!("[KRSDK] *** Uninit called ***");
}

#[no_mangle]
pub extern "C" fn kurosdk_callKRPlugin(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Call KR Plugin called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_callKRPluginAsync(a1: *const c_char, a2: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Call KR Plugin Async called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
        if !a2.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a2).to_str() {
                kr_log!("[KRSDK]   param2: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_checkProtocolStatus() {
    kr_log!("[KRSDK] *** Check Protocol Status called ***");
}

#[no_mangle]
pub extern "C" fn kurosdk_closeAnnouncement() {
    kr_log!("[KRSDK] *** Close Announcement called ***");
}

#[no_mangle]
pub extern "C" fn kurosdk_closeWebView(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Close WebView called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_exitGame() {
    kr_log!("[KRSDK] *** Exit Game called ***");
}

#[no_mangle]
pub extern "C" fn kurosdk_getUserInfo() {
    kr_log!("[KRSDK] *** Get User Info called ***");
}

#[no_mangle]
pub extern "C" fn kurosdk_isCustomerServiceEnabled() -> u8 {
    0
}

#[no_mangle]
pub extern "C" fn kurosdk_isUserCenterEnabled() -> u8 {
    0
}

#[no_mangle]
pub extern "C" fn kurosdk_openAnnouncement(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Open Announcement called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_openBrowser(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Open Browser called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_openCustomerService(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Open Customer Service called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_openPrivacySetting() {
    kr_log!("[KRSDK] *** Open Privacy Setting called ***");
}

#[no_mangle]
pub extern "C" fn kurosdk_openUserCenter() {
    kr_log!("[KRSDK] User center is unsupported");
}

#[no_mangle]
pub extern "C" fn kurosdk_openWebView(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Open WebView called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_pay(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Pay called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_queryProductList(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Query Product List called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_setCursor(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Set Cursor called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_setFontPath(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Set Font Path called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_setGamePadMode(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Set Game Pad Mode called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_setSDKWindowMode(enabled: u8) {
    kr_log!("[KRSDK] *** Set SDK Window Mode called: {} ***", enabled != 0);
}

#[no_mangle]
pub extern "C" fn kurosdk_setupAnnouncement(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Setup Announcement called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_triggerLogout() {
    kr_log!("[KRSDK] *** Trigger Logout called ***");
    crate::ui::logout();
}

#[no_mangle]
pub extern "C" fn kurosdk_updateRoleInfo(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Update Role Info called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}

#[no_mangle]
pub extern "C" fn kurosdk_updateWindowGeometry() -> u32 {
    kr_log!("[KRSDK] *** Update Window Geometry called ***");

    0 // Return 0 = success
}

#[no_mangle]
pub extern "C" fn kurosdk_uploadEvent(a1: *const c_char) -> u32 {
    kr_log!("[KRSDK] *** Upload Event called ***");

    unsafe {
        if !a1.is_null() {
            if let Ok(s) = std::ffi::CStr::from_ptr(a1).to_str() {
                kr_log!("[KRSDK]   param1: {}", s);
            }
        }
    }

    0
}
