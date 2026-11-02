# GembaTools — Contract Test & Audit Suite

Full adversarial test suite for the 13 GembaTools contracts (6 factories + 6
token/NFT templates + the Uniswap-V3 `GembaSwapRouter`). Single target network for
live-fire: **Sepolia** (the swap router needs a real Uniswap V3 deployment, which
Sepolia has and GembaBlockchain does not).

| Layer | Tool | What it does |
|-------|------|--------------|
| unit / access / attacks / invariants | Hardhat + Mocha/Chai | 73 tests (41 original + 16 fee-voucher + 11 PersonalWallet factory + 5 owner mint-signer tool) |
| property fuzzing + stateful invariants | Foundry (`forge`) | 3 fuzz ×10 000 runs + 3 invariants ×10 240 calls (incl. replayed / stolen / under-paid vouchers, PersonalWallet owner sets) |
| static analysis | Slither | 33 results, 0 high (see classification below) |
| symbolic execution | Mythril | all 13 production contracts — 0 issues |
| local E2E dry-run | Hardhat script | full deploy→create→attack→sweep flow on a local node |
| **live-fire (Sepolia)** | Hardhat scripts | the same attacks as REAL transactions + sweep-back + spend report |

**No production contract is modified by any of this.** Test/mocks/attackers live in
`contracts/test/` and are never deployed by the factories.

---

## Prerequisites
```bash
npm install                                  # Hardhat toolbox + OZ + erc721a
git clone --depth 1 https://github.com/foundry-rs/forge-std.git lib/forge-std   # Foundry std (once)
pipx install slither-analyzer                # Slither (once)
cp .env.example .env                         # then fill in DEPLOYER_PRIVATE_KEY, SWEEP_TO, etc.
```
All secrets live in `.env` (gitignored). See `.env.example` for every variable the
suite needs (funding key, sweep targets, Sepolia RPC, Uniswap V3 addresses).

## 1. Hardhat suite (unit + access + attacks + invariants)
```bash
npx hardhat test                 # all 73 tests
npx hardhat coverage             # line/branch coverage
```
Files (`test/`): `helpers/fixtures.js` deploys all 6 factories + the swap router
(mocked Uniswap) + actors; `01`..`06` cover each token/NFT template; `07` the
factories (fee/refund/access); `08` the swap router (fee/slippage/wrap/deadline);
`09` the attacker contracts; `10` cross-cutting invariants; `11` fee vouchers (single use, bound to
creator/type/chain/factory, expiry, fail-closed signer, malleability); `12` the PersonalWallet factory (audited
bytecode, 2-of-3 flows, veto, errors); `13` the owner's mint-signature tool (`tools/mint-signer.js`).
Contract canaries (each re-introduced defect must turn the suite red): `~/Documents/Claude/GembaTools-scripts/canary-contracts.py`.

Attacker/mock contracts (`contracts/test/`): `Mocks.sol` (MockERC20/721,
MockWETH9, MockSwapRouter), `FeeOnTransferERC20`, `Attackers.sol`
(ReentrantFactoryCaller, RejectingReceiver, ReentrantSwapReceiver).

## 2. Foundry fuzz + invariants
```bash
forge test            # 2 fuzz (tax conservation, presale caps) + 2 invariants (factory fee/no-trapped-eth)
```
(`via_ir = true` is set — a couple of contracts are stack-deep without it.)

## 3. Slither
```bash
./slither.sh          # writes slither-report.txt, production contracts only
```

## 3b. Mythril (symbolic execution)
```bash
# myth-solc.json carries the OZ/erc721a remappings + optimizer + viaIR (needed to compile)
for C in $(ls contracts/*.sol | xargs -n1 basename | sed 's/.sol//'); do
  myth analyze contracts/$C.sol --solc-json myth-solc.json --solv 0.8.27 --execution-timeout 480
done
```
All 13 production contracts return "No issues were detected."

## 4. Local E2E dry-run (before Sepolia)
```bash
npx hardhat run scripts/e2e-local.js
```
Deploys the platform (mocked Uniswap), runs a full user journey + the attacks + the
sweep mechanics on the in-process node — the confidence check before spending real
Sepolia ETH.

## 5. Live-fire on Sepolia
See `scripts/live-fire/README.md`. In short:
```bash
npx hardhat run scripts/live-fire/1-deploy.js       --network sepolia   # deploy platform + router
npx hardhat run scripts/live-fire/2-attack.js       --network sepolia   # reentrancy + sig-replay attacks
npx hardhat run scripts/live-fire/2b-attack-more.js --network sepolia   # A2 orderId-replay attack
npx hardhat run scripts/live-fire/2c-unwrap.js      --network sepolia   # WETH → ETH (from wrap attacks)
npx hardhat run scripts/live-fire/3-sweep.js        --network sepolia          # interim → distributor
FINAL=1 npx hardhat run scripts/live-fire/3-sweep.js --network sepolia         # final → FINAL_SWEEP_TO
```

---

## Findings + remediation (all fixed & re-verified on Sepolia)
| # | Severity | Finding | Fix | Status |
|---|----------|---------|-----|--------|
| A1 | 🔴 | **AdvancedNFT `mintWithSignature` cross-contract / cross-chain replay** — signed hash `keccak(to,orderId,nonce)` had no `address(this)`/`chainid`, so one owner signature was valid on every collection/chain. | hash is now `keccak(to,orderId,nonce,address(this),block.chainid)` | ✅ FIXED — replay DEFEATED on-chain |
| A2 | 🟠 | **AdvancedNFT `usedOrders`** was written but never checked → an orderId was reusable with a fresh nonce. | `require(!usedOrders[orderId])` enforces one mint per order | ✅ FIXED — reuse DEFEATED on-chain |
| A3 | 🟠 | **SwapRouter fee-on-transfer unsupported** — pulled `amountIn` then swapped `amountIn`; a fee-on-transfer token left the router short → revert. | measures `balanceAfter−balanceBefore` and swaps the actual amount | ✅ FIXED — FoT swap succeeds (test 09) |
| A4 | 🟠 | **SwapRouter used `approve` (not `forceApprove`)** — USDT-style / no-bool-return tokens broke. | `SafeERC20.forceApprove` on all approve paths | ✅ FIXED — no-return token swaps (test 09) |
| A5 | 🟢 | SwapRouter `swapTokensForTokens` intermediate hop uses `amountOutMinimum:0` (sandwichable on hop 1; overall output still guarded by the final min-out). | accepted by design — a per-hop min would change the function signature | ☑ ACCEPTED |
| A6 | 🟢 | SwapRouter `wrapETH` ignored the `WETH9.transfer` return value (Slither `unchecked-transfer`). | `require(WETH9.transfer(...), "weth transfer failed")` | ✅ FIXED — test 09 (`FalseReturnWETH9`) |

### Static analysis — final pass (post-fix)
- **Mythril** — symbolic execution over all 13 production contracts: **0 issues**.
- **Slither** — 33 results, **0 high / 0 real medium**. Everything remaining is
  informational / by-design and classified as accepted:
  - `arbitrary-send-eth` (5) — the fee/refund/payout `.call{value:}` go to the
    owner-configured `feeRecipient` or to `msg.sender` (the caller), never an
    attacker-chosen address; all under `nonReentrant` + CEI. Not exploitable.
  - `low-level-calls` — the `.call{value:}` ETH-send pattern (the recommended way).
  - `abi-encodePacked` — flagged on the **tokenURI string** concat, not a hash
    pre-image; the `mintWithSignature` hash uses only fixed-size types (no collision).
  - `block-timestamp` / `dangerous-strict-equalities` — presale/anti-bot timing and
    the `antiBotStartTime == 0` unset check; inherent and safe.
  - `dead-code`, `naming` (`WETH9`), `cyclomatic-complexity`, `costly-loop`
    (`_safeMint` in plain-ERC721 batch), `immutable` suggestions — cosmetic / gas
    only; no security impact.

The ABI of `mintWithSignature(to,orderId,nonce,signature)` and all swap functions is
**unchanged** — only the signed pre-image and internal accounting changed.

### ⚠️ Owner-side signature generation (A1/A2) — the one off-chain change
The app never generates signatures; the collection owner produces them with an
external tool. After the A1 fix that tool MUST bind the hash to the collection +
chain, and (A2) use a **unique `orderId` per authorization**:
```js
// ethers v6 — run by the collection OWNER
const hash = ethers.solidityPackedKeccak256(
  ["address", "bytes32", "uint256", "address", "uint256"],
  [to, orderId, nonce, collectionAddress, chainId]   // ← collection + chainId are new
);
const signature = await ownerWallet.signMessage(ethers.getBytes(hash));
```
Reusing an `orderId` (even with a fresh nonce) is now rejected on-chain.
