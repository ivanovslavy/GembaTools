# Gemba Tools

No-code smart contract deployment platform by [GEMBA EOOD](https://gembaindustrial.com).

Deploy ERC20 tokens, taxable tokens, NFT collections (ERC721), and multi-token collections (ERC1155) directly from your wallet. Pay a flat creation fee in ETH — receive a fully independent, verified smart contract that you own.

## Contracts

| Contract | Description | Features |
|----------|-------------|----------|
| **GembaERC20** | Standard ERC20 token | Custom name, symbol, decimals, supply. Burn support. |
| **GembaERC20Tax** | ERC20 with transfer tax | Immutable tax rate (max 25%), owner excluded. Burn support. |
| **GembaERC721** | NFT collection | ERC2981 royalties, configurable max supply, mint/mintBatch, burn. OpenSea compatible. |
| **GembaERC1155** | Multi-token collection | 1–1000 token IDs at deploy, ERC2981 royalties, burn/burnBatch. OpenSea compatible. |

Each contract type has its own standalone factory. Factories forward creation fees immediately to a configurable recipient and never hold ETH.

## Requirements

- [Node.js](https://nodejs.org/) v18+
- A wallet with ETH on the target network

## Setup

```bash
git clone https://github.com/ivanovslavy/gemba-tools.git
cd gemba-tools
npm install
```

Create a `.env` file from the template:

```bash
cp .env.example .env
```

Fill in your keys:

```
DEPLOYER_PRIVATE_KEY=your_private_key
FEE_RECIPIENT=0x_address_that_receives_fees
SEPOLIA_RPC_URL=https://rpc.ankr.com/eth_sepolia/your_key
ETHERSCAN_API_KEY=your_etherscan_v2_key
```

## Compile

```bash
npx hardhat compile
```

## Deploy

Deploy all 4 factories to a network:

```bash
# Testnet
npx hardhat run scripts/deploy.js --network sepolia

# Mainnet
npx hardhat run scripts/deploy.js --network ethereum
npx hardhat run scripts/deploy.js --network bsc
npx hardhat run scripts/deploy.js --network polygon
npx hardhat run scripts/deploy.js --network base
```

The deploy script will:
- Deploy `GembaERC20Factory`, `GembaERC20TaxFactory`, `GembaERC721Factory`, `GembaERC1155Factory`
- Save deployment addresses to `deployed/{network}-{date}.json`
- Export ABIs to `abi/`
- Verify contracts on Etherscan (waits 20s, skipped on localhost)

## Supported Networks

| Network | Chain ID |
|---------|----------|
| Ethereum | 1 |
| BSC | 56 |
| Polygon | 137 |
| Base | 8453 |
| Sepolia (testnet) | 11155111 |
| BSC Testnet | 97 |
| Polygon Amoy | 80002 |
| Base Sepolia | 84532 |
| Localhost | 31337 |

## Creation Fees

| Factory | Fee |
|---------|-----|
| ERC20 | 0.03 ETH |
| ERC20 Tax | 0.06 ETH |
| ERC721 | 0.05 ETH |
| ERC1155 | 0.05 ETH |

Fees are configurable by the factory owner after deployment.

## Architecture

Each factory is a standalone contract that carries the full bytecode of its token template. When a user calls `createToken()`, the factory deploys a fresh, independent contract owned by the caller. No proxies, no clones — real contracts.

Adding new contract types in the future is simple: deploy a new factory, register its address in the frontend config. Existing factories are never modified.

## Verify Manually

If automatic verification fails, verify manually:

```bash
npx hardhat verify --network sepolia --contract contracts/GembaERC20.sol:GembaERC20 \
  CONTRACT_ADDRESS "Token Name" "SYM" 18 1000000 OWNER_ADDRESS
```

## License

MIT — see [LICENSE](LICENSE).

Copyright (c) 2026 GEMBA EOOD
