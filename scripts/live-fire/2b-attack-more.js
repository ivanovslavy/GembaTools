// Live-fire step 2b — extra REAL on-chain attack: A2 orderId replay.
// The contract checks usedSignatures[hash] (which includes the nonce) but NEVER
// checks usedOrders[orderId] (it only writes it) — so a single business order can
// authorise unlimited mints: the signer just bumps the nonce. This reuses the
// deploy from 1-deploy.js and the funded bob wallet from 2-attack.js.
//   npx hardhat run scripts/live-fire/2b-attack-more.js --network sepolia
require("dotenv").config();
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const FEE = ethers.parseEther("0.001");
const results = [];
const rec = (n, s, det) => { results.push({ name: n, status: s, detail: det }); console.log(`  [${s}] ${n}${det ? " — " + det : ""}`); };

async function sign(signer, to, orderId, nonce, contractAddr, chainId) {
  const h = ethers.solidityPackedKeccak256(
    ["address", "bytes32", "uint256", "address", "uint256"], [to, orderId, nonce, contractAddr, chainId]);
  return signer.signMessage(ethers.getBytes(h));
}

async function main() {
  const [d] = await ethers.getSigners();
  const D = JSON.parse(fs.readFileSync(path.join(__dirname, "deployed.json"), "utf8")).contracts;
  const actors = JSON.parse(fs.readFileSync(path.join(__dirname, "actors.json"), "utf8"));
  const bob = new ethers.Wallet(actors[0].privateKey, ethers.provider);
  console.log(`network ${network.name} | distributor ${d.address} | bob ${bob.address}`);

  // fresh AdvancedNFT collection (d = owner = the signer)
  const f = await ethers.getContractAt("GembaERC721AFactory", D.erc721aFactory, d);
  const a = await f.createToken.staticCall("A2", "A2", "ipfs://x/", 100n, 500, d.address, { value: FEE });
  await (await f.createToken("A2", "A2", "ipfs://x/", 100n, 500, d.address, { value: FEE })).wait();
  const c = await ethers.getContractAt("GembatoolsAdvancedNFT", a, d);
  rec("advancedNFT deployed for A2", "OK", a);

  const chainId = (await ethers.provider.getNetwork()).chainId;
  const addr = await c.getAddress();
  const orderId = ethers.id("order-42"); // ONE business order → should authorise ONE mint

  // mint #1 under the order (nonce 1)
  const sig1 = await sign(d, bob.address, orderId, 1, addr, chainId);
  await (await c.connect(bob).mintWithSignature(bob.address, orderId, 1, sig1)).wait();
  const used = await c.usedOrders(orderId);
  rec("order marked used", used ? "OK" : "?", `usedOrders[order]=${used}, bob balance=${await c.balanceOf(bob.address)}`);

  // A2 fix: reuse the SAME orderId with a FRESH nonce (owner signs again) — now
  // blocked because usedOrders[orderId] is enforced.
  const sig2 = await sign(d, bob.address, orderId, 2, addr, chainId);
  let reused = false;
  try { await (await c.connect(bob).mintWithSignature(bob.address, orderId, 2, sig2)).wait(); reused = true; } catch {}
  rec("A2 orderId reuse (fresh nonce)", reused ? "CONFIRMED" : "DEFEATED",
    reused ? `same orderId minted AGAIN (bob balance=${await c.balanceOf(bob.address)})` : "rejected — usedOrders now enforced (A2 fixed)");

  // Control: the EXACT same signature (same nonce) is also blocked by usedSignatures.
  let exact = false;
  try { await (await c.connect(bob).mintWithSignature(bob.address, orderId, 1, sig1)).wait(); exact = true; } catch {}
  rec("exact-signature replay (control)", exact ? "CONFIRMED" : "DEFEATED",
    exact ? "same sig reused!" : "blocked (usedOrders + usedSignatures)");

  fs.writeFileSync(path.join(__dirname, "attack-results-2b.json"), JSON.stringify(results, null, 2));
  console.log("\n=== SUMMARY (2b) ===");
  for (const r of results) console.log(`  ${r.status.padEnd(12)} ${r.name}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
