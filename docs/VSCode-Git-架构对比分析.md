# VS Code Git 提交架构 vs IDEA Git 提交架构
## 逐层对比与 1:1 可行性分析（v1）

| 项目 | 内容 |
|---|---|
| 日期 | 2026-11-14 |
| 范围 | 架构对比分析；不含生产代码 |
| VS Code 源 | `microsoft/vscode` `main` 分支，内置 Git 扩展 `extensions/git/`，包名 `git` 10.0.0，约 1.9 万行 TS（本目录 `/tmp/opencode/vscode-git` 快照） |
| IDEA 源 | `intellij-community` 271.SNAPSHOT，`a40efd2b8`（见主报告） |
| 结论 | **提交语义层两边高度同构，行为可以 1:1；UI 载体根本不同，"像素级 1:1" 不可达也不应追求。推荐改为"复用内置 Git 扩展 API + Webview 面板"，替代原报告的"完全自建内核"路线。** |

---

## 1. 身份澄清：VS Code 的"Git 提交"到底是谁做的

VS Code 的 Git 提交功能**不是 VS Code 核心的能力**，而是一个**内置扩展**：

- 源码在 `microsoft/vscode/extensions/git/`，包名 `git`，版本 10.0.0，MIT 许可；
- 本身就是一个普通扩展，同样用 Extension Host + 子进程跑 `git` CLI；
- 对外通过 `vscode.git` 扩展 ID 导出 API：`extensions.getExtension('vscode.git').activate().getAPI(1)`；
- UI 使用的是 VS Code 原生 SCM API（`vscode.scm.createSourceControl`），不是 Webview。

所以"VS Code 的 Git 提交架构"= "一个第三方扩展的架构"。**这意味着我们可以和它站在同一层竞争、或者站在它肩膀上**，这直接改变实现策略。

---

## 2. 三方架构总对照

| 层 | IntelliJ IDEA | VS Code 内置 Git 扩展 | GitJet（idea-like-git-graph） |
|---|---|---|---|
| UI 载体 | 自绘 Swing 面板（可停靠工具窗） | **原生 SCM 视图**（树 + 输入框），无 Webview | React Webview（postMessage RPC） |
| UI 组成 | `NonModalCommitPanel`：消息编辑器 + 变更树 + 分裂按钮 + 分支胶囊 | `SourceControl` + 4 个 ResourceGroup + `InputBox` + `scm/title` 按钮 | 自绘变更树 + 消息框 |
| 命令/编排层 | `CommitWorkflow` + `CommitExecutor` + checks | `CommandCenter`（183 个命令）+ `smartCommit` 流程 | `MessageRouter`（无编排） |
| 状态层 | `ChangeListManager` + `GitStageTracker` | `Repository.state` + `updateModelState()`（乐观更新） | 各 Service 各自拉取 |
| 进程层 | `GitLineHandler`（行事件流 + 问题检测器） | `Git.exec/stream/spawn` + `CancellationToken` | `execFileAsync`（裸） |
| 并发治理 | workflow 串行 + per-root | `OperationManager`（blocking/readOnly/retry）+ `retryRun` 退避重试 + `@throttle` | 无 |
| 错误分类 | `GitPinentryProblemDetector` 等检测器 | `GitErrorCodes`（stderr 正则，48 个错误码） | 无 |
| 认证 | JetBrains 自建凭据 UI + pinentry 检测 | **askpass 脚本 + IPC server + 原生 InputBox** | 无（挂起） |
| 状态解析 | 自有 VCS 框架 + 后台刷新器 | `git status -z`（porcelain v1）+ 流式解析 + **1 万条上限后 kill** | `status --porcelain=v1` 按 `\n` 切（错） |

---

## 3. VS Code 内置 Git 提交链路逐层拆解（附证据）

### 3.1 入口与装配 — `main.ts`

- `findGit()` 按顺序查找 Git 可执行文件（`git.path` 设置、PATH 等）；
- `createIPCServer()` 启动 IPC 服务（Windows named pipe / Unix socket，`ipc/ipcServer.ts:18-28`）；
- `Askpass` + `GitEditor` + IPC 三者合成环境变量，注入给所有 git 子进程（`main.ts:87-89`）；
- `new Git({ gitPath, version, env })` 是唯一的命令执行器；
- `Model` 管理仓库集合；`GitFileSystemProvider` / `GitDecorations` / `GitTimelineProvider` / `GitBlameController` 等注册原生能力。

### 3.2 仓库发现 — `model.ts`

- 监听 `workspaceFolders` 变化 + 初始扫描（`repositoryScanMaxDepth` 默认限制扫描深度、忽略 `node_modules`、`git.scanRepositories` 白名单）；
- `openRepository()` 处理：父目录仓库提示、`safe.directory` 不安全仓库提示、用户手动关闭的仓库、Workspace Trust 校验；
- 区分 `repository | submodule | worktree` 三种 kind（`api/git.d.ts` `RepositoryKind`）；
- worktree 有 `migrateChanges()` 把 worktree 变更迁移到主仓库（stash 中转，含冲突确认模态框）。

### 3.3 状态层 — `repository.ts`

4 个 resource group 就是"包含模型"的物理表达（`repository.ts:1020-1023`）：

```text
mergeGroup       → 冲突文件
indexGroup       → 已暂存（Staged Changes）
workingTreeGroup → 已修改未暂存（Changes）
untrackedGroup   → 未跟踪
```

- `updateModelState()`：任何非只读操作完成后都会刷新；支持**乐观更新**（`commitOperationGetOptimisticResourceGroups`：提交前就把组清空，不等 git 跑完，UI 即时反馈）；
- `getStatus()`（`git.ts:2830`）：`git status -z`（注意是 **porcelain v1**，不是 v2）+ `GIT_OPTIONAL_LOCKS=0`，流式解析（`GitStatusParser`，NUL 分割，正确处理重命名）；
- **大仓库防护**：默认 `statusLimit=10000`，超限即 `child.kill()` 并标记 `didHitLimit` → 弹通知"变更太多，仅启用部分功能"，还会建议把大目录加入 `.gitignore`（`repository.ts:3105-3190`）；
- 状态耗时 >5s 会上报遥测（`statusSlow`）。

### 3.4 操作层 — `operation.ts` + `repository.ts:2857-3000`

这是 VS Code 内置扩展最值得抄的设计：

- `OperationKind` 55 种操作（Add/Commit/Push/Rebase/Worktree...）；
- 每个操作声明 5 个属性：`blocking`（是否禁用其他 UI 命令）、`readOnly`、`remote`、`retry`、`showProgress`；
- `run()`：`operations.start()` → 执行 → `operations.end()`；**非只读操作完成后强制 `updateModelState()`**；
- `retryRun()`：遇到 `RepositoryIsLocked`（另一个 git 进程持有 index.lock）或 `CantLockRef` 时，**最多重试 10 次、二次退避**（`Math.pow(attempt,2)*50ms`）；
- `@throttle` 装饰器给 `status()`/`refresh()` 去抖；
- 提交中：`inputBox.enabled = !operations.isRunning(Commit)`（`repository.ts:378`）——输入框在提交期间禁用，防重复提交。

### 3.5 进程层 — `git.ts:600-735`

- `spawn()`：参数数组不经 shell；环境变量强制 `LC_ALL=en_US.UTF-8`、`GIT_PAGER=cat`、`VSCODE_GIT_COMMAND`；
- 默认 `stdio = ['ignore', null, null]`——**stdin 直接丢弃**，配合 askpass，杜绝"后台进程等输入"；
- `_exec()`：支持 `options.input`（写完 stdin 即关闭）、`options.cancellationToken`（取消）、`options.onSpawn`；
- 非零退出码 → 抛 `GitError`（带 stdout/stderr/exitCode/gitErrorCode/gitCommand/gitArgs）；
- 没有"统一超时"——它靠 askpass 消灭等待输入的场景，靠 CancellationToken 提供取消。

### 3.6 提交链路 — `commands.ts:2374-2790` + `git.ts:2118-2197`

命令变体（vs IDEA 执行器一一对应）：

```text
git.commit / commitStaged / commitAll / commitSigned / commitAmend /
commitNoVerify / commitStagedNoVerify / commitAllAmendNoVerify / commitEmptyNoVerify ...（15+ 个）
```

提交消息传递：`--file -` + **stdin 写入后关闭**（`git.ts:2123-2124`），不用临时文件——比 IDEA 的 `-F 临时文件` 更简洁，同样规避了转义问题。

参数构造与 IDEA `GitRepositoryCommitter` 对照：

| 选项 | VS Code | IDEA |
|---|---|---|
| amend | `--amend` | `--amend` |
| sign-off | `--signoff` | `--signoff` |
| GPG | `-S` / `--no-gpg-sign` | gpg 配置 |
| 空提交 | `--allow-empty`（需模态确认） | 默认阻止 |
| 跳过钩子 | `--no-verify` | `--no-verify` |
| 用户身份 | `-c user.useConfigOnly=true`（阻止 git 猜测身份） | 提前校验配置 |
| 详细输出 | `--verbose` | — |

**`smartCommit` 流程（`commands.ts:2374`）** 是 VS Code 版的"包含模型检查"：

1. 有未保存的脏文件 → 模态框"保存后提交？"
2. 无暂存变更且未配置 smartCommit → 模态框"要不要暂存全部并提交？"（Yes/Always/Never）
3. `enableSmartCommit` → 自动 `all: true`
4. `git.enableCommitSigning` → 注入 `signCommit`
5. `confirmEmptyCommits` → 空提交模态确认

### 3.7 暂存链路（含行级暂存，已被低估的内置能力）

- 文件级：`git add -A -- <paths>`（分块防参数超长，`git.ts:2000-2010`）；
- **行级暂存**：diff 编辑器选中行 → `Stage Selected Ranges` → `staging.ts:applyLineChanges()` 基于行差异重组内容 → `hash-object --stdin -w --path <file>` 写 blob → 查 HEAD 侧 mode → `update-index [--add] --cacheinfo <mode> <hash> <path>`（`git.ts:2018-2043`）；
- 也就是说 **VS Code 原生已实现 IDEA 暂存区模式的行级包含**，且用的是"blob + update-index"方案，不需要生成/应用补丁，避开 autocrlf 上下文错位问题。

### 3.8 Diff

- 虚拟文档 scheme `git:`，URI query JSON：`{ path, ref }`（`uri.ts`）；ref 语义：`''`=工作区、`~`=index、`HEAD`=HEAD 版本；
- 工作区 diff = QuickDiffProvider（`quickDiffProvider.ts`），暂存 diff = `StagedResourceQuickDiffProvider`（HEAD → index）；
- 多文件 diff 用 VS Code 原生 Multi-diff Editor（`multiDiffEditorEnableViewChanges`）；
- 行级 stage 直接读取 diff 编辑器的 `TextEditorDiffInformation`（`staging.ts:218-240`）——**diff 信息由 VS Code diff 编辑器免费提供**。

### 3.9 认证（这是 VS Code 和 IDEA 差异最大、也最巧妙的部分）

- 内置扩展生成 `askpass.sh` 脚本，通过环境变量 `GIT_ASKPASS` 交给 git；
- git 需要凭据时执行该脚本 → 脚本通过 **IPC（named pipe/socket）** 回连扩展宿主（`askpass-main.ts` + `ipc/ipcClient.ts`）；
- 宿主弹出**原生 InputBox**（密码框）或 QuickPick（SSH fingerprint 确认，`askpass.ts:93-125`）；
- 支持 `CredentialsProvider` 注册（GitHub 等 SSO 扩展就挂在这里）；
- 终端里跑 git 也复用同一机制：`TerminalEnvironmentManager` 把 `GIT_ASKPASS` 等注入终端环境（`terminal.ts:21-40`）；
- 结果：**所有凭据输入都发生在 VS Code UI 里，后台 git 永不挂起等待终端输入**。这正是 IDEA 用自建凭据对话框 + pinentry 检测解决的问题，两者殊途同归。

### 3.10 错误分类 — `git.ts:337-385`

48 个 `GitErrorCodes`，靠 stderr 正则归类：`RepositoryIsLocked`、`AuthenticationFailed`、`NoUserNameConfigured`、`UnmergedChanges`、`EmptyCommitMessage`、`Conflict`、`StashConflict`、`PushRejected`、`ForcePushWithLeaseRejected`、`PatchDoesNotApply`、`CherryPickEmpty`...

对比 IDEA：有专门的 `GitPinentryProblemDetector`/`GitGpgProblemDetector`/`GitEmptyCommitProblemDetector`，VS Code **没有 pinentry 级别的检测**（GPG 失败不会归类为专门错误码）。

### 3.11 对外 API（关键！）— `api/git.d.ts`

`getAPI(1)` 导出：

- `api.repositories: Repository[]` + `onDidOpenRepository/onDidCloseRepository`；
- 每个 `Repository`：
  - `state`: HEAD（含 ahead/behind/upstream）、refs、remotes、submodules、worktrees、`mergeChanges/indexChanges/workingTreeChanges/untrackedChanges`、`onDidChange`；
  - **写操作**：`commit(message, opts)`（opts 含 all/amend/signoff/signCommit/noVerify/empty/postCommitCommand）、`add/revert/restore/apply/hashObject`、`createBranch/deleteBranch/checkout`、`fetch/pull/push(含 ForcePushMode)`、`stash 四件套`、`createWorktree/deleteWorktree/migrateChanges`、`log(LogOptions 含 range/skip/author/grep)`、`tag/merge/rebase 三件套`；
  - 读操作：`diff*` 9 种、`getCommit/getBranches/getRefs/getRemoteRefs/getMergeBase`、`buffer(ref,path)/show(ref,path)`（**直接拿 blob 内容，diff 服务免费**）；
  - 事件：`onDidCommit`、`onDidCheckout`、`state.onDidChange`；
- 可注册扩展点：`CredentialsProvider`、`PostCommitCommandsProvider`（往"Commit & Push"下拉里加命令）、`PushErrorHandler`、`BranchProtectionProvider`、`RemoteSourceProvider`。

**结论：内置扩展已经实现了 IDEA 提交语义的绝大部分，且对外 API 是完整可编程的。**

---

## 4. 概念映射表（IDEA → VS Code）

| IDEA 概念 | VS Code 内置对应 | 行为 1:1？ |
|---|---|---|
| Commit 工具窗（常驻面板） | SCM 侧边栏视图（原生树） | 行为可，布局不可 |
| 消息编辑器（多行/历史/模板） | `SourceControlInputBox`（可多行、`commitTemplate`、`validateInput`）；历史需自建 | 部分 |
| Commit 分裂按钮 + 下拉执行器 | `scm/title` 按钮 + `git.commit` 子菜单（4 组：commit / noverify / amend / amend+noverify） | ✅ 原生等价 |
| Ctrl+Enter | `inputBox.acceptInputCommand` + keybinding | ✅ |
| 变更树 **复选框包含模型** | **无复选框**：文件在哪个 group + commit 选项（`all` 与否）决定提交内容 | ⚠️ 交互模型根本不同 |
| 暂存区模式（Staging Area 视图） | index group 就是暂存区 | ✅ 等价 |
| 行级/Hunk 级暂存 | ✅ 原生（Stage Selected Ranges） | ✅ |
| "Commit All"（含未暂存） | `commit({all:true})`；含未跟踪用 `all:true`，仅 tracked 用 `all:'tracked'` | ✅ |
| 当前分支胶囊 | SCM 视图头部 + 状态栏 + ActionButton（ahead/behind） | ✅ |
| 分支切换/新建/删除 | API + QuickPick | ✅ |
| Commit & Push 执行器 | `PostCommitCommandsProvider`（提交后执行 `git.push`） | ✅ |
| 提交检查（TODO/自定义） | 无内置 | 需自建 |
| 通知（成功/失败/可点击） | Notification API | ✅ |
| 进度面板 | `window.withProgress` + OperationManager spinner | ✅ |
| Shelf（命名补丁存储） | ❌ 无（只有 stash） | 需自建 |
| Changelist（多个虚拟包含集） | ❌ 无（index 组是唯一"暂存"概念） | 需自建 |

---

## 5. "弹出的窗口"：交互范式的本质区别

### 5.1 IDEA：对话框文化

- 提交面板是**常驻工具窗**，可停靠、可浮动、可全屏；
- 选项集中在**一个弹窗**里（Commit 选项对话框：amend/signoff/author/cleanup/hook 全在一屏）；
- 危险操作 = **模态 Swing 对话框**（二次确认）；
- 反馈 = 编辑器内 balloon 通知 + 提交进度面板；
- 面板内部是**自绘组件**：想画什么都行（树、复选框、内嵌 diff）。

### 5.2 VS Code：面板 + QuickPick 文化

- **没有"浮动工具窗口"概念**：侧边栏视图不能弹出为独立窗口；
- 复杂交互一律转译为：
  - `QuickPick`（顶部下拉多选/单选列表，非模态）
  - `InputBox`（顶部输入条）
  - Modal Notification（右下角 + 可强制模态确认）
  - Diff Editor / Multi-diff Editor（标签页）
  - Webview（唯一允许自绘复杂 UI 的地方，但它是"编辑器/面板里的内嵌网页"，不是独立窗口）
- 一个 IDEA 选项弹窗 → VS Code 变成 **2-3 次 QuickPick 串行**，或一个很长的命令菜单。

### 5.3 转译表

| IDEA 弹窗 | VS Code 等价物 | 保真度 |
|---|---|---|
| Commit 选项弹窗（一屏多选项） | QuickPick 多步选择 / 长菜单 | ⚠️ 多步化 |
| Amend 确认 | Modal Notification（可 Don't Show Again） | ✅ |
| 钩子失败详情 + 跳过重试 | Notification + "Skip hooks & retry" 按钮 | ✅（但 stderr 详情受限，见 §7.5） |
| 空提交确认 | 模态确认（原生已有 `confirmEmptyCommits`） | ✅ |
| 冲突提示 → 打开合并 | 原生 Merge Editor（三栏） | ✅ |
| Shelf 面板 | ❌ 无原生，需 Webview/树视图自建 | 自建 |

---

## 6. 底层逻辑逐项对比

### 6.1 相同（同构）的部分

1. **都是 CLI 驱动**：都不是 libgit2/JNI，都是 spawn `git`，参数数组防注入；
2. **消息传递都规避转义**：IDEA `-F 临时文件`，VS Code `--file -` + stdin；
3. **提交选项集合几乎一致**：amend/signoff/no-verify/allow-empty/cleanup（IDEA）/author/date（IDEA）/签名；
4. **状态模型同构**：index / worktree / untracked / merge 四象限 = IDEA 的 staged/changed/unversioned/conflicted；
5. **diff 三视图同构**：HEAD↔index↔worktree，IDEA 叫 ContentVersion（HEAD/STAGED/LOCAL），VS Code 用 git URI ref（`HEAD`/`~`/`''`）；
6. **部分提交同构**：都最终落到 index 快照；
7. **错误都用"分类 + 可操作动作"思路**，只是分类粒度不同。

### 6.2 不同的部分

| 维度 | IDEA | VS Code 内置 | 谁更强 |
|---|---|---|---|
| 状态解析 | 自有 VCS 框架 + 后台刷新器（changelist 与 staging 双模型） | `status -z` v1 + 1 万条上限 kill | 各有取舍：IDEA 精细，VS Code 有"降级保护" |
| 锁冲突 | 报错/等待 | **自动退避重试 10 次**（`retryRun`） | VS Code |
| 乐观更新 | 无（提交后刷新） | 提交前就清空组（UI 即时） | VS Code |
| 大仓库保护 | 有（Index 索引化） | limit+kill+警告+忽略建议 | VS Code 实现简单有效 |
| GPG/pinentry | 专门检测器 + 恢复建议 | 无专门错误码 | IDEA |
| 提交检查/自定义执行前动作 | 有（checks 框架） | 无 | IDEA |
| 包含模型交互 | 复选框（直觉） | index group + commit 选项 | IDEA |
| 可编程性 | 插件平台内部 | **公开 API**（这是我们最大的机会） | VS Code |
| UI 自由度 | Swing 全自绘 | 原生 SCM + Webview | IDEA |

---

## 7. 1:1 可行性结论与难度清单

### 7.1 结论

- **行为 1:1：可达**。提交语义（选项、包含模型、错误语义、多仓库聚合）两边同构，且 VS Code 内置实现可作参考蓝本；
- **UI 1:1（像素级/交互级）：不可达**。VS Code 没有可浮动的自绘工具窗，复杂面板只能 Webview；VS Code 用户也不期待 Swing 式弹窗，应做"IDEA 行为 + VS Code 交互习惯"的混合；
- **实现策略需要修正**：原报告的"完全自建 Git 内核"低估了一个关键事实——**内置 Git 扩展也在同一工作区里运行**。自建内核意味着两个"控制器"并发写 index，锁竞争、重复 watch、双份状态同步都要自己扛。

### 7.2 三条实现路线

| 路线 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. API 复用（推荐 P0）** | 面板/逻辑全部基于 `vscode.git` 的 `getAPI(1)`；Webview 只做 IDEA 式 UI | 进程治理、认证、锁重试、watcher、大仓库防护**全部免费**；1:1 语义立刻可达；开发量减半 | API 不透出 stderr（错误细节受限）；不支持的语义（Shelf、worktree 高级 UI）做不了 |
| **B. 自建内核** | 原报告方案：自建 GitExecutor/StatusService/... | 完全控制；错误细节、超时、定制无上限 | 与内置扩展并存的双控制器问题；重复造轮子；工作量大 |
| **C. 混合** | API 为主；API 没有的（Shelf、自定义提交检查、pinentry 检测）用自建 executor 补齐，写操作复刻 retryRun 语义 | 平衡 | 需要维护两套边界 |

### 7.3 推荐修订

- P0：**路线 A**。提交面板（Webview）+ 包含模型映射（勾选 → `add`/`restore`）+ 多仓库批量（遍历 `api.repositories`）+ Diff（`toGitUri` + `vscode.diff`）；
- P1：路线 C——Shelf、提交检查、错误详情增强；
- P2：若 API 成为瓶颈，再评估局部自建内核（仅在面板需要的读路径上自建，写路径仍走 API）。

### 7.4 难度清单（按风险排序）

1. **双面板并存的产品决策**：我们的提交面板和内置 SCM 视图同时显示同一 index 状态，用户会困惑"提交发生在哪"。选项：只做面板不碰 SCM / 隐藏内置 SCM 视图（`git.showCommitInput` 等）/ 提供一键隐藏配置。✅ **已确认：并存**（不隐藏内置 SCM；文档/文案说明两处提交语义等价）。
2. **包含模型映射**：IDEA 复选框 → VS Code `add`/`restore` 的映射要处理边界（未跟踪文件勾选=需要 add；取消勾选已暂存文件≠unstage；提交时校验 index 与勾选集一致性）。乐观更新期间 Webview 与 `state.onDidChange` 的状态同步。
3. **多仓库批量提交**：API 逐仓库 `commit()` 顺序执行可行，但进度/失败/跳过/推送联动需要自建编排层（OperationCoordinator 概念保留，只是底层命令换成 API 调用）。
4. **错误细节受限**：`Repository.commit()` 失败只拿到 `gitErrorCode`，拿不到 stderr 原文。IDEA 级"钩子失败详情 + 跳过重试"需要自建一次只读复现（用相同参数跑 `git commit --dry-run`?）不可靠；务实做法：对已知错误码提供动作，stderr 详情用"在终端重试"兜底。**这是 API 路线最大的体验缺口。**
5. **Shelf / Changelist**：API 完全没有，需要独立 patch 存储层（P1/P2）。
6. **Webview 交互转译**：IDEA 单弹窗选项 → QuickPick 串行，或 Webview 内自绘选项面板（推荐后者，保持 1:1 交互）。
7. **行级暂存**：如果走 API，`hashObject` + `update-index` 不可用（API 只有 `apply(patch)`），需自建 blob 写入——或先支持文件级，行级 P1 用补丁方案。

### 7.5 决策（已确认，2026-11-15）

1. **路线选择**：✅ **路线 A（API 复用）**；
2. **与内置 SCM 的关系**：✅ **并存**——不隐藏/不抢占内置 SCM，我们的面板是新增视图，两处提交语义等价（同一 index）；
3. **错误详情策略**：✅ **接受"错误码 + 恢复动作 + 在终端重试"兜底**（"查看 Git 输出"用 `git.showOutput` 补 stderr 可见性；不追求 stderr 级自建复现）。

---

## 8. 证据索引（VS Code 内置 Git 扩展，`main` @ 2026-11-13）

| 主题 | 位置 |
|---|---|
| 入口/装配/askpass 注入 | `main.ts:39-140` |
| 仓库发现/父子仓库/worktree | `model.ts:295-560` |
| 4 个 resource group | `repository.ts:1020-1023` |
| 操作类型/属性 | `operation.ts:5-180` |
| run/乐观更新 | `repository.ts:2857-2905` |
| 锁重试（二次退避 10 次） | `repository.ts:2981-3000` |
| 提交期间禁用输入框 | `repository.ts:378` |
| status -z + 上限 kill | `git.ts:2830-2900` |
| 大仓库警告/忽略建议 | `repository.ts:3105-3190` |
| commit 参数构造（`--file -`） | `git.ts:2118-2197` |
| smartCommit（暂存询问/空提交确认） | `commands.ts:2374-2470` |
| 15+ 提交命令变体 | `commands.ts:2614-2700` |
| 行级暂存（hash-object + update-index） | `staging.ts:15-65`、`git.ts:2018-2043` |
| git URI / merge URI | `uri.ts` |
| QuickDiff（工作区/暂存） | `quickDiffProvider.ts` |
| askpass 认证全链路 | `askpass.ts`、`askpass-main.ts`、`ipc/ipcServer.ts` |
| 终端认证注入 | `terminal.ts:21-40` |
| .git watcher + upstream ref watcher | `repository.ts:462-511` |
| 文件变化 → status | `repository.ts:935-952` |
| 48 个错误码 | `git.ts:337-385`、`api/git.d.ts` |
| 对外 API 全量 | `api/git.d.ts`（Repository/CommitOptions/API） |
| Commit & Push = post-commit 命令 | `postCommitCommands.ts:38-90` |
| SCM 菜单/子菜单（提交下拉） | `package.json` `contributes.menus`（`git.commit` 组） |

---

## 9. 对主报告的修订项（全部已落实，2026-11-15）

1. §6（技术架构）：✅ 已改为路线 A——`GitApiAdapter/InclusionModel/BatchOrchestrator/OperationTracker/DiffService/HistoryService/StashService/ErrorMapper+TerminalBridge/MiniRunner`，`GitExecutor` 自建内核删除（MiniRunner 收敛为 P1 白名单 3 命令）；
2. §6.4（协议）：✅ 保留 Webview ↔ 宿主协议，宿主后端为 API 适配层；
3. §7（性能）：✅ 大仓库防护复用内置 `statusLimit`，自建指标保留为验收；关键技术清单按路线 A 重写；
4. §8（可靠性）：✅ 错误分类改为 GitErrorCodes 驱动；认证复用内置 askpass；锁重试以内置 `retryRun` 为基线；钩子/GPG 呈现按"错误码 + 查看输出 + 终端重试"更新；
5. 新增章节：✅ 本文件即"与内置 Git 扩展的关系"；
6. §12（待确认问题）：✅ 决策 1–3 已确认并落入 §0.4 决策表；§9.1 阶段划分、附录 B 目录树同步更新。
