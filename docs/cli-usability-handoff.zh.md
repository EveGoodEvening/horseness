# CLI 易用性交接说明

## 修复状态

日常工作流已实现，不再要求用户手填 cursor、内部协议 JSON、实体 ID 或幂等键：

```sh
horseness init
horseness run create --title "修复登录问题"
horseness task add --run current --title "检查认证代码"
horseness status
```

`init` 在当前项目建立私有本地工作区并启动 daemon；后续命令可从子目录自动发现该工作区，也可显式传 `--workspace PATH`。创建 run 会选为 current；`run list`、`run use --run ID` 和 `task list` 用于查看和切换已有工作。帮助支持 `--help`，脚本输出支持 `--json`。

`task add` 创建持久化 draft，不会自动启动 worker，也不推进 canonical revision。请求发送前保存完整 ID、cursor 和幂等键；网络中断后保留同一请求，仅在用户明确重复原命令时重发。过期状态、冲突和权限拒绝不会触发静默自动重试。旧工作区不会被 `init` 擅自接管或重新授权。

执行必须显式授权；`task add` 永远只创建 draft。新增命令：

```sh
horseness task dispatch --task TASK_ID --adapter pi --model PROVIDER/MODEL
horseness task show --task TASK_ID
horseness task breakdown --task TASK_ID --planner claude --model CONCRETE_MODEL
horseness task show --task TASK_ID
horseness task adopt --task TASK_ID --plan PLAN_DIGEST
horseness task execute --task TASK_ID --adapter pi --model PROVIDER/MODEL
horseness task cancel --task TASK_ID
```

host 可选 `pi`、`omp`、`claude`、`codex`，不会静默替换 host/model。省略 model 仅在 daemon 能确定具体默认身份时可用，否则报 `MODEL_REQUIRED`。启动命令返回持久化受理确认，不代表任务已完成；用 `task show` 查看依赖、attempt、认证 receipt/output digest、输出、计划预览和 workflow 的停止原因。CLI 不直接启动 native worker，不读取数据库，也不自动轮询。

`breakdown` 只启动独立 planner，原目标不被完成，也不自动采纳或执行子任务。先审阅预览的指令、人工验收标准和依赖，再用精确 digest 显式 `adopt`；原目标保留为最终集成任务。验收标准是 worker 指导，不冒充自动语义证明。`execute` 显式授权目标依赖闭包的串行执行；需要自动规划并采纳时才传 `--auto-plan`，可同时指定 `--planner HOST --planner-model NAME`。该 flag 不带值、默认关闭，其他命令不接受；planner 参数要求该 flag。拒绝、依赖失败或未知结果会停止 workflow，不自动重试未知外部交接。`cancel` 持久化禁止后续启动，但不宣称撤销已交接的外部工作。

旧工作区不会由 `init` 静默扩权。当前 authority 且拥有 `grant.issue.v1` 权限的用户可显式运行 `horseness workspace enable-execution`；通过 `grant.list.v1` 检查当前身份和 scope，再申请保持同 principal/scope/expiry 的执行授权。非 authority 被拒绝。opaque reference 在私有文件中原子替换并 fsync，不输出到终端；授权本身不调用模型。

中断请求保留完整原始调用及规范化选项指纹，包括 adapter、model、plan、自动规划和 planner 选项。改变选项不能重放旧 mutation；pending 期间 `status`、`task show` 等查询仍可用。明确的最终拒绝清除 pending，未经验证的响应保留请求。已在隔离工作区通过真实 Pi 0.73.1 和本地确定性 provider 验证原生读写工具、receipt、重复请求恢复、重启、计划预览/采用、依赖执行、自动规划、失败结果与原生交接后的崩溃恢复；这不等于线上模型认证或其他宿主的 live 验证，详细范围见 C22 证据账本。

已在真实 CLI → daemon → SQLite 路径验证上述四条命令与 daemon 重启后的状态保留。详见 [CLI 使用说明](cli.md)。以下保留原低层接口问题的背景说明；`run-create` 等协议级命令仍供高级自动化和调试使用。

## 原问题

修复前，CLI 更像“直接操作内部 API 的调试工具”：每条命令近似一次 JSON-RPC 调用，用户需要理解并手工填写内部协议字段。仅有底层接口不足以构成日常工作流。

## `cursor` 是什么

`cursor` 可以理解成“我看到的当前状态是第几版”的凭证。

例如：

```text
我看到 workspace 当前是第 12 版，校验值是 abc123。
请只在它仍然是第 12 版时执行我的操作。
```

如果读取之后，另一个进程已经把状态改成第 13 版，Horseness 会拒绝基于旧 cursor 的操作，避免静默覆盖新数据。

它类似于：

- Git 操作绑定一个明确的 base commit；
- 编辑文档时提示“版本已过期，请刷新”；
- 数据库的乐观并发控制。

因此 cursor 不只是一个简单数字，还会包含 workspace/run 标识、事件序号、哈希和上下文版本等信息。

## `--input JSON` 是什么

`--input JSON` 相当于要求用户亲手填写内部 API 表单。

例如创建一次 run，当前命令大致要求：

```bash
horseness run-create \
  --workspace-id workspace:123 \
  --run-id run:456 \
  --cursor '{"schemaVersion":"1", ...}' \
  --idempotency-key create-run-456 \
  --input '{
    "schemaVersion": "1",
    "commandType": "CreateRunV1",
    "commandId": "create-run-456",
    "observationCursor": { ... },
    "principalId": "principal:owner",
    "initialDocument": {
      "title": "我的任务"
    }
  }'
```

普通用户真正想表达的通常只是：

```bash
horseness run create --title "我的任务"
```

## 历史低层接口所需的手工流程

直接使用低层协议接口时，用户通常需要：

1. 找到 workspace ID；
2. 查询当前状态；
3. 从查询结果中取出最新 cursor；
4. 构造符合协议版本和命令类型要求的 JSON；
5. 生成 run、task 或其他实体 ID；
6. 生成防止重复执行的 idempotency key；
7. 执行命令；
8. 从结果中取得新 cursor，并用于下一次操作。

这就是“CLI 偏底层”的具体含义。

## 这种设计的优缺点

优点：

- 每个输入和状态前提都明确；
- 并发修改不会静默覆盖；
- 行为确定且容易进行协议级验证；
- 适合开发、调试、自动化和 conformance 测试。

缺点：

- 普通用户难以使用；
- 命令很长；
- JSON 容易写错；
- 用户必须理解 workspace、run、cursor、grant 和 idempotency key 等内部概念。

它更像使用 `curl` 或 Postman 手工调用内部 API，而不像使用成熟的产品 CLI。

## 已实现的高层 CLI

面向用户的 CLI 在内部自动完成：

```text
发现或选择 workspace
→ 获取最新 cursor
→ 生成所需 ID
→ 生成 idempotency key
→ 构造版本化协议输入
→ 调用 daemon
→ 保存或传播新的 cursor
→ 输出简洁结果
```

用户只需要输入类似：

```bash
horseness init
horseness run create --title "修复登录问题"
horseness task add --run current --title "检查认证代码"
horseness status
```

高层 CLI 只能隐藏协议机械细节，不能削弱底层安全语义：它仍须使用精确 cursor、稳定幂等键和版本化输入，并明确向用户报告 stale state、conflict、authorization denial 和其他规范结果。

## 简单类比

原状态可以类比为：

> 发动机已经有了，但驾驶室里放的还是发动机诊断接口。

现在初始化、创建 run、添加 task 和查看状态已有面向用户的操作入口；高级协议接口保留，但不再是这些日常操作的必经路径。
