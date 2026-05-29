require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ===================== AI Provider Registry =====================
const AI_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    endpoint: 'https://api.openai.com/v1/chat/completions',
    defaultModel: 'gpt-4o',
    type: 'openai-compatible'
  },
  deepseek: {
    name: 'DeepSeek',
    endpoint: 'https://api.deepseek.com/v1/chat/completions',
    defaultModel: 'deepseek-chat',
    type: 'openai-compatible'
  },
  kimi: {
    name: 'Kimi (月之暗面)',
    endpoint: 'https://api.moonshot.cn/v1/chat/completions',
    defaultModel: 'moonshot-v1-8k',
    type: 'openai-compatible'
  },
  doubao: {
    name: '豆包 (字节跳动)',
    endpoint: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
    defaultModel: 'doubao-pro-32k',
    type: 'openai-compatible'
  },
  qwen: {
    name: '通义千问 (阿里云)',
    endpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    defaultModel: 'qwen-plus',
    type: 'openai-compatible'
  },
  claude: {
    name: 'Claude (Anthropic)',
    endpoint: 'https://api.anthropic.com/v1/messages',
    defaultModel: 'claude-sonnet-4-20250514',
    type: 'anthropic'
  }
};

// ===================== GitHub API Helpers =====================
const GITHUB_API = 'https://api.github.com';

// 全局存储当前请求的 token（由每个请求独立设置）
let _currentToken = null;

function makeHeaders(token) {
  const h = { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'RepoScope' };
  const t = token || process.env.GITHUB_TOKEN;
  if (t) h['Authorization'] = `token ${t}`;
  return h;
}

async function githubFetch(url, token) {
  const res = await fetch(url, { headers: makeHeaders(token) });
  if (!res.ok) {
    if (res.status === 404) throw new Error('仓库不存在或为私有仓库');
    if (res.status === 403 || res.status === 429) {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const resetTime = res.headers.get('x-ratelimit-reset');
      if (remaining === '0') {
        const resetDate = resetTime ? new Date(parseInt(resetTime) * 1000) : new Date();
        const mins = Math.ceil((resetDate - new Date()) / 60000);
        throw new Error(`github_rate_limit||GitHub API 速率限制已达上限，约 ${mins} 分钟后恢复。点击右上角「设置」配置 GitHub Token 可将额度提升至 5000 次/小时。`);
      }
      throw new Error(`github_rate_limit||GitHub API 访问受限。点击右上角「设置」配置 GitHub Token 可将额度提升至 5000 次/小时。`);
    }
    throw new Error(`GitHub API 错误: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function throttledFetchAll(fetchers, token) {
  const hasToken = !!(token || process.env.GITHUB_TOKEN);
  const concurrency = hasToken ? 6 : 3;
  const batchDelay = hasToken ? 200 : 2000;

  const results = [];
  for (let i = 0; i < fetchers.length; i += concurrency) {
    const batch = fetchers.slice(i, i + concurrency);
    const batchResults = await Promise.allSettled(batch.map(fn => fn()));
    results.push(...batchResults);
    if (i + concurrency < fetchers.length) {
      await sleep(batchDelay);
    }
  }

  return results.map(r => {
    if (r.status === 'fulfilled') return r.value;
    throw new Error(r.reason?.message || '请求失败');
  });
}

function parseRepoUrl(url) {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/\s?#]+)/);
  if (!match) throw new Error('无效的 GitHub 仓库 URL');
  return { owner: match[1], repo: match[2].replace(/\.git$/, '') };
}

// ===================== Category Classifier =====================
const CATEGORY_RULES = [
  { cat: 'AI / 大模型',      keywords: ['llm', 'gpt', 'chatgpt', 'langchain', 'agent', 'rag', 'ollama', 'llama', 'stable-diffusion', 'transformer', 'nlp', 'generative-ai', 'ai-agent'], icon: 'psychology', color: '#7c3aed' },
  { cat: '机器学习 / 深度学习', keywords: ['machine-learning', 'deep-learning', 'tensorflow', 'pytorch', 'keras', 'scikit-learn', 'jax', 'neural-network', 'ml', 'model-training', 'computer-vision', 'reinforcement-learning'], icon: 'model_training', color: '#6366f1' },
  { cat: 'Web 框架',         keywords: ['framework', 'web-framework', 'nextjs', 'react', 'vue', 'angular', 'svelte', 'django', 'flask', 'spring', 'laravel', 'rails', 'express', 'fastapi', 'gin'], icon: 'language', color: '#2563eb' },
  { cat: '前端组件库',       keywords: ['ui-components', 'component-library', 'design-system', 'ui-kit', 'ant-design', 'element-ui', 'material-ui', 'chakra', 'tailwindcss', 'bootstrap', 'shadcn', 'radix'], icon: 'palette', color: '#d946ef' },
  { cat: 'CLI 工具',         keywords: ['cli', 'command-line', 'terminal', 'tui', 'shell', 'bash', 'zsh', 'devtools'], icon: 'terminal', color: '#64748b' },
  { cat: '数据库 / 存储',    keywords: ['database', 'sql', 'nosql', 'postgresql', 'mysql', 'mongodb', 'redis', 'sqlite', 'storage', 'orm', 'prisma', 'drizzle', 'cache', 'embedded-database'], icon: 'storage', color: '#dc2626' },
  { cat: 'DevOps / CI-CD',   keywords: ['docker', 'kubernetes', 'k8s', 'ci', 'cd', 'devops', 'terraform', 'ansible', 'jenkins', 'github-actions', 'helm', 'prometheus', 'grafana', 'infrastructure', 'deployment', 'container'], icon: 'deployed_code', color: '#ea580c' },
  { cat: 'API / 后端服务',   keywords: ['api', 'rest', 'graphql', 'grpc', 'microservices', 'backend', 'server', 'rest-api', 'restful', 'api-gateway', 'bff'], icon: 'api', color: '#0891b2' },
  { cat: '移动开发',         keywords: ['android', 'ios', 'react-native', 'flutter', 'swift', 'kotlin', 'mobile', 'cross-platform', 'expo'], icon: 'smartphone', color: '#059669' },
  { cat: '桌面应用',         keywords: ['electron', 'tauri', 'desktop', 'qt', 'gtk', 'wpf', 'winforms', 'nwjs'], icon: 'desktop_windows', color: '#475569' },
  { cat: '编程语言 / 编译器', keywords: ['compiler', 'interpreter', 'programming-language', 'runtime', 'parser', 'vm', 'wasm', 'webassembly', 'bytecode', 'transpiler', 'babel'], icon: 'code', color: '#f59e0b' },
  { cat: '测试框架',         keywords: ['testing', 'test-framework', 'jest', 'vitest', 'pytest', 'junit', 'selenium', 'cypress', 'playwright', 'mocha', 'unit-test', 'e2e'], icon: 'bug_report', color: '#e11d48' },
  { cat: '文档 / 静态站点',  keywords: ['documentation', 'docs', 'static-site', 'blog', 'docusaurus', 'vitepress', 'hugo', 'gatsby', 'jekyll', 'mkdocs', 'storybook'], icon: 'description', color: '#8b5cf6' },
  { cat: '数据科学 / 分析',  keywords: ['data-science', 'data-analysis', 'pandas', 'numpy', 'jupyter', 'visualization', 'd3js', 'echarts', 'streamlit', 'matplotlib', 'data-visualization', 'etl'], icon: 'analytics', color: '#0284c7' },
  { cat: '安全工具',         keywords: ['security', 'penetration-testing', 'vulnerability', 'crypto', 'encryption', 'authentication', 'oauth', 'auth', 'jwt', 'ssl', 'hacking'], icon: 'shield', color: '#991b1b' },
  { cat: '游戏引擎 / 开发',  keywords: ['game', 'game-engine', 'godot', 'unity', 'unreal', 'game-development', 'threejs', 'babylonjs', 'opengl', 'vulkan', 'webgl'], icon: 'sports_esports', color: '#c2410c' },
  { cat: '构建工具 / 打包器', keywords: ['build-tool', 'bundler', 'webpack', 'vite', 'rollup', 'esbuild', 'parcel', 'gulp', 'grunt', 'turborepo', 'monorepo', 'nx', 'lerna', 'make', 'cmake', 'gradle'], icon: 'build', color: '#1d4ed8' },
  { cat: '编辑器 / IDE',     keywords: ['editor', 'ide', 'vscode-extension', 'vim', 'emacs', 'neovim', 'plugin', 'code-editor', 'text-editor', 'intellij', 'sublime'], icon: 'edit', color: '#1e40af' },
  { cat: '网络 / 协议',      keywords: ['networking', 'http', 'tcp', 'websocket', 'proxy', 'nginx', 'caddy', 'traefik', 'gateway', 'load-balancer', 'dns', 'vpn'], icon: 'hub', color: '#0d9488' },
  { cat: '消息队列 / 事件',  keywords: ['message-queue', 'kafka', 'rabbitmq', 'nats', 'pubsub', 'event-driven', 'stream-processing', 'mqtt'], icon: 'dynamic_feed', color: '#1e293b' },
  { cat: '监控 / 可观测性',  keywords: ['monitoring', 'observability', 'logging', 'tracing', 'apm', 'opentelemetry', 'metrics', 'alerting'], icon: 'monitoring', color: '#be123c' },
  { cat: '工具库 / SDK',     keywords: ['library', 'sdk', 'utils', 'utilities', 'helpers', 'hook', 'middleware', 'plugin-system'], icon: 'extension', color: '#c026d3' },
  { cat: '操作系统 / 底层',  keywords: ['operating-system', 'kernel', 'linux', 'driver', 'firmware', 'embedded', 'os', 'low-level', 'assembly'], icon: 'memory', color: '#292524' },
];

function detectCategory(repoData, dirContents) {
  const searchText = [
    repoData.description || '',
    (repoData.topics || []).join(' '),
    repoData.language || '',
    repoData.name || ''
  ].join(' ').toLowerCase();

  let dirNames = '';
  if (Array.isArray(dirContents)) {
    dirNames = dirContents.map(f => f.name).join(' ').toLowerCase();
  }
  const fullText = searchText + ' ' + dirNames;

  // Score each category by keyword matches
  const scored = CATEGORY_RULES.map(rule => {
    let score = 0;
    for (const kw of rule.keywords) {
      // Exact word match scores higher
      const regex = new RegExp(`\\b${kw}\\b`, 'gi');
      const matches = fullText.match(regex);
      if (matches) score += matches.length * 5;
      // Partial match also counts
      if (fullText.includes(kw)) score += 1;
    }
    return { ...rule, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  // Return top category, or fallback
  if (scored[0].score > 0) {
    return { name: scored[0].cat, icon: scored[0].icon, color: scored[0].color, confidence: Math.min(scored[0].score, 100) };
  }
  // Fallback based on primary language
  const langCategory = {
    TypeScript: 'TypeScript 项目', JavaScript: 'JavaScript 项目', Python: 'Python 项目',
    Go: 'Go 项目', Rust: 'Rust 项目', Java: 'Java 项目', 'C++': 'C++ 项目',
    Ruby: 'Ruby 项目', PHP: 'PHP 项目', Swift: 'Swift 项目', Kotlin: 'Kotlin 项目',
    Dart: 'Dart 项目', C: 'C 项目', Shell: 'Shell 脚本',
  };
  const lang = repoData.language || '';
  return { name: langCategory[lang] || '代码仓库', icon: 'folder', color: '#727785', confidence: 0 };
}

// ===================== Rule-Based Scoring Engine =====================
// 每个维度 0-100 分，总分 = 加权平均（与 AI 评分算法一致）

function ruleBasedScore(data) {
  const details = {};
  const breakdown = {};
  let total = 0;

  // 1. 社区热度 (权重 25%) — 对数曲线，10k星=满分
  const stars = data.basic?.stars || 0;
  details.popularity = Math.min(Math.round(Math.log10(stars + 1) * 25), 100);
  total += details.popularity * 0.25;
  breakdown.popularity = [
    `Stars: ${stars.toLocaleString()} → 对数映射 (log₁₀×25) = ${details.popularity}/100分`,
    stars >= 10000 ? '✅ Stars ≥ 10k，已达满分' : stars >= 1000 ? `📌 Stars ≥ 1k，距离满分还需约 ${(10000 - stars).toLocaleString()} 星` : stars >= 100 ? `⚠️ Stars 较少 (${stars})，距离满分需约 10k 星` : `🔴 Stars 极少 (${stars})，社区热度低`
  ];

  // 2. 维护活跃度 (权重 25%) — 线性衰减，一年未更新=0
  const pushedAt = new Date(data.basic?.pushed_at || 0);
  const daysAgo = (Date.now() - pushedAt.getTime()) / (1000 * 60 * 60 * 24);
  details.activity = Math.max(0, Math.round(100 - daysAgo * (100 / 365)));
  total += details.activity * 0.25;
  const daysAgoStr = daysAgo < 1 ? '今天' : daysAgo < 2 ? '昨天' : `${Math.round(daysAgo)} 天前`;
  breakdown.activity = [
    `最后推送: ${daysAgoStr}`,
    `活跃度 = 100 - ${Math.round(daysAgo)}天 × (100/365) = ${details.activity}/100分`,
    daysAgo <= 7 ? '✅ 最近一周有推送，非常活跃' : daysAgo <= 30 ? '✅ 近一个月有推送，活跃' : daysAgo <= 90 ? '📌 近三个月有推送，维护节奏偏慢' : daysAgo <= 180 ? '⚠️ 半年内有过更新，活跃度偏低' : '🔴 超过半年未更新，可能已停维护'
  ];

  // 3. 文档完整度 (权重 20%) — README 40% / LICENSE 25% / CONTRIB 20% / CHANGELOG 15%
  let docScore = 0;
  const docItems = [];
  if (data.docs?.hasReadme) { docScore += 40; docItems.push('✅ README +40'); } else docItems.push('❌ README 缺失 (值为 40 分)');
  if (data.docs?.hasLicense) { docScore += 25; docItems.push('✅ LICENSE +25'); } else docItems.push('❌ LICENSE 缺失 (值为 25 分)');
  if (data.docs?.hasContributing) { docScore += 20; docItems.push('✅ CONTRIBUTING +20'); } else docItems.push('❌ CONTRIBUTING 缺失 (值为 20 分)');
  if (data.docs?.hasChangelog) { docScore += 15; docItems.push('✅ CHANGELOG +15'); } else docItems.push('❌ CHANGELOG 缺失 (值为 15 分)');
  details.documentation = Math.round(docScore);
  total += details.documentation * 0.20;
  breakdown.documentation = [
    `文档得分: ${details.documentation}/100 分`,
    ...docItems,
    details.documentation >= 80 ? '✅ 文档较完整' : details.documentation >= 50 ? '📌 文档基础项齐全，缺少进阶文档' : '⚠️ 文档缺失较多，建议补充'
  ];

  // 4. 工程规范 (权重 15%) — package 40% / 测试 30% / CI 30%
  let engScore = 0;
  const engItems = [];
  if (data.engineering?.hasPackageFile) { engScore += 40; engItems.push('✅ 依赖声明文件 +40'); } else engItems.push('❌ 未检测到依赖声明文件 (值为 40 分)');
  if (data.engineering?.hasTests) { engScore += 30; engItems.push('✅ 测试目录 +30'); } else engItems.push('❌ 未检测到测试目录 (值为 30 分)');
  if (data.engineering?.hasCI) { engScore += 30; engItems.push('✅ CI 配置 +30'); } else engItems.push('❌ 未检测到 CI 配置 (值为 30 分)');
  details.engineering = Math.round(engScore);
  total += details.engineering * 0.15;
  breakdown.engineering = [
    `工程规范: ${details.engineering}/100 分`,
    ...engItems,
    details.engineering >= 80 ? '✅ 工程规范完善' : details.engineering >= 50 ? '📌 基础工程配置齐全，仍有提升空间' : '⚠️ 缺少关键工程配置'
  ];

  // 5. 生态成熟度 (权重 15%) — Releases 40% / Contributors 35% / Topics 25%
  const releases = data.basic?.releases_count || 0;
  let relScore = releases > 10 ? 100 : releases > 5 ? 60 : releases > 0 ? 30 : 0;
  const relLabel = releases > 10 ? '满分' : releases > 5 ? '中等' : releases > 0 ? '偏低' : '零分';

  const contributors = data.community?.contributors || 0;
  let contScore = contributors > 100 ? 100 : contributors > 50 ? 80 : contributors > 20 ? 60 : contributors > 5 ? 40 : contributors > 0 ? 20 : 0;
  const contLabel = contributors > 100 ? '满分' : contributors > 50 ? '良好' : contributors > 20 ? '中等' : contributors > 5 ? '偏低' : contributors > 0 ? '很低' : '零分';

  const topicCount = (data.basic?.topics || []).length;
  let topicScore = topicCount > 3 ? 100 : topicCount > 0 ? 50 : 0;
  const topicLabel = topicCount > 3 ? '满分' : topicCount > 0 ? '中等' : '零分';

  details.sustainability = Math.round(relScore * 0.40 + contScore * 0.35 + topicScore * 0.25);
  total += details.sustainability * 0.15;
  breakdown.sustainability = [
    `生态成熟度: ${details.sustainability}/100 分`,
    `├ Release ${releases} 个 → ${relScore}分(${relLabel}) × 40% = ${Math.round(relScore * 0.40)}分`,
    `├ Contributors ${contributors} 人 → ${contScore}分(${contLabel}) × 35% = ${Math.round(contScore * 0.35)}分`,
    `└ Topics ${topicCount} 个 → ${topicScore}分(${topicLabel}) × 25% = ${Math.round(topicScore * 0.25)}分`,
    details.sustainability >= 80 ? '✅ 生态成熟度高' : details.sustainability >= 50 ? '📌 有一定生态基础，仍有成长空间' : '⚠️ 生态尚未成熟'
  ];

  // 总分四舍五入
  total = Math.round(total);

  let level;
  if (total >= 85) level = '优秀';
  else if (total >= 70) level = '良好';
  else if (total >= 50) level = '一般';
  else level = '风险较高';

  return { totalScore: total, level, scores: details, breakdown };
}

// ===================== AI Prompt Templates =====================
function buildScoringPrompt(repoDataJson) {
  return `你是一个资深开源项目评估专家。请根据下面的 GitHub 仓库数据，对该项目进行健康度评估。

请从以下维度评分（每个维度 0-100 分），总分按加权平均计算：
1. 社区热度（权重 25%）：Star、Fork、Watch、Topic 数量
2. 维护活跃度（权重 25%）：最近更新时间、提交频率、Release 频率
3. 文档完整度（权重 20%）：README、LICENSE、CONTRIBUTING、CHANGELOG 是否存在及质量
4. 工程规范（权重 15%）：目录结构规范性、CI 配置、测试覆盖、依赖管理
5. 可持续性（权重 15%）：贡献者数量、Issue 处理情况、PR 活跃度、生态成熟度

总分 = popularity×0.25 + activity×0.25 + documentation×0.20 + engineering×0.15 + sustainability×0.15

请输出纯 JSON（不要包含 markdown 代码块标记），格式如下：
{
  "totalScore": 0,
  "level": "优秀 / 良好 / 一般 / 风险较高",
  "scores": {
    "popularity": 0,
    "activity": 0,
    "documentation": 0,
    "engineering": 0,
    "sustainability": 0
  },
  "summary": "一句话总结项目健康状态",
  "strengths": ["优势1", "优势2", "优势3"],
  "risks": ["风险1", "风险2"],
  "suggestions": ["建议1", "建议2", "建议3"],
  "breakdown": {
    "popularity": ["数据依据：Stars N，Forks N", "评分理由：...", "结论：✅/📌/⚠️/🔴 ..."],
    "activity": ["数据依据：最后推送 N 天前", "评分理由：...", "结论：✅/📌/⚠️/🔴 ..."],
    "documentation": ["数据依据：README=是/否，LICENSE=是/否", "评分理由：...", "结论：✅/📌/⚠️/🔴 ..."],
    "engineering": ["数据依据：package=是/否，tests=是/否，CI=是/否", "评分理由：...", "结论：✅/📌/⚠️/🔴 ..."],
    "sustainability": ["数据依据：Releases N，Contributors N，Topics N", "评分理由：...", "结论：✅/📌/⚠️/🔴 ..."]
  }
}

注意：breakdown 中每个维度的数组最多 5 行，每条以 ✅(优势) / ❌(缺陷) / 📌(中性) / ⚠️(风险) / 🔴(严重风险) 开头。

仓库数据如下：
${repoDataJson}`;
}

// ===================== AI API Dispatcher =====================
async function callAI(providerId, apiKey, prompt, options = {}) {
  const provider = AI_PROVIDERS[providerId];
  if (!provider) throw new Error(`不支持的模型商: ${providerId}`);
  if (!apiKey) throw new Error('请配置模型 API Key');

  const model = options.model || provider.defaultModel;

  if (provider.type === 'anthropic') {
    const res = await fetch(provider.endpoint, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Claude API 错误: ${err.error?.message || res.statusText}`);
    }
    const data = await res.json();
    return data.content[0].text;
  }

  // OpenAI-compatible format (OpenAI, DeepSeek, Kimi, Doubao, Qwen)
  const res = await fetch(provider.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 2048
    })
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`${provider.name} API 错误: ${err.error?.message || res.statusText}`);
  }

  const data = await res.json();
  return data.choices[0].message.content;
}

function parseAIResponse(content) {
  // Try to extract JSON from response (handle markdown code blocks)
  let jsonStr = content.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (jsonMatch) jsonStr = jsonMatch[1];
  return JSON.parse(jsonStr);
}

// ===================== API Routes =====================

// GET /api/providers - List available AI providers
app.get('/api/providers', (_, res) => {
  const providers = Object.entries(AI_PROVIDERS).map(([id, info]) => ({
    id,
    name: info.name,
    defaultModel: info.defaultModel
  }));
  res.json(providers);
});

// POST /api/analyze - Analyze a GitHub repo (throttled, optimized for rate limits)
app.post('/api/analyze', async (req, res) => {
  try {
    const { url, githubToken } = req.body;
    if (!url) return res.status(400).json({ error: '请输入 GitHub 仓库 URL' });

    const { owner, repo } = parseRepoUrl(url);
    const baseUrl = `${GITHUB_API}/repos/${owner}/${repo}`;

    // Step 1: Fetch basic repo info first (single call)
    const repoData = await githubFetch(baseUrl, githubToken);

    // Step 2: Fetch remaining data with throttling — 6 calls, batched by 3
    let dirContents = null;
    let languages = {};
    let contributors = [];
    let releases = [];
    let allIssues = [];
    let allPulls = [];

    try {
      const [d1, d2, d3, d4, d5, d6] = await throttledFetchAll([
        () => githubFetch(`${baseUrl}/languages`, githubToken).then(v => { languages = v; return v; }).catch(() => ({})),
        () => githubFetch(`${baseUrl}/contents/`, githubToken).then(v => { dirContents = v; return v; }).catch(() => []),
        () => githubFetch(`${baseUrl}/releases?per_page=5`, githubToken).then(v => { releases = v; return v; }).catch(() => []),
        () => githubFetch(`${baseUrl}/contributors?per_page=30`, githubToken).then(v => { contributors = v; return v; }).catch(() => []),
        () => githubFetch(`${baseUrl}/issues?state=all&per_page=50`, githubToken).then(v => { allIssues = v; return v; }).catch(() => []),
        () => githubFetch(`${baseUrl}/pulls?state=all&per_page=50`, githubToken).then(v => { allPulls = v; return v; }).catch(() => [])
      ], githubToken);
    } catch (fetchErr) {
      throw new Error(fetchErr.message);
    }

    // Parse directory listing for docs / engineering checks
    let hasReadme = false, hasLicense = !!repoData.license?.spdx_id;
    let hasContributing = false, hasChangelog = false;
    let hasPackageFile = false, hasTests = false, hasCI = false;

    if (Array.isArray(dirContents)) {
      const names = dirContents.map(f => f.name.toLowerCase());
      hasReadme = names.some(n => n.startsWith('readme'));
      hasContributing = names.some(n => n.startsWith('contributing'));
      hasChangelog = names.some(n => n.startsWith('changelog'));
      hasPackageFile = names.some(n =>
        ['package.json', 'pyproject.toml', 'go.mod', 'cargo.toml', 'pom.xml', 'build.gradle', 'gemfile'].includes(n)
      );
      hasTests = names.some(n => ['test', 'tests', '__tests__', 'spec'].includes(n));
      hasCI = names.some(n => ['.github'].includes(n));
    }

    // CI deeper check
    if (hasCI) {
      try {
        const workflows = await githubFetch(`${baseUrl}/contents/.github/workflows`, githubToken);
        hasCI = Array.isArray(workflows) && workflows.length > 0;
      } catch (_) { hasCI = false; }
    }

    // Language distribution
    const totalBytes = Object.values(languages).reduce((a, b) => a + b, 0) || 1;
    const languageDistribution = Object.entries(languages)
      .map(([lang, bytes]) => ({ name: lang, percentage: Math.round((bytes / totalBytes) * 10000) / 100, bytes }))
      .sort((a, b) => b.percentage - a.percentage);

    // Issue stats (allIssues already combines open+closed)
    const issuesArr = Array.isArray(allIssues) ? allIssues.filter(i => !i.pull_request) : [];
    const openIssues = issuesArr.filter(i => i.state === 'open').length;
    const closedIssues = issuesArr.filter(i => i.state === 'closed').length;
    const totalIssues = openIssues + closedIssues;
    const issueCloseRate = totalIssues > 0 ? Math.round((closedIssues / totalIssues) * 100) : 0;

    // PR stats
    const pullsArr = Array.isArray(allPulls) ? allPulls : [];
    const openPRs = pullsArr.filter(p => p.state === 'open').length;
    const closedPRs = pullsArr.filter(p => p.state === 'closed').length;
    const prMergeRate = (openPRs + closedPRs) > 0 ? Math.round((closedPRs / (openPRs + closedPRs)) * 100) : 0;

    // Assemble structured data
    const analysisData = {
      basic: {
        name: repoData.full_name,
        owner: repoData.owner.login,
        avatar: repoData.owner.avatar_url,
        description: repoData.description,
        stars: repoData.stargazers_count,
        forks: repoData.forks_count,
        watchers: repoData.subscribers_count,
        open_issues: repoData.open_issues_count,
        created_at: repoData.created_at,
        updated_at: repoData.updated_at,
        pushed_at: repoData.pushed_at,
        homepage: repoData.homepage,
        topics: repoData.topics || [],
        language: repoData.language,
        license_name: repoData.license?.spdx_id || null,
        default_branch: repoData.default_branch,
        size: repoData.size,
        releases_count: Array.isArray(releases) ? releases.length : 0
      },
      languages: languageDistribution,
      community: {
        contributors: Array.isArray(contributors) ? contributors.length : 0,
        open_issues: openIssues,
        closed_issues: closedIssues,
        issue_close_rate: issueCloseRate,
        open_prs: openPRs,
        closed_prs: closedPRs,
        pr_merge_rate: prMergeRate,
        watchers: repoData.subscribers_count
      },
      docs: {
        hasReadme,
        hasLicense,
        hasContributing,
        hasChangelog
      },
      engineering: {
        hasPackageFile,
        hasTests,
        hasCI
      },
      latest_release: Array.isArray(releases) && releases.length > 0
        ? { tag: releases[0].tag_name, published_at: releases[0].published_at }
        : null
    };

    // Category detection
    const category = detectCategory(repoData, dirContents);

    // Rule-based score
    const ruleScore = ruleBasedScore(analysisData);

    res.json({
      success: true,
      data: analysisData,
      ruleScore,
      category
    });
  } catch (err) {
    console.error('Analysis error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// POST /api/ai-score - Get AI score
app.post('/api/ai-score', async (req, res) => {
  try {
    const { repoData, provider, apiKey, model } = req.body;

    if (!provider) return res.status(400).json({ error: '请选择模型商' });
    if (!apiKey) return res.status(400).json({ error: '请配置模型 API Key' });
    if (!repoData) return res.status(400).json({ error: '缺少仓库分析数据，请先分析仓库' });

    const prompt = buildScoringPrompt(JSON.stringify(repoData, null, 2));
    const aiResponse = await callAI(provider, apiKey, prompt, { model });
    const score = parseAIResponse(aiResponse);

    res.json({ success: true, data: score });
  } catch (err) {
    console.error('AI score error:', err.message);
    res.status(400).json({ success: false, error: err.message });
  }
});

// ===================== Start Server =====================
app.listen(PORT, () => {
  console.log(`RepoScope 运行中: http://localhost:${PORT}`);
});
