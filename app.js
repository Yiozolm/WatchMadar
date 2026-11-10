const state = {
  data: null,
  lang: localStorage.getItem("madar_lang") === "en" ? "en" : "zh",
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
const isEn = () => state.lang === "en";
const t = (zh, en) => (state.lang === "en" ? en : zh);
const escapeHtml = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[ch]));

const I18N_EN = {
  "nav.mainAria": "Main Navigation",
  "nav.overview": "Overview",
  "nav.gpu": "GPU Nodes",
  "nav.storage": "Storage",
  "nav.sysAria": "System Navigation",
  "nav.jobs": "Job Queue",
  "nav.priority": "Priority Rules",
  "nav.settings": "Settings",
  "top.liveMonitor": "Live Monitor",
  "top.refreshNow": "Refresh Now",
  "top.toggleTheme": "Toggle Theme",
  "common.backToOverview": "<span>←</span> Back to Overview",

  "ov.cardGpuTitle": "Click to view per-GPU allocation details",
  "ov.cardGpuOnline": "Online Available GPUs",
  "ov.cardGpuUtil": "Avg Utilization",
  "ov.cardJobsTitle": "Click to view full Slurm job queue",
  "ov.cardActiveJobs": "Running Jobs",
  "ov.cardStorageTitle": "Click to view home directory storage details",
  "ov.cardStorageUsed": "My Home Usage",
  "ov.gpuPanelTitle": "Cluster GPU Overview",
  "ov.gpuDetailBtn": "Per-GPU Details <span>→</span>",
  "ov.gpuPoolLabel": "Cluster Compute Pool Allocation",
  "ov.legendBusy": "Busy",
  "ov.legendIdle": "Idle",
  "ov.legendMaint": "Maint/Down",
  "ov.legendRestricted": "Restricted",
  "ov.kpiBusy": "Allocated (RUNNING)",
  "ov.kpiIdle": "Idle (AVAILABLE)",
  "ov.kpiMaint": "Maint/Drain (DRAIN/DOWN)",
  "ov.kpiRestricted": "Restricted (ADMIN)",
  "ov.metaNodeHealth": "Compute Node Pool Health",
  "ov.metaGpuSpecs": "Accelerator Specifications",
  "ov.metaPrioTitle": "Click to view Slurm scheduling priority rules & queue ladder",
  "ov.metaPrioLabel": "Job Scheduling & My Priority →",
  "ov.footTotalPrefix": "Total",
  "ov.footNodesMid": "GPU nodes ·",
  "ov.footGpusSuffix": "accelerators",
  "ov.viewAllGpuBtn": "View all GPU nodes & per-card status <span>→</span>",
  "ov.stPanelTitle": "Home Directory Storage Overview",
  "ov.stSubdirBtn": "Subdirectories <span>→</span>",
  "ov.stQuotaProgress": "Personal Quota Usage Progress",
  "ov.stMetaAvail": "Available Quota",
  "ov.stMetaTopDir": "Largest Directory",
  "ov.stMetaHomePath": "SSH Home Path",
  "ov.stMetaFsTotal": "Underlying Filesystem Capacity",
  "ov.viewAllStBtn": "View subdirectory usage ranking <span>→</span>",

  "gpu.cardOnline": "Online Available GPUs",
  "gpu.unitCards": "GPUs",
  "gpu.footTotalCards": "Total cluster GPUs",
  "gpu.cardBusy": "Allocated / In Use",
  "gpu.footLiveAlloc": "Live allocation",
  "gpu.cardIdle": "Idle & Schedulable",
  "gpu.footReady": "Ready to allocate",
  "gpu.cardUnavail": "Maint / Restricted",
  "gpu.footUnsched": "Not generally schedulable",
  "gpu.nodesPanelTitle": "Compute Node Status Details",
  "gpu.nodesFilterHint": "Click any node card to filter GPUs below",
  "gpu.showAllNodes": "Show All Nodes",
  "gpu.detailPanelTitle": "Per-GPU Allocation Details",
  "gpu.filterAll": "All",
  "gpu.filterBusy": "Busy",
  "gpu.filterIdle": "Idle",
  "gpu.filterMaint": "Maint/Restricted",
  "gpu.legendRunning": '<i class="legend-dot green"></i>Allocated <b>RUNNING</b>',
  "gpu.legendDrain": '<i class="legend-dot orange"></i>Maint/Drain <b>DRAIN / DOWN</b>',
  "gpu.legendAdmin": '<i class="legend-dot purple"></i>Restricted <b>ADMIN</b>',
  "gpu.legendIdle": '<i class="legend-dot gray"></i>Idle <b>AVAILABLE</b>',
  "gpu.showingPrefix": "Showing",
  "gpu.showingSuffix": "GPUs",

  "st.cardUsed": "Home Directory Used",
  "st.footPersonalUsed": "Personal directory used",
  "st.cardAvail": "Available Quota",
  "st.footQuotaCap": "Quota limit 50 GB",
  "st.footPersonalQuota": "Home directory quota",
  "st.cardTopDir": "Largest Subdirectory",
  "st.cardFs": "Underlying Volume (df)",
  "st.footSharedFs": "Shared filesystem",
  "st.distPanelTitle": "Directory Quota Distribution",
  "st.rescanTitle": "Rescan directory sizes",
  "st.rescanBtn": "↻ Rescan",
  "st.topSubdirsTitle": "Home Directory Breakdown (Top 10)",
  "st.sortBySizeNote": "Sorted by actual size",
  "st.scanScopeNote": "Scope: Top-level & hidden directories (e.g. .conda / .cache)",
  "st.quotaBaseNote": "Quota baseline <b>50 GB</b>",

  "jobs.cardTotal": "Total Queued & Running",
  "jobs.footSlurmQueue": "Slurm queue",
  "jobs.cardRunning": "Running (RUNNING)",
  "jobs.footExecuting": "Currently executing",
  "jobs.cardPending": "Pending (PENDING)",
  "jobs.footWaitReason": "Waiting for resources / priority",
  "jobs.footQueued": "In queue",
  "jobs.cardMineGroup": "My / Group Jobs",
  "jobs.groupPanelTitle": "Research Group Tasks & FairShare Breakdown",
  "jobs.groupShareNote": "Teammates share group FairShare · Click a member card to filter queue",
  "jobs.chipGroupAll": "All Group",
  "jobs.chipTeammates": "Teammates Only",
  "jobs.chipClusterAll": "Show All Cluster",
  "jobs.allQueueTitle": "All Jobs Queue",
  "jobs.gotoPrioBtn": "⇵ Priority Rules & Queue Ladder →",
  "jobs.searchPlaceholder": "Search job / user / account / node…",
  "jobs.filterAll": "All",
  "jobs.filterRunning": "Running",
  "jobs.filterPending": "Pending",
  "jobs.filterGroup": "All Group",
  "jobs.filterTeammates": "Teammates",
  "jobs.filterMine": "My Jobs",
  "jobs.thJob": "Job",
  "jobs.thOwner": "User / Account",
  "jobs.thPart": "Partition",
  "jobs.thNode": "Node",
  "jobs.thGpu": "GPU",
  "jobs.thPrio": "Priority (FairShare+Part+Age)",
  "jobs.thTime": "Elapsed / Limit",
  "jobs.thStatus": "Status",
  "jobs.showingPrefix": "Showing",
  "jobs.showingSuffix": "jobs",

  "prio.cardMine": "My Current Job Priority",
  "prio.cardRank": "My Eligible Queue Rank",
  "prio.cardFsWeight": "FairShare Weight",
  "prio.footNoFairTree": "NO_FAIR_TREE algorithm",
  "prio.cardAge": "Queue Age Bonus (Age)",
  "prio.unitPtsPerHour": " pts/hr",
  "prio.rulesPanelTitle": "Remote HPC Priority Calculation Rules",
  "prio.formulaHead": "Slurm Live Multifactor Priority Formula (recalculated every 5m)",
  "prio.formulaMaxNote": "Theoretical max for ku group: 5,125 pts",
  "prio.termTotal": "Total Priority",
  "prio.termFs": "FairShare (96% dominant)",
  "prio.termFsSub": "ku range: 0 ~ 3,125 pts",
  "prio.termPart": "Partition Base",
  "prio.termPartSub": "gpu/prod fixed 1,000 pts",
  "prio.termAge": "Queue Wait Bonus",
  "prio.termAgeSub": "+5.95 pts/h (max 1,000 pts)",
  "prio.formulaZeroNote":
    "Disabled factors (weight = 0): <b>JobSize = 0</b> (no penalty/bonus by GPU count) · <b>QOS = 0</b> · <b>Assoc = 0</b> · <b>TRES = 0</b>",
  "prio.rule1Title": "01 · FairShare & 7-Day Decay Half-Life",
  "prio.rule1Badge": "Max 3,125 pts",
  "prio.rule1Desc":
    "Uses exponential decay <code>F = 2^(-EffectvUsage / NormShares)</code>. Under the <code>ku</code> root share (<code>0.25</code>), a zero-usage account starts at <code>0.0625 × 50000 = 3125</code> pts. More recent GPU usage raises <code>EffectvUsage</code> and lowers FairShare; it recovers with a <b>7-day half-life</b>.",
  "prio.rule2Title": "02 · Age Linear Wait Compensation",
  "prio.rule2Badge": "+142.9 pts/day",
  "prio.rule2Desc":
    "Eligible pending jobs gain <b>~5.95 pts</b> per hour waited, reaching the <b>1,000 pts</b> cap after <b>7 days (168h)</b>. Note: jobs in <code>Dependency</code> or <code>JobHeldUser</code> states do not compete for immediate scheduling.",
  "prio.rule3Title": "03 · Shared Group FairShare (Share=parent)",
  "prio.rule3Badge": "Shared Score",
  "prio.rule3Desc":
    "With <code>RawShares=parent</code>, all members under the same group account (e.g. <code>kuex0095</code>) <b>share the group's total historical usage and FairShare score</b>. Submitting with a lower-usage account gives a higher starting priority.",
  "prio.rule4Title": "04 · Backfill Scheduling & Non-Preemption",
  "prio.rule4Desc":
    "<code>PreemptMode=OFF</code> means running jobs are never interrupted by higher-priority jobs (up to 3 days in <code>gpu</code>). While the top job waits to gather multiple GPUs, lower-priority jobs requesting <b>fewer GPUs</b> or a <b>shorter <code>--time</code> limit</b> can backfill and start early.",
  "prio.simPanelTitle": "My Accounts Comparison & What-If Simulator",
  "prio.myAcctsSub": "Available Slurm accounts for current user (from <code>sshare</code>)",
  "prio.myAcctsHint": "Click an account to load into simulator",
  "prio.simTitle": "Interactive Priority & Queue Simulator",
  "prio.simFsSliderLabel": "Account FairShare Score (<code>0 ~ 3,125</code>)",
  "prio.simAgeSliderLabel": "Queue Wait Time (<code>0 ~ 168 hrs / 7d</code>)",
  "prio.simOutRank": "Simulated Eligible Rank",
  "prio.simOutAhead": "Competing GPUs Ahead",
  "prio.simOutOvertake": "Wait to Overtake Next",
  "prio.ladderPanelTitle": "Live Pending Queue Priority Ladder",
  "prio.ladderAll": "All Batches",
  "prio.ladderEligible": "Eligible Only",
  "prio.ladderGroup": "Group Pending",
  "prio.ladderMine": "My Pending",
  "prio.modeGroups": "Group by Batch",
  "prio.modeJobs": "Individual Jobs",
  "prio.legendFs": '<i class="legend-dot purple"></i><b>FairShare</b> Score (weight 50,000)',
  "prio.legendPart": '<i class="legend-dot blue"></i><b>Partition</b> Base (fixed 1,000)',
  "prio.legendAge": '<i class="legend-dot orange"></i><b>Age</b> Wait Bonus (weight 1,000)',
  "prio.legendEligible": '<i class="legend-dot green"></i><b>Eligible</b> Competing for GPUs',
  "prio.acctsPanelTitle": "Research Group FairShare & Historical Usage Leaderboard",
  "prio.acctActive": "Active / My Accounts",
  "prio.acctAll": "All Recorded Accounts",
  "prio.thRank": "Rank",
  "prio.thAcct": "Group Account",
  "prio.thFs": "FairShare Factor & Score (Max 3,125)",
  "prio.thBase": "Initial Base Priority",
  "prio.thRaw": "7-Day Decayed Usage (RawUsage)",
  "prio.thEff": "Effective Usage (EffectvUsage)",
  "prio.thLoad": "Live GPU Workload",
  "prio.acctsFootNote":
    "Data from <code>sshare -P -l</code> · Higher FairShare means less recent compute usage and higher initial priority for new jobs",
  "prio.gotoJobsBtn": "View Full Job Queue <span>→</span>",

  "set.panelTitle": "Collector Settings",
  "set.refreshInterval": "Auto-Refresh Interval",
  "set.opt15s": "Every 15 seconds",
  "set.opt30s": "Every 30 seconds",
  "set.opt1m": "Every 1 minute (default)",
  "set.opt2m": "Every 2 minutes",
  "set.opt5m": "Every 5 minutes",
  "set.optOff": "Pause auto-refresh",
  "set.sshHost": "SSH Host Alias / Address",
  "set.sshUser": "SSH Username (Optional)",
  "set.sshUserPlaceholder": "Defaults to ~/.ssh/config",
  "set.sshPort": "SSH Port (Optional)",
  "set.sshPortPlaceholder": "Default 22 or ~/.ssh/config",
  "set.sshTimeout": "SSH Timeout (seconds)",
  "set.forceRefreshBtn": "Force Refresh Now",
  "set.saveBtn": "Save & Apply Settings",
};

const REASON_LABELS_ZH = {
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

const REASON_LABELS_EN = {
  Priority: "Priority",
  Resources: "Resources",
  Dependency: "Dependency",
  DependencyNeverSatisfied: "Unsatisfied Dep",
  JobArrayTaskLimit: "Array Limit",
  JobHeldUser: "Held (User)",
  JobHeldAdmin: "Held (Admin)",
  ReqNodeNotAvail: "Node Maint",
  QOSMaxGRESPerUser: "GPU Quota Limit",
  QOSMaxJobsPerUserLimit: "Max Jobs Limit",
  AssocMaxJobsLimit: "Acct Jobs Limit",
};

function getReasonLabel(reason) {
  if (!reason) return "";
  const map = isEn() ? REASON_LABELS_EN : REASON_LABELS_ZH;
  return map[reason] || reason;
}

function localizeBackendText(value) {
  const str = String(value ?? "");
  if (!isEn() || !str) return str;
  const exactMap = {
    "受限分区": "RESTRICTED",
    "不可调度": "UNAVAILABLE",
    "节点离线 (DOWN)": "Node Offline (DOWN)",
    "系统维护中 (MAINT)": "System Maintenance (MAINT)",
    "等待重启维护": "Reboot Scheduled",
    "维护排空中 (DRAIN)": "Node Draining (DRAIN)",
    "节点预留 (RESERVED)": "Node Reserved (RESERVED)",
    "节点无响应或已下线": "Node not responding or offline",
    "暂停接收新任务": "Not accepting new jobs",
    "资源已预留": "Resources reserved",
    "Available (已预排期)": "Available (Planned)",
    "其他目录与文件": "Other directories & files",
    "其他": "Others",
    "无法连接到采集服务": "Cannot connect to collector service",
  };
  if (exactMap[str]) return exactMap[str];
  if (str.startsWith("受限分区 (")) {
    return str.replace("受限分区 (", "Restricted Partition (");
  }
  const onlyMatch = str.match(/^仅限\s*(.+?)\s*账户$/);
  if (onlyMatch) {
    return `Only ${onlyMatch[1]} accounts`;
  }
  const localErrMatch = str.match(/^无法连接本地采集服务\s*\((.+)\)$/);
  if (localErrMatch) {
    return `Cannot connect to local collector service (${localErrMatch[1]})`;
  }
  return str;
}

const VIEW_META = {
  overview: {
    title: () => t("总览", "Overview"),
    eyebrow: "MADAR HPC / RESOURCE MONITOR",
    headingHtml: (user) =>
      isEn()
        ? `Hello, <span id="greetingUser">${escapeHtml(user)}</span> <small>✦</small>`
        : `你好，<span id="greetingUser">${escapeHtml(user)}</span> <small>✦</small>`,
    subtitle: () =>
      t(
        "一眼掌握集群算力与 SSH 用户目录空间的整体实时状态。",
        "Real-time overview of cluster compute capacity and SSH home directory storage at a glance."
      ),
  },
  gpu: {
    title: () => t("GPU 节点", "GPU Nodes"),
    eyebrow: "COMPUTE / GPU NODES & ALLOCATION",
    headingHtml: () => t("GPU 节点与单卡使用详情", "GPU Nodes & Per-Card Allocation"),
    subtitle: () =>
      t(
        "查看各计算节点负载、单卡 Slurm 分配状态、运行作业及维护信息。",
        "Inspect compute node loads, per-GPU Slurm allocation status, active jobs, and maintenance states."
      ),
  },
  storage: {
    title: () => t("存储空间", "Storage"),
    eyebrow: "SSH USER / HOME DIRECTORY STORAGE",
    headingHtml: () => t("用户目录空间明细", "Home Directory Storage Breakdown"),
    subtitle: () =>
      t(
        "查看 SSH 主目录 50 GB 配额分布、Top 10 子目录体积排行及底层存储卷状态。",
        "View 50 GB SSH home quota distribution, Top 10 subdirectory sizes, and underlying filesystem volume status."
      ),
  },
  jobs: {
    title: () => t("任务队列", "Job Queue"),
    eyebrow: "SCHEDULER / SLURM QUEUE",
    headingHtml: () => t("Slurm 任务队列", "Slurm Job Queue"),
    subtitle: () =>
      t(
        "实时追踪集群运行中与排队中的 GPU 及交互式计算任务，并查看各作业的优先级构成。",
        "Track running and queued GPU & interactive jobs in real time with priority factor breakdowns."
      ),
  },
  priority: {
    title: () => t("优先级规则", "Priority Rules"),
    eyebrow: "SLURM MULTIFACTOR / PRIORITY & FAIRSHARE",
    headingHtml: () => t("调度优先级规则与排队透视", "Scheduling Priority Rules & Live Queue Insights"),
    subtitle: () =>
      t(
        "可视化解析远端 HPC 的多因子优先级公式 (FairShare + Partition + Age)、个人账户对比及实时排队阶梯。",
        "Visualize the HPC multifactor priority formula (FairShare + Partition + Age), account comparisons, and live queue ladder."
      ),
  },
  settings: {
    title: () => t("采集设置", "Settings"),
    eyebrow: "COLLECTOR / SSH CONFIGURATION",
    headingHtml: () => t("数据采集设置", "Collector & SSH Configuration"),
    subtitle: () =>
      t(
        "配置 SSH 连接主机、超时参数与自动轮询刷新策略。",
        "Configure SSH connection host, timeout parameters, and auto-refresh polling intervals."
      ),
  },
};

function applyStaticI18n() {
  document.documentElement.lang = isEn() ? "en" : "zh-CN";
  document.body.classList.toggle("lang-en", isEn());

  $$("#langButton .lang-opt").forEach((el) => {
    el.classList.toggle("active", el.dataset.langOpt === state.lang);
  });

  $$("[data-i18n]").forEach((el) => {
    if (el._zhText === undefined) el._zhText = el.textContent;
    const key = el.dataset.i18n;
    el.textContent = isEn() ? I18N_EN[key] ?? el._zhText : el._zhText;
  });

  $$("[data-i18n-html]").forEach((el) => {
    if (el._zhHtml === undefined) el._zhHtml = el.innerHTML;
    const key = el.dataset.i18nHtml;
    el.innerHTML = isEn() ? I18N_EN[key] ?? el._zhHtml : el._zhHtml;
  });

  $$("[data-i18n-title]").forEach((el) => {
    if (el._zhTitle === undefined) el._zhTitle = el.getAttribute("title") || "";
    const key = el.dataset.i18nTitle;
    el.setAttribute("title", isEn() ? I18N_EN[key] ?? el._zhTitle : el._zhTitle);
  });

  $$("[data-i18n-placeholder]").forEach((el) => {
    if (el._zhPlaceholder === undefined) el._zhPlaceholder = el.getAttribute("placeholder") || "";
    const key = el.dataset.i18nPlaceholder;
    el.setAttribute("placeholder", isEn() ? I18N_EN[key] ?? el._zhPlaceholder : el._zhPlaceholder);
  });

  $$("[data-i18n-aria]").forEach((el) => {
    if (el._zhAria === undefined) el._zhAria = el.getAttribute("aria-label") || "";
    const key = el.dataset.i18nAria;
    el.setAttribute("aria-label", isEn() ? I18N_EN[key] ?? el._zhAria : el._zhAria);
  });

  if (!state.data) {
    const waitText = t("等待数据", "Waiting for data");
    const connText = t("连接中…", "Connecting…");
    $("#collectorStatus").textContent = connText;
    $("#collectorDetail").textContent = t("等待连接服务器…", "Waiting for server…");
    $("#sidebarHome").textContent = t("未连接", "Disconnected");
    $("#lastUpdated").textContent = connText;
    $("#clusterStatus").textContent = connText;
    $("#gpuFootStatus").textContent = waitText;
    $("#utilFootStatus").textContent = waitText;
    $("#storageQuotaFoot").textContent = t("配额 50 GB →", "Quota 50 GB →");
    $("#metricNote").textContent = connText;
    $("#ovGpuAllocRatio").textContent = t("— / — 已分配", "— / — Allocated");
    $("#ovGpuBusySub").textContent = waitText;
    $("#ovGpuIdleSub").textContent = waitText;
    $("#ovGpuMaintSub").textContent = waitText;
    $("#ovGpuRestrictedSub").textContent = waitText;
    $("#ovNodesDetail").textContent = t("等待节点状态数据", "Waiting for node data");
    $("#ovGpuPartitions").textContent = t("Slurm 计算分区", "Slurm partitions");
    $("#ovQueueSub").textContent = t("队列实时状态", "Live queue status");
    $("#storageDonutLabel").textContent = t("共 50 GB", "of 50 GB");
    $("#storageTotal2").textContent = t("总配额 50 GB", "Total quota 50 GB");
    $("#storageHealthState").innerHTML = `<i></i>${connText}`;
    $("#ovStorageAvailSub").textContent = t("配额上限 50 GB", "Quota limit 50 GB");
    $("#ovStorageTopDirSub").textContent = t("等待目录统计", "Waiting for scan");
    $("#ovStorageUserLabel").textContent = connText;
    $("#ovStorageMountLabel").textContent = t("挂载卷状态", "Mount volume status");
    $("#storageHomeFoot").innerHTML = t("主目录 <b>—</b>", "Home <b>—</b>");
    $("#gpuPageNodeFoot").textContent = t("— 个计算节点", "— compute nodes");
    $("#stPageUsedPct").textContent = t("占配额 —%", "—% of quota");
    $("#stPageDirCount").textContent = t("共 0 个子目录", "0 subdirectories");
    $("#stPageMount").textContent = t("挂载点 —", "Mount —");
    $("#storageDetailDonutLabel").textContent = t("共 50 GB", "of 50 GB");
    $("#storageDetailTotal").textContent = t("总容量 50 GB", "Total capacity 50 GB");
    $("#storageDetailHealth").innerHTML = `<i></i>${connText}`;
    $("#storageDetailFoot").innerHTML = t("主目录 <b>—</b>", "Home <b>—</b>");
    $("#jobPageGpuUsed").textContent = t("占用 — 张 GPU", "Using — GPUs");
    $("#jobPageGroupTotal").textContent = t(" / 同组 —", " / Group —");
    $("#jobPageMineUser").textContent = t("当前 SSH 用户", "Current SSH user");
    $("#jobPageGroupFoot").textContent = t("同组他人 —", "Teammates —");
    $("#prioCardMineBreakdown").textContent = waitText;
    $("#prioCardMineAcct").textContent = t("关联账户 —", "Account —");
    $("#prioCardAheadGpus").textContent = t("前序竞争 —", "Competing ahead —");
    $("#prioCardMinePending").textContent = t("排队 —", "Pending —");
    $("#prioCardFsMax").textContent = t("/ ku 上限 3,125分", "/ ku max 3,125 pts");
    $("#prioCardHalfLife").textContent = t("半衰期 7 天衰减", "7-day half-life decay");
    $("#prioCardAgeCap").textContent = t("7 天满额 1,000 分", "Max 1,000 pts at 7 days");
    $("#prioLadderSummaryNote").textContent = t("按总优先级从高到低排序", "Sorted by total priority descending");
    $("#settingsModeBadge").textContent = connText;
    $("#settingsDiag").textContent = t("正在读取采集配置…", "Loading collector configuration…");
    updatePrioritySimulator();
  }
}

function setLanguage(lang, showNotification = true) {
  const nextLang = lang === "en" ? "en" : "zh";
  state.lang = nextLang;
  try {
    localStorage.setItem("madar_lang", nextLang);
  } catch (_) {}
  applyStaticI18n();
  updatePageHeader();
  if (state.data) {
    render();
  }
  if (showNotification) {
    showToastMessage(nextLang === "en" ? "Switched to English" : "已切换为中文界面");
  }
}

function formatTime(iso) {
  if (!iso) return t("刚刚更新", "Just updated");
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return t("刚刚更新", "Just updated");
  const locale = isEn() ? "en-US" : "zh-CN";
  const timeStr = date.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  return isEn() ? `Updated ${timeStr}` : `更新于 ${timeStr}`;
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
  if (!ms || ms <= 0) return t("自动刷新已暂停", "Auto-refresh paused");
  if (ms >= 60000 && ms % 60000 === 0) {
    const mins = ms / 60000;
    return isEn() ? `Every ${mins}m` : `每 ${mins} 分钟刷新`;
  }
  return isEn() ? `Every ${ms / 1000}s` : `每 ${ms / 1000} 秒刷新`;
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
  if (mode === "down") return { cls: "down", label: t("离线 DOWN", "OFFLINE · DOWN") };
  if (mode === "drain" || mode === "reserved")
    return { cls: "maint", label: node.allocated > 0 ? t("排空中 DRAIN", "DRAINING") : t("维护中 MAINT", "MAINT") };
  if (mode === "restricted") return { cls: "restricted", label: t("受限 ADMIN", "RESTRICTED") };
  if (node.allocated >= node.total && node.total > 0) return { cls: "online", label: t("满载 FULL", "FULL") };
  if (node.allocated > 0) return { cls: "online", label: t("运行中 MIXED", "MIXED") };
  return { cls: "idle", label: t("空闲 IDLE", "IDLE") };
}

function updatePageHeader() {
  const meta = VIEW_META[state.activeView] || VIEW_META.overview;
  const isLive = Boolean(state.data?.cluster?.connected && state.data?.cluster?.data_source === "ssh");
  const sshUser = isLive ? state.data?.storage?.user || "user" : "User";
  $("#pageTitle").textContent = meta.title();
  $("#pageEyebrow").textContent = meta.eyebrow;
  $("#pageHeading").innerHTML = meta.headingHtml(sshUser);
  $("#pageSubtitle").textContent = meta.subtitle();
}

function renderStatsAndOverview() {
  const { cluster, storage, gpus = [] } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  const intervalLabel = formatIntervalLabel(state.refreshMs);
  const disconnText = t("未连接", "Disconnected");

  $("#sidebarConnection")?.classList.toggle("disconnected", !isLive);
  $("#topRefreshState")?.classList.toggle("disconnected", !isLive);
  $("#clusterBadge")?.classList.toggle("disconnected", !isLive);
  $("#storageHealthState")?.classList.toggle("disconnected", !isLive);
  $("#storageDetailHealth")?.classList.toggle("disconnected", !isLive);

  $("#collectorStatus").textContent = isLive ? t("已连接", "Connected") : disconnText;
  $("#collectorDetail").textContent = isLive
    ? `Slurm probe · ${intervalLabel}`
    : localizeBackendText(cluster.data_error) || t("未能获取到服务器数据", "Failed to fetch server metrics");
  $("#metricNote").textContent = isLive ? `Slurm GPU allocation · ${intervalLabel}` : disconnText;
  $("#gpuPageMetricNote").textContent = isLive ? `Slurm GPU allocation · ${intervalLabel}` : disconnText;

  updatePageHeader();

  if (!isLive) {
    $("#sidebarUser").textContent = "SSH User";
    $("#sidebarHome").textContent = disconnText;
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
    $("#gpuFootStatus").textContent = disconnText;
    $("#gpuFootStatus").className = "trend up";
    $("#utilFootStatus").textContent = disconnText;
    $("#storageUsed").textContent = "—";
    $("#storageUnit").textContent = " GB";
    $("#storagePercent").textContent = "—";
    $("#storageQuotaFoot").textContent = t("配额 50 GB →", "Quota 50 GB →");
    $("#storageTrack").style.width = "0%";
    $("#storageTrack").style.background = "";
    $("#storageDonut").style.background = `conic-gradient(var(--track) 0 100%)`;
    $("#storageDonutValue").textContent = "—";
    $("#storageDonutLabel").textContent = t("共 50 GB", "of 50 GB");
    $("#storageUsed2").textContent = "—";
    $("#storageUnit2").textContent = "GB";
    $("#storageTotal2").textContent = t("总配额 50 GB", "Total quota 50 GB");
    $("#storageHomeFoot").innerHTML = t("主目录 <b>—</b>", "Home <b>—</b>");
    $("#storageHealthState").innerHTML = `<i></i>${disconnText}`;
    $("#lastUpdated").textContent = disconnText;
    $("#uptime").textContent = "—";
    $("#clusterStatus").textContent = disconnText;
    $("#utilSpark").innerHTML = "";

    // Overview GPU reset
    $("#ovGpuAllocRatio").textContent = t("— / — 已分配", "— / — Allocated");
    $$("#ovGpuStackBar .stack-seg").forEach((el) => (el.style.width = "0%"));
    $("#ovLegendBusy").textContent = "0";
    $("#ovLegendIdle").textContent = "0";
    $("#ovLegendMaint").textContent = "0";
    $("#ovLegendRestricted").textContent = "0";
    $("#ovGpuBusy").textContent = "—";
    $("#ovGpuBusySub").textContent = disconnText;
    $("#ovGpuIdle").textContent = "—";
    $("#ovGpuIdleSub").textContent = disconnText;
    $("#ovGpuMaint").textContent = "—";
    $("#ovGpuMaintSub").textContent = disconnText;
    $("#ovGpuRestricted").textContent = "—";
    $("#ovGpuRestrictedSub").textContent = disconnText;
    $("#ovNodesHealthy").textContent = "—";
    $("#ovNodesDetail").textContent = disconnText;
    $("#ovGpuModels").textContent = "—";
    $("#ovGpuPartitions").textContent = disconnText;
    $("#ovQueueSummary").textContent = "—";
    $("#ovQueueSub").textContent = disconnText;
    $("#ovNodeCount").textContent = "0";
    $("#gpuCount").textContent = "0";

    // Overview Storage reset
    $("#ovStorageQuotaRatio").textContent = "— / 50 GB";
    $("#ovStorageQuotaFill").style.width = "0%";
    $("#ovStorageAvail").textContent = "—";
    $("#ovStorageAvailSub").textContent = t("配额上限 50 GB", "Quota limit 50 GB");
    $("#ovStorageTopDir").textContent = "—";
    $("#ovStorageTopDirSub").textContent = disconnText;
    $("#ovStorageHomePath").textContent = "—";
    $("#ovStorageUserLabel").textContent = disconnText;
    $("#ovStorageFsSummary").textContent = "—";
    $("#ovStorageMountLabel").textContent = disconnText;
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
    gpuFoot.textContent = isEn()
      ? `${maintCount} maint · ${restrictedCount} restricted`
      : `${maintCount} 维护 · ${restrictedCount} 受限(rcadmin)`;
    gpuFoot.className = "trend warn";
  } else if (maintCount > 0) {
    gpuFoot.textContent = isEn() ? `${maintCount} in maint/drain` : `${maintCount} 张维护/排空中`;
    gpuFoot.className = "trend warn";
  } else if (restrictedCount > 0) {
    gpuFoot.textContent = isEn() ? `${restrictedCount} restricted (rcadmin)` : `${restrictedCount} 张受限专用 (rcadmin)`;
    gpuFoot.className = "trend neutral";
  } else {
    gpuFoot.textContent = t("全部在线", "All online");
    gpuFoot.className = "trend up";
  }

  const utilFoot = $("#utilFootStatus");
  if (idleCount === 0 && unavailableCount > 0) {
    utilFoot.textContent = t("可用卡 100% 满载 (0 空闲)", "100% online GPUs busy (0 idle)");
  } else {
    utilFoot.textContent = isEn() ? `${idleCount} idle · live allocation` : `空闲 ${idleCount} 张 · 实时分配率`;
  }

  // Overview GPU Panel
  const capTotal = Math.max(totalGpus, 1);
  const busyPct = (busyCount / capTotal) * 100;
  const idlePct = (idleCount / capTotal) * 100;
  const maintPct = (maintCount / capTotal) * 100;
  const restPct = (restrictedCount / capTotal) * 100;

  $("#ovGpuAllocRatio").textContent = isEn()
    ? `${busyCount} / ${onlineGpus} online GPUs allocated (${totalGpus} total)`
    : `${busyCount} / ${onlineGpus} 可用卡已分配 (总计 ${totalGpus} 张)`;
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

  $("#ovGpuBusy").textContent = isEn() ? `${busyCount} GPUs` : `${busyCount} 张`;
  $("#ovGpuBusySub").textContent = isEn()
    ? `${cluster.gpu_utilization}% of online GPUs`
    : `占可用卡 ${cluster.gpu_utilization}%`;
  $("#ovGpuIdle").textContent = isEn() ? `${idleCount} GPUs` : `${idleCount} 张`;
  $("#ovGpuIdleSub").textContent = idleCount > 0 ? t("可立即调度任务", "Ready for immediate jobs") : t("当前无空闲卡", "No idle GPUs available");
  $("#ovGpuMaint").textContent = isEn() ? `${maintCount} GPUs` : `${maintCount} 张`;
  const maintNodes = nodes.filter((n) => n.mode === "down" || n.mode === "drain" || n.mode === "reserved");
  $("#ovGpuMaintSub").textContent = maintNodes.length
    ? maintNodes.map((n) => n.name).join(", ")
    : t("无维护/离线节点", "No maintenance/offline nodes");
  $("#ovGpuRestricted").textContent = isEn() ? `${restrictedCount} GPUs` : `${restrictedCount} 张`;
  const restNodes = nodes.filter((n) => n.mode === "restricted");
  $("#ovGpuRestrictedSub").textContent = restNodes.length
    ? `${restNodes.map((n) => n.name).join(", ")} (rcadmin)`
    : t("无受限节点", "No restricted nodes");

  $("#ovNodeCount").textContent = nodes.length;
  $("#gpuCount").textContent = totalGpus;

  const normalNodes = nodes.filter((n) => !n.mode || n.mode === "normal");
  const fullNodes = normalNodes.filter((n) => n.allocated >= n.total && n.total > 0);
  const idleNodes = normalNodes.filter((n) => n.allocated === 0);
  const abnormalNodesCount = nodes.length - normalNodes.length;
  $("#ovNodesHealthy").textContent = isEn()
    ? `${normalNodes.length} / ${nodes.length} Nodes Online`
    : `${normalNodes.length} / ${nodes.length} 节点可用`;
  $("#ovNodesDetail").textContent = isEn()
    ? `Full ${fullNodes.length} · Idle ${idleNodes.length} · Maint/Restr ${abnormalNodesCount}`
    : `满载 ${fullNodes.length} · 空闲 ${idleNodes.length} · 维护/受限 ${abnormalNodesCount}`;

  const models = [...new Set(nodes.map((n) => n.model).filter(Boolean))];
  const partitions = [...new Set(nodes.flatMap((n) => n.partitions || []).filter(Boolean))];
  $("#ovGpuModels").textContent = models.length ? models.join(" / ") : "NVIDIA GPU";
  $("#ovGpuPartitions").textContent = partitions.length
    ? isEn()
      ? `Partitions: ${partitions.join(", ")}`
      : `涵盖分区: ${partitions.join(", ")}`
    : isEn()
      ? `${nodes.length} compute nodes`
      : `共 ${nodes.length} 个计算节点`;

  const allJobs = state.data.jobs || [];
  const myJobsCount = allJobs.filter((j) => j.owner === sshUser).length;
  const prioSummary = state.data.priority?.summary || {};
  const myPrio = prioSummary.my_current_priority || 0;
  const myRank = prioSummary.my_eligible_rank;
  $("#priorityNavBadge").textContent = myPrio ? `${myPrio}` : "—";
  if (myPrio && myRank) {
    $("#ovQueueSummary").textContent = isEn() ? `Prio ${myPrio} · Rank #${myRank}` : `优先级 ${myPrio} · 排队顺位 #${myRank}`;
    $("#ovQueueSub").textContent = isEn()
      ? `${prioSummary.my_gpus_ahead || 0} GPUs ahead · My jobs: ${myJobsCount} (View)`
      : `前序 ${prioSummary.my_gpus_ahead || 0} 卡 · 我的任务 ${myJobsCount} 个 (点击透视)`;
  } else if (myPrio) {
    $("#ovQueueSummary").textContent = isEn()
      ? `${cluster.active_jobs} Running / ${cluster.queued_jobs} Pending`
      : `${cluster.active_jobs} 运行 / ${cluster.queued_jobs} 排队`;
    $("#ovQueueSub").textContent = isEn()
      ? `My Prio ${myPrio} · ${myJobsCount} jobs (Click for details)`
      : `我的优先级 ${myPrio} · 任务 ${myJobsCount} 个 (点击透视)`;
  } else {
    $("#ovQueueSummary").textContent = isEn()
      ? `${cluster.active_jobs} Running / ${cluster.queued_jobs} Pending`
      : `${cluster.active_jobs} 运行 / ${cluster.queued_jobs} 排队`;
    $("#ovQueueSub").textContent = isEn() ? `My jobs: ${myJobsCount}` : `当前用户任务: ${myJobsCount} 个`;
  }

  // Overview Storage Panel
  const homeUsedGb = storage.home_used_gb ?? storage.used_tb * 1000;
  const quotaGb = storage.home_quota_gb || HOME_QUOTA_GB;
  const availGb = Math.max(quotaGb - homeUsedGb, 0);
  const usedQuotaPct = Math.min((homeUsedGb / quotaGb) * 100, 100);
  const subdirs = storage.subdirs || [];
  const isInitialScan = Boolean(storage.scanning && homeUsedGb === 0 && !subdirs.length);
  const homeSize = formatSizeParts(homeUsedGb);

  $("#storageNavCount").textContent = isInitialScan ? "…" : `${Math.round(usedQuotaPct)}%`;
  $("#storageUsed").textContent = isInitialScan ? t("扫描中", "Scanning") : homeSize.number;
  $("#storageUnit").textContent = isInitialScan ? "" : ` ${homeSize.unit}`;
  $("#storagePercent").textContent = homePath;
  $("#storageQuotaFoot").textContent = isEn()
    ? `${formatSizeText(availGb)} free / ${quotaGb} GB →`
    : `剩余 ${formatSizeText(availGb)} / ${quotaGb} GB →`;
  $("#storageTrack").style.width = `${Math.max(usedQuotaPct, homeUsedGb > 0 ? 2 : 0)}%`;
  $("#storageTrack").style.background = usedQuotaPct >= 85 ? "var(--danger)" : usedQuotaPct >= 65 ? "var(--orange)" : "var(--green)";

  $("#storageDonut").style.background = buildOverallDonutGradient(homeUsedGb, quotaGb);
  $("#storageDonutValue").textContent = isInitialScan ? "…" : `${usedQuotaPct.toFixed(1)}%`;
  $("#storageDonutLabel").textContent = isEn() ? `of ${quotaGb} GB` : `共 ${quotaGb} GB`;
  $("#storageUsed2").textContent = isInitialScan ? t("扫描中", "Scanning") : homeSize.number;
  $("#storageUnit2").textContent = isInitialScan ? "" : homeSize.unit;
  $("#storageTotal2").innerHTML = isEn()
    ? `Available <b>${escapeHtml(formatSizeText(availGb))}</b> / Total <b>${quotaGb} GB</b>`
    : `剩余可用 <b>${escapeHtml(formatSizeText(availGb))}</b> / 共 <b>${quotaGb} GB</b>`;
  $("#storageHomeFoot").innerHTML = isEn()
    ? `Home <b>${escapeHtml(homePath)}</b>`
    : `主目录 <b>${escapeHtml(homePath)}</b>`;
  $("#storageHealthState").innerHTML = storage.scanning
    ? t("<i></i>后台统计目录中…", "<i></i>Scanning directories in background…")
    : t("<i></i>用户目录状态正常", "<i></i>Home directory healthy");

  $("#ovStorageQuotaRatio").textContent = isInitialScan
    ? isEn()
      ? `Scanning / ${quotaGb} GB`
      : `正在统计 / ${quotaGb} GB`
    : `${formatSizeText(homeUsedGb)} / ${quotaGb} GB (${usedQuotaPct.toFixed(1)}%)`;
  const quotaFill = $("#ovStorageQuotaFill");
  quotaFill.style.width = `${Math.max(usedQuotaPct, homeUsedGb > 0 ? 2 : 0)}%`;
  quotaFill.classList.toggle("warn", usedQuotaPct >= 75);

  $("#ovStorageAvail").textContent = isInitialScan ? t("计算中…", "Calculating…") : formatSizeText(availGb);
  $("#ovStorageAvailSub").textContent = isEn() ? `Personal quota limit ${quotaGb} GB` : `个人配额上限 ${quotaGb} GB`;

  if (subdirs.length > 0) {
    const topDir = subdirs[0];
    const topSize = formatSizeText(topDir.used_gb ?? topDir.used_mb / 1000);
    const topName = localizeBackendText(topDir.name);
    $("#ovStorageTopDir").textContent = `${topName} (${topSize})`;
    $("#ovStorageTopDirSub").textContent = isEn()
      ? `${subdirs.length} top-level dirs · ${topDir.share_pct}% of used`
      : `已统计 ${subdirs.length} 个一级目录 · 占已用 ${topDir.share_pct}%`;
  } else {
    $("#ovStorageTopDir").textContent = storage.scanning ? t("后台扫描中…", "Scanning…") : t("暂无大目录", "No large dirs");
    $("#ovStorageTopDirSub").textContent = storage.scanning
      ? t("正在执行 du 统计", "Running du scan")
      : t("主目录空间充裕", "Plenty of free space");
  }

  $("#ovStorageHomePath").textContent = homePath;
  $("#ovStorageUserLabel").textContent = isEn() ? `SSH user: ${sshUser}` : `SSH 登录用户: ${sshUser}`;

  if (storage.fs_total_tb) {
    $("#ovStorageFsSummary").textContent = `${storage.fs_used_tb} / ${storage.fs_total_tb} TB`;
    $("#ovStorageMountLabel").textContent = isEn()
      ? `Mount ${storage.mount || "/home"} (${storage.fs_avail_tb} TB free)`
      : `挂载卷 ${storage.mount || "/home"} (剩余 ${storage.fs_avail_tb} TB)`;
  } else {
    $("#ovStorageFsSummary").textContent = "—";
    $("#ovStorageMountLabel").textContent = isEn() ? `Mount ${storage.mount || "/home"}` : `挂载卷 ${storage.mount || "/home"}`;
  }

  $("#lastUpdated").textContent = formatTime(cluster.last_updated);
  $("#uptime").textContent = cluster.uptime;
  $("#clusterStatus").textContent =
    maintCount > 0
      ? isEn()
        ? `Healthy (${maintCount} maint)`
        : `运行正常 (${maintCount}卡维护)`
      : cluster.status === "healthy"
        ? t("运行正常", "Healthy")
        : t("需关注", "Attention");
  renderSpark();
}

function renderGpusPage() {
  const { cluster, gpus = [] } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  if (!isLive) {
    $("#gpuPageOnline").textContent = "—";
    $("#gpuPageTotal").textContent = "—";
    $("#gpuPageNodeFoot").textContent = t("未连接", "Disconnected");
    $("#gpuPageBusy").textContent = "—";
    $("#gpuPageUtil").textContent = "—";
    $("#gpuPageIdle").textContent = "—";
    $("#gpuPageUnavail").textContent = "—";
    $("#gpuPageNodeGrid").innerHTML = `<div class="empty-state">${t("未连接服务器，暂无节点状态数据", "Disconnected from server. No node status data available.")}</div>`;
    $("#gpuGrid").innerHTML = `<div class="empty-state">${t("未连接服务器，暂无 GPU 节点数据", "Disconnected from server. No GPU data available.")}</div>`;
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
  $("#gpuPageNodeFoot").textContent = isEn() ? `Across ${nodes.length} compute nodes` : `分布在 ${nodes.length} 个计算节点`;
  $("#gpuPageBusy").textContent = busyCount;
  $("#gpuPageUtil").textContent = cluster.gpu_utilization;
  $("#gpuPageIdle").textContent = idleCount;
  $("#gpuPageUnavail").textContent = maintCount + restrictedCount;
  $("#gpuPageUnavailFoot").textContent = isEn()
    ? `${maintCount} maint · ${restrictedCount} restricted (rcadmin)`
    : `${maintCount} 维护 · ${restrictedCount} 受限(rcadmin)`;

  $("#clearNodeFilterBtn")?.classList.toggle("selected", state.selectedNode === "all");
  $("#gpuActiveNodeTag").textContent =
    state.selectedNode === "all"
      ? ""
      : isEn()
        ? `· Filtered by node: ${state.selectedNode}`
        : `· 已筛选节点: ${state.selectedNode}`;

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
      const partText = node.partitions?.length
        ? isEn()
          ? `Part: ${node.partitions.join(",")}`
          : `分区: ${node.partitions.join(",")}`
        : isEn()
          ? `State: ${node.state}`
          : `状态: ${node.state}`;
      const reasonText = node.reason ? localizeBackendText(node.reason) : partText;
      const allocLabel = isEn()
        ? `Allocated <b>${node.allocated} / ${node.total}</b> GPUs`
        : `占用 <b>${node.allocated} / ${node.total}</b> 卡`;
      return `<div class="node-detail-card ${selectedCls}" data-select-node="${escapeHtml(node.name)}">
        <div class="node-mini-top">
          <div class="node-mini-name"><span>${escapeHtml(node.name)}</span><span class="node-mini-model">${escapeHtml(node.model)}</span></div>
          <span class="node-badge ${badge.cls}">${badge.label}</span>
        </div>
        <div class="util-bar"><span class="${barCls}" style="width:${barWidth}%"></span></div>
        <div class="node-mini-meta">
          <span>${allocLabel}</span>
          <span>${escapeHtml(reasonText)}</span>
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
        ? t("当前筛选范围内没有处于维护或受限状态的 GPU", "No GPUs in maintenance or restricted state for the current filter")
        : state.gpuFilter === "idle"
          ? t("当前筛选范围内所有可用 GPU 均已满载，无空闲卡", "All online GPUs in the current filter are busy (0 idle)")
          : t("无匹配的 GPU 节点", "No matching GPUs found");
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
      const utilLabel = localizeBackendText(gpu.util_label || "GPU UTIL");
      const processText = localizeBackendText(gpu.process);
      const ownerText = localizeBackendText(gpu.owner);
      const barHtml = isMaint
        ? `<span class="maint ${isDown ? "down" : isRestricted ? "restricted" : ""}" style="width:100%"></span>`
        : `<span class="${utilClass(gpu.utilization)}" style="width:${gpu.utilization}%"></span>`;
      const tooltipParts = [`${gpu.node} / ${gpu.model}`];
      if (gpu.node_state) tooltipParts.push(isEn() ? `Node State: ${gpu.node_state}` : `节点状态: ${gpu.node_state}`);
      if (gpu.node_reason) tooltipParts.push(isEn() ? `Reason: ${localizeBackendText(gpu.node_reason)}` : `原因: ${gpu.node_reason}`);
      return `<div class="gpu-tile ${tileClass}" title="${escapeHtml(tooltipParts.join(" · "))}">
      <div class="tile-head"><span>${escapeHtml(gpu.id)}</span><i class="gpu-status ${dotClass}"></i></div>
      <div class="gpu-util"><strong>${escapeHtml(utilDisplay)}</strong><span>${escapeHtml(utilLabel)}</span></div>
      <div class="util-bar">${barHtml}</div>
      <div class="gpu-meta"><span>MEM <b>${memory}</b></span><span>${rightMeta}</span></div>
      <div class="gpu-process"><strong>${escapeHtml(processText)}</strong>${ownerText ? ` · ${escapeHtml(ownerText)}` : ""}</div>
    </div>`;
    })
    .join("");

  $("#gpuShown").textContent = filtered.length;
  $("#gpuCountDetail").textContent = totalGpus;
}

function renderStoragePage() {
  const { cluster, storage } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh");
  const disconnText = t("未连接", "Disconnected");
  if (!isLive) {
    $("#stPageUsed").textContent = "—";
    $("#stPageUsedUnit").textContent = " GB";
    $("#stPageUsedPct").textContent = disconnText;
    $("#stPageAvail").textContent = "—";
    $("#stPageAvailUnit").textContent = " GB";
    $("#stPageTopSize").textContent = "—";
    $("#stPageTopUnit").textContent = "";
    $("#stPageTopName").textContent = "—";
    $("#stPageDirCount").textContent = t("共 0 个子目录", "0 subdirectories");
    $("#stPageFsUsed").textContent = "—";
    $("#stPageFsTotal").textContent = "/ — TB";
    $("#stPageMount").textContent = disconnText;
    $("#storageDetailDonut").style.background = `conic-gradient(var(--track) 0 100%)`;
    $("#storageDetailDonutValue").textContent = "—";
    $("#storageDetailDonutLabel").textContent = t("共 50 GB", "of 50 GB");
    $("#storageDetailUsed").textContent = "—";
    $("#storageDetailUnit").textContent = "GB";
    $("#storageDetailTotal").textContent = t("总容量 50 GB", "Total capacity 50 GB");
    $("#storageDetailHealth").innerHTML = `<i></i>${disconnText}`;
    $("#storageDetailFoot").innerHTML = t("主目录 <b>—</b>", "Home <b>—</b>");
    $("#storagePaths").innerHTML = `<div class="empty-state">${t("未连接服务器，暂无目录空间数据", "Disconnected from server. No directory storage data available.")}</div>`;
    $("#usersList").innerHTML = `<div class="empty-state">${t("未连接服务器，暂无主目录明细", "Disconnected from server. No home directory breakdown available.")}</div>`;
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

  $("#stPageUsed").textContent = isInitialScan ? t("扫描中", "Scanning") : usedParts.number;
  $("#stPageUsedUnit").textContent = isInitialScan ? "" : ` ${usedParts.unit}`;
  $("#stPageUsedPct").textContent = isEn()
    ? `${usedQuotaPct.toFixed(1)}% of ${quotaGb} GB quota`
    : `占 ${quotaGb} GB 配额的 ${usedQuotaPct.toFixed(1)}%`;

  $("#stPageAvail").textContent = isInitialScan ? "…" : availParts.number;
  $("#stPageAvailUnit").textContent = isInitialScan ? "" : ` ${availParts.unit}`;

  if (subdirs.length > 0) {
    const top = subdirs[0];
    const topParts = formatSizeParts(top.used_gb ?? top.used_mb / 1000);
    $("#stPageTopSize").textContent = topParts.number;
    $("#stPageTopUnit").textContent = ` ${topParts.unit}`;
    $("#stPageTopName").textContent = isEn() ? `Dir: ${localizeBackendText(top.name)}` : `目录: ${top.name}`;
    $("#stPageDirCount").textContent = isEn() ? `Top ${subdirs.length} directories` : `前 ${subdirs.length} 大目录`;
  } else {
    $("#stPageTopSize").textContent = "—";
    $("#stPageTopUnit").textContent = "";
    $("#stPageTopName").textContent = storage.scanning ? t("正在扫描…", "Scanning…") : t("无子目录", "No subdirectories");
    $("#stPageDirCount").textContent = t("共 0 个子目录", "0 subdirectories");
  }

  $("#stPageFsUsed").textContent = storage.fs_used_tb ?? "—";
  $("#stPageFsTotal").textContent = `/ ${storage.fs_total_tb ?? "—"} TB`;
  $("#stPageMount").textContent = isEn() ? `Mount ${storage.mount || "/home"}` : `挂载点 ${storage.mount || "/home"}`;

  $("#storageDetailDonut").style.background = buildSubdirPieGradient(pieItems, quotaGb, homeUsedGb);
  $("#storageDetailDonutValue").textContent = isInitialScan ? "…" : `${usedQuotaPct.toFixed(1)}%`;
  $("#storageDetailDonutLabel").textContent = isEn() ? `of ${quotaGb} GB` : `共 ${quotaGb} GB`;
  $("#storageDetailUsed").textContent = isInitialScan ? t("扫描中", "Scanning") : usedParts.number;
  $("#storageDetailUnit").textContent = isInitialScan ? "" : usedParts.unit;
  $("#storageDetailTotal").innerHTML = isEn()
    ? `Available <b>${escapeHtml(formatSizeText(availGb))}</b> / Total <b>${quotaGb} GB</b>`
    : `剩余可用 <b>${escapeHtml(formatSizeText(availGb))}</b> / 共 <b>${quotaGb} GB</b>`;
  $("#storageDetailFoot").innerHTML = isEn()
    ? `Home <b>${escapeHtml(homePath)}</b>`
    : `主目录 <b>${escapeHtml(homePath)}</b>`;
  $("#storageDetailHealth").innerHTML = storage.scanning
    ? t("<i></i>后台统计目录中…", "<i></i>Scanning directories in background…")
    : t("<i></i>各子目录空间统计完成", "<i></i>Subdirectory scan complete");

  if (!paths.length) {
    const emptyMsg = storage.scanning
      ? t("正在后台统计用户目录各文件夹占比…", "Calculating directory usage breakdown in background…")
      : t("主目录为空或暂无子目录数据", "Home directory is empty or no subdirectory data available");
    $("#storagePaths").innerHTML = `<div class="empty-state">${emptyMsg}</div>`;
  } else {
    $("#storagePaths").innerHTML = paths
      .map((item, idx) => {
        const usedGb = item.used_gb ?? item.used_tb * 1000;
        const pct = Number(item.pct ?? (usedGb / quotaGb) * 100);
        const color = PIE_COLORS[idx % PIE_COLORS.length];
        const pathLabel = localizeBackendText(item.path);
        const titleText = isEn()
          ? `${pathLabel}: ${formatSizeText(usedGb)} (${pct.toFixed(1)}% of ${quotaGb}GB quota)`
          : `${item.path}: ${formatSizeText(usedGb)} (占 ${quotaGb}GB 配额的 ${pct.toFixed(1)}%)`;
        return `<div class="path-row" title="${escapeHtml(titleText)}">
          <span class="path-name"><i class="path-dot" style="background:${color}"></i>${escapeHtml(pathLabel)}</span>
          <div class="path-track"><span style="width:${Math.max(pct, usedGb > 0 ? 2 : 0)}%;background:${color}"></span></div>
          <span class="path-value">${escapeHtml(formatSizeText(usedGb))}</span>
        </div>`;
      })
      .join("");
  }

  if (!subdirs.length) {
    const msg = storage.scanning
      ? t("正在后台统计主目录各文件夹大小…", "Scanning home directory folder sizes in background…")
      : t("主目录为空或暂无子目录明细", "Home directory is empty or no subdirectory breakdown available");
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
      const nameLabel = localizeBackendText(item.name);
      const rowTitle = isEn()
        ? `${nameLabel}: ${sizeLabel} (${item.share_pct}% of used · ${quotaPct}% of quota)`
        : `${item.name}: ${sizeLabel} (占已用空间 ${item.share_pct}% · 占配额 ${quotaPct}%)`;
      const shareText = isEn()
        ? `${item.share_pct}% of used · ${quotaPct}% of quota`
        : `占已用 ${item.share_pct}% · 配额 ${quotaPct}%`;
      return `<div class="user-row" title="${escapeHtml(rowTitle)}">
        <span class="user-rank">${String(index + 1).padStart(2, "0")}</span>
        <span class="user-avatar">${icon}</span>
        <div class="user-name">
          <div class="user-name-head">
            <span>${escapeHtml(nameLabel)}</span>
            <small>${shareText}</small>
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
  const reasonText = isPending && job.reason ? getReasonLabel(job.reason) : "";
  const statusLabel = reasonText ? `PENDING · ${reasonText}` : job.status;
  const statusTitle =
    isPending && job.reason
      ? isEn()
        ? `Pending reason: ${job.reason}`
        : `排队原因: ${job.reason}`
      : job.node
        ? isEn()
          ? `Node: ${job.node}`
          : `运行节点: ${job.node}`
        : "";
  const nodeCell = job.node ? escapeHtml(job.node) : `<span style="color:var(--muted-2)">—</span>`;
  const acctHtml = job.account ? `<span class="acct-tag">${escapeHtml(job.account)}</span>` : "";
  const relationHtml = isMine
    ? `<span class="mine-pill" style="margin-left:5px">${t("我", "Me")}</span>`
    : isTeammate
      ? `<span class="group-pill" style="margin-left:5px">${t("同组", "Group")}</span>`
      : "";

  const prio = Number(job.priority) || 0;
  const bd = job.prio_breakdown || { fairshare: 0, partition: 0, age: 0 };
  const cap = 4500;
  const fsPct = Math.min((bd.fairshare / cap) * 100, 100);
  const partPct = Math.min((bd.partition / cap) * 100, 100 - fsPct);
  const agePct = Math.min((bd.age / cap) * 100, Math.max(100 - fsPct - partPct, 0));
  const prioTooltip = isEn()
    ? `Total Priority ${prio} = FairShare ${bd.fairshare} + Partition ${bd.partition} + Age ${bd.age}`
    : `总优先级 ${prio} = 公平份额(FairShare) ${bd.fairshare} + 分区(Partition) ${bd.partition} + 排队时长(Age) ${bd.age}`;
  const ownerTitle = isEn() ? `Click to filter jobs by ${job.owner}` : `点击只看 ${job.owner} 的任务`;
  const timeText = job.time_limit ? `${escapeHtml(job.elapsed)} / <span style="color:var(--muted-2)">${escapeHtml(job.time_limit)}</span>` : escapeHtml(job.elapsed);
  const rowStyle = isMine
    ? `style="background:rgba(56,214,161,.04)"`
    : isTeammate
      ? `style="background:rgba(95,169,255,.04)"`
      : "";

  return `<tr ${rowStyle}>
    <td>${escapeHtml(job.name)}<span class="job-id">${escapeHtml(job.id)}</span></td>
    <td class="owner"><span class="owner-link" data-select-member="${escapeHtml(job.owner)}" title="${escapeHtml(ownerTitle)}">${escapeHtml(job.owner)}</span>${acctHtml}${relationHtml}</td>
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
  const disconnText = t("未连接", "Disconnected");
  if (!isLive) {
    $("#jobPageTotal").textContent = "—";
    $("#jobPageRunning").textContent = "—";
    $("#jobPageGpuUsed").textContent = disconnText;
    $("#jobPagePending").textContent = "—";
    $("#jobPageMine").textContent = "—";
    $("#jobPageGroupTotal").textContent = t(" / 同组 —", " / Group —");
    $("#jobPageMineUser").textContent = disconnText;
    $("#jobPageGroupFoot").textContent = t("同组他人 —", "Teammates —");
    $("#jobGroupAcctTag").textContent = "";
    $("#jobActiveMemberTag").textContent = "";
    $("#groupMembersGrid").innerHTML = `<div class="empty-state">${t("未连接服务器，暂无同组人员数据", "Disconnected from server. No research group member data available.")}</div>`;
    $("#jobsShownCount").textContent = "0";
    $("#jobsTotalCount").textContent = "0";
    $("#jobsTable").innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted-2);padding:24px 8px;">${t("未连接服务器，暂无任务队列数据", "Disconnected from server. No job queue data available.")}</td></tr>`;
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
  $("#jobPageGpuUsed").textContent = isEn() ? `Using ${runningGpuSum} GPUs` : `共占用 ${runningGpuSum} 张 GPU`;
  $("#jobPagePending").textContent = pendingJobs.length;
  $("#jobPageMine").textContent = myJobs.length;
  $("#jobPageGroupTotal").textContent = isEn() ? ` / Group ${groupJobsCount}` : ` / 同组 ${groupJobsCount} 个`;
  $("#jobPageMineUser").textContent = isEn()
    ? `Me: ${myRunningCount} run · ${myPendingCount} pend`
    : `我: ${myRunningCount} 运行 · ${myPendingCount} 排队`;
  $("#jobPageGroupFoot").textContent = isEn()
    ? `Teammates: ${groupInfo.teammate_running_jobs ?? 0} run · ${groupInfo.teammate_pending_jobs ?? 0} pend`
    : `同组他人: ${groupInfo.teammate_running_jobs ?? 0} 运行 · ${groupInfo.teammate_pending_jobs ?? 0} 排队`;

  const primaryAcct = groupInfo.primary_account || "";
  $("#jobGroupAcctTag").textContent = primaryAcct
    ? isEn()
      ? `· Group ${primaryAcct} (${members.length} members · ${groupInfo.running_gpus ?? 0} GPUs running / ${groupInfo.pending_gpus ?? 0} queued)`
      : `· 课题组 ${primaryAcct} (共 ${members.length} 人 · 组内在跑 ${groupInfo.running_gpus ?? 0} 卡 / 排队 ${groupInfo.pending_gpus ?? 0} 卡)`
    : "";

  if ($("#filterGroupAllChip"))
    $("#filterGroupAllChip").textContent = isEn() ? `All Group (${groupJobsCount})` : `同组全部 (${groupJobsCount})`;
  if ($("#filterTeammatesChip"))
    $("#filterTeammatesChip").textContent = isEn() ? `Teammates Only (${teammateJobsCount})` : `仅同组他人 (${teammateJobsCount})`;

  syncJobFilterButtons();

  if (!members.length) {
    $("#groupMembersGrid").innerHTML = `<div class="empty-state">${t("暂无同组人员关联记录", "No associated group member records found")}</div>`;
  } else {
    $("#groupMembersGrid").innerHTML = members
      .map((m) => {
        const isSelected = state.selectedMember === m.user;
        const badgeCls = m.is_me ? "online" : m.running_jobs > 0 ? "online" : m.pending_jobs > 0 ? "maint" : "idle";
        const badgeText = m.is_me
          ? isEn()
            ? `Me · ${m.total_jobs} jobs`
            : `我 · ${m.total_jobs} 任务`
          : m.total_jobs > 0
            ? isEn()
              ? `Group · ${m.total_jobs} jobs`
              : `同组 · ${m.total_jobs} 任务`
            : isEn()
              ? `Group · Idle`
              : `同组 · 空闲`;
        const barColor = m.is_me ? "var(--green)" : m.usage_share_pct >= 40 ? "var(--orange)" : "var(--blue)";
        const cardTitle = isEn() ? `Click to filter jobs by ${m.user}` : `点击筛选 ${m.user} 的实验任务`;
        const barTitle = isEn()
          ? `7-day decayed usage is ${m.usage_share_pct}% of group total`
          : `近7天衰减消耗占全组 ${m.usage_share_pct}%`;
        const runStatHtml = isEn()
          ? `Running <b class="run">${m.running_jobs}</b> (${m.running_gpus} GPUs)`
          : `运行 <b class="run">${m.running_jobs}</b> (${m.running_gpus}卡)`;
        const pendStatHtml = isEn()
          ? `Pending <b class="pend">${m.pending_jobs}</b> (${m.pending_gpus} GPUs)`
          : `排队 <b class="pend">${m.pending_jobs}</b> (${m.pending_gpus}卡)`;
        const metaLeft = isEn()
          ? `7d Usage <b>${m.raw_usage_hours.toLocaleString()}h</b>`
          : `7天消耗 <b>${m.raw_usage_hours.toLocaleString()}h</b>`;
        const metaRight = isEn()
          ? `Group Share <b>${m.usage_share_pct}%</b>`
          : `占全组消耗 <b>${m.usage_share_pct}%</b>`;
        return `<div class="node-detail-card ${isSelected ? "selected" : ""}" data-select-member="${escapeHtml(m.user)}" title="${escapeHtml(cardTitle)}">
          <div class="node-mini-top">
            <div class="node-mini-name">
              <span>${escapeHtml(m.user)}</span>
              <span class="node-mini-model">${escapeHtml(m.account)}</span>
            </div>
            <span class="node-badge ${badgeCls}">${escapeHtml(badgeText)}</span>
          </div>
          <div class="member-job-stats">
            <span>${runStatHtml}</span>
            <span>${pendStatHtml}</span>
          </div>
          <div class="util-bar" title="${escapeHtml(barTitle)}">
            <span style="width:${Math.max(m.usage_share_pct, m.raw_usage > 0 ? 3 : 0)}%;background:${barColor}"></span>
          </div>
          <div class="node-mini-meta">
            <span>${metaLeft}</span>
            <span>${metaRight}</span>
          </div>
        </div>`;
      })
      .join("");
  }

  let activeFilterLabel = "";
  if (state.selectedMember !== "all") {
    const isMeSelected = state.selectedMember === sshUser;
    activeFilterLabel = isEn()
      ? `· Filtered member: ${state.selectedMember}${isMeSelected ? " (Me)" : " (Group)"}`
      : `· 已筛选成员: ${state.selectedMember}${isMeSelected ? " (我)" : " (同组)"}`;
  } else if (state.jobFilter === "group") {
    activeFilterLabel = isEn()
      ? `· Filtered: All Group Jobs (${primaryAcct || "Group"})`
      : `· 已筛选: 同组全部任务 (${primaryAcct || "同组"})`;
  } else if (state.jobFilter === "teammates") {
    activeFilterLabel = isEn()
      ? `· Filtered: Teammates' Jobs (excluding me)`
      : `· 已筛选: 同组其他成员任务 (不含本人)`;
  } else if (state.jobFilter === "mine") {
    activeFilterLabel = isEn() ? `· Filtered: My Jobs (${sshUser})` : `· 已筛选: 我的任务 (${sshUser})`;
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
    $("#jobsTable").innerHTML = `<tr><td colspan="8" style="text-align:center;color:var(--muted-2);padding:24px 8px;">${t("无符合筛选条件的任务", "No jobs match the current filter")}</td></tr>`;
    return;
  }
  $("#jobsTable").innerHTML = filtered.map((job) => renderJobRowHtml(job, sshUser)).join("");
}

function updatePrioritySimulator() {
  const prioData = state.data?.priority;
  const isLive = Boolean(state.data?.cluster?.connected && prioData?.config?.weights);
  const fsSlider = $("#simFsSlider");
  const ageSlider = $("#simAgeSlider");
  const fsPts = Number(fsSlider?.value ?? state.simFairsharePts ?? 1028);
  const ageHours = Number(ageSlider?.value ?? state.simAgeHours ?? 0);
  if (!isLive) {
    const fallbackAgePts = Math.round((ageHours / 168) * 1000);
    $("#simFsValLabel").textContent = isEn()
      ? `${fsPts.toLocaleString()} pts (${((fsPts / 3125) * 100).toFixed(1)}%)`
      : `${fsPts.toLocaleString()} 分 (占比 ${((fsPts / 3125) * 100).toFixed(1)}%)`;
    $("#simAgeValLabel").textContent = isEn()
      ? `${ageHours} hrs (+${fallbackAgePts} pts)`
      : `${ageHours} 小时 (+${fallbackAgePts} 分)`;
    $("#simResultTotal").textContent = t("预计总分: —", "Est. Total: —");
    $("#simRankResult").textContent = "—";
    $("#simRankSub").textContent = t("在当前可调度队列中的位置", "Position in current eligible queue");
    $("#simAheadGpusResult").textContent = "—";
    $("#simAheadSub").textContent = t("优先级高于此分数的待分配卡数", "Pending GPUs with higher priority");
    $("#simOvertakeResult").textContent = "—";
    $("#simOvertakeSub").textContent = t("按 +5.95 分/小时差值推算", "Estimated at +5.95 pts/hr");
    return;
  }

  const cfg = prioData.config;
  const wPart = cfg.weights?.partition ?? 1000;
  const wAge = cfg.weights?.age ?? 1000;
  const maxAgeHours = cfg.max_age_hours || 168;
  const ratePerHour = cfg.age_points_per_hour || 5.95;

  state.simFairsharePts = fsPts;
  state.simAgeHours = ageHours;

  const agePts = Math.round((ageHours / maxAgeHours) * wAge);
  const totalSimPrio = fsPts + wPart + agePts;

  $("#simFsValLabel").textContent = isEn()
    ? `${fsPts.toLocaleString()} pts (${((fsPts / 3125) * 100).toFixed(1)}%)`
    : `${fsPts.toLocaleString()} 分 (占比 ${((fsPts / 3125) * 100).toFixed(1)}%)`;
  $("#simAgeValLabel").textContent = isEn() ? `${ageHours} hrs (+${agePts} pts)` : `${ageHours} 小时 (+${agePts} 分)`;
  $("#simResultTotal").textContent = isEn()
    ? `Est. Total: ${totalSimPrio} pts (${fsPts} + ${wPart} + ${agePts})`
    : `预计总分: ${totalSimPrio} pts (${fsPts} + ${wPart} + ${agePts})`;

  const eligibleGroups = (prioData.queue_groups || []).filter((g) => g.eligible && !g.is_mine);
  const groupsAhead = eligibleGroups.filter((g) => g.priority > totalSimPrio);
  const simRank = groupsAhead.length + 1;
  const totalCompetitors = eligibleGroups.length + 1;
  const gpusAhead = groupsAhead.reduce((acc, g) => acc + (g.total_gpus || 0), 0);
  const jobsAhead = groupsAhead.reduce((acc, g) => acc + (g.job_count || 0), 0);

  $("#simRankResult").textContent = isEn()
    ? `#${simRank} / ${totalCompetitors} batches`
    : `第 ${simRank} 位 / 共 ${totalCompetitors} 批`;
  $("#simRankSub").textContent =
    simRank === 1
      ? t("直接位居全集群可调度榜首！", "Top #1 in the cluster eligible queue!")
      : isEn()
        ? `Behind ${groupsAhead.length} other eligible batch(es)`
        : `排在 ${groupsAhead.length} 个他人的可调度批次之后`;

  $("#simAheadGpusResult").textContent = isEn() ? `${gpusAhead} GPUs` : `${gpusAhead} 张 GPU`;
  $("#simAheadSub").textContent =
    gpusAhead === 0
      ? t("无更高优任务阻挡，有空闲卡即刻运行", "No higher-priority jobs ahead; runs as soon as GPUs free up")
      : isEn()
        ? `${jobsAhead} higher-priority job(s) waiting ahead`
        : `前序共 ${jobsAhead} 个高优任务等待分配`;

  if (groupsAhead.length === 0) {
    $("#simOvertakeResult").textContent = t("已达榜首 #1", "Already #1");
    $("#simOvertakeSub").textContent = t("无需额外排队追赶", "No extra wait needed");
  } else {
    const nextGroup = groupsAhead[groupsAhead.length - 1];
    const diff = nextGroup.priority - totalSimPrio + 1;
    const hoursNeeded = Math.ceil(diff / ratePerHour);
    const maxRemainingAgePts = wAge - agePts;
    if (diff <= maxRemainingAgePts) {
      $("#simOvertakeResult").textContent = isEn() ? `~${hoursNeeded} hrs (+${diff} pts)` : `约 ${hoursNeeded} 小时 (+${diff}分)`;
      $("#simOvertakeSub").textContent = isEn()
        ? `To overtake ${nextGroup.account} (${nextGroup.priority} pts)`
        : `超越前一名 ${nextGroup.account} (${nextGroup.priority}分)`;
    } else {
      $("#simOvertakeResult").textContent = t("需切换高份额账户", "Switch Account Needed");
      $("#simOvertakeSub").textContent = isEn()
        ? `Gap is ${diff} pts; max 7d Age bonus (+${maxRemainingAgePts} pts) is not enough`
        : `差 ${diff} 分，仅靠 7 天排队(+${maxRemainingAgePts}分)无法反超`;
    }
  }
}

function renderPriorityPage() {
  const { cluster, storage, jobs = [], priority } = state.data;
  const isLive = Boolean(cluster.connected && cluster.data_source === "ssh" && priority?.config);
  const disconnText = t("未连接", "Disconnected");
  if (!isLive) {
    $("#prioCardMine").textContent = "—";
    $("#prioCardMineBreakdown").textContent = disconnText;
    $("#prioCardMineAcct").textContent = disconnText;
    $("#prioCardRank").textContent = "—";
    $("#prioCardRankSub").textContent = "";
    $("#prioCardAheadGpus").textContent = disconnText;
    $("#prioCardMinePending").textContent = disconnText;
    $("#prioCardFsMax").textContent = t("/ ku 上限 3,125分", "/ ku max 3,125 pts");
    $("#prioCardHalfLife").textContent = t("半衰期 7 天衰减", "7-day half-life decay");
    $("#prioCardAgeCap").textContent = t("7 天满额 1,000 分", "Max 1,000 pts at 7 days");
    $("#prioLadderSummaryNote").textContent = t("按总优先级从高到低排序", "Sorted by total priority descending");
    $("#myAccountsList").innerHTML = `<div class="empty-state">${t("未连接服务器，暂无关联账户 FairShare 数据", "Disconnected from server. No account FairShare data available.")}</div>`;
    $("#prioLadderList").innerHTML = `<div class="empty-state">${t("未连接服务器，暂无排队阶梯数据", "Disconnected from server. No queue ladder data available.")}</div>`;
    $("#prioAccountsTable").innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted-2);padding:24px 8px;">${t("未连接服务器，暂无课题组份额数据", "Disconnected from server. No group account FairShare data available.")}</td></tr>`;
    updatePrioritySimulator();
    return;
  }

  const sshUser = storage?.user || "user";
  const cfg = priority.config || {};
  const summary = priority.summary || {};
  const userAccounts = priority.user_accounts || [];
  const queueGroups = priority.queue_groups || [];
  const accountsList = priority.accounts || [];

  $("#prioSimUserTag").textContent = isEn() ? `SSH User: ${sshUser}` : `SSH 用户: ${sshUser}`;
  $("#prioPluginBadge").textContent = cfg.priority_type || "priority/multifactor";
  $("#prioCardFsWeight").textContent = (cfg.weights?.fairshare ?? 50000).toLocaleString();
  $("#prioCardFsMax").textContent = isEn()
    ? `/ ku max ${cfg.ku_max_fairshare_points ?? 3125} pts`
    : `/ ku 上限 ${cfg.ku_max_fairshare_points ?? 3125} 分`;
  $("#prioCardHalfLife").textContent = isEn()
    ? `${cfg.decay_half_life_days ?? 7}-day half-life decay`
    : `半衰期 ${cfg.decay_half_life_days ?? 7} 天指数衰减`;
  $("#prioCardAgeRate").textContent = `+${cfg.age_points_per_hour ?? 5.95}`;
  $("#prioCardAgeCap").textContent = isEn()
    ? `Max ${cfg.weights?.age ?? 1000} pts at ${cfg.max_age_days ?? 7} days`
    : `${cfg.max_age_days ?? 7} 天满额 ${cfg.weights?.age ?? 1000} 分`;
  $("#prioCardSchedMode").textContent = cfg.scheduler_type || "sched/backfill";

  const myTopGroup = queueGroups.find((g) => g.is_mine);
  const myCurrentPrio = summary.my_current_priority || 0;
  const myCurrentAcct = summary.my_current_account || "—";
  const myBestAcct = summary.my_best_account || "";
  const myBestPrio = summary.my_best_base_priority || 0;

  $("#prioCardMine").textContent = myCurrentPrio ? `${myCurrentPrio}` : "—";
  if (myTopGroup) {
    const bd = myTopGroup.prio_breakdown || {};
    $("#prioCardMineBreakdown").textContent = isEn()
      ? `FS ${bd.fairshare} + Part ${bd.partition} + Age ${bd.age}`
      : `份额 ${bd.fairshare} + 分区 ${bd.partition} + 等待 ${bd.age}`;
    $("#prioCardMineAcct").textContent =
      myBestAcct && myBestAcct !== myCurrentAcct
        ? isEn()
          ? `Using ${myCurrentAcct} (${myBestAcct}: ${myBestPrio} pts)`
          : `当前 ${myCurrentAcct} (${myBestAcct} 可达 ${myBestPrio}分)`
        : isEn()
          ? `Account: ${myCurrentAcct}`
          : `当前账户: ${myCurrentAcct}`;
  } else {
    $("#prioCardMineBreakdown").textContent = t("新任务初始分 (FairShare + Partition)", "Initial base score (FairShare + Partition)");
    $("#prioCardMineAcct").textContent = isEn() ? `Account: ${myCurrentAcct}` : `账户: ${myCurrentAcct}`;
  }

  if (summary.my_eligible_rank) {
    $("#prioCardRank").textContent = `#${summary.my_eligible_rank}`;
    $("#prioCardRankSub").textContent = isEn()
      ? `/ ${summary.eligible_groups_count} eligible batches`
      : `/ ${summary.eligible_groups_count} 批可调度队列`;
    $("#prioCardAheadGpus").textContent = isEn()
      ? `${summary.my_jobs_ahead} jobs ahead (${summary.my_gpus_ahead} GPUs)`
      : `前序 ${summary.my_jobs_ahead} 任务 (需 ${summary.my_gpus_ahead} 张 GPU)`;
    $("#prioCardMinePending").textContent = isEn()
      ? `My pending: ${summary.my_pending_jobs} jobs (${summary.my_pending_gpus} GPUs)`
      : `我的排队: ${summary.my_pending_jobs} 任务 (${summary.my_pending_gpus} 卡)`;
  } else {
    $("#prioCardRank").textContent = t("无排队", "None Queued");
    $("#prioCardRankSub").textContent = isEn()
      ? `${summary.eligible_groups_count} batches competing`
      : `共 ${summary.eligible_groups_count} 批竞争中`;
    $("#prioCardAheadGpus").textContent = isEn()
      ? `${summary.eligible_gpus_total || 0} GPUs requested in queue`
      : `全队列待分配 ${summary.eligible_gpus_total || 0} 张 GPU`;
    $("#prioCardMinePending").textContent = t("可随时提交新任务", "Ready to submit new jobs");
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
    $("#myAccountsList").innerHTML = `<div class="empty-state">${t("未查询到个人关联账户明细", "No associated Slurm accounts found for current user")}</div>`;
  } else {
    const maxUserBase = Math.max(...userAccounts.map((a) => a.base_priority), 1);
    $("#myAccountsList").innerHTML = userAccounts
      .map((acct) => {
        const isBest = userAccounts.length > 1 && acct.base_priority === maxUserBase;
        const isSimSelected = state.simSelectedAcct === acct.account;
        const badgeHtml = isBest
          ? `<span class="node-badge online">${t("推荐高优账户", "Recommended Best")}</span>`
          : acct.my_pending_jobs > 0
            ? `<span class="node-badge maint">${isEn() ? `Queued (${acct.my_pending_jobs})` : `当前排队中 (${acct.my_pending_jobs})`}</span>`
            : `<span class="node-badge idle">${t("可用账户", "Available")}</span>`;
        const fsRatioPct = Math.min((acct.fairshare_points / 3125) * 100, 100).toFixed(1);
        const cardTitle = isEn()
          ? `Click to load ${acct.account} FairShare (${acct.fairshare_points} pts) into simulator`
          : `点击将 ${acct.account} 的公平份额 (${acct.fairshare_points}分) 带入下方推演器`;
        return `<div class="my-acct-card ${isBest ? "best" : ""} ${isSimSelected ? "active-sim" : ""}" data-sim-acct="${escapeHtml(acct.account)}" data-sim-fs="${acct.fairshare_points}" title="${escapeHtml(cardTitle)}">
          <div class="my-acct-top">
            <div class="my-acct-name"><span>-A ${escapeHtml(acct.account)}</span></div>
            ${badgeHtml}
          </div>
          <div class="my-acct-score">
            <strong>${acct.base_priority} <small style="font-size:11px;font-weight:400;color:var(--muted)">${t("初始总分", "Base Prio")}</small></strong>
            <span>FairShare <b>${acct.fairshare_points}</b> / 3125 (${fsRatioPct}%)</span>
          </div>
          <div class="util-bar"><span style="width:${Math.max(Number(fsRatioPct), 3)}%;background:${isBest ? "var(--green)" : "var(--purple)"}"></span></div>
          <div class="my-acct-meta">
            <div><span>${t("课题组总消耗 (7天衰减):", "Group Usage (7d decayed):")}</span><b>${acct.account_raw_usage_hours.toLocaleString()} ${t("核时", "core-hrs")}</b></div>
            <div><span>${t("我个人消耗 / 有效占比:", "My Usage / Effective:")}</span><b>${acct.raw_usage_hours.toLocaleString()} ${t("核时", "core-hrs")} / ${(acct.effectv_usage * 100).toFixed(2)}%</b></div>
            <div><span>${t("我的在跑 / 排队任务:", "My Running / Pending:")}</span><b>${isEn() ? `${acct.my_running_jobs} run / ${acct.my_pending_jobs} pend` : `${acct.my_running_jobs} 运行 / ${acct.my_pending_jobs} 排队`}</b></div>
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

  $("#prioLadderSummaryNote").textContent = isEn()
    ? `${summary.eligible_jobs_count || 0} eligible jobs (${summary.eligible_gpus_total || 0} GPUs) · Sorted by total priority descending`
    : `共 ${summary.eligible_jobs_count || 0} 个可立即调度任务 (${summary.eligible_gpus_total || 0} 张 GPU) · 按总优先级降序排列`;

  if (!ladderItems.length) {
    $("#prioLadderList").innerHTML = `<div class="empty-state">${t("当前筛选条件下没有排队中的任务", "No pending jobs match the current filter")}</div>`;
  } else {
    $("#prioLadderList").innerHTML = ladderItems
      .map((item) => {
        const bd = item.prio_breakdown || { fairshare: 0, partition: 0, age: 0 };
        const fsW = Math.min((bd.fairshare / maxScalePrio) * 100, 100);
        const partW = Math.min((bd.partition / maxScalePrio) * 100, Math.max(100 - fsW, 0));
        const ageW = Math.min((bd.age / maxScalePrio) * 100, Math.max(100 - fsW - partW, 0));
        const reasonLabel = getReasonLabel(item.reason) || t("等待调度", "Queued");
        const rankHtml = item.eligible
          ? `<div class="ladder-rank"><strong>#${item.eligible_rank}</strong><small>${isEn() ? `${item.gpus_ahead} GPUs ahead` : `前序 ${item.gpus_ahead} 卡`}</small></div>`
          : `<div class="ladder-rank"><strong>${t("暂缓阻塞", "Blocked")}</strong><small>${escapeHtml(reasonLabel)}</small></div>`;
        const mineTag = item.is_mine
          ? `<span class="mine-pill">${t("我的任务", "My Job")}</span>`
          : item.is_teammate
            ? `<span class="group-pill">${t("同组人员", "Teammate")}</span>`
            : "";
        const batchDesc =
          item.job_count > 1
            ? isEn()
              ? `<b>${item.job_count}</b> jobs · <b>${item.total_gpus}</b> GPUs · Sample: <b>${escapeHtml(item.sample_job_name)}</b> (${escapeHtml(item.sample_job_id)})`
              : `共 <b>${item.job_count}</b> 个任务 · 需 <b>${item.total_gpus}</b> 张 GPU · 代表作业 <b>${escapeHtml(item.sample_job_name)}</b> (${escapeHtml(item.sample_job_id)})`
            : isEn()
              ? `Req <b>${item.total_gpus}</b> GPUs · Job <b>${escapeHtml(item.sample_job_name)}</b> (${escapeHtml(item.sample_job_id)})${item.time_limit ? ` · Limit ${escapeHtml(item.time_limit)}` : ""}`
              : `申请 <b>${item.total_gpus}</b> 张 GPU · 作业 <b>${escapeHtml(item.sample_job_name)}</b> (${escapeHtml(item.sample_job_id)})${item.time_limit ? ` · 时限 ${escapeHtml(item.time_limit)}` : ""}`;
        const approxWaitHours = (bd.age / (cfg.age_points_per_hour || 5.95)).toFixed(1);
        const trackTitle = isEn()
          ? `Total ${item.priority} = FairShare ${bd.fairshare} + Partition ${bd.partition} + Age ${bd.age}`
          : `总分 ${item.priority} = FairShare ${bd.fairshare} + Partition ${bd.partition} + Age ${bd.age}`;
        const pillText = item.eligible
          ? isEn()
            ? `Eligible · ${reasonLabel}`
            : `可调度 · ${reasonLabel}`
          : isEn()
            ? `Blocked · ${reasonLabel}`
            : `阻塞 · ${reasonLabel}`;

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
            <div class="ladder-stack-track" title="${escapeHtml(trackTitle)}">
              <span class="ladder-seg fs" style="width:${fsW.toFixed(2)}%"></span>
              <span class="ladder-seg part" style="width:${partW.toFixed(2)}%"></span>
              <span class="ladder-seg age" style="width:${ageW.toFixed(2)}%"></span>
            </div>
            <div class="ladder-bar-labels">
              <span>${isEn() ? "FairShare" : "公平份额(FairShare)"}: <b>${bd.fairshare}</b> (${((bd.fairshare_norm || 0) * 100).toFixed(2)}%)</span>
              <span>${isEn() ? "Partition" : "分区(Part)"}: <b>${bd.partition}</b></span>
              <span>${isEn() ? "Age Bonus" : "排队加成(Age)"}: <b>+${bd.age}</b> (~${approxWaitHours}h)</span>
            </div>
          </div>
          <div class="ladder-right">
            <div class="ladder-prio-num">${item.priority}<small>pts</small></div>
            <span class="status-pill ${item.eligible ? "" : "pending"}">${escapeHtml(pillText)}</span>
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
    $("#prioAccountsTable").innerHTML = `<tr><td colspan="7" style="text-align:center;color:var(--muted-2);padding:24px 8px;">${t("暂无匹配的课题组账户数据", "No matching research group accounts found")}</td></tr>`;
    return;
  }

  $("#prioAccountsTable").innerHTML = filteredAccts
    .map((acct, idx) => {
      const fsPct = Math.min((acct.fairshare_points / 3125) * 100, 100);
      const barColor = fsPct >= 70 ? "var(--green)" : fsPct >= 30 ? "var(--purple)" : "var(--orange)";
      const minePill = acct.is_mine ? `<span class="mine-pill" style="margin-left:6px">${t("我的账户", "My Account")}</span>` : "";
      const shareTag = acct.raw_shares === "parent" ? `<span class="acct-tag">${t("parent特权", "parent")}</span>` : "";
      const gpuLoadHtml =
        acct.running_gpus > 0 || acct.pending_gpus > 0
          ? isEn()
            ? `<span style="color:var(--green)">${acct.running_gpus} GPUs run</span> · <span style="color:var(--orange)">${acct.pending_gpus} GPUs pend</span>`
            : `<span style="color:var(--green)">${acct.running_gpus} 卡运行</span> · <span style="color:var(--orange)">${acct.pending_gpus} 卡排队</span>`
          : `<span style="color:var(--muted-2)">${t("当前空闲", "Idle")}</span>`;

      return `<tr style="${acct.is_mine ? "background:rgba(56,214,161,.05)" : ""}">
        <td><b>#${idx + 1}</b></td>
        <td><b>${escapeHtml(acct.account)}</b>${minePill}${shareTag}</td>
        <td>
          <div class="prio-cell-wrap" style="min-width:165px">
            <div class="prio-cell-top">
              <strong>${acct.fairshare_points} <span style="font-weight:400;color:var(--muted)">/ 3125 ${t("分", "pts")}</span></strong>
              <small>${t("因子", "Factor")} ${acct.fairshare.toFixed(5)}</small>
            </div>
            <div class="prio-mini-track">
              <span class="ladder-seg" style="width:${Math.max(fsPct, acct.fairshare_points > 0 ? 2 : 0).toFixed(1)}%;background:${barColor}"></span>
            </div>
          </div>
        </td>
        <td><strong style="font-family:'Space Grotesk',sans-serif;color:var(--text)">${acct.base_priority} pts</strong></td>
        <td>${acct.raw_usage_hours.toLocaleString()} ${t("核时", "core-hrs")}</td>
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
  badge.textContent = isLive ? t("已连接", "Connected") : t("未连接", "Disconnected");
  badge.classList.toggle("pending", !isLive);
  const intervalLabel = formatIntervalLabel(state.refreshMs);
  if (isLive) {
    diag.textContent = isEn()
      ? `Status: Live SSH collection active · ${intervalLabel}`
      : `当前状态：SSH 实时采集正常 · ${intervalLabel}`;
  } else {
    const errReason = localizeBackendText(cluster.data_error) || t("未能获取到服务器端数据", "Failed to retrieve server data");
    diag.textContent = isEn()
      ? `Status: Disconnected · Reason: ${errReason}`
      : `当前状态：未连接 · 原因：${errReason}`;
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
      showToastMessage(
        isLive ? t("数据已刷新", "Metrics refreshed") : t("未连接到集群服务器", "Disconnected from cluster server"),
        !isLive
      );
    }
  } catch (error) {
    console.error(error);
    state.data = {
      ...DISCONNECTED_DATA,
      cluster: { ...DISCONNECTED_DATA.cluster, data_error: `无法连接本地采集服务 (${error.message})` },
    };
    render();
    if (showToast) showToastMessage(t("未连接：请检查采集服务是否运行", "Disconnected: Please check if collector service is running"), true);
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
    showToastMessage(t("采集设置已保存，正在重新连接…", "Settings saved. Reconnecting…"));
    await fetchMetrics(true, true);
  } catch (error) {
    console.error(error);
    showToastMessage(t("保存采集设置失败", "Failed to save settings"), true);
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
      showToastMessage(
        isEn() ? `Loaded ${acctName} FairShare (${fsPts} pts)` : `已加载账户 ${acctName} 的公平份额 (${fsPts} 分)`
      );
      return;
    }

    const viewBtn = event.target.closest("[data-view]");
    if (viewBtn) {
      setView(viewBtn.dataset.view);
    }
  });

  $("#langButton")?.addEventListener("click", () => {
    setLanguage(state.lang === "en" ? "zh" : "en", true);
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
    showToastMessage(t("已触发主目录空间重新扫描…", "Triggered home directory rescan…"));
    fetchMetrics(true, true);
  });

  $("#refreshButton").addEventListener("click", () => fetchMetrics(true, true));
  $("#themeButton").addEventListener("click", () => {
    document.body.classList.toggle("light");
    showToastMessage(
      document.body.classList.contains("light")
        ? t("已切换到浅色主题", "Switched to light theme")
        : t("已切换到深色主题", "Switched to dark theme")
    );
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

applyStaticI18n();
const initialHash = window.location.hash.replace(/^#/, "");
setView(VIEW_META[initialHash] ? initialHash : "overview", { updateHash: false });

bindEvents();
fetchSettings();
fetchMetrics();
state.timer = setInterval(() => fetchMetrics(false), state.refreshMs);
