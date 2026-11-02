// Verifies the contracts recorded in scripts/deployed-vouchers-<network>.json on the network's explorer.
//   npx hardhat run scripts/verify-vouchers.js --network sepolia
const { run, network } = require("hardhat");
const out = require(`./deployed-vouchers-${network.name}.json`);
(async () => {
  let failed = 0;
  for (const [k, v] of Object.entries(out.contracts)) {
    try { await run("verify:verify", { address: v.address, constructorArguments: v.args }); console.log(`verified ${k} ${v.address}`); }
    catch (e) {
      const m = e.message.split("\n")[0];
      if (/already verified/i.test(m)) console.log(`already verified ${k}`); else { failed++; console.log(`FAILED ${k}: ${m}`); }
    }
  }
  process.exit(failed ? 1 : 0);
})();
