// Live-fire step 3 — recover test ETH.
//   INTERIM (default): drain actor wallets back to the distributor (SWEEP_TO) for reuse.
//   FINAL (FINAL=1):   also send the distributor's balance to FINAL_SWEEP_TO.
// Run: npx hardhat run scripts/live-fire/3-sweep.js --network sepolia
//      FINAL=1 npx hardhat run scripts/live-fire/3-sweep.js --network sepolia
require("dotenv").config();
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function drain(wallet, to) {
  const bal = await ethers.provider.getBalance(wallet.address);
  if (bal === 0n) return 0n;
  const fee = await ethers.provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice;
  const cost = 21000n * gasPrice * 2n; // 2× buffer so a base-fee bump can't overshoot
  if (bal <= cost) return 0n;
  const value = bal - cost;
  await (await wallet.sendTransaction({ to, value, maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas })).wait();
  return value;
}

async function main() {
  const [d] = await ethers.getSigners();
  const dir = __dirname;
  const deployed = JSON.parse(fs.readFileSync(path.join(dir, "deployed.json"), "utf8"));
  const actors = fs.existsSync(path.join(dir, "actors.json"))
    ? JSON.parse(fs.readFileSync(path.join(dir, "actors.json"), "utf8")) : [];

  const isFinal = process.env.FINAL === "1";
  const distributor = deployed.distributor;
  console.log(`network ${network.name} | distributor ${distributor} | mode ${isFinal ? "FINAL" : "INTERIM"}`);

  // 1) drain every actor wallet back to the distributor
  let recovered = 0n;
  for (const a of actors) {
    const w = new ethers.Wallet(a.privateKey, ethers.provider);
    const got = await drain(w, distributor);
    if (got > 0n) console.log(`  recovered ${ethers.formatEther(got)} ETH from ${a.address}`);
    recovered += got;
  }
  console.log(`recovered from actors: ${ethers.formatEther(recovered)} ETH -> distributor`);

  const distBal = await ethers.provider.getBalance(distributor);
  const start = BigInt(deployed.startBalanceWei || "0");
  const spent = start > distBal ? start - distBal : 0n;
  console.log(`\n=== SPEND REPORT ===`);
  console.log(`  start balance:        ${ethers.formatEther(start)} ETH`);
  console.log(`  distributor now:      ${ethers.formatEther(distBal)} ETH`);
  console.log(`  net spent on run:     ${ethers.formatEther(spent)} ETH`);

  // 2) FINAL only — sweep the distributor to the collection wallet
  if (isFinal) {
    const target = process.env.FINAL_SWEEP_TO;
    if (!target) throw new Error("FINAL=1 but FINAL_SWEEP_TO not set");
    const sent = await drain(d, target);
    console.log(`  FINAL sweep:          ${ethers.formatEther(sent)} ETH -> ${target}`);
  } else {
    console.log(`  interim: ${ethers.formatEther(distBal)} ETH kept in the distributor (${distributor}) for the next run`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
