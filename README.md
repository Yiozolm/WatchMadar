# Madar HPC Resource Monitor

一个零依赖的浏览器仪表盘，通过 SSH 读取 Madar HPC 的 Slurm GPU 分配、运行任务和文件系统空间。

## 启动

```powershell
cd madar_dashboard
python server.py
```

然后访问启动时终端打印的地址（默认 <http://127.0.0.1:8766>）。服务会从 8766 开始向上探测第一个未被占用的端口，起始端口可用环境变量 `MADAR_DASHBOARD_PORT` 修改。页面会每 **10 秒**自动通过 SSH 刷新，也可以点击右上角按钮立即刷新。默认使用 `~/.ssh/config` 中名为 `madar` 的主机别名。

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

后端只执行只读命令：`scontrol show node`、`squeue`、`sinfo`、`df` 和带 6 秒超时的 `du`。GPU 卡片上的占用来自 Slurm 的 GPU 分配信息；登录节点不允许直接 SSH 到计算节点时，显存、温度和 NVML 利用率会显示为 `—`，不会用演示值冒充实时值。目录扫描过慢时，会显示所在文件系统的用量并在 API 中保留说明。

如需关闭 SSH，可显式设置：

```powershell
$env:MADAR_SSH_ENABLED = "0"
```

此时才会使用 `MADAR_DATA_FILE`，没有文件时回退到 `sample_metrics.json`。

服务提供：

- `GET /api/metrics`：当前 JSON 数据
- `GET /health`：健康检查

