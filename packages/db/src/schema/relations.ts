import { relations } from "drizzle-orm";
import { assetRegistry } from "./assets";
import { assetPriceHistory, assetPrices } from "./prices";
import { chatCompactedContext, chatMessages, chats } from "./chat";
import { conditions } from "./conditions";
import { executions } from "./executions";
import { memorySummary } from "./memory";
import { nexusPermissions } from "./nexus";
import { positions } from "./positions";
import { settings } from "./settings";
import { swaps } from "./swaps";
import { systemRuns, systems, systemSteps } from "./systems";
import { transactions } from "./transactions";
import { users } from "./users";

/**
 * Relational query helpers (used via `db.query.*`). These are additive convenience — every
 * relationship here is already enforced by the FKs defined in the individual schema files;
 * this file exists purely so `packages/db`'s consumers get typed relational queries instead
 * of hand-joining everywhere.
 */

export const usersRelations = relations(users, ({ one, many }) => ({
  settings: one(settings, { fields: [users.walletAddress], references: [settings.walletAddress] }),
  memory: one(memorySummary, {
    fields: [users.walletAddress],
    references: [memorySummary.walletAddress],
  }),
  chats: many(chats),
  systems: many(systems),
  positions: many(positions),
  transactions: many(transactions),
}));

export const assetRegistryRelations = relations(assetRegistry, ({ one, many }) => ({
  latestPrice: one(assetPrices, {
    fields: [assetRegistry.assetId],
    references: [assetPrices.assetId],
  }),
  priceHistory: many(assetPriceHistory),
}));

export const systemsRelations = relations(systems, ({ one, many }) => ({
  owner: one(users, { fields: [systems.walletAddress], references: [users.walletAddress] }),
  currentRun: one(systemRuns, {
    fields: [systems.currentRunId],
    references: [systemRuns.id],
  }),
  steps: many(systemSteps),
  runs: many(systemRuns),
  positions: many(positions),
  nexusPermissions: many(nexusPermissions),
}));

export const systemRunsRelations = relations(systemRuns, ({ one, many }) => ({
  system: one(systems, { fields: [systemRuns.systemId], references: [systems.id] }),
  currentStep: one(systemSteps, {
    fields: [systemRuns.currentStepId],
    references: [systemSteps.id],
  }),
  executions: many(executions),
}));

export const systemStepsRelations = relations(systemSteps, ({ one, many }) => ({
  system: one(systems, { fields: [systemSteps.systemId], references: [systems.id] }),
  swap: one(swaps, { fields: [systemSteps.id], references: [swaps.stepId] }),
  conditions: many(conditions),
  executions: many(executions),
}));

export const conditionsRelations = relations(conditions, ({ one }) => ({
  step: one(systemSteps, { fields: [conditions.stepId], references: [systemSteps.id] }),
}));

export const swapsRelations = relations(swaps, ({ one }) => ({
  step: one(systemSteps, { fields: [swaps.stepId], references: [systemSteps.id] }),
  sourceAssetRef: one(assetRegistry, {
    fields: [swaps.sourceAsset],
    references: [assetRegistry.assetId],
  }),
  destinationAssetRef: one(assetRegistry, {
    fields: [swaps.destinationAsset],
    references: [assetRegistry.assetId],
  }),
}));

export const executionsRelations = relations(executions, ({ one, many }) => ({
  system: one(systems, { fields: [executions.systemId], references: [systems.id] }),
  run: one(systemRuns, { fields: [executions.runId], references: [systemRuns.id] }),
  step: one(systemSteps, { fields: [executions.stepId], references: [systemSteps.id] }),
  transactions: many(transactions),
}));

export const positionsRelations = relations(positions, ({ one }) => ({
  owner: one(users, { fields: [positions.walletAddress], references: [users.walletAddress] }),
  system: one(systems, { fields: [positions.systemId], references: [systems.id] }),
  asset: one(assetRegistry, { fields: [positions.assetId], references: [assetRegistry.assetId] }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  owner: one(users, { fields: [transactions.walletAddress], references: [users.walletAddress] }),
  system: one(systems, { fields: [transactions.systemId], references: [systems.id] }),
  execution: one(executions, {
    fields: [transactions.executionId],
    references: [executions.id],
  }),
}));

export const chatsRelations = relations(chats, ({ one, many }) => ({
  owner: one(users, { fields: [chats.walletAddress], references: [users.walletAddress] }),
  messages: many(chatMessages),
  compactedContext: many(chatCompactedContext),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  chat: one(chats, { fields: [chatMessages.chatId], references: [chats.id] }),
}));

export const chatCompactedContextRelations = relations(chatCompactedContext, ({ one }) => ({
  chat: one(chats, { fields: [chatCompactedContext.chatId], references: [chats.id] }),
}));
