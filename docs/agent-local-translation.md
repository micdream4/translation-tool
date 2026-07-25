# 本地 Agent 文档翻译入口

## 定位

`npm run agent:translate` 是 Hermes、Codex 或其他本地 Agent 调用本仓库文档翻译能力的正式入口。

- Hermes 负责接单、传入路径/目标语言/模型、查询结果和通知。
- 本仓库负责解析、模型路由、术语与占位符保护、翻译、重试、后处理、结构回写和 QA。
- 命令强制使用本地 `direct` 模式，不调用已部署网站，也不自动操作浏览器。
- 线上网站仍是人工界面和最终发布目标；本地任务不会 push 或部署。
- 自动 QA 通过只代表可进入人工验收，不代表已可交付、可配置或可发布。

## 调用契约

```bash
npm run --silent agent:translate -- \
  --input "/absolute/path/to/input-or-folder" \
  --output-dir "/absolute/path/to/task/output" \
  --report-dir "/absolute/path/to/task/reports" \
  --task-id "hermes-20260725-001" \
  --targets "French,Russian" \
  --model "deepseek-v4-pro"
```

参数：

- `--input`：单个文件或文件夹；文件夹会递归扫描已知格式。
- `--output-dir`：所有译后文档的唯一写入目录。
- `--report-dir`：任务总报告和逐文件 QA 报告目录。
- `--task-id`：仅允许字母、数字、点、下划线和连字符。
- `--targets`：逗号分隔，名称必须与工具目标语言列表一致。
- `--model`：`auto`、`deepseek-*`、`gemini-*` 或 `openrouter:<model-id>`。

本地密钥从 `.env.local` 或进程环境读取：

```bash
# DeepSeek
DEEPSEEK_API_KEY=...

# Gemini
GEMINI_API_KEY=...

# OpenRouter
OPENROUTER_API_KEY=...
```

缺少所选模型的本地密钥时返回 `BLOCKED`，不会回退到网页或 Cloudflare Pages API。

## 输出与退出码

入口进程本身只向 stdout 输出一行 JSON；Hermes 应使用 `npm run --silent`，避免 npm 自己的脚本标题混入 stdout。相同内容也会写到：

```text
<report-dir>/<task-id>-quality-report.json
```

每个文件/目标语言另有一份报告：

```text
<report-dir>/files/<task-id>-<file>-<target>.quality.json
```

任务日志写到 `<report-dir>/<task-id>.log.jsonl`，不写入输入目录或仓库目录。

核心字段包括：

```json
{
  "schema": "poct.agent.translation-task.v1",
  "taskId": "hermes-20260725-001",
  "status": "COMPLETED",
  "inputFiles": [],
  "outputFiles": [],
  "model": "deepseek-v4-pro",
  "targetLanguages": ["French", "Russian"],
  "files": [],
  "issueCounts": {
    "critical": 0,
    "medium": 0,
    "minor": 0
  },
  "qualityReportPath": "/task/reports/hermes-20260725-001-quality-report.json",
  "logPath": "/task/reports/hermes-20260725-001.log.jsonl",
  "readyForHumanReview": true,
  "deliveryStatus": "AWAITING_HUMAN_ACCEPTANCE"
}
```

状态：

- `COMPLETED`：自动 QA 未发现问题，可进入人工验收。
- `COMPLETED_WITH_WARNINGS`：有中等/轻微问题，可进入人工验收，但需关注报告。
- `BLOCKED`：能力缺失或严重 QA 问题；禁止进入人工验收。
- `FAILED`：解析、模型调用、写回或其他执行失败。

退出码：

- `0`：`COMPLETED` 或 `COMPLETED_WITH_WARNINGS`
- `2`：`BLOCKED`
- `1`：`FAILED` 或参数错误

Hermes 不应只看进程是否结束；应同时读取 `status`、`readyForHumanReview` 和 `deliveryStatus`。

## 当前格式能力

### Excel `.xlsx`

真实可执行。复用多工作表解析、模型路由、token/术语后处理、原始 OOXML 同坐标写回和 Quality Check Core。

自动检查：

- 输出能否重新打开。
- 工作表名称和顺序。
- 数据行数、表头/列关系。
- ID/编号/医学代码锚点。
- 占位符、源语言/非目标语言残留。
- 公式未被覆盖。

旧格式 `.xls` 不接受，返回 `BLOCKED`。

### DOCX `.docx`

真实可执行。复用现有 DOCX 部件解析、语义段、run 回填、编号/空格归一和 Quality Check Core。

自动检查：

- 输出能否重新解包并解析。
- 正文、编号、页眉页脚、脚注尾注、批注等已识别 XML 部件集合。
- 语义段数量。
- 占位符、医学代码和目标语言残留。

解析器明确给出的未覆盖部件会作为 warning 进入报告。

### 字符串资源

真实可执行：

- `.json`：只翻译字符串值，不翻译键；重新解析并比对键、数组位置和值类型结构。
- `.xml`：复用现有 Android `<string>`/逐行字符串资源逻辑，保护标签、格式参数、代码和 CDATA，并验证 XML。
- `.properties`、`.strings`：锁定 key/行前后缀，仅翻译 value，并检查行结构和 UTF-8 落盘可读性。

`.po` 需要按 `msgid`/`msgstr` 对安全写回，当前适配器尚未完成；任意 `.ts`、`.tsx`、`.js`、`.jsx` 源代码也不是安全的字符串资源写回格式。这些输入当前均返回 `BLOCKED`。

### PDF `.pdf`

当前本地 Agent 返回 `BLOCKED`，且不会调用模型。

原因是现有 PDF 解析、页面渲染和字体/文本层写回依赖浏览器 Canvas 与浏览器字体加载环境；Node 端尚无与线上路径等价、可验证的 adapter。在完成 Node PDF adapter、可选择文本层校验和真实 PDF smoke 之前，禁止虚报成功。

## Hermes 调用示例

```bash
set +e
result_json="$(
  npm run --silent agent:translate -- \
    --input "$INPUT_PATH" \
    --output-dir "$TASK_DIR/output" \
    --report-dir "$TASK_DIR/reports" \
    --task-id "$TASK_ID" \
    --targets "$TARGETS" \
    --model "$MODEL"
)"
exit_code=$?
set -e

status="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.status)' "$result_json")"
report="$(node -e 'const v=JSON.parse(process.argv[1]); process.stdout.write(v.qualityReportPath || "")' "$result_json")"

# Hermes 持久化 result_json、exit_code、status 和 report 后再发送通知。
```

Hermes 应把 `BLOCKED` 和 `FAILED` 通知为需要处理，不应将已有输出文件视为任务成功；严重 QA 问题下可能保留输出用于定位，但 `readyForHumanReview` 必定为 `false`。

## 验证

```bash
npm run test:agent
npm run typecheck
npm test
npm run build
```

`test:agent` 使用临时生成的多工作表 Excel、DOCX、JSON、XML 和 PDF smoke，覆盖：

- Excel/DOCX/字符串资源成功、结构重开和输入未覆盖。
- 模型异常返回 `FAILED`，不发布部分输出。
- PDF 返回 `BLOCKED`，模型调用次数为 0。
