const state = { data: null, gpuFilter: "all", refreshMs: 10000, timer: null, activeView: "overview" };

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

function renderStats() {
  const { cluster, storage } = state.data;
  const isLive = cluster.data_source === "ssh";
  const isDemo = cluster.data_source === "demo";
  $("#collectorStatus").textContent = isLive ? "SSH online" : isDemo ? "Demo snapshot" : "SSH fallback";
  $("#collectorDetail").textContent = isLive ? "Slurm probe · 每 10 秒刷新" : isDemo ? "sample_metrics.json · 每 10 秒刷新" : (cluster.data_error || "sample_metrics.json · 每 10 秒刷新");
  $("#metricNote").textContent = isLive ? "Slurm GPU allocation · 每 10 秒刷新" : "每 10 秒自动刷新";
  $("#gpuOnline").textContent = cluster.gpu_online;
  $("#gpuTotal").textContent = cluster.gpu_total;
  $("#gpuNavCount").textContent = cluster.gpu_total;
  $("#gpuUtil").textContent = cluster.gpu_utilization;
  $("#activeJobs").textContent = cluster.active_jobs;
  $("#jobNavCount").textContent = cluster.active_jobs + cluster.queued_jobs;
  $("#storageUsed").textContent = storage.used_tb.toFixed(1);
  const pct = (storage.used_tb / storage.quota_tb) * 100;
  $("#storagePercent").textContent = `${pct.toFixed(1)}%`;
  $("#storageTrack").style.width = `${pct}%`;
  $("#storageDonut").style.background = `conic-gradient(var(--orange) 0 ${pct}%, #233d4c ${pct}% 100%)`;
  $("#storageDonutValue").textContent = `${pct.toFixed(1)}%`;
  $("#storageUsed2").textContent = storage.used_tb.toFixed(1);
  $("#storageTotal2").textContent = `${storage.quota_tb.toFixed(1)} TB`;
  $("#lastUpdated").textContent = formatTime(cluster.last_updated);
  $("#uptime").textContent = cluster.uptime;
  $("#clusterStatus").textContent = cluster.status === "healthy" ? "运行正常" : "需关注";
  renderSpark();
}

function renderGpus() {
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
  const paths = state.data.storage.paths;
  $("#storagePaths").innerHTML = paths.map((item) => {
    const pct = Math.min((item.used_tb / item.quota_tb) * 100, 100);
    return `<div class="path-row"><span class="path-name">${escapeHtml(item.path)}</span><div class="path-track"><span style="width:${pct}%"></span></div><span class="path-value">${item.used_tb.toFixed(1)} TB</span></div>`;
  }).join("");
  const users = state.data.storage.users;
  const max = Math.max(...users.map((item) => item.quota_tb));
  $("#usersList").innerHTML = users.map((item, index) => `<div class="user-row"><span class="user-rank">0${index + 1}</span><span class="user-avatar">${escapeHtml(item.user.slice(0, 1).toUpperCase())}</span><span class="user-name">${escapeHtml(item.user)}<div class="user-bar"><span style="width:${Math.min(item.used_tb / max * 100, 100)}%"></span></div></span><span class="user-amount">${item.used_tb.toFixed(2)} TB</span></div>`).join("");
}

function renderJobs() {
  $("#jobsTable").innerHTML = state.data.jobs.map((job) => `<tr><td>${escapeHtml(job.name)}<span class="job-id">${escapeHtml(job.id)}</span></td><td class="owner">${escapeHtml(job.owner)}</td><td>${escapeHtml(job.partition)}</td><td>${job.gpus}</td><td>${escapeHtml(job.elapsed)}</td><td><span class="status-pill ${job.status === "PENDING" ? "pending" : ""}">${escapeHtml(job.status)}</span></td></tr>`).join("");
}

function render() { renderStats(); renderGpus(); renderStorage(); renderJobs(); }

async function fetchMetrics(showToast = false) {
  try {
    const response = await fetch(`/api/metrics?_=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    state.data = await response.json();
    render();
    if (showToast) showToastMessage("数据已刷新");
  } catch (error) {
    console.error(error);
    if (showToast) showToastMessage("刷新失败，请检查采集服务", true);
  }
}

function showToastMessage(message, isError = false) { const toast = $("#toast"); toast.textContent = message; toast.classList.toggle("error", isError); toast.classList.add("show"); clearTimeout(showToastMessage.timer); showToastMessage.timer = setTimeout(() => toast.classList.remove("show"), 2200); }

function setView(view) {
  state.activeView = view;
  const titles = { overview: "总览", gpu: "GPU 节点", storage: "存储空间", jobs: "任务队列", settings: "采集设置" };
  $("#pageTitle").textContent = titles[view] || "总览";
  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === view));
  const target = view === "gpu" ? $("#gpuSection") : view === "storage" ? $("#storageSection") : view === "jobs" ? $("#jobsSection") : null;
  if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (view === "settings") showToastMessage("采集设置：GPU 数据每 10 秒自动同步");
}

function bindEvents() {
  $$("[data-view]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.view)));
  $$("#gpuFilter button").forEach((button) => button.addEventListener("click", () => { $$("#gpuFilter button").forEach((item) => item.classList.remove("selected")); button.classList.add("selected"); state.gpuFilter = button.dataset.filter; renderGpus(); }));
  $("#refreshButton").addEventListener("click", () => fetchMetrics(true));
  $("#themeButton").addEventListener("click", () => { document.body.classList.toggle("light"); showToastMessage(document.body.classList.contains("light") ? "已切换到浅色主题" : "已切换到深色主题"); });
}

bindEvents();
fetchMetrics();
state.timer = setInterval(() => fetchMetrics(false), state.refreshMs);
