![Inpaint-web](./media/cover.png)
<div align="center">

# Inpaint-web

A free and open-source inpainting & image-upscaling tool powered by webgpu and wasm on the browser.

基于 Webgpu 技术和 wasm 技术的免费开源 inpainting & image-upscaling 工具, 纯浏览器端实现。

</div>

## Inpaint（图片修复）

https://github.com/lxfater/inpaint-web/assets/22794120/bcad4812-02ae-48bb-9e84-94dfeb7234f5

## Super-Resolution（图片高清化）

https://github.com/lxfater/inpaint-web/assets/22794120/3a8d894f-9749-4685-b947-8b5f15c9cf38

## Demo link

Demo link: https://inpaint.itsong.com

## Project Roadmap

### en

- [x] Image Modification History
- [x] Optimize Model
- [x] Integrate Post-Processing into the Model
- [x] Image-upscaling
- [ ] Integrate Segment Anything for Quick Selection and Removal in Images
- [ ] Integrate Stable Diffusion for Image Replacement
- [ ] Better UI

### cn

- [x] 图像修改历史
- [x] 优化模型
- [x] 后处理集成于模型中
- [x] 超分辨率
- [ ] 接入 Segment Anything，实现快速选择和去除图像
- [ ] 接入 stable diffusion，实现图像替换
- [ ] 更好的界面

## Setup

需要 Node.js 22.22.1 或更新版本，项目提供 `.nvmrc` 使用 Node 24。

`npm ci`

## Development

`npm run start`

`App.tsx` 和 `Editor.tsx` 使用 Fast Refresh 重置指令：修改这些持有导入器、取消控制器和历史图片 URL 的组件时，会重新挂载组件，避免继续使用清理后失效的资源。开发时修改 App 会回到选图页，修改 Editor 会清空编辑历史并重新加载当前原图；需要保留结果时请先下载。普通生产使用不受此开发指令影响。

目前保留 SWC React 插件：本地验证 `@vitejs/plugin-react` 6.1.1 配合 Vite 8.1.5 时，虽保留 `@refresh reset` 注释，却未生成强制重挂载标记。浏览器回归检查会验证实际转换结果，升级编译工具时需保持此检查通过。

## Validation

`npm run check` 依次执行代码检查、回归测试、内存回收检查和生产构建（包含 TypeScript 检查）。也可单独运行 `npm run lint`、`npm test`、`npm run test:memory` 或 `npm run build`。

内存检查在独立 Node 进程中启用显式垃圾回收，验证取消的排队任务会释放其持有的 16 MiB 数据，同时尚未取消的任务仍保留数据，且活动推理继续阻止环境修复。它不下载模型，也不以整个进程的内存波动作为判断依据。

该检查还验证共享任务仍在运行时，已取消的等待者能释放取消原因中的数据；模型下载拼接过程中，已经复制完成的分块也能提前回收。这些检查通过弱引用确认对象可被回收，不代表浏览器总内存或真实模型峰值内存测量。

内存检查分别加载源码转译模块和 Vite 压缩模块，覆盖修复及放大输入在后处理前释放、上一分块输出在下一块推理期间释放等行为。压缩检查把模块构建到临时目录，仍使用模拟依赖，运行后清理目录；它不等同于生产页面完整打包结果或浏览器堆测量。

GitHub Actions 配置会在推送和拉取请求时运行相同检查，覆盖 Linux 上的 Node 22.22.1、Node 24，以及 Windows 上的 Node 24；使用锁文件安装依赖，不会下载 AI 模型。浏览器交互与真实模型推理仍需单独验证；回归测试覆盖预处理像素、共享模型等待取消、推理锁、历史预算及图片 URL 回收。

`npm run test:browser` 使用 Playwright 自动运行画笔与预处理像素检查，以及超限文件、无法解码图片导入失败后的重试、资源释放和焦点恢复检查；还覆盖本地存储被禁用或写满时的语言、主题切换及刷新回退。首次运行前执行 `npx playwright install chromium`；测试会启动并关闭独立的本地 Vite 服务（端口 4179），并拒绝外部请求，不需要 AI 模型。编辑器预热因此可能输出运行库加载失败警告，属于测试预期。也可设置 `PLAYWRIGHT_CHANNEL=chrome` 使用本机 Chrome（PowerShell：`$env:PLAYWRIGHT_CHANNEL = 'chrome'`）。该命令独立于 `npm run check`，CI 的 `Browser regressions` 任务分别在 Chromium、Firefox 和 WebKit 中安装浏览器及系统依赖并运行它，失败时保留截图和跟踪文件 7 天。配置参考 [Playwright CI 指南](https://playwright.dev/docs/ci)。

本地默认使用 Chromium。验证 Firefox 时先运行 `npx playwright install firefox`，再设置 `PLAYWRIGHT_BROWSER=firefox`（PowerShell：`$env:PLAYWRIGHT_BROWSER = 'firefox'`）并执行 `npm run test:browser`；切回 Chromium 可使用 `$env:PLAYWRIGHT_BROWSER = 'chromium'`。`PLAYWRIGHT_CHANNEL` 仅对 Chromium 生效。

WebKit 验证先执行 `npx playwright install webkit`，设置 `PLAYWRIGHT_BROWSER=webkit` 后运行 `npm run test:browser`。此项验证使用 Playwright WebKit，不等同于真机 Safari 测试；真实模型命令支持 Chromium、Firefox 和 WebKit。

浏览器自动检查还覆盖模型下载中按 Escape 或点击取消后恢复工具栏与焦点、立即重试复用同一下载，以及下载迟到完成时不生成编辑结果或错误弹窗。测试拦截模型请求并返回少量模拟字节，仅验证下载等待与取消流程，不执行真实模型推理；每个测试使用独立浏览器上下文，模拟缓存不会写入日常使用的页面。

缓存读取超时测试模拟延迟的存储请求，验证错误提示、工具栏恢复、重试完成放大流程及迟到结果隔离；推理输出使用模拟数据。画笔光标测试在同一帧内派发 20 次移动，检查仅更新一次样式且使用最终坐标，避免高频事件造成重复 DOM 写入；此数字不代表真实设备上的帧率提升。

浏览器像素一致性验证：运行 `npm run start`，在本地页面的浏览器控制台执行：

```js
const { runPreprocessSmoke } = await import('/tests/browser-preprocess.mjs')
await runPreprocessSmoke()
```

此脚本不需要模型，用超过一百万像素的半透明渐变图，逐像素比较分条读取和整图读取的 RGB、归一化 RGB、透明度及缩放蒙版。输入预处理每次读取约一百万像素，避免一次创建整图 RGBA 数组；绘制和缩放仍执行一次，保持条带边缘一致。

画笔路径缓存验证：在控制台执行 `const { runBrushSmoke } = await import('/tests/browser-brush.mjs')`，再执行 `runBrushSmoke()`。脚本逐像素比较缓存路径与直接绘制，覆盖长曲线、新增点、画布尺寸变化、笔刷大小、单点点击及蒙版；不需要模型。活动笔划只追加新点，替换已有点时应使用新的点数组，以便使缓存失效。

真实模型命令行验证：安装对应 Playwright 浏览器后运行 `npm run test:models`，也支持上述 `PLAYWRIGHT_BROWSER=firefox` 或 `PLAYWRIGHT_BROWSER=webkit` 设置。命令自动启动独立 Vite 服务（端口 4181），在临时浏览器上下文中下载并执行真实模型，检查修复、4× 放大、透明度及取消后恢复，完成或超过 5 分钟后关闭浏览器和服务。每次运行使用独立缓存，需要联网；不会读取日常浏览器的图片或模型缓存。此命令不加入常规检查和 CI，以免每次验证都下载模型。

验证完整运行环境修复时，额外设置 `MODEL_SMOKE_REPAIR=1`（PowerShell：`$env:MODEL_SMOKE_REPAIR = '1'`）再运行 `npm run test:models`。测试先完成一次真实处理，再释放会话、重新下载模型并重建运行库，最后再次验证处理和取消恢复，并检查脚本节点清理。只影响该次测试的临时浏览器缓存；会多下载一轮模型，整个命令仍有 5 分钟超时。恢复普通检查可设置 `$env:MODEL_SMOKE_REPAIR = '0'`。

结果中的 `timingsMs` 分别记录取消检查、修复和放大的耗时，包含各自的输出校验。启用取消检查时，首次模型下载和初始化计入 `cancellation`，后续两项使用已准备好的会话；未启用时，加载时间计入对应处理步骤。比较性能时应使用相同选项和缓存条件，不要把总耗时差直接视为推理加速。

真实模型冒烟验证也可在本地页面的浏览器控制台执行：

```js
const { runBrowserSmoke } = await import('/tests/browser-smoke.mjs')
await runBrowserSmoke()
```

脚本生成 64×64 测试图片，依次执行真实修复和 4 倍放大，校验 PNG 格式、输出尺寸、透明度及放大边缘的插值。首次运行会下载并缓存模型，控制台会报告阶段和分块进度；断言失败时抛出错误。不读取个人图片，不属于默认 CI 检查，也不代替真实照片的画质评估。

运行 `await runBrowserSmoke({ exerciseCancellation: true })` 还会先在修复准备阶段和放大首个分块完成后取消，确认没有返回未完成的图片、没有继续处理后续分块，且排队任务能够恢复；随后用同一运行环境重新修复和放大，校验正常输出。

完整界面流程验证：先返回选图首页并关闭弹窗，然后在控制台执行：

```js
const { runBrowserWorkflow } = await import('/tests/browser-workflow.mjs')
await runBrowserWorkflow()
```

此脚本通过合成粘贴事件导入测试图片，点击真实放大按钮，再通过撤销/重做快捷键验证历史切换。它拦截三次下载链接并读取对应图片，核对文件名、格式和尺寸，不保存下载文件。完成后保留测试图片及历史供检查；需要浏览器支持 `DataTransfer` 和 `ClipboardEvent`，不读取系统剪贴板。等待某一步超过两分钟会报错，但不会终止已开始的模型计算，可在页面中取消处理。

运行 `await runBrowserWorkflow({ verifyCleanup: true })` 会进一步撤销并重新放大，检查被替换历史的结果和缩略图 URL 已释放，再返回选图页检查本次流程的所有对象 URL 已释放。它会临时记录 URL 创建和回收，结束或报错时恢复原始方法；此模式完成后停留在选图页，返回导出结果及资源计数。

## 容器部署与缓存

Docker 镜像使用 Caddy 提供生产静态文件。首页及客户端路由回退页面使用 `max-age=0, must-revalidate`，带哈希的 `/assets/` 文件使用一年不可变缓存；缺失的构建资源和示例图片返回 404 并设置 `Cache-Control: no-store`，不回退为 HTML，也不缓存这类失败响应。保留 COOP/COEP 跨源隔离响应头。

启动容器后可运行 `node tests/deployment-smoke.cjs http://localhost:8080`（替换为实际地址），验证页面、JS/CSS、示例图片、gzip 解压后的内容一致性、HEAD、ETag/304、缓存策略、隔离响应头和缺失资源状态；脚本只发起读取请求。

CI 的 `Production container` 任务会构建 Docker 镜像、等待本地容器就绪并执行相同部署检查。失败时输出服务日志，结束时清理测试容器；不发布镜像，也不下载 AI 模型。

## 图片导入

支持选择、拖拽或在首页通过 `Ctrl/Cmd + V` 粘贴剪贴板中的 JPG、PNG、WebP 图片（最大 10 MB），长边超过 4096 像素时会等比缩小。示例图片也经过格式、大小及解码校验。粘贴图片复用导入校验与取消逻辑；文本输入、弹窗和编辑器内的粘贴不会触发图片导入。

示例图片在读取响应内容前检查 HTTP 状态和图片类型，拒绝部分响应（206 或带 Content-Range）及非支持格式，并取消响应流；空内容也会在解码前报错。下载过程中按实际读取字节限制大小，避免持续读取超大响应。

读取期间可以取消或重新选择图片，最后一次选择生效；取消或返回首页后，旧请求不会再打开编辑器。读取超过 30 秒会显示超时提示，导入失败会在页面中说明原因，可直接重新选择文件或示例。

## 图片处理与超分

首页无需等待模型运行组件，也不会自动下载模型。选图后，编辑器在后台准备修复模型；首次处理会等待准备完成并显示当前阶段。准备期间仍可查看原图、下载图片或返回首页。模型及运行组件加载失败时，处理错误提示提供重试操作或运行环境修复入口。

4 倍放大支持最多 125 万像素的输入图片（输出最多 2000 万像素）。工具栏上方会显示当前尺寸、预计输出尺寸或超限原因；超限时不会下载超分模型。切换到较小的历史步骤后，会重新判断是否可放大。

图片预处理使用浏览器 Canvas，无需额外加载 OpenCV。结果通过异步 PNG 编码生成，编辑历史使用独立缩略图，减少图片复制及同步编码开销。

图片修复保留原图的透明度，包括半透明边缘；RGB 模型只修改颜色，不生成新的透明度。4 倍放大使用双线性插值同步缩放原图透明度，保留透明背景与柔和边缘；完全不透明图片不分配额外透明度数组，并跳过透明度缩放。

画布、原图对比及历史缩略图使用随主题切换的棋盘背景展示透明区域。原图对比层独立合成，透明区域不会透出下方编辑结果；棋盘背景仅用于界面显示，不会写入导出图片。

图片处理失败时会保留当前图片和历史，并提供重试及运行环境修复入口。修图失败后可直接重试本次涂抹，无需重新绘制；修复运行环境后也可返回原错误提示重试。关闭错误提示会丢弃待重试选区。

若编辑器模块下载失败或界面本身发生异常，会显示恢复页面，顶部导航仍可使用。可重新加载页面或返回选图；此类异常需要重新选择文件，未保存的编辑无法恢复。

GPU 模型初始化失败时，会使用已读取的模型自动尝试 WebAssembly，无需重新下载。若仍无法初始化，可通过错误提示中的入口修复运行环境。

放大模型的缓存检查与会话初始化共用一次读取，避免先读取整个模型判断存在、随后初始化时再次读取。缓存命中不显示下载弹窗；实际下载时显示共享进度，取消后立即重试可接续当前进度。已初始化的会话继续复用。

模型缓存读取超过 30 秒未完成时，会退出加载并提示重试或刷新页面。迟到的读取结果不会恢复旧处理；超时保护不会删除模型缓存。

模型下载会拒绝 HTTP 部分响应（206 或带 Content-Range）及标注为 HTML、JSON、XML 的错误页面，释放响应流后尝试备用地址；这些响应不会写入模型缓存。两处地址均失败时会显示错误，之后可重新尝试。这是下载响应校验，模型内容仍由推理运行组件在初始化时验证。

## 取消图片处理

修复、4 倍放大和超分模型下载提示均提供“取消本次处理”，也支持按 `Escape` 取消。取消后保留当前图片和编辑历史，清除本次选区；可直接继续编辑，不显示处理失败提示。其他弹窗打开时，Escape 交由该弹窗处理。退出编辑器同样取消旧图片的后续处理。

排队、模型等待、图片解码和编码阶段支持取消等待。输入图片的颜色和蒙版转换、修复后的像素转换以及放大后的透明度缩放均分批执行，批次之间响应取消，取消后不编码或提交未完成的结果。已经开始的单次推理不会被强制打断，页面会显示“正在取消，等待当前计算结束”；当前推理结束后跳过后续分块和结果提交，再恢复操作。共享模型下载和初始化可在后台继续，供后续处理复用；运行环境修复仍须等待真实计算及初始化结束。

## 编辑历史与快捷键

绘制中按 Escape 可取消尚未提交的当前笔画，立即清除预览；随后松开鼠标不会启动修复，下一笔可正常绘制。

点击“原图”进入对比模式，可在图片上拖动调整对比比例，也可聚焦对比滑块后使用左右方向键。`Home` 显示完整原图，`End` 显示当前编辑结果；窗口缩放时保留对比比例。再次点击“原图”返回涂抹编辑。

修复或放大图片后，可使用工具栏的“撤销 / 重做”逐步切换，撤销到原图后也可重做。点击历史缩略图可返回对应步骤，选中的步骤会高亮；下载及继续修图均基于当前选中的结果。

编辑结果以 PNG 导出，保留原文件名并添加 `-edited` 后缀（例如 `holiday.jpg` → `holiday-edited.png`）。原图下载保留其格式，文件扩展名会与实际编码格式保持一致。

- 撤销：`Ctrl/Cmd + Z`
- 重做：`Ctrl/Cmd + Shift + Z`，Windows 也支持 `Ctrl + Y`

切换步骤会保留后续记录；从旧步骤完成一次新编辑后，后续记录会由新分支替换。历史默认保留最多 20 步，并按约 128 MiB 的估算预算淘汰最早步骤。估算包含结果及缩略图的编码体积与 RGBA 解码体积，不包含独立保留的原图，也不代表浏览器总内存上限。当前结果始终保留；单步超过预算时独占历史。较早步骤释放后会显示提示，仍可撤销到保留的步骤或原图，步骤编号不会重新编号。历史仅保留在当前页面，刷新或开始新图片后清空。图片处理期间暂停历史操作，快捷键不会干扰输入框或弹窗。

## 网页运行环境修复

弹窗打开后，键盘焦点会进入弹窗，`Tab / Shift + Tab` 在弹窗内循环，背景编辑器暂停交互。可关闭的弹窗支持右上角关闭按钮、`Esc` 或点击遮罩；关闭后焦点返回入口。下载及修复进行中的弹窗不可通过这些方式关闭，嵌套弹窗只响应最上层的关闭操作。

点击右上角“关于 / 反馈”中的“一键修复运行环境”。模型下载失败或运行组件加载失败时，处理错误弹窗也提供此入口。

修复会重新下载图片修复模型及已使用的超分辨率模型，释放旧推理会话，并初始化单线程 WebAssembly 兼容模式。当前图片和编辑历史会保留，无需刷新页面；图片正在处理时需等待处理结束。兼容模式在本次页面会话内生效，速度可能低于 GPU 模式。

修复需要联网。若模型下载、浏览器存储或 WebAssembly 不可用，页面会显示失败原因并允许重试；网页无法替你修改浏览器设置或安装显卡驱动。

修复期间暂停新的推理请求。若释放旧会话或重建环境失败，请完成一次修复重试后再继续处理图片；当前图片及编辑历史会保留。

## Contributors

<a href="https://github.com/Antman2023/inpaint-web/graphs/contributors">
  <img src="https://contrib.rocks/image?repo=Antman2023/inpaint-web" />
</a>

## Translations via [fink editor](https://inlang.com/m/tdozzpar/app-inlang-editor)

[![Translations: Inlang](https://img.shields.io/badge/translations-inlang-5e5ce6)](https://fink.inlang.com/github.com/Antman2023/inpaint-web)

## Acknowledgements

Frontend code are modified from [cleanup.pictures](https://github.com/initml/cleanup.pictures), You can experience their
great online services [here](https://cleanup.pictures/).

Model: https://github.com/Picsart-AI-Research/MI-GAN

## Star History

[![GitHub Stars](https://img.shields.io/github/stars/Antman2023/inpaint-web?style=flat-square&logo=github)](https://github.com/Antman2023/inpaint-web)
