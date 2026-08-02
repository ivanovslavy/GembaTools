// Full GembaTools deployment fixture — all 6 factories + the swap router (mocked
// Uniswap) + actors. Mirrors how scripts/deploy.js wires the platform.
const { ethers } = require("hardhat");

const FEE = ethers.parseEther("0.01"); // creation fee per factory
const PLATFORM_FEE_BPS = 30n;          // 0.3% swap fee

async function deployAll() {
  const [owner, feeRecipient, alice, bob, carol, mallory, outsider] = await ethers.getSigners();

  const dep = async (name, ...args) => {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    return c;
  };

  // Factories
  const erc20Factory     = await dep("GembaERC20Factory", owner.address, feeRecipient.address, FEE);
  const taxFactory       = await dep("GembaERC20TaxFactory", owner.address, feeRecipient.address, FEE);
  const advancedFactory  = await dep("GembaERC20AdvancedFactory", owner.address, feeRecipient.address, FEE);
  const erc721Factory    = await dep("GembaERC721Factory", owner.address, feeRecipient.address, FEE);
  const erc721aFactory   = await dep("GembaERC721AFactory", owner.address, feeRecipient.address, FEE);
  const erc1155Factory   = await dep("GembaERC1155Factory", owner.address, feeRecipient.address, FEE);

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
    owner, feeRecipient, alice, bob, carol, mallory, outsider,
  };
}

// ── Helpers that create a token/collection via a factory and return the instance ──
async function createERC20(f, caller, { name = "Tok", symbol = "TOK", decimals = 18, supply = 1_000_000n } = {}) {
  const addr = await f.connect(caller).createToken.staticCall(name, symbol, decimals, supply, { value: FEE });
  await (await f.connect(caller).createToken(name, symbol, decimals, supply, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC20", addr);
}

async function createTax(f, caller, taxAddr, taxFee, { name = "Tax", symbol = "TAX", decimals = 18, supply = 1_000_000n } = {}) {
  const addr = await f.connect(caller).createToken.staticCall(name, symbol, decimals, supply, taxAddr, taxFee, { value: FEE });
  await (await f.connect(caller).createToken(name, symbol, decimals, supply, taxAddr, taxFee, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC20Tax", addr);
}

async function createAdvanced(f, caller, p) {
  const args = [p.name, p.symbol, p.decimals, p.totalSupply, p.presaleAmount, p.taxReceiver,
    p.buyTax, p.sellTax, p.transferTax, p.taxOnBuy, p.taxOnSell, p.taxOnTransfer];
  const addr = await f.connect(caller).createToken.staticCall(...args, { value: FEE });
  await (await f.connect(caller).createToken(...args, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC20Advanced", addr);
}

async function createERC721(f, caller, p) {
  const args = [p.name, p.symbol, p.maxSupply, p.baseURI, p.contractURI, p.royaltyReceiver, p.royaltyFee];
  const addr = await f.connect(caller).createToken.staticCall(...args, { value: FEE });
  await (await f.connect(caller).createToken(...args, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC721", addr);
}

async function createAdvancedNFT(f, caller, p) {
  const args = [p.name, p.symbol, p.baseURI, p.maxSupply, p.royaltyBps, p.royaltyReceiver];
  const addr = await f.connect(caller).createToken.staticCall(...args, { value: FEE });
  await (await f.connect(caller).createToken(...args, { value: FEE })).wait();
  return ethers.getContractAt("GembatoolsAdvancedNFT", addr);
}

async function createERC1155(f, caller, p) {
  const params = {
    name: p.name, symbol: p.symbol, uri: p.uri, contractURI: p.contractURI,
    numberOfIds: p.numberOfIds, supplyPerToken: p.supplyPerToken,
    royaltyReceiver: p.royaltyReceiver, royaltyFee: p.royaltyFee,
  };
  const addr = await f.connect(caller).createToken.staticCall(params, { value: FEE });
  await (await f.connect(caller).createToken(params, { value: FEE })).wait();
  return ethers.getContractAt("GembaERC1155", addr);
}

module.exports = {
  deployAll, FEE, PLATFORM_FEE_BPS,
  createERC20, createTax, createAdvanced, createERC721, createAdvancedNFT, createERC1155,
};
