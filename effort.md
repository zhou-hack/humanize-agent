# MiniMax-M3.1-Flash 思考强度实测

测试日期：2026-10-30。端点：`https://api.minimax.cn/anthropic`（Anthropic 协议）与 `https://api.minimax.cn/v1`（Responses / Chat Completions）。

## 结论

- 思考**无法关闭**：模型强制要求 adaptive thinking，任何关闭写法都返回 400。
- 可用档位为 `low`、`medium`、`high`、`xhigh`、`max`（服务端报错信息给出的允许值）。`minimal` 也被接受，推测映射到 `low`。
- 不传参数时的默认档位思考量接近 `high` / `xhigh`，**不是最低档**；想要更快响应应显式传 `low`。
- `low` 平均耗时约为默认的一半，但只是倾向少想、并非硬上限，同题曾出现 25s 与 60s 两种结果。
- `medium` / `high` / `xhigh` / `max` 之间单次波动大，样本少时无法稳定排出强弱；本轮 `max` 反而少于 `high`。
- 简单题各档几乎无差别（100–400 字思考，1–2 秒），差异只在需要长推理的问题上体现。
- 思考内容在三种接口下都是约百字一片的**实时流式**推送，可用于前端实时展示。

## 各接口参数

| 接口 | 思考强度参数 | 传 none / 关闭 |
| --- | --- | --- |
| Anthropic Messages | `output_config: { effort }` | 400 |
| OpenAI Responses | `reasoning: { effort }` | 400 |
| OpenAI Chat Completions | `reasoning_effort` | 400 |

关闭思考的各种写法与返回：

| 写法 | 结果 |
| --- | --- |
| Anthropic `output_config.effort=none` | 400 `reasoning effort none is not allowed (2013)` |
| Anthropic `thinking.type=disabled` | 400 `thinking.type="disabled" (including reasoning.effort=none) is not allowed (2013)` |
| Anthropic `thinking.type=adaptive` + `effort=none` | 400，同上 |
| Anthropic `thinking.type=enabled, budget_tokens=0` | 不报错，但仍思考，参数被忽略 |
| Responses `reasoning.effort=none` | 400，同上 |
| Chat Completions `reasoning_effort=none` | 400，同上 |
| 任意接口传非法值（如 `bogus`） | 400 `allowed: low, medium, high, xhigh, max` |

`thinking.budget_tokens`（1024 / 16000）不报错，但看不出对思考量有影响。

## 数据

### 难题：Anthropic 协议 `output_config.effort`

题目：12 枚硬币中 1 枚轻重未知，天平称 3 次找出并判断轻重，验证全部 24 种情况。每档 2 次并发，`max_tokens=32000`，流式请求。

| 档位 | 思考长度 | 输出 token | 耗时 |
| --- | --- | --- | --- |
| `low` | 0.96–1.49 万字 | 4.5k–6.7k | 23–33s |
| `medium` | 1.65–1.93 万字 | 7.5k–8.9k | 35–40s |
| `max` | 1.91–2.04 万字 | 8.0k–8.5k | 38–40s |
| `xhigh` | 2.29–2.66 万字 | 9.9k–10.7k | 46–50s |
| 默认（不传） | 2.29–2.88 万字 | 10.2k–11.6k | 47–53s |
| `high` | 2.78–4.02 万字 | 10.4k–16.6k | 53–77s |

此前另一轮（串行）：默认 2.90–3.96 万字 / 56–73s；`low` 0.97 万字 / 25s 与 3.12 万字 / 60s。

### 难题：Responses `reasoning.effort`

| 档位 | 思考长度 | 输出 token | 耗时 |
| --- | --- | --- | --- |
| `minimal` | 0.67–0.96 万字 | 3.9k–5.1k | 19–23s |
| `max` | 2.36–2.53 万字 | 9.7k–11.2k | 50–52s |

### 简单题：各接口各档

题目：鸡兔同笼（35 只、94 只脚）+ `37*43-12*19`，只给答案。各档思考均为 100–400 字、输出约 85–195 token、耗时约 1–3 秒，档位间无明显差异。

### 流式到达时间

推理题、单次请求，思考增量的到达时间：

| 接口 | 首段思考 | 末段思考 | 正文开始 |
| --- | --- | --- | --- |
| Anthropic 协议 | 1.5s | 3.9s | 4.2s |
| Responses | 0.7s | 2.7s | 2.7s |
| Chat Completions（`reasoning_content`） | 0.9s | 1.8s | 2.0s |

## 局限

- 每档样本仅 2–4 次，`medium` 及以上档位的排序不可靠。
- 只测了 `MiniMax-M3.1-Flash`，其他 MiniMax 型号未测。
- 项目代码目前未暴露思考强度配置，以上均为独立脚本直连 API 测得。
