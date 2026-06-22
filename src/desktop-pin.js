// "Pin to desktop": make the calendar behave like a desktop widget — it sits
// BEHIND your other windows and off the taskbar, but stays a normal, fully
// interactive top-level window (you can click days, type notes, etc.).
//
// Earlier versions reparented the window into the wallpaper's WorkerW. On
// Windows 11 that is unreliable and, even when it "works", the desktop icon
// layer sits on top and swallows all clicks — so the widget looked frozen.
// Instead we just push the window to the bottom of the z-order with
// SetWindowPos(HWND_BOTTOM); main.js re-sinks it whenever it loses focus.
let koffi, user32, SetWindowPos;
let available = false;

const HWND_BOTTOM = 1;
const SWP_NOSIZE = 0x0001;
const SWP_NOMOVE = 0x0002;
const SWP_NOACTIVATE = 0x0010;

try {
  koffi = require('koffi');
  user32 = koffi.load('user32.dll');
  SetWindowPos = user32.func('bool SetWindowPos(uintptr_t, uintptr_t, int, int, int, int, uint)');
  available = true;
} catch (e) {
  console.error('[desktop-pin] FFI unavailable:', e && e.message);
}

function hwndOf(win) {
  const buf = win.getNativeWindowHandle();
  return buf.length === 8 ? buf.readBigUInt64LE() : BigInt(buf.readUInt32LE());
}

// Drop the window to the bottom of the z-order without activating it.
function toBottom(win) {
  if (!available || !win || win.isDestroyed()) return false;
  try {
    SetWindowPos(hwndOf(win), HWND_BOTTOM, 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    return true;
  } catch (e) {
    console.error('[desktop-pin] toBottom failed:', e && e.message);
    return false;
  }
}

module.exports = { toBottom, available: () => available };
