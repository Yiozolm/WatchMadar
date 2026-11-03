const state = { data: null, gpuFilter: "all", refreshMs: 60000, timer: null, activeView: "overview", inFlight: false };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#039;"}[ch]));

const REASON_LABELS = {
  Priority: "优先级排队",
  Resources: "等待资源",
  Dependency: "等待前置依赖",
  DependencyNeverSatisfied: "依赖无法满足",
  JobArrayTaskLimit: "数组并发限制",
  JobHeldUser: "用户挂起",
  JobHeldAdmin: "管理员挂起",
  ReqNodeNotAvail: "节点维护中",
  QOSMaxGRESPerUser: "GPU配额上限",
  QOSMaxJobsPerUserLimit: "任务数上限",
  AssocMaxJobsLimit: "账户任务上限",
};

function formatTime(iso) {
  if (!iso) return "刚刚更新";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return `更新于 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function utilClass(util) { return util >= 70 ? "" : util >= 30 ? "mid" : "low"; }

function renderSpark() {
  const values = [45, 53, 50, 68, 57, 71, 66, 77, 67, 79, 74, 83];
  const max = 90, min = 35;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / (max - min)) * 23}`).join(" ");
  $("#utilSpark").innerHTML = `<svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#5fa9ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${points} 100,30 0,30" fill="url(#sparkFill)" stroke="none" opacity=".25"/><defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5fa9ff"/><stop offset="1" stop-color="#5fa9ff" stop-opacity="0"/></linearGradient></defs></svg>`;
}

const DISCONNECTED_DATA = {
  cluster: {
    name: "Madar HPC",
    status: "disconnected",
    connected: false,
    data_source: "disconnected",
    data_error: "无法连接到采集服务",
    uptime: "—",
    last_updated: null,
    gpu_total: 0,
    gpu_online: 0,
    gpu_maintenance: 0,
    gpu_idle: 0,
    gpu_utilization: 0,
    active_jobs: 0,
    queued_jobs: 0,
    storage_used_tb: 0,
    storage_total_tb: 0,
  },
  gpus: [],
  jobs: [],
  storage: { quota_tb: 0, used_tb: 0, paths: [], users: [] },
};

const PIE_COLORS = ["#ffb46a", "#5fa9ff", "#ab88ff", "#38d6a1", "#f472b6", "#38bdf8"];

function formatSizeParts(gb) {
  const val = Number(gb) || 0;
  if (val >= 1000) return { number: (val / 1000).toFixed(2), unit: "TB" };
  if (val >= 1) return { number: val.toFixed(1), unit: "GB" };
  const mb = Math.max(val * 1000, 0);
  if (mb >= 10) return { number: mb.toFixed(0), unit: "MB" };
  if (mb >= 0.1) return { number: mb.toFixed(1), unit: "MB" };
  if (val > 0) return { number: Math.max(val * 1e6, 1).toFixed(0), unit: "KB" };
  return { number: "0", unit: "MB" };
}

function formatSizeText(gb) {
  const { number, unit } = formatSizeParts(gb);
  return `${number} ${unit}`;
}

function buildSubdirPieGradient(subdirs) {
  if (!subdirs || !subdirs.length) {
    return `conic-gradient(var(--track) 0 100%)`;
  }
  const totalShare = subdirs.reduce((sum, item) => sum + (Number(item.share_pct) || 0), 0);
  if (totalShare <= 0) {
    return `conic-gradient(var(--track) 0 100%)`;
  }
  let cursor = 0;
  const stops = subdirs.map((item, idx) => {
    const rawPct = (Number(item.share_pct) || 0) / totalShare * 100;
    const start = cursor;
    const end = idx === subdirs.length - 1 ? 100 : Math.min(cursor + rawPct, 100);
    cursor = end;
    const color = PIE_COLORS[idx % PIE_COLORS.length];
    return `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `conic-gradient(${stops.join(", ")})`;
}

function buildSubdirLinearGradient(subdirs) {
  if (!subdirs || !subdirs.length) return "";
  const totalShare = subdirs.reduce((sum, item) => sum + (Number(item.share_pct) || 0), 0);
  if (totalShare <= 0) return "";
  let cursor = 0;
  const stops = subdirs.map((item, idx) => {
    const rawPct = (Number(item.share_pct) || 0) / totalShare * 100;
    const start = cursor;
    const end = idx === subdirs.length - 1 ? 100 : Math.min(cursor + rawPct, 100);
    cursor = end;
    const color = PIE_COLORS[idx % PIE_COLORS.length];
    return `${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}

function formatIntervalLabel(ms) {
  if (!ms || ms <= 0) return "自动刷新已暂停";
  if (ms >= 60000 && ms % 60000 === 0) return `每 ${ms / 60000} 分钟刷新`;
  return `每 ${ms / 1000} 秒刷新`;
}

function renderStats() {
  const { cluster, storage } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  const intervalLabel = formatIntervalLabel(state.refreshMs);

  $("#sidebarConnection")?.classList.toggle("disconnected", !isLive);
  $("#topRefreshState")?.classList.toggle("disconnected", !isLive);
  $("#clusterBadge")?.classList.toggle("disconnected", !isLive);
  $("#storageHealthState")?.classList.toggle("disconnected", !isLive);

  $("#collectorStatus").textContent = isLive ? "已连接" : "未连接";
  $("#collectorDetail").textContent = isLive ? `Slurm probe · ${intervalLabel}` : (cluster.data_error || "未能获取到服务器数据");
  $("#metricNote").textContent = isLive ? `Slurm GPU allocation · ${intervalLabel}` : "未连接";

  if (!isLive) {
    $("#greetingUser").textContent = "User";
    $("#sidebarUser").textContent = "SSH User";
    $("#sidebarHome").textContent = "未连接";
    $("#sidebarAvatar").textContent = "U";
    $("#gpuOnline").textContent = "—";
    $("#gpuTotal").textContent = "—";
    $("#gpuNavCount").textContent = "—";
    $("#gpuUtil").textContent = "—";
    $("#activeJobs").textContent = "—";
    $("#jobNavCount").textContent = "—";
    $("#queuedJobsFoot").textContent = "— queued";
    $("#gpuFootStatus").textContent = "未连接";
    $("#gpuFootStatus").className = "trend up";
    $("#utilFootStatus").textContent = "未连接";
    $("#storageUsed").textContent = "—";
    $("#storageUnit").textContent = " GB";
    $("#storagePercent").textContent = "—";
    $("#storageQuotaFoot").textContent = "SSH 主目录";
    $("#storageTrack").style.width = "0%";
    $("#storageTrack").style.background = "";
    $("#storageDonut").style.background = `conic-gradient(var(--track) 0 100%)`;
    $("#storageDonutValue").textContent = "—";
    $("#storageDonutLabel").textContent = "目录构成";
    $("#storageUsed2").textContent = "—";
    $("#storageUnit2").textContent = "GB";
    $("#storageTotal2").textContent = "未连接";
    $("#storageHomeFoot").innerHTML = "主目录 <b>—</b>";
    $("#storageHealthState").innerHTML = "<i></i>未连接";
    $("#lastUpdated").textContent = "未连接";
    $("#uptime").textContent = "—";
    $("#clusterStatus").textContent = "未连接";
    $("#utilSpark").innerHTML = "";
    return;
  }

  const sshUser = storage.user || "user";
  const homePath = storage.home_path || `/home/${sshUser}`;
  $("#greetingUser").textContent = sshUser;
  $("#sidebarUser").textContent = sshUser;
  $("#sidebarHome").textContent = homePath;
  $("#sidebarAvatar").textContent = sshUser.slice(0, 1).toUpperCase();

  const maintCount = Number(cluster.gpu_maintenance) || 0;
  const idleCount = Number(cluster.gpu_idle) || 0;

  $("#gpuOnline").textContent = cluster.gpu_online;
  $("#gpuTotal").textContent = cluster.gpu_total;
  $("#gpuNavCount").textContent = cluster.gpu_total;
  $("#gpuUtil").textContent = cluster.gpu_utilization;
  $("#activeJobs").textContent = cluster.active_jobs;
  $("#jobNavCount").textContent = cluster.active_jobs + cluster.queued_jobs;
  $("#queuedJobsFoot").textContent = `${cluster.queued_jobs} queued`;

  const gpuFoot = $("#gpuFootStatus");
  if (maintCount > 0) {
    gpuFoot.textContent = `${maintCount} 张维护/排空中`;
    gpuFoot.className = "trend warn";
  } else {
    gpuFoot.textContent = "全部在线";
    gpuFoot.className = "trend up";
  }

  const utilFoot = $("#utilFootStatus");
  if (idleCount === 0 && maintCount > 0) {
    utilFoot.textContent = "可用卡 100% 满载 (0 空闲)";
  } else {
    utilFoot.textContent = `空闲 ${idleCount} 张 · 实时分配率`;
  }

  const homeUsedGb = storage.home_used_gb ?? (storage.used_tb * 1000);
  const subdirs = storage.subdirs || [];
  const isInitialScan = Boolean(storage.scanning && homeUsedGb === 0 && !subdirs.length);
  const homeSize = formatSizeParts(homeUsedGb);
  const topSub = subdirs[0] || null;

  $("#storageUsed").textContent = isInitialScan ? "扫描中" : homeSize.number;
  $("#storageUnit").textContent = isInitialScan ? "" : ` ${homeSize.unit}`;
  $("#storagePercent").textContent = homePath;
  $("#storageQuotaFoot").textContent = topSub ? `最大项 ${topSub.name} (${topSub.share_pct}%)` : (storage.scanning ? "统计目录中…" : "SSH 主目录");
  $("#storageTrack").style.width = subdirs.length ? "100%" : (homeUsedGb > 0 ? "100%" : "0%");
  $("#storageTrack").style.background = buildSubdirLinearGradient(subdirs);

  $("#storageDonut").style.background = buildSubdirPieGradient(subdirs);
  $("#storageDonutValue").textContent = isInitialScan ? "…" : (topSub ? `${Number(topSub.share_pct).toFixed(0)}%` : "0%");
  $("#storageDonutLabel").textContent = topSub ? topSub.name : "目录构成";
  $("#storageUsed2").textContent = isInitialScan ? "扫描中" : homeSize.number;
  $("#storageUnit2").textContent = isInitialScan ? "" : homeSize.unit;
  if (subdirs.length) {
    $("#storageTotal2").innerHTML = subdirs.slice(0, 4).map((item, idx) => {
      const color = PIE_COLORS[idx % PIE_COLORS.length];
      return `<span class="pie-legend-item" title="${escapeHtml(item.name)}: ${item.share_pct}%"><i style="background:${color}"></i><b>${escapeHtml(item.name)}</b><em>${item.share_pct}%</em></span>`;
    }).join("");
  } else {
    $("#storageTotal2").textContent = storage.scanning ? "正在统计用户目录各子项占比…" : "主目录暂无子目录数据";
  }
  $("#storageHomeFoot").innerHTML = `主目录 <b>${escapeHtml(homePath)}</b>`;
  $("#storageHealthState").innerHTML = storage.scanning ? "<i></i>后台统计目录中…" : "<i></i>用户目录正常";
  $("#lastUpdated").textContent = formatTime(cluster.last_updated);
  $("#uptime").textContent = cluster.uptime;
  $("#clusterStatus").textContent = maintCount > 0 ? `运行正常 (${maintCount}卡维护)` : cluster.status === "healthy" ? "运行正常" : "需关注";
  renderSpark();
}

function renderGpus() {
  const isLive = Boolean(state.data.cluster.connected && state.data.cluster.data_source === "ssh");
  if (!isLive) {
    $("#gpuGrid").innerHTML = `<div class="empty-state">未连接服务器，暂无 GPU 节点数据</div>`;
    $("#gpuShown").textContent = 0;
    $("#gpuCount").textContent = 0;
    return;
  }
  const all = state.data.gpus;
  const filtered = all.filter((gpu) => state.gpuFilter === "all" || gpu.status === state.gpuFilter);
  if (!filtered.length) {
    const emptyLabel = state.gpuFilter === "maintenance" ? "当前没有处于维护或排空状态的 GPU" : state.gpuFilter === "idle" ? "当前所有可用 GPU 均已满载，无空闲卡" : "无匹配的 GPU 节点";
    $("#gpuGrid").innerHTML = `<div class="empty-state">${emptyLabel}</div>`;
    $("#gpuShown").textContent = 0;
    $("#gpuCount").textContent = state.data.cluster.gpu_total;
    return;
  }
  $("#gpuGrid").innerHTML = filtered.map((gpu) => {
    const memory = gpu.memory_used == null || gpu.memory_total == null ? "—" : `${gpu.memory_used}/${gpu.memory_total}G`;
    const rightMeta = gpu.temperature != null ? `<b>${gpu.temperature}°</b>` : gpu.node_state ? `STATE <b>${escapeHtml(gpu.node_state)}</b>` : "<b>—</b>";
    const isMaint = gpu.status === "maintenance";
    const isDown = gpu.substatus === "down";
    const isBusyDrain = gpu.status === "busy" && (gpu.substatus === "drain" || gpu.substatus === "down" || gpu.substatus === "reserved");
    const tileClass = isMaint ? (isDown ? "down" : "maintenance") : isBusyDrain ? "busy-drain" : "";
    const dotClass = gpu.status === "idle" ? "idle" : isMaint ? (isDown ? "down" : "maintenance") : isBusyDrain ? "busy-drain" : "";
    const utilDisplay = gpu.util_display ?? `${gpu.utilization}%`;
    const barHtml = isMaint
      ? `<span class="maint ${isDown ? "down" : ""}" style="width:100%"></span>`
      : `<span class="${utilClass(gpu.utilization)}" style="width:${gpu.utilization}%"></span>`;
    const tooltipParts = [`${gpu.node} / ${gpu.model}`];
    if (gpu.node_state) tooltipParts.push(`节点状态: ${gpu.node_state}`);
    if (gpu.node_reason) tooltipParts.push(`原因: ${gpu.node_reason}`);
    return `<div class="gpu-tile ${tileClass}" title="${escapeHtml(tooltipParts.join(" · "))}">
    <div class="tile-head"><span>${escapeHtml(gpu.id)}</span><i class="gpu-status ${dotClass}"></i></div>
    <div class="gpu-util"><strong>${escapeHtml(utilDisplay)}</strong><span>${escapeHtml(gpu.util_label || "GPU UTIL")}</span></div>
    <div class="util-bar">${barHtml}</div>
    <div class="gpu-meta"><span>MEM <b>${memory}</b></span><span>${rightMeta}</span></div>
    <div class="gpu-process"><strong>${escapeHtml(gpu.process)}</strong>${gpu.owner ? ` · ${escapeHtml(gpu.owner)}` : ""}</div>
  </div>`;
  }).join("");
  $("#gpuShown").textContent = filtered.length;
  $("#gpuCount").textContent = state.data.cluster.gpu_total;
}

function renderStorage() {
  const isLive = Boolean(state.data.cluster.connected && state.data.cluster.data_source === "ssh");
  if (!isLive) {
    $("#storagePaths").innerHTML = `<div class="empty-state">未连接服务器，暂无目录空间数据</div>`;
    $("#usersList").innerHTML = `<div class="empty-state">未连接服务器，暂无主目录明细</div>`;
    return;
  }
  const subdirs = state.data.storage.subdirs || [];
  const paths = state.data.storage.paths || [];
  if (!paths.length) {
    const emptyMsg = state.data.storage.scanning ? "正在后台统计用户目录各文件夹占比…" : "主目录为空或暂无子目录数据";
    $("#storagePaths").innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
  } else {
    $("#storagePaths").innerHTML = paths.map((item, idx) => {
      const usedGb = item.used_gb ?? (item.used_tb * 1000);
      const pct = Number(item.pct ?? 0);
      const color = PIE_COLORS[idx % PIE_COLORS.length];
      return `<div class="path-row" title="${escapeHtml(item.path)} (${pct}%)"><span class="path-name"><i class="path-dot" style="background:${color}"></i>${escapeHtml(item.path)}</span><div class="path-track"><span style="width:${Math.max(pct, usedGb > 0 ? 2 : 0)}%;background:${color}"></span></div><span class="path-value">${escapeHtml(formatSizeText(usedGb))}</span></div>`;
    }).join("");
  }

  if (!subdirs.length) {
    const msg = state.data.storage.scanning ? "正在后台统计主目录各文件夹大小…" : "主目录为空或暂无子目录明细";
    $("#usersList").innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }
  $("#usersList").innerHTML = subdirs.map((item, index) => {
    const icon = item.name.startsWith(".") ? "⚙" : item.name.startsWith("~") || item.name === "其他" ? "📄" : "📁";
    const sizeLabel = formatSizeText(item.used_gb ?? (item.used_mb / 1000));
    const color = PIE_COLORS[index % PIE_COLORS.length];
    return `<div class="user-row" title="${escapeHtml(item.name)} (${item.share_pct}%)">
      <span class="user-rank">${String(index + 1).padStart(2, "0")}</span>
      <span class="user-avatar">${icon}</span>
      <span class="user-name">${escapeHtml(item.name)}<div class="user-bar"><span style="width:${Math.max(item.share_pct, 2)}%;background:${color}"></span></div></span>
      <span class="user-amount">${escapeHtml(sizeLabel)}</span>
    </div>`;
  }).join("");
}

function renderJobs() {
  const isLive = Boolean(state.data.cluster.connected && state.data.cluster.data_source === "ssh");
  if (!isLive) {
    $("#jobsTable").innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted-2);padding:24px 8px;">未连接服务器，暂无任务队列数据</td></tr>`;
    return;
  }
  if (!state.data.jobs.length) {
    $("#jobsTable").innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted-2);padding:24px 8px;">当前无运行或排队中的任务</td></tr>`;
    return;
  }
  $("#jobsTable").innerHTML = state.data.jobs.map((job) => {
    const isPending = job.status === "PENDING";
    const reasonText = isPending && job.reason ? (REASON_LABELS[job.reason] || job.reason) : "";
    const statusLabel = reasonText ? `PENDING · ${reasonText}` : job.status;
    const statusTitle = isPending && job.reason ? `排队原因: ${job.reason}` : job.node ? `运行节点: ${job.node}` : "";
    return `<tr><td>${escapeHtml(job.name)}<span class="job-id">${escapeHtml(job.id)}</span></td><td class="owner">${escapeHtml(job.owner)}</td><td>${escapeHtml(job.partition)}</td><td>${job.gpus}</td><td>${escapeHtml(job.elapsed)}</td><td><span class="status-pill ${isPending ? "pending" : ""}" title="${escapeHtml(statusTitle)}">${escapeHtml(statusLabel)}</span></td></tr>`;
  }).join("");
}

function renderSettingsDiag() {
  if (!state.data) return;
  const { cluster } = state.data;
  const badge = $("#settingsModeBadge");
  const diag = $("#settingsDiag");
  if (!badge || !diag) return;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  badge.textContent = isLive ? "已连接" : "未连接";
  badge.classList.toggle("pending", !isLive);
  const intervalLabel = formatIntervalLabel(state.refreshMs);
  if (isLive) {
    diag.textContent = `当前状态：SSH 实时采集正常 · ${intervalLabel}`;
  } else {
    diag.textContent = `当前状态：未连接 · 原因：${cluster.data_error || "未能获取到服务器端数据"}`;
  }
}

function render() { renderStats(); renderGpus(); renderStorage(); renderJobs(); renderSettingsDiag(); }

async function fetchMetrics(showToast = false, force = false) {
  if (state.inFlight && !showToast) return;
  state.inFlight = true;
  try {
    const url = `/api/metrics?_=${Date.now()}${force ? "&force=1" : ""}`;
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    render();
    if (state.data.storage?.scanning) {
      clearTimeout(fetchMetrics.scanTimer);
      fetchMetrics.scanTimer = setTimeout(() => fetchMetrics(false, false), 3500);
    }
    if (showToast) {
      const isLive = Boolean(state.data.cluster?.connected);
      showToastMessage(isLive ? "数据已刷新" : "未连接到集群服务器", !isLive);
    }
  } catch (error) {
    console.error(error);
    state.data = {
      ...DISCONNECTED_DATA,
      cluster: { ...DISCONNECTED_DATA.cluster, data_error: `无法连接本地采集服务 (${error.message})` },
    };
    render();
    if (showToast) showToastMessage("未连接：请检查采集服务是否运行", true);
  } finally {
    state.inFlight = false;
  }
}

async function fetchSettings() {
  try {
    const response = await fetch(`/api/settings?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) return;
    const cfg = await response.json();
    $("#settingSshHost").value = cfg.ssh_host || "madar";
    $("#settingSshUser").value = cfg.ssh_user || "";
    $("#settingSshPort").value = cfg.ssh_port || "";
    $("#settingSshTimeout").value = cfg.ssh_timeout || 20;
  } catch (error) {
    console.error(error);
  }
}

function updateRefreshTimer(ms) {
  state.refreshMs = ms;
  clearInterval(state.timer);
  state.timer = ms > 0 ? setInterval(() => fetchMetrics(false), ms) : null;
  const footerLabel = $("#footerRefreshLabel");
  if (footerLabel) footerLabel.textContent = ms > 0 ? `${ms / 1000}s` : "off";
  renderSettingsDiag();
}

async function saveSettings(event) {
  event.preventDefault();
  const refreshMs = Number($("#settingRefreshMs").value);
  updateRefreshTimer(refreshMs);
  const payload = {
    ssh_host: $("#settingSshHost").value.trim() || "madar",
    ssh_user: $("#settingSshUser").value.trim(),
    ssh_port: $("#settingSshPort").value.trim(),
    ssh_timeout: Number($("#settingSshTimeout").value) || 8,
  };
  try {
    const response = await fetch("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    showToastMessage("采集设置已保存，正在重新连接…");
    await fetchMetrics(true, true);
  } catch (error) {
    console.error(error);
    showToastMessage("保存采集设置失败", true);
  }
}

function showToastMessage(message, isError = false) { const toast = $("#toast"); toast.textContent = message; toast.classList.toggle("error", isError); toast.classList.add("show"); clearTimeout(showToastMessage.timer); showToastMessage.timer = setTimeout(() => toast.classList.remove("show"), 2200); }

function setView(view) {
  state.activeView = view;
  const titles = { overview: "总览", gpu: "GPU 节点", storage: "存储空间", jobs: "任务队列", settings: "采集设置" };
  $("#pageTitle").textContent = titles[view] || "总览";
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const target = view === "overview" ? $("#overviewStats") : view === "gpu" ? $("#gpuSection") : view === "storage" ? $("#storageSection") : view === "jobs" ? $("#jobsSection") : view === "settings" ? $("#settingsSection") : null;
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    const panel = target.classList.contains("panel") ? target : target.querySelector(".panel");
    if (panel) {
      panel.classList.add("highlight-pulse");
      setTimeout(() => panel.classList.remove("highlight-pulse"), 1200);
    }
  }
  if (view === "settings") fetchSettings();
}

function bindEvents() {
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("#gpuFilter button").forEach((button) => button.addEventListener("click", () => { $$("#gpuFilter button").forEach((item) => item.classList.remove("selected")); button.classList.add("selected"); state.gpuFilter = button.dataset.filter; renderGpus(); }));
  $("#refreshButton").addEventListener("click", () => fetchMetrics(true, true));
  $("#themeButton").addEventListener("click", () => { document.body.classList.toggle("light"); showToastMessage(document.body.classList.contains("light") ? "已切换到浅色主题" : "已切换到深色主题"); });
  $("#settingsForm").addEventListener("submit", saveSettings);
  $("#testProbeButton").addEventListener("click", () => fetchMetrics(true, true));
}

bindEvents();
fetchSettings();
fetchMetrics();
state.timer = setInterval(() => fetchMetrics(false), state.refreshMs);
