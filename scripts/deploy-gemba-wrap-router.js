// Deploys GembaSwapRouter on GembaBlockchain testnet (821207) for WRAP / UNWRAP only (20.11.2026).
//
// On Sepolia GMB↔WGMB's twin ETH↔WETH goes through GembaSwapRouter.wrapETH / unwrapWETH with the 0.3 % platform
// fee. GembaBlockchain has no Uniswap V3, so that router was never deployed there and the Swap tab could not wrap.
// This deploys the SAME, unchanged contract with the same fee, recipient and owner as Sepolia.
//
// ⚠ The constructor requires a V3 SwapRouter address and GembaBlockchain has none. It is given the chain's Uniswap
//   V2 router as a placeholder: wrapETH / unwrapWETH never touch it, but the V3 swap functions of THIS deployment
//   (swapETHForTokens, swapTokensForETH, swapTokensForTokens) would call a V2 router with a V3 call and revert.
//   The app uses it on this chain for wrap/unwrap only; swaps keep going through GembaSwapRouterV2.
//
//   npx hardhat run scripts/deploy-gemba-wrap-router.js --network gembatestnet
//
// Writes scripts/deployed-gemba-wrap-router.json.
require("dotenv").config();
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OWNER = "0x8eB8Bf106EbC9834a2586D04F73866C7436Ce298";          // as deploy-production.js (Sepolia)
const FEE_RECIPIENT = "0x65124A08c9BFE0A7176668EE351573059Ea38ccC";  // as deploy-production.js (Sepolia)
const SWAP_FEE_BPS = 30n;                                            // 0.3 %, as Sepolia
const WGMB = "0x4A74DB9c9cE285960d01B53a626945DDd100e8d8";
const V2_ROUTER = "0x49Da581bf5C09aE24312574D4835d416EE5eEfd5";      // placeholder for the V3 router slot (see above)

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (Number(chainId) !== 821207) throw new Error(`refusing: chain ${chainId} is not GembaBlockchain testnet (821207)`);

  // WGMB really is the wrapped coin of this chain: the V2 router says so
  const r = new ethers.Contract(V2_ROUTER, ["function WETH() view returns (address)"], ethers.provider);
  if ((await r.WETH()).toLowerCase() !== WGMB.toLowerCase()) throw new Error("V2 router WETH() != WGMB");

  const [d] = await ethers.getSigners();
  console.log(`network ${network.name} (${chainId}) | deployer ${d.address} | balance ${ethers.formatEther(await ethers.provider.getBalance(d.address))} GMB`);

  const F = await ethers.getContractFactory("GembaSwapRouter");
  const sr = await F.deploy(V2_ROUTER, WGMB, FEE_RECIPIENT, SWAP_FEE_BPS);
  await sr.waitForDeployment();
  const addr = await sr.getAddress();
  console.log(`GembaSwapRouter (wrap/unwrap) → ${addr}`);

  // Ownable(msg.sender) → hand over to OWNER, as on Sepolia
  if (d.address.toLowerCase() !== OWNER.toLowerCase()) await (await sr.transferOwnership(OWNER)).wait();

  // read everything back
  const check = {
    WETH9: await sr.WETH9(), feeRecipient: await sr.feeRecipient(), platformFee: (await sr.platformFee()).toString(), owner: await sr.owner(),
  };
  console.log("read back:", check);
  if (check.WETH9.toLowerCase() !== WGMB.toLowerCase() || check.feeRecipient.toLowerCase() !== FEE_RECIPIENT.toLowerCase()
      || check.platformFee !== SWAP_FEE_BPS.toString() || check.owner.toLowerCase() !== OWNER.toLowerCase()) throw new Error("read-back mismatch");

  const out = { network: network.name, chainId: 821207, deployedAt: new Date().toISOString(), deployer: d.address, gembaSwapRouter: addr, ...check,
    note: "wrap/unwrap only — the V3 router slot holds the V2 router as a placeholder" };
  fs.writeFileSync(path.join(__dirname, "deployed-gemba-wrap-router.json"), JSON.stringify(out, null, 2));
  console.log("saved scripts/deployed-gemba-wrap-router.json");
}

main().catch((e) => { console.error(e); process.exit(1); });
