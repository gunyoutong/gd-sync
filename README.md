# 光东工作台 · 轻量同步后端（gd-sync）

把工作台数据同步到你的飞书多维表格，实现电脑/手机跨设备共享同一份数据。
**关键安全原则：飞书 App Secret 只存在于本后端的环境变量，绝不进前端网页。**

---

## 一、前置条件（在第 2 步里已完成的部分）
1. 飞书开放平台已创建企业自建应用「光东工作台」，App ID = `cli_aacd19bbdab9dce1`。
2. 已开通「多维表格」读写权限（`bitable:app`）并发布版本。
3. 已把该应用加为多维表格的「可编辑」协作者。
4. 在多维表格里新建一个表，命名为 **`同步存储`**，含两列：
   - `版本` —— 字段类型「数字」
   - `数据` —— 字段类型「多行文本 / 文本」
   （本服务会按表名自动找到它，并在其中维护单行最新快照。）

## 二、本地试运行（可选，先验证连通性）
```bash
cp .env.example .env
# 编辑 .env，填入 FEISHU_APP_ID / FEISHU_APP_SECRET / FEISHU_BASE_TOKEN
node server.js
# 另一终端测试：
curl https://localhost:3000/health
curl https://localhost:3000/api/sync
```

## 三、部署到 Render（推荐，免费）
1. 把 `gd-sync/` 整个目录推到你的 GitHub 仓库。
2. 打开 https://render.com → New → Web Service → 选择该仓库。
3. 关键设置：
   - Runtime: Node
   - Build Command: `echo skip-build`
   - Start Command: `node server.js`
   - Plan: Free
4. 在 Environment 里添加 4 个变量（值来自你的应用）：
   - `FEISHU_APP_ID` = `cli_aacd19bbdab9dce1`
   - `FEISHU_APP_SECRET` = 你的 App Secret（**不要分享给任何人**）
   - `FEISHU_BASE_TOKEN` = `TxQXb8OWsaPPyNstA90c0pDanDf`
   - `ALLOWED_ORIGIN` = `https://d1ad78c935d84f1c899537bf49ae35be.sh1.agentos-app.net`
   - （`SYNC_TABLE_NAME` 默认 `同步存储`，`PORT` 由 Render 注入，一般不用填）
5. 部署完成后，复制 Render 给你的地址，形如 `https://gd-sync-xxxx.onrender.com`。

> 也可以用「Deploy to Render」按钮（仓库含 `render.yaml`）：在 Render 后台 New → Web Service → 选 Deploy from render.yaml，再补 4 个密钥变量即可。

## 四、部署到 Railway（备选免费平台）
1. 打开 https://railway.app → New Project → Deploy from GitHub repo。
2. 选择该仓库，Start Command 设为 `node server.js`。
3. 在 Variables 添加上面 4 个环境变量。
4. 部署后复制生成的域名。

## 五、在前端启用同步
1. 打开工作台「设置与数据 → 云端同步」。
2. 粘贴后端地址（如 `https://gd-sync-xxxx.onrender.com`）→ 点「保存地址」。
3. 点「连接测试」确认状态为「已连接」。
4. 点「立即同步」：本地数据上传到飞书；之后任何设备点「立即同步」即可拉取/合并。
5. 若两端都有改动导致版本不一致，会弹窗让你选择「用云端覆盖本地 / 用本地覆盖云端」。

## 六、接口约定（供排查用）
- `GET /health` → `{ok:true,...}`
- `GET /api/sync` → `{version:Number, data:String(JSON)}`
- `POST /api/sync` body `{baseVersion:Number, data:String(JSON)}`
  - 成功 200 → `{version:新版本号}`
  - 版本冲突 409 → `{error:'conflict', current:{version, data}}`

## 七、安全与说明
- App Secret 仅存后端环境变量；前端只见后端地址，永远拿不到 Secret。
- 后端用 `ALLOWED_ORIGIN` 限制跨域来源（默认只允许工作台域名）。
- 同步为手动触发（点「立即同步」），不做后台自动上传，避免误覆盖。
- 飞书数据只读写你新建的「同步存储」表，不回写原经销商档案表。
- 免费平台（Render/Railway Free）可能有冷启动延迟，首次同步稍等几秒属正常。
