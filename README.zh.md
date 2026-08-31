# dsh-gpu-pulse

DSH Web 界面内置的悬浮 GPU 监控。实时显示每张 GPU 的**利用率、显存、温度与功耗**，当驱动支持按进程归因显存时还会列出占用最高的进程，以紧凑可拖动的条带形式（每张 GPU 一行）渲染在 DeepSeek Harness 页面。

适用于任何装有 NVIDIA 驱动的机器（Windows 或 Linux）：数据来自 `nvidia-smi`，多 GPU 平台会为每张 GPU 显示一块独立的仪表区。`nvidia-smi` 只上报独立的 NVIDIA 显卡，因此核显（Intel UHD、AMD iGPU 等）不会出现在显示中。无需额外常驻服务，也无需调用 agent 工具：卡片直接轮询 DSH 宿主自带的接口。

**注意：** 本插件仅支持 NVIDIA（nvidia-smi 后端）。没有 NVIDIA 驱动的机器会退化为一个小 `GPU n/a` 胶囊，并每 5 分钟重新探测，驱动装好后它会自动亮起来。

## 截图

![DSH Web UI 中的 dsh-gpu-pulse 条带，每张 GPU 一行](docs/screenshot.png)

侧边面板或侧边卡片打开时（例如 `dsh-better-sidebar` 的 Files 面板），条带会保持在最上层，不会被遮挡。

## 位置

条带默认出现在右下角，并且**可拖动**：按住拖到页面任意位置即可。位置会被记住（按浏览器配置持久保存），因此新建会话或重启后仍保持上次放的位置。双击条带可恢复到默认角落。

## 安装

```sh
# 从 GitHub
dsh plugin --profile web add github:zhubaohi/dsh-gpu-pulse

# 或从本地目录
dsh plugin --profile web add /path/to/dsh-gpu-pulse
```

npm 包名 `dsh-gpu-pulse` 已预留：npm 包发布后 `dsh plugin --profile web add dsh-gpu-pulse` 即可用。

然后重启 `dsh web`。条带出现在 GUI 右下角；拖动到任意位置即可，位置会被记住。

## 界面内容

每张 GPU 一行，刻意保持紧凑（两块 GPU 约 85 px 高）：

- **状态点**：按该行最严重的阈值显示绿色 / 琥珀 / 红色
- **名称**：驱动报告的精确 GPU 名称（悬停显示 GPU 序号与风扇转速）
- **GPU**：利用率（绿色低于 60%，琥珀 60-85%，红色 85% 及以上）
- **VRAM**：已用/总量 GiB（绿色低于 75%，琥珀 75-90%，红色 90% 及以上）
- **TEMP**：温度（绿色低于 65 °C，琥珀 65-80 °C，红色 80 °C 及以上）
- **PWR**：功耗（1 kW 以下显示整数瓦）
- **TOP PROCESSES**：显存占用最高的进程；多数新版 Windows 驱动对图形上下文返回 `[N/A]`，此时该区块自动省略
- 页脚：驱动（KMD）版本 + 最近一次采样的时间戳

每行都显示驱动报告的精确 GPU 名称。

## 配置

全部可选，默认值开箱即用。在 profile 的 `cordis.patch.yml` 中覆盖（按 id 打补丁会整体替换 config，想保留的字段要全部重写）：

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
- **客户端**（`client/client.js`）：手写的 `__ModuleLoader__` 插件包（无构建步骤，唯一的 require 是平台内置的 `react` 种子模块），把组件挂到 `shell.overlay` 槽。它轮询状态接口，使用当前主题的 `--dsw-*` token 变量着色（带静态回退值，旧宿主也能正常显示），并用自身的指针事件实现拖动（位置保存在 `localStorage` 的 `dsh-gpu-pulse:pos` 键下）。由于侧边面板类插件的层级高于 overlay 槽的默认层级，客户端在运行时把 overlay 层提升到应用最高层级，保证侧边卡片打开时组件仍然可见。

## 要求

- Node ≥ 18，`dsh web` 0.1.0-rc.6+（`shell.overlay` 槽）
- `PATH` 中可用的 NVIDIA 驱动与 `nvidia-smi`（Windows 或 Linux）
- 除 Node 内置模块外无任何运行时依赖

## 许可

MIT，见 [LICENSE](LICENSE)。`nvidia-smi` 为 NVIDIA Corporation 工具，本插件只读调用。