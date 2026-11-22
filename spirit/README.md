# 生灵引 · Souls' Draw

> 罗小黑战记世界观下的随机人生模拟——你抽中一签，降生为妖或人，在灵气与烟火交织的世界走过一生。

[在线体验](https://joyhou-hw.github.io/souls-draw/)

![生灵引](assets/screenshot.png)

---

## 目录

- [简介](#简介)
- [架构](#架构)
- [模块](#模块)
- [玩法](#玩法)
- [安装部署](#安装部署)
- [世界数据统计](#世界数据统计)
- [开源协议](#开源协议)

---

## 简介

《生灵引》是一个基于 TypeScript 的通用人生模拟框架，引擎与世界包解耦，当前内置首个世界包——**罗小黑战记**。

玩家通过抽签降生为人类或妖精，在灵气共存的世界中经历成长、修行、抉择、战乱与飞升，每一生都是确定但未知的故事——同一 seed 产出同一人生，但叙事文本随机不放回抽样，保证体验不重复。

---

## 架构

```
┌─────────────────────────────────────────┐
│            Web 前端 (Vite)              │
│  life.ts · draw.ts · composer.ts        │
│  Canvas 纸娃娃合成 · CSS 动画 · 响应式   │
├─────────────────────────────────────────┤
│              核心引擎 (engine)            │
│  engine.ts · birth.ts · death.ts         │
│  narrative.ts · rng.ts · types.ts        │
├─────────────────────────────────────────┤
│           DSL 编译器 (dsl)                │
│  parse.ts · compile.ts · validate.ts     │
│  narratives.ts (叙事配置校验)             │
├─────────────────────────────────────────┤
│           CLI 工具 (cli)                  │
│  main.ts · narrate.ts (终端叙事输出)      │
├─────────────────────────────────────────┤
│           世界包 (worlds/)                │
│  luoxiaohei/world.yaml    世界定义        │
│  luoxiaohei/narratives.yaml 叙事词库      │
└─────────────────────────────────────────┘
```

**设计原则**：

- **引擎世界无关**——引擎不硬编码任何世界内容，世界包通过 YAML 定义全部规则
- **确定性模拟**——同一 seed + 同一抉择序列 = 同一人生轨迹
- **叙事与逻辑分离**——引擎产出事件日志，叙事渲染器负责文本呈现
- **纸娃娃合成**——场景底图 + 主角图层 + 特效图层 Canvas 合成，素材驱动

---

## 模块

| 模块 | 路径 | 职责 |
|------|------|------|
| **engine** | `packages/engine/` | 核心模拟引擎：出生轴、事件池、抉择、死亡判定、修行突破、叙事渲染 |
| **dsl** | `packages/dsl/` | YAML 解析器（自研 mini-yaml）、世界包编译校验、叙事配置校验 |
| **web** | `packages/web/` | Vite 前端：抽签动画、人生播放器、Canvas 合成、存档导入导出 |
| **cli** | `packages/cli/` | 命令行工具：终端人生模拟与叙事输出 |
| **worlds** | `worlds/luoxiaohei/` | 罗小黑战记世界包：世界规则 + 叙事词库 |

---

## 玩法

### 抽签降生

输入一个数字 seed（或随机），系统通过确定概率轴决定你的出生形态、降生地、纪元、灵质属性。

### 一生模拟

降生后自动播放人生日志，每条记录一个 tick（年）的事件。可暂停/继续、调速（1× ~ 8×）、收藏关键条目。

### 抉择

人生中会遇到 21 种抉择事件（如何应对战乱、是否加入会馆、是否拜师修行等），选择不同路径影响后续人生走向。

### 修行突破

灵气显性者有概率踏入修行之路，经历七个阶段：

| 阶段 | 事件 | 触发权重 |
|------|------|----------|
| 凡体 | init_tier | 4.0 |
| 凝形 | gate_ningxing | 1.5 |
| 御物 | gate_yuwu | 1.3 |
| 灵域 | gate_lingyu | 1.2 |
| 大妖 | gate_dayao | 1.2 |
| 圣灵 | gate_shengling | 1.0 |
| 飞升 | ascend_trigger | 0.8 |

### 死亡

生命系统基于 hazard 曲线，不同年龄段有不同的灾祸概率。修行者可享寿长加成。

---

## 安装部署

### 环境要求

- Node.js >= 22（原生 TypeScript 执行）
- 包管理器：npm / pnpm

### 本地开发

```bash
git clone https://github.com/joyhou-hw/souls-draw.git
cd souls-draw/spirit
npm install
npm run dev          # 启动 Vite 开发服务器
```

### 构建

```bash
npm run build        # 输出到 dist/
npm run preview      # 本地预览构建产物
```

### 测试

```bash
# 全量测试
node --test packages/engine/src/*.test.ts packages/dsl/src/*.test.ts packages/cli/src/*.test.ts
```

### GitHub Pages 部署

项目使用相对路径 `base: './'`，构建后 `dist/` 目录可直接部署到 GitHub Pages：

1. `npm run build`
2. 将 `dist/` 推送到 `gh-pages` 分支，或配置 GitHub Actions 自动部署

---

## 世界数据统计

### 出生形态概率

| 形态 | 概率 |
|------|------|
| 兽妖 animal_yao | 31.0% |
| 游灵 spirit_yao | 26.5% |
| 草木妖 plant_yao | 18.0% |
| 凡人 human | 12.5% |
| 菌蕈妖 fungus_yao | 9.0% |
| 器灵 painted_yao | 3.0% |

### 修行入口

| 闸门 | 概率 |
|------|------|
| 灵气显性 (step1) | 85% |
| 入门事件 (step2) | 70% |
| 综合入修行率 | ~60% |

### 事件池

| 事件池 | 数量 |
|--------|------|
| 日常事件 (events) | 37 |
| 场景事件 (scenes) | 77 |
| 突发事件 (shocks) | 4 |
| **合计** | **118** |

其中：

- 抉择事件：21 个
- 终局事件（飞升）：1 个

### 死亡危害曲线

| 年龄段 (tick) | hazard |
|----------------|--------|
| 0-39 | 0.003 |
| 40-79 | 0.006 |
| 80-99 | 0.015 |
| 100-129 | 0.03 |
| 130+ | 0.08 |

### 出生轴

| 轴 | 取值 |
|----|------|
| 降生地 (region) | 森林 / 城市 / 会馆领地 / 隐修岛 |
| 纪元 (era) | 古代 / 现代 |

### 叙事词库

| 类别 | 条目数 |
|------|--------|
| 平静之年 (quiet_year) | 142 条（分形态 × 年龄段桶） |
| 开场白 (openers) | 60 条 |
| 收尾语 (closers) | 60 条 |
| 插页 (interludes) | 60 条（4 类 × 15 条） |
| 里程碑题注 (milestones) | 120 条（8 个里程碑 × 15 条） |
| **叙事总条目** | **442 条** |

---

## 开源协议

### MIT License

```
MIT License

Copyright (c) 2026 joyhou-hw

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 非商业声明

本项目仅供学习和个人娱乐使用，不得用于商业用途。项目中的世界设定灵感来自《罗小黑战记》动画作品，相关角色和世界观的版权归原作者所有。本项目不拥有任何原作角色的版权，如有侵权请联系删除。
