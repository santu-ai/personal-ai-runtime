# 用户偏好

> 动态区。从用户规则与项目行为观察沉淀；过期了可以改。

## 沟通

- 用**简体中文**回复。
- 简洁、直给；不过度铺垫。

## 工程习惯

- 提交遵循 Conventional Commits，subject 不以句号结尾（钩子强制）。
- 重视架构纪律与不变量（Kernel 边界、层依赖、事件溯源、概念压缩）——改动前先看 `architecture-redlines.md`。
- 开发环境为 **Windows**（PowerShell）；注意 `Makefile.ps1` 与 `make` 的差异。
- 用 dogfood 证据驱动重构，不为了"更干净"强行删概念（项目演化原则之一）。

## 记录习惯

- dogfood 周记格式：一行 `2026-WW Chat:pass Memory:fail Work:pass Desktop:pass Inbox:blocked`，记录在本地笔记或 PR 描述。
- 周记类过程记录放在 `.harness/dogfood/`。
