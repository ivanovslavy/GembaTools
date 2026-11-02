# GembaTools — creation fees (since 2026-11-02)

The factories no longer carry a fixed native fee. Before this change every factory had `creationFee` in wei —
**one number for every chain**: "0.02" meant 0.02 ETH on Ethereum and 0.02 BNB on BNB Chain.

## The price list (EUR)

Ordered by value to the customer and by the complexity/risk of what is deployed. The single source is
`shared/pricing.json` in the app repository (served to the browser by `GET /api/config`).

| Type | € | Why this position |
|---|---:|---|
| ERC20 token | 29 | Simplest standard token; entry product |
| ERC20 tax token | 49 | + immutable transfer tax logic, tax receiver |
| ERC721 collection | 59 | NFT collection with royalties, metadata, supply cap |
| ERC1155 multi-token | 69 | Up to 1000 ids, per-id caps, royalties — more surface than ERC721 |
| ERC721A advanced NFT | 89 | Gas-optimised batch mint, owner-signed mint with single-use orders, batch transfer/burn |
| ERC20 advanced token | 119 | Buy/sell/transfer tax, on-chain presale with page + embed, anti-bot, exclusions, ban list |
| Personal Wallet | 199 | Custody of real value: 2-of-3 multisig, 3-of-3 + 72 h vetoable timelock for new recipients, allowlists — the highest stakes, separately audited |

GMB discount: 20 % (`gmbDiscountPct`, overridable by `GMB_DISCOUNT_PCT`); GembaPay counts 1 GMB = €1.

## Two modes — one switch in the backend (`GEMBAPAY_FEES`)

| | `true` — GembaPay | `false` — on-chain |
|---|---|---|
| What the user pays | the EUR price, by card / PayPal (or GMB −20 % while GembaPay offers crypto) | the EUR price converted to the chain's coin at GembaPay's rate (GMB: −20 %) |
| Who proves payment | GembaPay's own order lookup, authenticated with our API key (status `completed`, EUR, exact amount, test/live mode matches); the Signature-V2 webhook only triggers the lookup | the factory: `msg.value >= voucher.feeWei` |
| Voucher fee | 0 | the quoted wei amount |
| Rate source | — | GembaPay `GET /api/customer/rates` (EUR/USD) + GembaPay's PaymentGateway `getPriceQuote()` on that chain (Chainlink, reverts on a stale price); GMB at GembaPay's 1 GMB = €1 |
| Rate safety | — | cache ≤ `RATE_MAX_AGE_SEC` (120 s); unavailable/implausible → 503 (no guessing); a move above `RATE_TOLERANCE_PCT` (2 %) between quote and order → `RATE_MOVED`, the user re-confirms |

Any other value of `GEMBAPAY_FEES` (or a missing key/secret) disables every fee endpoint — fail closed. The app
reads the mode from the backend at runtime; nothing about the fee is in the browser bundle.

## The voucher (`contracts/fees/FeeVoucher.sol`)

EIP-712, domain `GembaTools`/`1`/chainId/factory, struct
`CreateVoucher(address creator, uint8 contractType, bytes32 orderId, uint256 feeWei, uint64 expiresAt)`.
Bound to the creator (`msg.sender`), the contract type, the chain and the factory; the `orderId` is burned on first
use; `expiresAt` is a deadline. A factory with no signer configured creates nothing.
Rotate the backend key with `setVoucherSigner(newAddress)` (factory owner).
