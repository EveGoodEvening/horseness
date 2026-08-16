# Horseness

一个带版本控制、证据门禁和确定性重建的多 Agent 状态机。

## 问题

主 Agent + 自由形式 subagent 总结 + session 压缩，存在固有缺陷：

- 摘要遗漏约束，新旧事实混合；
- 结论无法追溯到 evidence；
- 并发 subagent 互相覆盖；
- 无法精确重放，无法判断结论在哪个代码版本上成立。

## 核心思路

把主 Agent 的正确认知从 session 文本里移出，变成**可验证、可重放、版本化的 canonical working state**。

闭环：

```
subagent exploration
→ evidence-gated state delta
→ canonical working state
→ automatic context reconstruction
→ dependency-aware fork
```

## 机制

**Canonical state（main branch）** — 主 Agent 唯一拥有的确定状态，带 `revision` 和 `stateHash`。只有 `DeltaAccepted` 能推进 `revision + 1`。

**ForkPin（锁定 base 的工作分支）** — subagent 从确定 revision 创建不可变 fork，绑定可见的 receipt/evidence、授权修改的 delta scope、父 fork lineage。并发 fork 互不覆盖。

**Delta proposal（带前置条件的 PR）** — subagent 不直接改 canonical state，而是提交结构化 delta：精确 base revision、scope、`test`/`replace`/`remove` 前置条件、evidence claims。base 已变则返回 `conflicted`，不静默覆盖。

**Evidence-gated admission（确定性 CI + policy gate）** — 五层确定性检查：结构身份、修改权限、证据真实性、并发冲突、pinned+current policy 合取。结果只有 `accepted`/`rejected`/`conflicted`/`quarantined`/`approval_required`，只有 `accepted` 推进 canonical revision。

**Automatic context reconstruction（确定性构建最小上下文）** — 不让主 Agent 手动裁剪 session，而是从持久状态按 ForkPin、task scope、固定预算确定性渲染 digest 可验证的最小上下文，整项省略而非截断，记录 omission。

**Dependency-aware fork（任务 DAG）** — 下游 fork 只在上游任务特定 generation 的 receipt/evidence 满足成功条件后创建，绑定 immutable join snapshot。后续修复基于 `canonical revision + ForkPin + dependency snapshot`，而非主 Agent 当前自然语言 session。

## 类比

```
Git-like forks
+ database transactions
+ content-addressed evidence
+ deterministic build-like context generation
+ policy-gated pull requests
+ task DAG scheduler
```

| Horseness        | Git/工程类比             |
| ---------------- | ------------------------ |
| 主 Agent         | 唯一 authorized integrator |
| canonical state  | main branch              |
| ForkPin          | 锁定 base commit 的工作分支 |
| subagent exploration | branch 上的研究       |
| evidence         | 测试输出、artifact、receipt |
| delta proposal   | 有路径范围和前置条件的 PR  |
| admission        | 确定性 CI + policy gate   |
| DeltaAccepted    | merge commit             |
| context reconstruction | 从锁定 revision 重建最小上下文 |
| dependency-aware fork | 上游满足后才创建下游分支 |

## 质量边界

优化：长任务一致性、多 Agent 并发安全、可追溯性、上下文可重放、错误隔离、stale-context 检测、evidence 与结论绑定、后续修复精确基线。

代价：比自由聊天更重；每个 proposal 需结构化 delta；evidence 需持久化校验；task scope/依赖需提前定义；admission 只确定性验证已编码规则，不判断语义正确性；contract/scope/policy 本身设计错误时，闭环只能一致地执行错误规则。

> 对长时间、多 Agent、需要可靠修复与审计的工程任务，这套闭环通常比自由形式总结 + session 压缩可靠得多。对一次性小任务，成本可能大于收益。

## 核心约束

> 任何 subagent 的结论，在未绑定 ForkPin、scope、receipt、evidence、precondition 并通过 admission 前，都只是候选信息，不是主 Agent 的 canonical truth。

## 状态

核心 domain/store/orchestrator/SDK/daemon/CLI 及 Pi、OMP adapter 层已建立。四宿主完整闭环、安装、系统验证、发布尚未全部完成。详见 `docs/DESIGN_CHOICE.md` 与 `docs/progress.md`。

## 延伸阅读

- `docs/DESIGN_PRINCIPLE.md` — 设计原则：主 Agent 职责边界、admission 完整检查项、context reconstruction 可重放性、retry/resume attempt identity。
- `docs/DESIGN_CHOICE.md` — 设计取舍：原始设想与缺陷分析、闭环逐步推演、具体示例、质量边界与代价。
- `docs/architecture.md` — 产品不变量与状态语义（规范文档）。
- `docs/plan.md` — chunk 边界、依赖、路径归属、验收命令。
- `docs/progress.md` — 进度总账。
