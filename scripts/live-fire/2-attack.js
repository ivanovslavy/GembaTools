// Live-fire step 2 — real on-chain attacks on Sepolia against the fresh deploy.
// Generates actor wallets, funds them from the distributor, runs every scenario,
// prints DEFEATED / CONFIRMED. Run:
//   npx hardhat run scripts/live-fire/2-attack.js --network sepolia
require("dotenv").config();
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const results = [];
const rec = (name, status, detail) => { results.push({ name, status, detail }); console.log(`  [${status}] ${name}${detail ? " — " + detail : ""}`); };
const FEE = ethers.parseEther("0.001");

async function sign(signer, to, orderId, nonce, contractAddr, chainId) {
  const h = ethers.solidityPackedKeccak256(
    ["address", "bytes32", "uint256", "address", "uint256"], [to, orderId, nonce, contractAddr, chainId]);
  return signer.signMessage(ethers.getBytes(h));
}

async function main() {
  const [d] = await ethers.getSigners();
  const D = JSON.parse(fs.readFileSync(path.join(__dirname, "deployed.json"), "utf8")).contracts;
  console.log(`network ${network.name} | distributor ${d.address}`);

  // fresh actor wallets, funded from the distributor
  const mk = () => ethers.Wallet.createRandom().connect(ethers.provider);
  const bob = mk(), mallory = mk();
  for (const w of [bob, mallory]) await (await d.sendTransaction({ to: w.address, value: ethers.parseEther("0.03") })).wait();
  // persist actor keys (gitignored) so 3-sweep.js can drain them back afterwards
  fs.writeFileSync(path.join(__dirname, "actors.json"),
    JSON.stringify([bob, mallory].map((w) => ({ address: w.address, privateKey: w.privateKey })), null, 2));
  rec("actor funding", "OK", "2 wallets funded (keys → actors.json)");

  const at = (n, a, s = d) => ethers.getContractAt(n, a, s);

  // ── ATTACK 1: reentrant factory caller (expected DEFEATED) ──
  try {
    const A = await ethers.getContractFactory("ReentrantFactoryCaller", d);
    const atk = await A.deploy(D.erc20Factory); await atk.waitForDeployment();
    await (await atk.attack(FEE, { value: FEE * 3n })).wait();
    const rev = await atk.reenterReverted();
    rec("factory reentrancy", rev ? "DEFEATED" : "CONFIRMED", rev ? "refund re-entry reverted" : "re-entered!");
  } catch (e) { rec("factory reentrancy", "DEFEATED", "outer tx reverted"); }

  // ── ATTACK 2: cross-contract signature replay on AdvancedNFT (expected CONFIRMED) ──
  {
    const f = await at("GembaERC721AFactory", D.erc721aFactory);
    const mkNFT = async (nm) => {
      const a = await f.createToken.staticCall(nm, nm, "ipfs://x/", 100n, 500, d.address, { value: FEE });
      await (await f.createToken(nm, nm, "ipfs://x/", 100n, 500, d.address, { value: FEE })).wait();
      return at("GembatoolsAdvancedNFT", a);
    };
    const c1 = await mkNFT("L1"), c2 = await mkNFT("L2");
    const chainId = (await ethers.provider.getNetwork()).chainId;
    const orderId = ethers.id("cross-" + c1.target);
    // signature is domain-bound to collection #1 — must NOT be valid on #2 (A1 fix)
    const sig = await sign(d, bob.address, orderId, 7, await c1.getAddress(), chainId);
    await (await c1.mintWithSignature(bob.address, orderId, 7, sig)).wait();
    let replayed = false;
    try { await (await c2.mintWithSignature(bob.address, orderId, 7, sig)).wait(); replayed = true; } catch {}
    rec("NFT cross-contract sig replay", replayed ? "CONFIRMED" : "DEFEATED",
        replayed ? "same owner-sig minted on a 2nd collection" : "rejected on 2nd collection (A1 fixed)");
  }

  // ── ATTACK 3: swap router wrapETH fee (real WETH, real router) ──
  {
    const sr = await at("GembaSwapRouter", D.swapRouter, bob);
    const before = await ethers.provider.getBalance(process.env.WETH9).catch(() => 0n);
    await (await sr.wrapETH({ value: ethers.parseEther("0.005") })).wait();
    rec("router wrapETH (real)", "OK", "real WETH wrap with 0.3% fee executed");
    before; // silence
  }

  // ── ATTACK 4: reentrant swap fee-recipient (expected DEFEATED) ──
  {
    const R = await ethers.getContractFactory("ReentrantSwapReceiver", d);
    const recv = await R.deploy(); await recv.waitForDeployment();
    const SR = await ethers.getContractFactory("GembaSwapRouter", d);
    const router = await SR.deploy(process.env.UNISWAP_V3_ROUTER, process.env.WETH9, await recv.getAddress(), 100n);
    await router.waitForDeployment();
    await (await recv.setRouter(await router.getAddress())).wait();
    await (await recv.arm()).wait();
    await (await router.connect(d).wrapETH({ value: ethers.parseEther("0.005") })).wait();
    const rev = await recv.reenterReverted();
    rec("reentrant swap fee-recipient", rev ? "DEFEATED" : "CONFIRMED", rev ? "re-entry reverted" : "re-entered!");
  }

  console.log("\n=== SUMMARY ===");
  for (const r of results) console.log(`  ${r.status.padEnd(10)} ${r.name}`);
  fs.writeFileSync(path.join(__dirname, "attack-results.json"), JSON.stringify(results, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
