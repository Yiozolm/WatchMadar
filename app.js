const state = {
  data: null,
  gpuFilter: "all",
  selectedNode: "all",
  jobFilter: "all",
  selectedMember: "all",
  jobSearch: "",
  ladderFilter: "all",
  ladderMode: "groups",
  acctFilter: "active",
  simFairsharePts: null,
  simAgeHours: 0,
  simSelectedAcct: "",
  refreshMs: 60000,
  timer: null,
  activeView: "overview",
  inFlight: false,
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));

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

const VIEW_META = {
  overview: {
    title: "总览",
    eyebrow: "MADAR HPC / RESOURCE MONITOR",
    headingHtml: (user) => `你好，<span id="greetingUser">${escapeHtml(user)}</span> <small>✦</small>`,
    subtitle: "一眼掌握集群算力与 SSH 用户目录空间的整体实时状态。",
  },
  gpu: {
    title: "GPU 节点",
    eyebrow: "COMPUTE / GPU NODES & ALLOCATION",
    headingHtml: () => `GPU 节点与单卡使用详情`,
    subtitle: "查看各计算节点负载、单卡 Slurm 分配状态、运行作业及维护信息。",
  },
  storage: {
    title: "存储空间",
    eyebrow: "SSH USER / HOME DIRECTORY STORAGE",
    headingHtml: () => `用户目录空间明细`,
    subtitle: "查看 SSH 主目录 50 GB 配额分布、Top 10 子目录体积排行及底层存储卷状态。",
  },
  jobs: {
    title: "任务队列",
    eyebrow: "SCHEDULER / SLURM QUEUE",
    headingHtml: () => `Slurm 任务队列`,
    subtitle: "实时追踪集群运行中与排队中的 GPU 及交互式计算任务，并查看各作业的优先级构成。",
  },
  priority: {
    title: "优先级规则",
    eyebrow: "SLURM MULTIFACTOR / PRIORITY & FAIRSHARE",
    headingHtml: () => `调度优先级规则与排队透视`,
    subtitle: "可视化解析远端 HPC 的多因子优先级公式 (FairShare + Partition + Age)、个人账户对比及实时排队阶梯。",
  },
  settings: {
    title: "采集设置",
    eyebrow: "COLLECTOR / SSH CONFIGURATION",
    headingHtml: () => `数据采集设置`,
    subtitle: "配置 SSH 连接主机、超时参数与自动轮询刷新策略。",
  },
};

function formatTime(iso) {
  if (!iso) return "刚刚更新";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "刚刚更新";
  return `更新于 ${date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
}

function utilClass(util) {
  return util >= 70 ? "" : util >= 30 ? "mid" : "low";
}

function renderSpark() {
  const el = $("#utilSpark");
  if (!el) return;
  const values = [45, 53, 50, 68, 57, 71, 66, 77, 67, 79, 74, 83];
  const max = 90,
    min = 35;
  const points = values.map((v, i) => `${(i / (values.length - 1)) * 100},${28 - ((v - min) / (max - min)) * 23}`).join(" ");
  el.innerHTML = `<svg viewBox="0 0 100 30" preserveAspectRatio="none"><polyline points="${points}" fill="none" stroke="#5fa9ff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><polyline points="${points} 100,30 0,30" fill="url(#sparkFill)" stroke="none" opacity=".25"/><defs><linearGradient id="sparkFill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#5fa9ff"/><stop offset="1" stop-color="#5fa9ff" stop-opacity="0"/></linearGradient></defs></svg>`;
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
    gpu_allocated: 0,
    gpu_maintenance: 0,
    gpu_restricted: 0,
    gpu_idle: 0,
    gpu_utilization: 0,
    active_jobs: 0,
    queued_jobs: 0,
    storage_used_tb: 0,
    storage_total_tb: 0,
  },
  nodes: [],
  gpus: [],
  jobs: [],
  storage: { quota_tb: 0, used_tb: 0, paths: [], subdirs: [], users: [] },
  priority: { config: {}, summary: {}, user_accounts: [], accounts: [], queue_groups: [] },
};

const PIE_COLORS = ["#ffb46a", "#5fa9ff", "#ab88ff", "#38d6a1", "#f472b6", "#38bdf8"];
const HOME_QUOTA_GB = 50;

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

function buildOverallDonutGradient(usedGb, quotaGb = HOME_QUOTA_GB) {
  const capGb = Math.max(Number(quotaGb) || HOME_QUOTA_GB, 0.1);
  const pct = Math.min(Math.max(((Number(usedGb) || 0) / capGb) * 100, 0), 100);
  if (pct <= 0) return `conic-gradient(var(--track) 0 100%)`;
  const color = pct >= 85 ? "var(--danger)" : pct >= 65 ? "var(--orange)" : "var(--green)";
  return `conic-gradient(${color} 0 ${pct.toFixed(2)}%, var(--track) ${pct.toFixed(2)}% 100%)`;
}

function buildSubdirPieGradient(items, quotaGb = HOME_QUOTA_GB, totalUsedGb = 0) {
  const capGb = Math.max(Number(quotaGb) || HOME_QUOTA_GB, 0.1);
  if (!items || !items.length) {
    const fallbackPct = Math.min(Math.max(((Number(totalUsedGb) || 0) / capGb) * 100, 0), 100);
    return `conic-gradient(var(--orange) 0 ${fallbackPct.toFixed(2)}%, var(--track) ${fallbackPct.toFixed(2)}% 100%)`;
  }
  let cursor = 0;
  const stops = [];
  items.forEach((item, idx) => {
    const usedGb = Number(item.used_gb ?? (item.used_mb ? item.used_mb / 1000 : 0)) || 0;
    const rawPct = (usedGb / capGb) * 100;
    if (rawPct <= 0) return;
    const start = cursor;
    const end = Math.min(cursor + rawPct, 100);
    cursor = end;
    const color = PIE_COLORS[idx % PIE_COLORS.length];
    stops.push(`${color} ${start.toFixed(2)}% ${end.toFixed(2)}%`);
  });
  if (!stops.length) {
    return `conic-gradient(var(--track) 0 100%)`;
  }
  if (cursor < 100) {
    stops.push(`var(--track) ${cursor.toFixed(2)}% 100%`);
  }
  return `conic-gradient(${stops.join(", ")})`;
}

function formatIntervalLabel(ms) {
  if (!ms || ms <= 0) return "自动刷新已暂停";
  if (ms >= 60000 && ms % 60000 === 0) return `每 ${ms / 60000} 分钟刷新`;
  return `每 ${ms / 1000} 秒刷新`;
}

function getNodesList() {
  if (state.data?.nodes?.length) return state.data.nodes;
  const gpus = state.data?.gpus || [];
  const map = new Map();
  gpus.forEach((gpu) => {
    if (!map.has(gpu.node)) {
      map.set(gpu.node, {
        name: gpu.node,
        model: gpu.model || "GPU",
        total: 0,
        allocated: 0,
        state: gpu.node_state || "IDLE",
        partitions: [],
        mode: gpu.status === "maintenance" ? gpu.substatus || "drain" : "normal",
        reason: gpu.node_reason || "",
      });
    }
    const entry = map.get(gpu.node);
    entry.total += 1;
    if (gpu.status === "busy") entry.allocated += 1;
  });
  return [...map.values()];
}

function getNodeBadgeInfo(node) {
  const mode = node.mode || "normal";
  if (mode === "down") return { cls: "down", label: "离线 DOWN" };
  if (mode === "drain" || mode === "reserved") return { cls: "maint", label: node.allocated > 0 ? "排空中 DRAIN" : "维护中 MAINT" };
  if (mode === "restricted") return { cls: "restricted", label: "受限 ADMIN" };
  if (node.allocated >= node.total && node.total > 0) return { cls: "online", label: "满载 FULL" };
  if (node.allocated > 0) return { cls: "online", label: "运行中 MIXED" };
  return { cls: "idle", label: "空闲 IDLE" };
}

function updatePageHeader() {
  const meta = VIEW_META[state.activeView] || VIEW_META.overview;
  const isLive = Boolean(state.data?.cluster?.connected && state.data?.cluster?.data_source === "ssh");
  const sshUser = isLive ? state.data?.storage?.user || "user" : "User";
  $("#pageTitle").textContent = meta.title;
  $("#pageEyebrow").textContent = meta.eyebrow;
  $("#pageHeading").innerHTML = meta.headingHtml(sshUser);
  $("#pageSubtitle").textContent = meta.subtitle;
}

function renderStatsAndOverview() {
  const { cluster, storage, gpus = [] } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  const intervalLabel = formatIntervalLabel(state.refreshMs);

  $("#sidebarConnection")?.classList.toggle("disconnected", !isLive);
  $("#topRefreshState")?.classList.toggle("disconnected", !isLive);
  $("#clusterBadge")?.classList.toggle("disconnected", !isLive);
  $("#storageHealthState")?.classList.toggle("disconnected", !isLive);
  $("#storageDetailHealth")?.classList.toggle("disconnected", !isLive);

  $("#collectorStatus").textContent = isLive ? "已连接" : "未连接";
  $("#collectorDetail").textContent = isLive ? `Slurm probe · ${intervalLabel}` : cluster.data_error || "未能获取到服务器数据";
  $("#metricNote").textContent = isLive ? `Slurm GPU allocation · ${intervalLabel}` : "未连接";
  $("#gpuPageMetricNote").textContent = isLive ? `Slurm GPU allocation · ${intervalLabel}` : "未连接";

  updatePageHeader();

  if (!isLive) {
    $("#sidebarUser").textContent = "SSH User";
    $("#sidebarHome").textContent = "未连接";
    $("#sidebarAvatar").textContent = "U";
    $("#gpuOnline").textContent = "—";
    $("#gpuTotal").textContent = "—";
    $("#gpuNavCount").textContent = "—";
    $("#storageNavCount").textContent = "—";
    $("#gpuUtil").textContent = "—";
    $("#activeJobs").textContent = "—";
    $("#jobNavCount").textContent = "—";
    $("#priorityNavBadge").textContent = "—";
    $("#queuedJobsFoot").textContent = "— queued";
    $("#gpuFootStatus").textContent = "未连接";
    $("#gpuFootStatus").className = "trend up";
    $("#utilFootStatus").textContent = "未连接";
    $("#storageUsed").textContent = "—";
    $("#storageUnit").textContent = " GB";
    $("#storagePercent").textContent = "—";
    $("#storageQuotaFoot").textContent = "配额 50 GB →";
    $("#storageTrack").style.width = "0%";
    $("#storageTrack").style.background = "";
    $("#storageDonut").style.background = `conic-gradient(var(--track) 0 100%)`;
    $("#storageDonutValue").textContent = "—";
    $("#storageDonutLabel").textContent = "共 50 GB";
    $("#storageUsed2").textContent = "—";
    $("#storageUnit2").textContent = "GB";
    $("#storageTotal2").textContent = "总配额 50 GB";
    $("#storageHomeFoot").innerHTML = "主目录 <b>—</b>";
    $("#storageHealthState").innerHTML = "<i></i>未连接";
    $("#lastUpdated").textContent = "未连接";
    $("#uptime").textContent = "—";
    $("#clusterStatus").textContent = "未连接";
    $("#utilSpark").innerHTML = "";

    // Overview GPU reset
    $("#ovGpuAllocRatio").textContent = "— / — 已分配";
    $$("#ovGpuStackBar .stack-seg").forEach((el) => (el.style.width = "0%"));
    $("#ovLegendBusy").textContent = "0";
    $("#ovLegendIdle").textContent = "0";
    $("#ovLegendMaint").textContent = "0";
    $("#ovLegendRestricted").textContent = "0";
    $("#ovGpuBusy").textContent = "—";
    $("#ovGpuBusySub").textContent = "未连接";
    $("#ovGpuIdle").textContent = "—";
    $("#ovGpuIdleSub").textContent = "未连接";
    $("#ovGpuMaint").textContent = "—";
    $("#ovGpuMaintSub").textContent = "未连接";
    $("#ovGpuRestricted").textContent = "—";
    $("#ovGpuRestrictedSub").textContent = "未连接";
    $("#ovNodesHealthy").textContent = "—";
    $("#ovNodesDetail").textContent = "未连接";
    $("#ovGpuModels").textContent = "—";
    $("#ovGpuPartitions").textContent = "未连接";
    $("#ovQueueSummary").textContent = "—";
    $("#ovQueueSub").textContent = "未连接";
    $("#ovNodeCount").textContent = "0";
    $("#gpuCount").textContent = "0";

    // Overview Storage reset
    $("#ovStorageQuotaRatio").textContent = "— / 50 GB";
    $("#ovStorageQuotaFill").style.width = "0%";
    $("#ovStorageAvail").textContent = "—";
    $("#ovStorageAvailSub").textContent = "配额上限 50 GB";
    $("#ovStorageTopDir").textContent = "—";
    $("#ovStorageTopDirSub").textContent = "未连接";
    $("#ovStorageHomePath").textContent = "—";
    $("#ovStorageUserLabel").textContent = "未连接";
    $("#ovStorageFsSummary").textContent = "—";
    $("#ovStorageMountLabel").textContent = "未连接";
    return;
  }

  const sshUser = storage.user || "user";
  const homePath = storage.home_path || `/home/${sshUser}`;
  $("#sidebarUser").textContent = sshUser;
  $("#sidebarHome").textContent = homePath;
  $("#sidebarAvatar").textContent = sshUser.slice(0, 1).toUpperCase();

  const totalGpus = Number(cluster.gpu_total) || gpus.length || 0;
  const onlineGpus = Number(cluster.gpu_online) || 0;
  const busyCount = Number(cluster.gpu_allocated ?? gpus.filter((g) => g.status === "busy").length) || 0;
  const maintCount = Number(cluster.gpu_maintenance) || 0;
  const restrictedCount = Number(cluster.gpu_restricted) || 0;
  const unavailableCount = maintCount + restrictedCount;
  const idleCount = Number(cluster.gpu_idle) || 0;
  const nodes = getNodesList();

  $("#gpuOnline").textContent = onlineGpus;
  $("#gpuTotal").textContent = totalGpus;
  $("#gpuNavCount").textContent = totalGpus;
  $("#gpuUtil").textContent = cluster.gpu_utilization;
  $("#activeJobs").textContent = cluster.active_jobs;
  $("#jobNavCount").textContent = cluster.active_jobs + cluster.queued_jobs;
  $("#queuedJobsFoot").textContent = `${cluster.queued_jobs} queued`;

  const gpuFoot = $("#gpuFootStatus");
  if (maintCount > 0 && restrictedCount > 0) {
    gpuFoot.textContent = `${maintCount} 维护 · ${restrictedCount} 受限(rcadmin)`;
    gpuFoot.className = "trend warn";
  } else if (maintCount > 0) {
    gpuFoot.textContent = `${maintCount} 张维护/排空中`;
    gpuFoot.className = "trend warn";
  } else if (restrictedCount > 0) {
    gpuFoot.textContent = `${restrictedCount} 张受限专用 (rcadmin)`;
    gpuFoot.className = "trend neutral";
  } else {
    gpuFoot.textContent = "全部在线";
    gpuFoot.className = "trend up";
  }

  const utilFoot = $("#utilFootStatus");
  if (idleCount === 0 && unavailableCount > 0) {
    utilFoot.textContent = "可用卡 100% 满载 (0 空闲)";
  } else {
    utilFoot.textContent = `空闲 ${idleCount} 张 · 实时分配率`;
  }

  // Overview GPU Panel (整体情况)
  const capTotal = Math.max(totalGpus, 1);
  const busyPct = (busyCount / capTotal) * 100;
  const idlePct = (idleCount / capTotal) * 100;
  const maintPct = (maintCount / capTotal) * 100;
  const restPct = (restrictedCount / capTotal) * 100;

  $("#ovGpuAllocRatio").textContent = `${busyCount} / ${onlineGpus} 可用卡已分配 (总计 ${totalGpus} 张)`;
  const segs = $$("#ovGpuStackBar .stack-seg");
  if (segs.length >= 4) {
    segs[0].style.width = `${busyPct.toFixed(1)}%`;
    segs[1].style.width = `${idlePct.toFixed(1)}%`;
    segs[2].style.width = `${maintPct.toFixed(1)}%`;
    segs[3].style.width = `${restPct.toFixed(1)}%`;
  }
  $("#ovLegendBusy").textContent = busyCount;
  $("#ovLegendIdle").textContent = idleCount;
  $("#ovLegendMaint").textContent = maintCount;
  $("#ovLegendRestricted").textContent = restrictedCount;

  $("#ovGpuBusy").textContent = `${busyCount} 张`;
  $("#ovGpuBusySub").textContent = `占可用卡 ${cluster.gpu_utilization}%`;
  $("#ovGpuIdle").textContent = `${idleCount} 张`;
  $("#ovGpuIdleSub").textContent = idleCount > 0 ? "可立即调度任务" : "当前无空闲卡";
  $("#ovGpuMaint").textContent = `${maintCount} 张`;
  const maintNodes = nodes.filter((n) => n.mode === "down" || n.mode === "drain" || n.mode === "reserved");
  $("#ovGpuMaintSub").textContent = maintNodes.length ? maintNodes.map((n) => n.name).join(", ") : "无维护/离线节点";
  $("#ovGpuRestricted").textContent = `${restrictedCount} 张`;
  const restNodes = nodes.filter((n) => n.mode === "restricted");
  $("#ovGpuRestrictedSub").textContent = restNodes.length ? `${restNodes.map((n) => n.name).join(", ")} (rcadmin)` : "无受限节点";

  $("#ovNodeCount").textContent = nodes.length;
  $("#gpuCount").textContent = totalGpus;

  const normalNodes = nodes.filter((n) => !n.mode || n.mode === "normal");
  const fullNodes = normalNodes.filter((n) => n.allocated >= n.total && n.total > 0);
  const idleNodes = normalNodes.filter((n) => n.allocated === 0);
  const abnormalNodesCount = nodes.length - normalNodes.length;
  $("#ovNodesHealthy").textContent = `${normalNodes.length} / ${nodes.length} 节点可用`;
  $("#ovNodesDetail").textContent = `满载 ${fullNodes.length} · 空闲 ${idleNodes.length} · 维护/受限 ${abnormalNodesCount}`;

  const models = [...new Set(nodes.map((n) => n.model).filter(Boolean))];
  const partitions = [...new Set(nodes.flatMap((n) => n.partitions || []).filter(Boolean))];
  $("#ovGpuModels").textContent = models.length ? models.join(" / ") : "NVIDIA GPU";
  $("#ovGpuPartitions").textContent = partitions.length ? `涵盖分区: ${partitions.join(", ")}` : `共 ${nodes.length} 个计算节点`;

  const allJobs = state.data.jobs || [];
  const myJobsCount = allJobs.filter((j) => j.owner === sshUser).length;
  const prioSummary = state.data.priority?.summary || {};
  const myPrio = prioSummary.my_current_priority || 0;
  const myRank = prioSummary.my_eligible_rank;
  $("#priorityNavBadge").textContent = myPrio ? `${myPrio}` : "—";
  if (myPrio && myRank) {
    $("#ovQueueSummary").textContent = `优先级 ${myPrio} · 排队顺位 #${myRank}`;
    $("#ovQueueSub").textContent = `前序 ${prioSummary.my_gpus_ahead || 0} 卡 · 我的任务 ${myJobsCount} 个 (点击透视)`;
  } else if (myPrio) {
    $("#ovQueueSummary").textContent = `${cluster.active_jobs} 运行 / ${cluster.queued_jobs} 排队`;
    $("#ovQueueSub").textContent = `我的优先级 ${myPrio} · 任务 ${myJobsCount} 个 (点击透视)`;
  } else {
    $("#ovQueueSummary").textContent = `${cluster.active_jobs} 运行 / ${cluster.queued_jobs} 排队`;
    $("#ovQueueSub").textContent = `当前用户任务: ${myJobsCount} 个`;
  }

  // Overview Storage Panel (整体情况)
  const homeUsedGb = storage.home_used_gb ?? storage.used_tb * 1000;
  const quotaGb = storage.home_quota_gb || HOME_QUOTA_GB;
  const availGb = Math.max(quotaGb - homeUsedGb, 0);
  const usedQuotaPct = Math.min((homeUsedGb / quotaGb) * 100, 100);
  const subdirs = storage.subdirs || [];
  const isInitialScan = Boolean(storage.scanning && homeUsedGb === 0 && !subdirs.length);
  const homeSize = formatSizeParts(homeUsedGb);

  $("#storageNavCount").textContent = isInitialScan ? "…" : `${Math.round(usedQuotaPct)}%`;
  $("#storageUsed").textContent = isInitialScan ? "扫描中" : homeSize.number;
  $("#storageUnit").textContent = isInitialScan ? "" : ` ${homeSize.unit}`;
  $("#storagePercent").textContent = homePath;
  $("#storageQuotaFoot").textContent = `剩余 ${formatSizeText(availGb)} / ${quotaGb} GB →`;
  $("#storageTrack").style.width = `${Math.max(usedQuotaPct, homeUsedGb > 0 ? 2 : 0)}%`;
  $("#storageTrack").style.background = usedQuotaPct >= 85 ? "var(--danger)" : usedQuotaPct >= 65 ? "var(--orange)" : "var(--green)";

  $("#storageDonut").style.background = buildOverallDonutGradient(homeUsedGb, quotaGb);
  $("#storageDonutValue").textContent = isInitialScan ? "…" : `${usedQuotaPct.toFixed(1)}%`;
  $("#storageDonutLabel").textContent = `共 ${quotaGb} GB`;
  $("#storageUsed2").textContent = isInitialScan ? "扫描中" : homeSize.number;
  $("#storageUnit2").textContent = isInitialScan ? "" : homeSize.unit;
  $("#storageTotal2").innerHTML = `剩余可用 <b>${escapeHtml(formatSizeText(availGb))}</b> / 共 <b>${quotaGb} GB</b>`;
  $("#storageHomeFoot").innerHTML = `主目录 <b>${escapeHtml(homePath)}</b>`;
  $("#storageHealthState").innerHTML = storage.scanning ? "<i></i>后台统计目录中…" : "<i></i>用户目录状态正常";

  $("#ovStorageQuotaRatio").textContent = isInitialScan ? `正在统计 / ${quotaGb} GB` : `${formatSizeText(homeUsedGb)} / ${quotaGb} GB (${usedQuotaPct.toFixed(1)}%)`;
  const quotaFill = $("#ovStorageQuotaFill");
  quotaFill.style.width = `${Math.max(usedQuotaPct, homeUsedGb > 0 ? 2 : 0)}%`;
  quotaFill.classList.toggle("warn", usedQuotaPct >= 75);

  $("#ovStorageAvail").textContent = isInitialScan ? "计算中…" : formatSizeText(availGb);
  $("#ovStorageAvailSub").textContent = `个人配额上限 ${quotaGb} GB`;

  if (subdirs.length > 0) {
    const topDir = subdirs[0];
    const topSize = formatSizeText(topDir.used_gb ?? topDir.used_mb / 1000);
    $("#ovStorageTopDir").textContent = `${topDir.name} (${topSize})`;
    $("#ovStorageTopDirSub").textContent = `已统计 ${subdirs.length} 个一级目录 · 占已用 ${topDir.share_pct}%`;
  } else {
    $("#ovStorageTopDir").textContent = storage.scanning ? "后台扫描中…" : "暂无大目录";
    $("#ovStorageTopDirSub").textContent = storage.scanning ? "正在执行 du 统计" : "主目录空间充裕";
  }

  $("#ovStorageHomePath").textContent = homePath;
  $("#ovStorageUserLabel").textContent = `SSH 登录用户: ${sshUser}`;

  if (storage.fs_total_tb) {
    $("#ovStorageFsSummary").textContent = `${storage.fs_used_tb} / ${storage.fs_total_tb} TB`;
    $("#ovStorageMountLabel").textContent = `挂载卷 ${storage.mount || "/home"} (剩余 ${storage.fs_avail_tb} TB)`;
  } else {
    $("#ovStorageFsSummary").textContent = "—";
    $("#ovStorageMountLabel").textContent = `挂载卷 ${storage.mount || "/home"}`;
  }

  $("#lastUpdated").textContent = formatTime(cluster.last_updated);
  $("#uptime").textContent = cluster.uptime;
  $("#clusterStatus").textContent = maintCount > 0 ? `运行正常 (${maintCount}卡维护)` : cluster.status === "healthy" ? "运行正常" : "需关注";
  renderSpark();
}

function renderGpusPage() {
  const { cluster, gpus = [] } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  if (!isLive) {
    $("#gpuPageOnline").textContent = "—";
    $("#gpuPageTotal").textContent = "—";
    $("#gpuPageNodeFoot").textContent = "未连接";
    $("#gpuPageBusy").textContent = "—";
    $("#gpuPageUtil").textContent = "—";
    $("#gpuPageIdle").textContent = "—";
    $("#gpuPageUnavail").textContent = "—";
    $("#gpuPageNodeGrid").innerHTML = `<div class="empty-state">未连接服务器，暂无节点状态数据</div>`;
    $("#gpuGrid").innerHTML = `<div class="empty-state">未连接服务器，暂无 GPU 节点数据</div>`;
    $("#gpuShown").textContent = 0;
    $("#gpuCountDetail").textContent = 0;
    return;
  }

  const nodes = getNodesList();
  const totalGpus = Number(cluster.gpu_total) || gpus.length || 0;
  const onlineGpus = Number(cluster.gpu_online) || 0;
  const busyCount = Number(cluster.gpu_allocated ?? gpus.filter((g) => g.status === "busy").length) || 0;
  const maintCount = Number(cluster.gpu_maintenance) || 0;
  const restrictedCount = Number(cluster.gpu_restricted) || 0;
  const idleCount = Number(cluster.gpu_idle) || 0;

  if (state.selectedNode !== "all" && !nodes.some((n) => n.name === state.selectedNode)) {
    state.selectedNode = "all";
  }

  $("#gpuPageOnline").textContent = onlineGpus;
  $("#gpuPageTotal").textContent = totalGpus;
  $("#gpuPageNodeFoot").textContent = `分布在 ${nodes.length} 个计算节点`;
  $("#gpuPageBusy").textContent = busyCount;
  $("#gpuPageUtil").textContent = cluster.gpu_utilization;
  $("#gpuPageIdle").textContent = idleCount;
  $("#gpuPageUnavail").textContent = maintCount + restrictedCount;
  $("#gpuPageUnavailFoot").textContent = `${maintCount} 维护 · ${restrictedCount} 受限(rcadmin)`;

  $("#clearNodeFilterBtn")?.classList.toggle("selected", state.selectedNode === "all");
  $("#gpuActiveNodeTag").textContent = state.selectedNode === "all" ? "" : `· 已筛选节点: ${state.selectedNode}`;

  $("#gpuPageNodeGrid").innerHTML = nodes
    .map((node) => {
      const badge = getNodeBadgeInfo(node);
      const selectedCls = state.selectedNode === node.name ? "selected" : "";
      const pct = node.total > 0 ? Math.min(Math.round((node.allocated / node.total) * 100), 100) : 0;
      const barCls =
        node.mode === "down"
          ? "maint down"
          : node.mode === "restricted"
            ? "maint restricted"
            : node.mode === "drain" || node.mode === "reserved"
              ? "maint"
              : utilClass(pct);
      const barWidth = node.mode in { down: 1, drain: 1, reserved: 1, restricted: 1 } && node.allocated === 0 ? 100 : pct;
      const partText = node.partitions?.length ? `分区: ${node.partitions.join(",")}` : `状态: ${node.state}`;
      return `<div class="node-detail-card ${selectedCls}" data-select-node="${escapeHtml(node.name)}">
        <div class="node-mini-top">
          <div class="node-mini-name"><span>${escapeHtml(node.name)}</span><span class="node-mini-model">${escapeHtml(node.model)}</span></div>
          <span class="node-badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="util-bar"><span class="${barCls}" style="width:${barWidth}%"></span></div>
        <div class="node-mini-meta">
          <span>占用 <b>${node.allocated} / ${node.total}</b> 卡</span>
          <span>${escapeHtml(node.reason || partText)}</span>
        </div>
      </div>`;
    })
    .join("");

  const filtered = gpus.filter((gpu) => {
    const matchStatus = state.gpuFilter === "all" || gpu.status === state.gpuFilter;
    const matchNode = state.selectedNode === "all" || gpu.node === state.selectedNode;
    return matchStatus && matchNode;
  });

  if (!filtered.length) {
    const emptyLabel =
      state.gpuFilter === "maintenance"
        ? "当前筛选范围内没有处于维护或受限状态的 GPU"
        : state.gpuFilter === "idle"
          ? "当前筛选范围内所有可用 GPU 均已满载，无空闲卡"
          : "无匹配的 GPU 节点";
    $("#gpuGrid").innerHTML = `<div class="empty-state">${emptyLabel}</div>`;
    $("#gpuShown").textContent = 0;
    $("#gpuCountDetail").textContent = totalGpus;
    return;
  }

  $("#gpuGrid").innerHTML = filtered
    .map((gpu) => {
      const memory = gpu.memory_used == null || gpu.memory_total == null ? "—" : `${gpu.memory_used}/${gpu.memory_total}G`;
      const rightMeta =
        gpu.temperature != null ? `<b>${gpu.temperature}°</b>` : gpu.node_state ? `STATE <b>${escapeHtml(gpu.node_state)}</b>` : "<b>—</b>";
      const isMaint = gpu.status === "maintenance";
      const isDown = gpu.substatus === "down";
      const isRestricted = gpu.substatus === "restricted";
      const isBusyDrain = gpu.status === "busy" && (gpu.substatus === "drain" || gpu.substatus === "down" || gpu.substatus === "reserved");
      const tileClass = isMaint ? (isDown ? "down" : isRestricted ? "restricted" : "maintenance") : isBusyDrain ? "busy-drain" : "";
      const dotClass =
        gpu.status === "idle" ? "idle" : isMaint ? (isDown ? "down" : isRestricted ? "restricted" : "maintenance") : isBusyDrain ? "busy-drain" : "";
      const utilDisplay = gpu.util_display ?? `${gpu.utilization}%`;
      const barHtml = isMaint
        ? `<span class="maint ${isDown ? "down" : isRestricted ? "restricted" : ""}" style="width:100%"></span>`
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
    })
    .join("");

  $("#gpuShown").textContent = filtered.length;
  $("#gpuCountDetail").textContent = totalGpus;
}

function renderStoragePage() {
  const { cluster, storage } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  if (!isLive) {
    $("#stPageUsed").textContent = "—";
    $("#stPageUsedUnit").textContent = " GB";
    $("#stPageUsedPct").textContent = "未连接";
    $("#stPageAvail").textContent = "—";
    $("#stPageAvailUnit").textContent = " GB";
    $("#stPageTopSize").textContent = "—";
    $("#stPageTopUnit").textContent = "";
    $("#stPageTopName").textContent = "—";
    $("#stPageDirCount").textContent = "共 0 个子目录";
    $("#stPageFsUsed").textContent = "—";
    $("#stPageFsTotal").textContent = "/ — TB";
    $("#stPageMount").textContent = "未连接";
    $("#storageDetailDonut").style.background = `conic-gradient(var(--track) 0 100%)`;
    $("#storageDetailDonutValue").textContent = "—";
    $("#storageDetailUsed").textContent = "—";
    $("#storageDetailUnit").textContent = "GB";
    $("#storageDetailTotal").textContent = "总容量 50 GB";
    $("#storageDetailHealth").innerHTML = "<i></i>未连接";
    $("#storageDetailFoot").innerHTML = "主目录 <b>—</b>";
    $("#storagePaths").innerHTML = `<div class="empty-state">未连接服务器，暂无目录空间数据</div>`;
    $("#usersList").innerHTML = `<div class="empty-state">未连接服务器，暂无主目录明细</div>`;
    return;
  }

  const sshUser = storage.user || "user";
  const homePath = storage.home_path || `/home/${sshUser}`;
  const homeUsedGb = storage.home_used_gb ?? storage.used_tb * 1000;
  const quotaGb = storage.home_quota_gb || HOME_QUOTA_GB;
  const availGb = Math.max(quotaGb - homeUsedGb, 0);
  const usedQuotaPct = Math.min((homeUsedGb / quotaGb) * 100, 100);
  const subdirs = storage.subdirs || [];
  const paths = storage.paths || [];
  const pieItems = paths.length ? paths : subdirs;
  const isInitialScan = Boolean(storage.scanning && homeUsedGb === 0 && !subdirs.length);

  const usedParts = formatSizeParts(homeUsedGb);
  const availParts = formatSizeParts(availGb);

  $("#stPageUsed").textContent = isInitialScan ? "扫描中" : usedParts.number;
  $("#stPageUsedUnit").textContent = isInitialScan ? "" : ` ${usedParts.unit}`;
  $("#stPageUsedPct").textContent = `占 50 GB 配额的 ${usedQuotaPct.toFixed(1)}%`;

  $("#stPageAvail").textContent = isInitialScan ? "…" : availParts.number;
  $("#stPageAvailUnit").textContent = isInitialScan ? "" : ` ${availParts.unit}`;

  if (subdirs.length > 0) {
    const top = subdirs[0];
    const topParts = formatSizeParts(top.used_gb ?? top.used_mb / 1000);
    $("#stPageTopSize").textContent = topParts.number;
    $("#stPageTopUnit").textContent = ` ${topParts.unit}`;
    $("#stPageTopName").textContent = `目录: ${top.name}`;
    $("#stPageDirCount").textContent = `前 ${subdirs.length} 大目录`;
  } else {
    $("#stPageTopSize").textContent = "—";
    $("#stPageTopUnit").textContent = "";
    $("#stPageTopName").textContent = storage.scanning ? "正在扫描…" : "无子目录";
    $("#stPageDirCount").textContent = "共 0 个子目录";
  }

  $("#stPageFsUsed").textContent = storage.fs_used_tb ?? "—";
  $("#stPageFsTotal").textContent = `/ ${storage.fs_total_tb ?? "—"} TB`;
  $("#stPageMount").textContent = `挂载点 ${storage.mount || "/home"}`;

  $("#storageDetailDonut").style.background = buildSubdirPieGradient(pieItems, quotaGb, homeUsedGb);
  $("#storageDetailDonutValue").textContent = isInitialScan ? "…" : `${usedQuotaPct.toFixed(1)}%`;
  $("#storageDetailDonutLabel").textContent = `共 ${quotaGb} GB`;
  $("#storageDetailUsed").textContent = isInitialScan ? "扫描中" : usedParts.number;
  $("#storageDetailUnit").textContent = isInitialScan ? "" : usedParts.unit;
  $("#storageDetailTotal").innerHTML = `剩余可用 <b>${escapeHtml(formatSizeText(availGb))}</b> / 共 <b>${quotaGb} GB</b>`;
  $("#storageDetailFoot").innerHTML = `主目录 <b>${escapeHtml(homePath)}</b>`;
  $("#storageDetailHealth").innerHTML = storage.scanning ? "<i></i>后台统计目录中…" : "<i></i>各子目录空间统计完成";

  if (!paths.length) {
    const emptyMsg = storage.scanning ? "正在后台统计用户目录各文件夹占比…" : "主目录为空或暂无子目录数据";
    $("#storagePaths").innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
  } else {
    $("#storagePaths").innerHTML = paths
      .map((item, idx) => {
        const usedGb = item.used_gb ?? item.used_tb * 1000;
        const pct = Number(item.pct ?? (usedGb / quotaGb) * 100);
        const color = PIE_COLORS[idx % PIE_COLORS.length];
        return `<div class="path-row" title="${escapeHtml(item.path)}: ${formatSizeText(usedGb)} (占 ${quotaGb}GB 配额的 ${pct.toFixed(1)}%)">
          <span class="path-name"><i class="path-dot" style="background:${color}"></i>${escapeHtml(item.path)}</span>
          <div class="path-track"><span style="width:${Math.max(pct, usedGb > 0 ? 2 : 0)}%;background:${color}"></span></div>
          <span class="path-value">${escapeHtml(formatSizeText(usedGb))}</span>
        </div>`;
      })
      .join("");
  }

  if (!subdirs.length) {
    const msg = storage.scanning ? "正在后台统计主目录各文件夹大小…" : "主目录为空或暂无子目录明细";
    $("#usersList").innerHTML = `<div class="empty-state">${msg}</div>`;
    return;
  }

  $("#usersList").innerHTML = subdirs
    .map((item, index) => {
      const icon = item.name.startsWith(".") ? "⚙" : item.name.startsWith("~") || item.name === "其他" ? "📄" : "📁";
      const usedGb = item.used_gb ?? item.used_mb / 1000;
      const sizeLabel = formatSizeText(usedGb);
      const quotaPct = Math.min((usedGb / quotaGb) * 100, 100).toFixed(1);
      const color = PIE_COLORS[index % PIE_COLORS.length];
      return `<div class="user-row" title="${escapeHtml(item.name)}: ${sizeLabel} (占已用空间 ${item.share_pct}% · 占配额 ${quotaPct}%)">
        <span class="user-rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="user-avatar">${icon}</span>
        <div class="user-name">
          <div class="user-name-head">
            <span>${escapeHtml(item.name)}</span>
            <small>占已用 ${item.share_pct}% · 配额 ${quotaPct}%</small>
          </div>
          <div class="user-bar"><span style="width:${Math.max(item.share_pct, 2)}%;background:${color}"></span></div>
        </div>
        <span class="user-amount">${escapeHtml(sizeLabel)}</span>
      </div>`;
    })
    .join("");
}

function renderJobRowHtml(job, sshUser = "") {
  const isPending = job.status === "PENDING";
  const isMine = Boolean(job.is_mine || (sshUser && job.owner === sshUser));
  const isTeammate = Boolean(job.is_teammate);
  const reasonText = isPending && job.reason ? REASON_LABELS[job.reason] || job.reason : "";
  const statusLabel = reasonText ? `PENDING · ${reasonText}` : job.status;
  const statusTitle = isPending && job.reason ? `排队原因: ${job.reason}` : job.node ? `运行节点: ${job.node}` : "";
  const nodeCell = job.node ? escapeHtml(job.node) : `<span style="color:var(--muted-2)">—</span>`;
  const acctHtml = job.account ? `<span class="acct-tag">${escapeHtml(job.account)}</span>` : "";
  const relationHtml = isMine
    ? `<span class="mine-pill" style="margin-left:5px">我</span>`
    : isTeammate
      ? `<span class="group-pill" style="margin-left:5px">同组</span>`
      : "";

  const prio = Number(job.priority) || 0;
  const bd = job.prio_breakdown || { fairshare: 0, partition: 0, age: 0 };
  const cap = 4500;
  const fsPct = Math.min((bd.fairshare / cap) * 100, 100);
  const partPct = Math.min((bd.partition / cap) * 100, 100 - fsPct);
  const agePct = Math.min((bd.age / cap) * 100, Math.max(100 - fsPct - partPct, 0));
  const prioTooltip = `总优先级 ${prio} = 公平份额(FairShare) ${bd.fairshare} + 分区(Partition) ${bd.partition} + 排队时长(Age) ${bd.age}`;
  const timeText = job.time_limit ? `${escapeHtml(job.elapsed)} / <span style="color:var(--muted-2)">${escapeHtml(job.time_limit)}</span>` : escapeHtml(job.elapsed);
  const rowStyle = isMine
    ? `style="background:rgba(56,214,161,.04)"`
    : isTeammate
      ? `style="background:rgba(95,169,255,.04)"`
      : "";

  return `<tr ${rowStyle}>
    <td>${escapeHtml(job.name)}<span class="job-id">${escapeHtml(job.id)}</span></td>
    <td class="owner"><span class="owner-link" data-select-member="${escapeHtml(job.owner)}" title="点击只看 ${escapeHtml(job.owner)} 的任务">${escapeHtml(job.owner)}</span>${acctHtml}${relationHtml}</td>
    <td>${escapeHtml(job.partition)}</td>
    <td>${nodeCell}</td>
    <td>${job.gpus}</td>
    <td title="${escapeHtml(prioTooltip)}">
      <div class="prio-cell-wrap">
        <div class="prio-cell-top"><strong>${prio}</strong><small>${bd.fairshare}+${bd.partition}+${bd.age}</small></div>
        <div class="prio-mini-track">
          <span class="ladder-seg fs" style="width:${fsPct.toFixed(1)}%"></span>
          <span class="ladder-seg part" style="width:${partPct.toFixed(1)}%"></span>
          <span class="ladder-seg age" style="width:${agePct.toFixed(1)}%"></span>
        </div>
      </div>
    </td>
    <td>${timeText}</td>
    <td><span class="status-pill ${isPending ? "pending" : ""}" title="${escapeHtml(statusTitle)}">${escapeHtml(statusLabel)}</span></td>
  </tr>`;
}

function syncJobFilterButtons() {
  $$("#jobFilter button").forEach((item) => {
    item.classList.toggle("selected", item.dataset.jobFilter === state.jobFilter && state.selectedMember === "all");
  });
  $("#filterGroupAllChip")?.classList.toggle("selected", state.jobFilter === "group" && state.selectedMember === "all");
  $("#filterTeammatesChip")?.classList.toggle("selected", state.jobFilter === "teammates" && state.selectedMember === "all");
  $("#clearMemberFilterBtn")?.classList.toggle("selected", state.jobFilter === "all" && state.selectedMember === "all");
}

function renderJobsPage() {
  const { cluster, jobs = [], storage, priority } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  if (!isLive) {
    $("#jobPageTotal").textContent = "—";
    $("#jobPageRunning").textContent = "—";
    $("#jobPageGpuUsed").textContent = "未连接";
    $("#jobPagePending").textContent = "—";
    $("#jobPageMine").textContent = "—";
    $("#jobPageGroupTotal").textContent = " / 同组 —";
    $("#jobPageMineUser").textContent = "未连接";
    $("#jobPageGroupFoot").textContent = "同组他人 —";
    $("#jobGroupAcctTag").textContent = "";
    $("#jobActiveMemberTag").textContent = "";
    $("#groupMembersGrid").innerHTML = `<div class="empty-state">未连接服务器，暂无同组人员数据</div>`;
    $("#jobsShownCount").textContent = "0";
    $("#jobsTotalCount").textContent = "0";
    $("#jobsTable").innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted-2);padding:24px 8px;">未连接服务器，暂无任务队列数据</td></tr>`;
    return;
  }

  const sshUser = storage?.user || "";
  const groupInfo = priority?.group || {};
  const members = groupInfo.members || [];
  const runningJobs = jobs.filter((j) => j.status === "RUNNING");
  const pendingJobs = jobs.filter((j) => j.status !== "RUNNING");
  const myJobs = jobs.filter((j) => j.is_mine || j.owner === sshUser);
  const myRunningCount = myJobs.filter((j) => j.status === "RUNNING").length;
  const myPendingCount = myJobs.length - myRunningCount;
  const groupJobsCount = groupInfo.total_jobs ?? jobs.filter((j) => j.is_group).length;
  const teammateJobsCount = groupInfo.teammate_total_jobs ?? jobs.filter((j) => j.is_teammate).length;
  const runningGpuSum = runningJobs.reduce((acc, j) => acc + (Number(j.gpus) || 0), 0);

  $("#jobPageTotal").textContent = jobs.length;
  $("#jobPageRunning").textContent = runningJobs.length;
  $("#jobPageGpuUsed").textContent = `共占用 ${runningGpuSum} 张 GPU`;
  $("#jobPagePending").textContent = pendingJobs.length;
  $("#jobPageMine").textContent = myJobs.length;
  $("#jobPageGroupTotal").textContent = ` / 同组 ${groupJobsCount} 个`;
  $("#jobPageMineUser").textContent = `我: ${myRunningCount} 运行 · ${myPendingCount} 排队`;
  $("#jobPageGroupFoot").textContent = `同组他人: ${groupInfo.teammate_running_jobs ?? 0} 运行 · ${groupInfo.teammate_pending_jobs ?? 0} 排队`;

  const primaryAcct = groupInfo.primary_account || "";
  $("#jobGroupAcctTag").textContent = primaryAcct
    ? `· 课题组 ${primaryAcct} (共 ${members.length} 人 · 组内在跑 ${groupInfo.running_gpus ?? 0} 卡 / 排队 ${groupInfo.pending_gpus ?? 0} 卡)`
    : "";

  if ($("#filterGroupAllChip")) $("#filterGroupAllChip").textContent = `同组全部 (${groupJobsCount})`;
  if ($("#filterTeammatesChip")) $("#filterTeammatesChip").textContent = `仅同组他人 (${teammateJobsCount})`;

  syncJobFilterButtons();

  if (!members.length) {
    $("#groupMembersGrid").innerHTML = `<div class="empty-state">暂无同组人员关联记录</div>`;
  } else {
    $("#groupMembersGrid").innerHTML = members
      .map((m) => {
        const isSelected = state.selectedMember === m.user;
        const badgeCls = m.is_me ? "online" : m.running_jobs > 0 ? "online" : m.pending_jobs > 0 ? "maint" : "idle";
        const badgeText = m.is_me
          ? `我 · ${m.total_jobs} 任务`
          : m.total_jobs > 0
            ? `同组 · ${m.total_jobs} 任务`
            : `同组 · 空闲`;
        const barColor = m.is_me ? "var(--green)" : m.usage_share_pct >= 40 ? "var(--orange)" : "var(--blue)";
        return `<div class="node-detail-card ${isSelected ? "selected" : ""}" data-select-member="${escapeHtml(m.user)}" title="点击筛选 ${escapeHtml(m.user)} 的实验任务">
          <div class="node-mini-top">
            <div class="node-mini-name">
              <span>${escapeHtml(m.user)}</span>
              <span class="node-mini-model">${escapeHtml(m.account)}</span>
            </div>
            <span class="node-badge ${badgeCls}">${escapeHtml(badgeText)}</span>
          </div>
          <div class="member-job-stats">
            <span>运行 <b class="run">${m.running_jobs}</b> (${m.running_gpus}卡)</span>
            <span>排队 <b class="pend">${m.pending_jobs}</b> (${m.pending_gpus}卡)</span>
          </div>
          <div class="util-bar" title="近7天衰减消耗占全组 ${m.usage_share_pct}%">
            <span style="width:${Math.max(m.usage_share_pct, m.raw_usage > 0 ? 3 : 0)}%;background:${barColor}"></span>
          </div>
          <div class="node-mini-meta">
            <span>7天消耗 <b>${m.raw_usage_hours.toLocaleString()}h</b></span>
            <span>占全组消耗 <b>${m.usage_share_pct}%</b></span>
          </div>
        </div>`;
      })
      .join("");
  }

  let activeFilterLabel = "";
  if (state.selectedMember !== "all") {
    const isMeSelected = state.selectedMember === sshUser;
    activeFilterLabel = `· 已筛选成员: ${state.selectedMember}${isMeSelected ? " (我)" : " (同组)"}`;
  } else if (state.jobFilter === "group") {
    activeFilterLabel = `· 已筛选: 同组全部任务 (${primaryAcct || "同组"})`;
  } else if (state.jobFilter === "teammates") {
    activeFilterLabel = `· 已筛选: 同组其他成员任务 (不含本人)`;
  } else if (state.jobFilter === "mine") {
    activeFilterLabel = `· 已筛选: 我的任务 (${sshUser})`;
  }
  $("#jobActiveMemberTag").textContent = activeFilterLabel;

  const keyword = state.jobSearch.trim().toLowerCase();
  const filtered = jobs.filter((job) => {
    if (state.selectedMember !== "all" && job.owner !== state.selectedMember) return false;
    if (state.jobFilter === "RUNNING" && job.status !== "RUNNING") return false;
    if (state.jobFilter === "PENDING" && job.status === "RUNNING") return false;
    if (state.selectedMember === "all") {
      if (state.jobFilter === "mine" && !(job.is_mine || job.owner === sshUser)) return false;
      if (state.jobFilter === "group" && !job.is_group) return false;
      if (state.jobFilter === "teammates" && !job.is_teammate) return false;
    }
    if (keyword) {
      const hay = `${job.id} ${job.name} ${job.owner} ${job.account || ""} ${job.partition} ${job.node || ""} ${job.reason || ""}`.toLowerCase();
      if (!hay.includes(keyword)) return false;
    }
    return true;
  });

  $("#jobsShownCount").textContent = filtered.length;
  $("#jobsTotalCount").textContent = jobs.length;

  if (!filtered.length) {
    $("#jobsTable").innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted-2);padding:24px 8px;">无符合筛选条件的任务</td></tr>`;
    return;
  }
  $("#jobsTable").innerHTML = filtered.map((job) => renderJobRowHtml(job, sshUser)).join("");
}

function updatePrioritySimulator() {
  const prioData = state.data?.priority;
  const isLive = Boolean(state.data?.cluster?.connected && prioData?.config?.weights);
  if (!isLive) {
    $("#simResultTotal").textContent = "预计总分: —";
    $("#simRankResult").textContent = "—";
    $("#simAheadGpusResult").textContent = "—";
    $("#simOvertakeResult").textContent = "—";
    return;
  }

  const cfg = prioData.config;
  const wPart = cfg.weights?.partition ?? 1000;
  const wAge = cfg.weights?.age ?? 1000;
  const maxAgeHours = cfg.max_age_hours || 168;
  const ratePerHour = cfg.age_points_per_hour || 5.95;

  const fsSlider = $("#simFsSlider");
  const ageSlider = $("#simAgeSlider");
  const fsPts = Number(fsSlider?.value ?? state.simFairsharePts ?? 1028);
  const ageHours = Number(ageSlider?.value ?? state.simAgeHours ?? 0);
  state.simFairsharePts = fsPts;
  state.simAgeHours = ageHours;

  const agePts = Math.round((ageHours / maxAgeHours) * wAge);
  const totalSimPrio = fsPts + wPart + agePts;

  $("#simFsValLabel").textContent = `${fsPts.toLocaleString()} 分 (占比 ${((fsPts / 3125) * 100).toFixed(1)}%)`;
  $("#simAgeValLabel").textContent = `${ageHours} 小时 (+${agePts} 分)`;
  $("#simResultTotal").textContent = `预计总分: ${totalSimPrio} pts (${fsPts} + ${wPart} + ${agePts})`;

  const eligibleGroups = (prioData.queue_groups || []).filter((g) => g.eligible && !g.is_mine);
  const groupsAhead = eligibleGroups.filter((g) => g.priority > totalSimPrio);
  const simRank = groupsAhead.length + 1;
  const totalCompetitors = eligibleGroups.length + 1;
  const gpusAhead = groupsAhead.reduce((acc, g) => acc + (g.total_gpus || 0), 0);
  const jobsAhead = groupsAhead.reduce((acc, g) => acc + (g.job_count || 0), 0);

  $("#simRankResult").textContent = `第 ${simRank} 位 / 共 ${totalCompetitors} 批`;
  $("#simRankSub").textContent = simRank === 1 ? "直接位居全集群可调度榜首！" : `排在 ${groupsAhead.length} 个他人的可调度批次之后`;

  $("#simAheadGpusResult").textContent = `${gpusAhead} 张 GPU`;
  $("#simAheadSub").textContent = gpusAhead === 0 ? "无更高优任务阻挡，有空闲卡即刻运行" : `前序共 ${jobsAhead} 个高优任务等待分配`;

  if (groupsAhead.length === 0) {
    $("#simOvertakeResult").textContent = "已达榜首 #1";
    $("#simOvertakeSub").textContent = "无需额外排队追赶";
  } else {
    const nextGroup = groupsAhead[groupsAhead.length - 1];
    const diff = nextGroup.priority - totalSimPrio + 1;
    const hoursNeeded = Math.ceil(diff / ratePerHour);
    const maxRemainingAgePts = wAge - agePts;
    if (diff <= maxRemainingAgePts) {
      $("#simOvertakeResult").textContent = `约 ${hoursNeeded} 小时 (+${diff}分)`;
      $("#simOvertakeSub").textContent = `超越前一名 ${nextGroup.account} (${nextGroup.priority}分)`;
    } else {
      $("#simOvertakeResult").textContent = `需切换高份额账户`;
      $("#simOvertakeSub").textContent = `差 ${diff} 分，仅靠 7 天排队(+${maxRemainingAgePts}分)无法反超`;
    }
  }
}

function renderPriorityPage() {
  const { cluster, storage, jobs = [], priority } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh" && priority?.config);
  if (!isLive) {
    $("#prioCardMine").textContent = "—";
    $("#prioCardMineBreakdown").textContent = "未连接";
    $("#prioCardMineAcct").textContent = "未连接";
    $("#prioCardRank").textContent = "—";
    $("#prioCardRankSub").textContent = "";
    $("#prioCardAheadGpus").textContent = "未连接";
    $("#prioCardMinePending").textContent = "未连接";
    $("#myAccountsList").innerHTML = `<div class="empty-state">未连接服务器，暂无关联账户 FairShare 数据</div>`;
    $("#prioLadderList").innerHTML = `<div class="empty-state">未连接服务器，暂无排队阶梯数据</div>`;
    $("#prioAccountsTable").innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted-2);padding:24px 8px;">未连接服务器，暂无课题组份额数据</td></tr>`;
    updatePrioritySimulator();
    return;
  }

  const sshUser = storage?.user || "user";
  const cfg = priority.config || {};
  const summary = priority.summary || {};
  const userAccounts = priority.user_accounts || [];
  const queueGroups = priority.queue_groups || [];
  const accountsList = priority.accounts || [];

  $("#prioSimUserTag").textContent = `SSH 用户: ${sshUser}`;
  $("#prioPluginBadge").textContent = cfg.priority_type || "priority/multifactor";
  $("#prioCardFsWeight").textContent = (cfg.weights?.fairshare ?? 50000).toLocaleString();
  $("#prioCardFsMax").textContent = `/ ku 上限 ${cfg.ku_max_fairshare_points ?? 3125} 分`;
  $("#prioCardHalfLife").textContent = `半衰期 ${cfg.decay_half_life_days ?? 7} 天指数衰减`;
  $("#prioCardAgeRate").textContent = `+${cfg.age_points_per_hour ?? 5.95}`;
  $("#prioCardAgeCap").textContent = `${cfg.max_age_days ?? 7} 天满额 ${cfg.weights?.age ?? 1000} 分`;
  $("#prioCardSchedMode").textContent = cfg.scheduler_type || "sched/backfill";

  const myTopGroup = queueGroups.find((g) => g.is_mine);
  const myCurrentPrio = summary.my_current_priority || 0;
  const myCurrentAcct = summary.my_current_account || "—";
  const myBestAcct = summary.my_best_account || "";
  const myBestPrio = summary.my_best_base_priority || 0;

  $("#prioCardMine").textContent = myCurrentPrio ? `${myCurrentPrio}` : "—";
  if (myTopGroup) {
    const bd = myTopGroup.prio_breakdown || {};
    $("#prioCardMineBreakdown").textContent = `份额 ${bd.fairshare} + 分区 ${bd.partition} + 等待 ${bd.age}`;
    $("#prioCardMineAcct").textContent =
      myBestAcct && myBestAcct !== myCurrentAcct
        ? `当前 ${myCurrentAcct} (${myBestAcct} 可达 ${myBestPrio}分)`
        : `当前账户: ${myCurrentAcct}`;
  } else {
    $("#prioCardMineBreakdown").textContent = `新任务初始分 (FairShare + Partition)`;
    $("#prioCardMineAcct").textContent = `账户: ${myCurrentAcct}`;
  }

  if (summary.my_eligible_rank) {
    $("#prioCardRank").textContent = `#${summary.my_eligible_rank}`;
    $("#prioCardRankSub").textContent = `/ ${summary.eligible_groups_count} 批可调度队列`;
    $("#prioCardAheadGpus").textContent = `前序 ${summary.my_jobs_ahead} 任务 (需 ${summary.my_gpus_ahead} 张 GPU)`;
    $("#prioCardMinePending").textContent = `我的排队: ${summary.my_pending_jobs} 任务 (${summary.my_pending_gpus} 卡)`;
  } else {
    $("#prioCardRank").textContent = "无排队";
    $("#prioCardRankSub").textContent = `共 ${summary.eligible_groups_count} 批竞争中`;
    $("#prioCardAheadGpus").textContent = `全队列待分配 ${summary.eligible_gpus_total || 0} 张 GPU`;
    $("#prioCardMinePending").textContent = `可随时提交新任务`;
  }

  // Initialize simulator default to user's active account FairShare once
  if (state.simFairsharePts === null) {
    const defaultAcct = userAccounts.find((a) => a.account === myCurrentAcct) || userAccounts[0];
    state.simFairsharePts = defaultAcct ? defaultAcct.fairshare_points : 1028;
    state.simSelectedAcct = defaultAcct ? defaultAcct.account : "";
    const myAgePts = myTopGroup?.prio_breakdown?.age || 0;
    state.simAgeHours = Math.min(Math.round(myAgePts / (cfg.age_points_per_hour || 5.95)), 168);
    if ($("#simFsSlider")) $("#simFsSlider").value = state.simFairsharePts;
    if ($("#simAgeSlider")) $("#simAgeSlider").value = state.simAgeHours;
  }

  // Render user's Slurm accounts comparison
  if (!userAccounts.length) {
    $("#myAccountsList").innerHTML = `<div class="empty-state">未查询到个人关联账户明细</div>`;
  } else {
    const maxUserBase = Math.max(...userAccounts.map((a) => a.base_priority), 1);
    $("#myAccountsList").innerHTML = userAccounts
      .map((acct) => {
        const isBest = userAccounts.length > 1 && acct.base_priority === maxUserBase;
        const isSimSelected = state.simSelectedAcct === acct.account;
        const badgeHtml = isBest
          ? `<span class="node-badge online">推荐高优账户</span>`
          : acct.my_pending_jobs > 0
            ? `<span class="node-badge maint">当前排队中 (${acct.my_pending_jobs})</span>`
            : `<span class="node-badge idle">可用账户</span>`;
        const fsRatioPct = Math.min((acct.fairshare_points / 3125) * 100, 100).toFixed(1);
        return `<div class="my-acct-card ${isBest ? "best" : ""} ${isSimSelected ? "active-sim" : ""}" data-sim-acct="${escapeHtml(acct.account)}" data-sim-fs="${acct.fairshare_points}" title="点击将 ${escapeHtml(acct.account)} 的公平份额 (${acct.fairshare_points}分) 带入下方推演器">
          <div class="my-acct-top">
            <div class="my-acct-name"><span>-A ${escapeHtml(acct.account)}</span></div>
            ${badgeHtml}
          </div>
          <div class="my-acct-score">
            <strong>${acct.base_priority} <small style="font-size:11px;font-weight:400;color:var(--muted)">初始总分</small></strong>
            <span>FairShare <b>${acct.fairshare_points}</b> / 3125 (${fsRatioPct}%)</span>
          </div>
          <div class="util-bar"><span style="width:${Math.max(Number(fsRatioPct), 3)}%;background:${isBest ? "var(--green)" : "var(--purple)"}"></span></div>
          <div class="my-acct-meta">
            <div><span>课题组总消耗 (7天衰减):</span><b>${acct.account_raw_usage_hours.toLocaleString()} 核时</b></div>
            <div><span>我个人消耗 / 有效占比:</span><b>${acct.raw_usage_hours.toLocaleString()} 核时 / ${(acct.effectv_usage * 100).toFixed(2)}%</b></div>
            <div><span>我的在跑 / 排队任务:</span><b>${acct.my_running_jobs} 运行 / ${acct.my_pending_jobs} 排队</b></div>
          </div>
        </div>`;
      })
      .join("");
  }

  updatePrioritySimulator();

  // Render Live Pending Queue Priority Ladder
  const maxScalePrio = Math.max(summary.highest_pending_priority || 4125, 4200);
  let ladderItems = [];
  if (state.ladderMode === "groups") {
    ladderItems = queueGroups.filter((g) => {
      if (state.ladderFilter === "eligible") return g.eligible;
      if (state.ladderFilter === "group") return g.is_group;
      if (state.ladderFilter === "mine") return g.is_mine;
      return true;
    });
  } else {
    const pendingIndiv = jobs
      .filter((j) => j.status !== "RUNNING")
      .sort((a, b) => b.priority - a.priority || (a.eligible === b.eligible ? 0 : a.eligible ? -1 : 1));
    let rk = 0;
    let gAhead = 0;
    ladderItems = pendingIndiv
      .map((j) => {
        const item = {
          owner: j.owner,
          account: j.account,
          partition: j.partition,
          priority: j.priority,
          reason: j.reason,
          eligible: j.eligible,
          is_mine: Boolean(j.is_mine || j.owner === sshUser),
          is_group: Boolean(j.is_group),
          is_teammate: Boolean(j.is_teammate),
          job_count: 1,
          total_gpus: j.gpus,
          sample_job_id: j.id,
          sample_job_name: j.name,
          time_limit: j.time_limit,
          prio_breakdown: j.prio_breakdown,
          gpus_ahead: gAhead,
          eligible_rank: j.eligible ? ++rk : null,
        };
        if (j.eligible) gAhead += j.gpus;
        return item;
      })
      .filter((item) => {
        if (state.ladderFilter === "eligible") return item.eligible;
        if (state.ladderFilter === "group") return item.is_group;
        if (state.ladderFilter === "mine") return item.is_mine;
        return true;
      });
  }

  $("#prioLadderSummaryNote").textContent = `共 ${summary.eligible_jobs_count || 0} 个可立即调度任务 (${summary.eligible_gpus_total || 0} 张 GPU) · 按总优先级降序排列`;

  if (!ladderItems.length) {
    $("#prioLadderList").innerHTML = `<div class="empty-state">当前筛选条件下没有排队中的任务</div>`;
  } else {
    $("#prioLadderList").innerHTML = ladderItems
      .map((item) => {
        const bd = item.prio_breakdown || { fairshare: 0, partition: 0, age: 0 };
        const fsW = Math.min((bd.fairshare / maxScalePrio) * 100, 100);
        const partW = Math.min((bd.partition / maxScalePrio) * 100, Math.max(100 - fsW, 0));
        const ageW = Math.min((bd.age / maxScalePrio) * 100, Math.max(100 - fsW - partW, 0));
        const reasonCn = REASON_LABELS[item.reason] || item.reason || "等待调度";
        const rankHtml = item.eligible
          ? `<div class="ladder-rank"><strong>#${item.eligible_rank}</strong><small>前序 ${item.gpus_ahead} 卡</small></div>`
          : `<div class="ladder-rank"><strong>暂缓阻塞</strong><small>${escapeHtml(reasonCn)}</small></div>`;
        const mineTag = item.is_mine
          ? `<span class="mine-pill">我的任务</span>`
          : item.is_teammate
            ? `<span class="group-pill">同组人员</span>`
            : "";
        const batchDesc =
          item.job_count > 1
            ? `共 <b>${item.job_count}</b> 个任务 · 需 <b>${item.total_gpus}</b> 张 GPU · 代表作业 <b>${escapeHtml(item.sample_job_name)}</b> (${escapeHtml(item.sample_job_id)})`
            : `申请 <b>${item.total_gpus}</b> 张 GPU · 作业 <b>${escapeHtml(item.sample_job_name)}</b> (${escapeHtml(item.sample_job_id)})${item.time_limit ? ` · 时限 ${escapeHtml(item.time_limit)}` : ""}`;
        const approxWaitHours = (bd.age / (cfg.age_points_per_hour || 5.95)).toFixed(1);

        return `<div class="ladder-row ${item.is_mine ? "mine" : item.is_teammate ? "teammate" : ""} ${item.eligible ? "" : "blocked"}">
          ${rankHtml}
          <div class="ladder-info">
            <div class="ladder-info-top">
              <span>${escapeHtml(item.owner)}</span>
              <span class="acct-tag">${escapeHtml(item.account || "—")}</span>
              ${mineTag}
            </div>
            <div class="ladder-info-sub">${batchDesc}</div>
          </div>
          <div class="ladder-bar-wrap">
            <div class="ladder-stack-track" title="总分 ${item.priority} = FairShare ${bd.fairshare} + Partition ${bd.partition} + Age ${bd.age}">
              <span class="ladder-seg fs" style="width:${fsW.toFixed(2)}%"></span>
              <span class="ladder-seg part" style="width:${partW.toFixed(2)}%"></span>
              <span class="ladder-seg age" style="width:${ageW.toFixed(2)}%"></span>
            </div>
            <div class="ladder-bar-labels">
              <span>公平份额(FairShare): <b>${bd.fairshare}</b> (${((bd.fairshare_norm || 0) * 100).toFixed(2)}%)</span>
              <span>分区(Part): <b>${bd.partition}</b></span>
              <span>排队加成(Age): <b>+${bd.age}</b> (~${approxWaitHours}h)</span>
            </div>
          </div>
          <div class="ladder-right">
            <div class="ladder-prio-num">${item.priority}<small>pts</small></div>
            <span class="status-pill ${item.eligible ? "" : "pending"}">${escapeHtml(item.eligible ? `可调度 · ${reasonCn}` : `阻塞 · ${reasonCn}`)}</span>
          </div>
        </div>`;
      })
      .join("");
  }

  // Render Account FairShare Leaderboard Table
  const filteredAccts = accountsList.filter((a) => {
    if (state.acctFilter === "active") return a.is_active || a.is_mine;
    return true;
  });

  if (!filteredAccts.length) {
    $("#prioAccountsTable").innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted-2);padding:24px 8px;">暂无匹配的课题组账户数据</td></tr>`;
    return;
  }

  $("#prioAccountsTable").innerHTML = filteredAccts
    .map((acct, idx) => {
      const fsPct = Math.min((acct.fairshare_points / 3125) * 100, 100);
      const barColor = fsPct >= 70 ? "var(--green)" : fsPct >= 30 ? "var(--purple)" : "var(--orange)";
      const minePill = acct.is_mine ? `<span class="mine-pill" style="margin-left:6px">我的账户</span>` : "";
      const shareTag = acct.raw_shares === "parent" ? `<span class="acct-tag">parent特权</span>` : "";
      const gpuLoadHtml =
        acct.running_gpus > 0 || acct.pending_gpus > 0
          ? `<span style="color:var(--green)">${acct.running_gpus} 卡运行</span> · <span style="color:var(--orange)">${acct.pending_gpus} 卡排队</span>`
          : `<span style="color:var(--muted-2)">当前空闲</span>`;

      return `<tr style="${acct.is_mine ? "background:rgba(56,214,161,.05)" : ""}">
        <td><b>#${idx + 1}</b></td>
        <td><b>${escapeHtml(acct.account)}</b>${minePill}${shareTag}</td>
        <td>
          <div class="prio-cell-wrap" style="min-width:165px">
            <div class="prio-cell-top">
              <strong>${acct.fairshare_points} <span style="font-weight:400;color:var(--muted)">/ 3125 分</span></strong>
              <small>因子 ${acct.fairshare.toFixed(5)}</small>
            </div>
            <div class="prio-mini-track">
              <span class="ladder-seg" style="width:${Math.max(fsPct, acct.fairshare_points > 0 ? 2 : 0).toFixed(1)}%;background:${barColor}"></span>
            </div>
          </div>
        </td>
        <td><strong style="font-family:'Space Grotesk',sans-serif;color:var(--text)">${acct.base_priority} pts</strong></td>
        <td>${acct.raw_usage_hours.toLocaleString()} 核时</td>
        <td>${(acct.effectv_usage * 100).toFixed(2)}%</td>
        <td>${gpuLoadHtml}</td>
      </tr>`;
    })
    .join("");
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

function render() {
  if (!state.data) return;
  renderStatsAndOverview();
  renderGpusPage();
  renderStoragePage();
  renderJobsPage();
  renderPriorityPage();
  renderSettingsDiag();
}

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

function showToastMessage(message, isError = false) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(showToastMessage.timer);
  showToastMessage.timer = setTimeout(() => toast.classList.remove("show"), 2200);
}

function setView(view, options = {}) {
  const targetView = VIEW_META[view] ? view : "overview";
  state.activeView = targetView;
  document.body.classList.toggle("overview-locked", targetView === "overview");

  $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === targetView));
  $$(".view-page").forEach((page) => page.classList.toggle("active", page.dataset.page === targetView));

  updatePageHeader();

  if (options.updateHash !== false) {
    const newHash = targetView === "overview" ? "#overview" : `#${targetView}`;
    if (window.location.hash !== newHash) {
      history.replaceState(null, "", newHash);
    }
  }

  $(".main-content")?.scrollTo({ top: 0, behavior: "instant" });
  if (targetView === "settings") fetchSettings();
}

function bindEvents() {
  document.addEventListener("click", (event) => {
    const jumpNodeCard = event.target.closest("[data-jump-node]");
    if (jumpNodeCard) {
      state.selectedNode = jumpNodeCard.dataset.jumpNode;
      setView("gpu");
      renderGpusPage();
      return;
    }

    const selectNodeCard = event.target.closest("[data-select-node]");
    if (selectNodeCard) {
      const nodeName = selectNodeCard.dataset.selectNode;
      state.selectedNode = state.selectedNode === nodeName ? "all" : nodeName;
      renderGpusPage();
      return;
    }

    const selectMemberEl = event.target.closest("[data-select-member]");
    if (selectMemberEl) {
      const memberName = selectMemberEl.dataset.selectMember;
      state.selectedMember = state.selectedMember === memberName ? "all" : memberName;
      if (state.activeView !== "jobs") setView("jobs");
      renderJobsPage();
      return;
    }

    const quickJobFilterBtn = event.target.closest("[data-quick-job-filter]");
    if (quickJobFilterBtn) {
      const filterMode = quickJobFilterBtn.dataset.quickJobFilter;
      state.selectedMember = "all";
      state.jobFilter = filterMode;
      renderJobsPage();
      return;
    }

    const simAcctCard = event.target.closest("[data-sim-acct]");
    if (simAcctCard) {
      const acctName = simAcctCard.dataset.simAcct;
      const fsPts = Number(simAcctCard.dataset.simFs) || 0;
      state.simSelectedAcct = acctName;
      state.simFairsharePts = fsPts;
      if ($("#simFsSlider")) $("#simFsSlider").value = fsPts;
      renderPriorityPage();
      showToastMessage(`已加载账户 ${acctName} 的公平份额 (${fsPts} 分)`);
      return;
    }

    const viewBtn = event.target.closest("[data-view]");
    if (viewBtn) {
      setView(viewBtn.dataset.view);
    }
  });

  $("#simFsSlider")?.addEventListener("input", () => {
    state.simSelectedAcct = "";
    $$(".my-acct-card").forEach((el) => el.classList.remove("active-sim"));
    updatePrioritySimulator();
  });

  $("#simAgeSlider")?.addEventListener("input", () => {
    updatePrioritySimulator();
  });

  $$("#prioLadderFilter button").forEach((button) =>
    button.addEventListener("click", () => {
      $$("#prioLadderFilter button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      state.ladderFilter = button.dataset.ladderFilter;
      renderPriorityPage();
    })
  );

  $$("#prioLadderMode button").forEach((button) =>
    button.addEventListener("click", () => {
      $$("#prioLadderMode button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      state.ladderMode = button.dataset.ladderMode;
      renderPriorityPage();
    })
  );

  $$("#prioAccountFilter button").forEach((button) =>
    button.addEventListener("click", () => {
      $$("#prioAccountFilter button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      state.acctFilter = button.dataset.acctFilter;
      renderPriorityPage();
    })
  );

  $("#clearNodeFilterBtn")?.addEventListener("click", () => {
    state.selectedNode = "all";
    renderGpusPage();
  });

  $("#clearMemberFilterBtn")?.addEventListener("click", () => {
    state.selectedMember = "all";
    state.jobFilter = "all";
    renderJobsPage();
  });

  $$("#gpuFilter button").forEach((button) =>
    button.addEventListener("click", () => {
      $$("#gpuFilter button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      state.gpuFilter = button.dataset.filter;
      renderGpusPage();
    })
  );

  $$("#jobFilter button").forEach((button) =>
    button.addEventListener("click", () => {
      $$("#jobFilter button").forEach((item) => item.classList.remove("selected"));
      button.classList.add("selected");
      state.selectedMember = "all";
      state.jobFilter = button.dataset.jobFilter;
      renderJobsPage();
    })
  );

  $("#jobSearchInput")?.addEventListener("input", (event) => {
    state.jobSearch = event.target.value || "";
    renderJobsPage();
  });

  $("#rescanStorageBtn")?.addEventListener("click", () => {
    showToastMessage("已触发主目录空间重新扫描…");
    fetchMetrics(true, true);
  });

  $("#refreshButton").addEventListener("click", () => fetchMetrics(true, true));
  $("#themeButton").addEventListener("click", () => {
    document.body.classList.toggle("light");
    showToastMessage(document.body.classList.contains("light") ? "已切换到浅色主题" : "已切换到深色主题");
  });
  $("#settingsForm").addEventListener("submit", saveSettings);
  $("#testProbeButton").addEventListener("click", () => fetchMetrics(true, true));

  window.addEventListener("hashchange", () => {
    const hashView = window.location.hash.replace(/^#/, "");
    if (VIEW_META[hashView] && hashView !== state.activeView) {
      setView(hashView, { updateHash: false });
    }
  });
}

const initialHash = window.location.hash.replace(/^#/, "");
setView(VIEW_META[initialHash] ? initialHash : "overview", { updateHash: false });

bindEvents();
fetchSettings();
fetchMetrics();
state.timer = setInterval(() => fetchMetrics(false), state.refreshMs);
