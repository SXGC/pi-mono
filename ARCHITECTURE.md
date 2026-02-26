# Pi Monorepo 架构文档

## 概览

Pi 是一套用于构建 AI Agent 和管理 LLM 部署的工具集，采用 pnpm workspace monorepo 结构，所有包统一版本号（lockstep versioning）。

```mermaid
graph TB
    subgraph "用户入口"
        CLI["pi CLI<br/>(终端交互)"]
        Slack["Slack Bot<br/>(mom)"]
        Web["Web UI<br/>(浏览器)"]
        Pods["pi-pods CLI<br/>(GPU 部署)"]
    end

    subgraph "应用层"
        CA["coding-agent<br/>编码代理"]
        MOM["mom<br/>Slack Bot"]
        WUI["web-ui<br/>Web 组件"]
        POD["pods<br/>Pod 管理"]
    end

    subgraph "核心层"
        AGT["agent-core<br/>Agent 运行时"]
        AI["ai<br/>统一 LLM API"]
        TUI["tui<br/>终端 UI 库"]
    end

    subgraph "外部服务"
        LLM["LLM Providers<br/>OpenAI / Anthropic / Google<br/>Bedrock / Mistral / ..."]
        GPU["GPU Pods<br/>vLLM 部署"]
        SA["Slack API"]
    end

    CLI --> CA
    Slack --> MOM
    Web --> WUI
    Pods --> POD

    CA --> AGT
    CA --> AI
    CA --> TUI
    MOM --> CA
    MOM --> AGT
    MOM --> AI
    WUI --> AI
    WUI --> TUI
    POD --> AGT

    AGT --> AI
    AI --> LLM
    POD --> GPU
    MOM --> SA
```

## 包依赖关系

```mermaid
graph BT
    AI["@mariozechner/pi-ai<br/>统一 LLM API"]
    TUI["@mariozechner/pi-tui<br/>终端 UI 库"]
    AGT["@mariozechner/pi-agent-core<br/>Agent 运行时"]
    CA["@mariozechner/pi-coding-agent<br/>编码代理 CLI"]
    MOM["@mariozechner/pi-mom<br/>Slack Bot"]
    WUI["@mariozechner/pi-web-ui<br/>Web 组件库"]
    POD["@mariozechner/pi-pods<br/>Pod 管理 CLI"]

    AGT -->|依赖| AI
    CA -->|依赖| AGT
    CA -->|依赖| AI
    CA -->|依赖| TUI
    MOM -->|依赖| CA
    MOM -->|依赖| AGT
    MOM -->|依赖| AI
    WUI -->|依赖| AI
    WUI -->|依赖| TUI
    POD -->|依赖| AGT
```

> `ai` 和 `tui` 是两个没有内部依赖的基础包，位于依赖树的最底层。

## 各包职责

### pi-ai -- 统一 LLM API

多 provider 的统一流式 LLM 接口。负责模型发现、消息转换、工具调用协议适配、token 计算与上下文管理。

```mermaid
graph LR
    subgraph "pi-ai 内部结构"
        ST["stream.ts<br/>统一流式入口"]
        REG["api-registry.ts<br/>Provider 注册"]
        TY["types.ts<br/>统一类型定义"]
        MOD["models.ts<br/>模型注册与发现"]
        ENV["env-api-keys.ts<br/>API Key 检测"]

        subgraph "providers/"
            OAI["openai.ts"]
            ANT["anthropic.ts"]
            GOO["google.ts"]
            BED["bedrock.ts"]
            MIS["mistral.ts"]
            OTH["..."]
        end
    end

    调用方 -->|"streamSimple()"| ST
    ST -->|查询 provider| REG
    REG --> OAI & ANT & GOO & BED & MIS & OTH
    ST -->|返回| 事件流["AssistantMessage<br/>EventStream"]
```

支持的 Provider: OpenAI, Anthropic, Google GenAI, AWS Bedrock, Mistral, OpenRouter, Groq, DeepSeek, xAI 等。

### pi-agent-core -- Agent 运行时

有状态的 Agent 运行时，提供消息管理、工具执行循环、上下文转换与事件系统。

```mermaid
graph TD
    subgraph "pi-agent-core"
        A["Agent<br/>状态 + 监听器"]
        AL["AgentLoop<br/>核心循环"]
        PX["Proxy<br/>远程流式传输"]
        TY["Types<br/>事件 / 消息 / 配置"]
    end

    A -->|驱动| AL
    AL -->|"调用 LLM"| STREAM["pi-ai stream"]
    AL -->|"执行工具"| TOOLS["Tool Handlers"]
    AL -->|"发射事件"| EVT["Event Listeners"]
    A -->|可选| PX
```

核心循环流程：

```mermaid
sequenceDiagram
    participant User as 调用方
    participant Agent as Agent
    participant Loop as AgentLoop
    participant LLM as pi-ai
    participant Tool as 工具

    User->>Agent: send(message)
    Agent->>Loop: 进入循环
    Loop->>LLM: streamSimple()
    LLM-->>Loop: text / tool_call 事件流
    alt 有工具调用
        Loop->>Tool: 执行工具
        Tool-->>Loop: 工具结果
        Loop->>LLM: 携带结果继续流式
    end
    Loop-->>Agent: 完成 / stop 事件
    Agent-->>User: 最终响应
```

### pi-coding-agent -- 编码代理 CLI

交互式终端编码代理，支持文件读写、代码编辑、Shell 执行、会话管理、扩展/技能系统。

```mermaid
graph TD
    subgraph "coding-agent 内部结构"
        CLI["cli.ts<br/>参数解析"]
        MAIN["main.ts<br/>主流程编排"]

        subgraph "core/"
            SDK["sdk.ts<br/>createAgentSession()"]
            SES["agent-session.ts<br/>会话运行时"]
            MR["model-registry.ts<br/>模型注册"]
            MRE["model-resolver.ts<br/>模型解析"]
            SM["settings-manager.ts<br/>配置管理"]
            RL["resource-loader.ts<br/>资源/扩展/技能加载"]
            CMP["compaction/<br/>上下文压缩"]
            EXT["extensions/<br/>扩展系统"]
            subgraph "tools/"
                READ["read"]
                EDIT["edit"]
                WRITE["write"]
                BASH["bash"]
                GREP["grep"]
                FIND["find"]
                LS["ls"]
            end
        end

        subgraph "modes/"
            INT["interactive/<br/>TUI 交互模式"]
            PRT["print/<br/>单次输出模式"]
            RPC["rpc/<br/>JSON-RPC 模式"]
        end
    end

    CLI --> MAIN
    MAIN --> SDK
    SDK --> SES
    SES --> MR & SM & RL & CMP & EXT
    SES -->|注册| READ & EDIT & WRITE & BASH & GREP & FIND & LS
    MAIN -->|分发| INT & PRT & RPC
    INT -->|依赖| TUI_PKG["pi-tui"]
    SES -->|内含| AGT_PKG["pi-agent-core Agent"]
    AGT_PKG -->|调用| AI_PKG["pi-ai stream"]
```

运行模式：

```mermaid
graph LR
    subgraph "三种运行模式"
        I["Interactive<br/>全功能 TUI"]
        P["Print<br/>单次执行输出"]
        R["RPC<br/>JSON-RPC 服务"]
    end

    I -->|用途| D1["终端交互<br/>会话对话"]
    P -->|用途| D2["管道 / 脚本<br/>单次问答"]
    R -->|用途| D3["外部集成<br/>IDE / Bot"]
```

### pi-tui -- 终端 UI 库

基于差分渲染的终端 UI 库，提供无闪烁输出、组件化输入编辑体验。

```mermaid
graph TD
    subgraph "pi-tui"
        TUI["tui.ts<br/>差分渲染引擎"]
        TERM["terminal.ts<br/>终端 I/O"]
        KEY["keys.ts + keybindings.ts<br/>按键处理"]

        subgraph "components/"
            INPUT["输入框"]
            LIST["列表"]
            MD["Markdown 渲染"]
            EDITOR["编辑器"]
        end
    end

    TERM -->|raw mode / Kitty 协议| TUI
    KEY --> TUI
    TUI --> INPUT & LIST & MD & EDITOR
```

### pi-mom -- Slack Bot

Slack Bot 进程，将 Slack 消息委托给 pi-coding-agent 会话执行。

```mermaid
graph LR
    subgraph "mom"
        MAIN["main.ts<br/>进程入口"]
        SL["slack.ts<br/>Socket Mode"]
        CTX["context.ts<br/>频道上下文"]
        AGT["agent.ts<br/>Agent 桥接"]
        SB["sandbox.ts<br/>沙箱执行"]
        ST["store.ts<br/>持久化"]
        TL["tools/<br/>工具集"]
    end

    Slack_API["Slack API"] <-->|Socket Mode| SL
    SL --> CTX
    CTX --> AGT
    AGT -->|创建会话| CA_PKG["pi-coding-agent"]
    AGT -->|可选| SB
    SB -->|隔离执行| Sandbox["Anthropic Sandbox"]
```

### pi-web-ui -- Web 组件库

基于 Web Components 的聊天 UI 组件库，为浏览器端 AI 交互提供开箱即用的界面。

```mermaid
graph TD
    subgraph "web-ui"
        CP["ChatPanel.ts<br/>聊天面板"]
        AI_IF["AgentInterface.ts<br/>Agent UI 组件"]

        subgraph "storage/"
            SB["backends/<br/>IndexedDB / LocalStorage"]
            SS["stores/<br/>会话 / 设置 / Key"]
        end

        subgraph "tools/"
            RD["renderers/<br/>工具结果渲染"]
            ART["artifacts/<br/>产物展示"]
        end

        subgraph "components/"
            MSG["消息组件"]
            SAND["sandbox/<br/>代码沙箱"]
        end
    end

    Browser["浏览器"] --> CP
    CP --> AI_IF
    AI_IF -->|消费| AGT_INST["pi-agent-core Agent"]
    AI_IF -->|流式| AI_STREAM["pi-ai stream"]
    CP --> SB & SS
    CP --> RD & ART
```

### pi-pods -- GPU Pod 管理 CLI

管理远程 GPU Pod 上 vLLM 部署的命令行工具。

```mermaid
graph LR
    subgraph "pods"
        CLI["cli.ts<br/>命令入口"]
        CFG["config.ts<br/>配置管理"]
        SSH["ssh.ts<br/>远程执行"]
        MC["model-configs.ts<br/>模型配置"]

        subgraph "commands/"
            PODS["pods<br/>Pod 管理"]
            MODELS["models<br/>模型部署"]
            PROMPT["prompt<br/>交互测试"]
        end
    end

    CLI --> PODS & MODELS & PROMPT
    PODS --> SSH
    MODELS --> SSH & MC
    SSH -->|SSH| GPU["远程 GPU Pod"]
    GPU -->|运行| VLLM["vLLM 服务"]
```

## 数据流总览

```mermaid
flowchart TB
    subgraph "输入源"
        T["终端输入"]
        S["Slack 消息"]
        W["Web 浏览器"]
    end

    subgraph "应用层"
        CA["coding-agent"]
        MOM["mom"]
        WUI["web-ui"]
    end

    subgraph "运行时"
        AGT["Agent<br/>(agent-core)"]
    end

    subgraph "LLM 层"
        AI["统一流式 API<br/>(pi-ai)"]
    end

    subgraph "Providers"
        P1["OpenAI"]
        P2["Anthropic"]
        P3["Google"]
        P4["Bedrock"]
        P5["..."]
    end

    subgraph "工具执行"
        FS["文件系统<br/>read/write/edit"]
        SH["Shell<br/>bash"]
        SR["搜索<br/>grep/find/ls"]
    end

    T --> CA
    S --> MOM --> CA
    W --> WUI

    CA --> AGT
    WUI --> AGT
    AGT --> AI
    AI --> P1 & P2 & P3 & P4 & P5

    AGT <-->|工具调用| FS & SH & SR
```

## 构建顺序

由于包间依赖关系，构建必须按以下顺序进行：

```mermaid
graph LR
    TUI["tui"] --> CA["coding-agent"]
    AI["ai"] --> AGT["agent-core"]
    AGT --> CA
    CA --> MOM["mom"]
    AI --> WUI["web-ui"]
    TUI --> WUI
    AGT --> POD["pods"]

    style TUI fill:#e1f5fe
    style AI fill:#e1f5fe
    style AGT fill:#fff3e0
    style CA fill:#fce4ec
    style MOM fill:#f3e5f5
    style WUI fill:#e8f5e9
    style POD fill:#fff8e1
```

构建命令链：`tui` → `ai` → `agent-core` → `coding-agent` → `mom` / `web-ui` / `pods`

## 技术栈

```mermaid
mindmap
  root((Pi Monorepo))
    语言与工具链
      TypeScript
      pnpm workspace
      Biome (lint + format)
      tsgo (type check)
      Vitest (测试)
    核心运行时
      Node.js >= 20
      ESM 模块
    终端
      Kitty 图形协议
      差分渲染
      koffi (FFI)
    Web
      Lit / Web Components
      IndexedDB
    LLM Providers
      OpenAI
      Anthropic
      Google GenAI
      AWS Bedrock
      Mistral
      DeepSeek
      xAI
      Groq
      OpenRouter
    部署
      vLLM
      GPU Pods
      SSH
    集成
      Slack Socket Mode
      Anthropic Sandbox
