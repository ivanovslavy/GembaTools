const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log("Deployer:", deployer.address);
  console.log("Balance:", hre.ethers.formatEther(await hre.ethers.provider.getBalance(deployer.address)), "ETH\n");

  const FEE_RECIPIENT = process.env.FEE_RECIPIENT || deployer.address;

  const factories = [
    { name: "GembaERC20Factory",     key: "erc20",    fee: "0.03" },
    { name: "GembaERC20TaxFactory",  key: "erc20tax", fee: "0.06" },
    { name: "GembaERC721Factory",    key: "erc721",   fee: "0.05" },
    { name: "GembaERC1155Factory",   key: "erc1155",  fee: "0.05" },
  ];

  const deployed = {};

  for (const f of factories) {
    console.log(`━━━ Deploying ${f.name} ━━━`);
    const fee = hre.ethers.parseEther(f.fee);
    const Contract = await hre.ethers.getContractFactory(f.name);
    const instance = await Contract.deploy(deployer.address, FEE_RECIPIENT, fee);
    await instance.waitForDeployment();
    const addr = await instance.getAddress();
    deployed[f.key] = { address: addr, fee: f.fee + " ETH" };
    console.log(`  Address: ${addr}  |  Fee: ${f.fee} ETH`);
  }

  // --- Verify ---
  const network = hre.network.name;
  if (network !== "hardhat" && network !== "localhost") {
    console.log("\nWaiting 20s for block explorer indexing...");
    await new Promise((r) => setTimeout(r, 20000));

    for (const f of factories) {
      const fee = hre.ethers.parseEther(f.fee);
      try {
        await hre.run("verify:verify", {
          address: deployed[f.key].address,
          constructorArguments: [deployer.address, FEE_RECIPIENT, fee],
        });
        console.log(`✅ ${f.name} verified`);
      } catch (err) {
        console.log(`⚠️  ${f.name}: ${err.message}`);
      }
    }
  }

  // --- Save JSON ---
  const deployDir = "./deployed";
  if (!fs.existsSync(deployDir)) fs.mkdirSync(deployDir, { recursive: true });

  const now = new Date();
  const deployment = {
    network,
    chainId: (await hre.ethers.provider.getNetwork()).chainId.toString(),
    deployer: deployer.address,
    feeRecipient: FEE_RECIPIENT,
    factories: deployed,
    deployedAt: now.toISOString(),
    blockNumber: (await hre.ethers.provider.getBlockNumber()).toString(),
  };

  const filename = `${network}-${now.toISOString().split("T")[0]}.json`;
  fs.writeFileSync(path.join(deployDir, filename), JSON.stringify(deployment, null, 2));
  console.log(`\n📄 Deployment saved to deployed/${filename}`);

  // --- Export ABIs ---
  const abiDir = "./abi";
  if (!fs.existsSync(abiDir)) fs.mkdirSync(abiDir);

  const contracts = [
    "GembaERC20Factory", "GembaERC20TaxFactory", "GembaERC721Factory", "GembaERC1155Factory",
    "GembaERC20", "GembaERC20Tax", "GembaERC721", "GembaERC1155",
  ];
  for (const c of contracts) {
    const artifact = await hre.artifacts.readArtifact(c);
    fs.writeFileSync(path.join(abiDir, `${c}.json`), JSON.stringify(artifact.abi, null, 2));
  }
  console.log("📄 ABIs exported to ./abi/");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
