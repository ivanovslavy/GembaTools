# Gemba Tools

**No-code smart contract deployment platform with integrated DEX, token presale infrastructure, and NFT gallery.**

Deploy tokens, NFT collections, launch presales, showcase your NFTs, and trade — all from your browser. No coding required.

**Live Platform:** [gembatools.io](https://gembatools.io)  
**Company:** [GEMBA EOOD](https://gembait.com) (EIK: 208656371), Varna, Bulgaria  
**License:** MIT

---

## What is Gemba Tools?

Gemba Tools is a web-based SaaS platform where anyone can create and manage blockchain assets without writing code. Connect your wallet, fill in parameters, pay the creation fee (a EUR price per contract type — through GembaPay, or in the network's own coin at GembaPay's rate), and receive a fully independent, verified smart contract that you own forever.

**Key Principles:**
- **Non-custodial** — you own your contracts, we never hold your funds or keys
- **No proxies** — every contract is a standalone deployment with real bytecode, not a proxy or clone
- **Verified source code** — all contracts are automatically verified on block explorers
- **Immutable where it matters** — tax rates, royalty fees, and supply caps cannot be changed after deployment
- **Open source** — full source code available for audit

---

## Platform Features

### CREATE — Token & NFT Deployment

| Contract | Description | Price | Key Features |
|----------|-------------|-------|--------------|
| **ERC20 Token** | Standard fungible token | €29 | Custom name, symbol, decimals, supply. Burn support. |
| **ERC20 Tax Token** | Token with transfer tax | €49 | Configurable tax rate (max 25 %, `MAX_TAX = 2500` bp), owner excluded. Immutable after deploy. |
| **ERC721 Collection** | NFT collection | €59 | ERC2981 royalties (max 10 %), configurable max supply, mint/mintBatch, burn. Auto `.json` URI suffix. OpenSea compatible. |
| **ERC1155 Multi-Token** | Multi-token collection | €69 | 1–1000 token IDs, max supply per ID enforced, ERC2981 royalties, burn/burnBatch. No auto-mint at deploy. |
| **ERC721A Advanced** | Gas-optimized NFT collection | €89 | ERC721A batch minting, owner-signed signature minting (one orderId = one mint), batch transfer/burn up to 100 NFTs. |
| **ERC20 Advanced** | Token with tax, presale & anti-bot | €119 | Separate buy/sell/transfer tax (max 5 % each), built-in presale with buyer page and embed widget, anti-bot, exclusions, ban list. |
| **Personal Wallet** | 2-of-3 multisig savings wallet | €199 | The separately audited [PersonalWallet](https://github.com/ivanovslavy/personal-wallet), byte-for-byte: 2 of 3 owners move funds, a new recipient needs all 3 + a 72 h timelock that any one owner can veto, strict recipient/token allowlists, native/ERC-20/ERC-721/ERC-1155. |

**How the price is paid** (a backend switch, `GEMBAPAY_FEES` — see [docs/FEES.md](docs/FEES.md)):
- **GembaPay mode** — the EUR price is paid through GembaPay by card or PayPal, or in GMB at a 20 % discount when
  GembaPay offers GMB. The backend confirms the order with GembaPay and signs a one-time voucher with fee 0.
- **On-chain mode** — the same EUR price is converted to the network's coin (ETH, GMB, …) at GembaPay's rate and
  paid with the deploy transaction; the voucher carries that amount and the factory checks it.

Either way every factory creates **only** with that voucher (EIP-712, bound to creator + contract type + chain +
factory + a single-use order id + a deadline — [`contracts/fees/FeeVoucher.sol`](contracts/fees/FeeVoucher.sol)).
There is no fixed on-chain fee any more (the old 0.02–0.07 "ETH on every chain" is gone).

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

### GALLERY — NFT Collection Viewer

Every NFT collection deployed through Gemba Tools gets a gallery page:

- **Gallery page** — `gembatools.io/gallery/{contractAddress}` — browse all minted NFTs
- **Metadata display** — images, names, descriptions, attributes from IPFS/HTTP metadata
- **Multi-standard support** — ERC721, ERC721A, and ERC1155 collections auto-detected
- **Detail modal** — click any NFT for full-size image, all attributes, owner, and Etherscan link
- **Embeddable widget** — iframe code to showcase your collection on external websites
- **IPFS gateway** — automatic `ipfs://` to HTTP gateway resolution
- **Lazy loading** — loads NFTs in batches with skeleton placeholders

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

Fee flow: backend voucher (EIP-712) → User → Factory: checks the voucher, burns its order id, forwards exactly the
voucher's native fee (0 when paid through GembaPay) to the Fee Recipient, refunds any excess — the factory holds 0.
```

### Branding

The token/NFT templates emit `CreatedViaGembaTools(address indexed token, string name, string symbol)` at deployment — visible in the block explorer Logs tab. (PersonalWallet is vendored unchanged and does not.)

---

## Contracts Overview

### Token Contracts (6 types)

**GembaERC20** — Standard ERC20 with burn support. OpenZeppelin v5.

**GembaERC20Tax** — ERC20 with immutable transfer tax. Tax rate locked at deployment (max 25 %, `MAX_TAX = 2500` bp). Owner excluded from tax. Tax receiver address configurable.

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

Deploy the 6 voucher-gated factories + the PersonalWallet factory (testnets only — the script refuses any other
chain id; the swap router is deployed separately by `scripts/deploy-production.js` and has no creation fee):

```bash
OWNER=0x… FEE_RECIPIENT=0x… VOUCHER_SIGNER=<address of the backend voucher key> \
  npx hardhat run scripts/deploy-vouchers.js --network sepolia        # or --network gembatestnet
npx hardhat run scripts/verify-vouchers.js --network sepolia          # Etherscan V2
npx hardhat run scripts/verify-blockscout.js --network gembatestnet   # gembascan (Blockscout)
```

The deploy record is written to `scripts/deployed-vouchers-<network>.json`.

### Supported Networks

**Testnets only.** Nothing is deployed on any mainnet.

| Network | Chain ID | Native coin | What is deployed |
|---------|----------|-------------|------------------|
| Sepolia | 11155111 | ETH | 7 factories (voucher-gated) + GembaSwapRouter (Uniswap V3) |
| GembaBlockchain Testnet | 821207 | GMB | 7 factories (voucher-gated); no swap (no Uniswap V3 there) |

### Deployed Contracts (2026-11-02, all verified)

Voucher signer (backend key): `0xcbD92139F15108Dc95590D74dC8A83a4946CE535` · Owner: `0x8eB8Bf106EbC9834a2586D04F73866C7436Ce298` · Fee recipient: `0x65124A08c9BFE0A7176668EE351573059Ea38ccC`

| Contract | Sepolia | GembaBlockchain Testnet |
|----------|---------|-------------------------|
| GembaERC20Factory | `0x53eDC1058AF1f2358D3ede976081065b414a0Bba` | `0xf4E91c67665C0e3cd9552BCD39633EDe28691cC6` |
| GembaERC20TaxFactory | `0x1ED31D4aB9FA8f6ca0C53e31e22E2c969CAE9CdB` | `0x5885360baE6e349e5D0B03d20F08dc57b3eaB7AA` |
| GembaERC20AdvancedFactory | `0x99c950E41F889d9247674237f7B5c65ADaDE426B` | `0x925f751d84817F079389B0be1727ae06c7206def` |
| GembaERC721Factory | `0x43e5c8a2703774fe1FD29E7814513723078A7567` | `0x81391720828956D533df4F7C3B764b36d1889666` |
| GembaERC721AFactory | `0x186981c897D5F395a0B376Cb9752ffEb1c73880a` | `0x8855E0c69F4461FE0dE577eA443dad5c1dBbA465` |
| GembaERC1155Factory | `0x21BedCc6641968697A46B780B3326Bfa96C062fC` | `0x0671fe22Ab79E59BB014F41A3a18d38b8850FF84` |
| GembaPersonalWalletFactory | `0x72b1fdf87c995757FAa490A3F77c6CDEC67bDB70` | `0x5F10c9385b5620ed8FDAFD08c8e4BbD86D3DF0ce` |
| GembaSwapRouter (audited, 30 bp) | `0x3c96FD37bFfD548898ba7CE11F97EB437A7B126B` | — |

---

## Revenue Model

| Source | Type | Description |
|--------|------|-------------|
| Contract creation | One-time | €29–€199 per contract (EUR via GembaPay, or the same price in the network's coin) |
| Swap platform fee | Recurring | 0.3% of every swap volume |
| Presale & Gallery | Viral | Free — drives platform adoption and brand exposure via embed widgets |

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

| Platform | Token Types | Swap/DEX | Presale Platform | NFT Gallery | Verified | Non-Proxy | Price |
|----------|-------------|----------|-----------------|-------------|----------|-----------|-------|
| **Gemba Tools** | 7 types | ✅ Uniswap V3 | ✅ Page + Embed | ✅ + Embed | ✅ | ✅ | €29–€199 |
| Bedrocktools | 3 types | ❌ | ❌ | ❌ | ✅ | ❌ (proxy) | 0.02–0.05 ETH |
| SmartContracts.tools | 2 types | ❌ | ❌ | ❌ | ✅ | ✅ | 0.01–0.03 ETH |
| Bitbond TokenTool | 4 types | ❌ | ❌ | ❌ | ✅ | ❌ | Subscription |
| PinkSale | 1 type | ❌ | ✅ (centralized) | ❌ | ❌ | ❌ | 1-2% fee |

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
