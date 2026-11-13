"""Lightweight Windows system tray & single-instance helper (pure ctypes).

Avoids heavy GUI/imaging dependencies (no Tkinter/Pillow/pystray) so the
packaged .exe starts quickly and stays small.
"""

from __future__ import annotations

import ctypes
from ctypes import wintypes
import json
import os
from pathlib import Path
import threading
import urllib.error
import urllib.request
import webbrowser

if os.name != "nt":
    raise ImportError("tray_win is only supported on Windows")

user32 = ctypes.WinDLL("user32", use_last_error=True)
shell32 = ctypes.WinDLL("shell32", use_last_error=True)
kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)

LRESULT = ctypes.c_ssize_t
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
HCURSOR = wintypes.HANDLE
HICON = wintypes.HANDLE
HBRUSH = wintypes.HANDLE
HMENU = wintypes.HANDLE
HWND = wintypes.HWND
HINSTANCE = wintypes.HINSTANCE

WNDPROC = ctypes.WINFUNCTYPE(LRESULT, HWND, wintypes.UINT, WPARAM, LPARAM)


class WNDCLASSEXW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.UINT),
        ("style", wintypes.UINT),
        ("lpfnWndProc", WNDPROC),
        ("cbClsExtra", ctypes.c_int),
        ("cbWndExtra", ctypes.c_int),
        ("hInstance", HINSTANCE),
        ("hIcon", HICON),
        ("hCursor", HCURSOR),
        ("hbrBackground", HBRUSH),
        ("lpszMenuName", wintypes.LPCWSTR),
        ("lpszClassName", wintypes.LPCWSTR),
        ("hIconSm", HICON),
    ]


class NOTIFYICONDATAW(ctypes.Structure):
    _fields_ = [
        ("cbSize", wintypes.DWORD),
        ("hWnd", HWND),
        ("uID", wintypes.UINT),
        ("uFlags", wintypes.UINT),
        ("uCallbackMessage", wintypes.UINT),
        ("hIcon", HICON),
        ("szTip", wintypes.WCHAR * 128),
        ("dwState", wintypes.DWORD),
        ("dwStateMask", wintypes.DWORD),
        ("szInfo", wintypes.WCHAR * 256),
        ("uTimeoutOrVersion", wintypes.UINT),
        ("szInfoTitle", wintypes.WCHAR * 64),
        ("dwInfoFlags", wintypes.DWORD),
    ]


class POINT(ctypes.Structure):
    _fields_ = [("x", wintypes.LONG), ("y", wintypes.LONG)]


class MSG(ctypes.Structure):
    _fields_ = [
        ("hwnd", HWND),
        ("message", wintypes.UINT),
        ("wParam", WPARAM),
        ("lParam", LPARAM),
        ("time", wintypes.DWORD),
        ("pt", POINT),
    ]


# Explicit 64-bit safe prototypes
kernel32.CreateMutexW.argtypes = [ctypes.c_void_p, wintypes.BOOL, wintypes.LPCWSTR]
kernel32.CreateMutexW.restype = wintypes.HANDLE
kernel32.CloseHandle.argtypes = [wintypes.HANDLE]
kernel32.CloseHandle.restype = wintypes.BOOL
kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
kernel32.GetModuleHandleW.restype = HINSTANCE

user32.RegisterClassExW.argtypes = [ctypes.POINTER(WNDCLASSEXW)]
user32.RegisterClassExW.restype = wintypes.ATOM
user32.CreateWindowExW.argtypes = [
    wintypes.DWORD,
    wintypes.LPCWSTR,
    wintypes.LPCWSTR,
    wintypes.DWORD,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    HWND,
    HMENU,
    HINSTANCE,
    ctypes.c_void_p,
]
user32.CreateWindowExW.restype = HWND
user32.DefWindowProcW.argtypes = [HWND, wintypes.UINT, WPARAM, LPARAM]
user32.DefWindowProcW.restype = LRESULT
user32.DestroyWindow.argtypes = [HWND]
user32.DestroyWindow.restype = wintypes.BOOL
user32.PostMessageW.argtypes = [HWND, wintypes.UINT, WPARAM, LPARAM]
user32.PostMessageW.restype = wintypes.BOOL
user32.PostQuitMessage.argtypes = [ctypes.c_int]
user32.PostQuitMessage.restype = None
user32.GetMessageW.argtypes = [ctypes.POINTER(MSG), HWND, wintypes.UINT, wintypes.UINT]
user32.GetMessageW.restype = wintypes.BOOL
user32.TranslateMessage.argtypes = [ctypes.POINTER(MSG)]
user32.TranslateMessage.restype = wintypes.BOOL
user32.DispatchMessageW.argtypes = [ctypes.POINTER(MSG)]
user32.DispatchMessageW.restype = LRESULT
user32.RegisterWindowMessageW.argtypes = [wintypes.LPCWSTR]
user32.RegisterWindowMessageW.restype = wintypes.UINT
user32.LoadImageW.argtypes = [
    HINSTANCE,
    wintypes.LPCWSTR,
    wintypes.UINT,
    ctypes.c_int,
    ctypes.c_int,
    wintypes.UINT,
]
user32.LoadImageW.restype = wintypes.HANDLE
user32.GetSystemMetrics.argtypes = [ctypes.c_int]
user32.GetSystemMetrics.restype = ctypes.c_int
SM_CXSMICON = 49
SM_CYSMICON = 50
user32.LoadIconW.argtypes = [HINSTANCE, wintypes.LPCWSTR]
user32.LoadIconW.restype = HICON
user32.DestroyIcon.argtypes = [HICON]
user32.DestroyIcon.restype = wintypes.BOOL
user32.CreatePopupMenu.argtypes = []
user32.CreatePopupMenu.restype = HMENU
user32.AppendMenuW.argtypes = [HMENU, wintypes.UINT, ctypes.c_size_t, wintypes.LPCWSTR]
user32.AppendMenuW.restype = wintypes.BOOL
user32.DestroyMenu.argtypes = [HMENU]
user32.DestroyMenu.restype = wintypes.BOOL
user32.TrackPopupMenu.argtypes = [
    HMENU,
    wintypes.UINT,
    ctypes.c_int,
    ctypes.c_int,
    ctypes.c_int,
    HWND,
    ctypes.c_void_p,
]
user32.TrackPopupMenu.restype = wintypes.BOOL
user32.GetCursorPos.argtypes = [ctypes.POINTER(POINT)]
user32.GetCursorPos.restype = wintypes.BOOL
user32.SetForegroundWindow.argtypes = [HWND]
user32.SetForegroundWindow.restype = wintypes.BOOL

shell32.Shell_NotifyIconW.argtypes = [wintypes.DWORD, ctypes.POINTER(NOTIFYICONDATAW)]
shell32.Shell_NotifyIconW.restype = wintypes.BOOL

ERROR_ALREADY_EXISTS = 183
WM_DESTROY = 0x0002
WM_CLOSE = 0x0010
WM_COMMAND = 0x0111
WM_USER = 0x0400
WM_TRAYICON = WM_USER + 20
WM_LBUTTONUP = 0x0202
WM_LBUTTONDBLCLK = 0x0203
WM_RBUTTONUP = 0x0205
WM_CONTEXTMENU = 0x007B

NIM_ADD = 0x00000000
NIM_MODIFY = 0x00000001
NIM_DELETE = 0x00000002
NIF_MESSAGE = 0x00000001
NIF_ICON = 0x00000002
NIF_TIP = 0x00000004

IMAGE_ICON = 1
LR_LOADFROMFILE = 0x00000010
LR_DEFAULTSIZE = 0x00000040
IDI_APPLICATION = ctypes.cast(32512, wintypes.LPCWSTR)

MF_STRING = 0x00000000
MF_SEPARATOR = 0x00000800
TPM_RIGHTALIGN = 0x0008
TPM_BOTTOMALIGN = 0x0020
TPM_RIGHTBUTTON = 0x0002
TPM_RETURNCMD = 0x0100

CMD_OPEN = 1001
CMD_REFRESH = 1002
CMD_SETTINGS_DIR = 1003
CMD_EXIT = 1004


def _probe_existing_instance(instance_file: Path) -> str | None:
    """Return the running dashboard URL if an existing instance responds to /health."""
    try:
        info = json.loads(instance_file.read_text(encoding="utf-8"))
        url = str(info.get("url") or "").strip()
    except (OSError, ValueError):
        return None
    if not url.startswith(("http://", "https://")):
        return None
    try:
        with urllib.request.urlopen(f"{url}/health", timeout=0.8) as resp:
            if resp.status == 200:
                return url
    except (OSError, urllib.error.URLError, ValueError):
        return None
    return None


class SingleInstanceGuard:
    """Ensure only one collector instance runs per user session."""

    def __init__(self, instance_file: Path, mutex_name: str = "Local\\MadarDashboardSingleton"):
        self.instance_file = instance_file
        self.mutex_name = mutex_name
        self._handle: wintypes.HANDLE | None = None
        self.already_running = False
        self.existing_url: str | None = None

    def acquire(self) -> bool:
        ctypes.set_last_error(0)
        handle = kernel32.CreateMutexW(None, False, self.mutex_name)
        err = ctypes.get_last_error()
        if handle and err == ERROR_ALREADY_EXISTS:
            self.already_running = True
            self.existing_url = _probe_existing_instance(self.instance_file)
            kernel32.CloseHandle(handle)
            return False
        self._handle = handle
        return True

    def write_instance_info(self, url: str) -> None:
        try:
            self.instance_file.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.instance_file.with_name(self.instance_file.name + ".tmp")
            tmp.write_text(json.dumps({"pid": os.getpid(), "url": url}) + "\n", encoding="utf-8")
            os.replace(tmp, self.instance_file)
        except OSError:
            pass

    def focus_existing(self) -> bool:
        url = self.existing_url or _probe_existing_instance(self.instance_file)
        if url:
            webbrowser.open(url)
            return True
        return False

    def release(self) -> None:
        try:
            if self.instance_file.exists():
                info = json.loads(self.instance_file.read_text(encoding="utf-8"))
                if info.get("pid") == os.getpid():
                    self.instance_file.unlink(missing_ok=True)
        except (OSError, ValueError):
            pass
        if self._handle:
            kernel32.CloseHandle(self._handle)
            self._handle = None


class TrayController:
    """Manage a minimal Windows notification area icon and context menu."""

    def __init__(
        self,
        url: str,
        icon_path: Path | None,
        on_refresh,
        on_open_settings_dir,
        on_exit,
        tooltip: str = "Madar HPC Monitor",
    ):
        self.url = url
        self.icon_path = icon_path
        self.on_refresh = on_refresh
        self.on_open_settings_dir = on_open_settings_dir
        self.on_exit = on_exit
        self.tooltip = tooltip[:127]
        self._hwnd: HWND | None = None
        self._hicon: HICON | None = None
        self._hicon_owned = False
        self._wndproc_ref = None
        self._taskbar_created_msg = user32.RegisterWindowMessageW("TaskbarCreated")
        self._ready = threading.Event()
        self._stopped = threading.Event()

    def _load_icon(self) -> HICON:
        if self.icon_path and self.icon_path.exists():
            # The tray uses the *small* icon size (16px at 100% DPI, 24px at 150%, ...).
            # LR_DEFAULTSIZE would pick the 32px large-icon size and let the shell
            # shrink it, which looks blurry; ask for the exact frame from the .ico instead.
            icon = user32.LoadImageW(
                None,
                str(self.icon_path),
                IMAGE_ICON,
                user32.GetSystemMetrics(SM_CXSMICON),
                user32.GetSystemMetrics(SM_CYSMICON),
                LR_LOADFROMFILE,
            )
            if icon:
                self._hicon_owned = True
                return icon
        self._hicon_owned = False
        return user32.LoadIconW(None, IDI_APPLICATION)

    def _notify(self, message: int) -> None:
        if not self._hwnd:
            return
        nid = NOTIFYICONDATAW()
        nid.cbSize = ctypes.sizeof(NOTIFYICONDATAW)
        nid.hWnd = self._hwnd
        nid.uID = 1
        nid.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP
        nid.uCallbackMessage = WM_TRAYICON
        nid.hIcon = self._hicon
        nid.szTip = self.tooltip
        shell32.Shell_NotifyIconW(message, ctypes.byref(nid))

    def _show_menu(self) -> None:
        if not self._hwnd:
            return
        menu = user32.CreatePopupMenu()
        if not menu:
            return
        try:
            user32.AppendMenuW(menu, MF_STRING, CMD_OPEN, "打开监控面板 (Open Dashboard)")
            user32.AppendMenuW(menu, MF_STRING, CMD_REFRESH, "立即刷新数据 (Refresh Now)")
            user32.AppendMenuW(menu, MF_STRING, CMD_SETTINGS_DIR, "打开配置目录 (Settings Folder)")
            user32.AppendMenuW(menu, MF_SEPARATOR, 0, None)
            user32.AppendMenuW(menu, MF_STRING, CMD_EXIT, "退出 (Exit)")

            pt = POINT()
            user32.GetCursorPos(ctypes.byref(pt))
            user32.SetForegroundWindow(self._hwnd)
            cmd = user32.TrackPopupMenu(
                menu,
                TPM_RIGHTALIGN | TPM_BOTTOMALIGN | TPM_RIGHTBUTTON | TPM_RETURNCMD,
                pt.x,
                pt.y,
                0,
                self._hwnd,
                None,
            )
            if cmd:
                user32.PostMessageW(self._hwnd, WM_COMMAND, cmd, 0)
        finally:
            user32.DestroyMenu(menu)

    def _handle_command(self, cmd_id: int) -> None:
        if cmd_id == CMD_OPEN:
            webbrowser.open(self.url)
        elif cmd_id == CMD_REFRESH:
            threading.Thread(target=self.on_refresh, daemon=True).start()
        elif cmd_id == CMD_SETTINGS_DIR:
            threading.Thread(target=self.on_open_settings_dir, daemon=True).start()
        elif cmd_id == CMD_EXIT:
            self.stop()
            threading.Thread(target=self.on_exit, daemon=True).start()

    def run(self) -> None:
        """Create the hidden window and run the Win32 message loop (blocking)."""
        hinst = kernel32.GetModuleHandleW(None)
        class_name = f"MadarDashboardTray_{os.getpid()}"

        def _wndproc(hwnd, msg, wparam, lparam):
            if msg == self._taskbar_created_msg and self._taskbar_created_msg:
                self._notify(NIM_ADD)
                return 0
            if msg == WM_TRAYICON:
                event = lparam & 0xFFFF
                if event in (WM_LBUTTONUP, WM_LBUTTONDBLCLK):
                    webbrowser.open(self.url)
                elif event in (WM_RBUTTONUP, WM_CONTEXTMENU):
                    self._show_menu()
                return 0
            if msg == WM_COMMAND:
                self._handle_command(wparam & 0xFFFF)
                return 0
            if msg == WM_CLOSE:
                user32.DestroyWindow(hwnd)
                return 0
            if msg == WM_DESTROY:
                self._notify(NIM_DELETE)
                user32.PostQuitMessage(0)
                return 0
            return user32.DefWindowProcW(hwnd, msg, wparam, lparam)

        self._wndproc_ref = WNDPROC(_wndproc)
        wc = WNDCLASSEXW()
        wc.cbSize = ctypes.sizeof(WNDCLASSEXW)
        wc.lpfnWndProc = self._wndproc_ref
        wc.hInstance = hinst
        wc.lpszClassName = class_name
        user32.RegisterClassExW(ctypes.byref(wc))

        self._hwnd = user32.CreateWindowExW(
            0, class_name, "MadarDashboardTray", 0, 0, 0, 0, 0, None, None, hinst, None
        )
        self._hicon = self._load_icon()
        self._notify(NIM_ADD)
        self._ready.set()

        msg = MSG()
        while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
            user32.TranslateMessage(ctypes.byref(msg))
            user32.DispatchMessageW(ctypes.byref(msg))

        if self._hicon_owned and self._hicon:
            user32.DestroyIcon(self._hicon)
            self._hicon = None
        self._stopped.set()

    def stop(self) -> None:
        if self._hwnd and not self._stopped.is_set():
            user32.PostMessageW(self._hwnd, WM_CLOSE, 0, 0)

