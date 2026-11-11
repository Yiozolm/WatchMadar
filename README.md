# Madar HPC Resource Monitor

一个零依赖的浏览器仪表盘，通过 SSH 读取 Madar HPC 的 Slurm GPU 分配、运行任务和文件系统空间。

## 启动

```powershell
cd madar_dashboard
python server.py
```

然后访问启动时终端打印的地址（默认 <http://127.0.0.1:8766>）。服务会从 8766 开始向上探测第一个未被占用的端口，起始端口可用环境变量 `MADAR_DASHBOARD_PORT` 修改。页面默认每 **1 分钟**自动通过 SSH 刷新（可在"采集设置"里改为 15 秒到 5 分钟，或暂停），也可以点击右上角按钮立即刷新。默认使用 `~/.ssh/config` 中名为 `madar` 的主机别名。

## SSH 配置

可以直接使用已有 SSH 别名：

```powershell
python server.py
```

如果没有别名，可以显式指定主机、用户名和配置文件：

```powershell
$env:MADAR_SSH_HOST = "login.madar.ku.ac.ae"
$env:MADAR_SSH_USER = "100069958@ku.ac.ae"
$env:MADAR_SSH_CONFIG = "$env:USERPROFILE\.ssh\config"
python server.py
```

在页面"采集设置"里保存的 SSH 主机、用户名、端口、超时和自动刷新间隔会写入项目目录下的 `settings.local.json`（已加入 `.gitignore`），下次启动时自动生效，并且**优先于上面的环境变量**。删除该文件即可恢复为环境变量 / 默认值；文件位置可用 `MADAR_SETTINGS_FILE` 修改。

后端只执行只读命令：`scontrol show node`、`squeue`、`sprio`、`sshare`、`sacctmgr show assoc`、`df`，以及对家目录各一级子目录执行的 `du`（每个子目录 35 秒超时，后台运行，每 30 分钟最多一次）。GPU 卡片上的占用来自 Slurm 的 GPU 分配信息；登录节点无法读取计算节点的 NVML，所以已用显存、温度和实际利用率显示为 `—`，不会用演示值冒充实时值。显存一栏显示的是该型号的单卡总显存（H200 为 141 GB，取自官方硬件规格）。

存储页还会显示项目共享存储 `/dpc`：你名下各 Slurm 账户对应的项目目录、文档给出的每项目默认配额（2 TB）以及整个文件系统的使用率。单个项目的已用空间不显示——该存储没有普通用户可用的配额命令，`du` 也读不到其他成员的目录。

连接失败时页面显示"未连接"和失败原因，不会回退到演示数据。

服务提供：

- `GET /api/metrics`：当前 JSON 数据
- `GET /health`：健康检查
- `GET /api/settings` / `POST /api/settings`：读取 / 保存采集设置
- `POST /api/test-connection`：用给定（未保存）的 SSH 设置试连一次，返回登录用户、登录节点、耗时或失败原因

