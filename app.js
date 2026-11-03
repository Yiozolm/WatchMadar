const state = { data: null, gpuFilter: "all", refreshMs: 10000, timer: null, activeView: "overview", inFlight: false };

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;", "'":"&#039;"}[ch]));

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

function renderStats() {
  const { cluster, storage } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  const intervalLabel = state.refreshMs > 0 ? `每 ${state.refreshMs / 1000} 秒刷新` : "自动刷新已暂停";

  $("#sidebarConnection")?.classList.toggle("disconnected", !isLive);
  $("#topRefreshState")?.classList.toggle("disconnected", !isLive);
  $("#clusterBadge")?.classList.toggle("disconnected", !isLive);
  $("#storageHealthState")?.classList.toggle("disconnected", !isLive);

  $("#collectorStatus").textContent = isLive ? "已连接" : "未连接";
  $("#collectorDetail").textContent = isLive ? `Slurm probe · ${intervalLabel}` : (cluster.data_error || "未能获取到服务器数据");
  $("#metricNote").textContent = isLive ? `Slurm GPU allocation · ${intervalLabel}` : "未连接";

  if (!isLive) {
    $("#gpuOnline").textContent = "—";
    $("#gpuTotal").textContent = "—";
    $("#gpuNavCount").textContent = "—";
    $("#gpuUtil").textContent = "—";
    $("#activeJobs").textContent = "—";
    $("#jobNavCount").textContent = "—";
    $("#queuedJobsFoot").textContent = "— queued";
    $("#gpuFootStatus").textContent = "未连接";
    $("#utilFootStatus").textContent = "未连接";
    $("#storageUsed").textContent = "—";
    $("#storagePercent").textContent = "—";
    $("#storageQuotaFoot").textContent = "of — TB quota";
    $("#storageTrack").style.width = "0%";
    $("#storageDonut").style.background = `conic-gradient(#233d4c 0 100%)`;
    $("#storageDonutValue").textContent = "—";
    $("#storageUsed2").textContent = "—";
    $("#storageTotal2").textContent = "— TB";
    $("#storageHealthState").innerHTML = "<i></i>未连接";
    $("#lastUpdated").textContent = "未连接";
    $("#uptime").textContent = "—";
    $("#clusterStatus").textContent = "未连接";
    $("#utilSpark").innerHTML = "";
    return;
  }

  $("#gpuOnline").textContent = cluster.gpu_online;
  $("#gpuTotal").textContent = cluster.gpu_total;
  $("#gpuNavCount").textContent = cluster.gpu_total;
  $("#gpuUtil").textContent = cluster.gpu_utilization;
  $("#activeJobs").textContent = cluster.active_jobs;
  $("#jobNavCount").textContent = cluster.active_jobs + cluster.queued_jobs;
  $("#queuedJobsFoot").textContent = `${cluster.queued_jobs} queued`;
  $("#gpuFootStatus").textContent = "在线";
  $("#utilFootStatus").textContent = "实时分配率";
  $("#storageUsed").textContent = storage.used_tb.toFixed(1);
  const pct = storage.quota_tb > 0 ? (storage.used_tb / storage.quota_tb) * 100 : 0;
  $("#storagePercent").textContent = `${pct.toFixed(1)}%`;
  $("#storageQuotaFoot").textContent = `of ${storage.quota_tb.toFixed(1)} TB quota`;
  $("#storageTrack").style.width = `${pct}%`;
  $("#storageDonut").style.background = `conic-gradient(var(--orange) 0 ${pct}%, #233d4c ${pct}% 100%)`;
  $("#storageDonutValue").textContent = `${pct.toFixed(1)}%`;
  $("#storageUsed2").textContent = storage.used_tb.toFixed(1);
  $("#storageTotal2").textContent = `${storage.quota_tb.toFixed(1)} TB`;
  $("#storageHealthState").innerHTML = "<i></i>空间健康";
  $("#lastUpdated").textContent = formatTime(cluster.last_updated);
  $("#uptime").textContent = cluster.uptime;
  $("#clusterStatus").textContent = cluster.status === "healthy" ? "运行正常" : "需关注";
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
  $("#gpuGrid").innerHTML = filtered.map((gpu) => {
    const memory = gpu.memory_used == null || gpu.memory_total == null ? "—" : `${gpu.memory_used}/${gpu.memory_total}G`;
    const temperature = gpu.temperature == null ? "—" : `${gpu.temperature}°`;
    return `<div class="gpu-tile" title="${escapeHtml(gpu.node)} / ${escapeHtml(gpu.model)}">
    <div class="tile-head"><span>${escapeHtml(gpu.id)}</span><i class="gpu-status ${gpu.status === "idle" ? "idle" : ""}"></i></div>
    <div class="gpu-util"><strong>${gpu.utilization}%</strong><span>${escapeHtml(gpu.util_label || "GPU UTIL")}</span></div>
    <div class="util-bar"><span class="${utilClass(gpu.utilization)}" style="width:${gpu.utilization}%"></span></div>
    <div class="gpu-meta"><span>MEM <b>${memory}</b></span><span><b>${temperature}</b></span></div>
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
    $("#usersList").innerHTML = `<div class="empty-state">未连接服务器，暂无用户目录数据</div>`;
    return;
  }
  const paths = state.data.storage.paths;
  $("#storagePaths").innerHTML = paths.map((item) => {
    const pct = Math.min((item.used_tb / item.quota_tb) * 100, 100);
    return `<div class="path-row"><span class="path-name">${escapeHtml(item.path)}</span><div class="path-track"><span style="width:${pct}%"></span></div><span class="path-value">${item.used_tb.toFixed(1)} TB</span></div>`;
  }).join("");
  const users = state.data.storage.users;
  const max = Math.max(...users.map((item) => item.quota_tb), 1);
  $("#usersList").innerHTML = users.map((item, index) => `<div class="user-row"><span class="user-rank">0${index + 1}</span><span class="user-avatar">${escapeHtml(item.user.slice(0, 1).toUpperCase())}</span><span class="user-name">${escapeHtml(item.user)}<div class="user-bar"><span style="width:${Math.min(item.used_tb / max * 100, 100)}%"></span></div></span><span class="user-amount">${item.used_tb.toFixed(2)} TB</span></div>`).join("");
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
  $("#jobsTable").innerHTML = state.data.jobs.map((job) => `<tr><td>${escapeHtml(job.name)}<span class="job-id">${escapeHtml(job.id)}</span></td><td class="owner">${escapeHtml(job.owner)}</td><td>${escapeHtml(job.partition)}</td><td>${job.gpus}</td><td>${escapeHtml(job.elapsed)}</td><td><span class="status-pill ${job.status === "PENDING" ? "pending" : ""}">${escapeHtml(job.status)}</span></td></tr>`).join("");
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
  const intervalLabel = state.refreshMs > 0 ? `每 ${state.refreshMs / 1000} 秒自动同步` : "已暂停自动刷新";
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
    $("#settingSshTimeout").value = cfg.ssh_timeout || 8;
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
