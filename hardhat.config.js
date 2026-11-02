require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const ZERO_KEY = "0x" + "0".repeat(64);

// Collect all accounts — deployer first, then test wallets
// Filter out empty/undefined keys. Order matters: getSigners()[0] = deployer
const ALL_KEYS = [
  process.env.DEPLOYER_PRIVATE_KEY,
  process.env.FEEWALLET_PRIVATE_KEY,
  process.env.ALICE_PRIVATE_KEY,
  process.env.BOB_PRIVATE_KEY,
  process.env.CHARLIE_PRIVATE_KEY,
  process.env.DAVE_PRIVATE_KEY,
  process.env.EVE_PRIVATE_KEY,
].filter(Boolean);

const accounts = ALL_KEYS.length > 0 ? ALL_KEYS : [ZERO_KEY];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    compilers: [
      {
        version: "0.8.27",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
    ],
    overrides: {
      // PersonalWallet is vendored byte-for-byte from github.com/ivanovslavy/personal-wallet and MUST be built
      // exactly as there (0.8.28, optimizer 200, viaIR, cancun) — test/11 proves the bytecode is identical.
      "contracts/PersonalWallet.sol": {
        version: "0.8.28",
        settings: {
          optimizer: { enabled: true, runs: 200 },
          viaIR: true,
          evmVersion: "cancun",
        },
      },
    },
  },
  networks: {
    // --- Local ---
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    // --- Mainnets ---
    ethereum: {
      url: process.env.ETH_RPC_URL || "https://eth.llamarpc.com",
      chainId: 1,
      accounts,
    },
    bsc: {
      url: process.env.BSC_RPC_URL || "https://bsc-dataseed1.binance.org",
      chainId: 56,
      accounts,
    },
    polygon: {
      url: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
      chainId: 137,
      accounts,
    },
    base: {
      url: process.env.BASE_RPC_URL || "https://mainnet.base.org",
      chainId: 8453,
      accounts,
    },
    // --- Testnets ---
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
      chainId: 11155111,
      accounts,
    },
    bscTestnet: {
      url: "https://data-seed-prebsc-1-s1.binance.org:8545",
      chainId: 97,
      accounts,
    },
    amoy: {
      url: process.env.AMOY_RPC_URL || "https://rpc-amoy.polygon.technology",
      chainId: 80002,
      accounts,
    },
    gembatestnet: {
      url: process.env.GEMBATESTNET_RPC_URL || "https://rpc1.gembascan.io",
      chainId: 821207,
      accounts,
    },
    baseSepolia: {
      url: "https://sepolia.base.org",
      chainId: 84532,
      accounts,
    },
  },
  etherscan: {
    // Etherscan v2: single API key works across all supported chains
    // https://docs.etherscan.io/etherscan-v2
    // One Etherscan V2 key for every Etherscan chain; Blockscout (gembascan) ignores it.
    apiKey: process.env.ETHERSCAN_API_KEY || "blockscout",
    customChains: [
      {
        network: "gembatestnet",
        chainId: 821207,
        urls: { apiURL: "https://gembascan.io/api", browserURL: "https://gembascan.io" },
      },
    ],
  },
};
