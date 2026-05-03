# AutoVideo Web UI — 部署指南

## 前置条件

- Node.js >= 20.0.0
- npm >= 9
- FFmpeg（用于视频渲染和音频处理）
- Remotion（见下方构建步骤）

## 通用步骤

### 1. 构建项目

```bash
git clone <repo-url> /opt/AutoVideo
cd /opt/AutoVideo
npm ci
npm run build:web
```

构建产物：
- 服务端：`dist/server/server/index.js`
- 前端：`web/dist/`（含 `index.html`）

### 2. 配置

创建 `/opt/AutoVideo/.env`（可选），覆盖默认环境变量：

```env
# 运行端口（默认 3030）
PORT=3030

# 绑定地址（默认 127.0.0.1，仅本地访问）
HOST=127.0.0.1

# 项目根目录（默认 project/）
PROJECTS_ROOT=/data/autovideo-projects
```

API Key 等敏感配置通过 Web UI 设置面板配置，存储在 `.autovideo-web/config.json`（已在 `.gitignore` 中排除）。

### 3. 确保 `.autovideo-web/` 在 `.gitignore` 中

仓库 `.gitignore` 应包含：

```
.autovideo-web/
```

服务启动时会检查此项，若缺失将打印警告。该目录存储任务记录、运行日志和 UI 配置，不应提交到版本控制。

---

## Linux 部署（systemd）

### 1. 安装 systemd 用户单元

```bash
mkdir -p ~/.config/systemd/user/
cp deploy/autovideo-web.service ~/.config/systemd/user/
```

**注意**：如果部署路径不是 `/opt/AutoVideo`，编辑 `.service` 文件中的 `WorkingDirectory` 和 `EnvironmentFile`。

### 2. 启用并启动服务

```bash
systemctl --user daemon-reload
systemctl --user enable --now autovideo-web
```

### 3. 查看状态

```bash
systemctl --user status autovideo-web
journalctl --user -u autovideo-web -f
```

### 4. 远程访问（可选）

如需从外部访问，使用 nginx 反向代理并添加认证：

```nginx
server {
    listen 443 ssl;
    server_name autovideo.example.com;

    ssl_certificate     /etc/ssl/example.crt;
    ssl_certificate_key /etc/ssl/example.key;

    auth_basic "AutoVideo";
    auth_basic_user_file /etc/nginx/.htpasswd;

    location / {
        proxy_pass http://127.0.0.1:3030;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

或使用 Caddy：

```
autovideo.example.com {
    basicauth {
        user $2a$...
    }
    reverse_proxy 127.0.0.1:3030
}
```

---

## macOS 部署（launchd）

### 1. 安装 launchd plist

```bash
cp deploy/com.autovideo.web.plist ~/Library/LaunchAgents/
```

**注意**：如果 Node.js 路径不是 `/usr/local/bin/node`，修改 plist 中的 `ProgramArguments`。可通过 `which node` 确认。

**注意**：如果部署路径不是 `/opt/AutoVideo`，修改 plist 中的 `WorkingDirectory`、`ProgramArguments`、`StandardOutPath` 和 `StandardErrorPath`。

### 2. 加载并启动

```bash
launchctl load ~/Library/LaunchAgents/com.autovideo.web.plist
```

### 3. 查看状态

```bash
launchctl list | grep autovideo
tail -f /opt/AutoVideo/.autovideo-web/stdout.log
```

### 4. 停止/卸载

```bash
launchctl unload ~/Library/LaunchAgents/com.autovideo.web.plist
```

---

## 验证部署

```bash
curl http://127.0.0.1:3030/api/health
# 应返回: {"ok":true,"version":"0.1.0",...}

curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3030/
# 应返回: 200
```

## 故障排查

- 确认 `web/dist/index.html` 存在（`npm run build:web` 成功）
- 确认 `.autovideo-web/config.json` 配置正确（通过 UI 设置面板检查）
- 查看服务日志：systemd 使用 `journalctl --user -u autovideo-web`，launchd 查看 `StandardOutPath` 指定的文件
- 端口冲突：修改 `PORT` 环境变量
