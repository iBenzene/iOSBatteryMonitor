# iOS Battery Monitor

一个本地电池监控面板，用来查看 iPhone / iPad 的电池容量、温度、充电状态和历史变化。

## 🚀 快速开始

1. 📦 安装依赖：

```zsh
brew install libimobiledevice
npm install
```

2. 📱 连接你的 iPhone / iPad。

- 🔌 通过 USB 数据线连接：插上设备，并在设备上点击「信任此电脑」。
- 🛜 通过网络连接：确保设备和电脑处于同一个局域网中，并已完成信任配对。

3. 🛠️ 构建界面：

```zsh
npm run build
```

4. ▶️ 启动监控：

```zsh
npm run server
```

5. 🌐 打开浏览器访问：

```text
http://127.0.0.1:8765
```

6. 🛑 停止运行：回到终端按 `Ctrl+C`。

## 📂 数据保存在哪里

- 📈 电池数据日志：`data/battery_log.jsonl`
- 📱 已发现设备列表：`data/devices.json`
