"""Madar HPC dashboard server with SSH/Slurm collection.

Run ``python server.py`` and open the URL it prints. The server probes for a
free port starting at 8766 (override the start with ``MADAR_DASHBOARD_PORT``).

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
import socket
import subprocess
import threading
import time
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
HOST = os.environ.get("MADAR_DASHBOARD_HOST", "127.0.0.1")
# First port to try; the server probes upward from here until one is free.
PORT = int(os.environ.get("MADAR_DASHBOARD_PORT", "8766"))
PORT_PROBE_LIMIT = 50
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
            "gpu_allocated": 0,
            "gpu_maintenance": 0,
            "gpu_restricted": 0,
            "gpu_idle": 0,
            "gpu_utilization": 0,
            "active_jobs": 0,
            "queued_jobs": 0,
            "storage_used_tb": 0.0,
            "storage_total_tb": 0.0,
        },
        "nodes": [],
        "gpus": [],
        "jobs": [],
        "storage": {
            "quota_tb": 0.0,
            "used_tb": 0.0,
            "paths": [],
            "users": [],
        },
        "priority": {
            "config": {},
            "summary": {},
            "user_accounts": [],
            "accounts": [],
            "queue_groups": [],
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


def _float(value: str | None, default: float = 0.0) -> float:
    try:
        return float(value or "")
    except (TypeError, ValueError):
        return default


def _parse_kv_line(line: str) -> dict[str, str]:
    fields: dict[str, str] = {}
    for match in re.finditer(r"([A-Za-z][A-Za-z0-9_]*)=(.*?)(?=\s+[A-Za-z][A-Za-z0-9_]*=|$)", line):
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


_BLOCKED_REASONS = {
    "Dependency",
    "DependencyNeverSatisfied",
    "JobHeldUser",
    "JobHeldAdmin",
    "JobArrayTaskLimit",
    "BeginTime",
    "ReqNodeNotAvail",
    "QOSMaxGRESPerUser",
    "QOSMaxJobsPerUserLimit",
    "AssocMaxJobsLimit",
}


def _parse_duration_hours(text: str, default: float = 168.0) -> float:
    raw = (text or "").strip()
    if not raw:
        return default
    days = 0
    if "-" in raw:
        d_part, raw = raw.split("-", 1)
        days = _number(d_part, 0)
    parts = [ _number(p, 0) for p in raw.split(":") ]
    hours = parts[0] if len(parts) > 0 else 0
    mins = parts[1] if len(parts) > 1 else 0
    secs = parts[2] if len(parts) > 2 else 0
    total = days * 24.0 + hours + mins / 60.0 + secs / 3600.0
    return total if total > 0 else default


def _parse_priority_config(raw: str) -> dict:
    kv: dict[str, str] = {}
    for line in raw.splitlines():
        if "=" not in line:
            continue
        k, _, v = line.partition("=")
        kv[k.strip()] = v.strip()

    w_fairshare = _number(kv.get("PriorityWeightFairShare"), 50000)
    w_age = _number(kv.get("PriorityWeightAge"), 1000)
    w_partition = _number(kv.get("PriorityWeightPartition"), 1000)
    w_jobsize = _number(kv.get("PriorityWeightJobSize"), 0)
    w_qos = _number(kv.get("PriorityWeightQOS"), 0)
    w_assoc = _number(kv.get("PriorityWeightAssoc"), 0)
    max_age_str = kv.get("PriorityMaxAge", "7-00:00:00")
    decay_str = kv.get("PriorityDecayHalfLife", "7-00:00:00")
    max_age_hours = _parse_duration_hours(max_age_str, 168.0)
    decay_hours = _parse_duration_hours(decay_str, 168.0)
    ku_max_fs = 0.0625
    ku_max_fs_pts = round(ku_max_fs * w_fairshare)

    return {
        "priority_type": kv.get("PriorityType", "priority/multifactor"),
        "priority_flags": kv.get("PriorityFlags", "NO_FAIR_TREE"),
        "decay_half_life": decay_str,
        "decay_half_life_days": round(decay_hours / 24.0, 1),
        "calc_period": kv.get("PriorityCalcPeriod", "00:05:00"),
        "max_age": max_age_str,
        "max_age_days": round(max_age_hours / 24.0, 1),
        "max_age_hours": round(max_age_hours, 1),
        "favor_small": kv.get("PriorityFavorSmall", "no"),
        "dampening_factor": _number(kv.get("FairShareDampeningFactor"), 1),
        "scheduler_type": kv.get("SchedulerType", "sched/backfill"),
        "preempt_mode": kv.get("PreemptMode", "OFF"),
        "enforce": kv.get("AccountingStorageEnforce", "associations,limits,qos"),
        "weights": {
            "fairshare": w_fairshare,
            "age": w_age,
            "partition": w_partition,
            "jobsize": w_jobsize,
            "qos": w_qos,
            "assoc": w_assoc,
        },
        "age_points_per_hour": round(w_age / max(max_age_hours, 1.0), 2),
        "age_points_per_day": round(w_age / max(max_age_hours / 24.0, 1.0), 1),
        "ku_max_fairshare": ku_max_fs,
        "ku_max_fairshare_points": ku_max_fs_pts,
        "ku_max_base_priority": ku_max_fs_pts + w_partition,
    }


def _parse_sprio(raw: str) -> dict[str, dict]:
    sprio_map: dict[str, dict] = {}
    for line in raw.splitlines():
        parts = [p.strip() for p in line.strip().split("|")]
        if len(parts) < 8:
            continue
        job_id = parts[0]
        if not job_id or not job_id[0].isdigit():
            continue
        sprio_map[job_id] = {
            "priority": _number(parts[1]),
            "age": _number(parts[2]),
            "fairshare": _number(parts[3]),
            "jobsize": _number(parts[4]),
            "partition": _number(parts[5]),
            "qos": _number(parts[6]),
            "nice": _number(parts[7]),
            "age_norm": _float(parts[8]) if len(parts) > 8 else 0.0,
            "fairshare_norm": _float(parts[9]) if len(parts) > 9 else 0.0,
        }
    return sprio_map


def _parse_sshare(
    raw: str,
    weight_fairshare: int = 50000,
    weight_partition: int = 1000,
) -> tuple[dict[str, dict], list[dict]]:
    accounts_share: dict[str, dict] = {}
    user_rows: list[dict] = []
    for line in raw.splitlines():
        if "|" not in line:
            continue
        parts = line.split("|")
        if len(parts) < 8:
            continue
        acct_raw = parts[0]
        acct = acct_raw.strip()
        if not acct or acct.lower() == "account":
            continue
        depth = len(acct_raw) - len(acct_raw.lstrip(" "))
        user = parts[1].strip()
        raw_shares = parts[2].strip()
        norm_shares = _float(parts[3].strip())
        raw_usage = _number(parts[4].strip())
        norm_usage = _float(parts[5].strip())
        effectv_usage = _float(parts[6].strip())
        fairshare = _float(parts[7].strip())
        tres_run_mins = parts[9].strip() if len(parts) > 9 else ""
        gpu_run_mins = _gpu_count_from_tres(tres_run_mins)
        fs_points = round(fairshare * weight_fairshare)
        base_prio = fs_points + weight_partition

        entry = {
            "account": acct,
            "user": user,
            "depth": depth,
            "raw_shares": raw_shares,
            "norm_shares": round(norm_shares, 6),
            "raw_usage": raw_usage,
            "raw_usage_hours": round(raw_usage / 3600.0, 1),
            "norm_usage": round(norm_usage, 6),
            "effectv_usage": round(effectv_usage, 6),
            "fairshare": round(fairshare, 6),
            "fairshare_points": fs_points,
            "base_priority": base_prio,
            "gpu_run_mins": gpu_run_mins,
        }
        if not user:
            accounts_share[acct] = entry
        else:
            user_rows.append(entry)

    for urow in user_rows:
        parent_acct = accounts_share.get(urow["account"])
        urow["account_raw_usage"] = parent_acct["raw_usage"] if parent_acct else urow["raw_usage"]
        urow["account_raw_usage_hours"] = parent_acct["raw_usage_hours"] if parent_acct else urow["raw_usage_hours"]
        urow["account_gpu_run_mins"] = parent_acct["gpu_run_mins"] if parent_acct else urow["gpu_run_mins"]

    return accounts_share, user_rows


def _parse_jobs(
    raw: str,
    sprio_map: dict[str, dict] | None = None,
    accounts_share: dict[str, dict] | None = None,
    weights: dict[str, int] | None = None,
) -> list[dict]:
    jobs = []
    smap = sprio_map or {}
    ashare = accounts_share or {}
    w_fs = (weights or {}).get("fairshare", 50000)
    w_part = (weights or {}).get("partition", 1000)
    w_age = (weights or {}).get("age", 1000)

    for line in raw.splitlines():
        parts = line.strip().split("|")
        if len(parts) < 8:
            continue
        job_id, name, owner, partition, gres, elapsed, status, node = parts[:8]
        reason = parts[8].strip().strip("()") if len(parts) > 8 else ""
        if reason.lower() in {"none", "null", "(null)"}:
            reason = ""
        priority = _number(parts[9].strip(), 0) if len(parts) > 9 else 0
        account = parts[10].strip() if len(parts) > 10 else ""
        qos = parts[11].strip() if len(parts) > 11 else "normal"
        time_limit = parts[12].strip() if len(parts) > 12 else ""

        base_job_id = job_id.split("_")[0]
        sp = smap.get(job_id) or smap.get(base_job_id)
        acct_info = ashare.get(account)

        if sp:
            prio_val = priority or sp["priority"]
            fs_pts = sp["fairshare"]
            part_pts = sp["partition"]
            age_pts = sp["age"]
            qos_pts = sp["qos"]
            js_pts = sp["jobsize"]
            fs_norm = sp["fairshare_norm"] or (acct_info["fairshare"] if acct_info else round(fs_pts / max(w_fs, 1), 6))
            age_norm = sp["age_norm"] or round(age_pts / max(w_age, 1), 6)
            in_sprio = True
        else:
            prio_val = priority
            part_pts = w_part if prio_val >= w_part else 0
            acct_fs_pts = acct_info["fairshare_points"] if acct_info else 0
            fs_pts = min(acct_fs_pts, max(prio_val - part_pts, 0))
            age_pts = max(prio_val - part_pts - fs_pts, 0)
            qos_pts = 0
            js_pts = 0
            fs_norm = acct_info["fairshare"] if acct_info else round(fs_pts / max(w_fs, 1), 6)
            age_norm = min(round(age_pts / max(w_age, 1), 6), 1.0)
            in_sprio = False

        eligible = status == "PENDING" and reason not in _BLOCKED_REASONS
        jobs.append({
            "id": job_id,
            "name": name,
            "owner": owner,
            "account": account,
            "qos": qos,
            "partition": partition,
            "gpus": _gpu_request(gres),
            "elapsed": elapsed,
            "time_limit": time_limit,
            "status": status,
            "node": node if node != "(null)" else "",
            "reason": reason,
            "priority": prio_val,
            "eligible": eligible,
            "prio_breakdown": {
                "fairshare": fs_pts,
                "partition": part_pts,
                "age": age_pts,
                "qos": qos_pts,
                "jobsize": js_pts,
                "fairshare_norm": round(fs_norm, 6),
                "age_norm": round(age_norm, 6),
                "in_sprio": in_sprio,
            },
        })
    return jobs


def _parse_partitions(raw: str) -> dict[str, dict]:
    partitions: dict[str, dict] = {}
    for line in raw.splitlines():
        fields = _parse_kv_line(line)
        name = fields.get("PartitionName", "").strip()
        if not name:
            continue
        allow_accounts = fields.get("AllowAccounts", "ALL").strip()
        allow_groups = fields.get("AllowGroups", "ALL").strip()
        partitions[name] = {
            "name": name,
            "allow_accounts": allow_accounts,
            "allow_groups": allow_groups,
            "restricted": allow_accounts.upper() not in {"ALL", ""},
            "priority_job_factor": _number(fields.get("PriorityJobFactor"), 1),
            "priority_tier": _number(fields.get("PriorityTier"), 1),
            "max_time": fields.get("MaxTime", ""),
            "preempt_mode": fields.get("PreemptMode", "OFF"),
        }
    return partitions


_GENERIC_SHARED_ACCOUNTS = {
    "root",
    "ku",
    "gl",
    "exporter",
    "ku--default-g",
    "gl--default-g",
    "ku--default-g-ipa",
}


def _build_priority_payload(
    config: dict,
    all_jobs: list[dict],
    accounts_share: dict[str, dict],
    user_rows: list[dict],
    ssh_user: str,
    partitions_map: dict[str, dict],
) -> dict:
    acct_job_stats: dict[str, dict] = {}
    for job in all_jobs:
        acct = job.get("account") or ""
        if not acct:
            continue
        st = acct_job_stats.setdefault(
            acct,
            {"running_jobs": 0, "running_gpus": 0, "pending_jobs": 0, "pending_gpus": 0, "users": set()},
        )
        st["users"].add(job["owner"])
        if job["status"] == "RUNNING":
            st["running_jobs"] += 1
            st["running_gpus"] += job["gpus"]
        else:
            st["pending_jobs"] += 1
            st["pending_gpus"] += job["gpus"]

    my_user_rows = [r for r in user_rows if r["user"] == ssh_user]
    my_acct_names = {r["account"] for r in my_user_rows}
    for job in all_jobs:
        if job["owner"] == ssh_user and job.get("account"):
            my_acct_names.add(job["account"])

    my_group_accounts = sorted(my_acct_names - _GENERIC_SHARED_ACCOUNTS) or sorted(my_acct_names)
    my_group_acct_set = set(my_group_accounts)

    group_member_rows = [r for r in user_rows if r["account"] in my_group_acct_set]
    group_member_users = {r["user"] for r in group_member_rows if r["user"]} | ({ssh_user} if ssh_user else set())
    for job in all_jobs:
        if job.get("account") in my_group_acct_set and job.get("owner"):
            group_member_users.add(job["owner"])

    for job in all_jobs:
        is_mine = job["owner"] == ssh_user
        is_group = (job.get("account") in my_group_acct_set) or (job["owner"] in group_member_users)
        job["is_mine"] = is_mine
        job["is_group"] = is_group
        job["is_teammate"] = is_group and not is_mine

    group_members: list[dict] = []
    seen_members: set[tuple[str, str]] = set()
    for row in group_member_rows:
        m_user = row["user"]
        m_acct = row["account"]
        if not m_user or (m_acct, m_user) in seen_members:
            continue
        seen_members.add((m_acct, m_user))
        m_jobs = [j for j in all_jobs if j["owner"] == m_user]
        m_run_jobs = sum(1 for j in m_jobs if j["status"] == "RUNNING")
        m_run_gpus = sum(j["gpus"] for j in m_jobs if j["status"] == "RUNNING")
        m_pend_jobs = sum(1 for j in m_jobs if j["status"] != "RUNNING")
        m_pend_gpus = sum(j["gpus"] for j in m_jobs if j["status"] != "RUNNING")
        acct_raw = max(row.get("account_raw_usage", 0), 1)
        usage_share_pct = round(min((row["raw_usage"] / acct_raw) * 100.0, 100.0), 1) if row.get("account_raw_usage", 0) > 0 else 0.0
        group_members.append({
            "user": m_user,
            "account": m_acct,
            "is_me": m_user == ssh_user,
            "raw_usage": row["raw_usage"],
            "raw_usage_hours": row["raw_usage_hours"],
            "account_raw_usage_hours": row.get("account_raw_usage_hours", 0.0),
            "usage_share_pct": usage_share_pct,
            "fairshare": row["fairshare"],
            "fairshare_points": row["fairshare_points"],
            "running_jobs": m_run_jobs,
            "running_gpus": m_run_gpus,
            "pending_jobs": m_pend_jobs,
            "pending_gpus": m_pend_gpus,
            "total_jobs": m_run_jobs + m_pend_jobs,
        })

    group_members.sort(
        key=lambda m: (
            0 if m["is_me"] else 1,
            -m["total_jobs"],
            -m["running_gpus"],
            -m["raw_usage"],
            m["user"],
        )
    )

    group_jobs_all = [j for j in all_jobs if j.get("is_group")]
    teammate_jobs_all = [j for j in all_jobs if j.get("is_teammate")]
    primary_group_acct = my_group_accounts[0] if my_group_accounts else ""
    primary_group_info = accounts_share.get(primary_group_acct, {})
    group_summary = {
        "accounts": my_group_accounts,
        "primary_account": primary_group_acct,
        "fairshare_points": primary_group_info.get("fairshare_points", 0),
        "base_priority": primary_group_info.get("base_priority", 0),
        "account_raw_usage_hours": primary_group_info.get("raw_usage_hours", 0.0),
        "effectv_usage": primary_group_info.get("effectv_usage", 0.0),
        "member_count": len(group_members),
        "active_member_count": sum(1 for m in group_members if m["total_jobs"] > 0),
        "total_jobs": len(group_jobs_all),
        "running_jobs": sum(1 for j in group_jobs_all if j["status"] == "RUNNING"),
        "running_gpus": sum(j["gpus"] for j in group_jobs_all if j["status"] == "RUNNING"),
        "pending_jobs": sum(1 for j in group_jobs_all if j["status"] != "RUNNING"),
        "pending_gpus": sum(j["gpus"] for j in group_jobs_all if j["status"] != "RUNNING"),
        "teammate_total_jobs": len(teammate_jobs_all),
        "teammate_running_jobs": sum(1 for j in teammate_jobs_all if j["status"] == "RUNNING"),
        "teammate_running_gpus": sum(j["gpus"] for j in teammate_jobs_all if j["status"] == "RUNNING"),
        "teammate_pending_jobs": sum(1 for j in teammate_jobs_all if j["status"] != "RUNNING"),
        "teammate_pending_gpus": sum(j["gpus"] for j in teammate_jobs_all if j["status"] != "RUNNING"),
        "members": group_members,
    }

    enriched_user_accounts = []
    seen_user_accts = set()
    for row in my_user_rows:
        acct_name = row["account"]
        if acct_name in seen_user_accts:
            continue
        seen_user_accts.add(acct_name)
        my_running = sum(1 for j in all_jobs if j["owner"] == ssh_user and j.get("account") == acct_name and j["status"] == "RUNNING")
        my_pending = sum(1 for j in all_jobs if j["owner"] == ssh_user and j.get("account") == acct_name and j["status"] != "RUNNING")
        my_pending_gpus = sum(j["gpus"] for j in all_jobs if j["owner"] == ssh_user and j.get("account") == acct_name and j["status"] != "RUNNING")
        grp_st = acct_job_stats.get(acct_name, {"running_jobs": 0, "running_gpus": 0, "pending_jobs": 0, "pending_gpus": 0})
        enriched_user_accounts.append({
            **row,
            "my_running_jobs": my_running,
            "my_pending_jobs": my_pending,
            "my_pending_gpus": my_pending_gpus,
            "group_running_jobs": grp_st["running_jobs"],
            "group_running_gpus": grp_st["running_gpus"],
            "group_pending_jobs": grp_st["pending_jobs"],
            "group_pending_gpus": grp_st["pending_gpus"],
        })
    enriched_user_accounts.sort(key=lambda x: (-x["base_priority"], x["account"]))

    pending_jobs = [j for j in all_jobs if j["status"] != "RUNNING"]
    pending_jobs.sort(key=lambda j: (-j["priority"], 0 if j["eligible"] else 1, j["id"]))

    groups_map: dict[tuple, dict] = {}
    for job in pending_jobs:
        key = (job["owner"], job["account"], job["partition"], job["priority"], job["reason"], job["eligible"])
        if key not in groups_map:
            groups_map[key] = {
                "owner": job["owner"],
                "account": job["account"],
                "partition": job["partition"],
                "priority": job["priority"],
                "reason": job["reason"],
                "eligible": job["eligible"],
                "is_mine": job.get("is_mine", False),
                "is_group": job.get("is_group", False),
                "is_teammate": job.get("is_teammate", False),
                "job_count": 0,
                "total_gpus": 0,
                "sample_job_id": job["id"],
                "sample_job_name": job["name"],
                "time_limit": job.get("time_limit", ""),
                "prio_breakdown": job["prio_breakdown"],
                "job_ids": [],
            }
        grp = groups_map[key]
        grp["job_count"] += 1
        grp["total_gpus"] += job["gpus"]
        if len(grp["job_ids"]) < 6:
            grp["job_ids"].append(job["id"])

    queue_groups = list(groups_map.values())
    queue_groups.sort(key=lambda g: (-g["priority"], 0 if g["eligible"] else 1, g["sample_job_id"]))

    eligible_rank = 0
    cum_eligible_gpus = 0
    cum_eligible_jobs = 0
    for grp in queue_groups:
        grp["gpus_ahead"] = cum_eligible_gpus
        grp["jobs_ahead"] = cum_eligible_jobs
        if grp["eligible"]:
            eligible_rank += 1
            grp["eligible_rank"] = eligible_rank
            cum_eligible_gpus += grp["total_gpus"]
            cum_eligible_jobs += grp["job_count"]
        else:
            grp["eligible_rank"] = None

    my_pending_groups = [g for g in queue_groups if g["is_mine"]]
    my_top_pending = my_pending_groups[0] if my_pending_groups else None
    my_best_acct = enriched_user_accounts[0] if enriched_user_accounts else None
    my_active_acct = (
        next((a for a in enriched_user_accounts if a["my_pending_jobs"] > 0 or a["my_running_jobs"] > 0), None)
        or my_best_acct
    )

    accounts_list: list[dict] = []
    for acct_name, info in accounts_share.items():
        if acct_name in {"root", "ku", "gl", "exporter", "gl--default-g", "ku--default-g-ipa"}:
            continue
        st = acct_job_stats.get(acct_name, {"running_jobs": 0, "running_gpus": 0, "pending_jobs": 0, "pending_gpus": 0, "users": set()})
        is_active = st["running_jobs"] > 0 or st["pending_jobs"] > 0
        is_mine = acct_name in my_acct_names
        if not is_active and not is_mine and info["raw_usage"] == 0:
            continue
        accounts_list.append({
            **info,
            "is_mine": is_mine,
            "is_active": is_active,
            "running_jobs": st["running_jobs"],
            "running_gpus": st["running_gpus"],
            "pending_jobs": st["pending_jobs"],
            "pending_gpus": st["pending_gpus"],
            "active_users_count": len(st["users"]),
        })

    accounts_list.sort(
        key=lambda a: (
            0 if (a["is_active"] or a["is_mine"]) else 1,
            -a["fairshare_points"],
            -a["running_gpus"],
            a["account"],
        )
    )

    summary = {
        "ssh_user": ssh_user,
        "my_current_priority": (
            my_top_pending["priority"]
            if my_top_pending
            else (my_active_acct["base_priority"] if my_active_acct else 0)
        ),
        "my_current_account": (
            my_top_pending["account"]
            if my_top_pending
            else (my_active_acct["account"] if my_active_acct else "")
        ),
        "my_best_account": my_best_acct["account"] if my_best_acct else "",
        "my_best_base_priority": my_best_acct["base_priority"] if my_best_acct else 0,
        "my_best_fairshare_points": my_best_acct["fairshare_points"] if my_best_acct else 0,
        "my_eligible_rank": my_top_pending["eligible_rank"] if my_top_pending else None,
        "my_gpus_ahead": my_top_pending["gpus_ahead"] if my_top_pending else cum_eligible_gpus,
        "my_jobs_ahead": my_top_pending["jobs_ahead"] if my_top_pending else cum_eligible_jobs,
        "my_pending_jobs": sum(g["job_count"] for g in my_pending_groups),
        "my_pending_gpus": sum(g["total_gpus"] for g in my_pending_groups),
        "total_pending_groups": len(queue_groups),
        "eligible_groups_count": eligible_rank,
        "eligible_jobs_count": cum_eligible_jobs,
        "eligible_gpus_total": cum_eligible_gpus,
        "highest_pending_priority": queue_groups[0]["priority"] if queue_groups else 0,
        "lowest_pending_priority": queue_groups[-1]["priority"] if queue_groups else 0,
    }

    return {
        "config": config,
        "summary": summary,
        "group": group_summary,
        "user_accounts": enriched_user_accounts,
        "queue_groups": queue_groups,
        "accounts": accounts_list[:60],
        "partitions": list(partitions_map.values()),
    }


_DOWN_STATES = {
    "DOWN",
    "FAIL",
    "FAILING",
    "INVAL",
    "NOT_RESPONDING",
    "POWER_DOWN",
    "POWERED_DOWN",
    "POWERING_DOWN",
}
_DRAIN_STATES = {
    "DRAIN",
    "DRAINED",
    "DRAINING",
    "MAINT",
    "REBOOT_REQUESTED",
    "REBOOT_ISSUED",
}


def _classify_node_state(
    state: str,
    reason: str,
    node_partitions: list[str] | None = None,
    partitions_map: dict[str, dict] | None = None,
) -> dict:
    raw_state = (state or "").upper().strip()
    tokens = {tok.rstrip("*~$#@!") for tok in raw_state.split("+") if tok}
    reason_raw = (reason or "").strip()
    if reason_raw.lower() in {"none", "(null)"}:
        reason_raw = ""
    reason_short = re.sub(r"\s*\[[^\]]*\]\s*$", "", reason_raw).strip()
    parts_list = node_partitions or []
    pmap = partitions_map or {}

    if tokens & _DOWN_STATES or "*" in raw_state:
        return {
            "mode": "down",
            "badge": "DOWN",
            "label": "节点离线 (DOWN)",
            "reason": reason_raw,
            "reason_short": reason_short or "节点无响应或已下线",
            "planned": False,
        }
    if tokens & _DRAIN_STATES:
        if "MAINT" in tokens:
            badge, label = "MAINT", "系统维护中 (MAINT)"
        elif "REBOOT_REQUESTED" in tokens or "REBOOT_ISSUED" in tokens:
            badge, label = "REBOOT", "等待重启维护"
        else:
            badge, label = "DRAIN", "维护排空中 (DRAIN)"
        return {
            "mode": "drain",
            "badge": badge,
            "label": label,
            "reason": reason_raw,
            "reason_short": reason_short or "暂停接收新任务",
            "planned": False,
        }
    if "RESERVED" in tokens:
        return {
            "mode": "reserved",
            "badge": "RESV",
            "label": "节点预留 (RESERVED)",
            "reason": reason_raw,
            "reason_short": reason_short or "资源已预留",
            "planned": False,
        }

    restricted_parts = [pmap[p] for p in parts_list if p in pmap and pmap[p].get("restricted")]
    unrestricted_parts = [p for p in parts_list if p not in pmap or not pmap[p].get("restricted")]
    if restricted_parts and not unrestricted_parts:
        part = restricted_parts[0]
        accounts = part["allow_accounts"]
        return {
            "mode": "restricted",
            "badge": "ADMIN",
            "label": f"受限分区 ({part['name']})",
            "reason": f"Partition {part['name']} AllowAccounts={accounts}",
            "reason_short": f"仅限 {accounts} 账户",
            "planned": False,
        }

    return {
        "mode": "normal",
        "badge": "PLANNED" if "PLANNED" in tokens else "",
        "label": "",
        "reason": reason_raw,
        "reason_short": reason_short,
        "planned": "PLANNED" in tokens,
    }


def _parse_nodes(
    raw: str,
    jobs: list[dict],
    partitions_map: dict[str, dict] | None = None,
) -> tuple[list[dict], list[dict]]:
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
        reason = fields.get("Reason", "")
        node_partitions = [p.strip() for p in fields.get("Partitions", "").split(",") if p.strip()]
        state_info = _classify_node_state(state, reason, node_partitions, partitions_map)
        node_jobs = jobs_by_node.get(node_name, [])
        allocated_jobs: list[dict] = []
        for job in node_jobs:
            allocated_jobs.extend([job] * max(job["gpus"], 1))
        model = _model_from_gres(gres)
        nodes.append({
            "name": node_name,
            "model": model,
            "total": total,
            "allocated": allocated,
            "state": state,
            "partitions": node_partitions,
            "mode": state_info["mode"],
            "reason": state_info["reason_short"],
            "reason_full": state_info["reason"],
        })
        for index in range(total):
            job = allocated_jobs[index] if index < len(allocated_jobs) else None
            busy = index < allocated or job is not None
            if busy:
                status = "busy"
                substatus = state_info["mode"]
                utilization = 100
                util_display = "100%"
                util_label = f"ALLOC · {state_info['badge']}" if state_info["mode"] != "normal" else "ALLOC"
                process = job["name"] if job else "Allocated by Slurm"
                owner = job["owner"] if job else state_info["reason_short"]
            elif state_info["mode"] in {"down", "drain", "reserved", "restricted"}:
                status = "maintenance"
                substatus = state_info["mode"]
                utilization = 0
                util_display = state_info["badge"]
                util_label = (
                    "OFFLINE"
                    if state_info["mode"] == "down"
                    else ("受限分区" if state_info["mode"] == "restricted" else "不可调度")
                )
                process = state_info["label"]
                owner = state_info["reason_short"]
            else:
                status = "idle"
                substatus = "planned" if state_info["planned"] else "idle"
                utilization = 0
                util_display = "0%"
                util_label = "ALLOC · PLANNED" if state_info["planned"] else "ALLOC"
                process = "Available (已预排期)" if state_info["planned"] else "Available"
                owner = ""

            gpus.append({
                "id": f"{node_name} / GPU {index + 1:02d}",
                "node": node_name,
                "model": model,
                "utilization": utilization,
                "util_display": util_display,
                "util_label": util_label,
                "memory_used": None,
                "memory_total": None,
                "temperature": None,
                "power": None,
                "power_limit": None,
                "status": status,
                "substatus": substatus,
                "node_state": state,
                "node_reason": state_info["reason"] or state_info["reason_short"],
                "process": process,
                "owner": owner,
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


_STORAGE_INIT_COMMAND = r'''printf 'USER|'; id -un; printf 'HOME_PATH|'; printf '%s\n' "$HOME"; printf 'DF_HOME|'; df -Pk -T "$HOME" 2>/dev/null | tail -1 '''
_DU_REMOTE_COMMAND = r'''printf 'HOME_PATH|'; printf '%s\n' "$HOME"; printf 'HOME_DIRS|\n'; for d in "$HOME"/.[!.]* "$HOME"/*; do [ -e "$d" ] && [ ! -L "$d" ] && (timeout 35 du -sk -x "$d" 2>/dev/null &); done; wait; true'''
_DU_LOCK = threading.Lock()
_INIT_FS_CACHE: dict = {"initialized": False, "user": "user", "home_path": "~", "df_home": None}
_DU_CACHE: dict = {"at": 0.0, "home_kb": 0, "subdirs": [], "scanning": False}
_DU_REFRESH_SECONDS = 1800  # 30 minutes
USER_HOME_QUOTA_GB = 50.0
USER_HOME_QUOTA_TB = USER_HOME_QUOTA_GB / 1000.0


def _build_user_paths(home_used_gb: float, subdirs: list[dict], quota_gb: float = USER_HOME_QUOTA_GB) -> list[dict]:
    paths = []
    quota_tb = round(quota_gb / 1000.0, 6)
    top_items = subdirs[:5] if len(subdirs) > 6 else subdirs[:6]
    rest_items = subdirs[5:] if len(subdirs) > 6 else []
    for sub in top_items:
        quota_pct = round(min(sub["used_gb"] / max(quota_gb, 0.1) * 100.0, 100.0), 2)
        paths.append({
            "path": f"~/ {sub['name']}",
            "name": sub["name"],
            "used_gb": sub["used_gb"],
            "used_mb": sub["used_mb"],
            "quota_gb": quota_gb,
            "used_tb": round(sub["used_gb"] / 1000, 6),
            "quota_tb": quota_tb,
            "pct": quota_pct,
            "share_pct": sub["share_pct"],
            "kind": "subdir",
        })
    if rest_items:
        used_sum_gb = sum(item["used_gb"] for item in top_items)
        used_sum_pct = sum(item["share_pct"] for item in top_items)
        rest_gb = max(round(home_used_gb - used_sum_gb, 6), sum(item["used_gb"] for item in rest_items))
        rest_share_pct = max(round(100.0 - used_sum_pct, 1), 0.1)
        rest_quota_pct = round(min(rest_gb / max(quota_gb, 0.1) * 100.0, 100.0), 2)
        paths.append({
            "path": "其他目录与文件",
            "name": "其他",
            "used_gb": rest_gb,
            "used_mb": round(rest_gb * 1000, 2),
            "quota_gb": quota_gb,
            "used_tb": round(rest_gb / 1000, 6),
            "quota_tb": quota_tb,
            "pct": rest_quota_pct,
            "share_pct": rest_share_pct,
            "kind": "subdir",
        })
    return paths


def _parse_and_store_du(raw: str, fallback_home: str = "~") -> None:
    home_path = fallback_home
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

    raw_subdirs: list[tuple[str, int]] = []
    norm_home = home_path.rstrip("/")
    for dline in du_lines:
        parts = dline.split(None, 1)
        if len(parts) < 2:
            continue
        kb = _number(parts[0])
        dpath = parts[1].strip().rstrip("/")
        if dpath.startswith(norm_home + "/"):
            rel_name = dpath[len(norm_home) + 1 :]
            if rel_name and "/" not in rel_name:
                raw_subdirs.append((rel_name, kb))

    raw_subdirs.sort(key=lambda item: item[1], reverse=True)
    home_kb = sum(kb for _, kb in raw_subdirs)

    subdirs = []
    for name, kb in raw_subdirs[:10]:
        used_bytes = kb * 1024
        share = round(kb / home_kb * 100, 1) if home_kb > 0 else 0.0
        subdirs.append({
            "name": name,
            "used_gb": round(used_bytes / 1e9, 6),
            "used_mb": round(used_bytes / 1e6, 2),
            "share_pct": min(share, 100.0),
        })

    with _DU_LOCK:
        _DU_CACHE.update({
            "at": time.monotonic(),
            "home_kb": home_kb if (home_kb > 0 or not _DU_CACHE["home_kb"]) else _DU_CACHE["home_kb"],
            "subdirs": subdirs if (subdirs or not _DU_CACHE["subdirs"]) else _DU_CACHE["subdirs"],
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
        scanning = _DU_CACHE["scanning"]
    home_used_bytes = home_kb * 1024
    home_used_gb = round(home_used_bytes / 1e9, 6)
    home_used_tb = round(home_used_bytes / 1e12, 6)
    storage["scanning"] = scanning
    storage["home_used_gb"] = home_used_gb
    storage["home_used_tb"] = home_used_tb
    storage["home_quota_gb"] = USER_HOME_QUOTA_GB
    storage["home_avail_gb"] = max(round(USER_HOME_QUOTA_GB - home_used_gb, 6), 0.0)
    storage["used_tb"] = home_used_tb
    storage["quota_tb"] = USER_HOME_QUOTA_TB
    storage["subdirs"] = subdirs
    storage["paths"] = _build_user_paths(home_used_gb, subdirs, USER_HOME_QUOTA_GB)


def _trigger_du_scan(home_path: str = "~", force: bool = False) -> None:
    with _DU_LOCK:
        if _DU_CACHE["scanning"]:
            return
        age = time.monotonic() - _DU_CACHE["at"]
        if not force and _DU_CACHE["at"] > 0 and age < _DU_REFRESH_SECONDS:
            return
        _DU_CACHE["scanning"] = True

    def _worker():
        time.sleep(1.0)
        try:
            raw = _run_remote(_DU_REMOTE_COMMAND, timeout=45)
            _parse_and_store_du(raw, fallback_home=home_path)
        except subprocess.TimeoutExpired as exc:
            partial = exc.stdout.decode("utf-8", errors="replace") if isinstance(exc.stdout, bytes) else (exc.stdout or "")
            if partial.strip():
                _parse_and_store_du(partial, fallback_home=home_path)
            else:
                with _DU_LOCK:
                    _DU_CACHE["scanning"] = False
        except Exception as exc:
            print(f"[madar-dashboard] background du scan failed: {exc}")
            with _DU_LOCK:
                _DU_CACHE["scanning"] = False

    threading.Thread(target=_worker, daemon=True).start()


def _collect_storage(raw: str | None = None, force_du: bool = False) -> dict:
    if raw:
        user = _INIT_FS_CACHE["user"]
        home_path = _INIT_FS_CACHE["home_path"]
        df_home = _INIT_FS_CACHE["df_home"]
        for line in raw.splitlines():
            key, _, value = line.partition("|")
            if key == "USER":
                user = value.strip() or user
            elif key == "HOME_PATH":
                home_path = value.strip() or home_path
            elif key == "DF_HOME":
                df_home = _parse_df_line(value, home_path)
        if df_home:
            _INIT_FS_CACHE.update({
                "initialized": True,
                "user": user,
                "home_path": home_path,
                "df_home": df_home,
            })

    if not _INIT_FS_CACHE["initialized"] or not _INIT_FS_CACHE["df_home"]:
        raise RuntimeError("filesystem statistics for $HOME were empty")

    user = _INIT_FS_CACHE["user"]
    home_path = _INIT_FS_CACHE["home_path"]
    df_home = _INIT_FS_CACHE["df_home"]

    _trigger_du_scan(home_path=home_path, force=force_du)

    with _DU_LOCK:
        home_kb = _DU_CACHE["home_kb"]
        subdirs = list(_DU_CACHE["subdirs"])
        scanning = _DU_CACHE["scanning"]

    home_used_bytes = home_kb * 1024
    home_used_gb = round(home_used_bytes / 1e9, 6)
    home_used_tb = round(home_used_bytes / 1e12, 6)
    paths = _build_user_paths(home_used_gb, subdirs, USER_HOME_QUOTA_GB)

    return {
        "user": user,
        "home_path": home_path,
        "mount": df_home["mount"],
        "scanning": scanning,
        "home_used_gb": home_used_gb,
        "home_used_tb": home_used_tb,
        "home_quota_gb": USER_HOME_QUOTA_GB,
        "home_avail_gb": max(round(USER_HOME_QUOTA_GB - home_used_gb, 6), 0.0),
        "fs_used_gb": df_home["used_gb"],
        "fs_total_gb": df_home["total_gb"],
        "fs_avail_gb": df_home["avail_gb"],
        "fs_used_tb": df_home["used_tb"],
        "fs_total_tb": df_home["quota_tb"],
        "fs_avail_tb": df_home["avail_tb"],
        "quota_tb": USER_HOME_QUOTA_TB,
        "used_tb": home_used_tb,
        "paths": paths,
        "subdirs": subdirs,
        "users": [{"user": user, "used_tb": home_used_tb, "used_gb": home_used_gb, "quota_tb": USER_HOME_QUOTA_TB, "files": 0}],
    }


def _collect_ssh_metrics(force_du: bool = False) -> dict:
    need_init_fs = not _INIT_FS_CACHE["initialized"]
    probe_command = (
        r'''printf '__MADAR_PARTITIONS__\n'; scontrol show partition -o 2>/dev/null; '''
        r'''printf '__MADAR_NODES__\n'; scontrol show node -o 2>/dev/null; '''
        r'''printf '__MADAR_QUEUE__\n'; squeue -h -p gpu,interactive -o "%i|%j|%u|%P|%b|%M|%T|%N|%r|%Q|%a|%q|%l" 2>/dev/null; '''
        r'''printf '__MADAR_SPRIO__\n'; sprio -h -p gpu,interactive -o "%i|%Y|%A|%F|%J|%P|%Q|%N|%a|%f" 2>/dev/null; '''
        r'''printf '__MADAR_SSHARE__\n'; sshare -a -P -l 2>/dev/null; '''
        r'''printf '__MADAR_PRIO_CFG__\n'; scontrol show config 2>/dev/null | grep -E "^(Priority|FairShare|SchedulerType|PreemptMode|AccountingStorageEnforce)"'''
    )
    if need_init_fs:
        probe_command += r'''; printf '__MADAR_STORAGE__\n'; ''' + _STORAGE_INIT_COMMAND

    raw = _run_remote(probe_command, timeout=max(SSH_TIMEOUT, 20))
    sections = {"partitions": [], "nodes": [], "queue": [], "sprio": [], "sshare": [], "prio_cfg": [], "storage": []}
    current = None
    for line in raw.splitlines():
        marker = {
            "__MADAR_PARTITIONS__": "partitions",
            "__MADAR_NODES__": "nodes",
            "__MADAR_QUEUE__": "queue",
            "__MADAR_SPRIO__": "sprio",
            "__MADAR_SSHARE__": "sshare",
            "__MADAR_PRIO_CFG__": "prio_cfg",
            "__MADAR_STORAGE__": "storage",
        }.get(line.strip())
        if marker:
            current = marker
            continue
        if current:
            sections[current].append(line)
    partitions_raw = "\n".join(sections["partitions"])
    nodes_raw = "\n".join(sections["nodes"])
    queue_raw = "\n".join(sections["queue"])
    sprio_raw = "\n".join(sections["sprio"])
    sshare_raw = "\n".join(sections["sshare"])
    prio_cfg_raw = "\n".join(sections["prio_cfg"])
    storage_raw = "\n".join(sections["storage"]) if need_init_fs else None

    partitions_map = _parse_partitions(partitions_raw)
    prio_config = _parse_priority_config(prio_cfg_raw)
    weights = prio_config["weights"]
    sprio_map = _parse_sprio(sprio_raw)
    accounts_share, user_rows = _parse_sshare(
        sshare_raw,
        weight_fairshare=weights["fairshare"],
        weight_partition=weights["partition"],
    )
    all_jobs = _parse_jobs(queue_raw, sprio_map=sprio_map, accounts_share=accounts_share, weights=weights)
    all_jobs.sort(key=lambda j: (0 if j["status"] == "RUNNING" else 1, -j.get("priority", 0), j["id"]))
    active_jobs = sum(1 for job in all_jobs if job["status"] == "RUNNING")
    queued_jobs = sum(1 for job in all_jobs if job["status"] in {"PENDING", "CONFIGURING"})
    nodes, gpus = _parse_nodes(nodes_raw, all_jobs, partitions_map)
    if not nodes:
        raise RuntimeError("no GPU nodes were returned by Slurm")
    storage = _collect_storage(storage_raw, force_du=force_du)
    priority_payload = _build_priority_payload(
        config=prio_config,
        all_jobs=all_jobs,
        accounts_share=accounts_share,
        user_rows=user_rows,
        ssh_user=storage.get("user", "user"),
        partitions_map=partitions_map,
    )
    jobs = all_jobs[:300]
    total_gpus = sum(node["total"] for node in nodes)
    allocated_gpus = sum(min(node["allocated"], node["total"]) for node in nodes)
    maintenance_gpus = sum(1 for gpu in gpus if gpu["status"] == "maintenance" and gpu.get("substatus") != "restricted")
    restricted_gpus = sum(1 for gpu in gpus if gpu["status"] == "maintenance" and gpu.get("substatus") == "restricted")
    unavailable_gpus = maintenance_gpus + restricted_gpus
    idle_gpus = sum(1 for gpu in gpus if gpu["status"] == "idle")
    online_gpus = max(total_gpus - unavailable_gpus, 0)
    maintenance_nodes = [
        {"name": node["name"], "state": node["state"], "mode": node["mode"], "reason": node["reason"]}
        for node in nodes
        if node["mode"] in {"down", "drain", "reserved", "restricted"}
    ]
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
            "refresh_seconds": 60,
            "gpu_total": total_gpus,
            "gpu_online": online_gpus,
            "gpu_allocated": allocated_gpus,
            "gpu_maintenance": maintenance_gpus,
            "gpu_restricted": restricted_gpus,
            "gpu_idle": idle_gpus,
            "maintenance_nodes": maintenance_nodes,
            "gpu_utilization": round(allocated_gpus / online_gpus * 100) if online_gpus else 0,
            "active_jobs": active_jobs,
            "queued_jobs": queued_jobs,
            "storage_used_tb": storage["used_tb"],
            "storage_total_tb": storage["quota_tb"],
        },
        "nodes": nodes,
        "gpus": gpus,
        "jobs": jobs,
        "storage": storage,
        "priority": priority_payload,
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
        _INIT_FS_CACHE.update({"initialized": False, "user": "user", "home_path": "~", "df_home": None})
    with _DU_LOCK:
        _DU_CACHE.update({"at": 0.0, "home_kb": 0, "subdirs": [], "scanning": False})
    return get_settings()


def load_metrics(force: bool = False) -> dict:
    """Probe Madar over SSH and return disconnected state on failure."""
    now = time.monotonic()
    with _CACHE_LOCK:
        cached = _CACHE["payload"]
        ttl = 50 if (cached and cached.get("cluster", {}).get("connected")) else 8
        if not force and cached is not None and now - _CACHE["at"] < ttl:
            _sync_du_into_payload(cached)
            return cached
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
            super().end_headers()
            self.wfile.write(payload)
        except _DISCONNECT_ERRORS:
            return

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

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

        if path == "/favicon.ico":
            logo_file = ROOT / "logo.png"
            if logo_file.exists():
                self._write_bytes(logo_file.read_bytes(), "image/png")
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


class DashboardServer(ThreadingHTTPServer):
    # On Windows SO_REUSEADDR lets two processes bind the same port, which
    # would make the free-port probe succeed on a port that is already taken.
    allow_reuse_address = os.name != "nt"

    def server_bind(self):
        if os.name == "nt":
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        super().server_bind()


def bind_free_port(host: str, start: int, attempts: int = PORT_PROBE_LIMIT) -> DashboardServer:
    """Bind the first free port at or above ``start``."""
    last_error: OSError | None = None
    for port in range(start, min(start + attempts, 65536)):
        try:
            return DashboardServer((host, port), DashboardHandler)
        except OSError as exc:
            last_error = exc
    raise SystemExit(
        f"No free port in {start}-{min(start + attempts, 65536) - 1} on {host}: {last_error}"
    )


if __name__ == "__main__":
    mimetypes.add_type("application/javascript", ".js")
    server = bind_free_port(HOST, PORT)
    port = server.server_address[1]
    if port != PORT:
        print(f"Port {PORT} is in use, using {port} instead")
    print(f"Madar dashboard running at http://{HOST}:{port}")
    print(f"SSH probe host={SSH_HOST}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping dashboard")
    finally:
        server.server_close()
