// Deploys the Uniswap V2 side of GembaTools (18.11.2026):
//   - GembaRocketFactory   — Rocket launch token + its launcher, voucher-gated like every factory (type 8)
//   - GembaSwapRouterV2    — the V2 sibling of GembaSwapRouter (same fee 30 bp, 1 % cap, recipient, owner)
// TESTNETS ONLY. The V2 venue per chain is FIXED here and re-checked on chain before anything is sent.
//
//   OWNER=0x… FEE_RECIPIENT=0x… VOUCHER_SIGNER=0x… npx hardhat run scripts/deploy-rocket-v2.js --network sepolia
//
// Writes scripts/deployed-rocket-v2-<network>.json.
require("dotenv").config();
const { ethers, network, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Uniswap V2 (Sepolia: the official deployment; GembaBlockchain testnet: the chain's V2) — router only used to cross-check.
const VENUES = {
  11155111: { factory: "0xF62c03E08ada871A0bEb309762E260a7a6a880E6", weth: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14", router: "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3" },
  821207:   { factory: "0x15752A99d2e06d001F5d228AA158EbD687276DB4", weth: "0x4A74DB9c9cE285960d01B53a626945DDd100e8d8", router: "0x49Da581bf5C09aE24312574D4835d416EE5eEfd5" },
};
const PLATFORM_FEE_BPS = 30n; // same as GembaSwapRouter

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  const venue = VENUES[Number(chainId)];
  if (!venue) throw new Error(`refusing to deploy on chain ${chainId}: no V2 venue configured (testnets only)`);
  const OWNER = process.env.OWNER, FEE_RECIPIENT = process.env.FEE_RECIPIENT, SIGNER = process.env.VOUCHER_SIGNER;
  for (const [k, v] of Object.entries({ OWNER, FEE_RECIPIENT, VOUCHER_SIGNER: SIGNER })) if (!ethers.isAddress(v || "")) throw new Error(`${k} must be an address`);

  // the venue, read back on chain — not this file's say-so
  const r = new ethers.Contract(venue.router, ["function factory() view returns (address)", "function WETH() view returns (address)"], ethers.provider);
  if ((await r.factory()).toLowerCase() !== venue.factory.toLowerCase()) throw new Error("router.factory() != configured V2 factory");
  if ((await r.WETH()).toLowerCase() !== venue.weth.toLowerCase()) throw new Error("router.WETH() != configured WETH");

  const [d] = await ethers.getSigners();
  const startBal = await ethers.provider.getBalance(d.address);
  console.log(`network ${network.name} (${chainId}) | deployer ${d.address} | balance ${ethers.formatEther(startBal)}`);
  const dep = async (name, ...args) => {
    const c = await (await ethers.getContractFactory(name)).deploy(...args);
    await c.waitForDeployment();
    const a = await c.getAddress();
    const rc = await c.deploymentTransaction().wait();
    console.log(`  ${name.padEnd(22)} ${a}  tx ${rc.hash}`);
    return { address: a, tx: rc.hash, block: rc.blockNumber, args };
  };
  const out = { network: network.name, chainId: Number(chainId), deployer: d.address, owner: OWNER, feeRecipient: FEE_RECIPIENT,
    voucherSigner: SIGNER, venue, deployedAt: new Date().toISOString(), contracts: {} };
  // RESUME (a public RPC answered a read before it had the new code): pass the already-deployed addresses + their txs.
  const resume = async (name, addr, tx, args) => {
    const rc = await ethers.provider.getTransactionReceipt(tx);
    if (!rc || rc.contractAddress?.toLowerCase() !== addr.toLowerCase()) throw new Error(`${name}: ${tx} did not create ${addr}`);
    console.log(`  ${name.padEnd(22)} ${addr}  tx ${tx}  (resumed)`);
    return { address: addr, tx, block: rc.blockNumber, args };
  };
  const rArgs = [OWNER, FEE_RECIPIENT, SIGNER, venue.factory, venue.weth];
  const vArgs = [OWNER, venue.factory, venue.weth, FEE_RECIPIENT, PLATFORM_FEE_BPS];
  out.contracts.rocket = process.env.RESUME_ROCKET
    ? await resume("GembaRocketFactory", ...process.env.RESUME_ROCKET.split(":"), rArgs) : await dep("GembaRocketFactory", ...rArgs);
  out.contracts.swapRouterV2 = process.env.RESUME_ROUTER
    ? await resume("GembaSwapRouterV2", ...process.env.RESUME_ROUTER.split(":"), vArgs) : await dep("GembaSwapRouterV2", ...vArgs);

  // sanity on chain (retried: a load-balanced public RPC may lag a block behind the deploy)
  const retry = async (fn) => { for (let i = 0; ; i++) { try { return await fn(); } catch (e) { if (i >= 10) throw e; await new Promise((r) => setTimeout(r, 3000)); } } };
  const f = await ethers.getContractAt("GembaRocketFactory", out.contracts.rocket.address);
  await retry(async () => {
    if ((await f.voucherSigner()) !== SIGNER || (await f.owner()) !== OWNER || Number(await f.CONTRACT_TYPE()) !== 8
      || (await f.v2Factory()) !== venue.factory || (await f.weth()) !== venue.weth || (await f.feeRecipient()) !== FEE_RECIPIENT) throw new Error("rocket factory state mismatch");
  });
  const rv2 = await ethers.getContractAt("GembaSwapRouterV2", out.contracts.swapRouterV2.address);
  await retry(async () => {
    if ((await rv2.owner()) !== OWNER || (await rv2.feeRecipient()) !== FEE_RECIPIENT || (await rv2.platformFee()) !== PLATFORM_FEE_BPS
      || (await rv2.factory()) !== venue.factory || (await rv2.WETH9()) !== venue.weth) throw new Error("router V2 state mismatch");
  });
  console.log("  on-chain state checked: owner, fee recipient, voucher signer, type 8, venue, 30 bp");

  out.spentWei = (startBal - (await ethers.provider.getBalance(d.address))).toString();
  const file = path.join(__dirname, `deployed-rocket-v2-${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, (k, v) => (typeof v === "bigint" ? v.toString() : v), 2) + "\n");
  console.log(`\nwrote ${path.relative(process.cwd(), file)} — spent ${ethers.formatEther(out.spentWei)}`);

  if (process.env.VERIFY === "1") {
    for (const [k, v] of Object.entries(out.contracts)) {
      try { await run("verify:verify", { address: v.address, constructorArguments: v.args }); console.log(`  verified ${k}`); }
      catch (e) { console.log(`  verify ${k}: ${e.message.split("\n")[0]}`); }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
