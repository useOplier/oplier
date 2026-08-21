import { test } from "node:test";
import assert from "node:assert/strict";
import { AMM_CORE, POOLS, CHAIN, TREASURY_ADDRESS } from "../src/config/deployment.js";
import { RWA_TOKENS, USDG_TOKEN } from "../src/config/assets.js";

/**
 * Deliverable #1: "Confirmation of Part K's real Factory/Router/pool addresses wired in (no
 * placeholders)." This test pins every address literal against TOKEN_DEPLOYMENT.md's exact
 * text so any future accidental edit (or an LLM "helpfully" swapping in a placeholder) fails
 * loudly instead of silently drifting.
 */

test("chain config matches TOKEN_DEPLOYMENT.md", () => {
  assert.equal(CHAIN.chainId, 1952);
  assert.equal(CHAIN.chainIdHex, "0x7A0");
});

test("treasury address matches TOKEN_DEPLOYMENT.md", () => {
  assert.equal(TREASURY_ADDRESS, "0x4F0826977eF073a66B61C9cD3008519C72392df9");
});

test("AMM core addresses match TOKEN_DEPLOYMENT.md §2 exactly", () => {
  assert.equal(AMM_CORE.weth9, "0xeB4448ED1FA53C4c1b75E3AbAa2EC4ff9F9259Fb");
  assert.equal(AMM_CORE.factory, "0xc6d2AC7810CDEC37674078b04F85afB41F9db481");
  assert.equal(AMM_CORE.router, "0x80A90e3123cB073cCA547edF90C25B912D02B40c");
});

test("all 4 mock RWA token addresses match TOKEN_DEPLOYMENT.md §1 exactly", () => {
  assert.equal(RWA_TOKENS.test_aapl.tokenAddress, "0x3b5AF698A5F684AC723Ac2501B9183e875bFFd4A");
  assert.equal(RWA_TOKENS.test_gold.tokenAddress, "0xf6dF132E97351D90c5792F1b763082F598cC3988");
  assert.equal(RWA_TOKENS.test_meta.tokenAddress, "0xE9f6B8264adE8F010EA3F80082542C545dd65808");
  assert.equal(RWA_TOKENS.test_nvda.tokenAddress, "0xE7F5486861C7C1cEE138e5b350f6BdfE68309A4C");
});

test("USDG address matches TOKEN_DEPLOYMENT.md §1 exactly (real Paxos-issued token, not a placeholder)", () => {
  assert.equal(USDG_TOKEN.tokenAddress, "0xa78e2baabaf5c4f36b7fc394725deb68d332eec1");
  assert.equal(USDG_TOKEN.decimals, 6);
});

test("all 4 pool addresses match TOKEN_DEPLOYMENT.md §3 exactly, with correct seeded/empty status", () => {
  assert.equal(POOLS.test_aapl.pairAddress, "0xA485B84a645dF5a6efD043425261b94a54cbeB7f");
  assert.equal(POOLS.test_aapl.status, "SEEDED");

  assert.equal(POOLS.test_gold.pairAddress, "0xa676f468696EEd80CBc44A3C644e851AC9b3e4a1");
  assert.equal(POOLS.test_gold.status, "EMPTY");

  assert.equal(POOLS.test_meta.pairAddress, "0x59eE33856AdbedCF52fe1bFdE2AE64039e690b89");
  assert.equal(POOLS.test_meta.status, "EMPTY");

  assert.equal(POOLS.test_nvda.pairAddress, "0x54dA4ADd0BC5439d4ec8Dc25fc1AC72D75215FF0");
  assert.equal(POOLS.test_nvda.status, "EMPTY");
});

test("exactly one pool is seeded right now — a canary for when Part K seeds another and this config needs regenerating", () => {
  const seededCount = Object.values(POOLS).filter((p) => p.status === "SEEDED").length;
  assert.equal(
    seededCount,
    1,
    "If this fails because more pools are now seeded, update config/deployment.ts from " +
      "deployments/xLayerTestnet.json — this test intentionally breaks to force that sync.",
  );
});
