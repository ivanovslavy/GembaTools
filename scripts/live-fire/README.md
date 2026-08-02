# GembaTools live-fire — real on-chain audit run on Sepolia

Runs the audit scenarios as REAL broadcast transactions on Sepolia (the single
network for this project — no gemba). Uses the real Uniswap V3 for the swap router.

## Prerequisites (all in the gitignored `.env`)
- `DEPLOYER_PRIVATE_KEY` — the funding/distributor wallet (~10 Sepolia ETH).
- `SEPOLIA_RPC_URL`, `UNISWAP_V3_ROUTER`, `WETH9` (verify against Uniswap docs).
- `SWEEP_TO` — interim recovery target (= the distributor's own address, for reuse).
- `FINAL_SWEEP_TO` — final teardown target (only after everything is fixed).

## Steps
```bash
npx hardhat run scripts/live-fire/1-deploy.js       --network sepolia   # deploy platform + router, writes deployed.json
npx hardhat run scripts/live-fire/2-attack.js       --network sepolia   # actors + reentrancy/sig-replay attacks → attack-results.json
npx hardhat run scripts/live-fire/2b-attack-more.js --network sepolia   # A2 orderId-replay attack → attack-results-2b.json
npx hardhat run scripts/live-fire/2c-unwrap.js      --network sepolia   # convert WETH left by wrap attacks back to ETH
# INTERIM sweep (return test ETH to the distributor for the next run):
npx hardhat run scripts/live-fire/3-sweep.js   --network sepolia
# FINAL sweep (only after everything is fixed + the final test passes):
FINAL=1 npx hardhat run scripts/live-fire/3-sweep.js --network sepolia
```

On the **fixed** contracts every attack is DEFEATED: `2-attack` reports the NFT
cross-contract signature replay (A1) rejected on the 2nd collection, and
`2b-attack-more` reports the orderId reuse (A2) rejected — `usedOrders` is now
enforced. Run `2c-unwrap` before the sweep so the small WETH left by the `wrapETH`
paths is recovered as ETH.

`3-sweep.js` prints the SPEND REPORT (start balance − distributor now = net spent),
drains the ephemeral actor wallets (`actors.json`) back to the distributor, and — in
FINAL mode — sends the distributor's balance to `FINAL_SWEEP_TO` (0x8eB8…).

## Notes
- Optional full DEX swap needs a WETH/token Uniswap V3 pool with liquidity; the
  wrapETH/unwrapWETH router paths are exercised with real WETH and need no pool.
- All generated wallet keys land in `actors.json` (gitignored) so the sweep can
  recover them — never commit it.
- If a signed broadcast is intercepted by the auto-mode classifier, each script is
  a plain `npx hardhat run … --network sepolia` and can be triggered with a `!` prefix.
