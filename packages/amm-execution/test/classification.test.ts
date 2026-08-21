import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyRevertReason, classifySubmissionError } from "../src/classification/classify-error.js";

test("classifyRevertReason: INSUFFICIENT_LIQUIDITY is non-retryable", () => {
  const result = classifyRevertReason("UniswapV2: INSUFFICIENT_LIQUIDITY");
  assert.equal(result.retryable, false);
  assert.equal(result.reason, "NO_LIQUIDITY");
});

test("classifyRevertReason: INSUFFICIENT_OUTPUT_AMOUNT (on-chain slippage breach) is retryable", () => {
  const result = classifyRevertReason("UniswapV2: INSUFFICIENT_OUTPUT_AMOUNT");
  assert.equal(result.retryable, true);
  assert.equal(result.reason, "SLIPPAGE_BREACH");
});

test("classifyRevertReason: EXPIRED deadline is retryable", () => {
  const result = classifyRevertReason("UniswapV2Router: EXPIRED");
  assert.equal(result.retryable, true);
  assert.equal(result.reason, "DEADLINE_EXPIRED");
});

test("classifyRevertReason: unrecognized revert defaults to non-retryable", () => {
  const result = classifyRevertReason("some totally unknown revert string");
  assert.equal(result.retryable, false);
  assert.equal(result.reason, "UNCLASSIFIED_REVERT");
});

test("classifyRevertReason: undefined revert reason defaults to non-retryable", () => {
  const result = classifyRevertReason(undefined);
  assert.equal(result.retryable, false);
});

test("classifySubmissionError: RPC timeout is retryable", () => {
  const result = classifySubmissionError(new Error("request ETIMEDOUT"));
  assert.equal(result.retryable, true);
  assert.equal(result.reason, "RPC_TRANSIENT");
});

test("classifySubmissionError: nonce conflict is retryable", () => {
  const result = classifySubmissionError(new Error("nonce too low"));
  assert.equal(result.retryable, true);
});

test("classifySubmissionError: unknown error defaults to non-retryable", () => {
  const result = classifySubmissionError(new Error("totally novel failure mode"));
  assert.equal(result.retryable, false);
  assert.equal(result.reason, "UNCLASSIFIED_SUBMISSION_ERROR");
});
