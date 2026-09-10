# Proxmox 家庭服务器部署实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** 在纽约家庭网络中的 Proxmox VE 上建立一个隔离的 Manbo 私有 staging 运行环境，并为后续 GitHub Actions 自动发布准备安全边界。

**Architecture:** 在 Proxmox 中创建独立 Ubuntu Server VM，不直接使用 Proxmox 宿主机。VM 内运行 Node.js/Next.js、PostgreSQL、加密本地材料适配器和材料 worker，Caddy 负责 HTTPS 反向代理。初期功能 staging 仅允许局域网/VPN 访问、使用 mock AI 和测试材料；路由器 DDNS 只做解析验证并保留给以后通过发布门禁的公网环境，不能把 development 服务直接暴露到互联网。

**Tech Stack:** Proxmox VE、Ubuntu Server 24.04 LTS、Node.js 22.14.0、pnpm 11.24.0、Next.js 16、PostgreSQL、Caddy、systemd、GitHub Actions。

## Global Constraints

- 不在 Proxmox 宿主机运行应用；使用独立 VM。
- 不使用 Docker；使用 systemd 管理 Web 和材料 worker。
- 不把 PostgreSQL 5432、Proxmox 8006、SSH 22、Next.js 3000 或 development 服务暴露给公网。
- 当前仅部署私有 staging；不接收真实举报材料，不宣称生产就绪。
- `NODE_ENV=development` + `AI_PROVIDER=mock` + 本地材料适配器只用于局域网/VPN staging；它不能通过 DDNS 公网开放。生产不能使用 mock，也不能使用本地对象存储替代真实 S3/KMS。
- 所有密码、私钥、数据库连接串、GitHub Secret、AI token 和材料主密钥只在服务器密码管理器/Environment Secret 中保存，不发到聊天、不提交仓库。
- 单文件材料上限 100 MB、单案件上限 2 GB；用户主动删除前无默认到期时间，备份也必须纳入删除设计。
- GitHub Actions 只从受保护的 `main` 发布；PR 和外部 fork 不得执行家庭服务器上的自托管命令。

---

## Task 1：准备 Proxmox 隔离 VM

**Files:** 无仓库修改；Proxmox 管理界面操作。

**步骤：**

1. 在 Proxmox 创建新 VM，推荐配置：
   - 名称：`manbo-staging`
   - Guest OS：Ubuntu Server 24.04 LTS
   - Machine：默认 Q35；BIOS/UEFI 与现有模板一致
   - CPU：4 vCPU，CPU type 选择 `host`
   - 内存：8 GB；低频演示可先 4 GB
   - 系统盘：80 GB，VirtIO SCSI，启用 discard/TRIM
   - 材料盘：至少 200 GB 独立虚拟磁盘；如果计划保存接近 2 GB/案件，按案件数扩容
   - 网卡：VirtIO，桥接到 `vmbr0`
   - 勾选 QEMU Guest Agent
2. 在 VM 内安装 Ubuntu，创建普通管理员账户；不要把应用直接安装在 Proxmox 宿主机。
3. 在路由器为 VM 网卡设置 DHCP 静态租约，例如 `192.168.1.50`。实际地址以你的局域网网段为准。
4. 在 VM 中确认：

```bash
ip -br address
hostnamectl
lsblk
```

**验收标准：** VM 可以从局域网访问、重启后获得同一内网地址、Proxmox 宿主机的 8006 管理界面没有做公网端口转发。

---

## Task 2：核验 DDNS，并建立私有远程入口

**步骤：**

1. 在路由器确认 DDNS 已更新到当前公网地址，记录完整主机名，例如 `你的路由器提供的主机名`。
2. 在外部网络（手机关闭 Wi-Fi）查询 DNS：

```powershell
nslookup 你的-DDNS-主机名
```

3. 此阶段不要创建任何公网端口转发。关闭路由器 UPnP；确认 IPv6 入站防火墙也没有默认开放 VM。
4. 永远不转发 TCP `22`、`5432`、`8006`、`3000`。DDNS 只记录和验证，不用于公开 development 服务。
5. 比较路由器显示的 WAN 地址与外部查询到的地址。如果是私有地址（例如 `100.64.0.0/10`、`10.0.0.0/8`、`192.168.0.0/16`），说明可能处于 CGNAT；这不影响通过 Tailscale/WireGuard 建立私有访问。
6. 推荐在 VM 和你的管理电脑安装 Tailscale，使用同一个受 MFA 保护的 tailnet。VM 端执行官方安装脚本后运行：

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh=false
tailscale status
tailscale ip -4
```

7. 在 Tailscale 管理控制台启用设备审批、MFA/SSO，并设置 ACL：只允许你的管理设备访问 `manbo-staging` 的 TCP 443；SSH 保持走局域网，或另行在 ACL 中只允许管理设备访问 TCP 22。

**验收标准：** DDNS 在外部网络能解析到家庭公网地址；路由器没有面向 VM 的公网端口转发；管理电脑通过 VPN 可以访问 VM；Proxmox、SSH、PostgreSQL 和 Next.js 均不存在公网路径。

---

## Task 3：安装系统依赖并建立应用账户

在 VM 的 Ubuntu 终端执行：

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y ca-certificates curl git rsync ufw fail2ban \
  postgresql postgresql-contrib caddy unattended-upgrades
sudo adduser --disabled-password --gecos "" manbo
sudo install -d -o manbo -g manbo -m 0750 /srv/manbo
sudo install -d -o manbo -g manbo -m 0700 /var/lib/manbo/materials
sudo install -d -o root -g manbo -m 0750 /etc/manbo
sudo timedatectl set-timezone UTC
```

启用自动安全更新：

```bash
sudo dpkg-reconfigure -plow unattended-upgrades
sudo systemctl enable --now fail2ban
```

**验收标准：** `id manbo` 成功；`systemctl is-active postgresql` 返回 `active`；应用目录不属于 root 可写路径，材料目录权限为 `0700`。

---

## Task 4：配置 SSH 和主机防火墙

在你的 Windows 管理机上生成专用部署密钥（私钥只留在本机或 GitHub Secret）：

```powershell
ssh-keygen -t ed25519 -a 64 -f "$env:USERPROFILE\.ssh\manbo_home_deploy"
Get-Content "$env:USERPROFILE\.ssh\manbo_home_deploy.pub"
```

把公钥写入 VM 的 `/home/manbo/.ssh/authorized_keys`，然后执行：

```bash
sudo install -d -o manbo -g manbo -m 0700 /home/manbo/.ssh
sudoedit /home/manbo/.ssh/authorized_keys
sudo chown manbo:manbo /home/manbo/.ssh/authorized_keys
sudo chmod 0600 /home/manbo/.ssh/authorized_keys
```

先从管理机验证密钥登录成功，再写入 SSH 加固配置：

```bash
sudoedit /etc/ssh/sshd_config.d/99-manbo-hardening.conf
```

内容：

```text
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
AllowUsers manbo
```

根据你的实际 LAN 网段替换下面的来源网段，然后执行：

```bash
sudo sshd -t
sudo systemctl restart ssh
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow from 192.168.1.0/24 to any port 22 proto tcp
sudo ufw allow from 192.168.1.0/24 to any port 443 proto tcp
sudo ufw allow in on tailscale0 to any port 443 proto tcp
sudo ufw enable
sudo ufw status verbose
```

如果使用 Tailscale/WireGuard，把 SSH 规则限制到 VPN 网段，不要允许整个公网。不要关闭当前 SSH 会话，先用第二个窗口验证新连接。

**验收标准：** root 和密码登录被拒绝；LAN 密钥登录成功；VPN 可访问 443；公网不能访问 22/80/443/3000/5432/8006。

---

## Task 5：安装精确 Node/pnpm 版本

切换到 `manbo` 用户执行：

```bash
sudo -iu manbo
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
. /home/manbo/.nvm/nvm.sh
nvm install 22.14.0
nvm alias default 22.14.0
corepack enable
corepack prepare pnpm@11.24.0 --activate
node --version
pnpm --version
```

应分别看到 `v22.14.0` 和 `11.24.0`。记录 `command -v node`、`command -v pnpm`，后续 systemd 的 `PATH` 要包含这些目录。

**验收标准：** 版本符合仓库 `.nvmrc` 与 `package.json` engines；不使用系统 Node 25 或旧 pnpm。

---

## Task 6：拉取 `main` 并首次构建

仍以 `manbo` 用户执行。仓库为公开仓库，首次拉取不需要 token：

```bash
cd /srv/manbo
git clone https://github.com/ZxWang-AI/manbo.git current
cd /srv/manbo/current
git checkout main
pnpm install --frozen-lockfile
pnpm exec prisma generate
pnpm build
```

**验收标准：** `pnpm build` 成功；工作目录为 `/srv/manbo/current`；服务器没有保存 GitHub PAT。

---

## Task 7：创建私有 staging 环境变量

先生成随机值，结果只写入服务器，不复制到聊天：

```bash
openssl rand -hex 32
openssl rand -base64 32
```

创建环境文件：

```bash
sudoedit /etc/manbo/staging.env
sudo chown root:manbo /etc/manbo/staging.env
sudo chmod 0640 /etc/manbo/staging.env
```

初期局域网/VPN staging 使用以下结构；将生成值和数据库密码替换为你本地保存的值：

```text
NODE_ENV=development
APP_MODE=normal
DATABASE_URL=postgresql://manbo:只含十六进制字符的数据库密码@127.0.0.1:5432/manbo
SESSION_SECRET=至少32字节的随机值
AI_PROVIDER=mock
MATERIAL_OBJECT_STORE=local
MATERIAL_OBJECT_STORE_ROOT=/var/lib/manbo/materials
MATERIAL_OBJECT_STORE_MASTER_KEY=64位小写十六进制值
MATERIAL_OBJECT_STORE_KEY_VERSION=home-stage-kek-v1
MATERIAL_PROCESSING_QUEUE=durable
MATERIAL_PROCESSING_WORKER_ENABLED=true
MATERIAL_PROCESSING_WORKER_ID=home-stage-worker-01
```

不要在此阶段配置真实 AI Gateway 或真实用户材料。未配置 media Gateway 时，材料扫描会 fail-closed，这是预期行为。

**验收标准：** `sudo stat -c '%a %U %G' /etc/manbo/staging.env` 返回 `640 root manbo`；文件内容不出现在 shell 历史、Git 或日志中。

---

## Task 8：初始化 PostgreSQL

以 root 或具有 sudo 权限的账户执行。数据库密码使用随机、URL-safe 值，不能复制到聊天：

```bash
sudo -u postgres createuser --pwprompt manbo
sudo -u postgres createdb --owner=manbo manbo
sudo -u manbo bash -lc 'set -a; . /etc/manbo/staging.env; set +a; . /home/manbo/.nvm/nvm.sh; cd /srv/manbo/current; pnpm exec prisma migrate deploy'
```

确认 PostgreSQL 只监听本机：

```bash
sudo -u postgres psql -c "SHOW listen_addresses;"
sudo ss -ltnp | grep 5432
```

如 `listen_addresses` 不是 `localhost`，编辑 PostgreSQL 配置限制为 `127.0.0.1`，再重启服务。

**验收标准：** migration 成功；5432 只绑定本机；应用数据库用户不是 postgres 超级用户。

---

## Task 9：建立 systemd Web/worker 服务

先确认 pnpm 路径：

```bash
sudo -iu manbo bash -lc 'command -v node; command -v pnpm'
```

创建 Web 服务：

```bash
sudoedit /etc/systemd/system/manbo-web.service
```

内容（把 `PATH` 中的 Node/pnpm 目录替换为 Task 5 的实际路径）：

```ini
[Unit]
Description=Manbo private staging web
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=manbo
Group=manbo
WorkingDirectory=/srv/manbo/current
EnvironmentFile=/etc/manbo/staging.env
Environment=PATH=/home/manbo/.nvm/versions/node/v22.14.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
ExecStart=/home/manbo/.nvm/versions/node/v22.14.0/bin/node /srv/manbo/current/node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/srv/manbo/current/.next /var/lib/manbo/materials

[Install]
WantedBy=multi-user.target
```

创建 worker 服务：

```bash
sudoedit /etc/systemd/system/manbo-worker.service
```

内容：

```ini
[Unit]
Description=Manbo material processing worker
After=network-online.target postgresql.service
Wants=network-online.target

[Service]
Type=simple
User=manbo
Group=manbo
WorkingDirectory=/srv/manbo/current
EnvironmentFile=/etc/manbo/staging.env
Environment=PATH=/home/manbo/.nvm/versions/node/v22.14.0/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
ExecStart=/home/manbo/.nvm/versions/node/v22.14.0/bin/pnpm worker:materials
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=read-only
ReadWritePaths=/var/lib/manbo/materials

[Install]
WantedBy=multi-user.target
```

启用服务：

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now manbo-web.service
sudo systemctl enable --now manbo-worker.service
sudo systemctl status manbo-web.service --no-pager
sudo systemctl status manbo-worker.service --no-pager
```

**验收标准：** Web 只监听 `127.0.0.1:3000`；worker 状态为 running；worker 未配置 scanner 时不会把材料送入 AI。

---

## Task 10：配置 Caddy HTTPS

此阶段只配置 LAN/VPN HTTPS。用 `tailscale status` 中 VM 的 MagicDNS 名称替换 `manbo-staging.你的-tailnet.ts.net`；不要使用公网 DDNS 主机名，也不要做端口转发。

编辑 Caddyfile：

```bash
sudoedit /etc/caddy/Caddyfile
```

内容：

```text
manbo-staging.你的-tailnet.ts.net {
    tls internal
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
```

验证并启动：

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo journalctl -u caddy -n 80 --no-pager
```

Caddy 的 `tls internal` 会生成私有根证书。只把 `/var/lib/caddy/.local/share/caddy/pki/authorities/local/root.crt` 的公钥证书复制到你的受控管理设备并加入信任库；不要复制 Caddy 私钥目录。该证书只用于 staging，外部浏览器不会自动信任。

**验收标准：** 连接 VPN 后，`https://manbo-staging.你的-tailnet.ts.net/` 返回页面且管理设备信任证书；关闭 VPN 后不可访问；Caddy 日志不包含数据库密码或 token。

---

## Task 11：staging 功能与安全 smoke test

在服务器执行基础检查：

```bash
curl -fsSI https://manbo-staging.你的-tailnet.ts.net/
sudo ss -ltnp
sudo systemctl is-active caddy postgresql manbo-web manbo-worker
sudo journalctl -u manbo-web -u manbo-worker --since '-10 minutes' --no-pager
```

在局域网/VPN 浏览器中验证：

1. 可以打开 `/start` 和私密对话界面。
2. 账户、案件和对话可以在 PostgreSQL 中持久化。
3. 使用测试文件上传时，未配置 scanner 会进入 `scan_failed`，不会显示已提交或 AI 已使用材料。
4. 管理员路由仅能通过明确的管理员身份进入；不使用公开管理员账号。
5. `https://主机名` 之外的 `:3000`、`:5432`、`:8006`、`:22` 从外网不可达。

**验收标准：** 所有服务存活、HTTPS 有效、数据库不公网暴露、材料 fail-closed 行为符合预期、没有真实材料进入 staging。

---

## Task 12：GitHub Actions 自动发布（第二阶段）

先完成 Task 1–11，再选择一种发布通道：

### 方案 A：专用 self-hosted runner（家庭网络不开放 SSH，推荐）

- 在独立 VM 或本 VM 的非 root `manbo-runner` 用户中安装 GitHub Actions runner。
- 只给 runner `home-staging` label；workflow 仅允许受保护 `main` 分支。
- 禁止在 PR/fork workflow 使用该 runner；仓库启用 required reviewers。
- runner 不拥有 root 权限；部署脚本通过受限 sudoers 仅允许切换 release symlink、运行 migration 和重启两个 systemd 服务。

### 方案 B：GitHub-hosted runner 通过 SSH 发布

在 GitHub `Settings → Environments → home-staging → Secrets` 配置以下名称，值不要发到聊天：

```text
DEPLOY_HOST
DEPLOY_PORT
DEPLOY_USER
DEPLOY_SSH_KEY
DEPLOY_KNOWN_HOSTS
DEPLOY_PATH
```

不得在 workflow 中动态执行无验证的 `ssh-keyscan`；`DEPLOY_KNOWN_HOSTS` 应由你在可信网络采集并人工核对指纹后保存。家庭路由器仅开放 SSH 会增加攻击面，优先使用方案 A 或 VPN。

后续代码变更将新增 `.github/workflows/deploy-home-staging.yml`，执行顺序固定为：CI 通过 → 获取 main SHA → 服务器拉取该 SHA → `pnpm install --frozen-lockfile` → `prisma migrate deploy` → `pnpm build` → 原子切换 release → 重启 Web/worker → HTTPS smoke check。失败时保留上一 release，不自动删除旧版本。

**验收标准：** main push 后无需交互即可完成 staging 发布；PR 不会执行家庭 runner；日志不显示 Secret、数据库 URL、原始文件名或用户材料。

---

## Task 13：备份、恢复和删除演练

在接收任何真实材料前完成：

1. PostgreSQL 每日加密备份到独立磁盘或异地存储。
2. `/var/lib/manbo/materials` 采用加密备份；备份密钥不与 VM 同机保存。
3. 每月至少一次在隔离 VM 恢复数据库和测试材料，记录恢复时间与结果。
4. 删除一个测试案件后，逐项核对数据库主记录、消息、材料元数据、加密对象、派生物、包裹密钥、缓存和备份副本。
5. 备份任务失败必须告警；恢复后的删除任务必须可重试。

**验收标准：** 有可复核的恢复记录和删除回执；没有“删除数据库记录但备份仍永久保留”的未处理路径。

---

## Task 14：生产启用前阻断项

以下项目未完成前，保持私有 staging，不公开接收真实举报：

- 真实 S3/KMS 或等效对象存储、密钥轮换/吊销；
- 真实恶意文件扫描和解析 sandbox；
- media Gateway 零留存、不训练、区域、分包商和网络隔离审阅；
- OIDC/SSO/MFA 和管理员最小权限；
- 备份恢复、删除清理和故障恢复演练；
- 外部 worker 监督、积压/失败/死信指标和告警；
- 多语言人工审阅、危机红队和法律/隐私负责人签字。

## 回滚步骤

发生发布失败或异常时：

```bash
sudo systemctl stop manbo-web.service manbo-worker.service
cd /srv/manbo
sudo -u manbo ln -sfn /srv/manbo/releases/上一个已验证SHA current
sudo systemctl start manbo-web.service manbo-worker.service
sudo systemctl status manbo-web.service manbo-worker.service --no-pager
```

不要删除数据库、材料目录或旧 release 来“修复”部署；先保留证据并切换到 `APP_MODE=static` 或停止公网入口。

## 需要回传给维护者的非敏感结果

完成 Task 1–11 后，只回传以下信息，不要回传密码、私钥、token、完整 `DATABASE_URL` 或材料内容：

```text
Ubuntu 版本：
VM 内网地址：
Node 版本：
pnpm 版本：
是否公网 IPv4 / 是否 CGNAT：
DDNS HTTPS 是否成功：是/否
caddy/postgresql/manbo-web/manbo-worker 状态：
选择的 Actions 发布方案：A self-hosted runner / B SSH
```
