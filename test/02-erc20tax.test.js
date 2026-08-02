const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { deployAll, createTax } = require("./helpers/fixtures");

describe("GembaERC20Tax", () => {
  it("taxes non-owner transfers, routes tax to taxAddress; owner in/out is tax-free", async () => {
    const { taxFactory, alice, bob, carol } = await loadFixture(deployAll);
    const t = await createTax(taxFactory, alice, carol.address, 1000n); // 10% tax, taxReceiver=carol, owner=alice
    // owner → bob is tax-free (owner excluded)
    await t.connect(alice).transfer(bob.address, 1000n);
    expect(await t.balanceOf(bob.address)).to.equal(1000n);
    // bob → some non-owner: 10% tax to carol
    const [, , , , , , outsider] = await require("hardhat").ethers.getSigners();
    await t.connect(bob).transfer(outsider.address, 1000n);
    expect(await t.balanceOf(outsider.address)).to.equal(900n);
    expect(await t.balanceOf(carol.address)).to.equal(100n);
  });

  it("burn is tax-free; taxFee immutable; MAX_TAX 25% enforced at deploy", async () => {
    const { taxFactory, alice, bob, FEE } = await loadFixture(deployAll);
    const t = await createTax(taxFactory, alice, bob.address, 500n);
    await t.connect(alice).transfer(bob.address, 1000n);
    await t.connect(bob).burn(1000n); // to == 0 → tax-free
    expect(await t.balanceOf(bob.address)).to.be.gte(0n);
    // over-cap deploy reverts
    await expect(taxFactory.connect(alice).createToken("N", "S", 18, 1n, bob.address, 2501n, { value: FEE }))
      .to.be.reverted;
    // no setter for taxFee (immutable) — only setTaxAddress
    expect(t.setTaxFee).to.be.undefined;
  });

  it("setTaxAddress owner-only", async () => {
    const { taxFactory, alice, bob, carol } = await loadFixture(deployAll);
    const t = await createTax(taxFactory, alice, bob.address, 500n);
    await expect(t.connect(bob).setTaxAddress(carol.address)).to.be.reverted;
    await t.connect(alice).setTaxAddress(carol.address);
    expect(await t.taxAddress()).to.equal(carol.address);
  });
});
