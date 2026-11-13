"""Build script for packaging Madar HPC Resource Monitor into a Windows .exe.

Usage:
    python build_exe.py            # Build single-file dist/MadarDashboard.exe
    python build_exe.py --onedir   # Build folder dist/MadarDashboard/ (faster cold startup)
    python build_exe.py --clean    # Discard PyInstaller's cache first (after changing the venv)
"""

from __future__ import annotations

import argparse
import os
import shutil
import struct
import subprocess
import sys
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ICON_PATH = ROOT / "madar.ico"
STATIC_ASSETS = ("index.html", "styles.css", "app.js", "logo.png")

# Unused stdlib modules excluded to minimize binary size and startup import overhead.
EXCLUDED_MODULES = (
    "tkinter",
    "_tkinter",
    "unittest",
    "pydoc",
    "doctest",
    "pdb",
    "bdb",
    "ftplib",
    "imaplib",
    "poplib",
    "smtplib",
    "nntplib",
    "telnetlib",
    "xmlrpc",
    "turtle",
    "ensurepip",
    "venv",
    "sqlite3",
    "curses",
    "lib2to3",
    "multiprocessing",
    "concurrent",
    "asyncio",
    "distutils",
    "setuptools",
    "pkg_resources",
    # OpenSSL (~9.5 MB of DLLs): only optionally imported by http.client/urllib.request,
    # and the app only talks plain HTTP to 127.0.0.1. hashlib falls back to the
    # built-in _sha2/_md5 modules when _hashlib is absent.
    "ssl",
    "_ssl",
    "_hashlib",
    # Compression codecs only optionally imported by shutil/zipfile/tarfile.
    "lzma",
    "_lzma",
    "bz2",
    "_bz2",
)


def create_ico_from_png(png_path: Path, ico_path: Path) -> None:
    """Wrap a PNG image in a standard Windows .ico container (Vista+ compatible)."""
    png_bytes = png_path.read_bytes()
    if png_bytes[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"{png_path} is not a valid PNG file")
    width, height = struct.unpack(">II", png_bytes[16:24])
    w_byte = 0 if width >= 256 else width
    h_byte = 0 if height >= 256 else height
    header = struct.pack("<HHH", 0, 1, 1)
    entry = struct.pack("<BBBBHHII", w_byte, h_byte, 0, 0, 1, 32, len(png_bytes), 22)
    data = header + entry + png_bytes
    # Only rewrite when changed so the icon's mtime doesn't defeat incremental builds.
    if not ico_path.exists() or ico_path.read_bytes() != data:
        ico_path.write_bytes(data)


def ensure_output_writable(output: Path) -> None:
    """Fail early if the previous build is still running (Windows locks running .exe files)."""
    if not output.exists():
        return
    try:
        with output.open("r+b"):
            pass
    except PermissionError:
        raise SystemExit(
            f"Cannot overwrite {output}: it is in use.\n"
            "Quit MadarDashboard from the system tray (right-click -> Exit) and build again."
        ) from None


def build(onedir: bool = False, console: bool = False, name: str = "MadarDashboard", clean: bool = False) -> Path:
    try:
        import PyInstaller.__main__ as pyinstaller_main  # noqa: F401
    except ImportError as exc:
        raise SystemExit(
            "PyInstaller is not installed in this Python environment.\n"
            "Install it with: uv pip install pyinstaller"
        ) from exc

    dist_dir = ROOT / "dist"
    output = (dist_dir / name / f"{name}.exe") if onedir else (dist_dir / f"{name}.exe")
    ensure_output_writable(output)

    create_ico_from_png(ROOT / "logo.png", ICON_PATH)

    sep = ";" if os.name == "nt" else ":"
    args = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--noconfirm",
        f"--name={name}",
        "--onedir" if onedir else "--onefile",
        "--console" if console else "--noconsole",
        # Keep output deterministic: UPX-packed binaries trigger antivirus false positives.
        "--noupx",
        f"--icon={ICON_PATH}",
        "--hidden-import=tray_win",
    ]
    if clean:
        # Discard PyInstaller's analysis cache; slower, only needed after env changes.
        args.append("--clean")
    for asset in STATIC_ASSETS:
        args.append(f"--add-data={ROOT / asset}{sep}.")
    args.append(f"--add-data={ICON_PATH}{sep}.")
    for mod in EXCLUDED_MODULES:
        args.append(f"--exclude-module={mod}")
    args.append(str(ROOT / "server.py"))

    started = time.monotonic()
    print(f"Building {name} ({'onedir' if onedir else 'onefile'}, {'console' if console else 'noconsole'})...")
    completed = subprocess.run(args, cwd=str(ROOT), check=False)
    if completed.returncode != 0:
        raise SystemExit(completed.returncode)

    elapsed = time.monotonic() - started
    if not output.exists():
        raise SystemExit(f"PyInstaller finished but {output} was not produced")
    size_mb = output.stat().st_size / (1024 * 1024)
    print(f"Build succeeded in {elapsed:.1f}s -> {output} ({size_mb:.2f} MB)")
    return output


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Madar HPC Resource Monitor executable")
    parser.add_argument("--onedir", action="store_true", help="Build directory bundle instead of single .exe")
    parser.add_argument("--console", action="store_true", help="Keep console window visible")
    parser.add_argument("--name", default="MadarDashboard", help="Executable name")
    parser.add_argument("--clean-build", action="store_true", help="Remove temporary build/ and .spec files after build")
    parser.add_argument("--clean", action="store_true", help="Discard PyInstaller's cache and rebuild from scratch")
    args = parser.parse_args()

    build(onedir=args.onedir, console=args.console, name=args.name, clean=args.clean)
    if args.clean_build:
        shutil.rmtree(ROOT / "build", ignore_errors=True)
        spec_file = ROOT / f"{args.name}.spec"
        spec_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

