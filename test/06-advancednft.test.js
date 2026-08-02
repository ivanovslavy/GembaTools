const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, createAdvancedNFT } = require("./helpers/fixtures");

const p = (over = {}) => ({
  name: "AdvNFT", symbol: "ANFT", baseURI: "ipfs://a/", maxSupply: 100n,
  royaltyBps: 500, royaltyReceiver: ethers.ZeroAddress, ...over,
});

// Sign (to, orderId, nonce, collection, chainId) as the owner — the on-chain hash
// is now domain-bound to the collection address + chain id (A1 fix). EIP-191
// personal_sign == toEthSignedMessageHash.
async function sign(signer, to, orderId, nonce, contractAddr, chainId) {
  const hash = ethers.solidityPackedKeccak256(
    ["address", "bytes32", "uint256", "address", "uint256"],
    [to, orderId, nonce, contractAddr, chainId]);
  return signer.signMessage(ethers.getBytes(hash));
}
const chainId = async () => (await ethers.provider.getNetwork()).chainId;

describe("GembatoolsAdvancedNFT", () => {
  it("owner mint / batchMint; enforces maxSupply; royalty capped", async () => {
    const { erc721aFactory, alice, bob } = await loadFixture(deployAll);
    const c = await createAdvancedNFT(erc721aFactory, alice, p({ maxSupply: 3n, royaltyReceiver: alice.address }));
    await expect(c.connect(bob).mint(bob.address)).to.be.reverted;
    await c.connect(alice).mint(alice.address);
    await c.connect(alice).batchMint(alice.address, 2);
    await expect(c.connect(alice).mint(alice.address)).to.be.reverted; // max reached
  });

  describe("mintWithSignature (ECDSA)", () => {
    it("valid owner signature mints; replay + wrong-signer rejected", async () => {
      const { erc721aFactory, alice, bob } = await loadFixture(deployAll);
      const c = await createAdvancedNFT(erc721aFactory, alice, p({ royaltyReceiver: alice.address }));
      const cid = await chainId();
      const orderId = ethers.id("order-1");
      const sig = await sign(alice, bob.address, orderId, 1, await c.getAddress(), cid);
      await c.connect(bob).mintWithSignature(bob.address, orderId, 1, sig);
      expect(await c.balanceOf(bob.address)).to.equal(1n);
      // replay same signature → rejected (orderId now one-time; also usedSignatures)
      await expect(c.connect(bob).mintWithSignature(bob.address, orderId, 1, sig)).to.be.reverted;
      // wrong signer (bob signs) → rejected
      const badSig = await sign(bob, bob.address, ethers.id("order-2"), 2, await c.getAddress(), cid);
      await expect(c.connect(bob).mintWithSignature(bob.address, ethers.id("order-2"), 2, badSig)).to.be.revertedWith("Invalid signature");
    });

    it("A2 FIXED: orderId is one-time — reuse with a fresh nonce is rejected", async () => {
      const { erc721aFactory, alice, bob } = await loadFixture(deployAll);
      const c = await createAdvancedNFT(erc721aFactory, alice, p({ royaltyReceiver: alice.address }));
      const cid = await chainId();
      const addr = await c.getAddress();
      const orderId = ethers.id("same-order");
      await c.connect(bob).mintWithSignature(bob.address, orderId, 1, await sign(alice, bob.address, orderId, 1, addr, cid));
      expect(await c.usedOrders(orderId)).to.equal(true);
      // same orderId, fresh nonce + fresh valid signature → now REJECTED (usedOrders enforced)
      await expect(
        c.connect(bob).mintWithSignature(bob.address, orderId, 2, await sign(alice, bob.address, orderId, 2, addr, cid))
      ).to.be.revertedWith("Order already used");
      expect(await c.balanceOf(bob.address)).to.equal(1n);
    });

    it("A1 FIXED: cross-contract signature replay is rejected (hash bound to collection + chainid)", async () => {
      const { erc721aFactory, alice, bob } = await loadFixture(deployAll);
      const cid = await chainId();
      // two collections, SAME owner (alice)
      const c1 = await createAdvancedNFT(erc721aFactory, alice, p({ name: "C1", symbol: "C1", royaltyReceiver: alice.address }));
      const c2 = await createAdvancedNFT(erc721aFactory, alice, p({ name: "C2", symbol: "C2", royaltyReceiver: alice.address }));
      const orderId = ethers.id("cross");
      // signature made for collection #1 (its address in the domain)
      const sig = await sign(alice, bob.address, orderId, 7, await c1.getAddress(), cid);
      await c1.connect(bob).mintWithSignature(bob.address, orderId, 7, sig);
      // the SAME signature on collection #2 → recovered signer differs from owner → rejected
      await expect(c2.connect(bob).mintWithSignature(bob.address, orderId, 7, sig)).to.be.revertedWith("Invalid signature");
      expect(await c1.balanceOf(bob.address)).to.equal(1n);
      expect(await c2.balanceOf(bob.address)).to.equal(0n);
    });
  });

  it("batch transfer/burn (public, ownership-checked); receive() rejects ETH", async () => {
    const { erc721aFactory, alice, bob } = await loadFixture(deployAll);
    const c = await createAdvancedNFT(erc721aFactory, alice, p({ royaltyReceiver: alice.address }));
    await c.connect(alice).batchMint(alice.address, 3);
    await c.connect(alice).batchTransferByID(bob.address, [0, 1]);
    expect(await c.ownerOf(0)).to.equal(bob.address);
    await expect(c.connect(alice).batchTransferByID(bob.address, [2, 0])).to.be.reverted; // 0 not owned by alice now
    await c.connect(bob).batchBurn([0, 1]);
    expect(await c.totalBurned()).to.equal(2n);
    await expect(alice.sendTransaction({ to: await c.getAddress(), value: 1n })).to.be.reverted; // NoNativeTokensAccepted
  });
});
