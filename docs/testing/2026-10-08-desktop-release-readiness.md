# 桌面安装包发布检查

日期：2026-10-08（Asia/Shanghai）。首次检查代码：`4ab1a832b8d3ecc783647a72af9171c87f883c3f`。下方首次检查作为历史保留；最新修复证据及仍未通过的门禁见文末追加记录。

## 仓库同步结果

当前本地桌面工具已经成为 GitHub `main` 的内容。通过 `ours` 合并保留旧远程历史，并以普通、非强制推送更新主线；合并后的文件树与 `f28c79bf761ae537aa3e0565150bffbaa4d8d87d` 完全一致，没有混入旧在线平台代码。

- `codex/legacy-platform-remote-2026-10-08` 保存旧远程主线 `d5731909a07c6b24d4450989ab325b6d0ca8bc8f`。
- `codex/legacy-platform-backup` 保存已有本地旧平台备份提交 `68bc0f00cdffcf3eee89ab0854d248916eeee7c4`。
- 原旧平台工作树及其未提交文件未修改；Git 推送不包含未提交文件。
- GitHub Releases 当前没有发布版本，本次尚未创建安装包、发布标签或 Release。

## 本次验证及其限制

| 检查 | 结果 | 可以证明的范围 |
| --- | --- | --- |
| `npm test` | 45/45 通过 | 当前测试覆盖的存储、替身网关、部分权限及源码契约；包含真实 Pi 空工具会话创建，不包含真实供应商回复 |
| `git diff --check` | 通过 | 差异的空白检查，不是安全审计 |
| `git ls-remote --heads origin ...` | 主线及两份备份 SHA 已核对 | 推送成功，不代表应用发布成功 |
| 对当前源码进行常见密钥模式检查（仅列匹配文件名） | 未匹配 | 不是完整历史扫描，也不能证明不存在秘密 |
| `npm audit --omit=dev --json` | 失败，1 项 high | Pi 的间接依赖 `brace-expansion` 有未修复拒绝服务告警 |
| `gh secret list` / `gh workflow list` | 本次查询均无条目 | 当前未配置可见的签名 Secret 或当前主线构建工作流；不是签名验证 |

未使用真实 API Key，未发送真实案件，未执行任何平台安装/卸载验证。本次没有重新运行 Electron 界面测试。

## 发布阻断项

1. **真实 Pi 调用链不匹配。** `createNoToolSession()` 返回 `{ session, dispose }`，默认网关却在外层对象查找 `prompt()`；默认文本请求会报 `Model session is invalid`。即使调整对象，当前只传递 `payload.prompt`，还没有证明附件和授权历史实际进入会话。
2. **附件确认存在重读差异。** `confirmOutbound()` 先准备 payload，再调用会重新准备的 `previewOutbound()`；被比较的快照与返回的 payload 可能来自不同读取。须只比较实际将发送的同一份内容，并深冻结。
3. **本地读取未实际复核哈希。** 主进程读取文件后仍返回清单的 `sha256` 和 `bytes`，不能发现副本篡改；还缺少读取前大小、严格编码及链接边界验证。
4. **PDF 文字提取尚未实现。** 主进程对 PDF 返回空 `pages`，所有真实 PDF 都无法发送；替身 pages 的单元测试不能证明解析功能存在。
5. **上下文及生命周期不完整。** 渲染器未提供历史消息 ID，连续对话没有实现已批准的上下文语义。敏感段授权、取消、重复确认及单次请求生命周期需要行为测试。
6. **网络与凭据边界待验证。** Endpoint 仅检查字面主机；DNS、IPv6、重定向和 Pi 全局配置读取未完整验证。图片走另一条 fetch 路径，能力/授权/超时/大小控制尚未与 Pi 路径统一验收。Provider 显示名称的 HTML 插入需改成纯文本。
7. **运行依赖存在高危告警。** 需修复 `brace-expansion` 的已公告拒绝服务问题，锁定依赖并重新运行测试与审计；不得以关闭工具为由勾选依赖门禁通过。
8. **安装包及三平台证据缺失。** 尚无打包配置、产物内容检查、原生安装验证或签名。Windows 本机启动记录不能代表 macOS/Linux 支持已经通过。

结构化证据链、用户导出、知识库检索与具体举报渠道引导仍是未完成的产品能力，不应出现在已发布功能清单中。Pi 文件、终端、自治能力保持禁用。

## 后续验收条件

修复时使用合成材料和受控供应商替身，按已批准的对话优先设计补足行为测试，再验证原生 Pi 请求。安装包发布方式需确认后单独制定实施计划；创建构建产物不自动等于允许公开 Release。任何预发布也必须如实列出功能、平台、签名及测试限制，不应用于真实敏感案件。

## 追加：预发布修复检查（2026-10-08）

代码提交：`2973aa7`（不可变确认）和 `05304ea`（隔离 Pi 发送）。本节替代上文对应阻断项的当前状态，不删除首次检查结果。

### 已修复并有受控测试证据的部分

- **原阻断项 2：确认重读差异已修复。** 确认只准备一次内容；预览比对同一 payload；消息、图片 URL、PDF 页码数组递归冻结。独立合成测试先观察到失败，再验证修复。目标测试 8/8。
- **原阻断项 1：默认 Pi 适配器已修复。** wrapper 暴露可调用的 `prompt()`；已批准的历史、当前提示及来源标记的材料文本实际进入真实 Pi 会话。图片不再绕过 Pi 走另一条 fetch 路径；未显式启用图片能力时拒绝。
- **原阻断项 5/6 的部分生命周期和配置边界已修复。** 凭据使用显式空、禁止持久写的存储及运行期内存 Key；不把 Key 放在 provider 配置解析中。资源/会话共享内存设置，关闭重试、压缩、预热、图片自动调整和遥测，屏蔽项目指令与 cwd 系统元数据。失败、取消、截断、空回复或工具调用不能作为成功回复；意外工具调用不触发第二次模型请求。取消传至 Pi；清理兼容同步 dispose。

| 检查 | 最新结果 | 限制 |
| --- | --- | --- |
| `node --test app/agent/*.test.mjs` | 19/19 通过 | 真实 SDK/runtime/session；在 provider event-stream 边界使用受控替身 |
| `npm test` | 60/60 通过 | 本机 Node v25.8.2；Node 24 与三平台尚未实测 |
| `git diff --check` | 无空白错误 | Git 提示 LF/CRLF 转换，不是平台兼容或安全验收 |
| `npm ls brace-expansion` | Pi 0.87.1 → minimatch 10.2.6 → brace-expansion 5.0.9 | 漏洞依赖仍实际存在 |
| `npm audit --omit=dev --json` | 仍有 1 项 high | 依赖门禁未通过 |
| 安装、界面、真实供应商 HTTP/SSE、Release | 本次未执行；GitHub 查询仍无 Release/工作流 | 不声称发布完成 |

集成测试禁止非受控 fetch，使用合成 Key 和材料，不发送真实案件。源标记 PDF 文本是测试提供的提取结果，并非真实 PDF 解析。字面回环地址测试已改名，避免把它误读成重定向验收。

### 依赖修复失败检查点

已尝试根级 `brace-expansion: 5.0.12` override、`npm install`、`npm update brace-expansion --ignore-scripts`；三者均未替换 Pi 子树里的 5.0.9。`npm audit fix --dry-run --ignore-scripts --json` 也提出零项修改并保留告警。Pi 发布包自带 `npm-shrinkwrap.json`，应用 lockfile 的对应条目标记 `hasShrinkwrap: true`。无效 override 和安装引起的附带 lockfile 元数据变化已撤回；没有使用 `--force`，没有升级 Pi/Electron。

后续须单独审阅 SDK 升级或可复现的上游修补策略，并在干净安装中证明漏洞版本不再存在；仅手工改本机 node_modules 或让 audit 输出消失均不算修复。当前不能将 Task 3 或依赖门禁勾为通过。

### 仍阻挡公开 Alpha 的事项

1. 主进程必须实算读取材料的哈希/大小，补齐读取前限额、严格 UTF-8 和路径/链接边界。
2. 真实 PDF 提取仍未实现；不把合成 pages 测试描述为支持 PDF。
3. 渲染器上下文 ID、逐项敏感来源授权、并发会话写入、输入清理和旧记录迁移仍未验收。
4. UI 取消的 requestId 时序、重复确认、IPC sender 验证仍未修复。Pi 层取消通过不等于用户点击取消已通过。
5. DNS/IPv6、重定向、总体超时和请求大小限制仍未验证；provider 名称的 HTML 插入仍需纯文本处理。
6. 系统凭据边界仍需三平台验证，尤其 Linux 不得把 `basic_text` 等弱后端当作安全存储；不能声称案件存储已全盘加密。
7. 生产依赖 high 告警未解决；尚无打包配置、内容清单检查、签名、公证或三平台安装/卸载证据。

结构化证据链、用户导出、知识库检索、具体举报操作引导仍是产品目标，不是当前已交付能力。文件、终端与自治工具继续禁用；所有 Desktop Gate 总项继续保持未通过。

三平台包装的书面范围见 `docs/superpowers/specs/2026-10-08-desktop-alpha-release-design.md`。用户已回复“确认”，书面范围获批准；独立 Pi 依赖策略尚未批准，包装实现仍需等待前置门禁。源代码推送与安装包公开发布分开记录。

## 追加：Pi 候选包只读评估（2026-10-08）

本轮只查询 npm registry，并用 `npm pack --ignore-scripts` 将候选发布包下载到独立临时目录，读取归档文件和接口源码；没有安装或运行候选 SDK。应用的 `package.json`、`package-lock.json` 和 node_modules 均未变更，当前 Pi 仍为 0.87.1。本轮没有重新执行测试；上节 60/60 的证据不能移用于新版本。

### 可核对的发现

| 候选发布包 | 发布日期（包内 changelog） | 实际包含 shrinkwrap | manifest 的 brace-expansion | Node engines |
| --- | --- | --- | --- | --- |
| Pi 1.0.4 | 2026-10-05 | 否 | 精确 5.0.12 | >=22.19.0 |
| Pi 1.1.0 | 2026-10-07 | 否 | 精确 5.0.12 | >=22.19.0 |

下载字节的 SHA-512 与 npm registry integrity 相同：

- 1.0.4：`sha512-+956nfMFHr5lDUVY/2Q4k+YzojzBuCaBXFgj0eSlXVGr7QVliVddKdc1Pz6yVg1dOlJQmb67doOVrlMsIcIdaw==`。
- 1.1.0：`sha512-SeEi/4hdcHNgA9UWlefZl7ZZpm3dzi2OoxNjDHsBJ9o298LNOtbL4DGKgitlEj6uCTccvtw6f2hlCkTPVJ2RXg==`。

包内 1.0.1 changelog 明确记录：固定 brace-expansion 5.0.12 处理三个已公告 DoS 问题，并从 npm 发布包移除 shrinkwrap，允许库使用者覆盖间接依赖。因此存在上游修复路线，不再只有本地手工修补这个选项。包内说明、manifest 和完整性核对仍不能证明干净安装后的依赖树没有漏洞；必须另做安装与审计。

1.1.0 的发布接口仍提供 `ModelRuntime.create` 的显式 credentials、`modelsPath:null`、`refreshOnCreate:false`、`allowModelNetwork:false`，以及 `setRuntimeApiKey`、`createAgentSession`、内存设置/会话、resource loader 覆盖、prompt/abort/dispose。`modelsPath:null` 在被检查的创建源码中选择内存模型存储。这里只确认接口/分支存在，不宣称当前适配器可直接兼容。

新版本包含 `pi-mcp`、`pi-codemode` 和 `quickjs-wasi`。1.1.0 的 `tools:[]`/`noTools:'all'` 源码对 MCP 也施加空白名单；resource loader 仍有包资源解析过程。不能仅凭设置或工具展示列表判断没有项目发现、扩展副作用、子进程或额外网络访问。后续必须同时检查 active、callable 和 registered 工具为空、扩展为空，并用合成环境检测发现与副作用。

1.0.4/1.1.0 对 Pi 子包均使用 caret 范围；只固定顶层版本不会自动使子包同版或得到可复现树。后续评估必须记录实际解析版本和完整 lockfile，再用独立干净安装重放该 lockfile；不能把浮动解析结果写成已锁定或以顶层 manifest 代替实际树。

### 独立处理策略提案（后续已批准推荐路线，执行证据见文末）

1. **推荐：受控评估 Pi 1.1.0。** 在应用副本的独立临时评估目录中固定顶层 1.1.0，记录实际依赖与 lockfile；先进行无安装脚本的依赖审查，再运行受控兼容测试。补充零可调用/注册工具、无全局/项目资源发现、无凭据持久化与额外请求的回归。不得启用 MCP、codemode、文件/终端或自治能力。只有干净安装审计无未处置生产 high/critical 且原有与新增隔离测试全部通过，才将已验证的依赖变更纳入 main。若需要改变现有 API/会话适配器，须先给出失败测试和针对性修复；不因测试失败改弱断言。此路线利用已发布上游修复，代价是跨版本兼容审查；不宣称评估一定成功。
2. **备选：维护 0.87.1 的可复现修补分发。** 需固定上游来源/完整性、修补依赖锁和发布包、审核许可证并维护与原包差异；独立干净安装及同等回归仍不可省略。当前未验证这条路线，不手改本机 node_modules、不继续采用已证明无效的根 override。维护成本高于采用现有上游修复，不推荐作为首选。
3. **备选：保留当前依赖并暂停发布。** 不增加 SDK 迁移风险，但生产 high 告警保留，不能生成对外 Alpha 资产；等待后仍须审阅与验证修复。

推荐路线的批准仅允许受控依赖评估及通过门禁后的定向修复，不授权扩展 agent 权限、自动升级 Electron、创建公开 Release、使用真实案件或真实 API Key。独立策略确认后先制定该子项目的精确实施计划；材料读取、历史/IPC/网络/凭据边界分别规划，全部结案后才规划打包。

## 追加：Pi 1.1.0 受控评估与采用（2026-10-08）

用户回复“同意”批准上述推荐路线。按 `docs/superpowers/plans/2026-10-08-pi-dependency-evaluation.md`，先在独立应用副本中评估，再用第二个独立目录重放锁文件，全部子门禁通过后采用到本地优先 main。上文“Pi 0.87.1”“high 未解决”“策略待批准”等表述保留为历史检查点；本节是当前依赖状态。没有修改旧平台工作树或两份备份分支。

### 实际解析树与复现证据

| 检查 | 当前结果 | 证明范围 |
| --- | --- | --- |
| 顶层 Pi / 实际 Pi 子包 | coding-agent、agent-core、ai、chord、codemode、mcp、telemetry、tui 均为 1.1.0 | 实际 lockfile 与安装树；子包不是仅凭顶层 pin 推断 |
| 漏洞依赖 | brace-expansion 5.0.12；balanced-match 4.0.4；minimatch 10.2.6 | 实际树不再包含先前的 5.0.9 |
| Electron | manifest 与原 lock 条目仍为 44.4.5 | 没有升级 Electron；不是原生运行验收 |
| 原有测试在候选中 | 未改动时 60/60 | SDK 迁移基线，未以削弱断言换兼容 |
| 最终全套 / Agent 专项 | 主线 Node v24.21.0：64/64、23/23 | Windows x64；真实 SDK 与受控 event-stream 替身 |
| 候选 / 第二目录 / 主线 | 均通过全套 64/64；候选也在原 Node 25 下通过 | 两次干净安装与主线重装；不证明另外三个原生目标 |
| 生产和完整 audit | 候选、重放、主线均为 0 项告警 | 当前 npm 公告匹配结果，不是供应链无风险证明 |
| 锁文件重放 | 固定 Node 24 的 `npm ci --ignore-scripts --no-fund` 成功，ci 前后锁字节不变 | 未执行生命周期、未自动下载 Electron 原生运行时 |
| 实际安装树比较 | 候选、重放、主线去掉顶层 path 后，规范化 `npm ls --all --json` SHA-256 相同 | Windows 当前解析/安装结果；不是跨平台二进制相同声明 |

采用的 lockfile SHA-256：`1b33de2e83af2d58f569ef477e8abdbdb2c1160d92f17c82112b1f500990aa90`。
规范化安装树 SHA-256：`82cd413072db057250023e044295e3ee17ddce23592b709cc4e233645e2783d3`。

Node v24.21.0 来自官方 `https://nodejs.org/dist/v24.21.0/` 的 Windows x64 ZIP；执行前与同版本 SHASUMS256.txt 匹配，ZIP SHA-256 为 `158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541`。这只是官方清单完整性核对，没有验证发布者签名；没有全局更换系统 Node。

新锁有 154 个 packages 条目（含应用根），完整审计元数据统计 153 个依赖，Windows ci 实际安装 128 个包。旧 Pi shrinkwrap 被移除后出现大量 hoist/路径变化；不是只替换一个间接依赖。实际版本变化也包括 openai 6.40.0→7.19.0、上游供应商/AWS/Smithy SDK、ws、gaxios、google-auth-library 和类型包；新增 pi-mcp、pi-codemode、quickjs-wasi 3.6.2。全部来源为 npm registry，锁中无 hasShrinkwrap；完整变化由提交的 lockfile 保留。没有新增应用 provider 功能、MCP/codemode 或其他工具权限。

### 生命周期与既有 Electron 运行时

安装全程禁用 scripts。锁中标记 hasInstallScript 的实际包已读取发布 manifest 与相应脚本：`@google/genai@2.21.0` 的 preinstall 是提示性 echo；`esbuild@0.28.2` 的 postinstall 会验证/安装二进制，可能走 npm/下载 fallback；`protobufjs@7.6.6` 的 postinstall 读取 manifest 并检查版本提示。本轮均未执行。实际树没有 binding.gyp；Pi、quickjs-wasi 没有安装生命周期，quickjs 分发的 WASM/原生资源仍须在未来产物清单中审阅，不能因当前未启用就宣称可安全打包。npm 对 node-domexception 1.0.0 有弃用提示，它不是本次 audit 漏洞，但不把结果描述为“完全无警告”。

Electron 44.4.5 发布 manifest 没有 postinstall；原生安装脚本须显式调用，本轮未调用。主线 ci 会移除原已安装的 native 文件，因此先将明确的 electron/dist 和 path.txt 复制到独立临时备份，ci 后仅恢复同版本原文件。73 个 dist 文件的 SHA-256 与备份逐一相同，path.txt 仍为 electron.exe；electron.exe SHA-256 为 `bd14928e0728366fd3f41499cb398ff3f4304dab259a3e605077899a6f8c748e`。这是维护用户既有运行时，不是新安装或 Electron 启动/三平台验收；未手工修改依赖源码。

### 隐式资源发现的 red/green 与隔离限制

新增真实 SDK 回归先暴露原适配器仍执行 24 次项目 .pi 资源探测；不是类型/导入错误。即使 DefaultResourceLoader 的 no-resource 开关全关，仍会发现项目路径，之后过滤不能证明没有访问。因此使用 Pi 公共 ResourceLoader 接口返回固定 prompt 和不可变空资源，不构造 DefaultResourceLoader，也不调用文件/包发现。每个会话有独立空 extension runtime；reload 不做 I/O，extendResources 拒绝非空或未知资源注入。显式传入临时空 agentDir，仍使用内存 settings/session/credentials。

三项新 loader 契约测试加一项真实 SDK 发现/副作用测试，使总测试由 60 增为 64。原测试保留其安全契约，改为检查公共接口；实际 active、callable、registered 工具和扩展全部为空，并在 reload 后复查。凭据 modify/delete 也明确验证拒绝持久写。

发现测试使用合成项目/全局 .pi、AGENTS.md、settings/auth/models 和恶意扩展 fixture；先用真实 DefaultResourceLoader 正控确认 I/O 观测有效，再观测实际适配器创建、一次受控 prompt、重载和销毁。资源访问记录为零，受控调用恰一次；阻断所列 subprocess、fetch、HTTP/HTTPS 和 socket API，没有记录到额外副作用，所有合成原件字节保持不变。SDK 和 stream helper 在 instrumentation 前已导入；该测试不是覆盖所有 import-time I/O 或整个操作系统的沙箱证明，也不替代 DNS/IPv6、重定向、HTTP/SSE、凭据后端或 Electron 验收。

### 当前结论及仍未完成的门禁

原阻断项 7 的生产依赖 high 已解决；无效根 override 路线保持失败/被替代，未改写为成功。Pi 权限没有扩大，文件、终端、MCP、codemode、独立联网与自治继续禁用。BYOK、本地持久化、仅用户确认内容送所选云供应商和原件不改的边界不变。

材料实算哈希/大小/编码/路径、真实 PDF 提取、历史敏感授权/并发迁移、UI 取消/重复确认/IPC sender、provider 纯文本显示、DNS/IPv6/重定向/超时/请求限额，以及三平台凭据和安装验收均仍未结案。知识库检索、结构化证据链、用户导出和举报操作引导仍不属于已完成能力。没有生成安装包、tag 或公开 Release；发布总门禁继续未通过。

### 源码推送收据

本轮源码与依赖变更提交为 `79277128e1344b1e2c2def7fce586cdb1ef6ca68`（`fix: isolate Pi resources and adopt audited 1.1.0 tree`），已通过普通 `git push origin main` 推送。再次查询远程 `refs/heads/main` 与该 SHA 完全一致，推送后的工作树干净。本收据与计划勾选作为后续文档提交记录，不属于上述源码提交；源码推送不代表安装包发布或剩余门禁通过。
