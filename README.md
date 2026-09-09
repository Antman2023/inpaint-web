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

## Validation

`npm run check` 依次执行代码检查、回归测试和生产构建（包含 TypeScript 检查）。也可单独运行 `npm run lint`、`npm test` 或 `npm run build`。

GitHub Actions 配置会在推送和拉取请求时运行相同检查，覆盖 Linux 上的 Node 22.22.1、Node 24，以及 Windows 上的 Node 24；使用锁文件安装依赖，不会下载 AI 模型。浏览器交互与真实模型推理仍需单独验证；回归测试覆盖预处理像素、共享模型等待取消、推理锁、历史预算及图片 URL 回收。

## 图片导入

支持选择或拖拽 JPG、PNG、WebP 图片（最大 10 MB），长边超过 4096 像素时会等比缩小。示例图片也经过格式、大小及解码校验。

读取期间可以取消或重新选择图片，最后一次选择生效；取消或返回首页后，旧请求不会再打开编辑器。读取超过 30 秒会显示超时提示，导入失败会在页面中说明原因，可直接重新选择文件或示例。

## 图片处理与超分

首页无需等待模型运行组件，也不会自动下载模型。选图后，编辑器在后台准备修复模型；首次处理会等待准备完成并显示当前阶段。准备期间仍可查看原图、下载图片或返回首页。模型及运行组件加载失败时，处理错误提示提供重试操作或运行环境修复入口。

4 倍放大支持最多 125 万像素的输入图片（输出最多 2000 万像素）。工具栏上方会显示当前尺寸、预计输出尺寸或超限原因；超限时不会下载超分模型。切换到较小的历史步骤后，会重新判断是否可放大。

图片预处理使用浏览器 Canvas，无需额外加载 OpenCV。结果通过异步 PNG 编码生成，编辑历史使用独立缩略图，减少图片复制及同步编码开销。

图片处理失败时会保留当前图片和历史，并提供重试及运行环境修复入口。修图失败后可直接重试本次涂抹，无需重新绘制；修复运行环境后也可返回原错误提示重试。关闭错误提示会丢弃待重试选区。

若编辑器模块下载失败或界面本身发生异常，会显示恢复页面，顶部导航仍可使用。可重新加载页面或返回选图；此类异常需要重新选择文件，未保存的编辑无法恢复。

GPU 模型初始化失败时，会使用已读取的模型自动尝试 WebAssembly，无需重新下载。若仍无法初始化，可通过错误提示中的入口修复运行环境。

## 取消图片处理

修复、4 倍放大和超分模型下载提示均提供“取消本次处理”。取消后保留当前图片和编辑历史，清除本次选区；可直接继续编辑，不显示处理失败提示。退出编辑器同样取消旧图片的后续处理。

排队、模型等待、图片解码和编码阶段支持取消等待。已经开始的单次推理不会被强制打断，页面会显示“正在取消，等待当前计算结束”；当前推理结束后跳过后续分块和结果提交，再恢复操作。共享模型下载和初始化可在后台继续，供后续处理复用；运行环境修复仍须等待真实计算及初始化结束。

## 编辑历史与快捷键

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
