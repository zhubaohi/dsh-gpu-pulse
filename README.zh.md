# dsh-gpu-pulse

DSH Web 界面内置的悬浮 GPU 监控。实时显示每张 GPU 的**利用率、显存、温度、功耗与风扇转速**——当驱动支持按进程归因显存时，还会列出占用最高的进程——以紧凑卡片形式渲染在 DeepSeek Harness 页面角落。

适用于任何装有 NVIDIA 驱动的机器（Windows 或 Linux）：数据来自 `nvidia-smi`，多 GPU 平台会为每张 GPU 显示一块独立的仪表区。无需额外常驻服务，也无需调用 agent 工具——卡片直接轮询 DSH 宿主自带的接口。

**注意：** 本插件仅支持 NVIDIA（nvidia-smi 后端）。没有 NVIDIA 驱动的机器会退化为一个小 `GPU — n/a` 胶囊，并每 5 分钟重新探测——驱动装好后它会自动亮起来。

## 安装

```sh
# 从 npm
dsh plugin --profile web add dsh-gpu-pulse

# 或从 GitHub
dsh plugin --profile web add github:zhubaohi/dsh-gpu-pulse

# 或从本地目录
dsh plugin --profile web add /path/to/dsh-gpu-pulse
```

然后重启 `dsh web`。卡片出现在 GUI 右下角；点 `–` 可折叠为一行胶囊（`GPU 42% · 67°C`），折叠状态会被记住。

## 界面内容

- **GPU** — 利用率进度条 + 历史走势（绿色 < 60%，琥珀 60–85%，红色 ≥ 85%）
- **VRAM** — 已用/总量 GiB 进度条（绿色 < 75%，琥珀 75–90%，红色 ≥ 90%）
- **TEMP** — 温度 + 历史走势（绿色 < 65 °C，琥珀 65–80 °C，红色 ≥ 80 °C）
- **PWR** — 功耗 + 风扇转速进度条
- **TOP PROCESSES** — 显存占用最高的进程；多数新版 Windows 驱动对图形上下文返回 `[N/A]`，此时该区块自动省略
- 页脚：驱动（KMD）版本 + 最近一次采样的时间戳

每张 GPU 一块；任一 GPU 越过阈值时，头部指示灯变琥珀/红色。

## 配置

全部可选——默认值开箱即用。在 profile 的 `cordis.patch.yml` 中覆盖（按 id 打补丁会整体替换 config，想保留的字段要全部重写）：

```yaml
- id: dsh-gpu-pulse
  config:
    pollMs: 3000            # 客户端轮询间隔提示，默认 2000，下限 500
    showProcesses: true     # 同时采集按进程的显存占用
    nvidiaSmiPath: 'C:\Windows\System32\nvidia-smi.exe'  # 默认走 PATH 的 "nvidia-smi"
```

`pollMs` 是随每次状态响应下发给客户端的*提示*，因此对全部打开的标签页生效，无需浏览器端设置。

## 工作原理

- **宿主端**（`index.js`）：在 DSH 宿主 web server 上注册 `GET /dsh-gpu-pulse/status`。每次请求最多并行执行四条 `nvidia-smi` 查询（`--query-gpu` 指标、`--query-gpu=index,name`、`--version`，以及可选的 `--query-compute-apps`），超时 4 秒，解析 CSV 后返回 JSON。结果缓存约 1.2 秒，多个标签页的并发轮询共享同一进程。
- **客户端**（`client/client.js`）：手写的 `__ModuleLoader__` 插件包（无构建步骤，唯一的 require 是平台内置的 `react` 种子模块），把组件挂到 `shell.overlay` 槽。它轮询状态接口、保留短历史供走势图使用，并使用当前主题的 `--dsw-*` token 变量着色（带静态回退值，旧宿主也能正常显示）。

## 要求

- Node ≥ 18，`dsh web` 0.1.0-rc.6+（`shell.overlay` 槽）
- `PATH` 中可用的 NVIDIA 驱动与 `nvidia-smi`（Windows 或 Linux）
- 除 Node 内置模块外无任何运行时依赖

## 许可

MIT — 见 [LICENSE](LICENSE)。`nvidia-smi` 为 NVIDIA Corporation 工具，本插件只读调用。