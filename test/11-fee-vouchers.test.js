const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, FEE, VOUCHER_TYPES, signVoucher, vx } = require("./helpers/fixtures");

// The fee voucher (contracts/fees/FeeVoucher.sol) is what replaced the fixed `creationFee`.
// Every property here is one the backend relies on: one order = one contract, for one creator, of one type,
// on one chain and one factory, before a deadline, signed by one key — and nothing at all without that key.
describe("FEE VOUCHERS — fail closed, single use, bound to creator / type / chain / factory", () => {
  const ercArgs = ["N", "S", 18, 1000n];

  it("GembaPay mode: a zero-fee voucher creates with msg.value 0 and moves no native coin", async () => {
    const { erc20Factory, feeRecipient, alice } = await loadFixture(deployAll);
    const before = await ethers.provider.getBalance(feeRecipient.address);
    const [v, sig] = await vx(erc20Factory, alice, { feeWei: 0n });
    await expect(erc20Factory.connect(alice).createToken(...ercArgs, v, sig))
      .to.emit(erc20Factory, "VoucherRedeemed").withArgs(v.orderId, alice.address, 1, 0n);
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(before);
    expect(await erc20Factory.usedVouchers(v.orderId)).to.equal(true);
  });

  it("GembaPay mode: anything sent with a zero-fee voucher is refunded in full", async () => {
    const { erc20Factory, feeRecipient, alice } = await loadFixture(deployAll);
    const before = await ethers.provider.getBalance(feeRecipient.address);
    const [v, sig] = await vx(erc20Factory, alice, { feeWei: 0n });
    await erc20Factory.connect(alice).createToken(...ercArgs, v, sig, { value: ethers.parseEther("1") });
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(before);
    expect(await ethers.provider.getBalance(await erc20Factory.getAddress())).to.equal(0n);
  });

  it("single use: the same voucher cannot create twice (VoucherAlreadyUsed)", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    const vs = await vx(erc20Factory, alice);
    await erc20Factory.connect(alice).createToken(...ercArgs, ...vs, { value: FEE });
    await expect(erc20Factory.connect(alice).createToken(...ercArgs, ...vs, { value: FEE }))
      .to.be.revertedWithCustomError(erc20Factory, "VoucherAlreadyUsed");
  });

  it("bound to the creator: Bob cannot use a voucher signed for Alice", async () => {
    const { erc20Factory, alice, bob } = await loadFixture(deployAll);
    const vs = await vx(erc20Factory, alice);
    await expect(erc20Factory.connect(bob).createToken(...ercArgs, ...vs, { value: FEE }))
      .to.be.revertedWithCustomError(erc20Factory, "BadVoucherSignature");
  });

  it("bound to the contract type: an ERC20 voucher does not open the Tax factory", async () => {
    const { taxFactory, alice, bob } = await loadFixture(deployAll);
    const vs = await signVoucher(taxFactory, alice, { contractType: 1 });
    await expect(taxFactory.connect(alice).createToken("N", "S", 18, 1n, bob.address, 100n, ...vs, { value: FEE }))
      .to.be.revertedWithCustomError(taxFactory, "BadVoucherSignature");
  });

  it("bound to the factory: a voucher for one ERC20 factory is rejected by another ERC20 factory", async () => {
    const { erc20Factory, owner, feeRecipient, voucherSigner, alice } = await loadFixture(deployAll);
    const F = await ethers.getContractFactory("GembaERC20Factory");
    const other = await F.deploy(owner.address, feeRecipient.address, voucherSigner.address);
    const vs = await vx(erc20Factory, alice);
    await expect(other.connect(alice).createToken(...ercArgs, ...vs, { value: FEE }))
      .to.be.revertedWithCustomError(other, "BadVoucherSignature");
  });

  it("bound to the chain: a voucher signed for another chainId is rejected", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    const vs = await vx(erc20Factory, alice, { chainId: 11155111n });
    await expect(erc20Factory.connect(alice).createToken(...ercArgs, ...vs, { value: FEE }))
      .to.be.revertedWithCustomError(erc20Factory, "BadVoucherSignature");
  });

  it("the fee is signed: lowering feeWei in a signed voucher invalidates it", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    const [v, sig] = await vx(erc20Factory, alice, { feeWei: FEE });
    await expect(erc20Factory.connect(alice).createToken(...ercArgs, { ...v, feeWei: 0n }, sig))
      .to.be.revertedWithCustomError(erc20Factory, "BadVoucherSignature");
  });

  it("expires: a voucher past expiresAt is rejected (VoucherExpired)", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    const now = (await ethers.provider.getBlock("latest")).timestamp;
    const vs = await vx(erc20Factory, alice, { expiresAt: BigInt(now + 60) });
    await time.increase(61);
    await expect(erc20Factory.connect(alice).createToken(...ercArgs, ...vs, { value: FEE }))
      .to.be.revertedWithCustomError(erc20Factory, "VoucherExpired");
  });

  it("only the configured signer: a voucher signed by anyone else is rejected", async () => {
    const { erc20Factory, alice, mallory } = await loadFixture(deployAll);
    const vs = await vx(erc20Factory, alice, { signer: mallory });
    await expect(erc20Factory.connect(alice).createToken(...ercArgs, ...vs, { value: FEE }))
      .to.be.revertedWithCustomError(erc20Factory, "BadVoucherSignature");
  });

  it("FAIL CLOSED: with no signer configured nothing can be created, not even with a 'valid' signature", async () => {
    const { owner, feeRecipient, alice, voucherSigner } = await loadFixture(deployAll);
    const F = await ethers.getContractFactory("GembaERC20Factory");
    const f = await F.deploy(owner.address, feeRecipient.address, ethers.ZeroAddress);
    for (const signer of [voucherSigner, alice]) {
      const vs = await vx(f, alice, { signer });
      await expect(f.connect(alice).createToken(...ercArgs, ...vs, { value: FEE }))
        .to.be.revertedWithCustomError(f, "BadVoucherSignature");
    }
    // a garbage signature does not get through either
    const [v] = await vx(f, alice);
    await expect(f.connect(alice).createToken(...ercArgs, v, "0x" + "00".repeat(65), { value: FEE })).to.be.reverted;
  });

  it("rotation: after setVoucherSigner the old key's vouchers stop working", async () => {
    const { erc20Factory, owner, alice, carol } = await loadFixture(deployAll);
    const old = await vx(erc20Factory, alice);
    await erc20Factory.connect(owner).setVoucherSigner(carol.address);
    await expect(erc20Factory.connect(alice).createToken(...ercArgs, ...old, { value: FEE }))
      .to.be.revertedWithCustomError(erc20Factory, "BadVoucherSignature");
    const fresh = await vx(erc20Factory, alice, { signer: carol });
    await erc20Factory.connect(alice).createToken(...ercArgs, ...fresh, { value: FEE });
  });

  it("malleable (high-s) twin of a valid signature is rejected", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    const [v, sig] = await vx(erc20Factory, alice);
    const s = ethers.Signature.from(sig);
    const N = BigInt("0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141");
    const highS = ethers.toBeHex(N - BigInt(s.s), 32);
    const twin = ethers.concat([s.r, highS, s.v === 27 ? "0x1c" : "0x1b"]);
    await expect(erc20Factory.connect(alice).createToken(...ercArgs, v, twin, { value: FEE })).to.be.reverted;
  });

  it("voucherDigest() equals the EIP-712 hash the backend computes", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    const [v] = await vx(erc20Factory, alice);
    const net = await ethers.provider.getNetwork();
    const domain = { name: "GembaTools", version: "1", chainId: net.chainId, verifyingContract: await erc20Factory.getAddress() };
    const off = ethers.TypedDataEncoder.hash(domain, VOUCHER_TYPES, { creator: alice.address, contractType: 1, ...v });
    expect(await erc20Factory.voucherDigest(alice.address, v)).to.equal(off);
  });

  it("each factory carries its own CONTRACT_TYPE (1..6) — the ids the backend signs", async () => {
    const f = await loadFixture(deployAll);
    const got = await Promise.all([f.erc20Factory, f.taxFactory, f.advancedFactory, f.erc721Factory, f.erc721aFactory, f.erc1155Factory]
      .map((x) => x.CONTRACT_TYPE()));
    expect(got.map(Number)).to.deep.equal([1, 2, 3, 4, 5, 6]);
  });

  it("no factory creates anything without a voucher signature (all 6)", async () => {
    const f = await loadFixture(deployAll);
    const bad = async (factory) => { const [v] = await vx(factory, f.alice); return [v, "0x" + "11".repeat(65)]; };
    await expect(f.erc20Factory.connect(f.alice).createToken("A", "A", 18, 1n, ...(await bad(f.erc20Factory)), { value: FEE })).to.be.reverted;
    await expect(f.taxFactory.connect(f.alice).createToken("B", "B", 18, 1n, f.bob.address, 500n, ...(await bad(f.taxFactory)), { value: FEE })).to.be.reverted;
    await expect(f.advancedFactory.connect(f.alice).createToken("C", "C", 18, 100n, 0n, f.bob.address, 0, 0, 0, false, false, false, ...(await bad(f.advancedFactory)), { value: FEE })).to.be.reverted;
    await expect(f.erc721Factory.connect(f.alice).createToken("D", "D", 100n, "ipfs://d/", "ipfs://d.json", f.bob.address, 500, ...(await bad(f.erc721Factory)), { value: FEE })).to.be.reverted;
    await expect(f.erc721aFactory.connect(f.alice).createToken("E", "E", "ipfs://e/", 100n, 500, f.bob.address, ...(await bad(f.erc721aFactory)), { value: FEE })).to.be.reverted;
    await expect(f.erc1155Factory.connect(f.alice).createToken(
      { name: "F", symbol: "F", uri: "ipfs://f/", contractURI: "ipfs://f.json", numberOfIds: 5n, supplyPerToken: 100n, royaltyReceiver: f.bob.address, royaltyFee: 500 },
      ...(await bad(f.erc1155Factory)), { value: FEE })).to.be.reverted;
  });
});
