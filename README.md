# 旅章 (RPGTravel)

> 一款基于纯前端技术打造的沉浸式旅行任务打卡与离线图文日志 PWA。

[![PWA Ready](https://img.shields.io/badge/PWA-Ready-orange.svg)](https://lenyli.github.io/RPGTravel/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

## 项目简介

**旅章 (RPGTravel)** 将 RPG 冒险任务机制与现实旅行打卡相结合。使用者在旅行过程中可以如同角色扮演游戏一般探索各个地点、收集线索、触发剧情结局，并记录附带现场照片与心得的旅行图文日志。

整个应用为纯前端单页应用（SPA），数据完全存储于用户本地浏览器，无需登录注册，不依赖外部后端接口，充分保障用户的旅行轨迹与照片隐私。

- 🌐 **在线演示体验**：[https://lenyli.github.io/RPGTravel/](https://lenyli.github.io/RPGTravel/)

---

## 核心功能特色

- 🗺️ **RPG 探索式旅行任务**：按章节推进地点调查，支持按部就班探索或自由跳跃探索，达成条件后解锁最终旅行结局。
- 📸 **本地图文日志**：支持现场拍摄或从相册选择照片，本地自动生成缩略图与详情，支持记录旅行感悟与地点时间戳。
- 📱 **PWA 离线支持**：内置完善的 Service Worker 缓存，一次加载即可无网离线运行；支持“添加到主屏幕”作为桌面/移动原生体验应用。
- 🔒 **纯本地隐私存储**：所有进度、日志、照片均持久化存储于浏览器的 IndexedDB 数据库中，数据绝不上传第三方服务器。
- 💾 **完整数据备份与恢复**：支持一键导出包含全部照片与进度的备份文件，并支持在其他设备或浏览器上完整恢复。

---

## 本地开发与构建

本项目使用 Vite + React + TypeScript 构建。

### 前置依赖
- [Node.js](https://nodejs.org/) (推荐 LTS 版本，>= 18.0.0)
- npm / pnpm / yarn

### 快速启动

1. **克隆代码库**：
   ```bash
   git clone https://github.com/lenyli/RPGTravel.git
   cd RPGTravel
   ```

2. **安装依赖**：
   ```bash
   npm install
   ```

3. **启动本地开发服务器**：
   ```bash
   npm run dev
   ```
   启动后在浏览器访问控制台输出的本地地址（通常为 `http://localhost:5173/`）。

4. **生产环境构建与类型检查**：
   ```bash
   # TypeScript 类型检查
   npm run typecheck

   # 生产构建（产物位于 dist/）
   npm run build

   # 预览构建产物
   npm run preview
   ```

---

## 技术架构

- **UI / 视图层**：React 19、Tailwind CSS
- **语言 / 构建工具**：TypeScript、Vite
- **本地数据库**：IndexedDB（封装统一持久化存储）
- **离线与 PWA**：Workbox / Vite Plugin PWA
