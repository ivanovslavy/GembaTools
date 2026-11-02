// Deploys the voucher-gated GembaTools factories (contracts/fees/FeeVoucher.sol) + the PersonalWallet factory.
// TESTNETS ONLY — refuses any other chain id. The swap router is NOT redeployed (it has no creation fee).
//
//   OWNER=0x… FEE_RECIPIENT=0x… VOUCHER_SIGNER=0x… npx hardhat run scripts/deploy-vouchers.js --network sepolia
//
// Writes scripts/deployed-vouchers-<network>.json and prints the block for the app's shared/deployments.json.
require("dotenv").config();
const { ethers, network, artifacts, run } = require("hardhat");
const fs = require("fs");
const path = require("path");

const TESTNETS = { 11155111: "sepolia", 821207: "gembatestnet", 97: "bscTestnet", 80002: "amoy", 84532: "baseSepolia", 31337: "localhost" };
const AUDITED_WALLET_CREATION_KECCAK = "0x520bb690dfa7d16fa7363019b625603717e2bf59e685df63bad03f37c90f5322";

async function main() {
  const { chainId } = await ethers.provider.getNetwork();
  if (!TESTNETS[Number(chainId)]) throw new Error(`refusing to deploy on chain ${chainId}: testnets only`);
  const OWNER = process.env.OWNER, FEE_RECIPIENT = process.env.FEE_RECIPIENT, SIGNER = process.env.VOUCHER_SIGNER;
  for (const [k, v] of Object.entries({ OWNER, FEE_RECIPIENT, VOUCHER_SIGNER: SIGNER })) {
    if (!ethers.isAddress(v || "")) throw new Error(`${k} must be an address`);
  }
  const [d] = await ethers.getSigners();
  const startBal = await ethers.provider.getBalance(d.address);
  console.log(`network ${network.name} (${chainId}) | deployer ${d.address} | balance ${ethers.formatEther(startBal)}`);
  console.log(`owner=${OWNER} feeRecipient=${FEE_RECIPIENT} voucherSigner=${SIGNER}`);

  const wallet = await artifacts.readArtifact("PersonalWallet");
  if (ethers.keccak256(wallet.bytecode) !== AUDITED_WALLET_CREATION_KECCAK) throw new Error("PersonalWallet build is not the audited one");

  const dep = async (name, ...args) => {
    const f = await ethers.getContractFactory(name);
    const c = await f.deploy(...args);
    await c.waitForDeployment();
    const a = await c.getAddress();
    const rc = await c.deploymentTransaction().wait();
    console.log(`  ${name.padEnd(28)} ${a}  tx ${rc.hash}`);
    return { address: a, tx: rc.hash, args };
  };

  const out = { network: network.name, chainId: Number(chainId), deployer: d.address, owner: OWNER, feeRecipient: FEE_RECIPIENT,
    voucherSigner: SIGNER, deployedAt: new Date().toISOString(), contracts: {} };
  const c = out.contracts;
  c.erc20 = await dep("GembaERC20Factory", OWNER, FEE_RECIPIENT, SIGNER);
  c.erc20tax = await dep("GembaERC20TaxFactory", OWNER, FEE_RECIPIENT, SIGNER);
  c.erc20advanced = await dep("GembaERC20AdvancedFactory", OWNER, FEE_RECIPIENT, SIGNER);
  c.erc721 = await dep("GembaERC721Factory", OWNER, FEE_RECIPIENT, SIGNER);
  c.erc721a = await dep("GembaERC721AFactory", OWNER, FEE_RECIPIENT, SIGNER);
  c.erc1155 = await dep("GembaERC1155Factory", OWNER, FEE_RECIPIENT, SIGNER);
  c.personalWallet = await dep("GembaPersonalWalletFactory", OWNER, FEE_RECIPIENT, SIGNER, wallet.bytecode);

  // sanity on chain — not the script's own say-so
  for (const [k, v] of Object.entries(c)) {
    const f = await ethers.getContractAt("FeeVoucher", v.address);
    const s = await f.voucherSigner();
    if (s !== SIGNER) throw new Error(`${k}: voucherSigner on chain is ${s}`);
  }
  const pwf = await ethers.getContractAt("GembaPersonalWalletFactory", c.personalWallet.address);
  if ((await pwf.walletCodeHash()) !== AUDITED_WALLET_CREATION_KECCAK) throw new Error("wallet code hash mismatch on chain");

  out.spentWei = (startBal - (await ethers.provider.getBalance(d.address))).toString();
  const file = path.join(__dirname, `deployed-vouchers-${network.name}.json`);
  fs.writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
  console.log(`\nwrote ${path.relative(process.cwd(), file)} — spent ${ethers.formatEther(out.spentWei)}`);
  console.log("factories for shared/deployments.json:");
  console.log(JSON.stringify(Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v.address])), null, 2));

  if (process.env.VERIFY === "1") {
    for (const [k, v] of Object.entries(c)) {
      try { await run("verify:verify", { address: v.address, constructorArguments: v.args }); console.log(`  verified ${k}`); }
      catch (e) { console.log(`  verify ${k}: ${e.message.split("\n")[0]}`); }
    }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
