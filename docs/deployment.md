# Hexordle 部署說明

本文件記錄將 Hexordle 部署到 ClawCloud 的完整流程，以及後續更新的操作方式。

---

## 架構概覽

```
GitHub Repo
    │
    │ 手動 docker build + push
    ▼
Docker Hub (image 倉庫)
    │
    │ ClawCloud 從這裡拉 image
    ▼
ClawCloud Run (容器運行)
    │
    ├── Port 3001 (HTTP + WebSocket)
    └── 連線 Supabase PostgreSQL
```

---

## 前置需求

| 服務 | 用途 | 備註 |
|---|---|---|
| [Docker Desktop](https://www.docker.com/products/docker-desktop/) | 本機 build image | 免費 |
| [Docker Hub](https://hub.docker.com) | 存放 image | 免費，需建立帳號 |
| [Supabase](https://supabase.com) | PostgreSQL 資料庫 | 免費方案 |
| [ClawCloud Run](https://console.run.claw.cloud) | 容器部署平台 | 連結 GitHub 帳號獲得 $5/月免費額度 |
| [Discord Developer Portal](https://discord.com/developers/applications) | Discord App 設定 | 需要 Application ID、Client Secret、Bot Token |

---

## 首次部署流程

### 1. 準備 Supabase 資料庫

1. 前往 [supabase.com](https://supabase.com) 建立新 Project
2. Security 設定：
   - **Enable Data API**：保持預設（勾選）
   - **Enable automatic RLS**：**不要勾選**（server 用 pg 直連，無 RLS policy，勾了會擋掉所有查詢）
3. 建立完成後，點頂部 **Connect** 按鈕 → 選 **Session pooler**（不要選 Direct，Direct 可能解析為 IPv6，ClawCloud 不支援）
4. 複製 URI 格式的連線字串，把 `[YOUR-PASSWORD]` 換成你設定的 DB 密碼
   ```
   postgresql://postgres.xxxx:你的密碼@aws-0-xxxx.pooler.supabase.com:5432/postgres
   ```
   這就是 `DATABASE_URL`

> **注意**：一定要用 Session pooler 的連線字串，不能用 Direct。Direct 連線在 ClawCloud 會解析到 IPv6 地址，導致 `ENETUNREACH` 錯誤。

> 資料庫 table 會在 server 第一次啟動時自動建立，不需要手動跑 migration。

---

### 2. Build 並推送 Docker Image

#### Docker 概念說明

Railway 之前是自動幫你做這些事。現在改成手動，但結果完全一樣：

```
docker build  →  在你電腦上產生一個「image」（整個 app 的快照，包含 code + 環境）
docker push   →  把這個 image 上傳到 Docker Hub（讓 ClawCloud 可以下載）
ClawCloud     →  從 Docker Hub 下載 image 並運行（就是 Railway 以前幫你做的事）
```

Image 就像一個「打包好可以直接執行的程式壓縮包」。Docker Hub 就是存放這些包的倉庫。

#### Build 前確認清單

在執行指令前，先確認以下全部就位：

- [ ] **Docker Desktop 已安裝並正在運行**（Windows 工作列右下角應看到鯨魚圖示且穩定不閃爍；若出現 `pipe/dockerDesktopLinuxEngine` 錯誤代表 Docker 未啟動）
- [ ] **Docker Hub 帳號已建立**（記住你的 username）
- [ ] **已知道 `VITE_CLIENT_ID`**：[Discord Developer Portal](https://discord.com/developers/applications) → 選你的 Application → 首頁最上方的 **Application ID**（一串數字，右側有複製按鈕）。這個值就是 `VITE_CLIENT_ID`。
- [ ] **已在專案根目錄**（`Dockerfile` 所在的位置，也就是 `Hexordle/`）

> **與 Railway 的差異**：Railway 用的就是這個 `Dockerfile`，內容完全一樣，build 出來的結果相同。差別只在 Railway 自動 build、ClawCloud 需要你手動 build 後上傳。

#### 執行指令

**Git Bash / WSL（推薦）**
```bash
# 切到專案根目錄
cd /c/Users/raging/Desktop/Vibe_coding/Hexordle

# 登入 Docker Hub（輸入你的 Docker Hub 帳密）
docker login

# Build image
docker build \
  --build-arg VITE_CLIENT_ID=你的Discord_Application_ID \
  -t 你的DockerHub帳號/hexordle:latest \
  .

# 推送到 Docker Hub
docker push 你的DockerHub帳號/hexordle:latest
```

**單行版本（CMD / PowerShell 最保險）**
```
docker build --build-arg VITE_CLIENT_ID=你的Discord_Application_ID -t 你的DockerHub帳號/hexordle:latest .
```

**PowerShell 多行版本（如果用 Git Bash 有問題）**
```powershell
# 切到專案根目錄
cd C:\Users\raging\Desktop\Vibe_coding\Hexordle

# 登入 Docker Hub
docker login

# Build image（PowerShell 用反引號 ` 換行）
docker build `
  --build-arg VITE_CLIENT_ID=你的Discord_Application_ID `
  -t 你的DockerHub帳號/hexordle:latest `
  .

# 推送到 Docker Hub
docker push 你的DockerHub帳號/hexordle:latest
```

> `VITE_CLIENT_ID` 必須在 build 時傳入，Vite 會把它打包進前端靜態檔案，之後無法在 ClawCloud 改動。

---

### 3. 在 ClawCloud 建立 App

1. 前往 [console.run.claw.cloud](https://console.run.claw.cloud)（注意：不是 clawcloud.com 的帳單頁面）
2. 點 **App Launchpad** → **Application Deployment**
3. 填入以下設定：

**Application Name**
```
hexordle
```

**Image**
- 選 **Public**
- Image Name：`你的DockerHub帳號/hexordle:latest`

**Network / Port**
- Port：`3001`
- 開啟 Public 存取（取得對外 domain）

**Environment Variables**（逐一新增）
```
VITE_CLIENT_ID = 你的 Discord Application ID
CLIENT_SECRET  = Discord OAuth2 Client Secret
BOT_TOKEN      = Discord Bot Token
DATABASE_URL   = postgresql://postgres.xxx:密碼@xxx.supabase.com:5432/postgres
PORT           = 3001
```

4. 點 **Deploy Application**
5. 等待部署完成，記下 ClawCloud 分配的 **domain**（格式如 `hexordle-xxx.ap-northeast-1.run.claw.cloud`）

---

### 4. 更新 Discord URL Mapping

1. 前往 [Discord Developer Portal](https://discord.com/developers/applications)
2. 選擇你的 Application → **Activities** → **URL Mappings**
3. 將 mapping 指向 ClawCloud domain（去掉 `https://`，只填 domain 部分）
4. 儲存

---

### 5. 驗證部署

確認以下功能正常：

- [ ] 在 Discord voice channel 可以開啟 Hexordle Activity
- [ ] 遊戲可以正常載入和猜詞
- [ ] 重新開啟 Activity 後進度仍在（代表 DB 連線正常）
- [ ] 完成一局後 Bot 會在 Discord 頻道發送排行榜圖片

---

## 更新部署（修改程式碼後）

每次程式碼有修改，完整流程分三步：

### 步驟 1：在 Claude Code 確認變更並 commit

在 Claude Code 終端機（或 Git Bash）執行：

```bash
# 確認目前修改的內容
git diff

# 加入並 commit（範例訊息，依實際改動調整）
git add packages/server/src/app.js
git commit -m "feat: add diagnostic logging for Discord message flow"
```

> commit 之後 code 就有版本記錄，不會遺失。

---

### 步驟 2：重新 Build 並推送 Docker Image

在專案根目錄（`Hexordle/`）執行：

**Git Bash**
```bash
docker build \
  --build-arg VITE_CLIENT_ID=你的Discord_Application_ID \
  -t 你的DockerHub帳號/hexordle:latest \
  . && docker push 你的DockerHub帳號/hexordle:latest
```

**PowerShell**
```powershell
docker build --build-arg VITE_CLIENT_ID=你的Discord_Application_ID -t 你的DockerHub帳號/hexordle:latest .
docker push 你的DockerHub帳號/hexordle:latest
```

Push 完成後會看到 `latest: digest: sha256:...` 代表成功上傳。

---

### 步驟 3：在 ClawCloud 重新部署

1. 前往 [console.run.claw.cloud](https://console.run.claw.cloud)
2. 點 **App Launchpad** → 找到 `hexordle` app
3. 點進去後找 **Redeploy** 按鈕（或右上角選單內的 Restart）
4. 等待狀態變為 **Running**（約 30 秒）

> ClawCloud 拉取的是 Docker Hub 上的 `latest` tag，只要 push 後 Redeploy 就會使用最新版本。

---

## 查看 Server Log

### ClawCloud Log 查看方式

1. 前往 [console.run.claw.cloud](https://console.run.claw.cloud)
2. 點 **App Launchpad** → 找到 `hexordle` app → 點進去
3. 上方 Tab 選 **Logs**（或側邊欄的 Pod Logs）
4. 選取對應的 Pod（格式如 `hexordle-xxxxxxxxx-xxxxx`）
5. 右側下拉選 **Streaming logs**（即時串流）或指定時間範圍

> Streaming logs 模式下會即時顯示新 log，適合邊操作邊觀察。

---

### 解讀 Discord 訊息相關 Log

猜一次詞後，正常流程會出現以下 log：

```
[API] POST /api/progress userId=xxx date=2026-04-22 wl=6 guildId=xxx guesses=1
[Bot][wl=6][2026-04-22] autoEnsureGuildMessage called guildId=xxx
[Bot][wl=6][2026-04-22] existing message found: channel=xxx msg=xxx age=0.05h
[Bot][wl=6][2026-04-22] message fresh (<3h) — refreshing
[Bot][wl=6][2026-04-22] refreshGuildMessage: patching channel=xxx msg=xxx
[Bot][wl=6][2026-04-22] refreshGuildMessage: 1 player(s)
[Bot][wl=6][2026-04-22] PATCH (image) => HTTP 200   ← 200 代表成功
```

**異常狀況對照表：**

| Log 內容 | 代表問題 | 處理方式 |
|---|---|---|
| `guildId=null` | guildId 沒傳到 server | 確認在 Discord Server 中開啟 Activity（非 DM） |
| `guildId missing, skipping Discord message` | 同上 | 同上 |
| `no channelId found — aborting` | Bot 沒有頻道存取權限 | 確認 Bot 已加入伺服器且有讀取頻道權限 |
| `GET guild channels => HTTP 403` | Bot token 錯誤或 Bot 未加入伺服器 | 確認 `BOT_TOKEN` 環境變數正確 |
| `POST new message => HTTP 403` | Bot 沒有在該頻道發送訊息的權限 | 在 Discord 伺服器設定中給 Bot 發訊息權限 |
| `PATCH (image) => HTTP 429` | Discord rate limit（猜太快） | 屬於正常限制，稍後自動恢復 |
| `PATCH (image) => HTTP 10008` | 訊息已被刪除 | 刪除 DB 中的 `channel_daily_message` 該筆記錄，下次猜詞時會重新建立 |
| `no message row in DB` | DB 沒有記錄但應該有 | 確認 `DATABASE_URL` 連線正常 |

---

## 環境變數速查

| 變數 | 說明 | 在哪取得 |
|---|---|---|
| `VITE_CLIENT_ID` | Discord Application ID | Developer Portal → 應用程式首頁 |
| `CLIENT_SECRET` | Discord OAuth2 Client Secret | Developer Portal → OAuth2 |
| `BOT_TOKEN` | Discord Bot Token | Developer Portal → Bot |
| `DATABASE_URL` | Supabase PostgreSQL 連線字串 | Supabase → Connect → Direct |
| `PORT` | Server 監聽 port | 固定填 `3001` |

---

## 常見問題

**Activity 打開一片白 / 無法載入**
- 確認 Discord URL Mapping 指向正確的 ClawCloud domain
- 確認 ClawCloud app 正在運行（不是 stopped 狀態）

**進度沒有儲存 / 啟動時出現 `ENETUNREACH` 錯誤**
- 確認 `DATABASE_URL` 使用的是 Supabase **Session pooler** 的連線字串，不是 Direct
- Direct 連線在 ClawCloud 會解析到 IPv6，導致連線失敗
- Supabase → Connect → Session pooler → 複製字串後更新 ClawCloud 環境變數

**Bot 沒有發送排行榜**
- 確認 `BOT_TOKEN` 正確
- 確認 Bot 已加入伺服器並有發訊息的權限

**Build 時 VITE_CLIENT_ID 相關錯誤**
- 確認 `--build-arg VITE_CLIENT_ID=...` 有正確傳入，值不能是空字串
