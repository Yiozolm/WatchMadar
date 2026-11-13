"""Build script for packaging Madar HPC Resource Monitor into a Windows .exe.

Usage:
    python build_exe.py            # Build single-file dist/MadarDashboard.exe
    python build_exe.py --onedir   # Build folder dist/MadarDashboard/ (faster cold startup)
    python build_exe.py --clean    # Discard PyInstaller's cache first (after changing the venv)
    python build_exe.py --onedir --zip   # Also pack dist/MadarDashboard-<version>-win64.zip for sharing
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import struct
import subprocess
import sys
import time
import zlib
from pathlib import Path


ROOT = Path(__file__).resolve().parent
ICON_PATH = ROOT / "madar.ico"
VERSION_FILE = ROOT / "build" / "version_info.txt"
PRODUCT_NAME = "Madar HPC Resource Monitor"
# Standard Windows icon sizes (100%-250% DPI small/large icons). Sizes larger than
# the source logo are skipped rather than upscaled.
ICON_SIZES = (16, 20, 24, 32, 40, 48, 64, 128, 256)
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


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


def _read_png_rgba(png_path: Path) -> tuple[int, int, list[bytearray]]:
    """Decode an 8-bit RGBA, non-interlaced PNG into rows of RGBA bytes (stdlib only)."""
    data = png_path.read_bytes()
    if data[:8] != PNG_SIGNATURE:
        raise ValueError(f"{png_path} is not a valid PNG file")
    pos, idat = 8, bytearray()
    width = height = 0
    while pos < len(data):
        length, ctype = struct.unpack(">I4s", data[pos : pos + 8])
        body = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR":
            width, height, depth, color, _, _, interlace = struct.unpack(">IIBBBBB", body)
            if depth != 8 or color != 6 or interlace:
                raise ValueError(f"{png_path}: only 8-bit RGBA non-interlaced PNGs are supported")
        elif ctype == b"IDAT":
            idat += body
        elif ctype == b"IEND":
            break

    raw = zlib.decompress(bytes(idat))
    stride = width * 4
    rows: list[bytearray] = []
    prev = bytearray(stride)
    i = 0
    for _ in range(height):
        ftype = raw[i]
        line = bytearray(raw[i + 1 : i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - 4] if x >= 4 else 0
            b = prev[x]
            c = prev[x - 4] if x >= 4 else 0
            if ftype == 1:
                line[x] = (line[x] + a) & 0xFF
            elif ftype == 2:
                line[x] = (line[x] + b) & 0xFF
            elif ftype == 3:
                line[x] = (line[x] + ((a + b) >> 1)) & 0xFF
            elif ftype == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[x] = (line[x] + pred) & 0xFF
        rows.append(line)
        prev = line
    return width, height, rows


def _box_weights(src: int, dst: int) -> list[list[tuple[int, float]]]:
    """Per output pixel, the source pixels it covers and their (normalized) overlap."""
    scale = src / dst
    out = []
    for i in range(dst):
        start, end = i * scale, (i + 1) * scale
        taps = []
        j = int(start)
        while j < end and j < src:
            overlap = min(end, j + 1) - max(start, j)
            if overlap > 0:
                taps.append((j, overlap / scale))
            j += 1
        out.append(taps)
    return out


def _downscale_rgba(width: int, height: int, rows: list[bytearray], size: int) -> list[bytearray]:
    """Area-average downscale with premultiplied alpha (avoids dark fringes on edges)."""
    if size == width == height:
        return rows
    wx, wy = _box_weights(width, size), _box_weights(height, size)
    out = []
    for ytaps in wy:
        line = bytearray(size * 4)
        for ox, xtaps in enumerate(wx):
            r = g = b = a = 0.0
            for sy, fy in ytaps:
                src = rows[sy]
                for sx, fx in xtaps:
                    w = fx * fy
                    p = sx * 4
                    alpha = src[p + 3] * w
                    r += src[p] * alpha
                    g += src[p + 1] * alpha
                    b += src[p + 2] * alpha
                    a += alpha
            o = ox * 4
            if a > 0:
                line[o : o + 4] = bytes(
                    (round(r / a), round(g / a), round(b / a), min(255, round(a)))
                )
        out.append(line)
    return out


def _encode_png_rgba(size: int, rows: list[bytearray]) -> bytes:
    def chunk(ctype: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + ctype + body + struct.pack(">I", zlib.crc32(ctype + body))

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + bytes(r) for r in rows)
    return PNG_SIGNATURE + chunk(b"IHDR", ihdr) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def create_ico_from_png(png_path: Path, ico_path: Path) -> tuple[list[int], int]:
    """Build a multi-resolution .ico (PNG-compressed frames, Vista+) from a square PNG.

    Windows picks the closest frame for each context (tray, title bar, taskbar,
    Explorer views), so shipping several sizes keeps the icon crisp everywhere
    instead of letting the shell rescale a single odd-sized image.
    """
    width, height, rows = _read_png_rgba(png_path)
    if width != height:
        raise ValueError(f"{png_path} must be square (got {width}x{height})")
    sizes = [s for s in ICON_SIZES if s <= width] or [width]
    frames = [_encode_png_rgba(s, _downscale_rgba(width, height, rows, s)) for s in sizes]

    header = struct.pack("<HHH", 0, 1, len(frames))
    offset = 6 + 16 * len(frames)
    entries, blobs = b"", b""
    for size, png in zip(sizes, frames):
        dim = 0 if size >= 256 else size
        entries += struct.pack("<BBBBHHII", dim, dim, 0, 0, 1, 32, len(png), offset)
        blobs += png
        offset += len(png)
    data = header + entries + blobs
    # Only rewrite when changed so the icon's mtime doesn't defeat incremental builds.
    if not ico_path.exists() or ico_path.read_bytes() != data:
        ico_path.write_bytes(data)
    return sizes, width


def read_app_version() -> str:
    """Read APP_VERSION from server.py without importing it (import has side effects)."""
    match = re.search(r'^APP_VERSION\s*=\s*"([^"]+)"', (ROOT / "server.py").read_text(encoding="utf-8"), re.M)
    if not match:
        raise SystemExit("APP_VERSION not found in server.py")
    return match.group(1)


def write_version_file(path: Path, version: str, name: str) -> None:
    """Write a PyInstaller version resource so Explorer > Properties > Details is filled in."""
    nums = [int(n) for n in re.findall(r"\d+", version)[:4]]
    nums += [0] * (4 - len(nums))
    vt = tuple(nums)
    text = f"""# Generated by build_exe.py - do not edit.
VSVersionInfo(
  ffi=FixedFileInfo(filevers={vt}, prodvers={vt}, mask=0x3f, flags=0x0,
                    OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([
      StringTable('040904B0', [
        StringStruct('FileDescription', '{PRODUCT_NAME}'),
        StringStruct('FileVersion', '{version}'),
        StringStruct('InternalName', '{name}'),
        StringStruct('OriginalFilename', '{name}.exe'),
        StringStruct('ProductName', '{PRODUCT_NAME}'),
        StringStruct('ProductVersion', '{version}'),
      ])
    ]),
    VarFileInfo([VarStruct('Translation', [1033, 1200])])
  ]
)
"""
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        path.write_text(text, encoding="utf-8")


def make_zip(output: Path, onedir: bool, name: str, version: str) -> Path:
    """Pack the build into dist/<name>-<version>-win64.zip for sharing."""
    dist_dir = ROOT / "dist"
    archive_base = dist_dir / f"{name}-{version}-win64"
    if onedir:
        # Keep a top-level folder inside the zip so extracting doesn't spill files.
        archive = shutil.make_archive(str(archive_base), "zip", root_dir=dist_dir, base_dir=name)
    else:
        archive = shutil.make_archive(str(archive_base), "zip", root_dir=dist_dir, base_dir=output.name)
    archive_path = Path(archive)
    print(f"Packed {archive_path} ({archive_path.stat().st_size / (1024 * 1024):.2f} MB)")
    return archive_path


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

    sizes, logo_px = create_ico_from_png(ROOT / "logo.png", ICON_PATH)
    print(f"Icon frames: {', '.join(f'{s}px' for s in sizes)}")
    if logo_px < 256:
        print(f"  note: logo.png is {logo_px}px; a 256x256 logo.png gives sharper large Explorer icons")
    version = read_app_version()
    write_version_file(VERSION_FILE, version, name)

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
        f"--version-file={VERSION_FILE}",
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
    print(f"Building {name} {version} ({'onedir' if onedir else 'onefile'}, {'console' if console else 'noconsole'})...")
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
    parser.add_argument(
        "--zip",
        action="store_true",
        help="Also pack the result into dist/<name>-<version>-win64.zip (best with --onedir)",
    )
    args = parser.parse_args()

    output = build(onedir=args.onedir, console=args.console, name=args.name, clean=args.clean)
    if args.zip:
        make_zip(output, args.onedir, args.name, read_app_version())
    if args.clean_build:
        shutil.rmtree(ROOT / "build", ignore_errors=True)
        spec_file = ROOT / f"{args.name}.spec"
        spec_file.unlink(missing_ok=True)


if __name__ == "__main__":
    main()

