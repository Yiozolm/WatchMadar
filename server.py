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
SSH_TIMEOUT = float(os.environ.get("MADAR_SSH_TIMEOUT", "8"))
SSH_CONFIG = os.environ.get("MADAR_SSH_CONFIG", str(Path.home() / ".ssh" / "config"))
SSH_BIN = os.environ.get("MADAR_SSH_BIN", "")

_CACHE_LOCK = threading.Lock()
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
        "-o", "ConnectTimeout=5",
        "-o", "ServerAliveInterval=5",
        "-o", "ServerAliveCountMax=1",
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
    except (ValueError, IndexError):
        return None
    return {
        "path": path,
        "mount": parts[-1],
        "used_tb": round(used_bytes / 1e12, 3),
        "quota_tb": round(total_bytes / 1e12, 3),
        "kind": path.strip("/") or "root",
    }


_STORAGE_COMMAND = r'''printf 'USER|'; id -un; printf 'DF_HOME|'; df -Pk -T "$HOME" 2>/dev/null | tail -1; printf 'DF_SCRATCH|'; if [ -d /scratch ]; then df -Pk -T /scratch 2>/dev/null | tail -1; fi; printf 'DF_DATASETS|'; if [ -d /datasets ]; then df -Pk -T /datasets 2>/dev/null | tail -1; fi; printf 'HOME_DU|'; timeout 6s du -sx --block-size=1 "$HOME" 2>/dev/null | awk '{print $1}' '''


def _collect_storage(raw: str | None = None) -> dict:
    if raw is None:
        raw = _run_remote(_STORAGE_COMMAND, timeout=max(SSH_TIMEOUT, 9))
    user = "current user"
    paths: list[dict] = []
    home_du = 0
    for line in raw.splitlines():
        key, _, value = line.partition("|")
        if key == "USER":
            user = value.strip() or user
        elif key == "HOME_DU":
            home_du = _number(value.strip())
        elif key == "DF_HOME":
            item = _parse_df_line(value, "/home")
            if item:
                paths.append(item)
        elif key == "DF_SCRATCH":
            item = _parse_df_line(value, "/scratch")
            if item:
                paths.append(item)
        elif key == "DF_DATASETS":
            item = _parse_df_line(value, "/datasets")
            if item:
                paths.append(item)
    if not paths:
        raise RuntimeError("filesystem statistics were empty")
    unique_mounts = {}
    for item in paths:
        unique_mounts.setdefault(item["mount"], item)
    used_tb = sum(item["used_tb"] for item in unique_mounts.values())
    quota_tb = sum(item["quota_tb"] for item in unique_mounts.values())
    home = next((item for item in paths if item["path"] == "/home"), paths[0])
    user_used = round(home_du / 1e12, 3) if home_du else home["used_tb"]
    return {
        "quota_tb": round(quota_tb, 3),
        "used_tb": round(used_tb, 3),
        "paths": paths,
        "users": [{"user": user, "used_tb": user_used, "quota_tb": home["quota_tb"], "files": 0}],
        "measurement_note": "目录扫描超过 6 秒时显示所在文件系统用量",
    }


def _collect_ssh_metrics() -> dict:
    probe_command = r'''printf '__MADAR_NODES__\n'; for n in $(sinfo -h -N -p gpu,interactive -o "%N" 2>/dev/null); do scontrol show node -o "$n"; done; printf '__MADAR_QUEUE__\n'; { squeue -h -t RUNNING -p gpu,interactive -o "%i|%j|%u|%P|%b|%M|%T|%N" | head -100; squeue -h -t PENDING -p gpu,interactive -o "%i|%j|%u|%P|%b|%M|%T|%N" | head -100; }; printf '__MADAR_COUNTS__\n'; printf 'RUNNING|'; squeue -h -t RUNNING -p gpu,interactive | wc -l; printf 'PENDING|'; squeue -h -t PENDING -p gpu,interactive | wc -l; printf '__MADAR_STORAGE__\n'; ''' + _STORAGE_COMMAND
    raw = _run_remote(probe_command, timeout=max(SSH_TIMEOUT, 12))
    sections = {"nodes": [], "queue": [], "counts": [], "storage": []}
    current = None
    for line in raw.splitlines():
        marker = {"__MADAR_NODES__": "nodes", "__MADAR_QUEUE__": "queue", "__MADAR_COUNTS__": "counts", "__MADAR_STORAGE__": "storage"}.get(line.strip())
        if marker:
            current = marker
            continue
        if current:
            sections[current].append(line)
    nodes_raw = "\n".join(sections["nodes"])
    queue_raw = "\n".join(sections["queue"])
    storage_raw = "\n".join(sections["storage"])
    counts = {}
    for line in sections["counts"]:
        key, _, value = line.partition("|")
        if key in {"RUNNING", "PENDING"}:
            counts[key] = _number(value.strip())
    jobs = _parse_jobs(queue_raw)
    nodes, gpus = _parse_nodes(nodes_raw, jobs)
    if not nodes:
        raise RuntimeError("no GPU nodes were returned by Slurm")
    storage = _collect_storage(storage_raw)
    total_gpus = sum(node["total"] for node in nodes)
    allocated_gpus = sum(min(node["allocated"], node["total"]) for node in nodes)
    active_jobs = counts.get("RUNNING", sum(1 for job in jobs if job["status"] == "RUNNING"))
    queued_jobs = counts.get("PENDING", sum(1 for job in jobs if job["status"] in {"PENDING", "CONFIGURING"}))
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
    return get_settings()


def load_metrics(force: bool = False) -> dict:
    """Probe Madar over SSH and return disconnected state on failure."""
    now = time.monotonic()
    with _CACHE_LOCK:
        if not force and _CACHE["payload"] is not None and now - _CACHE["at"] < 8:
            return _CACHE["payload"]
        try:
            payload = _collect_ssh_metrics()
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
