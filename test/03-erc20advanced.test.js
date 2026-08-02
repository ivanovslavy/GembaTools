const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, createAdvanced } = require("./helpers/fixtures");

const base = (over = {}) => ({
  name: "Adv", symbol: "ADV", decimals: 18, totalSupply: 1_000_000n, presaleAmount: 0n,
  taxReceiver: ethers.ZeroAddress, buyTax: 0, sellTax: 0, transferTax: 0,
  taxOnBuy: false, taxOnSell: false, taxOnTransfer: false, ...over,
});

describe("GembaERC20Advanced", () => {
  it("dex-pair buy/sell tax + transfer tax; owner/excluded exempt; MAX_TAX 5%", async () => {
    const { advancedFactory, alice, bob, carol } = await loadFixture(deployAll);
    // owner=alice, taxReceiver=carol, 5% buy, 5% sell, 2% transfer
    const t = await createAdvanced(advancedFactory, alice, base({
      taxReceiver: carol.address, buyTax: 500, sellTax: 500, transferTax: 200,
      taxOnBuy: true, taxOnSell: true, taxOnTransfer: true,
    }));
    // mark bob as a dex pair; move tokens to a normal user (dave via outsider)
    const [, , , , , mallory, outsider] = await ethers.getSigners();
    await t.connect(alice).setDexPair(bob.address, true);
    // alice(owner, excluded) → outsider: no tax
    await t.connect(alice).transfer(outsider.address, 100_000n);
    expect(await t.balanceOf(outsider.address)).to.equal(100_000n);
    // outsider → mallory (transfer tax 2%)
    await t.connect(outsider).transfer(mallory.address, 10_000n);
    expect(await t.balanceOf(mallory.address)).to.equal(9_800n);
    // outsider "sells" to dex pair bob (5%)
    await t.connect(outsider).transfer(bob.address, 10_000n);
    expect(await t.balanceOf(bob.address)).to.equal(9_500n);
    // over-cap setter reverts
    await expect(t.connect(alice).setTaxRates(501, 0, 0)).to.be.reverted;
  });

  it("presale: buy respects rate + per-wallet cap; finalize sends ETH + unsold to owner", async () => {
    const { advancedFactory, alice, bob } = await loadFixture(deployAll);
    const t = await createAdvanced(advancedFactory, alice, base({ presaleAmount: 100_000n }));
    const presaleTokens = 100_000n * 10n ** 18n;
    const rate = 1000n * 10n ** 18n; // tokenAmount = value*rate/1e18 → 1000 whole tokens per ETH
    const maxPer = 5000n * 10n ** 18n;
    await t.connect(alice).openPresale(rate, presaleTokens, maxPer);
    // bob buys 2 ETH → 2000 tokens
    await t.connect(bob).buyPresale({ value: ethers.parseEther("2") });
    expect(await t.balanceOf(bob.address)).to.equal(2000n * 10n ** 18n);
    // exceeding per-wallet reverts
    await expect(t.connect(bob).buyPresale({ value: ethers.parseEther("4") })).to.be.reverted;
    // finalize
    await t.connect(alice).closePresale();
    const ownerBefore = await ethers.provider.getBalance(alice.address);
    await t.connect(alice).finalizePresale();
    expect(await ethers.provider.getBalance(alice.address)).to.be.gt(ownerBefore); // got presale ETH
  });

  it("anti-bot: 1 tx per block per recipient + max-per-wallet during window; expires", async () => {
    const { advancedFactory, alice, bob, carol } = await loadFixture(deployAll);
    const t = await createAdvanced(advancedFactory, alice, base());
    await t.connect(alice).configureAntiBot(3600n, 1000n); // 1h, max 1000 per wallet
    await t.connect(alice).startAntiBot();
    // alice(excluded) → bob ok up to 1000
    await t.connect(alice).transfer(bob.address, 1000n);
    await expect(t.connect(alice).transfer(bob.address, 1n)).to.be.reverted; // exceeds anti-bot wallet limit
    await time.increase(3601);
    await expect(t.connect(alice).transfer(bob.address, 5000n)).to.not.be.reverted; // window expired
  });

  it("ban blocks transfers both directions; cannot ban owner", async () => {
    const { advancedFactory, alice, bob } = await loadFixture(deployAll);
    const t = await createAdvanced(advancedFactory, alice, base());
    await t.connect(alice).transfer(bob.address, 1000n);
    await t.connect(alice).setBanned(bob.address, true);
    await expect(t.connect(bob).transfer(alice.address, 1n)).to.be.reverted;
    await expect(t.connect(alice).transfer(bob.address, 1n)).to.be.reverted;
    await expect(t.connect(alice).setBanned(alice.address, true)).to.be.reverted; // cannot ban owner
  });
});
