const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, createERC20 } = require("./helpers/fixtures");

describe("GembaERC20 (basic)", () => {
  it("mints full supply to owner with correct decimals", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    const t = await createERC20(erc20Factory, alice, { decimals: 6, supply: 500n });
    expect(await t.owner()).to.equal(alice.address);
    expect(await t.decimals()).to.equal(6);
    expect(await t.totalSupply()).to.equal(500n * 10n ** 6n);
    expect(await t.balanceOf(alice.address)).to.equal(500n * 10n ** 6n);
  });

  it("holder can burn own tokens; burnFrom needs allowance", async () => {
    const { erc20Factory, alice, bob } = await loadFixture(deployAll);
    const t = await createERC20(erc20Factory, alice);
    await t.connect(alice).transfer(bob.address, 1000n);
    await t.connect(bob).burn(400n);
    expect(await t.balanceOf(bob.address)).to.equal(600n);
    await expect(t.connect(alice).burnFrom(bob.address, 100n)).to.be.reverted; // no allowance
    await t.connect(bob).approve(alice.address, 100n);
    await t.connect(alice).burnFrom(bob.address, 100n);
    expect(await t.balanceOf(bob.address)).to.equal(500n);
  });

  it("constructor guards: empty name/symbol, long symbol, zero supply rejected (via factory)", async () => {
    const { erc20Factory, alice, FEE } = await loadFixture(deployAll);
    await expect(erc20Factory.connect(alice).createToken("", "S", 18, 1n, { value: FEE })).to.be.reverted;
    await expect(erc20Factory.connect(alice).createToken("N", "TOOLONGSYM", 18, 1n, { value: FEE })).to.be.reverted;
    await expect(erc20Factory.connect(alice).createToken("N", "S", 18, 0n, { value: FEE })).to.be.reverted;
  });
});
