/// BCP 47 tag of the user's preferred system language, e.g. `zh-Hans-CN`.
/// Read on every call so language changes apply without restarting.
pub fn system_locale() -> String {
    sys_locale::get_locale().unwrap_or_else(|| "en-US".to_owned())
}

pub fn is_chinese() -> bool {
    system_locale().to_ascii_lowercase().starts_with("zh")
}
