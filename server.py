"""Madar HPC dashboard server with SSH/Slurm collection.

Run ``python server.py`` and open http://127.0.0.1:8765.

The default path is a read-only SSH probe against the ``madar`` host alias
from ``~/.ssh/config``. It reads Slurm node allocation, queue state and
filesystem statistics. The dashboard refreshes every ten seconds, while the
server keeps a short cache so a slow filesystem scan cannot pile up requests.
"""

from __future__ import annotations

import json
import mimetypes
import os
import re
import shutil
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("MADAR_DASHBOARD_HOST", "127.0.0.1")
PORT = int(os.environ.get("MADAR_DASHBOARD_PORT", "8765"))
SSH_HOST = os.environ.get("MADAR_SSH_HOST", "madar")
SSH_USER = os.environ.get("MADAR_SSH_USER", "")
SSH_PORT = os.environ.get("MADAR_SSH_PORT", "")
SSH_TIMEOUT = float(os.environ.get("MADAR_SSH_TIMEOUT", "20"))
SSH_CONFIG = os.environ.get("MADAR_SSH_CONFIG", str(Path.home() / ".ssh" / "config"))
SSH_BIN = os.environ.get("MADAR_SSH_BIN", "")

_CACHE_LOCK = threading.Lock()
_SSH_LOCK = threading.Lock()
_CACHE: dict = {"at": 0.0, "payload": None}


def _find_ssh() -> str:
    if SSH_BIN:
        return SSH_BIN
    if os.name == "nt":
        system_ssh = Path(os.environ.get("WINDIR", r"C:\Windows")) / "System32" / "OpenSSH" / "ssh.exe"
        if system_ssh.exists():
            return str(system_ssh)
    return shutil.which("ssh") or "ssh"


def _disconnected_payload(error: str = "") -> dict:
    return {
        "cluster": {
            "name": "Madar HPC",
            "status": "disconnected",
            "connected": False,
            "data_source": "disconnected",
            "data_error": error,
            "uptime": "—",
            "last_updated": None,
            "refresh_seconds": 10,
            "gpu_total": 0,
            "gpu_online": 0,
            "gpu_utilization": 0,
            "active_jobs": 0,
            "queued_jobs": 0,
            "storage_used_tb": 0.0,
            "storage_total_tb": 0.0,
        },
        "gpus": [],
        "jobs": [],
        "storage": {
            "quota_tb": 0.0,
            "used_tb": 0.0,
            "paths": [],
            "users": [],
        },
    }


def _ssh_command(command: str) -> list[str]:
    target = f"{SSH_USER}@{SSH_HOST}" if SSH_USER else SSH_HOST
    args = [
        _find_ssh(),
        "-o", "BatchMode=yes",
        "-o", "ConnectTimeout=10",
        "-o", "ServerAliveInterval=10",
        "-o", "ServerAliveCountMax=2",
        "-o", "StrictHostKeyChecking=accept-new",
    ]
    config = Path(SSH_CONFIG).expanduser()
    if SSH_CONFIG and config.exists():
        args.extend(["-F", str(config)])
    if SSH_PORT:
        args.extend(["-p", SSH_PORT])
    args.extend([target, command])
    return args


def _run_remote(command: str, timeout: float | None = None) -> str:
    completed = subprocess.run(
        _ssh_command(command),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout or SSH_TIMEOUT,
        check=False,
    )
    if completed.returncode:
        detail = (completed.stderr or completed.stdout).strip().replace("\n", " ")
        raise RuntimeError(f"SSH command failed ({completed.returncode}): {detail[:240]}")
    return completed.stdout


def _number(value: str | None, default: int = 0) -> int:
    try:
        return int(float(value or ""))
    except (TypeError, ValueError):
        return default


def _parse_kv_line(line: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for match in re.finditer(r"([A-Za-z][A-Za-z0-9]*)=(.*?)(?=\s+[A-Za-z][A-Za-z0-9]*=|$)", line):
        fields[match.group(1)] = match.group(2).strip()
    return fields


def _gpu_count_from_gres(gres: str) -> int:
    match = re.search(r"gpu(?::[^:,\s]+)*:(\d+)", gres or "")
    return _number(match.group(1) if match else "0")


def _gpu_count_from_tres(tres: str) -> int:
    match = re.search(r"(?:^|,)gres/gpu=(\d+)", tres or "")
    return _number(match.group(1) if match else "0")


def _gpu_request(value: str) -> int:
    match = re.search(r"(?:gpu:)[^:|]+:(\d+)$", value or "")
    if not match:
        match = re.search(r"gpu:(\d+)", value or "")
    return max(_number(match.group(1) if match else "0"), 1 if "gpu" in (value or "") else 0)


def _model_from_gres(gres: str) -> str:
    lower = (gres or "").lower()
    for token, label in (("h200", "NVIDIA H200"), ("h100", "NVIDIA H100"), ("a100", "NVIDIA A100"), ("l40s", "NVIDIA L40S")):
        if token in lower:
            return label
    return "GPU"


def _parse_jobs(raw: str) -> list[dict]:
    jobs = []
    for line in raw.splitlines():
        parts = line.strip().split("|")
        if len(parts) < 8:
            continue
        job_id, name, owner, partition, gres, elapsed, status, node = parts[:8]
        jobs.append({
            "id": job_id,
            "name": name,
            "owner": owner,
            "partition": partition,
            "gpus": _gpu_request(gres),
            "elapsed": elapsed,
            "status": status,
            "node": node if node != "(null)" else "",
        })
    return jobs


def _parse_nodes(raw: str, jobs: list[dict]) -> tuple[list[dict], list[dict]]:
    nodes: list[dict] = []
    gpus: list[dict] = []
    jobs_by_node: dict[str, list[dict]] = {}
    for job in jobs:
        if job["status"] == "RUNNING" and job["node"]:
            jobs_by_node.setdefault(job["node"], []).append(job)

    for line in raw.splitlines():
        fields = _parse_kv_line(line)
        gres = fields.get("Gres", "")
        if "gpu" not in gres.lower():
            continue
        node_name = fields.get("NodeName", "unknown")
        cfg_tres = fields.get("CfgTRES", "")
        total = _gpu_count_from_tres(cfg_tres) or _gpu_count_from_gres(gres)
        allocated = _gpu_count_from_tres(fields.get("AllocTRES", ""))
        state = fields.get("State", "").upper()
        node_jobs = jobs_by_node.get(node_name, [])
        allocated_jobs: list[dict] = []
        for job in node_jobs:
            allocated_jobs.extend([job] * max(job["gpus"], 1))
        model = _model_from_gres(gres)
        nodes.append({"name": node_name, "model": model, "total": total, "allocated": allocated, "state": state})
        for index in range(total):
            job = allocated_jobs[index] if index < len(allocated_jobs) else None
            busy = index < allocated or job is not None
            gpus.append({
                "id": f"{node_name} / GPU {index + 1:02d}",
                "node": node_name,
                "model": model,
                "utilization": 100 if busy else 0,
                "util_label": "ALLOC",
                "memory_used": None,
                "memory_total": None,
                "temperature": None,
                "power": None,
                "power_limit": None,
                "status": "busy" if busy else "idle",
                "process": job["name"] if job else ("Allocated by Slurm" if busy else "Available"),
                "owner": job["owner"] if job else "",
            })
    return nodes, gpus


def _parse_df_line(value: str, path: str) -> dict | None:
    parts = value.split()
    if len(parts) < 6:
        return None
    try:
        total_bytes = int(parts[2]) * 1024
        used_bytes = int(parts[3]) * 1024
        avail_bytes = int(parts[4]) * 1024
    except (ValueError, IndexError):
        return None
    return {
        "path": path,
        "mount": parts[-1],
        "used_bytes": used_bytes,
        "total_bytes": total_bytes,
        "avail_bytes": avail_bytes,
        "used_gb": round(used_bytes / 1e9, 2),
        "total_gb": round(total_bytes / 1e9, 2),
        "avail_gb": round(avail_bytes / 1e9, 2),
        "used_tb": round(used_bytes / 1e12, 3),
        "quota_tb": round(total_bytes / 1e12, 3),
        "avail_tb": round(avail_bytes / 1e12, 3),
        "kind": path.strip("/") or "root",
    }


_STORAGE_FAST_COMMAND = r'''printf 'USER|'; id -un; printf 'HOME_PATH|'; printf '%s\n' "$HOME"; printf 'DF_HOME|'; df -Pk -T "$HOME" 2>/dev/null | tail -1 '''
_DU_REMOTE_COMMAND = r'''printf 'HOME_PATH|'; printf '%s\n' "$HOME"; printf 'SCRATCH_USER|'; U=$(id -un); for p in "/scratch/$U" "/scratch/users/$U" "/work/$U"; do if [ -d "$p" ]; then printf '%s|' "$p"; timeout 3s du -sk "$p" 2>/dev/null | awk '{print $1}'; break; fi; done; printf '\n'; printf 'HOME_DIRS|\n'; timeout 18s du -k --max-depth=1 -x "$HOME" 2>/dev/null; true'''
_DU_LOCK = threading.Lock()
_DU_CACHE: dict = {"at": 0.0, "home_kb": 0, "subdirs": [], "scratch": None, "scanning": False}


def _parse_and_store_du(raw: str, fallback_home: str = "~") -> None:
    home_path = fallback_home
    scratch_info: dict | None = None
    du_lines: list[str] = []
    in_dirs = False

    for line in raw.splitlines():
        if line.strip() == "HOME_DIRS|":
            in_dirs = True
            continue
        if in_dirs:
            if line.strip():
                du_lines.append(line.strip())
            continue
        key, _, value = line.partition("|")
        if key == "HOME_PATH":
            home_path = value.strip() or home_path
        elif key == "SCRATCH_USER" and value.strip():
            s_path, _, s_kb = value.strip().partition("|")
            kb_val = _number(s_kb.strip())
            if s_path:
                scratch_info = {
                    "path": s_path,
                    "used_gb": round(kb_val * 1024 / 1e9, 2),
                    "used_tb": round(kb_val * 1024 / 1e12, 3),
                }

    home_kb = 0
    raw_subdirs: list[tuple[str, int]] = []
    norm_home = home_path.rstrip("/")
    for dline in du_lines:
        parts = dline.split(None, 1)
        if len(parts) < 2:
            continue
        kb = _number(parts[0])
        dpath = parts[1].strip().rstrip("/")
        if dpath == norm_home:
            home_kb = kb
        elif dpath.startswith(norm_home + "/"):
            rel_name = dpath[len(norm_home) + 1 :]
            if rel_name and "/" not in rel_name:
                raw_subdirs.append((rel_name, kb))

    raw_subdirs.sort(key=lambda item: item[1], reverse=True)
    sum_subdirs_kb = sum(kb for _, kb in raw_subdirs)
    if home_kb < sum_subdirs_kb:
        home_kb = sum_subdirs_kb
    elif home_kb > sum_subdirs_kb and raw_subdirs:
        root_files_kb = home_kb - sum_subdirs_kb
        if root_files_kb > 1024:
            raw_subdirs.append(("~ (根目录文件)", root_files_kb))
            raw_subdirs.sort(key=lambda item: item[1], reverse=True)

    subdirs = []
    for name, kb in raw_subdirs[:8]:
        used_bytes = kb * 1024
        share = round(kb / home_kb * 100, 1) if home_kb > 0 else 0.0
        subdirs.append({
            "name": name,
            "used_gb": round(used_bytes / 1e9, 2),
            "used_mb": round(used_bytes / 1e6, 1),
            "share_pct": min(share, 100.0),
        })

    with _DU_LOCK:
        _DU_CACHE.update({
            "at": time.monotonic(),
            "home_kb": home_kb if home_kb > 0 else _DU_CACHE["home_kb"],
            "subdirs": subdirs if subdirs else _DU_CACHE["subdirs"],
            "scratch": scratch_info if scratch_info is not None else _DU_CACHE["scratch"],
            "scanning": False,
        })


def _sync_du_into_payload(payload: dict) -> None:
    if not payload or not payload.get("cluster", {}).get("connected"):
        return
    storage = payload.get("storage")
    if not storage:
        return
    with _DU_LOCK:
        home_kb = _DU_CACHE["home_kb"]
        subdirs = list(_DU_CACHE["subdirs"])
        scratch_cached = _DU_CACHE["scratch"]
        scanning = _DU_CACHE["scanning"]
    home_used_bytes = home_kb * 1024
    home_used_gb = round(home_used_bytes / 1e9, 2)
    home_used_tb = round(home_used_bytes / 1e12, 3)
    total_gb = max(storage.get("fs_total_gb", 1.0), 1.0)
    storage["scanning"] = scanning
    storage["home_used_gb"] = home_used_gb
    storage["home_used_tb"] = home_used_tb
    storage["used_tb"] = home_used_tb
    storage["subdirs"] = subdirs
    home_path = storage.get("home_path", "~")
    mount = storage.get("mount", "/")
    fs_used_gb = storage.get("fs_used_gb", 0.0)
    fs_used_tb = storage.get("fs_used_tb", 0.0)
    quota_tb = storage.get("quota_tb", 0.0)
    paths = [
        {
            "path": f"主目录 ({home_path})",
            "used_gb": home_used_gb,
            "quota_gb": total_gb,
            "used_tb": home_used_tb,
            "quota_tb": quota_tb,
            "pct": round(min(home_used_gb / total_gb * 100, 100), 1),
            "kind": "home",
        }
    ]
    if scratch_cached:
        paths.append({
            "path": f"Scratch ({scratch_cached['path']})",
            "used_gb": scratch_cached["used_gb"],
            "quota_gb": total_gb,
            "used_tb": scratch_cached["used_tb"],
            "quota_tb": quota_tb,
            "pct": round(min(scratch_cached["used_gb"] / total_gb * 100, 100), 1),
            "kind": "scratch",
        })
    paths.append({
        "path": f"所在磁盘 ({mount})",
        "used_gb": fs_used_gb,
        "quota_gb": total_gb,
        "used_tb": fs_used_tb,
        "quota_tb": quota_tb,
        "pct": round(min(fs_used_gb / total_gb * 100, 100), 1),
        "kind": "mount",
    })
    storage["paths"] = paths


def _trigger_du_scan(home_path: str = "~", force: bool = False) -> None:
    with _DU_LOCK:
        if _DU_CACHE["scanning"]:
            return
        age = time.monotonic() - _DU_CACHE["at"]
        if not force and _DU_CACHE["at"] > 0 and age < 90:
            return
        _DU_CACHE["scanning"] = True

    def _worker():
        time.sleep(1.0)
        try:
            raw = _run_remote(_DU_REMOTE_COMMAND, timeout=max(SSH_TIMEOUT, 25))
            _parse_and_store_du(raw, fallback_home=home_path)
        except Exception as exc:
            print(f"[madar-dashboard] background du scan failed: {exc}")
            with _DU_LOCK:
                _DU_CACHE["scanning"] = False

    threading.Thread(target=_worker, daemon=True).start()


def _collect_storage(raw: str | None = None, force_du: bool = False) -> dict:
    if raw is None:
        raw = _run_remote(_STORAGE_FAST_COMMAND, timeout=max(SSH_TIMEOUT, 8))
    user = "user"
    home_path = "~"
    df_home: dict | None = None

    for line in raw.splitlines():
        key, _, value = line.partition("|")
        if key == "USER":
            user = value.strip() or user
        elif key == "HOME_PATH":
            home_path = value.strip() or home_path
        elif key == "DF_HOME":
            df_home = _parse_df_line(value, home_path)

    if not df_home:
        raise RuntimeError("filesystem statistics for $HOME were empty")

    _trigger_du_scan(home_path=home_path, force=force_du)

    with _DU_LOCK:
        home_kb = _DU_CACHE["home_kb"]
        subdirs = list(_DU_CACHE["subdirs"])
        scratch_cached = _DU_CACHE["scratch"]
        scanning = _DU_CACHE["scanning"]

    home_used_bytes = home_kb * 1024
    home_used_gb = round(home_used_bytes / 1e9, 2)
    home_used_tb = round(home_used_bytes / 1e12, 3)

    paths = [
        {
            "path": f"主目录 ({home_path})",
            "used_gb": home_used_gb,
            "quota_gb": df_home["total_gb"],
            "used_tb": home_used_tb,
            "quota_tb": df_home["quota_tb"],
            "pct": round(min(home_used_bytes / max(df_home["total_bytes"], 1) * 100, 100), 1),
            "kind": "home",
        }
    ]
    if scratch_cached:
        paths.append({
            "path": f"Scratch ({scratch_cached['path']})",
            "used_gb": scratch_cached["used_gb"],
            "quota_gb": df_home["total_gb"],
            "used_tb": scratch_cached["used_tb"],
            "quota_tb": df_home["quota_tb"],
            "pct": round(min(scratch_cached["used_gb"] / max(df_home["total_gb"], 1) * 100, 100), 1),
            "kind": "scratch",
        })
    paths.append({
        "path": f"所在磁盘 ({df_home['mount']})",
        "used_gb": df_home["used_gb"],
        "quota_gb": df_home["total_gb"],
        "used_tb": df_home["used_tb"],
        "quota_tb": df_home["quota_tb"],
        "pct": round(min(df_home["used_bytes"] / max(df_home["total_bytes"], 1) * 100, 100), 1),
        "kind": "mount",
    })

    return {
        "user": user,
        "home_path": home_path,
        "mount": df_home["mount"],
        "scanning": scanning,
        "home_used_gb": home_used_gb,
        "home_used_tb": home_used_tb,
        "fs_used_gb": df_home["used_gb"],
        "fs_total_gb": df_home["total_gb"],
        "fs_avail_gb": df_home["avail_gb"],
        "fs_used_tb": df_home["used_tb"],
        "fs_total_tb": df_home["quota_tb"],
        "fs_avail_tb": df_home["avail_tb"],
        "quota_tb": df_home["quota_tb"],
        "used_tb": home_used_tb,
        "paths": paths,
        "subdirs": subdirs,
        "users": [{"user": user, "used_tb": home_used_tb, "used_gb": home_used_gb, "quota_tb": df_home["quota_tb"], "files": 0}],
    }


def _collect_ssh_metrics(force_du: bool = False) -> dict:
    probe_command = (
        r'''printf '__MADAR_NODES__\n'; scontrol show node -o 2>/dev/null; printf '__MADAR_QUEUE__\n'; squeue -h -p gpu,interactive -o "%i|%j|%u|%P|%b|%M|%T|%N" 2>/dev/null; printf '__MADAR_STORAGE__\n'; '''
        + _STORAGE_FAST_COMMAND
    )
    raw = _run_remote(probe_command, timeout=max(SSH_TIMEOUT, 20))
    sections = {"nodes": [], "queue": [], "storage": []}
    current = None
    for line in raw.splitlines():
        marker = {"__MADAR_NODES__": "nodes", "__MADAR_QUEUE__": "queue", "__MADAR_STORAGE__": "storage"}.get(line.strip())
        if marker:
            current = marker
            continue
        if current:
            sections[current].append(line)
    nodes_raw = "\n".join(sections["nodes"])
    queue_raw = "\n".join(sections["queue"])
    storage_raw = "\n".join(sections["storage"])
    all_jobs = _parse_jobs(queue_raw)
    all_jobs.sort(key=lambda j: (0 if j["status"] == "RUNNING" else 1, j["id"]))
    active_jobs = sum(1 for job in all_jobs if job["status"] == "RUNNING")
    queued_jobs = sum(1 for job in all_jobs if job["status"] in {"PENDING", "CONFIGURING"})
    jobs = all_jobs[:200]
    nodes, gpus = _parse_nodes(nodes_raw, all_jobs)
    if not nodes:
        raise RuntimeError("no GPU nodes were returned by Slurm")
    storage = _collect_storage(storage_raw, force_du=force_du)
    total_gpus = sum(node["total"] for node in nodes)
    allocated_gpus = sum(min(node["allocated"], node["total"]) for node in nodes)
    return {
        "cluster": {
            "name": "Madar HPC",
            "status": "healthy",
            "connected": True,
            "data_source": "ssh",
            "metric_mode": "slurm_allocation",
            "metric_note": "GPU 占用来自 Slurm 分配；登录节点不允许直接读取计算节点 NVML。",
            "uptime": "—",
            "last_updated": datetime.now(timezone.utc).isoformat(),
            "refresh_seconds": 10,
            "gpu_total": total_gpus,
            "gpu_online": total_gpus,
            "gpu_utilization": round(allocated_gpus / total_gpus * 100) if total_gpus else 0,
            "active_jobs": active_jobs,
            "queued_jobs": queued_jobs,
            "storage_used_tb": storage["used_tb"],
            "storage_total_tb": storage["quota_tb"],
        },
        "gpus": gpus,
        "jobs": jobs,
        "storage": storage,
    }


def get_settings() -> dict:
    return {
        "ssh_host": SSH_HOST,
        "ssh_user": SSH_USER,
        "ssh_port": SSH_PORT,
        "ssh_timeout": SSH_TIMEOUT,
        "ssh_config": SSH_CONFIG,
    }


def update_settings(data: dict) -> dict:
    global SSH_HOST, SSH_USER, SSH_PORT, SSH_TIMEOUT
    with _CACHE_LOCK:
        if "ssh_host" in data:
            host = str(data["ssh_host"]).strip()
            if host:
                SSH_HOST = host
        if "ssh_user" in data:
            SSH_USER = str(data["ssh_user"]).strip()
        if "ssh_port" in data:
            SSH_PORT = str(data["ssh_port"]).strip()
        if "ssh_timeout" in data:
            try:
                SSH_TIMEOUT = max(2.0, min(60.0, float(data["ssh_timeout"])))
            except (TypeError, ValueError):
                pass
        _CACHE.update({"at": 0.0, "payload": None})
    with _DU_LOCK:
        _DU_CACHE.update({"at": 0.0, "home_kb": 0, "subdirs": [], "scratch": None, "scanning": False})
    return get_settings()


def load_metrics(force: bool = False) -> dict:
    """Probe Madar over SSH and return disconnected state on failure."""
    now = time.monotonic()
    with _CACHE_LOCK:
        if not force and _CACHE["payload"] is not None and now - _CACHE["at"] < 8:
            _sync_du_into_payload(_CACHE["payload"])
            return _CACHE["payload"]
        try:
            payload = _collect_ssh_metrics(force_du=force)
        except (OSError, json.JSONDecodeError, RuntimeError, subprocess.TimeoutExpired) as exc:
            payload = _disconnected_payload(str(exc))
            print(f"[madar-dashboard] SSH probe failed: {exc}")
        _CACHE.update({"at": time.monotonic(), "payload": payload})
        return payload


_DISCONNECT_ERRORS = (BrokenPipeError, ConnectionAbortedError, ConnectionResetError)


class DashboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def _write_bytes(self, payload: bytes, content_type: str, cache_control: str | None = None) -> None:
        try:
            self.send_response(200)
            self.send_header("Content-Type", content_type)
            if cache_control:
                self.send_header("Cache-Control", cache_control)
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)
        except _DISCONNECT_ERRORS:
            return

    def do_GET(self):  # noqa: N802 - stdlib API name
        parsed = urlparse(self.path)
        path = parsed.path
        if path == "/api/metrics":
            query = parse_qs(parsed.query)
            force = query.get("force", ["0"])[0] == "1"
            payload = json.dumps(load_metrics(force=force), ensure_ascii=False).encode("utf-8")
            self._write_bytes(payload, "application/json; charset=utf-8", cache_control="no-store")
            return

        if path == "/api/settings":
            payload = json.dumps(get_settings(), ensure_ascii=False).encode("utf-8")
            self._write_bytes(payload, "application/json; charset=utf-8", cache_control="no-store")
            return

        if path == "/health":
            self._write_bytes(b'{"status":"ok"}', "application/json")
            return

        try:
            super().do_GET()
        except _DISCONNECT_ERRORS:
            return

    def do_POST(self):  # noqa: N802 - stdlib API name
        path = urlparse(self.path).path
        if path == "/api/settings":
            try:
                length = int(self.headers.get("Content-Length", "0"))
                raw = self.rfile.read(length) if length > 0 else b"{}"
                body = json.loads(raw.decode("utf-8"))
            except (ValueError, json.JSONDecodeError):
                body = {}
            updated = update_settings(body)
            payload = json.dumps(updated, ensure_ascii=False).encode("utf-8")
            self._write_bytes(payload, "application/json; charset=utf-8", cache_control="no-store")
            return
        self.send_error(404)

    def handle(self):
        try:
            super().handle()
        except _DISCONNECT_ERRORS:
            return

    def finish(self):
        try:
            super().finish()
        except _DISCONNECT_ERRORS:
            return

    def log_message(self, fmt, *args):
        if os.environ.get("MADAR_DASHBOARD_QUIET") != "1":
            super().log_message(fmt, *args)


if __name__ == "__main__":
    mimetypes.add_type("application/javascript", ".js")
    server = ThreadingHTTPServer((HOST, PORT), DashboardHandler)
    print(f"Madar dashboard running at http://{HOST}:{PORT}")
    print(f"SSH probe host={SSH_HOST}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard")
    finally:
        server.server_close()
