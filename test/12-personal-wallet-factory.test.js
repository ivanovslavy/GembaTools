const { expect } = require("chai");
const { loadFixture, time } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers, artifacts } = require("hardhat");
const fs = require("fs");
const path = require("path");
const { FEE, signVoucher } = require("./helpers/fixtures");

// keccak256 of the audited PersonalWallet build (github.com/ivanovslavy/personal-wallet, 0.8.28/viaIR/cancun,
// the same code as the live wallets 0x9928…49f5 on Sepolia and 0x586C…685D on GembaBlockchain testnet).
const AUDITED_CREATION_KECCAK = "0x520bb690dfa7d16fa7363019b625603717e2bf59e685df63bad03f37c90f5322";
const AUDITED_RUNTIME_KECCAK = "0x2625763efc81f2991e2dfd3bc65ae530cebfbffbc114e7f96d503416d7a9435a";
const SIBLING = path.join(__dirname, "..", "..", "personal_wallet", "artifacts", "contracts", "PersonalWallet.sol", "PersonalWallet.json");

async function deployWalletFactory() {
  const [owner, feeRecipient, o1, o2, o3, outsider, cold, voucherSigner, other] = await ethers.getSigners();
  const art = await artifacts.readArtifact("PersonalWallet");
  const F = await ethers.getContractFactory("GembaPersonalWalletFactory");
  const factory = await F.deploy(owner.address, feeRecipient.address, voucherSigner.address, art.bytecode);
  await factory.waitForDeployment();
  return { factory, art, owner, feeRecipient, o1, o2, o3, outsider, cold, voucherSigner, other };
}

function params(o1, o2, o3, { strictRecipient = true, strictToken = false, recipients, labels, tokens = [], tokenLabels = [] } = {}) {
  return {
    owners: [o1.address, o2.address, o3.address],
    requireAllowedRecipient: strictRecipient,
    requireAllowedToken: strictToken,
    recipients: recipients ?? [],
    recipientLabels: labels ?? (recipients ?? []).map((_, i) => `r${i}`),
    tokens, tokenLabels,
  };
}

async function create(fx, p, { caller, feeWei = 0n, value = 0n } = {}) {
  caller = caller || fx.o1;
  const vs = await signVoucher(fx.factory, caller, { signer: fx.voucherSigner, feeWei });
  const addr = await fx.factory.connect(caller).createWallet.staticCall(p, ...vs, { value });
  await (await fx.factory.connect(caller).createWallet(p, ...vs, { value })).wait();
  return ethers.getContractAt("PersonalWallet", addr);
}

describe("PERSONAL WALLET FACTORY — the audited wallet, deployed and managed through GembaTools", () => {
  it("vendored source == audited build: creation + runtime keccak pinned (and == sibling project artifact)", async () => {
    const art = await artifacts.readArtifact("PersonalWallet");
    expect(ethers.keccak256(art.bytecode)).to.equal(AUDITED_CREATION_KECCAK);
    expect(ethers.keccak256(art.deployedBytecode)).to.equal(AUDITED_RUNTIME_KECCAK);
    if (fs.existsSync(SIBLING)) {
      const sib = JSON.parse(fs.readFileSync(SIBLING, "utf8"));
      expect(art.bytecode).to.equal(sib.bytecode);
      expect(JSON.stringify(art.abi)).to.equal(JSON.stringify(sib.abi));
    }
  });

  it("the factory stores exactly that code: walletCodeHash + walletCreationCode() round-trip", async () => {
    const { factory, art } = await loadFixture(deployWalletFactory);
    expect(await factory.walletCodeHash()).to.equal(AUDITED_CREATION_KECCAK);
    expect(await factory.walletCreationCode()).to.equal(art.bytecode);
    expect(await factory.CONTRACT_TYPE()).to.equal(7n);
    const code = await ethers.provider.getCode(await factory.getAddress());
    expect((code.length - 2) / 2).to.be.lt(24576);
  });

  it("a factory-made wallet has the SAME runtime bytecode as a direct deployment", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const p = params(fx.o1, fx.o2, fx.o3, { recipients: [fx.cold.address] });
    const viaFactory = await create(fx, p);
    const Direct = await ethers.getContractFactory("PersonalWallet");
    const direct = await Direct.deploy(p.owners, p.requireAllowedRecipient, p.requireAllowedToken, p.recipients, p.recipientLabels, p.tokens, p.tokenLabels);
    const a = await ethers.provider.getCode(await viaFactory.getAddress());
    const b = await ethers.provider.getCode(await direct.getAddress());
    expect(a).to.equal(b);
    expect(ethers.keccak256(a)).to.equal(AUDITED_RUNTIME_KECCAK);
  });

  it("owners, policy and registries are exactly what was asked; the factory/creator hold no power", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const tok = await (await ethers.getContractFactory("MockERC20")).deploy();
    const tokens = [await tok.getAddress()];
    const w = await create(fx, params(fx.o1, fx.o2, fx.o3, { recipients: [fx.cold.address], labels: ["cold"], tokens, tokenLabels: tokens.map(() => "T") }), { caller: fx.outsider });
    expect(await w.owners()).to.deep.equal([fx.o1.address, fx.o2.address, fx.o3.address]);
    expect(await w.requireAllowedRecipient()).to.equal(true);
    expect(await w.isRecipientAllowed(fx.cold.address)).to.equal(true);
    expect(await w.isTokenAllowed(tokens[0])).to.equal(true);
    expect(await w.delay()).to.equal(72n * 3600n);
    expect(await w.isOwner(fx.outsider.address)).to.equal(false);           // the creator
    expect(await w.isOwner(await fx.factory.getAddress())).to.equal(false); // the factory
    expect(await fx.factory.getWalletsByCreator(fx.outsider.address)).to.deep.equal([await w.getAddress()]);
    for (const o of [fx.o1, fx.o2, fx.o3]) expect(await fx.factory.getWalletsByOwner(o.address)).to.deep.equal([await w.getAddress()]);
    expect(await fx.factory.totalWallets()).to.equal(1n);
  });

  it("management through the wallet: 2-of-3 native transfer to an allowlisted recipient", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const w = await create(fx, params(fx.o1, fx.o2, fx.o3, { recipients: [fx.cold.address] }));
    await w.connect(fx.outsider).depositNative({ value: ethers.parseEther("2") });
    expect(await w.nativeBalance()).to.equal(ethers.parseEther("2"));

    await w.connect(fx.o1).proposeNative(fx.cold.address, ethers.parseEther("1"), 3600);
    await expect(w.connect(fx.o1).executeNative(1)).to.be.revertedWithCustomError(w, "NotEnoughConfirmations");
    await w.connect(fx.o2).confirm(1);
    const before = await ethers.provider.getBalance(fx.cold.address);
    await w.connect(fx.o3).executeNative(1);
    expect(await ethers.provider.getBalance(fx.cold.address)).to.equal(before + ethers.parseEther("1"));
    await expect(w.connect(fx.o1).executeNative(1)).to.be.revertedWithCustomError(w, "AlreadyExecuted");
  });

  it("security invariants survive the factory: outsider → NotOwner, non-allowlisted → RecipientNotAllowed, veto works", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const w = await create(fx, params(fx.o1, fx.o2, fx.o3, { recipients: [fx.cold.address] }));
    await expect(w.connect(fx.outsider).proposeNative(fx.cold.address, 1n, 3600)).to.be.revertedWithCustomError(w, "NotOwner");
    await expect(w.connect(fx.o1).proposeNative(fx.outsider.address, 1n, 3600)).to.be.revertedWithCustomError(w, "RecipientNotAllowed");
    // a new recipient needs all three + the 72 h timelock, and ONE owner can veto it
    await w.connect(fx.o1).proposeAllowRecipient(fx.other.address, "new");
    await w.connect(fx.o2).confirm(1);
    await w.connect(fx.o3).confirm(1);
    await expect(w.connect(fx.o1).executeAllowRecipient(1)).to.be.revertedWithCustomError(w, "TimelockNotElapsed");
    await w.connect(fx.o3).veto(1);
    await time.increase(73 * 3600);
    await expect(w.connect(fx.o1).executeAllowRecipient(1)).to.be.revertedWithCustomError(w, "ProposalCancelled");
  });

  it("refuses a strict-recipient wallet with no recipient (StrictModeNeedsRecipient)", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const vs = await signVoucher(fx.factory, fx.o1, { signer: fx.voucherSigner, feeWei: 0n });
    await expect(fx.factory.connect(fx.o1).createWallet(params(fx.o1, fx.o2, fx.o3, { recipients: [] }), ...vs))
      .to.be.revertedWithCustomError(fx.factory, "StrictModeNeedsRecipient");
  });

  it("refuses the factory itself as an owner (its seat would be dead) — FactoryCannotOwn", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const vs = await signVoucher(fx.factory, fx.o1, { signer: fx.voucherSigner, feeWei: 0n });
    const p = params(fx.o1, fx.o2, fx.o3, { recipients: [fx.cold.address] });
    p.owners[2] = await fx.factory.getAddress();
    await expect(fx.factory.connect(fx.o1).createWallet(p, ...vs)).to.be.revertedWithCustomError(fx.factory, "FactoryCannotOwn");
  });

  it("bubbles the wallet's own constructor errors (DuplicateOwner) and burns nothing on failure", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const art = await artifacts.readArtifact("PersonalWallet");
    const iface = new ethers.Interface(art.abi);
    const [v, sig] = await signVoucher(fx.factory, fx.o1, { signer: fx.voucherSigner, feeWei: 0n });
    const p = params(fx.o1, fx.o1, fx.o3, { recipients: [fx.cold.address] });
    let data;
    try { await fx.factory.connect(fx.o1).createWallet.staticCall(p, v, sig); } catch (e) { data = e.data; }
    expect(iface.parseError(data).name).to.equal("DuplicateOwner");
    expect(await fx.factory.usedVouchers(v.orderId)).to.equal(false);
  });

  it("on-chain fee mode: the voucher's fee goes to feeRecipient; below it → InsufficientFee", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const p = params(fx.o1, fx.o2, fx.o3, { recipients: [fx.cold.address] });
    const before = await ethers.provider.getBalance(fx.feeRecipient.address);
    await create(fx, p, { feeWei: FEE, value: FEE + 5n });
    expect(await ethers.provider.getBalance(fx.feeRecipient.address)).to.equal(before + FEE);
    const vs = await signVoucher(fx.factory, fx.o1, { signer: fx.voucherSigner, feeWei: FEE });
    await expect(fx.factory.connect(fx.o1).createWallet(p, ...vs, { value: FEE - 1n }))
      .to.be.revertedWithCustomError(fx.factory, "InsufficientFee");
  });

  it("voucher rules apply here too: wrong creator / reused / wrong signer are rejected", async () => {
    const fx = await loadFixture(deployWalletFactory);
    const p = params(fx.o1, fx.o2, fx.o3, { recipients: [fx.cold.address] });
    const vs = await signVoucher(fx.factory, fx.o1, { signer: fx.voucherSigner, feeWei: 0n });
    await expect(fx.factory.connect(fx.o2).createWallet(p, ...vs)).to.be.revertedWithCustomError(fx.factory, "BadVoucherSignature");
    await fx.factory.connect(fx.o1).createWallet(p, ...vs);
    await expect(fx.factory.connect(fx.o1).createWallet(p, ...vs)).to.be.revertedWithCustomError(fx.factory, "VoucherAlreadyUsed");
    const forged = await signVoucher(fx.factory, fx.o1, { signer: fx.outsider, feeWei: 0n });
    await expect(fx.factory.connect(fx.o1).createWallet(p, ...forged)).to.be.revertedWithCustomError(fx.factory, "BadVoucherSignature");
  });
});
