# GembaTools — Security Self-Audit

**Project:** GembaTools — no-code Web3 contract factory + Uniswap-V3 DEX toolkit
**Scope:** the 13 production Solidity contracts in [`contracts/`](contracts/)
**Network for live-fire:** Sepolia (the swap router needs a real Uniswap V3 deployment)
**Date:** 2026-08-02
**Auditor / sign-off:** **Slavcho Ivanov — Tech Lead, GembaIT**

---

## 1. Summary

Every production contract was put through a five-layer adversarial test programme —
unit/access/attack tests, property fuzzing, stateful invariants, static analysis,
symbolic execution — and then a **live-fire run on Sepolia** where the attacks were
executed as real on-chain transactions against a fresh deployment.

Six findings were identified (1 high, 4 medium/low, 1 low). **All were remediated**
and the fixes were re-verified both locally and on-chain. Final state:

| Layer | Result |
|-------|--------|
| Hardhat unit / access / attack / invariant tests | **41 / 41 pass** |
| Foundry property fuzzing | **2 fuzz × 10 000 runs — pass** |
| Foundry stateful invariants | **2 invariants × 10 240 calls — pass** |
| Slither static analysis | **33 results, 0 high, 0 real medium** |
| Mythril symbolic execution | **13 / 13 contracts — 0 issues** |
| Local E2E dry-run | **9 / 9 pass** |
| Sepolia live-fire (fixed bytecode) | **every attack DEFEATED** |

The full test sources are committed to this repository and reproducible with the
commands in [`TESTING.md`](TESTING.md).

## 2. Scope — contracts audited

Factories: `GembaERC20Factory`, `GembaERC20TaxFactory`, `GembaERC20AdvancedFactory`,
`GembaERC721Factory`, `GembaERC721AFactory`, `GembaERC1155Factory`.
Templates: `GembaERC20`, `GembaERC20Tax`, `GembaERC20Advanced`, `GembaERC721`,
`GembatoolsAdvancedNFT`, `GembaERC1155`.
DEX: `GembaSwapRouter` (Uniswap-V3 wrapper with a capped platform fee).

Solidity `0.8.27`, optimizer runs 200. Test/mock/attacker contracts live in
[`contracts/test/`](contracts/test/) and are **never** deployed by the factories.

## 3. Methodology — what & how it was tested

| # | Layer | Tooling | Files |
|---|-------|---------|-------|
| 1 | Unit, access-control, events, boundaries, real attacker contracts | Hardhat + Mocha/Chai | [`test/`](test/) (`01`–`10`) |
| 2 | Property fuzzing (tax conservation, presale caps) | Foundry `forge` | [`test-forge/FuzzTokens.t.sol`](test-forge/FuzzTokens.t.sol) |
| 3 | Stateful invariants (fee accounting, no trapped ETH) | Foundry `forge` | [`test-forge/InvariantFactory.t.sol`](test-forge/InvariantFactory.t.sol) |
| 4 | Static analysis | Slither | [`slither.sh`](slither.sh) |
| 5 | Symbolic execution | Mythril | [`myth-solc.json`](myth-solc.json) |
| 6 | Local E2E dry-run | Hardhat script | [`scripts/e2e-local.js`](scripts/e2e-local.js) |
| 7 | **Live-fire — real on-chain attacks** | Hardhat scripts | [`scripts/live-fire/`](scripts/live-fire/) |

Attacker/mocks include a reentrant factory caller, a rejecting fee recipient, a
reentrant swap fee-recipient, a fee-on-transfer ERC20, and a non-standard
(no-bool-return) approve token — each targeting a specific class of vulnerability.

## 4. Findings & remediation

| # | Severity | Finding | Fix | Verified |
|---|----------|---------|-----|----------|
| **A1** | 🔴 High | `GembatoolsAdvancedNFT.mintWithSignature` signed hash was `keccak(to,orderId,nonce)` — no `address(this)`/`chainid`, so one owner signature was valid on **every collection that owner deploys and on every chain** (cross-contract / cross-chain replay). | hash bound to the collection + chain: `keccak(to,orderId,nonce,address(this),block.chainid)` | Hardhat test 06 + live-fire: replay **DEFEATED** on the 2nd collection |
| **A2** | 🟠 Medium | `usedOrders[orderId]` was written but **never checked** — an orderId could authorise unlimited mints (bump the nonce, re-sign). | `require(!usedOrders[orderId])` — one order = one mint | Hardhat test 06 + live-fire: reuse **DEFEATED** |
| **A3** | 🟠 Medium | `GembaSwapRouter` swaps pulled `amountIn` then swapped `amountIn`; a fee-on-transfer token left the router short → revert (whole FoT token class unusable). | measure `balanceAfter − balanceBefore` and swap the actual amount received | Hardhat test 09 — FoT swap succeeds |
| **A4** | 🟠 Medium | Router used `approve` (not `forceApprove`) — USDT-style / no-bool-return tokens reverted. | `SafeERC20.forceApprove` on all approve paths | Hardhat test 09 — no-return-approve token swaps |
| **A5** | 🟢 Low | `swapTokensForTokens` intermediate hop uses `amountOutMinimum:0` (sandwichable on hop 1). | **Accepted by design** — the overall output is still guarded by the final `amountOutMinimum`; a per-hop min would change the public signature. | documented |
| **A6** | 🟢 Low | `wrapETH` ignored the `WETH9.transfer` return value (Slither `unchecked-transfer`). | `require(WETH9.transfer(...), "weth transfer failed")` | Hardhat test 09 (`FalseReturnWETH9`) |

### Off-chain follow-up (not a contract change)
After A1/A2 the **owner-side signature-generation tool** (external to the app) must
bind the hash to the collection + chain and use a unique `orderId` per authorization:
```js
// ethers v6 — run by the collection OWNER
const hash = ethers.solidityPackedKeccak256(
  ["address","bytes32","uint256","address","uint256"],
  [to, orderId, nonce, collectionAddress, chainId]);
const signature = await ownerWallet.signMessage(ethers.getBytes(hash));
```
The consumer app's `mintWithSignature` call and all swap ABIs are unchanged.

## 5. Static-analysis classification (Slither, 33 results)

`reentrancy-eth = 0`, `unchecked-transfer = 0` (post-A6). Everything remaining is
informational / by-design:
- **`arbitrary-send-eth` (5)** — fee/refund/payout `.call{value:}` go to the
  owner-configured `feeRecipient` or to `msg.sender`, never an attacker-chosen
  address; all under `nonReentrant` + checks-effects-interactions. Not exploitable.
- **`low-level-calls`** — the `.call{value:}` ETH-send pattern (the recommended way).
- **`abi-encodePacked`** — flagged on the `tokenURI` string concat, not a hash
  pre-image (the signature hash uses only fixed-size types → no collision).
- **`block-timestamp` / `dangerous-strict-equalities`** — presale/anti-bot timing and
  the `antiBotStartTime == 0` unset check; inherent and safe.
- **`dead-code`, naming, cyclomatic-complexity, costly-loop, immutable suggestions**
  — cosmetic / gas only, no security impact.

## 6. Live-fire on Sepolia — on-chain evidence

Final deployment (fixed bytecode) exercised by the attack suite:

| Contract | Address |
|----------|---------|
| GembaERC20Factory | `0x29CbBCFEf1aFE73fcBC1a7e0EA9fFdd8C6913338` |
| GembaERC20TaxFactory | `0x97611041bD62a4c07004E62F362A6056DF69789D` |
| GembaERC20AdvancedFactory | `0xFdab668E80908862EF149BD631c73392f880165d` |
| GembaERC721Factory | `0x679E94e0Ce0511309131BA366BE99B5Cbd1F8468` |
| GembaERC721AFactory | `0x9689bEfB3346e0a36899C59aB7B62EfeBA260C5c` |
| GembaERC1155Factory | `0xb14FAdcd190CF6675D405B97547Cf8d7C058E573` |
| GembaSwapRouter | `0x26522E88eFf7bd0AeAa63cD1809a23B365144B48` |

Attack results (all real transactions): factory reentrancy — DEFEATED · NFT
cross-contract signature replay (A1) — DEFEATED · NFT orderId reuse (A2) — DEFEATED ·
exact-signature replay — DEFEATED · reentrant swap fee-recipient — DEFEATED ·
`wrapETH` real WETH — OK.

Testnet cost across three live-fire rounds (initial vulnerable + two fixed rounds):
**0.1088 Sepolia ETH**; all remaining test ETH was swept back to the project wallet.

## 7. How to reproduce

Everything is in this repository. See [`TESTING.md`](TESTING.md) for full detail:
```bash
npm install
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std
npx hardhat test                     # 41 unit/access/attack/invariant tests
forge test                           # fuzz + invariants
./slither.sh                         # static analysis
# Mythril: myth analyze contracts/<C>.sol --solc-json myth-solc.json --solv 0.8.27
npx hardhat run scripts/e2e-local.js # local dry-run (no real ETH)
# Live-fire (needs a funded .env): scripts/live-fire/  (see scripts/live-fire/README.md)
```
Secrets (funding key, RPC, sweep targets) live only in a gitignored `.env`; see
[`.env.example`](.env.example).

## 8. Conclusion

All identified issues are remediated and re-verified on-chain. The production
contracts carry no known high- or medium-severity vulnerabilities. The remaining
Slither items are informational/by-design. GembaTools is, in my assessment, safe for
its intended use, subject to the off-chain signing follow-up in §4.

**Slavcho Ivanov**
Tech Lead, GembaIT
2026-08-02
