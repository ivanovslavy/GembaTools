# Gemba Tools

**No-code smart contract deployment platform with integrated DEX and token presale infrastructure.**

Deploy tokens, NFT collections, launch presales, and trade — all from your browser. No coding required.

**Live Platform:** [gembatools.io](https://gembatools.io)  
**Company:** [GEMBA EOOD](https://gembait.com) (EIK: 208656371), Varna, Bulgaria  
**License:** MIT

---

## What is Gemba Tools?

Gemba Tools is a web-based SaaS platform where anyone can create and manage blockchain assets without writing code. Connect your wallet, fill in parameters, pay a flat creation fee, and receive a fully independent, verified smart contract that you own forever.

**Key Principles:**
- **Non-custodial** — you own your contracts, we never hold your funds or keys
- **No proxies** — every contract is a standalone deployment with real bytecode, not a proxy or clone
- **Verified source code** — all contracts are automatically verified on block explorers
- **Immutable where it matters** — tax rates, royalty fees, and supply caps cannot be changed after deployment
- **Open source** — full source code available for audit

---

## Platform Features

### CREATE — Token & NFT Deployment

| Contract | Description | Fee | Key Features |
|----------|-------------|-----|--------------|
| **ERC20 Token** | Standard fungible token | 0.02 ETH | Custom name, symbol, decimals, supply. Burn support. |
| **ERC20 Tax Token** | Token with transfer tax | 0.03 ETH | Configurable tax rate (max 10%), owner excluded. Immutable after deploy. |
| **ERC20 Advanced** | Token with tax, presale & anti-bot | 0.07 ETH | Separate buy/sell/transfer tax (max 5% each), built-in presale with dedicated buyer page and embed widget, anti-bot protection, address exclusions, ban list. Presale tokens minted to contract at deployment. |
| **ERC721 Collection** | NFT collection | 0.04 ETH | ERC2981 royalties, configurable max supply, mint/mintBatch, burn. Auto `.json` URI suffix. OpenSea compatible. |
| **ERC721A Advanced** | Gas-optimized NFT collection | 0.06 ETH | ERC721A (70-85% gas savings), signature minting, batch transfer/burn up to 100 NFTs, ECDSA replay protection. |
| **ERC1155 Multi-Token** | Multi-token collection | 0.05 ETH | 1–1000 token IDs, max supply per ID enforced, ERC2981 royalties, burn/burnBatch. No auto-mint at deploy. |

### SWAP — Integrated DEX

Trade any ERC20 token via Uniswap V3 with a 0.3% platform fee.

- **ETH ↔ Token** — platform fee from ETH
- **Token ↔ ETH** — platform fee from ETH output
- **Token ↔ Token** — routed through WETH, platform fee always in ETH
- **ETH ↔ WETH** — wrap/unwrap with platform fee
- All swaps protected with `ReentrancyGuard` and `deadline` parameter
- Price quotes via Uniswap V3 QuoterV2

### LIQUIDITY — Uniswap V3 Management

- **Add Liquidity** — create pools or add to existing ones, auto-creates pool if needed
- **Your Positions** — view all V3 NFT positions with real token amounts
- **Remove Liquidity** — partial or full removal with fee collection
- **Lock Liquidity** — permanently lock by transferring position NFT to burn address (shows as "LP Burned" on DexScreener/TokenSniffer)

### MANAGE — Token & NFT Management

- **Your Collections** — manage ERC721/ERC1155/ERC721A collections, mint NFTs, batch operations
- **Burn Token** — burn ERC20 tokens from your wallet
- **Burn LP Position** — burn empty V3 position NFTs or lock liquidity forever
- **Renounce Ownership** — permanently give up contract ownership
- **Manage Tax Token** — view tax token configuration
- **Manage Advanced Token** — full dashboard: tax rates, presale (open/end/claim), anti-bot, address exclusions, DEX pair registration, ban list
- **Update Metadata** — update base URI and contract URI for NFT collections

### PRESALE — Token Launch Infrastructure

Every Advanced Token with presale allocation gets a complete launch system:

- **Presale tokens minted to contract at deployment** — no manual transfer needed, MetaMask-safe
- **Dedicated presale page** — `gembatools.io/presale/{contractAddress}` — shareable link for buyers
- **Embeddable widget** — iframe code for integration on external websites with "Powered by Gemba Tools"
- **Presale management** — open with rate and wallet limits, close, finalize (claim ETH + unsold tokens)
- **Live progress** — real-time sold percentage, remaining tokens, ETH collected
- **Buyer dashboard** — shows rate, wallet limit, already purchased amount

Presale flow:
1. Deploy Advanced Token with presale amount (e.g., 200M of 1B total supply)
2. 200M tokens minted to contract, 800M to your wallet
3. Open presale — set rate and max per wallet
4. Share presale link or embed widget on your website
5. Buyers connect wallet and purchase at fixed rate
6. Close presale → Claim ETH + unsold tokens

### INFO

- **Token List** — view all tokens created through the platform
- **About** — platform overview, features, security, company info

---

## Smart Contract Architecture

Each factory is a standalone contract carrying the full bytecode of its token template. When a user calls `createToken()`, the factory deploys a fresh, independent contract owned by the caller.

```
User connects wallet
        │
        ▼
┌─────────────────────┐
│   gembatools.io     │  React frontend
│   (React + wagmi)   │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│   Factory Contract  │  On-chain (one per token type)
│   createToken()     │
└────────┬────────────┘
         │ deploys
         ▼
┌─────────────────────┐
│   Token Contract    │  Independent, owned by user
│   (verified)        │  No proxy, no admin backdoor
└─────────────────────┘

Fee flow: User → Factory → Fee Recipient (immediate forward, factory holds 0 ETH)
```

### Branding

All contracts emit `CreatedViaGembaTools(address indexed token, string name, string symbol)` at deployment — visible in block explorer Logs tab.

---

## Contracts Overview

### Token Contracts (6 types)

**GembaERC20** — Standard ERC20 with burn support. OpenZeppelin v5.

**GembaERC20Tax** — ERC20 with immutable transfer tax. Tax rate locked at deployment (max 10%). Owner excluded from tax. Tax receiver address configurable.

**GembaERC20Advanced** — Full-featured ERC20 with:
- Constructor accepts `AdvancedTokenParams` struct (file-level) to avoid stack-too-deep
- Presale tokens minted to contract at deployment (no manual transfer needed)
- Separate buy/sell/transfer tax rates (each max 5%, configurable by owner)
- Owner chooses where tax applies: buy only, sell only, transfer only, or any combination
- Built-in presale: set rate, max per wallet, open/close, finalize and claim ETH + unsold tokens
- Dedicated presale buyer page at `gembatools.io/presale/{contractAddress}`
- Embeddable presale widget (iframe) for external websites
- Anti-bot protection: configurable duration, max wallet limit, 1 tx per block
- Address exclusions: manual exclude, optional presale buyer exclusion or reduced rate
- Ban list: owner can ban addresses (cannot ban self)
- DEX pair detection: owner adds LP pair addresses for buy/sell tax logic
- Compatible with Uniswap V2 and V3

**GembaERC721** — NFT collection with ERC2981 royalties. Auto-appends `.json` to tokenURI. Configurable URI suffix via `setURISuffix()`. Mint, mintBatch, burn.

**GembatoolsAdvancedNFT (ERC721A)** — Gas-optimized NFT collection based on Azuki's ERC721A:
- 70-85% gas savings on batch minting (up to 1,000 per tx)
- Signature minting (`mintWithSignature`) with ECDSA + replay protection
- Batch transfer by ID or sequential range (up to 100 per tx)
- Batch burn (up to 100 per tx)
- Blocks incoming ETH, ERC20, ERC721, ERC1155 transfers
- ERC2981 royalties (max 10%)

**GembaERC1155** — Multi-token collection with ERC1155Supply tracking:
- 1-1000 token IDs, max supply per ID enforced
- No auto-mint at deploy — owner mints on demand
- `uri()` returns `baseURI + id + ".json"`
- ERC2981 royalties, burn/burnBatch

### Swap Router

**GembaSwapRouter** — Wraps Uniswap V3 SwapRouter with platform fee:
- 0.3% fee on every swap, always collected as ETH
- Token → Token routed through WETH (two hops) for consistent ETH fee collection
- ETH ↔ WETH wrap/unwrap with fee
- `ReentrancyGuard` + `deadline` on all functions
- Max fee hardcapped at 1% (100bp)
- Owner can adjust fee and fee recipient

---

## Security

All contracts have been analyzed with Slither static analysis.

| Feature | Implementation |
|---------|---------------|
| Reentrancy protection | OpenZeppelin `ReentrancyGuard` on all state-changing functions |
| Access control | `Ownable` pattern with ownership transfer |
| Fee caps | Hard-coded maximum tax (5-10%) and swap fee (1%) |
| Input validation | All constructor and function parameters validated |
| CEI pattern | Checks-Effects-Interactions ordering in all ETH-handling functions |
| No proxy patterns | Every contract is standalone — no delegatecall, no Diamond, no UUPS |
| Replay protection | ECDSA signatures with `usedSignatures` mapping (ERC721A) |
| Front-running protection | Validate-then-execute pattern on batch operations |

---

## Tech Stack

### Smart Contracts
| Technology | Version | Purpose |
|------------|---------|---------|
| Solidity | 0.8.24 / 0.8.27 | Smart contract language |
| Hardhat | 2.x | Development & testing |
| OpenZeppelin | v5 | Security standards |
| ERC721A (Azuki) | latest | Gas-optimized NFT |
| Slither | latest | Security analysis |

### Frontend
| Technology | Version | Purpose |
|------------|---------|---------|
| React | 18 | UI framework |
| Vite | 6 | Build tool |
| wagmi | v2 | Wallet connection & contract interaction |
| viem | latest | Ethereum utilities |
| @tanstack/react-query | latest | Async state management |

### Infrastructure
| Service | Purpose |
|---------|---------|
| Hetzner VPS | Application hosting |
| Cloudflare | DNS, SSL, DDoS protection |
| Apache | Reverse proxy |
| systemd | Process management |

---

## Deployment

### Setup

```bash
git clone https://github.com/ivanovslavy/GembaTools.git
cd GembaTools
npm install
cp .env.example .env
```

Edit `.env` with your private key, RPC URLs, and block explorer API keys.

### Compile

```bash
npx hardhat compile
```

### Deploy

Deploy all 6 factories + swap router:

```bash
# Testnet
FEE_RECIPIENT=0x65124A08c9BFE0A7176668EE351573059Ea38ccC \
SWAP_FEE_RECIPIENT=0x65124A08c9BFE0A7176668EE351573059Ea38ccC \
npx hardhat run scripts/deploy.js --network sepolia

# Mainnet
FEE_RECIPIENT=0x... SWAP_FEE_RECIPIENT=0x... \
npx hardhat run scripts/deploy.js --network ethereum
```

The script deploys all contracts, verifies on block explorers, saves addresses to `deployed/`, and exports ABIs to `abi/`.

### Supported Networks

| Network | Chain ID | Status |
|---------|----------|--------|
| Ethereum | 1 | Production |
| BSC | 56 | Production |
| Polygon | 137 | Production |
| Base | 8453 | Production |
| Sepolia | 11155111 | Testnet |

### Deployed Contracts — Sepolia Testnet

| Contract | Address | Fee |
|----------|---------|-----|
| GembaERC20Factory | [`0xF3aB51315BbC26ea4e3a509d5bE139d1246a999E`](https://sepolia.etherscan.io/address/0xF3aB51315BbC26ea4e3a509d5bE139d1246a999E) | 0.02 ETH |
| GembaERC20TaxFactory | [`0x722191FBef1960fa4e23771946D94A2051D5f2Ae`](https://sepolia.etherscan.io/address/0x722191FBef1960fa4e23771946D94A2051D5f2Ae) | 0.03 ETH |
| GembaERC721Factory | [`0xcC95A4A33C4b7e769CfB6841Ec92B922266Df26E`](https://sepolia.etherscan.io/address/0xcC95A4A33C4b7e769CfB6841Ec92B922266Df26E) | 0.04 ETH |
| GembaERC1155Factory | [`0xFA99A9EBc5b180f6538cD4959f8d9Fb20C26E4f0`](https://sepolia.etherscan.io/address/0xFA99A9EBc5b180f6538cD4959f8d9Fb20C26E4f0) | 0.05 ETH |
| GembaERC721AFactory | [`0xe6acD89ac14667c95878A71F44c4233Dd0bEcf5f`](https://sepolia.etherscan.io/address/0xe6acD89ac14667c95878A71F44c4233Dd0bEcf5f) | 0.06 ETH |
| GembaERC20AdvancedFactory | [`0x8D821d2440Be64D7de39188Aac4Af769F2538e4C`](https://sepolia.etherscan.io/address/0x8D821d2440Be64D7de39188Aac4Af769F2538e4C) | 0.07 ETH |
| GembaSwapRouter | [`0x8405CEB8212a9e725162C78aBF5Adebab5820387`](https://sepolia.etherscan.io/address/0x8405CEB8212a9e725162C78aBF5Adebab5820387) | 0.3% (30bp) |

Deployer: `0x8eB8Bf106EbC9834a2586D04F73866C7436Ce298`  
Fee Recipient: `0x65124A08c9BFE0A7176668EE351573059Ea38ccC`

---

## Revenue Model

| Source | Type | Description |
|--------|------|-------------|
| Token creation fees | One-time | 0.02–0.07 ETH per contract deployment |
| Swap platform fee | Recurring | 0.3% of every swap volume |
| Presale infrastructure | Viral | Free — drives platform adoption and brand exposure via embed widgets |

---

## Project Structure

```
GembaTools/
├── contracts/
│   ├── GembaERC20.sol                 # Standard ERC20
│   ├── GembaERC20Factory.sol
│   ├── GembaERC20Tax.sol              # ERC20 with immutable tax
│   ├── GembaERC20TaxFactory.sol
│   ├── GembaERC20Advanced.sol         # ERC20 with tax + presale + anti-bot
│   ├── GembaERC20AdvancedFactory.sol
│   ├── GembaERC721.sol                # NFT collection
│   ├── GembaERC721Factory.sol
│   ├── GembatoolsAdvancedNFT.sol      # Gas-optimized NFT (ERC721A)
│   ├── GembaERC721AFactory.sol
│   ├── GembaERC1155.sol               # Multi-token collection
│   ├── GembaERC1155Factory.sol
│   └── GembaSwapRouter.sol            # DEX swap with platform fee
├── scripts/
│   └── deploy.js                      # Deploy all contracts
├── deployed/                          # Deployment records
├── abi/                               # Exported ABIs
├── hardhat.config.js
├── .env.example
├── LICENSE
└── README.md
```

---

## Competitors

| Platform | Token Types | Swap/DEX | Presale Platform | Verified | Non-Proxy | Price |
|----------|-------------|----------|-----------------|----------|-----------|-------|
| **Gemba Tools** | 6 types | ✅ Uniswap V3 | ✅ Page + Embed | ✅ | ✅ | 0.02–0.07 ETH |
| Bedrocktools | 3 types | ❌ | ❌ | ✅ | ❌ (proxy) | 0.02–0.05 ETH |
| SmartContracts.tools | 2 types | ❌ | ❌ | ✅ | ✅ | 0.01–0.03 ETH |
| Bitbond TokenTool | 4 types | ❌ | ❌ | ✅ | ❌ | Subscription |
| PinkSale | 1 type | ❌ | ✅ (centralized) | ❌ | ❌ | 1-2% fee |

---

## Links

| Resource | URL |
|----------|-----|
| Platform | [gembatools.io](https://gembatools.io) |
| GitHub | [github.com/ivanovslavy/GembaTools](https://github.com/ivanovslavy/GembaTools) |
| Company | [gembait.com](https://gembait.com) |
| Contact | contacts@gembait.com |

---

## License

MIT License — Copyright (c) 2025-2026 GEMBA EOOD

**Built by [GEMBA EOOD](https://gembait.com) — Blockchain Technology Studio, Varna, Bulgaria**
