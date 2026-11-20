// Moves ownership AND the fee recipient of every GembaTools contract to a new address (20.11.2026).
//
// Why: the old owner 0x8eB8…e298 is our multi-network TEST wallet; it also ran red-team honeypot tokens against our own
// sniper bot on Base mainnet, and Blockaid carries that wallet's flag over to gembatools.io. The new owner has no history.
//
//   NEW_OWNER=0x… NEW_FEE_RECIPIENT=0x… npx hardhat run scripts/rotate-owner.js --network sepolia
//   NEW_OWNER=0x… NEW_FEE_RECIPIENT=0x… npx hardhat run scripts/rotate-owner.js --network gembatestnet
//
// Signs with the OLD owner. Its key is looked up by ADDRESS in ~/allbotinfo1.txt, in memory only, never printed.
// For each contract: owner() must be the old owner → setFeeRecipient(new) → transferOwnership(new) → both read back.
// Plain OZ Ownable (no Ownable2Step): ownership moves at once — the new address is checked before anything is sent.
// Idempotent: a contract already moved is reported and skipped. Writes scripts/rotated-owner-<network>.json.
const { ethers, network } = require("hardhat");
const fs = require("fs");
const os = require("os");
const path = require("path");

const OLD_OWNER = "0x8eB8Bf106EbC9834a2586D04F73866C7436Ce298";
const CONTRACTS = {
  11155111: {
    erc20: "0x53eDC1058AF1f2358D3ede976081065b414a0Bba", erc20tax: "0x1ED31D4aB9FA8f6ca0C53e31e22E2c969CAE9CdB",
    erc20advanced: "0x99c950E41F889d9247674237f7B5c65ADaDE426B", erc721: "0x43e5c8a2703774fe1FD29E7814513723078A7567",
    erc721a: "0x186981c897D5F395a0B376Cb9752ffEb1c73880a", erc1155: "0x21BedCc6641968697A46B780B3326Bfa96C062fC",
    personalWallet: "0x72b1fdf87c995757FAa490A3F77c6CDEC67bDB70", rocket: "0x255D8ec901C01Ecf2193ADF8e8ab51dA5F265bf9",
    swapRouter: "0x3c96FD37bFfD548898ba7CE11F97EB437A7B126B", swapRouterV2: "0x6Dd6D546b75b5146C1e4D9fBd436892B6DEbA7FE",
  },
  821207: {
    erc20: "0xf4E91c67665C0e3cd9552BCD39633EDe28691cC6", erc20tax: "0x5885360baE6e349e5D0B03d20F08dc57b3eaB7AA",
    erc20advanced: "0x925f751d84817F079389B0be1727ae06c7206def", erc721: "0x81391720828956D533df4F7C3B764b36d1889666",
    erc721a: "0x8855E0c69F4461FE0dE577eA443dad5c1dBbA465", erc1155: "0x0671fe22Ab79E59BB014F41A3a18d38b8850FF84",
    personalWallet: "0x5F10c9385b5620ed8FDAFD08c8e4BbD86D3DF0ce", rocket: "0x71Db662b9B0489B382C5fA82Ed211e2E662F385C",
    swapRouterV2: "0x3b540321147dD267FA178Cb6bffA5E80E3CD9218", wrapRouter: "0x3783d93A08dB32Dc0e9B36Ad510f1B234F75010C",
  },
};
const SET_OWNER = new Set(["erc20advanced", "erc721a"]);
// On Sepolia the old owner is an EIP-7702 smart account: nodes allow ONE in-flight tx and a load-balanced public RPC
// lags a block — so: settle after every tx, and re-read until the chain shows the change.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventually(read, want, tries = 15) {
  let v; for (let i = 0; i < tries; i++) { v = await read(); if (v.toLowerCase() === want.toLowerCase()) return v; await sleep(3000); } return v;
}
const ABI = [
  "function owner() view returns (address)", "function feeRecipient() view returns (address)",
  "function setFeeRecipient(address)", "function transferOwnership(address)", "function setOwner(address)",
];

function oldOwnerSigner(provider) {
  const text = fs.readFileSync(path.join(os.homedir(), "allbotinfo1.txt"), "utf8");
  for (const m of text.matchAll(/(?:0x)?[0-9a-fA-F]{64}/g)) {
    try { const w = new ethers.Wallet(m[0].startsWith("0x") ? m[0] : "0x" + m[0]); if (w.address === OLD_OWNER) return w.connect(provider); } catch {}
  }
  throw new Error("old owner key not found");
}

async function main() {
  const NEW_OWNER = process.env.NEW_OWNER, NEW_FEE = process.env.NEW_FEE_RECIPIENT;
  for (const [k, v] of Object.entries({ NEW_OWNER, NEW_FEE_RECIPIENT: NEW_FEE })) if (!ethers.isAddress(v || "")) throw new Error(`${k} must be an address`);
  if ([NEW_OWNER, NEW_FEE].some((a) => a.toLowerCase() === OLD_OWNER.toLowerCase() || a === ethers.ZeroAddress)) throw new Error("new address must differ from the old owner and 0x0");
  const { chainId } = await ethers.provider.getNetwork();
  const list = CONTRACTS[Number(chainId)];
  if (!list) throw new Error(`no contract list for chain ${chainId}`);
  const s = oldOwnerSigner(ethers.provider);
  console.log(`network ${network.name} (${chainId}) | signer ${s.address} | balance ${ethers.formatEther(await ethers.provider.getBalance(s.address))}`);
  console.log(`new owner ${NEW_OWNER} | new fee recipient ${NEW_FEE}\n`);
  const out = { network: network.name, chainId: Number(chainId), at: new Date().toISOString(), oldOwner: OLD_OWNER, newOwner: NEW_OWNER, newFeeRecipient: NEW_FEE, contracts: {} };
  let failed = 0;
  for (const [k, a] of Object.entries(list)) {
    const c = new ethers.Contract(a, ABI, s);
    const rec = { address: a, txs: {} };
    try {
      let owner = await c.owner();
      if (owner.toLowerCase() === NEW_OWNER.toLowerCase()) { rec.status = "already moved"; console.log(`= ${k} ${a} already owned by the new owner`); }
      else {
        if (owner.toLowerCase() !== OLD_OWNER.toLowerCase()) throw new Error(`owner() is ${owner}, not the old owner`);
        if ((await c.feeRecipient()).toLowerCase() !== NEW_FEE.toLowerCase()) {
          const t1 = await c.setFeeRecipient(NEW_FEE); await t1.wait(); rec.txs.setFeeRecipient = t1.hash;
          await eventually(() => c.feeRecipient(), NEW_FEE); await sleep(2000);
        }
        // the Advanced-token and ERC721A factories name it setOwner(); every other contract is OZ transferOwnership()
        const fn = SET_OWNER.has(k) ? "setOwner" : "transferOwnership";
        const t2 = await c[fn](NEW_OWNER); await t2.wait(); rec.txs[fn] = t2.hash; await sleep(2000);
        rec.status = "moved";
      }
      owner = await eventually(() => c.owner(), NEW_OWNER); const fee = await eventually(() => c.feeRecipient(), NEW_FEE);
      rec.owner = owner; rec.feeRecipient = fee;
      const ok = owner.toLowerCase() === NEW_OWNER.toLowerCase() && fee.toLowerCase() === NEW_FEE.toLowerCase();
      if (!ok) { failed++; rec.status = "READ-BACK MISMATCH"; }
      console.log(`${ok ? "✓" : "✗"} ${k.padEnd(15)} ${a}  owner ${owner}  fee ${fee}`);
    } catch (e) { failed++; rec.status = "ERROR " + (e.shortMessage || e.message); console.log(`✗ ${k} ${a}: ${rec.status}`); }
    out.contracts[k] = rec;
  }
  const f = path.join(__dirname, `rotated-owner-${network.name}.json`);
  fs.writeFileSync(f, JSON.stringify(out, null, 2));
  console.log(`\nsaved ${path.basename(f)} — ${failed ? failed + " PROBLEM(S)" : "all " + Object.keys(list).length + " moved and read back"}`);
  if (failed) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exit(1); });
