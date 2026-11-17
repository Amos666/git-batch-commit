# IntelliJ IDEA 式 Git 提交体验 VS Code 扩展

## 可行性、架构与实施方案报告

| 项目              | 内容                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 文档版本          | v0.2（实施方案定稿；架构决策已确认）                                                                                           |
| 日期              | 2026-11-15（v0.1：2026-11-13）                                                                                                 |
| 产品名            | **Git Batch Commit**（`git-batch-commit`）                                                                                     |
| 范围              | 需求分析、源码调研、架构设计、实施路线；**不含生产代码**                                                                       |
| 参考 IDEA 源码    | `intellij-community`，`build.txt = 271.SNAPSHOT`，commit `a40efd2b8`                                                           |
| 参考 GitJet 源码  | `zhyc9de/jet-git`（`git-brains` 0.0.4）；`aotemj/jetbrains-git-graph`（`idea-like-git-graph` 0.4.17）                          |
| 参考 VS Code 源码 | `microsoft/vscode` `main`，内置 Git 扩展 `extensions/git/`（`git` 10.0.0），见《VSCode-Git-架构对比分析》                      |
| 结论              | **可行。采用“复用内置 Git 扩展 API + 自建 IDEA 式面板”路线（路线 A），与内置 SCM 并存；错误呈现用“错误码分类 + 终端重试”兜底** |

**v0.2 修订说明**：原 v0.1 推荐“完全自建 Git 内核”。经对 VS Code 内置 Git 扩展源码的深入分析（其对外导出完整 API，且进程治理/认证/锁重试/watcher 均已内置），架构决策改为**路线 A（API 复用）**，相关章节（§6–§9、§12）已按此更新。原“自建内核”内容作为 P2 可选路径保留在《VSCode-Git-架构对比分析》中。

> 说明：文中的 IDEA 行号基于上述源码快照；GitJet 行号基于下载的 0.0.4 / 0.4.17 源码包。上游更新后行号可能漂移，但类名与职责稳定。

---

## 0. 结论摘要（TL;DR）

### 0.1 可行性判断

**可以做到行为级 1:1，且不需要依赖 IntelliJ 平台。** IDEA 的提交体验并不是某种不可复刻的 IDE 魔法，它由三个可独立实现的层次组成：

1. **包含模型（Inclusion Model）**：哪些文件/仓库参与本次提交；
2. **提交流程状态机（Commit Workflow）**：校验 → 执行 → 进度 → 结果聚合；
3. **Git 命令构造器（Committer）**：把消息、选项、暂存内容变成正确的 `git commit`。

VS Code 的扩展宿主（Extension Host）+ Webview + 原生 Diff Editor 足以实现上述三层。且经对内置 Git 扩展的分析（《VSCode-Git-架构对比分析》）：**Git 进程治理、认证、锁重试、大仓库防护可整体复用其公开 API**，剩余难点收敛为**包含模型映射、多仓库编排语义、失败呈现与大仓库 UI 性能**。

### 0.2 对 GitJet 的判断

GitJet（含 `idea-like-git-graph` 分支）已经做出了“像 IDEA 的提交面板”的雏形，但**不建议在其基础上继续开发**。原因不是界面，而是内核：

- `execGit` 没有超时、取消、stdin 关闭、进程树清理（`src/git/gitService.ts:52-66`）；
- Webview 请求 10 秒硬超时（`webview/src/shared/bridge/vscode-bridge.ts:47-50`），而 Git 进程继续运行，形成“UI 已失败、后台还在提交”的分裂状态；
- 提交/暂存/状态刷新没有按仓库串行化，watcher 会与写操作竞争；
- 多根工作区聚合了所有仓库的状态（`src/extension.ts:958-971`），但提交/暂存/ diff 只使用第一个 `gitService`（`src/extension.ts:55`、`995-1026`），多仓库路径是坏的；
- `commitChanges` 先把选中文件 `git add`，然后提交**整个 index**，并非只提交选中项（`src/extension.ts:995-1009`）；
- 首次加载不默认勾选任何文件（`webview/src/shared/store/commit-store.ts:121-123`），而提交按钮要求至少选中一个文件（`CommitMessageArea.tsx:26-28`），用户第一眼看到的是“提交按钮是灰的”，很容易被理解为“卡死/不能用”；
- 状态解析使用 `git status --porcelain=v1` 且不带 `-z`（`gitService.ts:923-989`），对引号、Unicode、换行文件名不可靠，大仓库也慢；
- amend 后 `commitAndPush` 会自动 `--force-with-lease`（`gitService.ts:1015-1022`、`684`），危险且不符合 IDEA 默认语义。

这些问题是架构性的，在 GitJet 上修补不值得。结论（v0.2）：**不 fork GitJet，也无需从零自建 Git 内核——复用内置 Git 扩展 API 承担 Git 层（路线 A），自建仅限包含模型映射、多仓库编排与 IDEA 式 UI**；GitJet 仅作为交互反面教材参考。

### 0.3 工作量结论（v0.2，按路线 A 调整）

| 范围     | 内容                                                                                                                     | 单人估算       | 两人并行    |
| -------- | ------------------------------------------------------------------------------------------------------------------------ | -------------- | ----------- |
| P0       | Webview 提交面板 + 包含模型映射 + 批量提交（多仓库编排）+ Diff + 分支显示/切换 + 错误呈现                                | **3–4 周**     | 2–3 周      |
| P1       | Commit & Push、分支树/对比、日志分页、Stash、提交选项（sign-off/no-verify/作者/模板）、Hunk 级暂存、冲突处理、Shelf 雏形 | +4–5 周        | +3–4 周     |
| P2       | Shelf 完整、Changelist、提交图、交互式 rebase、错误 stderr 增强（自建只读复现）、性能极限优化                            | +5–8 周        | +4–6 周     |
| **合计** | 行为级接近 IDEA                                                                                                          | **12–17 人周** | **7–10 周** |

> 相比 v0.1（14–21 人周）下调约 25%：进程治理、认证、状态刷新、锁重试、大仓库防护由内置 Git 扩展承担，P0 不再需要自建内核。估算仍不含市场、文档、签名、CI 基建；建议保留 20% 缓冲。

### 0.4 关键决策（已确认，2026-11-15）

| #   | 决策点              | 结论                                                                        |
| --- | ------------------- | --------------------------------------------------------------------------- |
| 1   | 包含模型            | P0 用 Git index（暂存区）模型；Changelist 为 P2                             |
| 2   | 多仓库交互          | 单面板按仓库分组；单仓库时隐藏组头                                          |
| 3   | 默认提交按钮        | 默认 Commit；Commit & Push 放下拉                                           |
| 4   | 强制推送            | 仅显式操作 + 二次确认；amend 不自动强推                                     |
| 5   | Shelf               | P1 先做 Stash；Shelf 为 P2                                                  |
| 6   | 部分提交            | P0 文件级；Hunk 级 P1                                                       |
| 7   | **架构路线**        | **路线 A：复用内置 Git 扩展 API（`vscode.git` → `getAPI(1)`），不自建内核** |
| 8   | **与内置 SCM 关系** | **并存**：不隐藏/不抢占内置 SCM；我们的面板是新增视图                       |
| 9   | **错误呈现**        | **错误码分类 + 恢复动作 + “在终端重试”兜底**（不追求 stderr 级详情）        |
| 10  | 代码复用            | 不 fork GitJet；仅参考交互，核心自研                                        |
| 11  | 最低版本            | VS Code 1.85+（实际随 VS Code 版本）；Git 版本由内置扩展管理                |
| 12  | 品牌与命名          | 产品名 **Git Batch Commit**（见 §5.6）                                      |

---

## 1. 目标、边界与“1:1”的定义

### 1.1 目标

在 VS Code 中提供与 IntelliJ IDEA Git 提交体验**行为一致**的能力，重点覆盖：

- 批量选择文件后一次提交；
- 暂存区/未暂存区/未跟踪文件的清晰分组与勾选；
- 文件级、Hunk 级（后续）代码对比；
- 提交面板内显示当前分支、可切换分支；
- 提交消息、历史消息、Amend、Commit & Push；
- 多仓库（multi-root、嵌套仓库、worktree、submodule）正确归组；
- 提交过程的进度、取消、逐仓库结果与失败原因；
- 大仓库下不卡顿、不重复提交、不丢失用户选择。

### 1.2 “1:1”的边界

“1:1”指**任务语义和操作路径一致**，不是 Swing 像素级复刻：

- IDEA 的按钮位置、快捷键（Ctrl/Cmd+Enter）、Commit 分裂按钮、下拉执行器应对应存在；
- IDEA 的“Changes / Unversioned Files”分组、包含复选框、右键菜单应对应存在；
- IDEA 的“Commit 只提交 included changes”语义必须一致；
- 视觉上遵循 VS Code 设计语言（主题变量、Codicon），不携带 JetBrains 品牌资产。

### 1.3 非目标（首版不做）

- 完整替代 VS Code 内置 SCM（保留互操作，不抢占 `git.*` 命令）；
- 交互式 rebase 全流程、`git bisect`、`git filter-repo`；
- Git LFS 专属 UI、Submodule 递归更新 UI；
- 自建 Git 进程执行层（一律经内置 Git 扩展 API；仅 P1 MiniRunner 白名单 3 个命令例外）；
- JetBrains 账号、AI 提交信息生成（可作为可选后续）。

### 1.4 验收成功的定义

一个典型用户在不看文档的情况下可以：

1. 在含 2 个仓库的工作区打开提交面板；
2. 看到按仓库分组的变更，勾选 3 个文件，查看其中 2 个的 Diff；
3. 输入消息，按 Ctrl+Enter 提交；
4. 看到每个仓库的成功/失败结果，分支 ahead 数更新；
5. 整个过程 UI 不冻结；多仓库提交可"取消后续仓库"，单仓库进行中操作虽不可中断但会可靠返回结果（成功或错误码 + 动作）；
6. 重复点击不会产生第二个 commit。

---

## 2. IDEA Git 提交体系拆解

### 2.1 分层结构

```
┌─────────────────────────────────────────────────────────────┐
│ UI 层                                                        │
│  NonModalCommitPanel（消息编辑器 + 工具栏 + 变更树 + 底部动作）│
│  ├─ CommitActionsPanel（Commit 分裂按钮 / 下拉 / Ctrl+Enter） │
│  ├─ ChangesViewCommitPanel（Changes 视图绑定）                │
│  ├─ GitStageCommitPanel（暂存区模式）                         │
│  └─ CurrentBranchComponent（面板内分支胶囊）                  │
├─────────────────────────────────────────────────────────────┤
│ 工作流层                                                     │
│  AbstractCommitWorkflow → NonModalCommitWorkflow              │
│  ├─ CommitChecks（提交前检查）                                │
│  ├─ CommitExecutor（普通提交 / Commit & Push）                │
│  ├─ CommitContext（消息、选项、作者、amend）                  │
│  └─ 结果处理器（通知、进度、错误聚合）                         │
├─────────────────────────────────────────────────────────────┤
│ VCS/Git 后端                                                 │
│  GitStageTracker（index 状态跟踪）                            │
│  GitStageCommitWorkflow / GitStageCommitter（暂存区提交）      │
│  GitRepositoryCommitter（-F 消息文件、选项、GPG/空提交检测）   │
│  GitCommitAndPushExecutor（提交后推送）                       │
│  ShelveChangesManager / GitShelveChangesSaver / GitStash...   │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 UI 组成与职责

#### `NonModalCommitPanel`

位置：`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitPanel.kt`

它是提交面板的骨架，组合了：

- `CommitMessage`：多行消息编辑器、历史、模板；
- `CommitActionsPanel`：底部提交按钮区；
- `CommitAuthorComponent`：作者显示/覆盖；
- `centerPanel`：变更树/暂存树；
- `toolbar`：`ChangesView.CommitToolbar` 动作组（刷新、分组、展开、rollback 等）；
- `InclusionListener`：文件勾选变化后通知工作流；
- 进度组件与提交选项 UI。

关键设计点：**面板只负责“展示 + 收集包含状态”，不直接执行 Git**；执行由 workflow 层完成。这保证了“提交中禁止改包含集”“提交后统一清理状态”等行为。

#### `CommitActionsPanel`

位置：`platform/vcs-impl/src/com/intellij/vcs/commit/CommitActionsPanel.kt`

- 使用 `JBOptionButton` 实现“主按钮 + 下拉箭头”；
- 主按钮触发默认 executor（通常是 Commit）；
- 下拉里是 `CommitExecutor` 列表（Commit、Commit and Push 等）；
- 绑定 `Ctrl+Enter` / `Cmd+Enter`；
- 根据 `CommitWorkflowUi` 状态启用/禁用；
- 提交中显示进度并禁止重复触发。

这正是 VS Code 里需要复刻的“分裂按钮 + 下拉执行器 + 快捷键”模型。

#### `ChangesViewCommitPanel`

把 Changes 视图的包含模型绑定到提交面板：用户在 Changes 树里勾选，提交面板的“将提交的文件”同步变化。IDEA 的“提交”不是简单的 `git add -A && git commit`，而是先形成一个 **included set**。

#### `GitStageCommitPanel`

位置：`plugins/git4idea/backend/src/index/ui/GitStageCommitPanel.kt`

暂存区模式的提交面板：

- 从 `GitStageTracker.State` 派生 staged/changed 集合；
- `getIncludedChanges()` 返回已暂存变更；
- `getIncludedUnversionedFiles()` 返回未跟踪但被包含的文件；
- 支持“Commit All”开关（`settings.isCommitAllEnabled`）；
- 变更树展示 `HEAD → STAGED` 与 `HEAD → LOCAL` 的差异。

#### `CurrentBranchComponent`

位置：`platform/vcs-impl/src/com/intellij/openapi/vcs/changes/ui/CurrentBranchComponent.kt`

提交面板顶部的当前分支胶囊：显示分支名、可点击切换/新建分支。VS Code 中应对应一个 branch chip + QuickPick。

### 2.3 工作流层

#### `AbstractCommitWorkflow` / `NonModalCommitWorkflow`

职责：

- 持有 `CommitContext`（消息、amend、sign-off、作者、日期、cleanup、skip hooks）；
- 运行 `CommitChecks`（可配置的提交前检查）；
- 选择 `CommitExecutor`；
- 管理 `isCommitInProgress`、进度文本、取消；
- 汇总每个仓库的结果，生成通知；
- 提交成功后清理消息/包含状态（是否清空消息可配置）。

#### `NonModalCommitWorkflowHandler`

位置：`platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt`

把 UI 事件（点击提交、包含变化、取消）翻译成 workflow 调用，并把 workflow 状态回灌 UI。它是 UI 与领域逻辑的粘合层，避免 UI 直接持有 Git 命令细节。

#### `GitCommitAndPushExecutor`

位置：`plugins/git4idea/backend/src/checkin/GitCommitAndPushExecutor.kt`

语义要点：

- 先执行 Commit，成功后才 Push；
- Push 的目标是当前分支的 upstream；
- **Amend 不会自动强推**；
- Push 失败不回滚本地 commit，但会明确告知“本地已提交、远端未推送”；
- 多仓库时逐仓库执行并聚合结果。

### 2.4 Git 后端关键类

#### `GitStageCommitWorkflow`

位置：`plugins/git4idea/backend/src/index/GitStageCommitWorkflow.kt`

关键逻辑：

- `getFullyStagedPaths()`：已暂存且工作区无额外修改的路径；
- `getChangedPaths()`：所有 tracked 变更路径；
- 当 `isCommitAll && 非 amend` 时，提交所有变更；否则只提交 fully staged；
- 通过 `GitStageCommitter` 执行，最终仍走 `GitRepositoryCommitter`。

这解释了 IDEA 暂存区模式的两个语义：

1. 普通提交 = 只提交 index 中已暂存的内容；
2. “Commit All” = 提交所有 tracked 变更（包括未暂存），但**不包含未跟踪文件**，除非显式 add。

#### `GitRepositoryCommitter`

位置：`plugins/git4idea/backend/src/checkin/GitRepositoryCommitter.kt`

它是最值得借鉴的“提交命令构造器”：

- 将提交消息写入临时文件，使用 `git commit -F <file>`（`GitRepositoryCommitter.kt:62-63、129-131`），避免命令行转义、换行、编码问题；
- 按选项追加参数：
  - `--amend`（amend last）
  - `--allow-empty`（amend specific）
  - `--signoff`
  - `--no-verify`（skip hooks）
  - `--cleanup=strip`
  - `--author=...`
  - `--date ...`
- 挂载三个问题检测器：
  - `GitPinentryProblemDetector`：GPG pinentry 无法弹窗；
  - `GitGpgProblemDetector`：GPG 签名失败；
  - `GitEmptyCommitProblemDetector`：没有可提交内容；
- 捕获异常后给出针对性提示，而不是把原始 stderr 直接丢给用户。

**这是 GitJet 最欠缺的部分**：它用 `git commit -m <message>`（`gitService.ts:1008-1013`），没有消息文件、没有选项构造、没有错误分类。

#### Shelf / Stash

- `platform/vcs-impl/.../shelf/ShelveChangesManager.kt`：IDEA Shelf 管理器；
- `plugins/git4idea/backend/src/stash/GitShelveChangesSaver.java`：IDEA Shelf 的 Git 实现；
- `GitStashChangesSaver.java`：标准 `git stash` 实现；
- `GitStashTracker.kt` / `GitStashCache.kt`：stash 状态跟踪。

IDEA 的 Shelf 与 `git stash` 不是一回事：Shelf 是 IDE 管理的补丁存储（可命名、可部分恢复、跨分支），`stash` 是 Git 原生栈。1:1 若包含 Shelf，需要独立存储层；若只要求“暂存改动”，`git stash` 足够。

### 2.5 两种包含模型

| 维度                | 暂存区模式（GitStageCommitPanel） | Changelist 模式（ChangesView） |
| ------------------- | --------------------------------- | ------------------------------ |
| 包含状态存放        | 真实 Git index                    | IDEA 内存中的 ChangeList       |
| 文件级暂存          | `git add` / `git reset`           | 仅虚拟勾选，提交时再构造       |
| 与外部 Git 操作兼容 | 完全兼容                          | 需要同步/冲突处理              |
| 部分提交            | 天然支持（index 即快照）          | 需要生成补丁                   |
| 多仓库              | 每仓库独立 index                  | 每仓库 ChangeList              |
| 实现复杂度          | 中                                | 高                             |
| 建议                | **P0 采用**                       | P2 可选                        |

> 重要：如果 P0 选择 Changelist 模式，会同时引入“虚拟包含状态 + 真实 index 同步”的双重一致性难题，显著抬高首版风险。建议先用 index 模型把主链路做稳。

### 2.6 IDEA 提交语义清单（必须对齐）

| 行为       | IDEA 语义                  | VS Code 实现要点                                 |
| ---------- | -------------------------- | ------------------------------------------------ |
| 普通提交   | 只提交 included/已暂存内容 | 先确保 index 与包含集一致，再 `commit`           |
| Commit All | 提交所有 tracked 变更      | 需要显式 `git add -u`，不包含 untracked          |
| Amend      | 修改上一条提交             | `--amend`；若已推送需警告，绝不自动强推          |
| Sign-off   | 追加 `Signed-off-by`       | `--signoff`                                      |
| Skip hooks | 跳过 pre-commit/commit-msg | `--no-verify`，需用户显式选择                    |
| Cleanup    | 去除注释/空白              | `--cleanup=strip`（有模板时）                    |
| 作者覆盖   | 临时指定 author            | `--author`，不改全局配置                         |
| 日期覆盖   | 指定 author date           | `--date`                                         |
| 空提交     | 默认阻止并提示             | 解析 “nothing to commit”，不自动 `--allow-empty` |
| 提交消息   | 支持多行/模板/历史         | 写入临时文件 + `-F`，不要 `-m` 拼接              |
| 提交后     | 清空消息、刷新状态、通知   | 可配置保留消息；刷新失败不应回滚提交             |
| 失败       | 逐仓库聚合、可重试         | 明确“哪些仓库成功/失败”，不假装全成功            |

---

## 3. GitJet / idea-like-git-graph 现状分析

### 3.1 项目事实

| 项目                         | 包名                  | 版本   | 说明                                                         |
| ---------------------------- | --------------------- | ------ | ------------------------------------------------------------ |
| `zhyc9de/jet-git`            | `git-brains`          | 0.0.4  | 原始项目，Git Log/分支图为主，无提交面板                     |
| `aotemj/jetbrains-git-graph` | `idea-like-git-graph` | 0.4.17 | Fork，新增 IDEA 风格 Commit 面板、Shelf/Stash、分支/日志菜单 |

Fork 的代码规模约 **79 个 TS/TSX 文件、2.1 万行**（含 Webview），14 个命令，2 个 Webview 视图：`git-brains.gitLog`、`git-brains.commitPanel`。

### 3.2 现有架构

```
extension.ts
 ├─ MessageRouter（Webview ↔ Host 的字符串命令路由）
 ├─ GitService × N（每个 workspace folder 一个，但多数 handler 只用第一个）
 ├─ GitWatcher（.git 下文件监听，300ms debounce，统一 cache.invalidate）
 ├─ GitContentProvider（git 内容虚拟文档）
 ├─ DiffEditorManager / MergeEditorManager / ConflictsManager
 └─ Webview（React + Zustand）
      ├─ git log / 分支图
      ├─ commit panel（变更树、消息、提交）
      ├─ push panel / rollback panel
      └─ shared bridge（10s 请求超时）
```

优点：

- UI 已经比较接近 IDEA（分组、勾选、提交消息、Shelf 入口）；
- 已有虚拟文档和 diff 管理器，说明 VS Code 侧的技术路线可行；
- 有 watcher、缓存、多仓库的初步意识。

缺点：这些“意识”没有形成一致性约束，下面的缺陷会互相放大。

### 3.3 具体缺陷与证据

#### D1. Git 进程没有生命周期治理

`src/git/gitService.ts:52-66`：

- 使用 `execFileAsync`，一次性收集 stdout；
- 没有 `timeout`；
- 没有 `AbortSignal`；
- 没有 stdin 处理（某些 credential helper / hook 会等待输入）；
- 没有进程树 kill；
- 只有 `maxBuffer`，大输出会直接失败；
- 环境只设了 `GIT_TERMINAL_PROMPT=0`，无法覆盖 SSH passphrase、GPG pinentry、自定义 credential helper。

后果：任何一次 `git commit`、`git push`、`git fetch` 遇到钩子/认证/网络等待，扩展就永久悬挂，且无法取消。

#### D2. Webview 10 秒硬超时与后台操作脱节

`webview/src/shared/bridge/vscode-bridge.ts:47-50`：

- 每个请求 10 秒后 `reject`；
- 但 Host 侧没有取消机制，Git 进程继续运行；
- UI 收到超时后把 `loading` 置回 false，用户可以再次点击；
- 第二次点击会启动第二个 `git commit`，与第一个竞争 index 锁。

这不是“提交慢”，而是**UI 与真实操作失去一致性**。用户看到“失败”，实际可能已经提交成功；或者看到“转圈”，实际请求早已被 reject。

#### D3. 提交没有按仓库串行化

- `messageRouter` 只做命令分发，没有队列/锁（`src/messages/messageRouter.ts:19`）；
- watcher 触发 `status`/刷新（`src/watchers/gitWatcher.ts:119-131`）与提交并行；
- 提交过程中状态刷新可能读到中间态（index 已 add、commit 未完成），把树刷成奇怪状态；
- 用户重复点击可并发进入 `commitChanges`。

#### D4. 多仓库路径不一致

- `getWorkingTreeChanges` 聚合所有 `gitService`（`extension.ts:958-971`）；
- `commitChanges`、`stageAll`、`unstageAll`、diff 等只用 `gitService`（第一个仓库）（`extension.ts:55、995-1026`）；
- 文件路径没有携带 `repoId`，不同仓库的同名相对路径会冲突。

后果：多根工作区下，面板显示了 B 仓库的文件，提交却发生在 A 仓库；diff 也可能打开错仓库的内容。

#### D5. “只提交选中文件”语义错误

`extension.ts:995-1009`：

1. 把选中且未暂存的文件 `git add`；
2. 调用 `gitService.commit(message)`；
3. `commit()` 执行 `git commit -m <message>`，提交 **index 中所有内容**。

如果 index 里原本就有其他已暂存文件，它们会被一起提交。用户以为只提交勾选项，实际提交了更多内容——这是数据正确性问题，不只是体验问题。

#### D6. 首次加载无默认选择 + 按钮禁用

- `commit-store.ts:121-123`：首次加载 `selectedFiles = new Set()`；
- `CommitMessageArea.tsx:26-28`：`canCommit = message && selectedFiles.size > 0 && !loading`。

结果：打开面板，所有复选框为空，Commit 按钮灰色。用户输入消息也没用，必须手动勾选。对不熟悉 IDEA 的用户，这非常像“坏了”。

IDEA 的默认行为是：变更默认全部 included（或按设置），用户取消勾选才排除；至少不会让主按钮无解释地禁用。

#### D7. 状态解析不可靠

`gitService.ts:923-989`：

- `git status --porcelain=v1 -uall`，按 `\n` 切分；
- 文件名含空格、引号、`\n`、Unicode 时，Git 会加引号/转义，简单 `substring(3)` 会解析错；
- 重命名用 `->` 判断，遇到文件名本身含 `->` 会误判；
- 没有 `-z`，无法安全处理特殊字符；
- 每次全量解析，大仓库慢。

#### D8. Amend 后自动强推

`gitService.ts:1015-1022` 调用 `push(branch, force = amend)`；`684` 使用 `--force-with-lease`。

后果：用户只想“修改提交信息”，却可能改写远端历史。IDEA 的 Commit & Push 不会因为 amend 就自动强推；是否强推必须是显式、二次确认的动作。

#### D9. 失败呈现与恢复不足

- 直接透传 Git stderr，用户看到大段英文；
- 没有区分 hooks 失败、GPG 失败、认证失败、index.lock、身份未配置；
- 没有“在终端重试”“配置身份”“跳过钩子”等恢复动作；
- 提交部分成功（多仓库）时没有结构化结果。

#### D10. 刷新风暴与缓存粗粒度

`gitWatcher.ts:119-131`：任意 `.git` 变化 → 300ms 后 `cache.invalidate()` 全量失效。提交时 index/HEAD/refs 连续变化，会触发多轮全量刷新；叠加 Webview 重渲染，形成卡顿。

### 3.4 “提交卡死”的根因树

```
用户点击 Commit
├─ UI 层
│  ├─ 未勾选文件 → 按钮禁用（被感知为“没反应”）           [D6]
│  ├─ 10s 请求超时 → UI 报错/停止 loading                 [D2]
│  └─ 重复点击 → 并发 commit                              [D3]
├─ Host 层
│  ├─ execFile 无 timeout/abort → 永久等待                 [D1]
│  ├─ commit 提交了整个 index → 与预期不符                 [D5]
│  ├─ 多仓库用错 service → 提交到错误仓库                  [D4]
│  └─ watcher 全量刷新 → 状态闪回/卡顿                     [D10]
└─ Git/系统层
   ├─ pre-commit / commit-msg 钩子等待输入或跑很久
   ├─ GPG pinentry 无法在无 TTY 环境弹窗
   ├─ SSH passphrase / HTTPS credential helper 等待
   ├─ 网络不可达，push 一直重试/等待
   └─ index.lock 被上一个残留进程占用
```

其中 **D1 + D2 是“卡死”的主因**：UI 已经放弃等待，后台进程还活着；用户再点，进程叠加；最终 index.lock 冲突，看起来彻底坏了。

### 3.5 为什么不在 GitJet 上修

| 如果继续 fork            | 代价                                                            |
| ------------------------ | --------------------------------------------------------------- |
| 给 `execGit` 加超时/取消 | 需要重写所有调用点的错误处理与 UI 状态                          |
| 修多仓库                 | 需要给协议、缓存、diff、watcher 全部加 `repoId`，等于重写数据层 |
| 修“只提交选中”           | 需要引入真正的包含模型/index 快照，触及提交流程核心             |
| 修 10s 超时              | 需要重做请求生命周期、进度、取消、幂等                          |
| 修 watcher 风暴          | 需要重建缓存与失效粒度                                          |
| 保留现有 UI              | UI 本身也需大改（默认选择、批量、分支、结果面板）               |

结论：**核心链路全部要重写，UI 也留不下多少**。fork 的主要价值是参考交互与踩坑记录，而不是代码基座。

---

## 4. 1:1 功能矩阵与优先级

优先级定义：P0 = 首版必须；P1 = 1:1 体验必需；P2 = 完整对齐/增强。

### 4.1 提交面板

| 功能               | IDEA 行为                      | 优先级 | 说明                                              |
| ------------------ | ------------------------------ | ------ | ------------------------------------------------- |
| 面板入口           | Git 工具窗 Commit 标签         | P0     | VS Code：独立 Webview View，放 SCM 容器或自建视图 |
| 仓库分组           | 多仓库按 root 分组             | P0     | 单仓库时隐藏组头                                  |
| 当前分支胶囊       | 顶部显示，可切换               | P0     | 显示 detached 短 hash、ahead/behind               |
| 变更树             | 目录/模块分组，状态颜色/图标   | P0     | 虚拟列表，支持 5 万文件                           |
| 分组               | Changes / Unversioned / Staged | P0     | 冲突单独标记                                      |
| 复选框包含         | 三态目录勾选                   | P0     | 默认全选（可配置）                                |
| 全选/反选          | 工具栏                         | P0     | 支持按分组                                        |
| 刷新               | 手动 + 自动                    | P0     | 自动去抖，提交中暂停                              |
| 消息编辑器         | 多行、历史、模板               | P0     | 历史用 `git log` 或本地存储                       |
| 提交按钮           | 分裂按钮 + 下拉                | P0     | 主按钮 Commit，下拉 Commit and Push               |
| Ctrl/Cmd+Enter     | 触发默认提交                   | P0     | 编辑器内也生效                                    |
| 提交中状态         | 进度、禁用、可取消             | P0     | 必须有取消                                        |
| 结果通知           | 成功/失败/部分成功             | P0     | 可点击查看 commit                                 |
| Amend              | 复选/选项                      | P1     | 已推送时警告                                      |
| Sign-off           | 选项                           | P1     | `--signoff`                                       |
| Skip hooks         | 选项 + 二次确认                | P1     | `--no-verify`                                     |
| Cleanup            | 选项                           | P1     | `--cleanup=strip`                                 |
| 作者/日期          | 覆盖                           | P1     | 仅本次提交                                        |
| 提交检查           | TODO/测试/自定义               | P2     | 可配置命令                                        |
| 格式化/优化 import | 提交前动作                     | P2     | VS Code 用 format/save 替代                       |
| 消息模板           | `commit.template`              | P1     | 读取 git config                                   |
| 提交后清空消息     | 可配置                         | P0     | 默认清空                                          |
| 撤销提交           | soft reset 上一提交            | P2     | 仅未推送，二次确认                                |

### 4.2 暂存与部分提交

| 功能                | IDEA 行为            | 优先级 |
| ------------------- | -------------------- | ------ |
| 文件级暂存/取消暂存 | index 操作           | P0     |
| 全部暂存/取消       | 工具栏               | P0     |
| Hunk 级暂存         | 暂存区模式支持       | P1     |
| 行级暂存            | 支持                 | P2     |
| 未跟踪文件包含      | 勾选即 add           | P0     |
| 删除文件暂存        | `git add -A -- path` | P0     |
| 重命名识别          | R 状态               | P0     |
| 冲突文件            | 禁止提交，提示解决   | P0     |
| 部分提交后刷新      | index 与树一致       | P0     |
| Changelist          | 多变更列表           | P2     |

### 4.3 Diff / 代码对比

| 功能            | IDEA 行为           | 优先级 |
| --------------- | ------------------- | ------ |
| 工作区 vs HEAD  | 双击文件            | P0     |
| 已暂存 vs HEAD  | Staged 节点         | P0     |
| 工作区 vs index | 未暂存节点          | P0     |
| 多文件 Diff     | 选中多个            | P1     |
| 提交前预览      | Preview Diff        | P1     |
| 分支对比        | 两/三点 diff        | P1     |
| 提交对比        | 历史中选两个 commit | P1     |
| 二进制/大文件   | 提示不渲染          | P0     |
| 空白忽略        | 选项                | P2     |
| 内联预览        | 面板内嵌            | P2     |

### 4.4 分支与历史

| 功能               | IDEA 行为            | 优先级 |
| ------------------ | -------------------- | ------ |
| 当前分支显示       | 胶囊/状态栏          | P0     |
| ahead/behind       | 数字/箭头            | P0     |
| 分支列表           | Local/Remote/Tags    | P1     |
| 切换分支           | checkout             | P1     |
| 新建分支           | 从当前/指定 commit   | P1     |
| 合并/变基          | 右键                 | P2     |
| 重命名/删除        | 右键                 | P1     |
| Push/Pull          | 右键/工具栏          | P1     |
| 分支对比           | Compare with Current | P1     |
| 提交日志           | 分页、筛选           | P1     |
| 提交图（lanes）    | Graph                | P2     |
| Cherry-pick/Revert | 右键                 | P2     |
| 交互式 rebase      | 完整 UI              | P2     |

### 4.5 Shelf / Stash / 冲突

| 功能                      | IDEA 行为  | 优先级                          |
| ------------------------- | ---------- | ------------------------------- |
| Stash 保存/应用/弹出/删除 | Git stash  | P1                              |
| Stash 查看 Diff           | 是         | P1                              |
| Shelf 命名保存            | IDEA Shelf | P2                              |
| Shelf 部分恢复            | 是         | P2                              |
| Shelf 跨分支              | 是         | P2                              |
| 冲突列表                  | 是         | P0                              |
| 三栏合并                  | IDEA Merge | P1（复用 VS Code Merge Editor） |
| 标记已解决                | 是         | P1                              |
| 中止 merge/rebase         | 是         | P1                              |

### 4.6 系统与工程质量

| 功能                                          | 优先级 |
| --------------------------------------------- | ------ |
| 多根/嵌套/worktree/submodule 发现（内置承担） | P0     |
| 操作状态机/幂等（内置写锁 + 自建 UI 层）      | P0     |
| 取消后续仓库（进行中操作不可中断，如实限制）  | P0     |
| 认证/GPG/钩子错误分类（GitErrorCodes → 动作） | P0     |
| 大仓库性能目标（内置上限保护 + UI 层）        | P0     |
| 结构化日志/诊断包                             | P1     |
| i18n（中/英）                                 | P2     |
| 可访问性（键盘/读屏）                         | P1     |
| 设置项与迁移                                  | P1     |
| 遥测（可选、默认关）                          | P2     |

---

## 5. 产品与交互设计

### 5.1 面板布局

```
┌──────────────────────────────────────────────────────────────┐
│ [仓库 A ▾]  [main ↑2 ↓0]   [刷新] [全部暂存] [全部取消暂存]   │  ← 仓库/分支头
├──────────────────────────────────────────────────────────────┤
│ 提交消息                                                      │
│ ┌──────────────────────────────────────────────────────────┐ │
│ │ feat: 支持批量提交                                        │ │
│ │                                                          │ │
│ └──────────────────────────────────────────────────────────┘ │
│ [历史 ▾] [模板]                        12 个文件 · +340 −21  │
├──────────────────────────────────────────────────────────────┤
│ ▾ 变更 (8)                                      [全选]       │
│   ▾ src/                                                     │
│     M  commitService.ts        [✓]  [Diff]                   │
│     M  gitExecutor.ts          [✓]  [Diff]                   │
│   ▾ test/                                                    │
│     A  commitService.test.ts   [✓]  [Diff]                   │
│ ▾ 已暂存 (3)                                    [全选]       │
│     M  README.md               [✓]  [Diff]                   │
│ ▾ 未跟踪 (1)                                    [全选]       │
│     ?  notes.md                [ ]  [Diff]                   │
├──────────────────────────────────────────────────────────────┤
│ [ Commit ▾ ]  Ctrl+Enter              [取消] [进度/结果区域]  │
└──────────────────────────────────────────────────────────────┘
```

多仓库时，顶层出现多个同样的仓库块；单仓库时省略仓库头，只留分支行。

### 5.2 交互规则

#### 选择与包含

- 首次加载：默认全选所有 tracked 变更；未跟踪文件**默认不选**（避免误提交密钥/临时文件），可在设置中改为全选。
- 目录三态：全选/半选/不选；半选状态提交时只包含被勾选的子项。
- 已暂存文件：默认勾选；**勾选状态 = 暂存状态（checkbox = staged）**，与 IDEA 暂存区模式对齐。取消勾选 = `restore({ staged: true })`（unstage）；若该文件同时有未暂存变更，提示"取消勾选将同时取消该文件的暂存内容"（与 IDEA 暂存区行为一致）。
- 提交中：锁定包含集与消息，禁止重复提交；可"取消后续仓库"（进行中操作不可中断，见 6.10）。
- 提交成功：清空消息（可配置）、清空本次包含集、保留其他仓库的未提交选择。
- 提交失败：保留消息与选择，展示可操作错误。

#### 按钮与快捷键

- 主按钮：Commit；下拉：Commit and Push、Amend、Commit with Options。
- `Ctrl+Enter`（Windows/Linux）/ `Cmd+Enter`（macOS）：触发默认 executor。
- 按钮禁用条件：无消息、无包含文件、提交中、有未解决冲突。**禁用时必须显示原因**（tooltip 或按钮下方提示），不能像 GitJet 那样无解释变灰。
- 提交中按钮变为“提交中…”，旁边有“取消”。

#### 批量提交

- 单仓库多文件：`commit({ all: false })`，提交整个 index——勾选与 index 强一致，不存在"未勾选却被提交"的情况。
- 多仓库：按仓库分组，顺序提交；默认“任一仓库失败则停止后续仓库”，设置可改为“继续”。
- 每个仓库独立结果：成功（commit hash）、失败（错误码 + 摘要）、跳过（原因）。
- Commit & Push：只有所有 commit 成功才进入 push；push 逐仓库执行；部分 push 失败时明确“本地已提交，远端未推送”。

#### Diff 入口

- 单击/双击文件：打开工作区 vs HEAD（未暂存则 index vs 工作区）。
- 右键：Show Diff、Show Staged Diff、Open File、Rollback、Stage/Unstage、Copy Path。
- 多选：打开多文件 diff（P1）。
- Diff 标题：`path (HEAD ↔ Index)` / `path (Index ↔ Working Tree)`，避免用户不知道在看哪两侧。

#### 分支显示与切换

- 仓库头显示：`分支名 ↑ahead ↓behind`；detached 显示 `HEAD@abc1234`；无 upstream 时只显示分支名。
- 点击分支名：QuickPick，支持搜索、最近分支、Local/Remote 分组、当前项置顶。
- 切换前检查：工作区脏时提示“切换会携带本地修改/可能失败”，提供 Stash & Switch（P1）。
- 分支变化由内置 `.git` watcher 触发 `state.onDidChange` 刷新，不轮询。

### 5.3 状态机

```
Idle
 ├─ 用户修改选择/消息 → Dirty（仅 UI）
 ├─ 点击 Commit → Validating
 │    ├─ 无消息/无文件/冲突 → Idle + 原因
 │    └─ 通过 → Running(commit)
 │         ├─ 成功 → Refreshing → Idle + 成功结果
 │         ├─ 失败 → Idle + 失败结果（保留输入）
 │         └─ 取消 → Cancelling → Idle + 已取消
 └─ 点击 Commit and Push → Running(commit) → Running(push) → ...
```

要求：

- 每个仓库同一时刻最多一个写操作（由内置 OperationManager 保证）；
- 不同仓库可并行提交；读操作可并行；
- **取消语义（如实限制）**：API 无法中断进行中的 commit/push；只提供"取消后续仓库"，不承诺中断当前仓库；任何状态都必须能回到 Idle，不允许永久 spinner。

### 5.4 错误呈现

错误分三层（依据已拍板的"错误码 + 恢复动作 + 终端重试"策略）：

1. **一句话摘要**：由 `GitError.gitErrorCode` 映射，例如"pre-commit 钩子失败""身份未配置""无法连接远端"。
2. **可展开详情**：错误码、命令名（脱敏）、耗时；stderr 原文 API 不透出，提供**"查看 Git 输出"**按钮（`git.showOutput`，stderr 在内置日志通道可见）。
3. **恢复动作**：
   - 钩子失败：`跳过钩子并重试`（`noVerify: true`，二次确认）、`查看 Git 输出`；
   - 身份缺失（`NoUserNameConfigured`）：`打开 Git 设置`、`在终端配置`；
   - GPG/其他（`GenericError`）：`查看 Git 输出`、`在终端重试`；
   - 认证（`AuthenticationFailed`）：`在终端重试`、`查看 Git 输出`（内置 askpass 已覆盖多数场景）；
   - 锁（`RepositoryIsLocked`）：`重试`（内置已自动退避 10 次，此处为手动重试）；
   - 冲突（`UnmergedChanges/Conflict`）：`打开合并编辑器`；
   - **所有错误的兜底动作都是"在终端重试"**：`TerminalBridge.sendText` 写入脱敏后的等价命令，不自动回车。

### 5.5 设置项（建议）

| 设置                                          | 默认  | 说明                                   |
| --------------------------------------------- | ----- | -------------------------------------- |
| `gitBatchCommit.commit.defaultSelectAll`      | true  | 首次加载全选 tracked                   |
| `gitBatchCommit.commit.selectUntracked`       | false | 是否默认包含未跟踪                     |
| `gitBatchCommit.commit.clearMessageOnSuccess` | true  | 成功后清空消息                         |
| `gitBatchCommit.commit.confirmAmendPushed`    | true  | amend 已推送提交时确认                 |
| `gitBatchCommit.commit.autoRefresh`           | true  | 自动刷新                               |
| `gitBatchCommit.commit.refreshDebounceMs`     | 250   | 去抖                                   |
| `gitBatchCommit.commit.stopOnFirstRepoError`  | true  | 多仓库失败策略                         |
| （Git 路径）                                  | —     | 由内置扩展 `git.path` 设置管理，不自设 |
| `gitBatchCommit.log.pageSize`                 | 300   | 日志分页                               |
| `gitBatchCommit.diff.largeFileThresholdKB`    | 2048  | 大文件阈值                             |
| `gitBatchCommit.telemetry.enabled`            | false | 遥测                                   |

### 5.6 产品命名与文案（已定）

| 项目             | 内容                                                                          |
| ---------------- | ----------------------------------------------------------------------------- |
| 产品名           | **Git Batch Commit**                                                          |
| 中文名           | **Git 批量提交**                                                              |
| Marketplace 标题 | `Git Batch Commit — IDEA-style Commit Panel`                                  |
| Extension ID     | `<publisher>.git-batch-commit`                                                |
| 命令/设置前缀    | `gitBatchCommit.*`                                                            |
| 英文 Tagline     | Commit like IDEA. Batch select, review, and commit — without leaving VS Code. |
| 中文 Tagline     | 像 IDEA 一样提交：批量选择、代码对比、暂存与分支，一次完成。                  |

命名原则：

- 主名包含 `Git` + `Batch` + `Commit` 三个核心搜索词；
- `IDEA-style` 只放在副标题，避免把 JetBrains 商标作为主品牌；
- `IntelliJ` / `JetBrains` 只出现在描述与 keywords，用于承接迁移人群的搜索；
- 不使用 `GitLens`、`Git Graph`、`GitKraken` 等已被占用的命名范式。

**Marketplace 描述（英文）**

> Batch-select files, review diffs, stage changes and commit across multiple repositories in an IntelliJ IDEA-style panel for VS Code.

**Marketplace 描述（中文）**

> 像 IntelliJ IDEA 一样批量提交：多仓库分组、暂存区管理、代码对比、分支显示与切换，一次完成。

**Keywords**

> git, git commit, batch commit, commit, commit panel, intellij, intellij idea, idea, jetbrains, staging area, git diff, branch, scm, multi repo

**命令命名**

- `gitBatchCommit.commit`
- `gitBatchCommit.commitAndPush`
- `gitBatchCommit.stage`
- `gitBatchCommit.unstage`
- `gitBatchCommit.refresh`
- `gitBatchCommit.openDiff`

**视图命名**

- `gitBatchCommit.commitPanel`
- `gitBatchCommit.branchView`

---

## 6. 技术架构（路线 A：复用内置 Git 扩展 API）

> 依据《VSCode-Git-架构对比分析》：内置 Git 扩展（`vscode.git`）对外导出完整 API（`getAPI(1)`），进程治理、认证、锁重试、watcher、大仓库防护均已内置。因此 P0 不自建内核，自建层收敛为：**包含模型映射、多仓库编排、IDEA 式 UI、错误动作映射、终端兜底**。

### 6.1 总体架构

```
┌──────────────────────────── VS Code Webview ────────────────────────────┐
│ React + Zustand                                                        │
│  CommitPanel · RepoSection · ChangesTree · CommitBox · BranchPicker    │
│  ProgressPanel · ResultPanel · HistoryPicker · DiffLauncher            │
│  Typed RPC Client（request / response / event / cancel）               │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │ postMessage（结构化、可取消）
┌──────────────────────────────────┴─────────────────────────────────────┐
│ Extension Host                                                          │
│                                                                        │
│  MessageGateway ── BatchOrchestrator（多仓库顺序提交/失败策略/结果聚合）│
│       │                     │                                          │
│       ├── GitApiAdapter ─── vscode.git getAPI(1)                       │
│       │     ├── repos = api.repositories（发现/事件全部免费）          │
│       │     ├── state 映射（4 组 changes / HEAD / ahead-behind）        │
│       │     └── 写操作（add/restore/commit/push/checkout/stash…）       │
│       ├── InclusionModel ─── 勾选集 ⇄ index 映射（核心自建逻辑）        │
│       ├── OperationTracker ─ 操作状态机/进度/幂等（UI 层）             │
│       ├── DiffService ─────── api.toGitUri + vscode.diff + buffer/show │
│       ├── HistoryService ─── repository.log(LogOptions) 分页           │
│       ├── StashService ───── createStash/apply/pop/drop（列表见 6.6）   │
│       ├── ErrorMapper ────── GitErrorCodes → 动作 + 终端兜底           │
│       └── MiniRunner(P1) ─── 3 个小命令：stash list / hash-object /    │
│                              update-index（仅行级暂存与 stash 列表用） │
│                                                                        │
│  Cache（分支/日志页/最近消息） · Diagnostics · EventBridge → Webview   │
└────────────────────────────────────────────────────────────────────────┘
                                   │
                内置 Git 扩展（vscode.git）→ 系统 Git CLI
      （进程治理 / 认证 / 锁重试 / watcher / 大仓库防护 全由其承担）
```

**职责分工表**：

| 职责                                             | 归属         | 说明                 |
| ------------------------------------------------ | ------------ | -------------------- |
| Git 进程治理（spawn/env/stdin/取消）             | 内置         | 免费                 |
| 认证（askpass / 凭据 / 终端注入）                | 内置         | 免费                 |
| index.lock 重试（二次退避 10 次）                | 内置         | 免费                 |
| 状态解析（`status -z` + 上限 kill + 大仓库警告） | 内置         | 免费                 |
| `.git`/工作区 watcher → status                   | 内置         | 免费                 |
| 仓库发现（多根/嵌套/worktree/submodule/Trust）   | 内置         | 免费                 |
| **包含模型（勾选 ⇄ index）**                     | **自建**     | 核心自建逻辑，见 6.2 |
| **多仓库批量编排/失败聚合**                      | **自建**     | 见 6.2               |
| **IDEA 式 UI（面板/树/复选框/分支胶囊）**        | **自建**     | Webview              |
| 错误码 → 动作映射 + 终端兜底                     | 自建（薄层） | 见 6.2、8.1          |
| Shelf / Changelist                               | 自建         | P1/P2                |
| 行级/Hunk 级暂存                                 | 自建         | P1，需 MiniRunner    |

### 6.2 Extension Host 模块职责（路线 A）

#### `GitApiAdapter`

- 激活：`vscode.extensions.getExtension('vscode.git')?.activate()` → `getAPI(1)`；处理扩展被禁用/未安装、`api.onDidChangeState`、等待 `state === 'initialized'`；
- 仓库枚举：`api.repositories` + `onDidOpenRepository / onDidCloseRepository`（发现免费，但需维护 `repoId` 映射）；
- `repoId`：以 `repository.rootUri` 规范化路径哈希生成，区分 worktree/submodule（`repository.kind`）；
- 状态快照映射：
  - `state.HEAD` → 分支名/detached 短 hash/upstream/ahead/behind；
  - `state.indexChanges / workingTreeChanges / untrackedChanges / mergeChanges` → 我们的四组 `FileChange`（`uri/originalUri/renameUri/status` 已含全部所需信息）；
  - `state.remotes/refs/submodules/worktrees` → 分支与远端面板数据；
- 事件桥：`state.onDidChange` → 去抖/合并 → 推送 `status.changed`（带 `seq`）给 Webview；
- 写操作映射：

| 面板操作                     | API 调用                                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- |
| 勾选（stage，含未跟踪/删除） | `repository.add([path])`                                                                                  |
| 取消勾选（unstage）          | `repository.restore([path], { staged: true })`                                                            |
| 提交                         | `repository.commit(message, opts)`（opts：all/amend/signoff/signCommit/noVerify/empty/postCommitCommand） |
| Commit All（含未暂存）       | `commit({ all: true })`；仅 tracked 用 `all: 'tracked'`                                                   |
| Commit & Push                | commit 成功后 `repository.push(remote, branch, setUpstream, force)`                                       |
| 推送（默认不强推）           | `repository.push(remote, branch, setUpstream, undefined)`；`ForcePushMode` 仅显式                         |
| 分支                         | `getBranches/checkout/createBranch/deleteBranch/setBranchUpstream`                                        |
| Stash                        | `createStash/applyStash/popStash/dropStash`                                                               |
| 日志                         | `log({ maxEntries, skip, range, author, grep, shortStats })`                                              |
| Blob                         | `buffer(ref, path)` / `show(ref, path)`                                                                   |

- 错误规整：捕获 `GitError`（`gitErrorCode`）→ 映射为我们的错误枚举 + 恢复动作（见 §8.1）。

#### `InclusionModel`（核心自建逻辑）

**语义定死：勾选状态 = 暂存状态（checkbox = staged）**，与 IDEA 暂存区模式对齐：

- 勾选未暂存/未跟踪/已删除文件 → `add([path])`（`-A` 语义，含删除与重命名）；
- 取消勾选已暂存文件 → `restore([path], { staged: true })`（unstage）。若该文件同时有未暂存变更，提示"取消勾选将同时取消该文件的暂存内容"（与 IDEA 暂存区行为一致）；
- 提交 = `commit({ all: false })`，即**只提交 index 内容**——不存在"index 里有未勾选文件被悄悄提交"的情况，因为勾选与 index 已强一致；
- "Commit All" = `commit({ all: true })`（内置负责 `add -u`），含未跟踪需先对未跟踪项显式 `add`；仅 tracked 用 `all: 'tracked'`；
- 未跟踪文件默认不勾选（防误提交密钥/临时文件），可配置默认全选；
- 乐观更新：点击勾选 → 本地立即翻转 → `add/restore` 完成后以 `state.onDidChange` 回灌的真实状态校准（防止 API 调用失败后 UI 与 index 不一致）；
- 提交成功后：清空包含集与消息（可配置）、保留其他仓库的勾选。

#### `BatchOrchestrator`（多仓库编排）

- 输入 `commit.run{ repoIds[] }`，逐仓库顺序调用 `repository.commit(...)`；
- 失败策略：默认"任一仓库失败即停止后续"，可配置"继续"；
- 结果聚合 `CommitResult[]`：成功（oid/分支）/ 失败（错误码+动作）/ 跳过（原因）；
- Push 阶段：仅当所有 commit 成功才逐仓库 push；部分失败时明确"本地已提交、远端未推送"；
- 幂等：每个仓库 commit 进行中禁用该仓库提交按钮；
- **取消语义（如实限制）**：API 未暴露进行中操作的 CancellationToken，无法中断已开始的 commit/push；提供"取消后续仓库"，不承诺"中断当前仓库"。整体可接受：内置扩展内部串行 + 我们的前置校验使挂起概率大幅低于 GitJet；
- 并发：内置扩展已对每仓库操作串行（其 OperationManager），我们不再自建进程级锁。

#### `OperationTracker`

- 维护各仓库操作状态机（idle → running → done/failed），驱动 UI 进度与按钮禁用；
- 进度包装：提交/推送用 `window.withProgress({ location: <我们的视图> })`；
- `state.onDidChange` 兜底校准（内置操作完成后状态必然刷新）。

#### `DiffService`

- 首选内置 git URI：`api.toGitUri(uri, ref)` + `vscode.diff(leftUri, rightUri, title)`；
  - `ref=''` 工作区、`ref='~'` index、`ref='HEAD'` HEAD 版本（内置约定）；
- blob 读取：`repository.buffer(ref, path)` / `show(ref, path)`；
- 重命名/删除：`Change.originalUri/renameUri` 直接可用；缺失一侧用空文档 + 标题标注；
- 多文件 diff：Multi-diff Editor（P1）；
- 二进制/大文件：用 `buffer` 前 8KB 探测 + 大小阈值，超限显示元数据 + "仍要打开"。

#### `HistoryService`

- 分页：`log({ maxEntries: 300, skip })`；
- 过滤：`author` / `grep` / `range`（API 原生支持）；
- 提交详情与文件变更：`diffBetween(ref1, ref2, path)`；
- 提交图泳道：P2 自建（API 只给线性列表）。

#### `StashService`

- API：`createStash({ message, includeUntracked, staged })` / `applyStash / popStash / dropStash`；
- **缺口**：API 无 stash 列表查询；P1 需要"stash 列表"UI 时用 MiniRunner 跑 `git stash list`（见 6.6）；
- Shelf（P2）：自建 patch 存储。

#### `ErrorMapper` + `TerminalBridge`

- 错误输入：`GitError.gitErrorCode`（48 个内置码）；
- 输出：我们的错误枚举 + 恢复动作按钮，其中**所有错误的兜底动作都是"在终端重试"**（用户拍板结论）；
- "在终端重试"：向当前/新建终端 `sendText` 等价 git 命令文本（脱敏、不自动回车），用户确认后执行；
- stderr 详情：API 不透出 stderr；提供"查看 Git 输出"按钮（执行内置命令 `git.showOutput` 打开其日志通道，stderr 在其中可见）；
- GPG/pinentry：无专门错误码 → 归入 `GenericError`（动作：查看输出 + 终端重试）；P2 增强为提交前预检（`getConfig('commit.gpgsign')` + 环境检测）。

#### `MiniRunner`（P1，范围收敛）

路线 A 中唯一允许的自建进程调用，仅 3 个低风险命令，不承载提交语义：

- `git stash list`（stash 列表 UI）；
- `git hash-object --stdin -w --path` + `git update-index --cacheinfo`（行级暂存，复刻内置实现）；
- 复用内置的 spawn 惯例：参数数组、`LC_ALL/GIT_PAGER=cat`、stdin 显式关闭、无超时但可取消、输出上限。

#### `EventBridge` 与缓存

- Webview 事件：`status.changed`（按仓库、带 `seq`）、`operation.started/finished`、`repo.opened/closed`、`diagnostics.changed`；
- 缓存收敛为：分支列表（短 TTL）、日志页（按查询键）、最近提交消息（本地存储）；
- 不再需要自建 watcher / 状态代际 / 进程池（v0.1 方案删除）。

### 6.3 Webview 模块

| 模块            | 职责                                               |
| --------------- | -------------------------------------------------- |
| `CommitPanel`   | 布局、仓库分组、键盘快捷键                         |
| `RepoSection`   | 单仓库头、分支胶囊、状态汇总                       |
| `ChangesTree`   | 虚拟化树、三态勾选、状态图标、右键菜单、拖拽（P2） |
| `CommitBox`     | 消息编辑、历史、模板、字符统计、校验               |
| `CommitButton`  | 分裂按钮、下拉执行器、加载中、"取消后续仓库"       |
| `BranchPicker`  | 搜索、分组、最近、操作                             |
| `ProgressPanel` | 阶段、当前仓库、耗时、"取消后续仓库"               |
| `ResultPanel`   | 成功/失败/部分成功、详情、重试                     |
| `DiffLauncher`  | 构造 diff 请求、标题、错误提示                     |
| `store`         | 归一化状态、选择集、派生选择器、乐观更新（谨慎）   |

原则：

- Webview 不直接解析 Git 输出；
- 写操作先乐观更新 UI，再以 Host 经 `state.onDidChange` 回灌的真实状态校准（API 调用失败可回退）；
- 选择集以 `repoId + path + staged` 为键，避免同名冲突；
- 列表虚拟化，避免 5 万节点全量渲染；
- 任何请求都有 `operationId`，可取消、可关联进度。

### 6.4 通信协议

信封设计（示意，不是最终代码）：

```json
// 请求
{ "v": 1, "id": "uuid", "method": "commit.run", "repoId": "r1", "params": { }, "timeoutMs": 0 }

// 成功
{ "v": 1, "id": "uuid", "ok": true, "result": { } }

// 失败
{ "v": 1, "id": "uuid", "ok": false, "error": { "code": "HOOK_FAILED", "message": "...", "detail": "...", "recoverable": true } }

// 事件
{ "v": 1, "event": "operation.progress", "repoId": "r1", "seq": 12, "payload": { "operationId": "op1", "phase": "commit", "percent": 40 } }

// 取消（仅取消后续仓库；进行中操作不可中断，见 6.10）
{ "v": 1, "id": "uuid2", "method": "batch.cancelRemaining", "params": { } }
```

关键规则：

- **不设统一超时**：内置 API 不提供进行中操作的中断，也不需要自建超时（askpass 已消灭"等输入"场景）；UI 展示进度即可；
- 每个请求必须最终到达（成功/失败），不允许静默丢弃；
- 事件带 `seq`，Webview 可检测丢帧并请求全量刷新；
- 大 payload 分页/按需，禁止一次推送全仓库文件内容；
- 错误码枚举化，UI 可映射到恢复动作；
- 协议版本号用于未来兼容。

建议方法清单：

| 域     | 方法                                                                                      |
| ------ | ----------------------------------------------------------------------------------------- |
| repo   | `repo.list`、`repo.refresh`、`repo.openInTerminal`                                        |
| status | `status.get`、`status.subscribe`（事件）                                                  |
| index  | `index.stage`、`index.unstage`、`index.stageAll`、`index.unstageAll`                      |
| commit | `commit.run`、`commit.amend`、`commit.validate`                                           |
| push   | `push.run`                                                                                |
| batch  | `batch.cancelRemaining`（取消后续仓库）                                                   |
| branch | `branch.list`、`branch.checkout`、`branch.create`、`branch.delete`、`branch.compare`      |
| log    | `log.page`、`commit.show`、`commit.diff`                                                  |
| diff   | `diff.open`、`diff.openMulti`、`diff.blob`                                                |
| stash  | `stash.list`（P1，经 MiniRunner）、`stash.push`、`stash.apply`、`stash.pop`、`stash.drop` |
| ui     | `ui.openSettings`、`ui.copyDiagnostics`、`ui.showGitOutput`、`ui.retryInTerminal`         |

### 6.5 数据模型（核心）

```
RepoDescriptor
  id, rootPath, gitDir, commonDir, worktreePath?, isSubmodule, isBare, name

FileChange
  repoId, path, origPath?, indexStatus, worktreeStatus,
  kind: modified|added|deleted|renamed|copied|untracked|conflicted|ignored,
  staged: boolean, conflicted: boolean, submodule?: { state, ... }

RepoStatus
  repo, branch: { name?, detached?, oid, upstream?, ahead, behind },
  changes: FileChange[], seq, scannedAt

CommitRequest
  repoId, message, amend, signoff, signCommit?, noVerify, empty?,
  expectedStaged: ChangeKey[]（提交前校验 index 与勾选集一致）, pushAfter: boolean

CommitResult
  repoId, ok, commitOid?, branch?, error?: { code, message, detail, recoverable }, durationMs

OperationState
  id, repoId, type, phase, startedAt, cancellable, progress?, error?
```

### 6.6 Git 命令策略（API 优先 + MiniRunner 白名单）

路线 A 下，**所有提交语义操作都走内置 API，不再自建命令构造**。下表是"面板操作 → API"的最终映射：

| 场景            | 实现                                                        | 备注                                                 |
| --------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| 仓库发现        | `api.repositories` + `onDidOpen/CloseRepository`            | 免费（内置已处理多根/嵌套/worktree/submodule/Trust） |
| 状态            | `repository.state`（4 组 changes + HEAD/ahead/behind）      | 免费（内置 `status -z` + watcher + 上限保护）        |
| 暂存            | `repository.add([paths])`                                   | 含删除/重命名                                        |
| 取消暂存        | `repository.restore([paths], { staged: true })`             | unborn HEAD 场景由内置处理                           |
| 提交            | `repository.commit(message, opts)`                          | 消息经 stdin（内置实现），无转义问题                 |
| 分支            | `getBranches/checkout/createBranch/deleteBranch`            | API 原生                                             |
| ahead/behind    | `state.HEAD.ahead/behind`                                   | 免费（内置维护）                                     |
| 日志            | `repository.log({ maxEntries, skip, range, author, grep })` | API 原生分页                                         |
| 文件 Diff       | `api.toGitUri(uri, ref)` + `vscode.diff`                    | 见 6.7                                               |
| index/HEAD 内容 | `repository.buffer(ref, path)` / `show(ref, path)`          | 免费（blob 读取）                                    |
| 推送            | `repository.push(remote, branch, setUpstream, force?)`      | `ForcePushMode` 仅显式；默认不强推                   |
| Stash           | `createStash/applyStash/popStash/dropStash`                 | 四件套齐全                                           |
| **stash 列表**  | MiniRunner：`git stash list`                                | **API 缺口**，P1                                     |
| **行级暂存**    | MiniRunner：`hash-object` + `update-index`                  | **API 缺口**，P1（复刻内置做法）                     |

**API 缺口清单（P1 决策依据）**：

1. 无 stderr 透出 → 错误细节用"错误码 + 查看输出（`git.showOutput`）+ 终端重试"兜底（§8.1）；
2. 无进行中操作的 CancellationToken → 无法中断已开始的 commit/push，提供"取消后续仓库"；
3. 无 stash 列表查询 → MiniRunner；
4. 无行级/Hunk 级暂存原语 → P1 用 MiniRunner 复刻内置 `hash-object`+`update-index`（不走向 API 传 patch 的方案，规避 autocrlf 上下文错位）；
5. 无 Shelf/Changelist → P1/P2 自建存储层。

### 6.7 Diff 与部分提交

#### Diff 打开方式（路线 A）

- 侧 URI：`api.toGitUri(fileUri, ref)`，`ref` 取 `'~'`（index）、`'HEAD'`（HEAD 版本）；工作区一侧直接用文件 `uri`；
- 打开：`vscode.diff(leftUri, rightUri, title, { preview: false })`；
- 标题约定：`<path> (Working Tree ↔ HEAD)` 等，与内置 SCM 命名一致；
- 内容读取（需要拿到内容做自定义展示时）：`repository.buffer(ref, path)`；
- 重命名：`Change.originalUri / renameUri` 直接可用，标题标注 `old → new`；
- 删除：缺失一侧用空文档 + 标题标注 `(deleted)`；
- 多文件批量 diff：VS Code Multi-diff Editor（P1）；
- 快捷跳转：每行变更提供"Open File / Open Diff"右键动作（复用内置命令 `git.openFile` / 自建 `vscode.diff`）。

#### Hunk 级暂存（P1）

不采用"自建补丁 → `git apply --cached`"方案（CRLF/编码/行号偏移风险高）。**复刻内置扩展的实现**（`staging.ts` + `git.ts:2018-2043`）：

1. 在我们的 Webview 内嵌 diff（或引导用户到 VS Code diff 编辑器）选中行；
2. 基于行差异重组工作区文件内容（只含选中行）；
3. MiniRunner：`git hash-object -w --stdin --path <file>` 写入 blob；
4. 查询 HEAD 侧 mode（MiniRunner：`git ls-tree HEAD -- <path>`，或 `repository` 现有数据推断）；
5. MiniRunner：`git update-index --add --cacheinfo <mode> <oid> <path>`；
6. 以 `state.onDidChange` 校准 index 组。

风险收敛：blob 写入与 update-index 是 git 内部原语，不受 `core.autocrlf` 补丁上下文影响；仍需处理：二进制文件不支持、并发 index 写入（内置 OperationManager 会串行化）、同文件多次选择的中间态。

### 6.8 分支与日志

- 分支列表：`repository.getBranches()`，按仓库缓存（短 TTL），`state.onDidChange` 时失效；
- 当前分支胶囊：`state.HEAD.name` / detached 短 hash；ahead/behind 直接取 `state.HEAD`；
- 切换/新建/删除/重命名：API（rename 无 API 时提供"checkout + create"组合或降级提示，P1 评估）；
- 日志：`log({ maxEntries: 300, skip })` 分页；过滤 `author/grep/range` 原生支持；
- 提交图泳道：P2 自建（API 只给线性列表），Host 计算 lane，Webview 虚拟化渲染；
- 分支对比：`log({ range: 'A..B' })` + `diffBetween`，复用 DiffService；
- fetch 不自动做（避免网络卡顿），提供手动入口。

### 6.9 多仓库语义

- **发现**：`api.repositories` + 打开/关闭事件（内置已处理多根、嵌套、worktree、submodule、Workspace Trust）；
- **归组**：按 `repository.rootUri` 生成的 `repoId` 分组；面板按仓库分组展示，单仓库时隐藏组头；
- **路径**：所有协议消息必须带 `repoId`；文件路径用 `uri`，禁止只用相对路径；
- **提交**：BatchOrchestrator 逐仓库顺序执行；默认失败即停；结果逐仓库展示（成功/失败/跳过）；
- **推送**：所有 commit 成功后执行；逐仓库；默认不强推；部分失败时明确"本地已提交、远端未推送"；
- **分支**：每仓库独立分支；面板头部分别显示；
- **状态刷新**：依赖内置每仓库独立 watcher（免费），我们只做事件合并与 `seq` 排序；
- **Submodule**：作为父仓库的 gitlink 变更展示，不递归提交子模块；提供"打开子模块"入口；
- **Worktree**：每个 worktree 是独立 `repository`（独立 HEAD/index），共享 object store；用 `repository.kind` 标注归属。

### 6.10 并发与操作状态机（不自建进程锁）

内置扩展已保证：**每仓库操作经其 OperationManager 串行**（同一仓库同时只有一个写操作），并自带 `RepositoryIsLocked` 二次退避重试 10 次。因此路线 A 不再自建 Mutex/Semaphore/进程组 kill，我们只做 **UI 层的操作状态机**：

```
OperationTracker
  perRepo: Map<repoId, { phase: idle|running|done|failed, kind, startedAt, error? }>

run(repoId, kind, fn):
  if phase==running && kind is exclusive → reject (幂等)
  set Running → await fn() → Done/Failed
  完成后等待 state.onDidChange 校准（内置操作结束必刷新状态）
```

规则：

- 同仓库 commit 进行中：禁用该仓库提交按钮（幂等）；不同仓库可并行提交（内置每仓库独立锁，无竞争）；
- 提交/推送用 `window.withProgress` 显示进度；
- **取消语义如实限制**：API 无法中断进行中的 commit/push；UI 提供"取消后续仓库"（BatchOrchestrator 层），不承诺中断当前仓库；
- 超时：不自建超时（内置无超时，依赖 askpass 消灭挂起场景）；网络类操作失败由错误码呈现 + 终端重试；
- 所有操作记录开始/结束/耗时/错误码，写入诊断日志（脱敏）。

### 6.11 缓存与事件（watcher 免费，缓存收敛）

内置已承担 watcher（`.git` + 工作区 + upstream ref）与 `git status` 去抖，我们**不再自建任何 watcher**。自建缓存收敛为三类：

| 缓存         | 内容                                             | 失效                            |
| ------------ | ------------------------------------------------ | ------------------------------- |
| 分支列表     | `getBranches()` 结果（按仓库）                   | 短 TTL + `state.onDidChange`    |
| 日志页       | `log()` 结果（按查询键：range/author/grep/skip） | `state.onDidChange` + 手动刷新  |
| 最近提交消息 | 面板输入历史                                     | 本地 `workspaceState`，永不过期 |

事件链路：

- `repository.state.onDidChange` → GitApiAdapter 合并/去抖 → `status.changed{ repoId, seq }` → Webview 增量更新；
- `api.onDidOpenRepository / onDidCloseRepository` → `repo.opened/closed` → 面板增删仓库分组；
- 自身写操作（add/restore/commit）完成后不重复拉状态，等待 `state.onDidChange` 回灌（内置操作结束必刷新）；
- 窗口失焦时降低 Webview 渲染频率（可配置），避免"一个文件变化 → 全量重渲染"。

### 6.12 安全

- 不执行用户输入拼接的 shell（MiniRunner 亦用参数数组）；
- 提交消息经 API 传递（内置以 stdin 送入 git），不落盘临时文件，无权限/残留问题；
- 日志脱敏：URL 中的 token、`https://user:pass@host`、环境变量；
- 诊断包只包含命令名、错误码、耗时、错误消息摘要，不包含文件内容；
- Webview CSP 严格，禁用远程资源；
- "在终端重试"只发送脱敏后的命令文本、不自动回车，且不发送含凭据的命令；
- 对 `--no-verify`、`--force-with-lease`、`reset --hard` 等危险操作二次确认（force 仅显式入口）。

---

## 7. 性能设计

### 7.1 目标（建议写入验收）

| 指标                 | 目标               | 测量条件              |
| -------------------- | ------------------ | --------------------- |
| 面板首屏（缓存命中） | ≤ 300 ms           | 10k 变更              |
| 面板首屏（冷启动）   | ≤ 800 ms           | 10k 变更              |
| 单文件变更后状态刷新 | ≤ 150 ms           | 不含 Git 进程启动波动 |
| 暂存/取消 100 个文件 | ≤ 500 ms           | SSD                   |
| 提交额外开销         | ≤ 300 ms           | 不含 Git/钩子时间     |
| 日志首屏 300 条      | ≤ 400 ms           | 中型仓库              |
| Webview 内存         | ≤ 150 MB           | 50k 变更，虚拟列表    |
| 单次 IPC payload     | ≤ 1 MB             | 超出分片/按需         |
| UI 卡顿              | 无 > 100 ms 长任务 | 提交/刷新期间         |

### 7.2 关键技术（路线 A）

1. **状态快照增量映射**：内置 `state.onDidChange` 已给出完整状态；GitApiAdapter 做 diff（对比上次快照）后只把变化的文件节点推给 Webview。
2. **去抖 + 合并**：250–300 ms 去抖；同一仓库同一 scope 的多次事件合并为一次推送，带 `seq` 防乱序。
3. **乐观更新**：勾选/取消勾选先翻转 UI，`add/restore` 完成后以真实状态校准，交互零延迟。
4. **虚拟列表**：树节点只渲染视口；目录展开懒加载。
5. **按需 Diff**：列表只传元数据；打开 diff 才用 `toGitUri`/`buffer` 取内容。
6. **日志分页**：默认 300，滚动加载；禁止一次取 10 万条。
7. **分支缓存**：`getBranches()` 结果按仓库缓存（短 TTL），`state.onDidChange` 失效。
8. **避免全量重渲染**：Zustand 选择器 + 稳定 key；仓库/文件节点 memo。
9. **大仓库保护**：由内置承担（status 上限 kill + 警告）；我们再做 UI 层"仅显示前 N 个/启用过滤"兜底。
10. **IPC 节流**：进度事件最多 10–20 次/秒；状态事件合并。
11. **进程与并发治理免费**：内置承担 spawn、锁重试（二次退避 10 次）、认证、watcher——我们不再自建，也不引入进程风暴风险。

### 7.3 基准测试计划

- 合成仓库：1k / 10k / 50k 文件；深目录；大量未跟踪；大量重命名。
- 真实仓库：Linux 内核子集、Chromium 子集、Node 大型 monorepo。
- 场景：
  - 冷启动打开面板；
  - 修改 1 个文件后的刷新；
  - 全选 10k 文件后暂存；
  - 提交 100 文件；
  - 切换分支；
  - 打开 5MB 文件 diff；
  - 提交时钩子 sleep 5s，取消耗时。
- 输出：P50/P95、进程数、内存、IPC 字节数；纳入 CI 阈值。

---

## 8. 可靠性设计

### 8.1 失败分类与处理（GitErrorCodes 驱动）

检测输入统一为 `GitError.gitErrorCode`（内置 48 个错误码）。**所有失败的兜底动作是"在终端重试"（已拍板）；stderr 详情不可得，用"查看 Git 输出"（`git.showOutput`）替代。**

| 失败           | 错误码                                | UI 行为                                                    | 自动恢复       |
| -------------- | ------------------------------------- | ---------------------------------------------------------- | -------------- |
| Git 扩展不可用 | —（激活失败）                         | 引导启用内置 Git 扩展                                      | 否             |
| 非 Git 仓库    | —（无 repository）                    | 显示"打开仓库"入口                                         | 否             |
| index.lock     | `RepositoryIsLocked`                  | 内置已自动退避重试 10 次；仍失败则显示重试按钮             | 是（内置重试） |
| 身份未配置     | `NoUserNameConfigured`                | 提供打开 Git 设置入口                                      | 否             |
| 空提交         | `NoLocalChanges` / empty 校验         | 前置校验拦截；提交前禁用按钮                               | 否             |
| 钩子失败       | `DirtyWorkingTree`/无专门码           | 显示"跳过钩子并重试"（noVerify，二次确认）+ 查看输出       | 否（需确认）   |
| GPG 失败       | `GenericError`（无专门码）            | 查看输出 + 终端重试；P2 提交前预检 `commit.gpgsign`        | 否             |
| 认证失败       | `AuthenticationFailed`                | 内置 askpass 已覆盖多数场景；失败后终端重试                | 不自动重试     |
| 推送被拒       | `PushRejected` / `PushNotFastForward` | 显示 ahead/behind，引导 pull/rebase；强推仅显式 + 二次确认 | 否             |
| 冲突           | `UnmergedChanges` / `Conflict`        | 列出冲突文件；打开合并编辑器                               | 否             |
| 网络失败       | `ConnectionError` 等                  | 显示网络错误；可重试                                       | 不自动重试     |
| 并发操作       | —（本地幂等）                         | UI 层禁用按钮 + 排队提示                                   | 是（排队）     |

设计原则：**每个错误必须至少给出一个可操作动作**（对齐 IDEA，避免 GitJet 式"无解释变灰/无解释报错"）。

### 8.2 认证与交互式提示（路线 A：由内置 askpass 承担）

核心原则不变：**后台 Git 进程绝不允许等待人类输入。** 路线 A 下这一条由内置扩展系统性解决（其 `GIT_ASKPASS` 脚本 + IPC 回连 + 原生 InputBox，凭证输入全部发生在 VS Code UI 内；终端同样注入该环境）。

我们的职责收敛为：

- 不自建任何认证/askpass/凭据 UI，不注入覆盖性的环境变量；
- 认证过程对用户透明：凭据输入框由内置弹出，我们无需感知；
- 认证失败以 `AuthenticationFailed` 错误码呈现，恢复动作为"在终端重试"（TerminalBridge 写入脱敏命令，不自动回车）+ "查看 Git 输出"；
- 对 HTTPS token 说明使用系统/内置凭据机制（`CredentialsProvider` 生态，如 GitHub SSO 扩展），不在扩展内存储明文；
- SSH 场景依赖内置 askpass + 系统代理；不支持的场景如实提示"请在终端完成"。

### 8.3 GPG / 钩子

- GPG：
  - 提交前可检测 `commit.gpgsign=true`；
  - 失败时识别 pinentry 相关输出；
  - 建议用户在终端提交，或配置 `pinentry-mac`/`gpg-agent`；
  - 不在扩展内收集 passphrase。
- 钩子：
  - 默认执行（与 Git 一致）；
  - 失败呈现：钩子名、退出码；stderr 详情 API 不透出，提供"查看 Git 输出"（`git.showOutput`）；
  - 提供"跳过钩子并重试"（`noVerify: true`，显式确认）；
  - 钩子可能修改文件：提交后由 `state.onDidChange` 刷新，提示"钩子修改了工作区"；
  - 钩子运行期间显示进度、不可中断（API 限制）；失败后走"跳过钩子重试"或"在终端重试"。

### 8.4 数据安全

- 不自动执行 `reset --hard`、`checkout -- .`、`clean -fd`；
- Rollback 单文件使用 `git restore`（未暂存）/ `git restore --staged`（暂存），二次确认；
- 删除分支、drop stash、强推、amend 已推送提交：全部二次确认，并显示影响；
- 提交失败不修改 index（除用户明确选择的暂存操作）；
- 提交成功后即使刷新失败，也不回滚；
- 提交消息经 API 传递（内置以 stdin 送入 git），不落盘临时文件，无权限/残留问题；
- 诊断日志不记录文件内容与凭据。

### 8.5 可观测性

- OutputChannel：`Git Batch Commit`，记录操作类型、repoId、错误码、耗时；stderr 详情引导至内置 `git.showOutput`；
- 命令 `Git Batch Commit: Copy Diagnostics`：扩展版本、VS Code 版本、Git 版本、仓库数量、最近 50 条操作；
- 错误上报（可选）：默认关闭，需用户显式开启；
- 性能埋点：首屏、刷新、提交各阶段耗时，仅本地记录。

---

## 9. 实施路线与工作量

### 9.1 阶段划分

#### 阶段 0：骨架与 API 绑定验证（1 周）

- 扩展工程、Webview 构建、协议骨架；
- `GitApiAdapter` 原型：激活 `vscode.git` → `getAPI(1)`、仓库枚举、`state` → 四组变更/HEAD 映射、`state.onDidChange` 事件桥；
- 用真实仓库验证：多根工作区、嵌套仓库、worktree/submodule、`add/restore/commit` 全链路、`AuthenticationFailed` 等错误码捕获；
- 产出：技术风险清单与 demo。

**退出标准**：API 绑定稳定，状态映射与内置 SCM 视图显示一致（四组变更、ahead/behind、分支名）；commit 全链路在 demo 中打通。

#### 阶段 1（P0）：可用提交面板（3–4 周）

- Webview 变更树、分组、勾选（checkbox = staged）；
- `InclusionModel`：勾选 → `add/restore` 映射 + 乐观更新 + 校准；
- 单/多仓库批量提交（`BatchOrchestrator`：顺序执行、失败即停、结果聚合）；
- Diff（`toGitUri` + `vscode.diff`：HEAD/index/worktree 三向）；
- 当前分支显示与切换；
- 进度、取消后续仓库、结果面板；
- `ErrorMapper` + `TerminalBridge`（错误码 → 动作 + 终端兜底）；
- 单元/集成/E2E 基础。

**退出标准**：第 1.4 节的 6 条验收全部通过；10k 文件仓库达到性能目标。

#### 阶段 2（P1）：1:1 体验（4–5 周）

- Commit & Push、推送结果（含 `PostCommitCommandsProvider` 对比）；
- 分支树、创建/删除/合并、分支对比（变基视 API 能力）；
- 日志分页、筛选、提交详情；
- Stash（四件套 API）+ stash 列表（MiniRunner）；
- 提交选项（sign-off、noVerify、signCommit、amend、模板）；
- Hunk 级暂存（复刻内置 hash-object + update-index，MiniRunner）；
- 冲突列表 + 合并编辑器 + 标记解决；
- 认证/GPG/钩子的恢复动作完善；
- 设置项与 i18n 基础。

**退出标准**：覆盖第 4 节所有 P0/P1 项；多仓库、worktree、submodule 场景通过。

#### 阶段 3（P2）：完整对齐与增强（5–8 周）

- IDEA Shelf（命名、描述、部分恢复、导入导出）；
- Changelist（虚拟包含模型）；
- 提交图（lane 渲染、过滤、搜索）；
- 交互式 rebase、Amend 指定提交、drop commit；
- 行级暂存（行选择 UI 精细化）；
- 提交检查（自定义命令）；
- 错误 stderr 增强（自建只读复现，视需求）；
- 性能与可访问性细节。

### 9.2 人员配置建议

- 1 名资深 TS/Node 工程师（API 适配、包含模型、多仓库编排、错误映射）；
- 1 名前端工程师（React/Webview/虚拟列表/Diff 交互）；
- 0.5 名测试/QA（fixture、跨平台、性能）；
- 设计 0.2（图标、间距、主题）。

两人并行时，建议按“Host 逻辑 / Webview UI”切分，协议先定；不要两人同时改同一层。进程/认证/锁重试由内置扩展承担，不再需要专门的内核人力。

### 9.3 风险登记

| 风险                                | 概率               | 影响 | 缓解                                                                  |
| ----------------------------------- | ------------------ | ---- | --------------------------------------------------------------------- |
| API 无法中断进行中 commit/push      | 确定（已确认限制） | 中   | "取消后续仓库" + 前置校验；UI 文案如实说明                            |
| 错误细节受限（无 stderr）           | 确定（已确认限制） | 中   | 错误码 → 动作映射 + "查看 Git 输出"（`git.showOutput`）+ 终端重试兜底 |
| 内置扩展升级导致 API 变化           | 低                 | 中   | `getAPI(1)` 契约稳定；特性检测 + 集成测试 CI                          |
| 与内置 SCM 并存的用户困惑           | 中                 | 中   | 文案说明"两处提交等价、状态同源"；设置项引导                          |
| 包含模型边界（勾选 ⇄ index 强一致） | 中                 | 高   | 乐观更新 + 真实状态校准；提交前校验；E2E 覆盖                         |
| 多仓库语义复杂                      | 高                 | 高   | `repoId` 全链路；先做分组顺序提交                                     |
| Hunk 级暂存正确性                   | 中                 | 中   | 复刻内置 blob+update-index 方案，避开补丁上下文；单独立项 + 测试矩阵  |
| 大仓库性能                          | 中                 | 高   | 内置上限保护 + 虚拟列表、增量、分页、基准 CI                          |
| IDEA 行为理解偏差                   | 中                 | 中   | 用 IDEA 实机录屏/对照清单验收                                         |
| 许可证/品牌                         | 低                 | 中   | 不复制代码/图标；API 调用 + clean-room 行为参考；自有品牌             |
| 需求蔓延（Shelf/Graph/Changelist）  | 高                 | 中   | 按 P0/P1/P2 冻结范围                                                  |

---

## 10. 测试计划

### 10.1 测试层次

| 层次         | 工具                                     | 覆盖                                                                |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------- |
| 单元         | Vitest                                   | 状态映射、包含模型、错误映射、编排器、路径归一化                    |
| 集成         | VS Code Test Runner + 真实 Git（经 API） | 仓库枚举、state 映射、add/restore/commit、branch、stash             |
| Webview 组件 | Vitest + Testing Library                 | 树选择、三态、按钮禁用原因、结果面板                                |
| E2E          | Playwright + VS Code                     | 打开面板、勾选、Diff、提交、多仓库、取消后续仓库                    |
| 性能         | 自定义 benchmark                         | 大仓库、IPC、内存                                                   |
| 兼容         | CI matrix                                | Linux/macOS/Windows；不同 VS Code 版本（内置 Git 扩展版本随之变化） |

### 10.2 Fixture 矩阵

必须包含：

- 空仓库 / unborn branch；
- detached HEAD；
- 正常修改、新增、删除、重命名、复制；
- 文件名含空格、引号、中文、Emoji、换行（`\n`）；
- 大小写敏感/不敏感文件系统；
- CRLF / LF / `core.autocrlf=true`；
- 冲突（merge/rebase/cherry-pick）；
- 子模块（干净/脏/未初始化）；
- worktree；
- 嵌套仓库；
- bare 仓库；
- 有 upstream / 无 upstream / 多 remote；
- pre-commit 成功/失败/修改文件/sleep；
- commit-msg 修改消息；
- GPG 签名成功/失败（mock gpg）；
- 身份未配置；
- index.lock 被占用；
- 5 万文件合成仓库；
- 大文件/二进制文件；
- 非 UTF-8 文件名/内容。

### 10.3 关键验收用例

1. **批量提交**：勾选 3 个文件（其中 1 个已暂存、1 个未跟踪），提交后只有这 3 个进入 commit；index 中其他已暂存文件不被提交。
2. **多仓库**：工作区 2 个仓库，各选 1 个文件，提交后两个仓库各有 1 个新 commit；结果面板分别显示 hash。
3. **多仓库失败**：仓库 B 的钩子失败，仓库 A 成功；默认停止后续；结果明确“A 成功、B 失败”。
4. **取消后续仓库**：3 个仓库批量提交，第 1 个进行中点击"取消后续仓库"→ 该仓库不中断但完成后第 2、3 个不再提交；结果面板如实标注"1 完成、2 跳过（已取消）"。
5. **重复点击**：快速点击提交 3 次，只产生 1 个 commit。
6. **慢网络不误报**：push 网络慢 20s，UI 持续显示进度，不报"超时"；期间可"取消后续仓库"；内置锁重试不产生失败误报。
7. **Diff 正确性**：暂存后修改同一文件，工作区 diff 显示 index→worktree，暂存 diff 显示 HEAD→index。
8. **特殊文件名**：文件名含换行/中文/引号，状态树与提交均正确。
9. **Amend 不强推**：amend 已推送提交，Commit & Push 不自动 force；若用户选择强推，二次确认。
10. **默认选择**：首次打开面板，tracked 文件默认勾选，Commit 按钮可用（有消息时）；未跟踪默认不选。
11. **分支显示**：切换分支后，面板分支胶囊与 ahead/behind 在 1s 内更新。
12. **大仓库**：5 万文件，面板可交互，滚动流畅，内存 < 150MB。

### 10.4 验收门槛

- P0 用例 100% 通过；
- 单元测试覆盖率 ≥ 80%（核心解析/状态机 ≥ 90%）；
- 跨平台 CI 全绿；
- 性能基准不劣化超过 10%；
- 无 P0/P1 级安全与数据丢失缺陷。

---

## 11. 许可证与合规

### 11.1 IDEA 源码

- 源文件头标注 Apache 2.0；仓库根目录 `LICENSE.txt` 为 JetBrains Open-Source Build Terms，明确源代码适用 Apache 2.0。
- 若复制 IDEA 代码（而非仅参考行为），必须：
  - 保留版权头；
  - 附带 Apache 2.0 LICENSE；
  - 保留/更新 NOTICE；
  - 说明修改。
- **建议**：采用 clean-room 方式，仅参考类职责与行为，不复制 Kotlin/Java 实现；这样可避免许可证与代码风格负担。

### 11.2 GitJet

- `zhyc9de/jet-git` 与 `aotemj/jetbrains-git-graph` 均为 MIT。
- 若复用代码：保留 MIT 许可证与版权声明（两段版权）。
- **建议**：仅复用无状态工具函数（如解析辅助），核心重写；不做 fork，避免继承架构债务。

### 11.3 品牌与图标

- 不使用 JetBrains 名称、Logo、图标作为产品标识；
- 不使用 “IntelliJ IDEA” 作为扩展名；
- 描述中可使用“IDEA-style”“inspired by IntelliJ IDEA”等说明性文字，但需避免暗示官方关联；
- 图标使用自有设计或 VS Code Codicon（MIT/CC-BY 需遵守）；
- Marketplace 文案避免商标混淆。

### 11.4 依赖

- React、Zustand、构建工具均为 MIT/Apache 2.0；
- 引入任何第三方库前做许可证扫描（`license-checker`）；
- 不引入 copyleft 依赖到核心分发物；
- **内置 Git 扩展（MIT）**：我们仅通过其公开 API 调用，不复制其代码；行为复刻（如行级暂存做法）注明来源即可，无需附带其版权头。

---

## 12. 待确认问题（v0.2：主要决策已确认）

**已确认（2026-11-15，详见 §0.4）**：包含模型（index 模型，Changelist P2）、单面板分组、默认 Commit、强推仅显式、Stash P1/Shelf P2、Hunk P1、**路线 A（API 复用）**、**与内置 SCM 并存**、**错误码 + 终端重试兜底**、不 fork GitJet、产品命名 Git Batch Commit。

**仍需确认/默认采用的开放项**：

1. **最低版本**：默认 VS Code 1.85+（`getAPI(1)` 自 1.53 起稳定，实际跟随用户 VS Code 版本）；Git 版本由内置扩展管理，不再自设门槛。
2. **品牌落地**：扩展名称、图标、发布者主体（命名已定，见 §5.6）。
3. **遥测**：是否需要匿名性能/错误上报？默认关闭是否可接受？
4. **目标仓库规模**：最大需要支持多少文件/多少仓库？是否含 monorepo/子模块？（影响性能验收阈值）
5. **发布渠道**：Marketplace / Open VSX / 私有分发。

---

## 附录 A：关键证据索引

### A.1 GitJet（`idea-like-git-graph` 0.4.17）

| 主题                        | 文件:行                                                     |
| --------------------------- | ----------------------------------------------------------- |
| Git 执行无超时/取消         | `src/git/gitService.ts:52-66`                               |
| 提交用 `-m`                 | `src/git/gitService.ts:1008-1013`                           |
| Amend 自动强推              | `src/git/gitService.ts:1015-1022`、`684`                    |
| 状态解析 v1 无 `-z`         | `src/git/gitService.ts:923-989`                             |
| 暂存文件                    | `src/git/gitService.ts:991-996`                             |
| Webview 10s 超时            | `webview/src/shared/bridge/vscode-bridge.ts:47-50`          |
| 只使用第一个 GitService     | `src/extension.ts:55`                                       |
| 聚合所有仓库状态            | `src/extension.ts:958-971`                                  |
| 提交 handler 提交整个 index | `src/extension.ts:995-1009`                                 |
| Commit & Push handler       | `src/extension.ts:1011-1026`                                |
| 首次加载不选中              | `webview/src/shared/store/commit-store.ts:121-123`          |
| 按钮要求选中                | `webview/src/commit/components/CommitMessageArea.tsx:26-28` |
| 提交 store 逻辑             | `webview/src/shared/store/commit-store.ts:265-315`          |
| Watcher 全量失效            | `src/watchers/gitWatcher.ts:119-131`                        |
| 进度事件                    | `src/extension.ts:26-36`                                    |
| 路由无并发控制              | `src/messages/messageRouter.ts:19`                          |

### A.2 IDEA（271.SNAPSHOT，`a40efd2b8`）

| 主题                  | 文件                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------- |
| 提交面板骨架          | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitPanel.kt`                 |
| 提交按钮/下拉/快捷键  | `platform/vcs-impl/src/com/intellij/vcs/commit/CommitActionsPanel.kt`                  |
| 工作流处理器          | `platform/vcs-impl/src/com/intellij/vcs/commit/NonModalCommitWorkflowHandler.kt`       |
| 暂存区提交工作流      | `plugins/git4idea/backend/src/index/GitStageCommitWorkflow.kt`                         |
| 暂存区提交面板        | `plugins/git4idea/backend/src/index/ui/GitStageCommitPanel.kt`                         |
| 提交命令构造/错误检测 | `plugins/git4idea/backend/src/checkin/GitRepositoryCommitter.kt`                       |
| Commit & Push 执行器  | `plugins/git4idea/backend/src/checkin/GitCommitAndPushExecutor.kt`                     |
| 当前分支组件          | `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/ui/CurrentBranchComponent.kt`  |
| Shelf 管理            | `platform/vcs-impl/src/com/intellij/openapi/vcs/changes/shelf/ShelveChangesManager.kt` |
| Shelf Git 保存        | `plugins/git4idea/backend/src/stash/GitShelveChangesSaver.java`                        |
| Stash 保存            | `plugins/git4idea/backend/src/stash/GitStashChangesSaver.java`                         |

### A.3 参考链接

- IntelliJ Community：<https://github.com/JetBrains/intellij-community>
- GitJet：<https://github.com/zhyc9de/jet-git>
- Fork：<https://github.com/aotemj/jetbrains-git-graph>
- Git `status --porcelain=v2`：<https://git-scm.com/docs/git-status>
- VS Code 内置 Git 扩展（`vscode.git` API 契约与行为参考）：<https://github.com/microsoft/vscode/tree/main/extensions/git>
- 《VSCode-Git-架构对比分析》（本仓库 `docs/`，三路线对比与修订依据）
- VS Code Extension API：<https://code.visualstudio.com/api>
- VS Code Diff Editor：<https://code.visualstudio.com/api/extension-guides/custom-editors>

---

## 附录 B：建议的代码目录（未来实施用）

```
src/
  extension.ts            // 激活、命令注册、GitApiAdapter 装配
  protocol/
    messages.ts            // 请求/响应/事件类型、错误码
    version.ts
  adapter/                 // 内置 Git API 适配层
    gitApi.ts              // vscode.git 激活 / getAPI(1) / onDidChangeState
    repoRegistry.ts        // repoId 映射、onDidOpen/CloseRepository
    stateMapper.ts         // state → 四组 FileChange / HEAD 快照（diff 推送）
    errorMapper.ts         // GitErrorCodes → 错误枚举 + 恢复动作
  core/
    inclusionModel.ts      // 勾选 ⇄ index 映射（核心自建逻辑）
    batchOrchestrator.ts   // 多仓库顺序提交 / 失败策略 / 结果聚合
    operationTracker.ts    // UI 层操作状态机 / 进度 / 幂等
    terminalBridge.ts      // "在终端重试"（sendText，脱敏）
    cache.ts
    diagnostics.ts
  services/
    diffService.ts         // toGitUri + vscode.diff + buffer/show
    historyService.ts      // log 分页/过滤
    stashService.ts        // stash 四件套 + 列表（经 miniRunner）
    miniRunner.ts          // P1：stash list / hash-object / update-index
  ui/
    commitViewProvider.ts
    messageGateway.ts
    commands.ts
  webview/
    main.tsx
    components/
      CommitPanel.tsx
      RepoSection.tsx
      ChangesTree.tsx
      CommitBox.tsx
      CommitButton.tsx
      BranchPicker.tsx
      ProgressPanel.tsx
      ResultPanel.tsx
    store/
    bridge/
  test/
    unit/
    integration/
    fixtures/
```

> 该目录仅用于说明职责边界，不是要求一次性建齐；实施时按阶段增量创建。

---

## 结语

这份报告的核心判断是：

- **IDEA 的提交体验可以复刻**，关键是把“包含模型、工作流状态机、Git 命令构造”三层拆清楚；
- **GitJet 的卡死不是单点 bug，而是进程治理、请求生命周期、多仓库模型、并发控制的系统性缺失**；
- **首版应聚焦 P0**：正确的批量提交、可靠的进程治理、准确的多仓库、可取消的进度、可理解的错误；先把“不会错、不会卡、不会丢”做扎实，再追求 Shelf、图、Changelist 等完整度。

如果上述待确认问题得到答复，下一步可以产出：

1. 详细交互稿（含每个菜单/快捷键/空状态）；
2. 协议与数据模型定稿；
3. 阶段 0 的技术验证 demo（仅验证进程治理，不含产品代码）；
4. 按 P0 拆分的任务清单与排期。
