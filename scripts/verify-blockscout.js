// Verifies scripts/deployed-vouchers-gembatestnet.json on gembascan (Blockscout v9). `hardhat verify` does not
// speak Blockscout's protocol; its own v2 standard-input endpoint does (file in field "files[0]", contract_name
// fully qualified). "verification started" is NOT success — this polls getsourcecode until the source is there.
//   npx hardhat run scripts/verify-blockscout.js --network gembatestnet
const { artifacts, ethers, network } = require("hardhat");
const out = require(`./deployed-vouchers-${network.name}.json`);
const BASE = "https://gembascan.io";
const NAMES = { erc20: "GembaERC20Factory", erc20tax: "GembaERC20TaxFactory", erc20advanced: "GembaERC20AdvancedFactory",
  erc721: "GembaERC721Factory", erc721a: "GembaERC721AFactory", erc1155: "GembaERC1155Factory", personalWallet: "GembaPersonalWalletFactory" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function verified(addr) {
  const j = await fetch(`${BASE}/api?module=contract&action=getsourcecode&address=${addr}`).then((r) => r.json());
  return !!(j.result && j.result[0] && j.result[0].SourceCode);
}

(async () => {
  let failed = 0;
  for (const [k, v] of Object.entries(out.contracts)) {
    const name = NAMES[k];
    const fqn = `contracts/${name}.sol:${name}`;
    if (await verified(v.address)) { console.log(`already verified ${k} ${v.address}`); continue; }
    const bi = await artifacts.getBuildInfo(fqn);
    const art = await artifacts.readArtifact(fqn);
    const args = new ethers.Interface(art.abi).encodeDeploy(v.args).slice(2);
    const fd = new FormData();
    fd.append("compiler_version", `v${bi.solcLongVersion}`);
    fd.append("contract_name", fqn);
    fd.append("autodetect_constructor_args", "false");
    fd.append("constructor_args", args);
    fd.append("license_type", "mit");
    fd.append("files[0]", new Blob([JSON.stringify(bi.input)], { type: "application/json" }), "input.json");
    const r = await fetch(`${BASE}/api/v2/smart-contracts/${v.address}/verification/via/standard-input`, { method: "POST", body: fd });
    const t = await r.text();
    let ok = false;
    for (let i = 0; i < 30 && !ok; i++) { await sleep(5000); ok = await verified(v.address); }
    console.log(`${ok ? "verified" : "FAILED"} ${k} ${v.address} (${r.status} ${t.slice(0, 80)})`);
    if (!ok) failed++;
  }
  process.exit(failed ? 1 : 0);
})();
