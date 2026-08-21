# Oplier

**A smarter way to manage real-world assets.**

[![Network](https://img.shields.io/badge/network-X%20Layer%20Testnet-1f6feb)](https://www.okx.com/xlayer)

## Overview

Oplier is an AI-powered platform for managing and executing real-world asset portfolios onchain. Instead of building trading rules manually, users describe what they want in natural language and Oplier turns that intent into clear actions, portfolio insights, or **UPMs (Unmanned Position Managers)** that can manage positions autonomously.

The product is built around a simple idea: **understand my portfolio, help me manage it, and execute what I approve.** Oplier keeps the interface conversational while making the resulting actions structured, understandable, and controllable.

## What Oplier Does

Oplier brings four portfolio workflows into one experience: **Ask, Trade, Manage, and Understand.**

### Ask

Ask Oplier about your portfolio, positions, supported assets, market conditions, or events that could affect what you hold.

Questions can be as simple as:

> “What upcoming events could affect my holdings?”

> “What are the main risks around my AAPL position this week?”

> “What is happening with this asset?”

Oplier answers in the context of the user's portfolio rather than acting like a general-purpose chatbot. The goal is useful portfolio intelligence, not generic conversation.

### Trade

Oplier can prepare one-off RWA transactions from natural-language requests without requiring the user to manually construct the transaction flow.

A typical interaction looks like:

```text
User: Buy $10 of AAPLx with USDG.

Oplier:
  prepares the transaction
  shows the action clearly
  presents Approve / Cancel

User:
  Approves

Wallet:
  signs the transaction

Oplier:
  reports the actual onchain result
```

Approval is explicit. The AI does not hold private keys, sign transactions, or silently turn analysis into authorization. A recommendation remains a recommendation until the user explicitly moves into the transaction flow.

### Manage

The defining management primitive in Oplier is the **UPM — Unmanned Position Manager**.

A UPM is a persistent position-management instruction that monitors defined conditions and executes the actions attached to them without requiring the user to remain online.

Instead of building a visual automation flow, the user can simply say:

> “Create a UPM for my AAPLx position: buy more when price falls 5% and exit at 12% ROI.”

Oplier translates that request into a structured UPM, validates it, shows the user exactly what will happen, and activates it only after the user approves the setup and its required permissions.

### Understand

Oplier combines portfolio context with fundamental and event analysis so users can understand **what happened, why it matters, which holdings may be affected, and what the relevant risks are**.

The product distinguishes facts from interpretation and does not present uncertain market outcomes as guaranteed results. Fundamental information is grounded in external data rather than relying on the AI to invent or recall events from memory.

## UPMs: From Natural Language to Autonomous Execution

UPMs are designed to make automation understandable without making it manual.

A user describes an outcome in plain language. Oplier identifies the supported conditions and actions required to express that intent, then turns the request into an ordered UPM definition.

Conceptually:

```text
Natural-language request
        ↓
Oplier understands the intent
        ↓
Structured UPM definition
        ↓
Validation
        ↓
User review + activation
        ↓
Autonomous monitoring
        ↓
Condition satisfied
        ↓
Transaction executed
        ↓
Result recorded
```

Each UPM is made up of ordered steps. A step has a condition and an action. Later steps become eligible only after earlier steps complete successfully. This lets a UPM represent simple accumulation rules as well as multi-step position-management sequences.

### Supported condition types

UPMs are built from explicit, supported condition primitives rather than arbitrary AI-generated execution logic.

- **Price:** act when an asset reaches, exceeds, or falls below a defined price.
- **Price percentage:** act after a defined percentage move.
- **ROI:** act when the user's actual position reaches a defined return threshold.
- **Time:** act at a defined date or time.
- **High Impact News:** act when a predefined high-impact event falls within a supported time window.

ROI is based on the user's position economics, including cost basis, rather than simply treating market-price movement as the user's return.

### Supported actions

UPMs can express defined swaps between supported assets, including accumulation and the opposite direction of gradually reducing a position into a settlement asset.

Swap amounts can be defined as:

- A fixed amount.
- A percentage of the current source-asset balance.
- A percentage of the source-asset balance at the beginning of the UPM run.

Every UPM also has its own explicit execution limit. Oplier does not guess a user's maximum allocation from conversation context or memory.

### Sequential by design

UPMs execute in a strict sequence:

```text
Step 1 condition
      ↓
Step 1 action succeeds
      ↓
Step 2 becomes eligible
      ↓
Step 2 action succeeds
      ↓
Step 3 ...
```

A later step cannot execute simply because its own condition happens to be true. This keeps multi-step strategies predictable and preserves the dependency between actions.

### Lifecycle control

UPMs can be:

- **Active** — conditions are monitored and qualifying actions can execute.
- **Paused** — execution stops while the UPM's state and permissions remain intact.
- **Halted** — execution stops after a non-retryable failure and can resume from the failed step after the user addresses the issue.
- **Expired** — execution is stopped by an optional expiration time.
- **Complete** — the final configured action has successfully executed.

Users can pause, resume, modify, or delete UPMs and view their execution history and errors.

A completed or expired UPM can be reactivated as a new execution run while preserving its historical record. Modifying a UPM changes its active definition without erasing its history.

## How the AI Works

Oplier's AI is designed around **portfolio context, structured actions, and controlled execution** rather than free-form automation.

### Portfolio-aware conversation

The conversational layer can work with the information that matters to portfolio management, including:

- Current portfolio and position data.
- Supported assets and their available actions.
- Current market and pricing information.
- Fundamental and event information.
- Active UPMs and their states.
- Relevant context from the current conversation.
- A persistent memory profile for useful long-term user preferences and goals.

The AI uses controlled product capabilities instead of being given unrestricted access to application state or transaction authority.

### Structured actions instead of improvised execution

When the user asks Oplier to do something, the AI works through explicit capabilities such as preparing a transaction or creating, modifying, pausing, resuming, or deleting a UPM.

The AI can interpret intent and request an action. The authoritative execution layer validates the action before anything consequential happens.

This means the AI does **not** invent:

- Unsupported assets.
- Unsupported UPM conditions.
- Arbitrary execution logic.
- Transaction permissions.
- Contract addresses.
- High Impact News classifications.

When something is not supported, Oplier says so rather than silently substituting a different behavior.

### AI interpretation, deterministic execution

The most important boundary in Oplier is simple:

> **The AI understands the instruction. The execution engine carries it out.**

Once a UPM is active, execution does not require an AI model to reason about every trigger. Conditions are evaluated deterministically, permissions are checked, transactions are executed, and results are recorded.

This makes autonomous behavior reproducible: the same UPM definition produces the same execution rules regardless of what the conversational AI happens to say in another conversation.

### Memory

Oplier can maintain a persistent **Memory Summary** across conversations. Memory is intended for information that genuinely helps future interactions, such as stable preferences, goals, and useful long-term context.

Memory is separate from live portfolio state, transaction history, and UPM authorization. A user's latest clear preference takes precedence over older remembered information, and temporary conversation details are not treated as permanent user state.

### Long conversations

Long chats remain usable through context compaction. Recent conversation stays directly available while older parts are compressed into relevant context so the assistant can continue a conversation without repeatedly carrying the entire transcript forward.

This is intentionally separate from persistent memory: conversation continuity belongs to the current chat, while the Memory Summary represents reusable user context across chats.

## Understanding Markets and Events

Oplier's analysis layer is portfolio-contextual rather than a generic news feed.

Users can ask questions such as:

> “What upcoming events could affect my holdings?”

> “What fundamental risks do you see for my portfolio this week?”

> “Is there anything coming up that could affect my AAPLx position?”

Oplier can explain:

- What happened or what is scheduled.
- Why it matters.
- Which holdings may be affected.
- Potential positive and negative implications.
- Risk and severity.
- Important uncertainty or missing information.

Relevant insights can also surface through the portfolio experience, giving users a direct route from an event to a deeper conversation.

### High Impact News as a UPM condition

High Impact News is deliberately more constrained inside UPMs than it is in conversational analysis.

Oplier uses a predefined High Impact News classification for automated conditions. The AI does not decide for itself that an arbitrary article, filing, or headline is “high impact” at execution time.

For news-based UPM creation, Oplier presents the currently classified high-impact events before the UPM is created, then the execution layer evaluates the objective condition.

## Built for Clear User Control

Oplier is designed so that intelligence and user authority reinforce each other.

For one-off transactions, the user reviews the prepared action, chooses **Approve** or **Cancel**, and completes the normal wallet-signing flow. The AI reports the real transaction status rather than assuming that approval means success.

For UPMs, the user first reviews and activates the UPM and authorizes the permissions required for that specific strategy. After activation, the UPM can execute autonomously within those defined boundaries.

The result is a product where automation is powerful without becoming opaque: users can see what a UPM does, pause it, resume it, modify it, delete it, and inspect the execution history.

## Current Status

> **Live on X Layer Testnet · Chain ID 1952**
>
> Oplier is live on X Layer Testnet with four deployed RWA test assets and USDG as the settlement asset.

- **Network:** X Layer Testnet (`1952` / `0x7A0`)
- **RWA assets:** AAPLx, GLDx, METAx, NVDAx
- **Settlement asset:** USDG, a real Paxos-issued testnet token
- **Liquidity:** intentionally modest at **11 USDG per RWA/USDG pool** as a responsible testnet allocation. AAPLx/USDG is seeded and swappable; the other three pools are deployed and intentionally unseeded while additional testnet faucet liquidity is accumulated.
- **Gas sponsorship:** planned ahead of mainnet as part of the production user experience.

The testnet environment is deliberately sized for focused product testing and realistic onchain flows without treating shared testnet faucet liquidity like production capital.

## Self-Deployed AMM

Oplier operates its own swap infrastructure on X Layer Testnet. With no third-party DEX currently operating on the testnet in a way Oplier can rely on for this environment, **we built our own production-grade swap infrastructure** using the unmodified Uniswap V2 reference architecture.

The deployment uses the standard **Factory, Router, and Pair** contracts, including LP-token behavior, reentrancy protection, TWAP price accumulators, minimum-liquidity protection, and flash-swap support. Oplier therefore has a complete onchain swap venue under its own control for the testnet environment.

### Deployed infrastructure

| Contract | Address |
|---|---|
| UniswapV2Factory | `0xc6d2AC7810CDEC37674078b04F85afB41F9db481` |
| UniswapV2Router02 | `0x80A90e3123cB073cCA547edF90C25B912D02B40c` |

### Deployed RWA contracts

| Asset | Contract address |
|---|---|
| AAPLx | `0x3b5AF698A5F684AC723Ac2501B9183e875bFFd4A` |
| GLDx | `0xf6dF132E97351D90c5792F1b763082F598cC3988` |
| METAx | `0xE9f6B8264adE8F010EA3F80082542C545dd65808` |
| NVDAx | `0xE7F5486861C7C1cEE138e5b350f6BdfE68309A4C` |

## Try It

1. Get **USDG** and **OKB** from the [OKX X Layer Faucet](https://web3.okx.com/xlayer/faucet/xlayerfaucet).
2. Open the live Oplier app: **[Launch Oplier](YOUR_LIVE_APP_URL)**

## Supported Assets

| Symbol | Underlying | Network | Contract address |
|---|---|---|---|
| AAPLx | AAPL | X Layer Testnet | `0x3b5AF698A5F684AC723Ac2501B9183e875bFFd4A` |
| GLDx | GLD | X Layer Testnet | `0xf6dF132E97351D90c5792F1b763082F598cC3988` |
| METAx | META | X Layer Testnet | `0xE9f6B8264adE8F010EA3F80082542C545dd65808` |
| NVDAx | NVDA | X Layer Testnet | `0xE7F5486861C7C1cEE138e5b350f6BdfE68309A4C` |
| USDG | USDG | X Layer Testnet | `0xa78e2baabaf5c4f36b7fc394725deb68d332eec1` |

## Links

- **Website:** [Oplier](YOUR_WEBSITE_URL)
- **Live app:** [Launch Oplier](YOUR_LIVE_APP_URL)
- **X / Twitter:** [Oplier on X](https://useoplier/x.com)

---

Built for **OKX's Build X Series**.
