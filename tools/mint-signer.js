// Owner-side signature tool for GembatoolsAdvancedNFT.mintWithSignature (the ERC721A "Advanced NFT" type).
//
// What the contract checks (contracts/GembatoolsAdvancedNFT.sol, after audit fixes A1/A2):
//   hash   = keccak256(abi.encodePacked(to, orderId, nonce, address(collection), block.chainid))
//   signer = recover(toEthSignedMessageHash(hash), signature)  must equal owner()
//   orderId must never have been used (usedOrders) — one orderId = one mint.
//
// So the owner's tool MUST (and this one does):
//   1. sign exactly that hash, with the collection address and the chain id of the network it is used on;
//   2. use a fresh, random, unique orderId for every authorisation (never a counter, never reused);
//   3. refuse to sign if the key is not the collection's owner, if the orderId is already used on chain, or if it
//      already issued that orderId (local journal).
//
// Library use:  const { signMint } = require("./tools/mint-signer");  await signMint({ signer, collection, to, nonce })
// CLI use:      MINT_SIGNER_KEY=0x… node tools/mint-signer.js --rpc <url> --collection 0x… --to 0x… [--nonce N]
//               (the key is read from the environment only and is never printed; output is one JSON line)
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const ABI = [
  "function owner() view returns (address)",
  "function usedOrders(bytes32) view returns (bool)",
];

function mintHash({ to, orderId, nonce, collection, chainId }) {
  return ethers.solidityPackedKeccak256(
    ["address", "bytes32", "uint256", "address", "uint256"],
    [ethers.getAddress(to), orderId, BigInt(nonce), ethers.getAddress(collection), BigInt(chainId)]
  );
}

/** Journal of every orderId this tool has issued, per collection+chain — a second, local guard against reuse. */
function journal(file) {
  const read = () => (fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {});
  return {
    has: (key) => !!read()[key],
    add: (key, rec) => {
      const j = read(); j[key] = rec;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(j, null, 2), { mode: 0o600 });
    },
  };
}

/**
 * @param {object} p
 * @param {ethers.Signer} p.signer      the collection owner's signer, connected to the collection's chain
 * @param {string} p.collection         collection (GembatoolsAdvancedNFT) address
 * @param {string} p.to                 who may mint
 * @param {bigint|number|string} [p.nonce=0]
 * @param {string} [p.orderId]          only for tests/re-signing — normally left out so a fresh random one is made
 * @param {string} [p.journalFile]      defaults to ~/.config/gembatools/mint-orders.json
 */
async function signMint({ signer, collection, to, nonce = 0n, orderId, journalFile }) {
  if (!ethers.isAddress(collection) || !ethers.isAddress(to)) throw new Error("collection and to must be addresses");
  const provider = signer.provider;
  if (!provider) throw new Error("signer must be connected to the collection's network");
  const { chainId } = await provider.getNetwork();
  const c = new ethers.Contract(collection, ABI, provider);
  const owner = await c.owner();
  const me = await signer.getAddress();
  if (owner !== me) throw new Error(`refusing: ${me} is not the owner of ${collection} (owner is ${owner})`);

  orderId = orderId || ethers.hexlify(ethers.randomBytes(32));
  if (!/^0x[0-9a-fA-F]{64}$/.test(orderId)) throw new Error("orderId must be bytes32");
  if (await c.usedOrders(orderId)) throw new Error(`refusing: orderId ${orderId} is already used on chain`);
  const j = journal(journalFile || path.join(require("os").homedir(), ".config", "gembatools", "mint-orders.json"));
  const key = `${chainId}:${ethers.getAddress(collection)}:${orderId}`;
  if (j.has(key)) throw new Error(`refusing: orderId ${orderId} was already issued by this tool`);

  const hash = mintHash({ to, orderId, nonce, collection, chainId });
  const signature = await signer.signMessage(ethers.getBytes(hash)); // EIP-191 prefix = toEthSignedMessageHash
  if (ethers.verifyMessage(ethers.getBytes(hash), signature) !== me) throw new Error("self-check failed");
  const out = { collection: ethers.getAddress(collection), chainId: Number(chainId), to: ethers.getAddress(to),
    orderId, nonce: BigInt(nonce).toString(), signature };
  j.add(key, { to: out.to, nonce: out.nonce, at: new Date().toISOString() });
  return out;
}

module.exports = { signMint, mintHash };

if (require.main === module) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
  (async () => {
    const key = process.env.MINT_SIGNER_KEY;
    if (!/^0x[0-9a-fA-F]{64}$/.test(key || "")) throw new Error("set MINT_SIGNER_KEY (the collection owner's key) in the environment");
    const provider = new ethers.JsonRpcProvider(arg("rpc") || "https://ethereum-sepolia-rpc.publicnode.com");
    const signer = new ethers.Wallet(key, provider);
    const out = await signMint({ signer, collection: arg("collection"), to: arg("to"), nonce: arg("nonce") || 0 });
    console.log(JSON.stringify(out));
  })().catch((e) => { console.error("FAILED:", e.message); process.exit(1); });
}
