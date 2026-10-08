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

## 追加：材料安全验证（2026-10-08）

用户要求“推进安全验证并公开发布”。按材料安全子计划实施，不改变其余发布条件。真实文件的限额导入、storedName 越界和清单 ID 不匹配测试先在旧实现出现 `Missing expected rejection`；reader 新测试初次因模块不存在失败，不能把这类导入错误算作十项行为已复现。实现后目标测试一次出现 junction 测试的重复 teardown ENOENT；移除多余 unlink（测试临时目录统一回收）后回归通过。

固定 Node v24.21.0，Windows x64 全套 **78/78，0 fail、0 skip**，包含真实合成材料在预览后被等长篡改、最终确认拒绝的集成测试；主进程委托契约仅为源码检查，不是 Electron IPC 运行测试。材料读取在打开前/后校验文件类型、链接、identity、大小和变更时间，受限 handle snapshot 实算 SHA-256/长度；清单和目录校验防路径逃逸，文本严格 UTF-8。导入用同一 snapshot 写独立 UUID 副本，源文件不变。Windows junction 和硬链接测试实际创建并被拒绝。

单文件/清单限额 2 MiB，最多 1024 个材料；空文件、超限及硬链接源拒绝。旧超限清单现在拒绝读取，不自动删除或迁移。PDF/未知格式明确拒绝发送；图像只检查 PNG/JPEG/GIF/WebP 格式签名，未做完整解码或像素限额验证。本次应用检查不是针对同用户恶意并发进程的操作系统沙箱。依赖未改，本次未重跑 audit/干净安装。

原阻断项 3 的上述读取边界已修复。IPC sender、凭据后端、请求生命周期、敏感历史/并发迁移、网络控制和四目标安装验收尚未通过；未创建安装包、tag、Actions 或公开 Release，发布总门禁仍未通过。

## 追加：IPC 与凭据应用边界（2026-10-08）

执行 `2026-10-08-ipc-credentials-safety.md`。旧主进程在 foreign sender、subframe/remote document、导航策略和 Linux basic_text 四项测试失败（前三项为缺少拒绝/导航 preventDefault，Linux 为错误允许保存）。旧 Provider 并发保存发生 Date.now 临时文件 EEXIST；畸形元数据、URL userinfo/query/fragment 都未拒绝。新 secret-store 初次为缺少模块错误，不作为原凭据六项行为复现证据。

现在所有 IPC 统一校验 live window/webContents、同一 mainFrame 和精确本地文档；导航/重定向、弹窗、webview、下载、权限请求/检查拒绝。操作错误以固定消息返回，不转发可能回显 Key/提示词的原始错误。窗口关闭中止请求，macOS activate 可重建窗口。实际 main 源在 Node VM 中执行，Electron 原生界面边界使用 interface double；不是 Chromium/安装验收。

Key 存储显式拒绝 unavailable/basic_text/未知 Linux 后端；只接受 gnome_libsecret/kwallet/kwallet5/kwallet6。ciphertext 编码/条数/限额校验；strict UTF-8、single-link regular file、canonical directory、随机 UUID 临时文件和 0600 权限；进程内按规范 root+文件队列串行，多个 store 实例/重启不会丢失不同 Key。Provider 元数据同样 bounded/normalized/串行，拒绝 URL 用户名密码/查询/fragment 和超长或控制字符 Key，公开返回 hasKey 而非秘密。共享 local-json 模块仅实现受限 JSON I/O 和串行化。metadata 与 ciphertext 跨文件更新不是 crash-atomic transaction，失败可能留下孤立加密记录；不声称 Key 和案件统一加密。

固定 Node v24.21.0 Windows x64 全套 **93/93，0 fail、0 skip**；VM 默认动态导入器有 Node ExperimentalWarning，保留可见，不隐藏诊断。凭据 encrypt/decrypt 使用合成 native double，只证明应用边界，不证明 Windows/macOS/Linux 的 OS 后端可用。依赖没有变，本轮未运行 audit 或原生 Electron。剩余：历史/迁移/并发会话、用户取消与重复确认、图片解码、DNS/IPv6/重定向/HTTP/SSE/总限额、四目标安装验收；发布总门禁仍未通过。

## 追加：历史存储与外发来源授权（2026-10-08）

执行 history-safety 子计划。初始九项测试复现并发丢消息、字段未过滤、来源洗白、linked record、逐项授权/正文预览/限额缺失；迁移初次为缺方法错误，不作为已有迁移行为漏洞证据。补充测试进一步复现损坏为 null 的旧记录被当作缺失、损坏目标被覆盖，以及控制字符来源未拒绝。最后一项附件数量测试初次先在缺 context 路径失败，后半附件断言不算独立 red 证据。

现在记录按文件队列串行、严格 normalized whitelist、4 MiB/1024 条限额、单链接和 canonical 路径校验。旧记录迁移保留 ID、source 字节不变、幂等；损坏 source/target 拒绝，累计来源保守传播。每条消息继承 segment 全部来源；外发历史必须逐项选中所有来源，未授权时在材料读取前拒绝。预览数据包含实际正文和来源；prompt <=20000 字符、历史 <=40 条、附件 <=16，聚合 JSON <=2 MiB 或更小 Provider 上限。

固定 Node v24.21.0 Windows x64 全套 **107/107，0 fail、0 skip，exit 0**。真实 main 源的迁移 handler 在 VM/native interface double 下验证，不代表 Electron 安装运行。队列仅进程内；conversation 未加密；聚合 JSON 是保守应用限额，不是最终 HTTP wire body 限额。确认 UI 尚未展示 contextMessages，连续对话选择、single-use receipt/重复发送/及时取消、网络传输、图片解码及四目标安装仍待验证。本轮未改依赖、未跑 audit、未生成安装包/tag/Release。

## 追加：单次确认、请求生命周期与界面（2026-10-08）

执行 request-lifecycle-safety 子计划。新 lifecycle/appendExchange 初始为模块或方法缺失，不能算旧行为漏洞复现。实际旧 renderer 在动态 Provider HTML、重复点击、取消确认未丢弃回执三项行为失败；接入后进一步复现取消回执覆盖最终 unknown 的竞态，以及 delivered 后刷新失败清空草稿并误报 unknown。修复后保留最终状态；只有成功刷新才清草稿，已保存但刷新失败明确提示不要重复发送。真实 HTML 补齐停止按钮，DOM double 不再偷偷补不存在的控件。新增超限草稿测试先错误触发不完整 fixture，修正 fixture 后确认旧实现未拒绝，再实施限额。

主进程签发五分钟有效的单次随机回执；确认覆盖正文、来源、接收方、endpoint/model 及内部 Key/payload/revision 绑定。开始同步消费回执并返回 ID，再重验证；配置或内容改变时不调用模型。同会话只一请求，最多32回执/8活跃/64已完成结果，预览准备最多8并发；输入256 KiB、深度16和节点20000限额。send 使用冻结的首次 provider/payload，不重新读取可变配置。调用前取消为 cancelled；调用后取消、超时、保存失败为 unknown，不保存部分结果、不自动重试；整次 delivered 只在单次 bounded 文件写入成功后返回。关闭窗口使回执失效并中止可取消请求；落盘阶段不声称可撤回。

界面在预览前锁定会话/配置/附件操作；历史只选全部来源当前获授权且已完成的最多40条，确认框显示实际历史正文/来源和省略数，所有外部字段使用 textContent。取消确认/Escape丢弃回执；发送异常或不确定状态保留草稿。真实文件1023条容量拒绝整次exchange、没有只写用户半条记录的行为已验证。

固定 Node v24.21.0 Windows x64 全套 **140/140，0 fail、0 skip，exit 0**。main VM 和 renderer DOM double 是程序边界证据，不代替原生 Electron/Chromium。VM dynamic loader 的 ExperimentalWarning保留。依赖未改、未重跑audit。网络DNS/IPv6/redirect/真实HTTP-SSE/wire限额、完整图像解码、OS凭据和四目标安装验收继续未通过；没有公开安装包/tag/Release。

源码收据：`0031005c1872bf001858f5fca6dbdf6ef5d5ecde` 已普通推送并核对远程 main；不是安装包发布。

## 追加：真实 Pi HTTPS/SSE 网络传输（2026-10-08）

执行 provider-transport-safety 计划。旧网关在 literal/mapped IPv6、特殊 IPv4、URL 隐藏路由字段、远端错误原文和超长回复等新增断言失败；新增 transport 初次缺模块不算原漏洞证据，最小 stub 后六项实际断言失败再实现。真实 Pi HTTPS 路径最初尚未注入自有 fetch，17 项失败；实现后通过，并补上域名不匹配、超大响应头、公网 IPv6 DNS 固定及另一 HTTPS origin 的 redirect 检查，共 **21 项真实 Pi 网络测试**。

每次确认只允许一个 POST 到冻结 endpoint 的 chat/completions；HTTPS、DNS 全结果公网校验并固定首地址，保留原域名 TLS/SNI/Host，拒绝 private/reserved/mapped/transition 地址。无代理、redirect、重试或全局 fetch 替换；固定安全请求头，request <=8 MiB、wire <=512 KiB、headers <=16 KiB、总 deadline <=120 秒、assistant <=20000 UTF-16 单位。严格缓冲完整 SSE 再交 Pi，验证 HTTP completion、fatal UTF-8、末尾 DONE；Pi 验证正常 finish reason。取消/销毁中断 owned socket；所有远端错误固定脱敏。

测试使用真实 Pi 1.1.0、实际 Node HTTPS、真实 SSE adapter 和本机合成 TLS fixture。仅 trusted test constructor 把已通过公网断言的 TCP 目标映射到 loopback、显式注入测试 CA；TLS chain/hostname 验证仍开启。未受信 CA 与受信 CA 下域名不匹配都在 HTTP body 前拒绝。另一 HTTPS server 在 307 后收到零请求；429/500 恰一次且原错误体不回显。fixture 的私钥是公开测试数据，必须从安装包排除。测试没有使用云端生产接口、用户 Key 或真实案件；公网 IPv6 解析固定不等于实际 IPv6 网络连通性验证。

固定 Node v24.21.0 Windows x64 全套 **177/177，0 fail、0 skip、exit 0**。VM ExperimentalWarning 保留。依赖未改、此次未重跑 audit；原生 Electron 下的 UI/凭据/网络、完整图像边界及四目标安装验收尚未完成。未生成/上传公开 artifact、安装包、tag 或 Release，总门禁仍未通过。

源码推送收据：网络修复 `2f94be8d45838a91244cf258c1e90c68d9bf50d5`（`fix: bind Pi requests to bounded validating HTTPS transport`）已普通推送；原生安全后续开始前远程 main 与该 SHA 相同。

## 追加：Windows 原生应用安全验证（2026-10-08）

执行 `docs/superpowers/plans/2026-10-08-native-alpha-safety.md`，仅在新建的 `manbo-native-safety-*` 临时 profile 中使用合成材料、Provider 和 Key。测试入口在真实 main 加载前设置并核对 userData；生产 main/preload 没有测试 IPC 或 inspector 开关。没有读取/修改用户案件目录，没有使用真实供应商或 Key，没有关闭用户的其他应用。

### 新发现和 red/green 修复

1. 图片签名并不证明完整解码安全。新增真实文件拒绝测试后，删除 signature-only 接收路径；PNG/JPEG/GIF/WebP 及截断样本均明确拒绝发送，源文件与副本哈希不变。界面不再提供图片能力复选框，保存 Provider 固定 images:false。PDF 同样明确不支持；图片/PDF 的本地导入副本不等于可外发。
2. 首次说明原来只有横幅，没有显式确认。增加 first-use dialog、版本化本地 marker 与初始化/发送门禁；localStorage 不可用时仍须确认且下次再显示。Chromium 的 Escape cancel 可为 noncancelable，事件 preventDefault 不足以保留说明；源码契约先失败，再加 `closedby="none"`，原生 Escape 无法关闭而显式按钮可以。
3. 附件确认原来仅显示名称/大小。新增测试先因缺少 attachmentParts、缺少完整正文失败；预览现在复用实际 payload 的冻结 parts，不重读文件。renderer 用 textContent 显示完整来源标记正文与 SHA-256，不截断、不执行材料 HTML；修改 preview 正文会使确认失效。原生 UI 预览与真实 Pi 最终 wire 当前正文一致（Pi 合并 prompt 和 attachment text 时插入两个换行），两条授权历史也逐项一致。
4. 原生子框架没有 Node 或应用桥，但 data: 内嵌文档仍能加载，不能把 will-frame-navigate handler 当作全子框架禁用证明。CSP 契约先失败，再加 `frame-src 'none'`；原生记录到对应 securitypolicyviolation，子文档成为 chrome-error 页面。子框架 sender 拒绝的调用证据仍来自 VM；没有虚称原生子框架实际发起过应用 IPC。

### 原生证据及范围

| 检查 | 实际结果 | 限制 |
| --- | --- | --- |
| 环境 | Windows 11 专业版 10.0.22621 / build 22621 x64；Electron 44.4.5、Chromium 152.0.7977.130、内嵌 Node 24.21.0 | 开发入口运行，不是 NSIS 安装验收或 Windows 10 证据 |
| 实际窗口隔离 | sandbox/contextIsolation/webSecurity=true；nodeIntegration/nodeIntegrationInSubFrames/webviewTag=false；renderer require/process/ipcRenderer 未暴露 | 应用隔离证据，不是操作系统全沙箱证明 |
| 导航与 IPC | 主窗口 data: 导航/window.open 拒绝；同本地页/preload 的外来真实窗口调用 listProviders/listCases/createCase/listConversations 均被 Untrusted IPC sender 拒绝；内嵌文档由 CSP 拒绝 | 子框架没有应用桥；sender invocation 拒绝另有 VM 测试 |
| Provider 与凭据 | 恶意显示名以文本呈现，hasKey 元数据不回传 Key；真实 safeStorage 可加解密，密文文件不含合成 plaintext，重启同 profile 可解密 | Windows API 没有返回 Linux backend 名称；不能写成三平台凭据验证或案件加密 |
| 普通对话/取消确认 | 无需案件，无附件/历史请求；取消 preview 不发请求、回执失效、草稿保留 | 不代表举报渠道导航已交付 |
| 真实 Pi 合成 HTTPS/SSE | 普通及附件请求分别单次 POST，公网解析固定、TLS 验证保持、tools absent、store:false；附件导入/选择/预览不发请求；成功时 user+assistant 成对保存 | 仅 test-only 模块 redirect 注入合成 CA 和 TCP loopback remap；真实 gateway/Pi/transport/lifecycle 未替换；不是生产云接口验证或供应商零留存承诺 |
| 敏感历史 | 取消选择附件后，另一次请求不带两条敏感历史或旧材料；重新选定附件的确认框包含实际全文及两条授权历史 | 每次发送都需确认，不开放连续自治工具 |
| 慢流取消 | 一次 POST 后 UI 标为 unknown，草稿保留，部分回复不落盘，owned connections 归零，原件哈希不变 | 已到达供应商的数据无法撤回，不自动重试 |
| 最终重启 | 案件四条 delivered 消息、普通对话两条消息恢复；Key 解密匹配；notice marker=accepted；network fixture 尚未加载；源/副本哈希不变 | 同一合成开发 profile；不是安装升级/卸载验证 |

合成文本 153 bytes，源文件与副本前后 SHA-256 均为 `c0d1c25bb8edadd6b87f1a22a721bf38b78bff5dcbb829357f64071239eca663`。最后两个测试进程均正常退出（exit 0），只关闭 `manbo-native-safety` 命名 browser session。临时 profile 仅含合成验收数据，不纳入源码或任何发布资产。

固定 Node v24.21.0 全套 **184/184，0 fail、0 skip、exit 0**；本轮未改依赖，重新执行生产与完整 `npm audit --json` 均 **0 项告警**、exit 0。`git diff --check` 通过，LF/CRLF 提示不是测试失败；VM ExperimentalWarning 保留。audit 只反映当前公告，不等于无供应链风险。

### 当前交付阻断项（不由上述结果豁免）

| 目标 | 安装包与系统验收 | 凭据/隔离 | 签名状态 |
| --- | --- | --- | --- |
| Windows NSIS x64 | 未构建、未安装/卸载；不能用开发启动代替 | 只有上述 Windows 11 开发入口证据，需安装包复验 | 未配置发布签名 |
| macOS DMG x64 | 未构建、未挂载/启动/移除 | 没有 Intel 原生验证 | 无签名/公证配置 |
| macOS DMG arm64 | 未构建、未挂载/启动/移除 | 没有 Apple Silicon 原生验证 | 无签名/公证配置 |
| Linux AppImage x64 | 未构建、未启动/移除；未记录发行版/桌面要求 | 未验证真实 gnome_libsecret/kwallet；basic_text 必须拒绝 | 未做发布者签名 |

GitHub 只读检查仍为：Release 列表为空、可见 Secret 列表为空、自托管 runner 数量为零。自托管 runner 数量不代表 GitHub 托管构建 runner 不可用；但托管 runner 的构建成功也不能代替目标系统的安装、正常启动和凭据验收。签名证书、Apple 公证资料及目标验收环境需另行提供/协调，不把它们硬编码进项目。

Windows 应用层子门禁已取得上述行为证据，**Desktop 发布总门禁仍未通过**。尚未引入 electron-builder、Actions workflow 或任何自动更新器；没有生成/上传公共 artifacts、tag 或 Release。ASAR 实际运行资源白名单、完整产物秘密/内容检查、许可证及四目标安装验收仍是包装阶段的必做项，不能仅凭配置声明通过。未签名候选可以在本机准备，但若系统防护阻止启动，不得绕过或记为正常安装通过；四目标须一起验收，不悄悄改为 Windows 单平台公开完成。

Pi 文件/终端/MCP/codemode/自治/自动举报仍关闭；没有增加材料托管。知识库检索、结构化证据链、用户导出、举报操作引导仍未交付。首次说明准确区分本地记录、系统 Key 加密和用户云供应商处理，不使用“全部本机执行”或“无额外信息保护责任”作为免责承诺。

原生应用安全源码收据：`a4c97b187d0cc1f5b62a032912f943f7f21a9fbe`（`fix: close native preview and document boundaries for Alpha`）已普通推送；`git ls-remote` 核对远程 main 完全匹配。收据和计划结案记录属于后续文档提交，不能倒称已包含在该源码提交中。只读查询 electron-builder 26.15.3 的 registry 元数据（MIT、Node >=14），尚未审阅/采用其实际依赖或执行脚本；应用 manifest、lockfile、依赖保持原状。
