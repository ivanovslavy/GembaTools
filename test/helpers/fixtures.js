// Full GembaTools deployment fixture — all 6 factories + the swap router (mocked
// Uniswap) + actors. Mirrors how scripts/deploy.js wires the platform.
const { ethers } = require("hardhat");

const FEE = ethers.parseEther("0.01"); // native creation fee carried in the voucher (on-chain fee mode)
const PLATFORM_FEE_BPS = 30n;          // 0.3% swap fee

async function deployAll() {
  const [owner, feeRecipient, alice, bob, carol, mallory, outsider, voucherSigner] = await ethers.getSigners();

  const dep = async (name, ...args) => {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    return c;
  };

  // Factories
  const erc20Factory     = await dep("GembaERC20Factory", owner.address, feeRecipient.address, voucherSigner.address);
  const taxFactory       = await dep("GembaERC20TaxFactory", owner.address, feeRecipient.address, voucherSigner.address);
  const advancedFactory  = await dep("GembaERC20AdvancedFactory", owner.address, feeRecipient.address, voucherSigner.address);
  const erc721Factory    = await dep("GembaERC721Factory", owner.address, feeRecipient.address, voucherSigner.address);
  const erc721aFactory   = await dep("GembaERC721AFactory", owner.address, feeRecipient.address, voucherSigner.address);
  const erc1155Factory   = await dep("GembaERC1155Factory", owner.address, feeRecipient.address, voucherSigner.address);

  // Swap router over mocked Uniswap
  const weth = await dep("MockWETH9");
  const mockRouter = await dep("MockSwapRouter");
  const swapRouter = await dep(
    "GembaSwapRouter",
    await mockRouter.getAddress(),
    await weth.getAddress(),
    feeRecipient.address,
    PLATFORM_FEE_BPS
  );

  return {
    FEE, PLATFORM_FEE_BPS,
    erc20Factory, taxFactory, advancedFactory, erc721Factory, erc721aFactory, erc1155Factory,
    weth, mockRouter, swapRouter,
    owner, feeRecipient, alice, bob, carol, mallory, outsider, voucherSigner,
  };
}

// ── Vouchers ── the backend's EIP-712 authorisation for one creation (contracts/fees/FeeVoucher.sol).
const VOUCHER_TYPES = {
  CreateVoucher: [
    { name: "creator", type: "address" },
    { name: "contractType", type: "uint8" },
    { name: "orderId", type: "bytes32" },
    { name: "feeWei", type: "uint256" },
    { name: "expiresAt", type: "uint64" },
  ],
};

async function signVoucher(factory, creator, { signer, feeWei = FEE, orderId, expiresAt, contractType, chainId } = {}) {
  const [, , , , , , , defaultSigner] = await ethers.getSigners();
  signer = signer || defaultSigner;
  const net = await ethers.provider.getNetwork();
  const v = {
    orderId: orderId || ethers.hexlify(ethers.randomBytes(32)),
    feeWei,
    expiresAt: expiresAt ?? BigInt((await ethers.provider.getBlock("latest")).timestamp + 3600),
  };
  const domain = { name: "GembaTools", version: "1", chainId: chainId ?? net.chainId, verifyingContract: await factory.getAddress() };
  const value = { creator: typeof creator === "string" ? creator : creator.address,
    contractType: contractType ?? Number(await factory.CONTRACT_TYPE()), ...v };
  const sig = await signer.signTypedData(domain, VOUCHER_TYPES, value);
  return [v, sig];
}

/** `[voucher, signature]` for `caller` on factory `f` — spread it as the last two createToken args. */
const vx = (f, caller, opts) => signVoucher(f, caller, opts);

// ── Helpers that create a token/collection via a factory and return the instance ──
async function createERC20(f, caller, { name = "Tok", symbol = "TOK", decimals = 18, supply = 1_000_000n } = {}) {
  const vs = await vx(f, caller);
  const addr = await f.connect(caller).createToken.staticCall(name, symbol, decimals, supply, ...vs, { value: FEE });
  await (await f.connect(caller).createToken(name, symbol, decimals, supply, ...vs, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC20", addr);
}

async function createTax(f, caller, taxAddr, taxFee, { name = "Tax", symbol = "TAX", decimals = 18, supply = 1_000_000n } = {}) {
  const vs = await vx(f, caller);
  const addr = await f.connect(caller).createToken.staticCall(name, symbol, decimals, supply, taxAddr, taxFee, ...vs, { value: FEE });
  await (await f.connect(caller).createToken(name, symbol, decimals, supply, taxAddr, taxFee, ...vs, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC20Tax", addr);
}

async function createAdvanced(f, caller, p) {
  const args = [p.name, p.symbol, p.decimals, p.totalSupply, p.presaleAmount, p.taxReceiver,
    p.buyTax, p.sellTax, p.transferTax, p.taxOnBuy, p.taxOnSell, p.taxOnTransfer];
  const vs = await vx(f, caller);
  const addr = await f.connect(caller).createToken.staticCall(...args, ...vs, { value: FEE });
  await (await f.connect(caller).createToken(...args, ...vs, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC20Advanced", addr);
}

async function createERC721(f, caller, p) {
  const args = [p.name, p.symbol, p.maxSupply, p.baseURI, p.contractURI, p.royaltyReceiver, p.royaltyFee];
  const vs = await vx(f, caller);
  const addr = await f.connect(caller).createToken.staticCall(...args, ...vs, { value: FEE });
  await (await f.connect(caller).createToken(...args, ...vs, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC721", addr);
}

async function createAdvancedNFT(f, caller, p) {
  const args = [p.name, p.symbol, p.baseURI, p.maxSupply, p.royaltyBps, p.royaltyReceiver];
  const vs = await vx(f, caller);
  const addr = await f.connect(caller).createToken.staticCall(...args, ...vs, { value: FEE });
  await (await f.connect(caller).createToken(...args, ...vs, { value: FEE })).wait();
  return ethers.getContractAt("GembatoolsAdvancedNFT", addr);
}

async function createERC1155(f, caller, p) {
  const params = {
    name: p.name, symbol: p.symbol, uri: p.uri, contractURI: p.contractURI,
    numberOfIds: p.numberOfIds, supplyPerToken: p.supplyPerToken,
    royaltyReceiver: p.royaltyReceiver, royaltyFee: p.royaltyFee,
  };
  const vs = await vx(f, caller);
  const addr = await f.connect(caller).createToken.staticCall(params, ...vs, { value: FEE });
  await (await f.connect(caller).createToken(params, ...vs, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC1155", addr);
}

module.exports = {
  deployAll, FEE, PLATFORM_FEE_BPS, VOUCHER_TYPES, signVoucher, vx,
  createERC20, createTax, createAdvanced, createERC721, createAdvancedNFT, createERC1155,
};
