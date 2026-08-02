// Live-fire step 2c — convert any WETH held by the distributor or the actor
// wallets (left over from the wrapETH attacks) back into native ETH, so the sweep
// recovers 100% of the value. Uses the REAL Sepolia WETH9 withdraw().
//   npx hardhat run scripts/live-fire/2c-unwrap.js --network sepolia
require("dotenv").config();
const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

const WETH_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function withdraw(uint256) external",
];

async function unwrap(wallet) {
  const weth = new ethers.Contract(process.env.WETH9, WETH_ABI, wallet);
  const bal = await weth.balanceOf(wallet.address);
  if (bal === 0n) return 0n;
  await (await weth.withdraw(bal)).wait();
  console.log(`  unwrapped ${ethers.formatEther(bal)} WETH -> ETH for ${wallet.address}`);
  return bal;
}

async function main() {
  const [d] = await ethers.getSigners();
  const actors = fs.existsSync(path.join(__dirname, "actors.json"))
    ? JSON.parse(fs.readFileSync(path.join(__dirname, "actors.json"), "utf8")) : [];
  let total = 0n;
  total += await unwrap(d);
  for (const a of actors) total += await unwrap(new ethers.Wallet(a.privateKey, ethers.provider));
  console.log(`total unwrapped: ${ethers.formatEther(total)} ETH`);
}
main().catch((e) => { console.error(e); process.exit(1); });
