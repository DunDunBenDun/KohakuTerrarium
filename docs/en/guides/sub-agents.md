---
title: Sub-agents
summary: Configure bounded inspection helpers, service presets, custom sub-agents, and budgets.
tags:
  - guides
  - sub-agent
  - budget
---

# Sub-agents

Sub-agents are private vertical delegation inside a creature. Each task run starts
with its own prompt and the supplied task, not the parent's conversation.
Lightweight helpers inspect; graph creatures own substantial delegated work.
The parent retains planning and decisions.

## Builtin task helpers

```yaml
subagents:
  - {name: explore, type: builtin}
  - {name: critic, type: builtin}
```

- **explore:** answer a bounded workspace question. Supply the question, search
  scope, and existing findings. Returns an answer, file evidence, and coverage
  limits. Not implementation, planning, or an unnecessary extra hop for a known file.
- **critic:** independently review a specified change, artifact, or proposal.
  Supply the target, requirements, scope, and a diff for change reviews. Returns
  evidence-backed findings and coverage. No fixing, broad audits, or test suites.

Both use only `read`, `glob`, `grep`, and `tree`. There is no shell access: the
parent supplies command output or diffs when needed. `can_modify: false` alone
is not a sandbox for custom tools; the builtin tool selection excludes writers
and shell execution. Policies for additional capabilities belong in plugins.

### Defaults

| Setting | Both helpers |
| --- | --- |
| Budget plugin model calls, soft/hard | 8 / 12 |
| Budget plugin tool calls, soft/hard | 24 / 40 |
| Absolute `max_turns` | 14 |
| Whole-run `timeout` | 600 seconds |
| Automatic compaction | Not enabled by the preset |
| Interactive | No |

`explore` follows the per-sub-agent model mapping and otherwise uses the parent.
`critic` explicitly inherits the parent's model unless overridden in its entry.
A fast tool-capable profile can be selected for exploration without forcing a
weaker model on independent review.

At a soft limit, stop expanding scope and prepare the report. At a hard budget
limit, the plugin blocks tools but allows text reporting. The absolute loop cap
bounds a model that keeps requesting tools; reaching it reports failure with
collected text retained, rather than claiming completion. A natural text finish
on the last allowed call still completes normally. The emergency timeout is not
a graceful reporting deadline and may end before a final report is produced.

Limits are ceilings, not goals. Partial or blocked reports must name missing
context, unchecked scope, and the next useful check. Runtime success means the
agent returned normally, not that its findings establish complete coverage.

### Override limits or models

```yaml
subagents:
  - name: explore
    type: builtin
    options:
      max_turns: 18
      timeout: 900
      model: my-fast-profile
      plugins:
        - name: budget
          options:
            turn_budget: [10, 16]
            tool_call_budget: [30, 50]
```

The `plugins` list replaces the preset's list. Keep a reporting allowance between
the hard model-call budget and the absolute loop cap. `timeout` is the whole-run
deadline. The budget plugin's current `walltime_budget` measures time around LLM
calls, not total elapsed time including tools; do not use it as a whole-run timer.

## Service presets

`response`, `summarize`, `memory_read`, and `memory_write` remain available with
their existing service-specific behavior. They are not automatically added to
kt-biome's general creature. Their existing budget defaults are 40/60 model
calls and 75/100 tool calls, with the `auto-compact` plugin pack selected.

## Migration from older configurations

`worker`, `plan`, `research`, and `coordinator` are no longer builtin sub-agents.
Unknown or removed builtin entries produce a warning naming the entry and are
skipped, including in strict startup. Valid entries still register and the
creature remains runnable. Updating KT before kt-biome therefore does not brick
an older creature configuration.

Update kt-biome or remove stale entries. Keep planning with the parent, assign
substantial work to graph creatures, or declare a custom sub-agent if an
application specifically needs one. Python imports from removed builtin preset
modules must be migrated; this compatibility behavior covers config loading.

## Custom sub-agents

Custom configurations remain supported; the small builtin roster does not
restrict the runtime's general capabilities.

```yaml
subagents:
  - name: dependency_mapper
    type: custom
    description: Map dependency edges without editing files
    system_prompt: |
      Map the requested import relationships. Return file evidence and gaps.
    tools: [glob, grep, read, tree]
    can_modify: false
    max_turns: 14
    timeout: 600
    plugins:
      - name: budget
        options:
          turn_budget: [8, 12]
          tool_call_budget: [24, 40]
```

Inline entries support `SubAgentConfig` fields such as prompts, tools, output
routing, models, plugins, compaction, `max_turns`, and `timeout`. Runtime budget
axes live under the budget plugin's `options`, not directly on `SubAgentConfig`.
Use module-backed configs when an application needs shared Python definitions.

## Parent budgets and compaction

Budget plugins are instantiated per run. Their model/tool accounting is separate
from the optional legacy parent iteration pool. At runtime, `budget_allocation`
selects an isolated legacy allocation; otherwise `budget_inherit: true` can
reuse the parent's iteration pool. A shared pool can stop a child earlier than
its own limits. For builtin overrides, use the supported `plugins`, `max_turns`,
and `timeout` options rather than assuming every config field is overlaid.

For custom agents requiring longer contexts, opt into compaction explicitly:

```yaml
subagents:
  - name: document_reader
    type: custom
    system_prompt: "Read the supplied documents and report evidence and uncertainty."
    tools: [read, grep]
    default_plugins: [auto-compact]
    compact:
      max_tokens: 120000
      threshold: 0.75
      keep_recent_turns: 4
    max_turns: 30
    timeout: 900
    plugins:
      - name: budget
        options:
          turn_budget: [20, 28]
          tool_call_budget: [40, 60]
```

The `auto-compact` pack selects `compact.auto`; a `compact` block configures the
manager. The two inspection presets do not select either by default. Prefer a
smaller question or a graph creature over silently extending a lightweight run.
