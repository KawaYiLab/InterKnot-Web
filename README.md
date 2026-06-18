# 绳网 (InterKnot)

> **⚠️ 本仓库已停止维护，不再接收功能更新，仅供学习、参考与历史版本存档。**

<p align="center">
  <img src="icon.webp" alt="Inter-Knot Logo" width="120" />
</p>

<p align="center">
  <strong>绳网——新艾利都最大的匿名委托中枢。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Status-Unmaintained-red" alt="Unmaintained">
  <img src="https://img.shields.io/badge/Nuxt-4.x-00DC82?logo=nuxtdotjs&logoColor=white" alt="Nuxt 4">
  <img src="https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vuedotjs&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node-%E2%89%A520.18-339933?logo=nodedotjs&logoColor=white" alt="Node">
</p>

本项目是 [KawaYiLab/InterKnot-App](https://github.com/KawaYiLab/InterKnot-App) 独立开发的**网页前端**，使用 Nuxt 4 从零构建，模仿绝区零 UI 风格，后端对接自建 Strapi v5。

> 后端：[KawaYiLab/InterKnot-server](https://github.com/KawaYiLab/InterKnot-server)

---

## 🛠️ 技术栈

| 层级       | 技术                                                                                                                   |
| -------- | -------------------------------------------------------------------------------------------------------------------- |
| **框架**   | [Nuxt 4](https://nuxt.com/)                                                                                          |
| **语言**   | [TypeScript 5](https://www.typescriptlang.org/)                                                                      |
| **状态管理** | [Pinia](https://pinia.vuejs.org/)                                                                                    |
| **数据请求** | [TanStack Vue Query](https://tanstack.com/query/latest/docs/vue/overview) + [ofetch](https://github.com/unjs/ofetch) |
| **工具库**  | [VueUse](https://vueuse.org/)                                                                                        |
| **组件库**  | [zenless-ui](https://github.com/ChrisChan13/zenless-ui)                                                              |
| **图标**   | [Heroicons](https://heroicons.com/)                                                                                  |
| **图片画廊** | [lightGallery](https://www.lightgalleryjs.com/)                                                                      |
| **后端**   | [Strapi v5](https://strapi.io/)（RESTful API）                                                                         |

---

## 🚀 快速开始

### 1. 环境准备

* **Node.js** ≥ 20.18.0
* **npm**

### 2. 拉取代码

```bash
git clone https://github.com/yinengbei/InterKnot-Web.git
cd InterKnot-Web
```

### 3. 安装依赖

```bash
npm install
```

### 4. 配置环境变量

复制示例文件并填写后端地址：

```bash
cp .env.example .env
```

### 5. 启动开发服务器

```bash
npm run dev
```

访问 `http://localhost:3000` 即可预览。

### 6. 构建生产版本

```bash
npm run generate
npm run preview
```

---

## 🤝 贡献指南

由于本项目已停止维护，原则上不再接受新功能开发。如发现安全问题或严重 Bug，可提交 Issue 进行讨论。

---

## ❤️ 致谢

本项目从零开始开发，在实现过程中参考了许多优秀的开源项目与社区资源。

特别感谢：

* share121 开源的 Inter-Knot 项目
  https://github.com/share121/inter-knot

* ChrisChan13 开发的 zenless-ui 组件库
  https://github.com/ChrisChan13/zenless-ui

* Alver 提供的部分 UI 设计参考与图片资源
  https://zenless.tools/

* 所有提交 Issue、Pull Request、反馈问题或提供建议的开发者与用户

同时感谢开源社区以及 AI 工具在开发过程中提供的帮助与支持。
