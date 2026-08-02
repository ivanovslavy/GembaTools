const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, FEE } = require("./helpers/fixtures");

// All 6 factories share the pattern: createToken payable, require msg.value>=fee,
// fee→recipient, refund excess, owner-only setters. Test the shared invariants.
describe("Factories — fee / refund / access", () => {
  it("charges the creation fee to feeRecipient and refunds excess", async () => {
    const { erc20Factory, feeRecipient, alice } = await loadFixture(deployAll);
    const recvBefore = await ethers.provider.getBalance(feeRecipient.address);
    const aliceBefore = await ethers.provider.getBalance(alice.address);
    const overpay = ethers.parseEther("0.5");
    const tx = await erc20Factory.connect(alice).createToken("N", "S", 18, 1000n, { value: FEE + overpay });
    const rc = await tx.wait();
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(recvBefore + FEE);
    // alice paid FEE + gas, the overpay was refunded
    const spent = aliceBefore - (await ethers.provider.getBalance(alice.address));
    expect(spent).to.be.lt(FEE + overpay); // overpay came back
    expect(spent).to.be.gte(FEE);
  });

  it("reverts when msg.value below the creation fee", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    await expect(erc20Factory.connect(alice).createToken("N", "S", 18, 1000n, { value: FEE - 1n }))
      .to.be.reverted;
  });

  it("owner-only setCreationFee / setFeeRecipient", async () => {
    const { erc20Factory, owner, alice } = await loadFixture(deployAll);
    await expect(erc20Factory.connect(alice).setCreationFee(1n)).to.be.reverted;
    await expect(erc20Factory.connect(alice).setFeeRecipient(alice.address)).to.be.reverted;
    await erc20Factory.connect(owner).setCreationFee(ethers.parseEther("0.02"));
    expect(await erc20Factory.creationFee()).to.equal(ethers.parseEther("0.02"));
  });

  it("all 6 factories deploy a working contract for the exact fee", async () => {
    const f = await loadFixture(deployAll);
    // ERC20
    await f.erc20Factory.connect(f.alice).createToken("A", "A", 18, 1n, { value: FEE });
    // Tax
    await f.taxFactory.connect(f.alice).createToken("B", "B", 18, 1n, f.bob.address, 500n, { value: FEE });
    // Advanced
    await f.advancedFactory.connect(f.alice).createToken("C", "C", 18, 100n, 0n, f.bob.address, 0, 0, 0, false, false, false, { value: FEE });
    // ERC721
    await f.erc721Factory.connect(f.alice).createToken("D", "D", 100n, "ipfs://d/", "ipfs://d.json", f.bob.address, 500, { value: FEE });
    // ERC721A / AdvancedNFT
    await f.erc721aFactory.connect(f.alice).createToken("E", "E", "ipfs://e/", 100n, 500, f.bob.address, { value: FEE });
    // ERC1155
    await f.erc1155Factory.connect(f.alice).createToken(
      { name: "F", symbol: "F", uri: "ipfs://f/", contractURI: "ipfs://f.json", numberOfIds: 5n, supplyPerToken: 100n, royaltyReceiver: f.bob.address, royaltyFee: 500 },
      { value: FEE });
  });
});
