const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, FEE, vx } = require("./helpers/fixtures");

// All 6 factories share the pattern: createToken payable + a one-time backend voucher
// (FeeVoucher), voucher fee→recipient, refund excess, owner-only setters. Shared invariants.
describe("Factories — fee / refund / access", () => {
  it("charges the voucher's native fee to feeRecipient and refunds excess", async () => {
    const { erc20Factory, feeRecipient, alice } = await loadFixture(deployAll);
    const recvBefore = await ethers.provider.getBalance(feeRecipient.address);
    const aliceBefore = await ethers.provider.getBalance(alice.address);
    const overpay = ethers.parseEther("0.5");
    const tx = await erc20Factory.connect(alice).createToken("N", "S", 18, 1000n, ...(await vx(erc20Factory, alice)), { value: FEE + overpay });
    await tx.wait();
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(recvBefore + FEE);
    // alice paid FEE + gas, the overpay was refunded
    const spent = aliceBefore - (await ethers.provider.getBalance(alice.address));
    expect(spent).to.be.lt(FEE + overpay); // overpay came back
    expect(spent).to.be.gte(FEE);
  });

  it("reverts when msg.value is below the voucher's fee (InsufficientFee)", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    await expect(erc20Factory.connect(alice).createToken("N", "S", 18, 1000n, ...(await vx(erc20Factory, alice)), { value: FEE - 1n }))
      .to.be.revertedWithCustomError(erc20Factory, "InsufficientFee");
  });

  it("owner-only setVoucherSigner / setFeeRecipient; the old fixed creationFee is gone", async () => {
    const { erc20Factory, owner, alice } = await loadFixture(deployAll);
    await expect(erc20Factory.connect(alice).setVoucherSigner(alice.address)).to.be.reverted;
    await expect(erc20Factory.connect(alice).setFeeRecipient(alice.address)).to.be.reverted;
    await erc20Factory.connect(owner).setVoucherSigner(alice.address);
    expect(await erc20Factory.voucherSigner()).to.equal(alice.address);
    expect(erc20Factory.interface.getFunction("creationFee", [])).to.equal(null);
    expect(erc20Factory.interface.getFunction("setCreationFee", [])).to.equal(null);
  });

  it("all 6 factories deploy a working contract for the exact fee", async () => {
    const f = await loadFixture(deployAll);
    // ERC20
    await f.erc20Factory.connect(f.alice).createToken("A", "A", 18, 1n, ...(await vx(f.erc20Factory, f.alice)), { value: FEE });
    // Tax
    await f.taxFactory.connect(f.alice).createToken("B", "B", 18, 1n, f.bob.address, 500n, ...(await vx(f.taxFactory, f.alice)), { value: FEE });
    // Advanced
    await f.advancedFactory.connect(f.alice).createToken("C", "C", 18, 100n, 0n, f.bob.address, 0, 0, 0, false, false, false, ...(await vx(f.advancedFactory, f.alice)), { value: FEE });
    // ERC721
    await f.erc721Factory.connect(f.alice).createToken("D", "D", 100n, "ipfs://d/", "ipfs://d.json", f.bob.address, 500, ...(await vx(f.erc721Factory, f.alice)), { value: FEE });
    // ERC721A / AdvancedNFT
    await f.erc721aFactory.connect(f.alice).createToken("E", "E", "ipfs://e/", 100n, 500, f.bob.address, ...(await vx(f.erc721aFactory, f.alice)), { value: FEE });
    // ERC1155
    await f.erc1155Factory.connect(f.alice).createToken(
      { name: "F", symbol: "F", uri: "ipfs://f/", contractURI: "ipfs://f.json", numberOfIds: 5n, supplyPerToken: 100n, royaltyReceiver: f.bob.address, royaltyFee: 500 }, ...(await vx(f.erc1155Factory, f.alice)), { value: FEE });
  });
});
