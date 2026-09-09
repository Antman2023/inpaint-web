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

`npm install`

## Development

`npm run start`

## 网页运行环境修复

点击右上角“关于 / 反馈”中的“一键修复运行环境”。模型下载失败或运行组件加载失败时，错误页面也提供此入口。

修复会重新下载图片修复模型及已使用的超分辨率模型，释放旧推理会话，并初始化单线程 WebAssembly 兼容模式。当前图片和编辑历史会保留，无需刷新页面；图片正在处理时需等待处理结束。兼容模式在本次页面会话内生效，速度可能低于 GPU 模式。

修复需要联网。若模型下载、浏览器存储或 WebAssembly 不可用，页面会显示失败原因并允许重试；网页无法替你修改浏览器设置或安装显卡驱动。

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
