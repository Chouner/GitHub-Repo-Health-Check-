# RepoScope - GitHub 仓库健康度体检仪表盘

输入任意公开 GitHub 仓库 URL，自动分析并可视化展示 Star、Fork、活跃度、语言分布、社区健康度等核心指标。支持 AI 模型辅助评分。
<img width="2549" height="1266" alt="93d285ef7ff3dfa3552f831c051b207b" src="https://github.com/user-attachments/assets/2dff0f16-efbe-4dbe-8f39-92bcc011918d" />
<img width="2549" height="1266" alt="d436839dc933d09576e0e3da50f1e527" src="https://github.com/user-attachments/assets/28fe6da0-b8f5-4e3a-8de7-84bca7e0b7c1" />


## 功能特性

- 基础信息：名称、描述、作者、创建/更新时间
- 热度指标：Star、Fork、Watch、Issues、Pull Requests
- 活跃度指标：最近推送、最近 Release、贡献者数量
- 代码结构：语言分布百分比
- 社区健康度：Issue 关闭率、PR 合并率
- 文档质量：README、LICENSE、CONTRIBUTING、CHANGELOG 检测
- 类别识别：23 个类别标签自动判定（Web 框架、AI/大模型、DevOps 等）
- 规则评分：100 分制加权平均，每个维度可展开查看评分明细
- AI 评分：支持 6 家厂商（OpenAI / DeepSeek / Kimi / 豆包 / Qwen / Claude）
- 历史记录：自动保存最近 20 次分析，点击即可回看
- 前端配置：GitHub Token 和 AI API Key 均在界面中配置，持久化到本地

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | HTML + Vanilla JS + Tailwind CSS CDN + Chart.js CDN |
| 后端 | Node.js + Express |
| 数据源 | GitHub REST API |
| AI | OpenAI 兼容接口 + Anthropic 接口 |

## 快速开始

### 1. 安装依赖

```bash
cd GitHub-Repo-Health-Check-
npm install
```

### 2. 配置环境变量（可选）

复制 `.env.example` 为 `.env`，填入 GitHub Token 可提升 API 额度：

```bash
cp .env.example .env
```

编辑 `.env`：

```
GITHUB_TOKEN=ghp_xxxxxxxxxxxx   # 可选，前端也可配置
PORT=3000                        # 可选，默认 3000
```

> GitHub Token 也可以在启动后的 Web 页面右上角「设置」中配置，无需改 `.env`。

### 3. 启动服务

```bash
node server.js
```

访问 `http://localhost:3000`

### 4. 使用

1. 页面右上角「设置」→ GitHub Token 标签 → 粘贴 Token → 保存（额度提升至 5000 次/小时）
2. 输入 GitHub 仓库 URL → 开始分析
3. 查看规则评分 + 维度明细
4. 设置 AI 模型 → 点击评分 → 对比 AI 评分结果

## AI 模型配置

支持的模型商：

| 厂商 | 默认模型 | 获取 API Key |
|---|---|---|
| OpenAI | gpt-4o | https://platform.openai.com/api-keys |
| DeepSeek | deepseek-chat | https://platform.deepseek.com/api_keys |
| Kimi (月之暗面) | moonshot-v1-8k | https://platform.moonshot.cn/console/api-keys |
| 豆包 (字节跳动) | doubao-pro-32k | https://console.volcengine.com/ark |
| 通义千问 (阿里云) | qwen-plus | https://dashscope.console.aliyun.com/apiKey |
| Claude (Anthropic) | claude-sonnet-4-20250514 | https://console.anthropic.com/settings/keys |

## 部署方式

### 直接部署

```bash
npm install
node server.js
```

### 使用 PM2 部署（推荐生产环境）

```bash
npm install -g pm2
pm2 start server.js --name reposcope
pm2 save
pm2 startup
```

### 使用 Docker 部署

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
```

```bash
docker build -t reposcope .
docker run -p 3000:3000 reposcope
```

### 反向代理（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

## 评分算法

### 规则评分（100 分制，加权平均）

| 维度 | 权重 | 评估方式 |
|---|---|---|
| 社区热度 | 25% | Stars 对数映射，10k 星满分 |
| 维护活跃度 | 25% | 最后推送时间线性衰减，一年未更新归零 |
| 文档完整度 | 20% | README(40)+LICENSE(25)+CONTRIBUTING(20)+CHANGELOG(15) |
| 工程规范 | 15% | 依赖文件(40)+测试目录(30)+CI 配置(30) |
| 可持续性 | 15% | Releases(40%)+Contributors(35%)+Topics(25%) |

### AI 评分

与大模型交互，使用相同权重体系进行综合评估，返回结构化的评分、优势、风险和改进建议。

## 项目结构

```
├── server.js              # Express 后端（GitHub API 代理 + AI 路由 + 规则评分）
├── public/
│   └── index.html         # 前端 SPA（输入页 + 仪表盘 + 设置弹窗）
├── package.json
├── .env.example
└── README.md
```
