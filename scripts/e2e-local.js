// Local dev-chain E2E dry-run — validates the FULL platform flow + attack + sweep
// mechanics on the in-process Hardhat network (mocked Uniswap) before touching
// Sepolia. Run:  npx hardhat run scripts/e2e-local.js
const { ethers } = require("hardhat");

const FEE = ethers.parseEther("0.001");
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

async function main() {
  const [d, feeRecv, alice, bob] = await ethers.getSigners();
  const dep = async (n, ...a) => { const f = await ethers.getContractFactory(n); const c = await f.deploy(...a); await c.waitForDeployment(); return c; };

  console.log("1) deploy platform");
  const erc20F = await dep("GembaERC20Factory", d.address, feeRecv.address, FEE);
  const advF   = await dep("GembaERC20AdvancedFactory", d.address, feeRecv.address, FEE);
  const nftF   = await dep("GembaERC721AFactory", d.address, feeRecv.address, FEE);
  const weth   = await dep("MockWETH9");
  const mockR  = await dep("MockSwapRouter");
  const swap   = await dep("GembaSwapRouter", await mockR.getAddress(), await weth.getAddress(), feeRecv.address, 30n);

  console.log("2) user journey — create + interact");
  const t20 = await erc20F.connect(alice).createToken.staticCall("T", "T", 18, 1000n, { value: FEE });
  await (await erc20F.connect(alice).createToken("T", "T", 18, 1000n, { value: FEE })).wait();
  const tok = await ethers.getContractAt("GembaERC20", t20);
  ok((await tok.balanceOf(alice.address)) === 1000n * 10n ** 18n, "ERC20 created + supply to owner");

  await swap.connect(alice).wrapETH({ value: ethers.parseEther("1") });
  ok((await weth.balanceOf(alice.address)) === ethers.parseEther("0.997"), "swap router wrapETH fee = 0.3%");

  console.log("3) attacks");
  const RFC = await dep("ReentrantFactoryCaller", await erc20F.getAddress());
  await RFC.connect(alice).attack(FEE, { value: FEE * 3n });
  ok(await RFC.reenterReverted(), "factory reentrancy DEFEATED");

  const mkNFT = async (nm) => {
    const a = await nftF.connect(alice).createToken.staticCall(nm, nm, "ipfs://x/", 100n, 500, alice.address, { value: FEE });
    await (await nftF.connect(alice).createToken(nm, nm, "ipfs://x/", 100n, 500, alice.address, { value: FEE })).wait();
    return ethers.getContractAt("GembatoolsAdvancedNFT", a);
  };
  const c1 = await mkNFT("L1"), c2 = await mkNFT("L2");
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const orderId = ethers.id("e2e");
  const signFor = async (addr) => alice.signMessage(ethers.getBytes(
    ethers.solidityPackedKeccak256(["address", "bytes32", "uint256", "address", "uint256"], [bob.address, orderId, 1, addr, chainId])));
  const sig1 = await signFor(await c1.getAddress());
  await c1.connect(bob).mintWithSignature(bob.address, orderId, 1, sig1);
  // A1 fixed: the c1 signature must NOT be valid on c2 (domain-bound to collection+chain)
  let crossReplay = false;
  try { await c2.connect(bob).mintWithSignature(bob.address, orderId, 1, sig1); crossReplay = true; } catch {}
  ok(!crossReplay, "A1 FIXED: cross-contract sig replay rejected on 2nd collection");

  console.log("4) fix regressions (A2/A3/A4)");
  // A2: same collection, same orderId, fresh nonce + fresh valid signature → rejected
  let orderReuse = false;
  try {
    const sig2 = await alice.signMessage(ethers.getBytes(ethers.solidityPackedKeccak256(
      ["address", "bytes32", "uint256", "address", "uint256"], [bob.address, orderId, 2, await c1.getAddress(), chainId])));
    await c1.connect(bob).mintWithSignature(bob.address, orderId, 2, sig2); orderReuse = true;
  } catch {}
  ok(!orderReuse, "A2 FIXED: orderId reuse (fresh nonce) rejected");

  // fund the mock DEX with WETH inventory so token→ETH swaps can settle
  await (await weth.deposit({ value: ethers.parseEther("50") })).wait();
  await (await weth.transfer(await mockR.getAddress(), ethers.parseEther("50"))).wait();
  const DL = Math.floor(Date.now() / 1000) + 3600;

  // A3: fee-on-transfer token now swaps (router uses the amount actually received)
  const fot = await dep("FeeOnTransferERC20", 1000); // 10% fee-on-transfer
  await (await fot.mint(alice.address, ethers.parseEther("10"))).wait();
  await (await fot.connect(alice).approve(await swap.getAddress(), ethers.parseEther("10"))).wait();
  let fotOk = true;
  try { await (await swap.connect(alice).swapTokensForETH(await fot.getAddress(), 3000, ethers.parseEther("10"), 0, 0, DL)).wait(); } catch { fotOk = false; }
  ok(fotOk, "A3 FIXED: fee-on-transfer token swaps successfully");

  // A4: no-return approve (USDT-style) token now swaps via forceApprove
  const nrt = await dep("NoReturnApproveToken");
  await (await nrt.mint(alice.address, ethers.parseEther("10"))).wait();
  await (await nrt.connect(alice).approve(await swap.getAddress(), ethers.parseEther("10"))).wait();
  let nrtOk = true;
  try { await (await swap.connect(alice).swapTokensForETH(await nrt.getAddress(), 3000, ethers.parseEther("10"), 0, 0, DL)).wait(); } catch { nrtOk = false; }
  ok(nrtOk, "A4 FIXED: no-return approve token swaps via forceApprove");

  console.log("5) sweep mechanics (local sim)");
  const actor = ethers.Wallet.createRandom().connect(ethers.provider);
  await (await d.sendTransaction({ to: actor.address, value: ethers.parseEther("0.05") })).wait();
  const distBefore = await ethers.provider.getBalance(d.address);
  const fee = await ethers.provider.getFeeData();
  const bal = await ethers.provider.getBalance(actor.address);
  const cost = 21000n * (fee.maxFeePerGas ?? fee.gasPrice) * 2n; // 2× buffer
  await (await actor.sendTransaction({ to: d.address, value: bal - cost })).wait();
  ok((await ethers.provider.getBalance(actor.address)) < cost, "actor wallet drained back to distributor");
  ok((await ethers.provider.getBalance(d.address)) > distBefore, "distributor received the swept ETH");

  console.log(`\nE2E LOCAL: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
