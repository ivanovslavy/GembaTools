// Production deploy — fresh (audit-fixed) factories + swap router on Sepolia.
// Owner of ALL contracts = OWNER; creation/swap fees → FEE_RECIPIENT; production fees.
// Factories take owner_ in their constructor (owned by OWNER immediately). The swap
// router is Ownable(msg.sender), so its ownership is transferred to OWNER after deploy.
//   npx hardhat run scripts/deploy-production.js --network sepolia
require("dotenv").config();
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

const OWNER = "0x8eB8Bf106EbC9834a2586D04F73866C7436Ce298";        // owner of all contracts
const FEE_RECIPIENT = "0x65124A08c9BFE0A7176668EE351573059Ea38ccC"; // creation + swap fees
const FEES = {
  erc20:         ethers.parseEther("0.02"),
  erc20tax:      ethers.parseEther("0.03"),
  erc721:        ethers.parseEther("0.04"),
  erc1155:       ethers.parseEther("0.05"),
  erc721a:       ethers.parseEther("0.06"),
  erc20advanced: ethers.parseEther("0.07"),
};
const SWAP_FEE_BPS = 30n; // 0.3%

async function main() {
  const [d] = await ethers.getSigners();
  const startBal = await ethers.provider.getBalance(d.address);
  console.log(`network ${network.name} | deployer ${d.address} | balance ${ethers.formatEther(startBal)} ETH`);
  console.log(`owner=${OWNER} feeRecipient=${FEE_RECIPIENT}\n`);

  const dep = async (name, ...args) => {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args); await c.waitForDeployment();
    const a = await c.getAddress(); console.log(`  ${name.padEnd(26)} ${a}`); return a;
  };

  const contracts = {}, ctorArgs = {};
  contracts.erc20         = await dep("GembaERC20Factory", OWNER, FEE_RECIPIENT, FEES.erc20);
  contracts.erc20tax      = await dep("GembaERC20TaxFactory", OWNER, FEE_RECIPIENT, FEES.erc20tax);
  contracts.erc20advanced = await dep("GembaERC20AdvancedFactory", OWNER, FEE_RECIPIENT, FEES.erc20advanced);
  contracts.erc721        = await dep("GembaERC721Factory", OWNER, FEE_RECIPIENT, FEES.erc721);
  contracts.erc721a       = await dep("GembaERC721AFactory", OWNER, FEE_RECIPIENT, FEES.erc721a);
  contracts.erc1155       = await dep("GembaERC1155Factory", OWNER, FEE_RECIPIENT, FEES.erc1155);

  const uniRouter = process.env.UNISWAP_V3_ROUTER, weth = process.env.WETH9;
  if (!uniRouter || !weth) throw new Error("Set UNISWAP_V3_ROUTER + WETH9 in .env");
  contracts.swapRouter = await dep("GembaSwapRouter", uniRouter, weth, FEE_RECIPIENT, SWAP_FEE_BPS);

  // swap router is Ownable(msg.sender=deployer) → hand ownership to OWNER
  const sr = await ethers.getContractAt("GembaSwapRouter", contracts.swapRouter);
  await (await sr.transferOwnership(OWNER)).wait();
  console.log(`  swap router ownership -> ${OWNER}`);

  ctorArgs.erc20         = [OWNER, FEE_RECIPIENT, FEES.erc20.toString()];
  ctorArgs.erc20tax      = [OWNER, FEE_RECIPIENT, FEES.erc20tax.toString()];
  ctorArgs.erc20advanced = [OWNER, FEE_RECIPIENT, FEES.erc20advanced.toString()];
  ctorArgs.erc721        = [OWNER, FEE_RECIPIENT, FEES.erc721.toString()];
  ctorArgs.erc721a       = [OWNER, FEE_RECIPIENT, FEES.erc721a.toString()];
  ctorArgs.erc1155       = [OWNER, FEE_RECIPIENT, FEES.erc1155.toString()];
  ctorArgs.swapRouter    = [uniRouter, weth, FEE_RECIPIENT, SWAP_FEE_BPS.toString()];

  const out = {
    network: network.name, chainId: "11155111", deployer: d.address,
    owner: OWNER, feeRecipient: FEE_RECIPIENT, swapPlatformFeeBps: Number(SWAP_FEE_BPS),
    startBalanceWei: startBal.toString(), contracts, ctorArgs,
  };
  fs.writeFileSync(path.join(__dirname, "deployed-production.json"), JSON.stringify(out, null, 2));
  console.log(`\nwrote scripts/deployed-production.json`);
  console.log("contracts.js FACTORIES[11155111] block:");
  console.log(JSON.stringify({ ...contracts }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
