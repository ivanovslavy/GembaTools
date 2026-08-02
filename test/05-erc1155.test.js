const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, createERC1155 } = require("./helpers/fixtures");

const p = (over = {}) => ({
  name: "Multi", symbol: "MLT", uri: "ipfs://m/", contractURI: "ipfs://m.json",
  numberOfIds: 5n, supplyPerToken: 100n, royaltyReceiver: ethers.ZeroAddress, royaltyFee: 500, ...over,
});

describe("GembaERC1155", () => {
  it("owner-only mint / mintBatch; enforces maxSupplyPerToken", async () => {
    const { erc1155Factory, alice, bob } = await loadFixture(deployAll);
    const c = await createERC1155(erc1155Factory, alice, p({ supplyPerToken: 100n, royaltyReceiver: alice.address }));
    await expect(c.connect(bob).mint(bob.address, 1, 1)).to.be.reverted; // not owner
    await c.connect(alice).mint(alice.address, 1, 100);
    await expect(c.connect(alice).mint(alice.address, 1, 1)).to.be.reverted; // exceeds per-token cap
    await c.connect(alice).mintBatch(alice.address, [2, 3], [50, 50]);
    expect(await c.balanceOf(alice.address, 2)).to.equal(50n);
    await expect(c.connect(alice).mint(alice.address, 0, 1)).to.be.reverted; // id 0 invalid (1-indexed)
    await expect(c.connect(alice).mint(alice.address, 6, 1)).to.be.reverted; // id > numberOfIds
  });

  it("royalty capped 10%; uri getter", async () => {
    const { erc1155Factory, alice } = await loadFixture(deployAll);
    const c = await createERC1155(erc1155Factory, alice, p({ royaltyReceiver: alice.address, royaltyFee: 500 }));
    await c.connect(alice).mint(alice.address, 1, 1);
    const [recv, amt] = await c.royaltyInfo(1, 10000n);
    expect(recv).to.equal(alice.address);
    expect(amt).to.equal(500n);
    expect(await c.uri(0)).to.include("ipfs://m/");
    await expect(createERC1155(erc1155Factory, alice, p({ royaltyReceiver: alice.address, royaltyFee: 1001 }))).to.be.reverted;
  });
});
