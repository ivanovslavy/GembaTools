const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, createTax, createAdvanced, FEE, vx } = require("./helpers/fixtures");

describe("INVARIANTS", () => {
  it("Tax token: tax stays in-supply — Σ balances == totalSupply after taxed transfers", async () => {
    const { taxFactory, alice, bob, carol, mallory, outsider } = await loadFixture(deployAll);
    const t = await createTax(taxFactory, alice, carol.address, 800n); // 8%
    await t.connect(alice).transfer(bob.address, 100_000n);
    await t.connect(bob).transfer(outsider.address, 40_000n);
    await t.connect(outsider).transfer(mallory.address, 10_000n);
    const sum = (await t.balanceOf(alice.address)) + (await t.balanceOf(bob.address)) +
      (await t.balanceOf(carol.address)) + (await t.balanceOf(outsider.address)) +
      (await t.balanceOf(mallory.address));
    expect(sum).to.equal(await t.totalSupply());
  });

  it("Advanced presale: Σ purchased ≤ presale supply; ethCollected == Σ paid", async () => {
    const { advancedFactory, alice, bob, carol } = await loadFixture(deployAll);
    const t = await createAdvanced(advancedFactory, alice, {
      name: "Adv", symbol: "ADV", decimals: 18, totalSupply: 1_000_000n, presaleAmount: 100_000n,
      taxReceiver: ethers.ZeroAddress, buyTax: 0, sellTax: 0, transferTax: 0,
      taxOnBuy: false, taxOnSell: false, taxOnTransfer: false,
    });
    const presaleTokens = 100_000n * 10n ** 18n;
    await t.connect(alice).openPresale(1000n, presaleTokens, 50_000n * 10n ** 18n);
    await t.connect(bob).buyPresale({ value: ethers.parseEther("3") });
    await t.connect(carol).buyPresale({ value: ethers.parseEther("5") });
    const purchased = (await t.presalePurchased(bob.address)) + (await t.presalePurchased(carol.address));
    expect(purchased).to.be.lte(presaleTokens);
    expect(await t.presaleEthCollected()).to.equal(ethers.parseEther("8"));
  });

  it("Factory fee accounting: recipient balance += N × FEE after N creates", async () => {
    const { erc20Factory, feeRecipient, alice, bob, carol } = await loadFixture(deployAll);
    const before = await ethers.provider.getBalance(feeRecipient.address);
    for (const u of [alice, bob, carol]) {
      await erc20Factory.connect(u).createToken("N", "S", 18, 1n, ...(await vx(erc20Factory, u)), { value: FEE });
    }
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(before + FEE * 3n);
  });

  it("Swap router holds no ETH/tokens between txs (funds forwarded atomically)", async () => {
    const { swapRouter, alice } = await loadFixture(deployAll);
    await swapRouter.connect(alice).wrapETH({ value: ethers.parseEther("1") });
    expect(await ethers.provider.getBalance(await swapRouter.getAddress())).to.equal(0n);
  });
});
