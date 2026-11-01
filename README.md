# 绳网 (InterKnot)

<p align="center">
  <img src="https://github.com/user-attachments/assets/0e6f2ca9-440b-4b90-8bc4-402c6078d430" alt="Inter-Knot Logo" width="120" />
</p>

<p align="center">
  <strong>绳网——新艾利都最大的匿名委托中枢。</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Nuxt-4.x-00DC82?logo=nuxtdotjs&logoColor=white" alt="Nuxt 4">
  <img src="https://img.shields.io/badge/Vue-3.x-4FC08D?logo=vuedotjs&logoColor=white" alt="Vue 3">
  <img src="https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white" alt="TypeScript">
  <img src="https://img.shields.io/badge/Node-%E2%89%A520.18-339933?logo=nodedotjs&logoColor=white" alt="Node">
</p>

> 后端：[KawaYiLab/ikserver-rs](https://github.com/KawaYiLab/ikserver-rs)（Rust，接口前缀 `/v1`）



## 🖥️ 界面预览

<p align="center">
  <img src="https://github.com/user-attachments/assets/ab4689fe-8908-4618-b307-0006985e7ebd" alt="home" width="49%" />
  <img src="https://github.com/user-attachments/assets/df7ed0f5-dc7a-4ca2-8808-405e699d0dcc" alt="kk" width="49%" />
</p>



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

### 4. 准备后端

前端调用 [ikserver-rs](https://github.com/KawaYiLab/ikserver-rs) 的 `/v1` 接口。按它的 `docs/dev-setup.md`
在本机启动 `ik-server serve`（默认 `http://localhost:8080`），并确认它的 `IK_HTTP__ALLOWED_ORIGINS`
包含 `http://localhost:3000`。

网页与接口同源：生产环境由 nginx 把页面域名下的 `/v1`（含 WebSocket `/v1/realtime`）反代到 ik-server，
登录态是 HttpOnly 会话 Cookie。本地开发时：

- `npm run dev` 把 `/v1` 代理到 `NUXT_DEV_API_PROXY`（默认 `http://localhost:8080`）；
- 开发服务器不转发 WebSocket 升级，实时通道直连 `ws://localhost:8080/v1/realtime`
  （Cookie 不区分端口，可用 `NUXT_PUBLIC_REALTIME_URL` 改地址）。

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


## ❤️ 致谢

本项目从零开始开发，在实现过程中参考了许多优秀的开源项目与社区资源。

特别感谢：

* share121 开源的 Inter-Knot 项目
  https://github.com/share121/inter-knot

* ChrisChan13 开发的 zenless-ui 组件库
  https://github.com/ChrisChan13/zenless-ui

* Alver 提供的部分 UI 设计参考与图片资源
  https://zenless.tools/

* 橙汁本色 开源的 DSH 项目
  https://github.com/Chengzhibense/Fairy-DSH

* 所有提交 Issue、Pull Request、反馈问题或提供建议的开发者与用户

