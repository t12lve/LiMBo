//! Native sound notifications.
//!
//! Plays clean system sounds without allocating WASAPI audio streams or triggering
//! DPC latency on external USB audio interfaces (GoXLR, DACs).

pub fn play_finish_sound() {
    #[cfg(windows)]
    {
        extern "system" {
            fn MessageBeep(uType: u32) -> i32;
        }
        unsafe {
            // MB_ICONASTERISK (0x00000040) plays the standard Windows system notification chime.
            MessageBeep(0x00000040);
        }
    }
}
