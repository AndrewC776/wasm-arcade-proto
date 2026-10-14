# WASM Arcade 原型

用可合法再分发的内容（doomgeneric + Freedoom）复现「WASM 引擎 + 分片数据包 + 按需资源 + 预热缓存」这套网页游戏启动链。

在线试玩：https://andrewc776.github.io/wasm-arcade-proto/

## 结构对照

| 机制 | 本项目实现 |
| --- | --- |
| 引擎 `.wasm` | `engine/build-engine.sh` 把上游 doomgeneric（未改动，固定提交见下）编译为 `dist/engine/doom.{js,wasm}`，不内嵌数据 |
| 分片数据包 `.data.NN` | `tools/pack.mjs` 把 WAD 拼成一个 blob 后按 4 MB 切片，每片记录 SHA-256 |
| VFS 索引 | 每个包的 `index.json`：`dataSize`、`chunks[]`、`files[]`（路径到 `[start, end)`） |
| 核心包 / 按需包 | `packages.config.json` 的 `role`：`core` 默认选中，`on-demand` 只在选中时下载 |
| 预热清单 | `dist/warm.json`，游戏启动后由 Service Worker 在后台写入 Cache Storage |
| 缓存 | `web/sw.js`：包文件按内容哈希寻址，cache-first；校验失败的分片由 `web/loader.js` 剔除后重拉 |
| 启动界面 | `web/index.html` + `web/app.js`：分片进度、逐片校验状态、模式选择 |

## 构建与运行

```bash
./build.sh
```

```bash
node tools/serve.mjs 8765
```

然后打开 `http://localhost:8765/`。`build.sh` 会先用官方 CHECKSUM 校验 Freedoom 压缩包，再解出 WAD、编译引擎、复制前端文件并打包分片。

发布到 GitHub Pages（把 `dist/` 推到 `gh-pages` 分支）：

```bash
./tools/deploy-pages.sh
```

依赖（都在本目录内，删掉目录即可清除）：

- `toolchain/emsdk`：Emscripten SDK，按 [emsdk](https://github.com/emscripten-core/emsdk) 说明 `install latest` 和 `activate latest`
- `third_party/doomgeneric`：git 子模块，固定在上游提交 `e257a09527062bfb986b6e5e0780839b6cbd5b71`
- `downloads/freedoom`：Freedoom v0.13.0 的 `freedoom-0.13.0.zip`、`freedm-0.13.0.zip` 及 `freedoom-0.13.0-CHECKSUM`，来自 [Freedoom 发布页](https://github.com/freedoom/freedoom/releases/tag/v0.13.0)

## 许可证

- doomgeneric：GPL-2.0。公开托管 `doom.wasm` 时必须同时提供对应源码，即上游提交号加上 `engine/build-engine.sh`。
- Freedoom：BSD-3-Clause，许可证随 `dist/licenses/` 一起发布。

## 已知限制

- 没有背景音乐：上游 MIDI 播放依赖 timidity 音色库，未打包。音效走 SDL 音频。
- 存档在内存文件系统里，刷新页面即丢失（未接 IDBFS）。
- 没有触屏操作：手机上启动页可用，但游戏本身需要键盘。
- 「返回」按钮会整页刷新，引擎主循环不支持原地卸载。
