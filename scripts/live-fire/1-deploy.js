// Live-fire step 1 — deploy the whole GembaTools platform fresh on Sepolia.
// Run: npx hardhat run scripts/live-fire/1-deploy.js --network sepolia
require("dotenv").config();
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const FEE = ethers.parseEther("0.001"); // small creation fee for the run
const SWAP_FEE_BPS = 30n;

async function main() {
  const [d] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(d.address);
  console.log(`network ${network.name} | distributor ${d.address} | balance ${ethers.formatEther(bal)} ETH`);

  const dep = async (name, ...args) => {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args); await c.waitForDeployment();
    const a = await c.getAddress(); console.log(`  ${name.padEnd(26)} ${a}`); return a;
  };

  const contracts = {};
  contracts.erc20Factory    = await dep("GembaERC20Factory", d.address, d.address, FEE);
  contracts.taxFactory      = await dep("GembaERC20TaxFactory", d.address, d.address, FEE);
  contracts.advancedFactory = await dep("GembaERC20AdvancedFactory", d.address, d.address, FEE);
  contracts.erc721Factory   = await dep("GembaERC721Factory", d.address, d.address, FEE);
  contracts.erc721aFactory  = await dep("GembaERC721AFactory", d.address, d.address, FEE);
  contracts.erc1155Factory  = await dep("GembaERC1155Factory", d.address, d.address, FEE);

  // Swap router over the REAL Uniswap V3 on Sepolia
  const router = process.env.UNISWAP_V3_ROUTER;
  const weth = process.env.WETH9;
  if (!router || !weth) throw new Error("Set UNISWAP_V3_ROUTER + WETH9 in .env for the swap router");
  contracts.swapRouter = await dep("GembaSwapRouter", router, weth, d.address, SWAP_FEE_BPS);

  const out = { network: network.name, distributor: d.address, startBalanceWei: bal.toString(), feeCreation: FEE.toString(), contracts };
  const p = path.join(__dirname, "deployed.json");
  fs.writeFileSync(p, JSON.stringify(out, null, 2));
  console.log(`\nwrote ${p}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
