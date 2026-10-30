// ULTRON desktop shell (experimental). The window loads the UI served by the local ULTRON gateway,
// so the gateway must be running (Start-ULTRON.bat). Bundling the gateway as a sidecar is a later ticket.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("error while running ULTRON desktop shell");
}
