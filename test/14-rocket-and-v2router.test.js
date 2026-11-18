const { expect } = require("chai");
const { loadFixture, mine, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const FactoryArt = require("@uniswap/v2-core/build/UniswapV2Factory.json");
const PairArt = require("@uniswap/v2-core/build/UniswapV2Pair.json");
const RouterArt = require("@uniswap/v2-periphery/build/UniswapV2Router02.json");
const WETHArt = require("@uniswap/v2-periphery/build/WETH9.json");
const { signVoucher, FEE } = require("./helpers/fixtures");

// ROCKET (launch token + its launcher, type 8) and GembaSwapRouterV2 (the V2 sibling of GembaSwapRouter), on a REAL
// Uniswap V2 venue (the official v2-core / v2-periphery bytecode), not a mock.
const E = (x) => ethers.parseEther(String(x));
const DEADLINE = 9_999_999_999n;
const TIERS = [5n, 10n, 15n];

async function venue() {
  const [owner, feeRecipient, alice, bob, carol, mallory, outsider, voucherSigner, taxWallet] = await ethers.getSigners();
  const factory = await new ethers.ContractFactory(FactoryArt.abi, FactoryArt.bytecode, owner).deploy(owner.address);
  const weth = await new ethers.ContractFactory(WETHArt.abi, WETHArt.bytecode, owner).deploy();
  const uniRouter = await new ethers.ContractFactory(RouterArt.abi, RouterArt.bytecode, owner)
    .deploy(await factory.getAddress(), await weth.getAddress());
  const dep = async (name, ...args) => { const c = await (await ethers.getContractFactory(name)).deploy(...args); await c.waitForDeployment(); return c; };
  const rocketFactory = await dep("GembaRocketFactory", owner.address, feeRecipient.address, voucherSigner.address,
    await factory.getAddress(), await weth.getAddress());
  const router = await dep("GembaSwapRouterV2", owner.address, await factory.getAddress(), await weth.getAddress(), feeRecipient.address, 30n);
  const taxFactory = await dep("GembaERC20TaxFactory", owner.address, feeRecipient.address, voucherSigner.address);
  const erc20Factory = await dep("GembaERC20Factory", owner.address, feeRecipient.address, voucherSigner.address);
  return { factory, weth, uniRouter, rocketFactory, router, taxFactory, erc20Factory,
    owner, feeRecipient, alice, bob, carol, mallory, outsider, voucherSigner, taxWallet };
}

async function createRocket(ctx, who, { name = "Moon Dog", symbol = "MDOG", supply = 1_000_000_000n, tiers = TIERS } = {}) {
  const vs = await signVoucher(ctx.rocketFactory, who);
  const tx = await ctx.rocketFactory.connect(who).createToken(name, symbol, supply, ...tiers, ...vs, { value: FEE });
  const rc = await tx.wait();
  const ev = rc.logs.map((l) => { try { return ctx.rocketFactory.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "RocketTokenCreated");
  const token = await ethers.getContractAt("GembaRocketToken", ev.args.tokenAddress);
  const launcher = await ethers.getContractAt("GembaRocketLauncher", ev.args.launcher);
  return { token, launcher, rc };
}

async function launched(ctx, who = ctx.alice, eth = 10) {
  const r = await createRocket(ctx, who);
  await r.launcher.connect(who).launch(who.address, { value: E(eth) });
  const pair = new ethers.Contract(await ctx.factory.getPair(await r.token.getAddress(), await ctx.weth.getAddress()), PairArt.abi, who);
  return { ...r, pair };
}

describe("ROCKET — factory + launcher (type 8)", () => {
  it("creates token + launcher in one call: name/symbol/supply from the creator, 100 % in the launcher, launcher owns the token", async () => {
    const ctx = await loadFixture(venue);
    const before = await ethers.provider.getBalance(ctx.feeRecipient.address);
    const { token, launcher } = await createRocket(ctx, ctx.alice, { name: "Alice Rocket", symbol: "AROCK", supply: 5_000_000n });
    expect(await token.name()).to.equal("Alice Rocket");
    expect(await token.symbol()).to.equal("AROCK");
    expect(await token.totalSupply()).to.equal(E(5_000_000));
    expect(await token.MAX_SUPPLY()).to.equal(E(5_000_000));
    expect(await token.balanceOf(await launcher.getAddress())).to.equal(E(5_000_000));
    expect(await token.owner()).to.equal(await launcher.getAddress());
    expect(await launcher.owner()).to.equal(ctx.alice.address);
    expect(await launcher.token()).to.equal(await token.getAddress());
    expect(await token.factory()).to.equal(await ctx.factory.getAddress());
    expect(await token.weth()).to.equal(await ctx.weth.getAddress());
    expect(await ethers.provider.getBalance(ctx.feeRecipient.address) - before).to.equal(FEE);
    expect(await ctx.rocketFactory.CONTRACT_TYPE()).to.equal(8);
    const list = await ctx.rocketFactory.getTokensByCreator(ctx.alice.address);
    expect(list.length).to.equal(1);
    expect(list[0].launcher).to.equal(await launcher.getAddress());
  });

  it("rejects bad configs: empty name, symbol > 8, zero supply, tiers out of order, tier3 > 300", async () => {
    const ctx = await loadFixture(venue);
    const T = await ethers.getContractFactory("GembaRocketToken");
    for (const opts of [{ name: "" }, { symbol: "TOOLONGSYM" }, { supply: 0n }]) {
      await expect(createRocket(ctx, ctx.alice, opts)).to.be.revertedWithCustomError(T, "InvalidTokenConfig");
    }
    for (const tiers of [[0n, 1n, 2n], [5n, 5n, 6n], [5n, 10n, 10n], [5n, 10n, 301n]]) {
      await expect(createRocket(ctx, ctx.alice, { tiers })).to.be.revertedWithCustomError(T, "InvalidTierConfig");
    }
  });

  it("a voucher of another type does not open the Rocket factory", async () => {
    const ctx = await loadFixture(venue);
    const vs = await signVoucher(ctx.rocketFactory, ctx.alice, { contractType: 2 });
    await expect(ctx.rocketFactory.connect(ctx.alice).createToken("N", "S", 1n, ...TIERS, ...vs, { value: FEE }))
      .to.be.revertedWithCustomError(ctx.rocketFactory, "BadVoucherSignature");
  });

  it("nobody can go around the launcher: setLp / executeTrading are not callable by the creator, the factory or anyone", async () => {
    const ctx = await loadFixture(venue);
    const { token, launcher } = await createRocket(ctx, ctx.alice);
    for (const s of [ctx.alice, ctx.owner, ctx.mallory]) {
      await expect(token.connect(s).setLp(ethers.ZeroAddress)).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
      await expect(token.connect(s).executeTrading()).to.be.revertedWithCustomError(token, "OwnableUnauthorizedAccount");
    }
    await expect(launcher.connect(ctx.mallory).launch(ctx.mallory.address, { value: E(1) })).to.be.revertedWithCustomError(launcher, "NotOwner");
    await expect(launcher.connect(ctx.alice).setToken(ctx.mallory.address)).to.be.revertedWithCustomError(launcher, "NotDeployer");
    await expect(launcher.connect(ctx.alice).launch(ctx.alice.address)).to.be.revertedWithCustomError(launcher, "NoEth");
  });

  it("launch is atomic: pair + 100 % supply + ETH, LP to the recipient, setLp, trading open, ownership renounced", async () => {
    const ctx = await loadFixture(venue);
    const { token, launcher } = await createRocket(ctx, ctx.alice, { supply: 1_000_000n });
    await expect(launcher.connect(ctx.alice).launch(ctx.bob.address, { value: E(3) })).to.emit(launcher, "Launched");
    const pairAddr = await ctx.factory.getPair(await token.getAddress(), await ctx.weth.getAddress());
    const pair = new ethers.Contract(pairAddr, PairArt.abi, ctx.alice);
    expect(await token.lpPair()).to.equal(pairAddr);
    expect(await token.tradingOpen()).to.equal(true);
    expect(await token.owner()).to.equal(ethers.ZeroAddress);
    expect(await token.balanceOf(pairAddr)).to.equal(E(1_000_000));
    expect(await token.balanceOf(await launcher.getAddress())).to.equal(0n);
    expect(await ctx.weth.balanceOf(pairAddr)).to.equal(E(3));
    expect(await pair.balanceOf(ctx.bob.address)).to.be.gt(0n);
    await expect(launcher.connect(ctx.alice).launch(ctx.alice.address, { value: E(1) })).to.be.revertedWithCustomError(launcher, "AlreadyLaunched");
  });

  it("griefing does not block the launch: an empty pair with a WETH dust synced into it", async () => {
    const ctx = await loadFixture(venue);
    const { token, launcher } = await createRocket(ctx, ctx.alice);
    await ctx.factory.createPair(await token.getAddress(), await ctx.weth.getAddress());
    const pairAddr = await ctx.factory.getPair(await token.getAddress(), await ctx.weth.getAddress());
    await ctx.weth.connect(ctx.mallory).deposit({ value: 1000n });
    await ctx.weth.connect(ctx.mallory).transfer(pairAddr, 1000n);
    await new ethers.Contract(pairAddr, PairArt.abi, ctx.mallory).sync();
    // the stock router path is now dead (quote divides by a zero token reserve) …
    await expect(ctx.uniRouter.connect(ctx.mallory).addLiquidityETH(await token.getAddress(), 1n, 0, 0, ctx.mallory.address, DEADLINE, { value: 1n })).to.be.reverted;
    // … the launcher's is not
    await launcher.connect(ctx.alice).launch(ctx.alice.address, { value: E(2) });
    expect(await token.tradingOpen()).to.equal(true);
  });

  it("guardian window works through GembaSwapRouterV2: 1 % cap on buy in tier 1, 50 % sell tax burned, nothing after tier 3", async () => {
    const ctx = await loadFixture(venue);
    const { token } = await launched(ctx, ctx.alice, 100);
    const t = await token.getAddress();
    // a whale buy in tier 1 exceeds 1 % → reverts
    // (the pair wraps the token's MaxWalletExceeded in its own "UniswapV2: TRANSFER_FAILED")
    await expect(ctx.router.connect(ctx.bob).swapETHForTokens(t, 0, DEADLINE, { value: E(50) })).to.be.revertedWith("UniswapV2: TRANSFER_FAILED");
    expect(await token.currentMaxWallet()).to.equal((await token.MAX_SUPPLY()) / 100n);
    // a small buy works
    await ctx.router.connect(ctx.bob).swapETHForTokens(t, 0, DEADLINE, { value: E(0.1) });
    const got = await token.balanceOf(ctx.bob.address);
    expect(got).to.be.gt(0n);
    // sell in the window: half of what is sold is burned
    await token.connect(ctx.bob).approve(await ctx.router.getAddress(), ethers.MaxUint256);
    const supply0 = await token.totalSupply();
    expect(await token.currentSellTaxBps()).to.equal(5000n);
    await ctx.router.connect(ctx.bob).swapTokensForETH(t, got / 2n, 0, DEADLINE);
    const burned = supply0 - (await token.totalSupply());
    expect([5000n, 4000n, 3000n].map((b) => (got / 2n) * b / 10000n)).to.include(burned); // tier of the sell block
    expect(await token.totalTaxBurned()).to.equal(burned);
    // after tier 3: no tax, no cap
    await mine(20);
    expect(await token.currentSellTaxBps()).to.equal(0n);
    const s1 = await token.totalSupply();
    await ctx.router.connect(ctx.bob).swapTokensForETH(t, await token.balanceOf(ctx.bob.address), 0, DEADLINE);
    expect(await token.totalSupply()).to.equal(s1);
  });
});

describe("GembaSwapRouterV2 — same settings as the V3 router, fee-on-transfer safe", () => {
  async function taxed(ctx) {
    const vs = await signVoucher(ctx.taxFactory, ctx.alice);
    const rc = await (await ctx.taxFactory.connect(ctx.alice).createToken("Tax", "TAX", 18, 1_000_000n, ctx.taxWallet.address, 500n, ...vs, { value: FEE })).wait();
    const ev = rc.logs.map((l) => { try { return ctx.taxFactory.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "TaxTokenCreated");
    const token = await ethers.getContractAt("GembaERC20Tax", ev.args.tokenAddress);
    await token.connect(ctx.alice).approve(await ctx.uniRouter.getAddress(), ethers.MaxUint256);
    await ctx.uniRouter.connect(ctx.alice).addLiquidityETH(await token.getAddress(), E(500_000), 0, 0, ctx.alice.address, DEADLINE, { value: E(10) });
    return token;
  }

  it("owner, fee 30 bp, recipient, 1 % hard cap — like GembaSwapRouter", async () => {
    const ctx = await loadFixture(venue);
    expect(await ctx.router.owner()).to.equal(ctx.owner.address);
    expect(await ctx.router.platformFee()).to.equal(30n);
    expect(await ctx.router.MAX_FEE()).to.equal(100n);
    expect(await ctx.router.feeRecipient()).to.equal(ctx.feeRecipient.address);
    await expect(ctx.router.setFee(101n)).to.be.revertedWith("fee too high");
    await expect(ctx.router.connect(ctx.mallory).setFee(10n)).to.be.revertedWithCustomError(ctx.router, "OwnableUnauthorizedAccount");
    await expect(ctx.router.connect(ctx.mallory).setFeeRecipient(ctx.mallory.address)).to.be.revertedWithCustomError(ctx.router, "OwnableUnauthorizedAccount");
    await expect(ctx.mallory.sendTransaction({ to: await ctx.router.getAddress(), value: 1n })).to.be.revertedWith("only weth");
  });

  it("Tax token: a stranger buys and SELLS (the trade that reverts on V3); the token tax is taken ONCE, the platform fee exactly 0.3 %", async () => {
    const ctx = await loadFixture(venue);
    const token = await taxed(ctx); const t = await token.getAddress();
    const fr0 = await ethers.provider.getBalance(ctx.feeRecipient.address);
    await ctx.router.connect(ctx.bob).swapETHForTokens(t, 1n, DEADLINE, { value: E(1) });
    expect(await ethers.provider.getBalance(ctx.feeRecipient.address) - fr0).to.equal(E(1) * 30n / 10000n);
    const bought = await token.balanceOf(ctx.bob.address);
    expect(bought).to.be.gt(0n);
    await token.connect(ctx.bob).approve(await ctx.router.getAddress(), ethers.MaxUint256);
    const tw0 = await token.balanceOf(ctx.taxWallet.address);
    const eth0 = await ethers.provider.getBalance(ctx.bob.address);
    const tx = await ctx.router.connect(ctx.bob).swapTokensForETH(t, bought, 1n, DEADLINE);
    const rc = await tx.wait();
    expect(await token.balanceOf(ctx.taxWallet.address) - tw0).to.equal(bought * 500n / 10000n); // ONE tax hop
    expect(await ethers.provider.getBalance(ctx.bob.address) + rc.gasUsed * rc.gasPrice).to.be.gt(eth0);
  });

  it("amountOutMin is checked against what the wallet REALLY received (after the token's tax)", async () => {
    const ctx = await loadFixture(venue);
    const token = await taxed(ctx); const t = await token.getAddress();
    const [rEth, rTok] = await ctx.router.getReserves(await ctx.weth.getAddress(), t);
    const gross = await ctx.router.getAmountOut(E(1) * 9970n / 10000n, rEth, rTok);
    await expect(ctx.router.connect(ctx.bob).swapETHForTokens(t, gross, DEADLINE, { value: E(1) })).to.be.revertedWith("insufficient output");
    await ctx.router.connect(ctx.bob).swapETHForTokens(t, gross * 9500n / 10000n, DEADLINE, { value: E(1) });
  });

  it("token → token through WETH, fee in the native coin between the hops", async () => {
    const ctx = await loadFixture(venue);
    const tax = await taxed(ctx);
    const vs = await signVoucher(ctx.erc20Factory, ctx.alice);
    const rc = await (await ctx.erc20Factory.connect(ctx.alice).createToken("Plain", "PLN", 18, 1_000_000n, ...vs, { value: FEE })).wait();
    const ev = rc.logs.map((l) => { try { return ctx.erc20Factory.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name?.endsWith("Created"));
    const plain = await ethers.getContractAt("GembaERC20", ev.args[0]);
    await plain.connect(ctx.alice).approve(await ctx.uniRouter.getAddress(), ethers.MaxUint256);
    await ctx.uniRouter.connect(ctx.alice).addLiquidityETH(await plain.getAddress(), E(500_000), 0, 0, ctx.alice.address, DEADLINE, { value: E(10) });
    await plain.connect(ctx.alice).transfer(ctx.bob.address, E(1000));
    await plain.connect(ctx.bob).approve(await ctx.router.getAddress(), ethers.MaxUint256);
    const fr0 = await ethers.provider.getBalance(ctx.feeRecipient.address);
    await ctx.router.connect(ctx.bob).swapTokensForTokens(await plain.getAddress(), await tax.getAddress(), E(1000), 1n, DEADLINE);
    expect(await tax.balanceOf(ctx.bob.address)).to.be.gt(0n);
    expect(await ethers.provider.getBalance(ctx.feeRecipient.address)).to.be.gt(fr0);
    await expect(ctx.router.connect(ctx.bob).swapTokensForTokens(await plain.getAddress(), await plain.getAddress(), 1n, 0, DEADLINE)).to.be.revertedWith("same token");
  });

  it("deadline, zero amounts and a missing pair revert cleanly", async () => {
    const ctx = await loadFixture(venue);
    const token = await taxed(ctx); const t = await token.getAddress();
    const past = BigInt(await time.latest()) - 1n;
    await expect(ctx.router.connect(ctx.bob).swapETHForTokens(t, 0, past, { value: 1n })).to.be.revertedWith("transaction expired");
    await expect(ctx.router.connect(ctx.bob).swapETHForTokens(t, 0, DEADLINE)).to.be.revertedWith("zero value");
    await expect(ctx.router.connect(ctx.bob).swapTokensForETH(t, 0, 0, DEADLINE)).to.be.revertedWith("zero amount");
    await expect(ctx.router.connect(ctx.bob).swapETHForTokens(ctx.mallory.address, 0, DEADLINE, { value: 1n })).to.be.revertedWith("no pair");
  });
});

describe("GembaSwapRouterV2 — randomized properties (40 cases)", () => {
  it("for any tax 0.01–25 % and any trade size: buy then sell never reverts, token tax taken once per hop, platform fee exact", async () => {
    const ctx = await loadFixture(venue);
    let seed = 0x5eed;
    const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
    for (let i = 0; i < 40; i++) {
      const bps = BigInt(1 + rnd(2500));
      const vs = await signVoucher(ctx.taxFactory, ctx.alice);
      const rc = await (await ctx.taxFactory.connect(ctx.alice).createToken("T", "T", 18, 1_000_000n, ctx.taxWallet.address, bps, ...vs, { value: FEE })).wait();
      const tok = await ethers.getContractAt("GembaERC20Tax", rc.logs.map((l) => { try { return ctx.taxFactory.interface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "TaxTokenCreated").args.tokenAddress);
      const t = await tok.getAddress();
      await tok.connect(ctx.alice).approve(await ctx.uniRouter.getAddress(), ethers.MaxUint256);
      await ctx.uniRouter.connect(ctx.alice).addLiquidityETH(t, E(100_000 + rnd(900_000)), 0, 0, ctx.alice.address, DEADLINE, { value: E(1 + rnd(20)) });
      const ethIn = E(1) * BigInt(1 + rnd(1000)) / 1000n;
      const fr0 = await ethers.provider.getBalance(ctx.feeRecipient.address);
      const tw0 = await tok.balanceOf(ctx.taxWallet.address);
      await ctx.router.connect(ctx.bob).swapETHForTokens(t, 0, DEADLINE, { value: ethIn });
      expect(await ethers.provider.getBalance(ctx.feeRecipient.address) - fr0).to.equal(ethIn * 30n / 10000n);
      const got = await tok.balanceOf(ctx.bob.address);
      const buyTax = (await tok.balanceOf(ctx.taxWallet.address)) - tw0;
      expect(buyTax).to.equal((got + buyTax) * bps / 10000n);                     // one taxed hop: pair → buyer
      await tok.connect(ctx.bob).approve(await ctx.router.getAddress(), ethers.MaxUint256);
      const sell = got * BigInt(1 + rnd(100)) / 100n;
      const tw1 = await tok.balanceOf(ctx.taxWallet.address);
      await ctx.router.connect(ctx.bob).swapTokensForETH(t, sell, 0, DEADLINE);
      expect((await tok.balanceOf(ctx.taxWallet.address)) - tw1).to.equal(sell * bps / 10000n); // one taxed hop: seller → pair
      await tok.connect(ctx.bob).transfer(ctx.alice.address, await tok.balanceOf(ctx.bob.address)); // clean slate (to owner: untaxed)
      expect(await ethers.provider.getBalance(await ctx.router.getAddress())).to.equal(0n);       // the router keeps nothing
      expect(await ctx.weth.balanceOf(await ctx.router.getAddress())).to.equal(0n);
    }
  });
});
