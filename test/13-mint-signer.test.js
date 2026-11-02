const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const os = require("os"); const path = require("path"); const fs = require("fs");
const { deployAll, createAdvancedNFT } = require("./helpers/fixtures");
const { signMint, mintHash } = require("../tools/mint-signer");

// The open follow-up from August (after A1/A2): the collection owner's signing tool must sign
// keccak(to, orderId, nonce, collection, chainId) with a UNIQUE orderId. tools/mint-signer.js is that tool;
// these tests prove its output is exactly what the contract accepts, and nothing more.
describe("OWNER MINT-SIGNATURE TOOL (tools/mint-signer.js)", () => {
  const journalFile = path.join(os.tmpdir(), `gt-mint-journal-${process.pid}.json`);
  afterEach(() => { try { fs.unlinkSync(journalFile); } catch { /* */ } });

  async function fixture() {
    const f = await deployAll();
    const p = { name: "N", symbol: "N", baseURI: "ipfs://x/", maxSupply: 100n, royaltyBps: 500, royaltyReceiver: f.alice.address };
    const nft = await createAdvancedNFT(f.erc721aFactory, f.alice, p); // alice owns the collection
    return { ...f, nft };
  }

  it("signs exactly the contract's hash: the minted token goes to `to`, signed by the owner", async () => {
    const { nft, alice, bob } = await loadFixture(fixture);
    const s = await signMint({ signer: alice, collection: await nft.getAddress(), to: bob.address, nonce: 7, journalFile });
    expect(s.chainId).to.equal(31337);
    expect(s.orderId).to.match(/^0x[0-9a-f]{64}$/);
    expect(mintHash({ ...s, collection: s.collection })).to.equal(
      ethers.solidityPackedKeccak256(["address", "bytes32", "uint256", "address", "uint256"], [bob.address, s.orderId, 7n, s.collection, 31337n]));
    await nft.connect(bob).mintWithSignature(s.to, s.orderId, s.nonce, s.signature);
    expect(await nft.balanceOf(bob.address)).to.equal(1n);
    expect(await nft.usedOrders(s.orderId)).to.equal(true);
  });

  it("every authorisation gets a fresh random orderId (100 calls, 100 distinct)", async () => {
    const { nft, alice, bob } = await loadFixture(fixture);
    const ids = new Set();
    for (let i = 0; i < 100; i++) ids.add((await signMint({ signer: alice, collection: await nft.getAddress(), to: bob.address, journalFile })).orderId);
    expect(ids.size).to.equal(100);
  });

  it("refuses to re-issue an orderId it already issued, and one already used on chain", async () => {
    const { nft, alice, bob } = await loadFixture(fixture);
    const s = await signMint({ signer: alice, collection: await nft.getAddress(), to: bob.address, journalFile });
    await expect(signMint({ signer: alice, collection: await nft.getAddress(), to: bob.address, orderId: s.orderId, journalFile }))
      .to.be.rejectedWith(/already issued/);
    await nft.connect(bob).mintWithSignature(s.to, s.orderId, s.nonce, s.signature);
    fs.unlinkSync(journalFile); // even with the local journal gone, the chain check still refuses
    await expect(signMint({ signer: alice, collection: await nft.getAddress(), to: bob.address, orderId: s.orderId, journalFile }))
      .to.be.rejectedWith(/already used on chain/);
    await expect(nft.connect(bob).mintWithSignature(s.to, s.orderId, s.nonce, s.signature)).to.be.revertedWith("Order already used");
  });

  it("refuses when the key is not the collection owner", async () => {
    const { nft, bob } = await loadFixture(fixture);
    await expect(signMint({ signer: bob, collection: await nft.getAddress(), to: bob.address, journalFile })).to.be.rejectedWith(/not the owner/);
  });

  it("a signature is bound to `to`, the collection and the chain (cannot be redirected or replayed elsewhere)", async () => {
    const { nft, alice, bob, carol, erc721aFactory } = await loadFixture(fixture);
    const s = await signMint({ signer: alice, collection: await nft.getAddress(), to: bob.address, journalFile });
    await expect(nft.connect(carol).mintWithSignature(carol.address, s.orderId, s.nonce, s.signature)).to.be.revertedWith("Invalid signature");
    const p = { name: "M", symbol: "M", baseURI: "ipfs://y/", maxSupply: 10n, royaltyBps: 0, royaltyReceiver: alice.address };
    const other = await createAdvancedNFT(erc721aFactory, alice, p);
    await expect(other.connect(bob).mintWithSignature(s.to, s.orderId, s.nonce, s.signature)).to.be.revertedWith("Invalid signature");
    // same inputs signed for another chain id → rejected here
    const foreign = ethers.solidityPackedKeccak256(["address", "bytes32", "uint256", "address", "uint256"], [bob.address, s.orderId, s.nonce, s.collection, 11155111n]);
    const sigForeign = await alice.signMessage(ethers.getBytes(foreign));
    await expect(nft.connect(bob).mintWithSignature(s.to, s.orderId, s.nonce, sigForeign)).to.be.revertedWith("Invalid signature");
  });
});
