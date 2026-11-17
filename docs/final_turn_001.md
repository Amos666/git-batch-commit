# VS Code Git 提交体验复刻：IDEA 行为对标、架构与性能方案

把 IntelliJ IDEA 的 Git 提交体验搬进 VS Code，真正要复刻的不是 git4idea 这套代码，而是 IDEA 的 Git 产品形态：Commit 工具窗口、changelist 分组、块级与行级部分提交、提交选项面板、分支管理面板，以及它们背后那套「选什么就提交什么」的交互纪律。git4idea 只是 IntelliJ 平台 VCS 框架的适配层，真正决定体验的是平台层的 ChangeList 抽象、CheckinEnvironment 提交流程与多窗格差异视图。照着 git4idea 抄，抄到的是适配器而不是产品。

另一个前提必须先纠正：实测反馈中被当作参照物的 GitJet，在两家扩展市场与 GitHub 上都查不到实体。Microsoft Marketplace 的扩展查询接口对 "GitJet" 的文本检索返回空结果，Open VSX 的 namespace 查询与全文检索同样没有对应条目，GitHub 全站搜索 "gitjet" 只返回 18 个与 JetBrains 无关的小仓库，多为命令行工具与配色主题【16】【17】。同期 JetBrains 真正推进的是独立 Git Client 的 EAP，2025 年夏季封闭测试后宣布停止开发，preview 访问维持到 2025 年 11 月 30 日【13】。这意味着「GitJet 提交卡死」不能被当作某个具体产品的缺陷来定位，只能按 Git 提交链路上的等待类型逐类排查；而可参考的一手实现，要从仍然存活的社区项目里找。

## 一、复刻对象与设计边界

IDEA 的 Git 体验由三层叠成。最下层是 git4idea，负责把 Git 的命令与状态翻译成 IntelliJ 平台的 VCS 抽象：GitChangeProvider 产出变更，GitChangeList 承载分组，GitCheckinEnvironment 承接提交动作，GitDiffProvider 与 GitHistoryProvider 提供差异与历史。中间层是平台自身的提交工作台，包含 Commit 工具窗口的布局、changelist 的树与操作、提交前的 Commit Checks、多窗格差异编辑器。最上层是 Git 之外的生态，例如 Local History、标签与 worktree 支持，以及独立 Git Client 这条产品线。

对标对象由此明确为 IDEA 2026.3 文档所描述的 Git 行为【1】【2】，而不是某个插件仓库的目录结构。目标定为行为等价而非实现等价：同样的操作序列、同样的键位语义、同样的边界情况（空消息、重复提交、合并进行中的部分提交）要有一致的结果，内部结构按 VS Code 的扩展模型重建。

三条边界把项目圈住。范围限定在提交主线：changelist 与 staging area、部分提交、差异比对与预览、提交选项、分支显示与管理；Log 工具窗口的全量复刻、AI 生成提交信息、完整 blame 能力不在此轮。「一比一」按三档判定——可直接实现、需要变通、无法原生等价——逐项落到第三节的矩阵，不做含糊承诺。与 VS Code 内置 Git 的关系必须显式决策，默认互斥，而不是两者同时对同一个 index 写入。

## 二、IDEA 提交体验的功能基线

IDEA 2026.3 帮助文档把提交主线的行为写得很具体，以下部分可以直接当验收基线。

### 提交入口与工具窗口

Commit 工具窗口是 Alt+0（macOS 为 ⌘0），Git 工具窗口的 Log 标签是 Alt+9。Ctrl+K 提交当前活动 changelist 的全部选中内容，Ctrl+Alt+K 提交并推送，Ctrl+Shift+K 推送，Ctrl+D 打开 Show Diff，Ctrl+Alt+A 把文件加入版本控制，Alt+Shift+M 触发 Move to Another Changelist，Ctrl+Space 把选中的 changelist 设为活动项，Ctrl+O 打开提交面板右下角齿轮里的高级选项，Ctrl+F 在历史中跳转到指定 hash、分支或标签【1】【2】【3】。

### 提交选项与提交检查

提交选项面板的内容可以逐项对标。Author 用于覆盖提交者，Sign-off commit 会在消息尾部追加 Signed off by 行。Commit Checks 包含 Reformat code、Rearrange code、Optimize imports、Cleanup、Update copyright、Check malicious dependencies 六项，Advanced Commit Checks 包含「提交后再运行检查」的延后模式以及 Analyze code、Check TODO、Run Configuration，After Commit 负责把提交结果上传到服务器或目录【1】。Hooks 语义同样需要照搬：`.git/hooks` 下的钩子在提交时自动执行，可以在提交设置里按次取消 Run Git hooks，也能在 IDE 层全局关闭。提交模板沿用 `git config --local commit.template` 指向的文件【1】。

### 分组模式与部分提交

IDEA 提供两种互斥的组织方式。changelist 模式下，默认的 Changes changelist 承载全部新变更，Unversioned Files changelist 收集尚未纳管的新文件，用户可新建带名称与描述的 changelist、切换活动项、在 changelist 之间移动文件，非活动 changelist 的文件可在编辑器中标色，跨 changelist 修改同一文件会触发 changelist 冲突提示【2】。staging area 模式则按 Git 原生 index 组织改动，同一文件可以分多次提交，包括互相重叠的修改；文档同时写明启用该模式会删除已存在的全部 changelist【1】【6】。

部分提交在 IDEA 里有三条路径：在提交界面里直接选择代码块与具体行，在编辑过程中把不同代码块分到不同 changelist 再分别提交，以及在 staging area 模式下用 Compare HEAD, Staged and Local Versions 打开的三方编辑器中选择要进入 index 的内容【1】。

外围能力构成第三梯队基线。分支支持新建、重命名、收藏、分组、checkout、比较、删除，以及受保护分支下的同步控制【4】；历史侧支持改写提交信息、amend 本地提交与更早的提交、squash、drop 与 extract selected changes【5】；标签【26】、worktree【8】、冲突处理【7】、回滚与撤销【27】以及 Log 标签的过滤能力【28】都可纳入对标范围，但排在提交主线之后。

### 键位基线与冲突面

IDEA 的键位无法整体照搬，必须先查 VS Code 的占用情况。下表左侧是 IDEA 动作与键位，中间是 VS Code 侧的占用与冲突，右侧是建议的映射值。

| IDEA 动作 | IDEA 键位 | VS Code 侧的占用情况 | 建议键位 |
| --- | --- | --- | --- |
| 打开 Commit 工具窗口 | Alt+0 | 无默认占用 | Alt+0 |
| 提交选中内容 | Ctrl+K | 编辑器剪切行与内置 Git 的 Ctrl+K 和弦系列共用该主键【9】【11】 | Ctrl+Enter（面板内）/ Ctrl+Alt+Enter |
| 提交并推送 | Ctrl+Alt+K | 无默认占用 | Ctrl+Alt+Shift+K |
| 推送 | Ctrl+Shift+K | 默认绑定为 Delete Line【9】 | Ctrl+Alt+Shift+P |
| Show Diff | Ctrl+D | 默认绑定为选中下一处匹配【9】 | Ctrl+Alt+D |
| 加入版本控制 | Ctrl+Alt+A | 无默认占用 | Ctrl+Alt+S |
| Move to Another Changelist | Alt+Shift+M | 无默认占用 | Alt+Shift+M |
| 提交高级选项 | Ctrl+O | 无默认占用 | Ctrl+Alt+O |
| Git 工具窗口 / Log | Alt+9 | 默认的 SCM 视图是 Ctrl+Shift+G【9】 | Alt+9 |

冲突集中在 Ctrl+K、Ctrl+Shift+K、Ctrl+D、Alt+Shift+A 四处，后者是 VS Code 的 Toggle Block Comment【9】。映射原则是保留记忆点重映射冲突键：Alt+0、Alt+9、Alt+Shift+M 可以原样沿用，Ctrl+K 必须让位。社区已有 IDEA 键位移植扩展累计约 247 万次安装【16】，说明键位肌肉记忆是真实需求，同时说明光靠键位移植不构成差异化。

## 三、VS Code 承载能力与等效路径分级

### SCM API 的表达边界

VS Code 的 SCM API 提供的是树形资源模型：`scm.createSourceControl` 建立 SourceControl，`createResourceGroup` 分组，`SourceControlResourceState` 描述单个文件的装饰、命令与上下文值，`SourceControlInputBox` 是提交输入框【10】。三处限制决定了它撑不起 IDEA 的工作台：资源状态没有「是否参与本次提交」的勾选语义；`scm` 命名空间级只有一个 inputBox，且它属于最后创建的 provider，无法按 changelist 分组提交；SCM 视图由工作台统一渲染，第三方 provider 无法插入 IDEA 那种「分组标题 + 每文件复选框 + 底部固定提交区」的复合布局【10】。

可勾选的交互并不缺失，只是载体不同：TreeView 提供 `TreeItem.checkboxState` 与 `TreeView.onDidChangeCheckboxState`，这是实现 IDEA 式勾选行的现成 API【10】。因此主工作台走自建 webview 或 TreeView，而不是硬塞进 SCM 视图。

### 内置 Git 的可借用能力

内置 Git 扩展能直接借用的部分有限但具体。其 package.json 注册了 183 个命令，与提交相关的有 `git.commit`、`git.commitAmend`、`git.stageSelectedRanges`、`git.diff.stageHunk`、`git.diff.stageSelection`、`git.revertSelectedRanges` 等【11】；键位上，部分暂存被放进 `Ctrl+K Ctrl+Alt+S`、`Ctrl+K Ctrl+N`、`Ctrl+K Ctrl+R` 三组和弦【11】。设置项超过一百项，其中与本方案直接相关的是 `git.useEditorAsCommitInput`（默认 true）、`git.enableSmartCommit`（默认 false）、`git.smartCommitChanges`（默认 all）、`git.statusLimit`（默认 10000）、`git.detectWorktrees`（默认 false，上限 50）、`git.repositoryScanMaxDepth`（默认 1）、`git.repositoryScanIgnoredFolders`（默认含 node_modules）、`git.supportCancellation`（默认 false）、`git.mergeEditor`（默认 false）、`git.optimisticUpdate`（默认 true）、`git.allowNoVerifyCommit`（默认 false）、`git.confirmNoVerifyCommit`（默认 true）、`git.alwaysSignOff`（默认 false）、`git.enableCommitSigning`（默认 false）、`git.branchProtection`（默认空数组）、`git.inputValidationLength`（默认 72）、`git.commandsToLog`（默认空数组）等【11】。

这些能力覆盖「在差异编辑器里暂存选中的行或代码块」，但覆盖不了 IDEA 的手工拆分代码块、删除行级别的精细选择，以及把改动移入其他 changelist。

### 能力分级的判定标准

判定按三档执行：可直接实现指 Git 命令层面即有对应参数或内置命令；需要变通指 VS Code 有相邻机制但语义不等价，要自建模型或降级实现；无法原生等价指所依赖的是 IDEA 内部体系，VS Code 没有可对应的概念。下表逐项列出。

| IDEA 能力 | VS Code 侧的等效路径 | 判定 |
| --- | --- | --- |
| 多 changelist 分组提交 | 自建分组元数据，提交时按组构造 patch 写入 index | 需要变通 |
| changelist 冲突提示 | 自建元数据比对同一文件在不同组的差异 | 需要变通 |
| staging area 模式 | 直接以 index 为准，分组视图退化为 index 视图 | 可直接实现 |
| 块级与行级部分提交 | 复用内置 diff 编辑器，自建 patch 构造与 apply --cached 流程 | 需要变通 |
| 手工拆分代码块 | 自建 hunk 边界解析与切分交互 | 需要变通 |
| Compare HEAD、Staged、Local 三方 | 三个虚拟文档配合 diff 命令；冲突场景复用 Merge Editor | 需要变通 |
| Author 覆盖 | `git commit --author` | 可直接实现 |
| Sign-off | `git commit --signoff`，内置 Git 已有 `git.alwaysSignOff` 开关【11】 | 可直接实现 |
| Amend | `git commit --amend`，内置 Git 提供 `git.commitAmend`【11】 | 可直接实现 |
| 提交模板 | 读取 `git config commit.template` | 可直接实现 |
| hooks 开关 | 提交前显式提示并提供 `--no-verify`，参照 `git.allowNoVerifyCommit` 与 `git.confirmNoVerifyCommit`【11】 | 可直接实现 |
| Commit Checks 中的 Reformat、Optimize imports | 调用格式化 provider 与编辑器的 organize imports 命令 | 需要变通 |
| Commit Checks 中的 Rearrange、Cleanup、Update copyright | VS Code 无代码风格规则与 inspection profile 体系，只能自建规则或降级为任务 | 需要变通 |
| Commit Checks 中的 Analyze code、Check TODO | 读取 problems 面板的 diagnostics，自建 TODO 扫描 | 需要变通 |
| After Commit 上传 | 调用 tasks API 或自建执行器 | 需要变通 |
| 分支面板与分支操作 | 自建 TreeView 配合 git 命令 | 需要变通 |
| Local History 与检查项的 inspection profile | VS Code 无对应机制，只能用时间线与 reflog 近似 | 无法原生等价 |
| 冲突三栏合并 | 受 VS Code Merge Editor 能力上限约束，不自研 | 无法原生等价 |

三档分布给出明确提示：真正可直接实现的只有 Git 命令层面的开关，凡是涉及 IDE 内部状态模型的功能都需要自建或降级；降级处必须显式告知用户，隐藏降级等于制造隐性功能缺失。

## 四、changelist 与 staging area 的数据模型

Git 的 index 只有一个，IDEA 的 changelist 是 index 之外的第二套状态，两者关系由 IDE 维护。这是整个复刻里最硬的工程问题，IDEA 自己也给过答案：启用 staging area 会删除已有 changelist【6】。换句话说，两种模式在 IDEA 内部互斥，前者由 IDE 管理影子分组并在提交时合成 index，后者直接以 index 为准。

### 分组元数据的归属

分组元数据按仓库存放，建议落在 `.git` 目录下的独立 JSON 文件，避免污染工作树；worktree 场景下必须用 `git rev-parse --git-dir` 解析真实路径，不能假定 `.git` 是目录。每个分组记录 id、名称、描述、是否活动项，以及成员文件的路径与状态；行级部分提交产生的选择另存 patch 片段。扩展自身的配置项放 globalState。

### 提交期的 index 写入时序

提交时序是成败关键。选中某个 changelist 提交时，需要把该组的文件差异构造成 patch，用 `git apply --cached` 写入 index，再执行提交；一旦中途失败，index 会停留在半写入状态，因此必须有回滚锚点。可行的做法是提交前用 `git write-tree` 记录 index 对应的 tree 对象，失败时用 `git read-tree` 恢复。多个仓库或多个分组并发提交必须按仓库串行化到同一队列，否则 index 写入会互相覆盖。

### 部分提交的 patch 构造

行级与块级部分提交都落在 patch 构造上。内置扩展提供 `git.stageSelectedRanges`、`git.diff.stageHunk`、`git.diff.stageSelection` 三个命令，可以作为交互入口的参照【11】，但 IDEA 的手工拆分代码块要求解析 unified diff 的 hunk 边界并允许用户在编辑器里二次切分，这部分必须自建 hunk 模型。边界情况集中在四处：CRLF 与 LF 混用、二进制文件、超大文件，以及 `.gitattributes` 驱动的过滤与换行转换。

### 两种模式的互斥关系

互斥关系需要在产品上说清楚。建议提供 profiles 概念，changelist 模式由元数据驱动，staging area 模式由 index 驱动，切换时执行一次性迁移，并在提示里说明现有 changelist 会被合并还是丢弃，而不是像 IDEA 那样静默删除。

## 五、提交选项与 commit checks 的实现路径

提交选项面板在 IDEA 里是齿轮弹出层，选项按提交前与提交后分区【1】。VS Code 侧的等价物是 webview 内的可折叠面板，配合 `when` 条件化的命令面板条目。

Author、Sign-off、Amend、模板与 hooks 开关都直接落到 git 命令行参数上，需要补齐的是语义而非参数：IDEA 里 Ctrl+K 会把整个活动 changelist 选中【1】，VS Code 侧必须提供对应的「全选当前组」动作，否则用户每次提交都要逐个勾选。

commit checks 是 IDEA 特有的、真正难复制的一层。六项检查在 VS Code 的落点各不相同。Reformat code 对应格式化 provider，Optimize imports 对应编辑器的 organize imports 命令，两者可以直接调用。Rearrange code 依赖 IDEA 的代码整理规则，没有对应物。Cleanup 依赖 inspection profile，VS Code 没有这套体系。Update copyright 需要自建版权头扫描，Check malicious dependencies 可以替换为包管理器的审计命令。Analyze code 与 Check TODO 在 IDEA 里分别依赖 inspection 与 TODO filter，在 VS Code 里落到 diagnostics 与自定义扫描，Run Configuration 则对应 tasks API。

结论是 commit checks 只能做到形似，做不到等价。设计上应把它定义成「提交前钩子面板」，允许挂任意 task 或命令，同时保留 IDEA 六项检查的快捷入口；能跑通的跑通，跑不通的项显示为不可用而不是隐藏。

## 六、性能模型与提交卡死的归因

「提交卡死」是复合症状。按等待对象可以分成四类，排查顺序也应当按这个顺序。

### 等待对象的四种分类

第一类是 Git 本身慢，大仓库的 status 与未跟踪文件扫描、提交前的 hooks 执行、签名与压缩都属此列。第二类是有等待但没有反馈：内置 Git 默认 `git.useEditorAsCommitInput` 为 true【11】，提交消息为空时不会像命令行那样报错，而是以另一种方式继续等待；GPG 签名需要交互式密码，在没有 TTY 的子进程里同样会静默挂起；凭据助手等待输入也会卡住。这类症状最容易被误判成卡死，因为界面既没有错误也没有进度。第三类是主线程阻塞：VS Code 扩展宿主是单线程 Node 进程，一次同步的子进程调用或一次大 diff 的字符串处理就能冻结整个窗口的交互。第四类是双 provider 争抢 index，内置 Git 与第三方扩展同时读写同一仓库的 index，会造成状态闪烁、互相覆盖与重复刷新。

社区反馈支持这一判断：使用 IDEA 风格 VS Code 扩展的用户报告，多仓库、多 worktree 场景下首次加载提交记录时「等了好一会儿」，并有扩展因行内 blame 持续请求而让界面轻微闪烁【23】。前者对应第二类的无反馈等待与首次全量扫描，后者对应第三类的重复计算与重绘。

### 扩展宿主的单线程约束

进程模型是设计的第一道约束。扩展宿主内禁止 `execSync`、`spawnSync` 一类同步子进程调用，所有 git 调用走异步 spawn 并带超时与取消能力；内置 Git 至今没有暴露取消开关，`git.supportCancellation` 默认 false【11】，这一块必须自建。状态刷新用文件系统事件加去抖代替轮询，状态解析统一走 NUL 分隔的 porcelain 输出并展开未跟踪目录，同时对条目数设上限，参照内置 Git 的 `git.statusLimit` 默认 10000【11】，避免大仓库把内存打满。

反馈机制上，每条长路径都要有可见阶段：提交前先做消息校验，空消息直接提示而不进入等待；hooks 执行时显示当前钩子名称；签名或凭据阶段显示等待原因与可用的取消按钮。IDEA 的经验同样适用，提交前主动做规则校验比提交后报错更可取。

渲染性能上，大 diff 不在扩展宿主里做字符串拼接。宿主只负责按需分页地传递数据，解析与渲染尽量下沉到 webview 一侧，列表用虚拟滚动，避免万级文件的 DOM 常驻。

### 仓库侧的调优开关

仓库侧调优是补充手段而非替代。Git 官方配置里 `core.fsmonitor` 打开内置文件系统监视守护进程，`core.preloadIndex` 启用并行索引预加载，`feature.manyFiles` 启用大仓库索引格式，`core.commitGraph` 与 `core.multiPackIndex` 加速提交图与打包索引的读取【12】。这些配置的效果取决于操作系统与文件系统，不能替代架构层面的增量刷新，但在大仓库上能把 status 的基线成本压下来。

## 七、竞品格局与差异化定位

市场快照显示，IDEA 风格 Git 工具的供给并不稀缺，但规模普遍很小。下表是 2026 年 11 月 13 日通过 Marketplace 扩展查询接口与 Open VSX 接口的实测数据。

| 扩展 | 定位 | 安装量 | 最近更新 | 许可 |
| --- | --- | --- | --- | --- |
| GitLens | blame 与历史增强，不做提交工作台 | 53,900,000+【16】 | 2026-11-12【16】 | 商业 |
| mhutchie.git-graph | 提交图的事实标准，已停更 | 15,710,000+【16】 | 2021-04-05【16】 | MIT |
| k--kato.intellij-idea-keybindings | IDEA 键位移植 | 2,467,000+【16】 | 2026-09-21【16】 | 未标注 |
| WMBGmbH.intellij-git-ext | IDEA 风格集成 | 4,786【16】 | 2026-02-19【16】 | 未标注 |
| git-graph-libre | AGPL 延续分支 | 1,124【16】 | 2026-11-08【16】 | AGPL-3.0 |
| autemj.idea-like-git-graph | IDEA 风格图与提交面板 | 1,424【16】 | 2026-06-23【16】 | 未标注 |
| git-brain | JetBrains 级 Git UI，含 AI 与 MCP | Open VSX 114,217【18】 | 2026-09-30【18】 | MIT |
| ideagittool | Rebased 衍生的 IDEA 风格实现 | 759【16】 | 2026-11-12【16】 | 见第八节 |
| IntelliGit、jet-git | IDEA 风格分支与提交面板 | 仓库活跃【20】【21】 | 2026 年内仍有提交【20】【21】 | MIT |
| nifty-changelists | 纯 changelist 实现 | Open VSX 424【19】 | 2026-10-07【19】 | MIT |

头部是 GitLens 与提交图插件，二者占据历史与 blame 的心智但不解决 IDEA 式提交工作台。真正对标本项目的实现安装量都在千级甚至百级，idea-gittool 在 Marketplace 累计安装 759 次并由作者在社区周报自荐【16】【24】，说明这个细分尚未被有效占领，同样说明现有实现不构成护城河。

差异化落点由此明确：不与 GitLens 比历史深度，也不比安装量，而是把提交主线做深做稳。changelist 与部分提交这两项在现有实现里几乎都是残缺的，nifty-changelists 的 Open VSX 下载量只有 424 次【19】，Ziyaad.intellij-git-changelist 在 Marketplace 上是 57 次安装【16】，而这两项恰恰是 IDEA 用户迁移时最先察觉差距的地方。再叠加可证明的性能：给出可复现的提交反馈延迟指标与内置开关，而不是宣称快。

时间窗判断同样成立：JetBrains 已放弃独立 Git Client 并把改进回流 IDE【13】，短期内不会有官方把 IDEA Git 客户端化的动作。这既说明竞品窗口存在，也说明 IDEA 的行为基线会持续演进，需要按版本跟踪而不是一次性对标。

## 八、许可边界与合规约束

这一节决定「能不能抄」。

JetBrains 的开源许可不是纯 Apache-2.0。intellij-community 仓库当前的 LICENSE.txt 是 JetBrains Open-Source Build Terms Version 1.3，2026 年 6 月 15 日生效，其中说明所覆盖的代码受 Apache-2.0 约束，同时附加 JetBrains 的品牌与分发条款【14】。关键推论是，Rebased 这类基于 IntelliJ 平台的 Git 客户端继承的正是这份 LICENSE【15】，由它衍生的 VS Code 扩展 idea-gittool 同样携带这份 LICENSE【22】。

许可状态因此呈现三层。参考行为与交互设计不受限制。拷贝代码需要逐个确认来源：Rebased 及其衍生物受 Apache-2.0 与 JetBrains 附加条款双重约束，保留版权声明并遵守品牌条款是底线，但把代码整体搬进 VS Code 扩展属于需要法务判断的问题。自研实现是更干净的路径，只对齐行为，不复制源码，也不复制界面资源。

市场元数据本身不可靠：ideagittool 在 Open VSX 的许可字段标注为 Apache-2.0【17】，其仓库 LICENSE 却是 JetBrains 附加条款【22】，两者不一致。以仓库文件为准是唯一稳妥的做法。

另两条约束要写进发布清单。产品命名不得使用 IntelliJ IDEA、JetBrains、IDEA 等商标，扩展名与标题保持中性。JetBrains 图标的再分发条件没有取得权威条款文本，因此设计上不依赖任何 JetBrains 图标资产，统一使用许可清晰的图标。依赖白名单方面，microsoft/vscode 仓库整体为 MIT【25】，内置 Git 扩展的 `extensions/git/LICENSE.txt` 另附许可声明，可以阅读其实现思路但复制代码需保留声明；AGPL-3.0 的 git-graph-libre【16】不可作为代码拷贝源。

## 九、分层架构与技术选型

### 宿主层与视图层的职责划分

架构按四层划分，边界清楚。

宿主层负责进程与状态。GitRunner 是唯一的 git 子进程出口，集中处理并发上限、超时、取消、环境变量与凭据交互，并负责解析退出码与 stderr；注意当前内置扩展的设置项里没有暴露并发度参数【11】，并发策略需要自建。RepositoryManager 负责仓库发现，包含工作区扫描、`.git` 探测、worktree 与 submodule 边界处理，可参考内置扩展的开关组合：`git.repositoryScanMaxDepth` 默认 1、`git.repositoryScanIgnoredFolders` 默认含 node_modules、`git.detectWorktrees` 默认关闭且上限 50【11】。StateStore 维护 porcelain 状态模型、分组元数据与 index 快照。CommitEngine 负责把选中集合转成 patch、写入 index、执行提交并在失败时回滚。

视图层负责呈现。Commit 工作台是自建 webview，承载分组、勾选状态、提交消息、选项面板与进度。分支与仓库树用原生 TreeView，借其 checkboxState 与 onDidChangeCheckboxState 实现勾选语义【10】。差异视图复用 VS Code 内置 diff 编辑器，提供 HEAD、staged、local 三个虚拟文档（TextDocumentContentProvider），把 IDEA 的三方比对降维成 VS Code 能表达的形式。冲突处理优先复用 VS Code Merge Editor，由内置扩展的 `git.mergeEditor` 控制，默认关闭【11】，而不是自研三栏合并。

桥接层负责同步与注册：webview 与 TreeView 之间的状态广播、命令注册、菜单贡献点（`scm/title`、`scm/resourceGroup/context`、`scm/resourceState/context`、`editor/context`、`explorer/context`），以及状态刷新节流。

技术选型上，语言用 TypeScript（strict），构建用 esbuild，不引入重型前端框架，除非 webview 组件复杂度确实需要。git 调用层建议自建极薄封装而不直接依赖 simple-git 之类的封装库，porcelain 输出的 NUL 分隔解析、stdout 与 stderr 的分离、退出码语义都需要原样保留，封装层反而会掩盖细节。差异渲染不自己实现，交给内置 diff 编辑器。分组元数据放 `.git` 内 JSON，扩展配置放 globalState。测试重点在两处最容易出错的地方：porcelain 解析与 patch 构造；集成测试应使用临时仓库跑真实 git，覆盖 CRLF、重命名、二进制与新增文件等场景。

### 与内置 Git 的关系

与内置 Git 的关系必须在第一个版本就定下来。建议默认互斥：插件检测到内置 Git 扩展启用时，提示用户关闭内置扩展（`git.enabled`），或让插件以纯 UI 模式运行，不注册会写 index 的 SCM provider。同时所有 index 写入按仓库串行化，避免与用户手动执行的 git 命令竞争。内建 Git 已经提供了分支保护设置项（`git.branchProtection` 与 `git.branchProtectionPrompt`）【11】，这类能力应优先复用而不是重复实现。

## 十、性能预算与度量口径

性能承诺必须可度量，否则评审时无法判断。下表给出五项指标的定义与目标值。

| 指标 | 定义 | 目标值 |
| --- | --- | --- |
| 提交反馈延迟 | 点击提交到出现成功结果且暂存区刷新完成的间隔 | 小仓库 ≤ 300ms，万文件仓库 ≤ 1.5s |
| 扩展宿主阻塞 | 单次事件循环连续阻塞时长 | ≤ 50ms，且不出现同步子进程调用 |
| status 成本 | 一次全量状态扫描的墙钟耗时 | 万文件仓库 ≤ 1s，需配合 `core.fsmonitor` |
| 面板首屏 | 打开 Commit 面板到可交互的间隔 | ≤ 1.5s 出骨架，渐进填充 |
| 常驻内存 | 万文件仓库下的扩展宿主占用 | ≤ 150MB |

度量方式有三条：在扩展内提供基准面板，记录上述指标的历史分位；打开 git 的命令日志以定位慢命令，内置扩展提供了 `git.commandsToLog` 一类调试开关【11】；在真实大仓库上做定期回归，避免用玩具仓库得出乐观结论。目标值是工程目标而非实测结果，需要在第一期用基准面板标定后再修正，分位口径优先看 P95 而不是平均值。

## 十一、分期路线图与验收口径

推进顺序遵循先把提交跑通、再把提交做深、最后补外围。下表给出各期的范围与验收口径。

| 阶段 | 范围 | 验收口径 |
| --- | --- | --- |
| M0 骨架 | GitRunner、状态模型、提交面板、提交消息校验、延迟埋点 | 单仓库可完成选文件到填消息再到提交；空消息有明确提示；宿主无同步子进程调用 |
| M1 分组 | 分组元数据、勾选、Move to Another Changelist、活动组、staging area 模式与迁移 | 同一文件可分两次提交且互不覆盖；模式切换有迁移提示；失败提交可回滚 index |
| M2 部分提交 | 块级与行级选择、代码块拆分、三方比对编辑器 | 选中行可单独提交；CRLF 与二进制文件有明确边界提示 |
| M3 提交选项 | Author、Sign-off、Amend、模板、hooks 开关、commit checks 面板 | 各项落到确定的 git 参数；不可用的检查项显式标注而非隐藏 |
| M4 分支 | 分支树、常用操作、受保护分支提示、push 与拒绝提示 | 分支操作有确认与结果反馈；受保护分支不触发无提示的失败 |
| M5 外围 | 提交图、worktree、多仓库、标签 | 按使用频率决定是否进入本阶段 |

范围外的事项明确列出：AI 生成提交信息、完整的 blame 能力、Log 工具窗口的全量复刻，以及任何形式的商业化。

## 十二、风险登记与未决问题

风险按影响面排序。与内置 Git 的 index 争抢是最高风险，缓解措施是默认互斥加按仓库串行。分组元数据的存放位置在 worktree 场景下容易出错，需要用 `git rev-parse --git-dir` 统一解析。部分提交的正确性边界集中在换行符、二进制与大文件上，应以明确报错优于静默的错误结果。合并冲突体验受限于 VS Code Merge Editor 的能力上限，不宜承诺 IDEA 级三栏合并【7】。许可与商标风险见第八节，规避方式是自研实现加中性命名加自备图标。

未决问题有三项值得在开工前拍板。是否基于现有开源实现二次开发，考虑到 Rebased 系实现的许可状态与和内置 Git 竞争的问题，倾向于自研主干、只借鉴交互设计。是否与 Copilot 类能力集成生成提交信息，本轮按范围外处理，但接口层可预留。分组元数据落在 `.git` 内还是扩展的 globalState，前者可随仓库迁移但需要处理 worktree 与多 worktree 场景，后者实现简单但丢失去向。

整体来看，IDEA 的 Git 体验真正难复制的那部分已经被定位在三处：changelist 需要自建第二套状态，部分提交需要自建 patch 模型，commit checks 需要重写 IDE 专属检查的等价物。真正好复制的那部分，是 Git 命令层面的开关。而三类「卡死」里最常见的一类根本不是慢，而是等待没有反馈；只要把等待阶段显式化，即使功能尚未追平，体验也不会再被误判为卡死。

## 参考资料

1. JetBrains, "Commit and push changes to Git repository — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/commit-and-push-changes.html
2. JetBrains, "Group changes into changelists — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/managing-changelists.html
3. JetBrains, "Investigate changes in Git repository — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/investigate-changes.html
4. JetBrains, "Manage Git branches — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/manage-branches.html
5. JetBrains, "Edit Git project history — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/edit-project-history.html
6. JetBrains, "Git — IntelliJ IDEA Documentation（Settings | Version Control | Git）", https://www.jetbrains.com/help/idea/settings-version-control-git.html
7. JetBrains, "Resolve Git conflicts — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/resolve-conflicts.html
8. JetBrains, "Use Git worktrees — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/use-git-worktrees.html
9. Microsoft, "Default keyboard shortcuts reference — Visual Studio Code", https://code.visualstudio.com/docs/reference/default-keybindings
10. Microsoft, "Visual Studio Code API — vscode namespace 与 TreeView API", https://code.visualstudio.com/api/references/vscode-api
11. Microsoft, "vscode Git extension package.json（microsoft/vscode 仓库 extensions/git）", https://github.com/microsoft/vscode/blob/main/extensions/git/package.json
12. Git Project, "git-config — Git Documentation", https://git-scm.com/docs/git-config
13. JetBrains, "IJPL-72504 Make git client a standalone app — YouTrack", https://youtrack.jetbrains.com/issue/IJPL-72504
14. JetBrains, "intellij-community LICENSE.txt（JetBrains Open-Source Build Terms v1.3）", https://github.com/jetbrains/intellij-community/blob/master/LICENSE.txt
15. GitHub, "DetachHead/rebased — A git client based on the IntelliJ platform", https://github.com/DetachHead/rebased
16. Microsoft Visual Studio Marketplace, "Extension Query API（扩展安装量、版本与更新时间的查询接口）", https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery
17. Open VSX Registry, "Extension search API（扩展检索与许可字段的查询接口）", https://open-vsx.org/api/-/search?query=gitjet
18. Open VSX Registry, "git-brain/git-brain 扩展元数据", https://open-vsx.org/api/git-brain/git-brain
19. Open VSX Registry, "nifty/nifty-changelists 扩展元数据", https://open-vsx.org/api/nifty/nifty-changelists
20. GitHub, "PanAndy/IntelliGit — IntelliJ-style Git experience for VS Code", https://github.com/PanAndy/IntelliGit
21. GitHub, "zhyc9de/jet-git — JetBrains-style Git visualization for VS Code", https://github.com/zhyc9de/jet-git
22. GitHub, "PGshen/vs-idea-gittool — IdeaGitTool VS Code 扩展", https://github.com/PGshen/vs-idea-gittool
23. V2EX，《复刻 JetBrains 的 Git 客户端做成 VS Code 插件发布到插件市场了》，https://www.v2ex.com/t/1252622
24. GitHub, "ruanyf/weekly issue #13048 — 【工具自荐】IdeaGitTool", https://github.com/ruanyf/weekly/issues/13048
25. Microsoft, "microsoft/vscode LICENSE.txt（MIT License）", https://github.com/microsoft/vscode/blob/main/LICENSE.txt
26. JetBrains, "Use tags to mark specific Git commits — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/use-tags-to-mark-specific-commits.html
27. JetBrains, "Undo changes in Git repository — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/undo-changes.html
28. JetBrains, "Log tab — IntelliJ IDEA Documentation", https://www.jetbrains.com/help/idea/log-tab.html
