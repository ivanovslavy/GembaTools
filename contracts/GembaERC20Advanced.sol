// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title GembaERC20Advanced
 * @author Gemba EOOD (https://gembatools.io)
 * @notice Advanced ERC20 token with configurable tax, built-in presale, and anti-bot protection.
 *
 * Created via GembaTools — https://gembatools.io
 */

struct AdvancedTokenParams {
    string name;
    string symbol;
    uint8 tokenDecimals;
    uint256 totalSupply;
    uint256 presaleAmount;
    address owner;
    address taxReceiver;
    uint16 buyTax;
    uint16 sellTax;
    uint16 transferTax;
    bool taxOnBuy;
    bool taxOnSell;
    bool taxOnTransfer;
}

contract GembaERC20Advanced is ERC20, Ownable, ReentrancyGuard {

    // ======================== TAX ========================

    uint16 public buyTax;
    uint16 public sellTax;
    uint16 public transferTax;
    uint16 public constant MAX_TAX = 500;

    address public taxReceiver;

    bool public taxOnBuy;
    bool public taxOnSell;
    bool public taxOnTransfer;

    bool public presaleBuyersExcluded;
    uint16 public presaleBuyersReducedTax;

    mapping(address => bool) public isExcludedFromTax;
    mapping(address => bool) public isDexPair;
    mapping(address => bool) public isBanned;

    // ======================== PRESALE ========================

    bool public presaleActive;
    bool public presaleFinalized;
    uint256 public presaleRate;
    uint256 public presaleMaxPerWallet;
    uint256 public presaleTokensLeft;
    uint256 public presaleEthCollected;

    mapping(address => uint256) public presalePurchased;
    mapping(address => bool) public isPresaleBuyer;

    // ======================== ANTI-BOT ========================

    bool public antiBotEnabled;
    uint256 public antiBotStartTime;
    uint256 public antiBotDuration;
    uint256 public antiBotMaxPerWallet;
    mapping(address => uint256) public lastTxBlock;

    // ======================== EVENTS ========================

    event TaxUpdated(uint16 buyTax, uint16 sellTax, uint16 transferTax);
    event TaxReceiverUpdated(address indexed oldReceiver, address indexed newReceiver);
    event TaxConfigUpdated(bool onBuy, bool onSell, bool onTransfer);
    event AddressExcluded(address indexed account, bool excluded);
    event AddressBanned(address indexed account, bool banned);
    event DexPairUpdated(address indexed pair, bool isPair);

    event PresaleOpened(uint256 rate, uint256 tokensAvailable, uint256 maxPerWallet);
    event PresaleClosed();
    event PresaleFinalized(uint256 ethCollected, uint256 unsoldTokens);
    event TokensPurchased(address indexed buyer, uint256 ethAmount, uint256 tokenAmount);
    event PresaleBuyerTaxConfig(bool excluded, uint16 reducedRate);

    event AntiBotConfigured(uint256 duration, uint256 maxPerWallet);
    event AntiBotStarted(uint256 startTime, uint256 endTime);

    event CreatedViaGembaTools(address indexed token, string name, string symbol);

    // ======================== CONSTRUCTOR ========================

    uint8 private immutable _decimals;

    constructor(AdvancedTokenParams memory p) ERC20(p.name, p.symbol) Ownable(p.owner) {
        require(p.owner != address(0), "GembaERC20Advanced: zero owner");
        require(p.buyTax <= MAX_TAX, "GembaERC20Advanced: buy tax exceeds 5%");
        require(p.sellTax <= MAX_TAX, "GembaERC20Advanced: sell tax exceeds 5%");
        require(p.transferTax <= MAX_TAX, "GembaERC20Advanced: transfer tax exceeds 5%");

        _decimals = p.tokenDecimals;
        taxReceiver = p.taxReceiver == address(0) ? p.owner : p.taxReceiver;
        buyTax = p.buyTax;
        sellTax = p.sellTax;
        transferTax = p.transferTax;
        taxOnBuy = p.taxOnBuy;
        taxOnSell = p.taxOnSell;
        taxOnTransfer = p.taxOnTransfer;

        isExcludedFromTax[p.owner] = true;

        uint256 totalTokens = p.totalSupply * 10 ** p.tokenDecimals;
        uint256 presaleTokens = p.presaleAmount * 10 ** p.tokenDecimals;
        require(presaleTokens <= totalTokens, "GembaERC20Advanced: presale exceeds supply");

        if (presaleTokens > 0) {
            _mint(address(this), presaleTokens);
        }
        _mint(p.owner, totalTokens - presaleTokens);

        emit CreatedViaGembaTools(address(this), p.name, p.symbol);
    }

    // ======================== DECIMALS ========================

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }

    // ======================== TRANSFER LOGIC ========================

    function _update(address from, address to, uint256 amount) internal virtual override {
        require(!isBanned[from], "GembaERC20Advanced: sender banned");
        require(!isBanned[to], "GembaERC20Advanced: recipient banned");

        if (antiBotEnabled && antiBotStartTime > 0) {
            if (block.timestamp <= antiBotStartTime + antiBotDuration) {
                if (from != address(0) && to != address(0)) {
                    require(lastTxBlock[to] < block.number, "GembaERC20Advanced: 1 tx per block");
                    lastTxBlock[to] = block.number;

                    if (antiBotMaxPerWallet > 0 && !isExcludedFromTax[to]) {
                        require(
                            balanceOf(to) + amount <= antiBotMaxPerWallet,
                            "GembaERC20Advanced: exceeds anti-bot wallet limit"
                        );
                    }
                }
            }
        }

        uint256 taxAmount = 0;

        if (from != address(0) && to != address(0) && amount > 0) {
            bool senderExcluded = isExcludedFromTax[from];
            bool recipientExcluded = isExcludedFromTax[to];

            if (!senderExcluded && presaleBuyersExcluded && isPresaleBuyer[from]) {
                senderExcluded = true;
            }
            if (!recipientExcluded && presaleBuyersExcluded && isPresaleBuyer[to]) {
                recipientExcluded = true;
            }

            if (!senderExcluded && !recipientExcluded) {
                uint16 applicableTax = 0;

                if (isDexPair[from] && taxOnBuy) {
                    applicableTax = buyTax;
                } else if (isDexPair[to] && taxOnSell) {
                    applicableTax = sellTax;
                } else if (!isDexPair[from] && !isDexPair[to] && taxOnTransfer) {
                    applicableTax = transferTax;
                }

                if (applicableTax > 0 && presaleBuyersReducedTax > 0) {
                    if (isPresaleBuyer[from] || isPresaleBuyer[to]) {
                        applicableTax = presaleBuyersReducedTax < applicableTax
                            ? presaleBuyersReducedTax
                            : applicableTax;
                    }
                }

                if (applicableTax > 0) {
                    taxAmount = (amount * applicableTax) / 10000;
                }
            }
        }

        if (taxAmount > 0) {
            super._update(from, taxReceiver, taxAmount);
            super._update(from, to, amount - taxAmount);
        } else {
            super._update(from, to, amount);
        }
    }

    // ======================== PRESALE ========================

    function openPresale(uint256 rate_, uint256 tokensForPresale_, uint256 maxPerWallet_) external onlyOwner {
        require(!presaleActive, "GembaERC20Advanced: presale already active");
        require(!presaleFinalized, "GembaERC20Advanced: presale already finalized");
        require(rate_ > 0, "GembaERC20Advanced: zero rate");
        require(tokensForPresale_ > 0, "GembaERC20Advanced: zero tokens");
        require(maxPerWallet_ > 0, "GembaERC20Advanced: zero max per wallet");
        require(balanceOf(address(this)) >= tokensForPresale_, "GembaERC20Advanced: insufficient contract balance");

        presaleRate = rate_;
        presaleTokensLeft = tokensForPresale_;
        presaleMaxPerWallet = maxPerWallet_;
        presaleActive = true;

        emit PresaleOpened(rate_, tokensForPresale_, maxPerWallet_);
    }

    function buyPresale() external payable nonReentrant {
        require(presaleActive, "GembaERC20Advanced: presale not active");
        require(msg.value > 0, "GembaERC20Advanced: zero ETH");

        uint256 tokenAmount = (msg.value * presaleRate) / 1 ether;
        require(tokenAmount > 0, "GembaERC20Advanced: token amount zero");
        require(tokenAmount <= presaleTokensLeft, "GembaERC20Advanced: exceeds available");
        require(
            presalePurchased[msg.sender] + tokenAmount <= presaleMaxPerWallet,
            "GembaERC20Advanced: exceeds wallet limit"
        );

        presalePurchased[msg.sender] += tokenAmount;
        presaleTokensLeft -= tokenAmount;
        presaleEthCollected += msg.value;

        if (!isPresaleBuyer[msg.sender]) {
            isPresaleBuyer[msg.sender] = true;
        }

        super._update(address(this), msg.sender, tokenAmount);

        emit TokensPurchased(msg.sender, msg.value, tokenAmount);
    }

    function closePresale() external onlyOwner {
        require(presaleActive, "GembaERC20Advanced: presale not active");
        presaleActive = false;
        emit PresaleClosed();
    }

    function finalizePresale() external onlyOwner nonReentrant {
        require(!presaleActive, "GembaERC20Advanced: close presale first");
        require(!presaleFinalized, "GembaERC20Advanced: already finalized");

        presaleFinalized = true;

        uint256 unsold = presaleTokensLeft;
        if (unsold > 0) {
            presaleTokensLeft = 0;
            super._update(address(this), owner(), unsold);
        }

        uint256 ethBalance = address(this).balance;
        if (ethBalance > 0) {
            (bool sent, ) = owner().call{value: ethBalance}("");
            require(sent, "GembaERC20Advanced: ETH transfer failed");
        }

        emit PresaleFinalized(ethBalance, unsold);
    }

    // ======================== ANTI-BOT ========================

    function configureAntiBot(uint256 duration_, uint256 maxPerWallet_) external onlyOwner {
        require(antiBotStartTime == 0, "GembaERC20Advanced: anti-bot already started");
        antiBotDuration = duration_;
        antiBotMaxPerWallet = maxPerWallet_;
        antiBotEnabled = true;
        emit AntiBotConfigured(duration_, maxPerWallet_);
    }

    function startAntiBot() external onlyOwner {
        require(antiBotEnabled, "GembaERC20Advanced: configure anti-bot first");
        require(antiBotStartTime == 0, "GembaERC20Advanced: already started");
        antiBotStartTime = block.timestamp;
        emit AntiBotStarted(block.timestamp, block.timestamp + antiBotDuration);
    }

    function isAntiBotActive() external view returns (bool) {
        if (!antiBotEnabled || antiBotStartTime == 0) return false;
        return block.timestamp <= antiBotStartTime + antiBotDuration;
    }

    // ======================== TAX MANAGEMENT ========================

    function setTaxRates(uint16 buyTax_, uint16 sellTax_, uint16 transferTax_) external onlyOwner {
        require(buyTax_ <= MAX_TAX, "GembaERC20Advanced: buy tax exceeds 5%");
        require(sellTax_ <= MAX_TAX, "GembaERC20Advanced: sell tax exceeds 5%");
        require(transferTax_ <= MAX_TAX, "GembaERC20Advanced: transfer tax exceeds 5%");
        buyTax = buyTax_;
        sellTax = sellTax_;
        transferTax = transferTax_;
        emit TaxUpdated(buyTax_, sellTax_, transferTax_);
    }

    function setTaxConfig(bool onBuy_, bool onSell_, bool onTransfer_) external onlyOwner {
        taxOnBuy = onBuy_;
        taxOnSell = onSell_;
        taxOnTransfer = onTransfer_;
        emit TaxConfigUpdated(onBuy_, onSell_, onTransfer_);
    }

    function setTaxReceiver(address newReceiver) external onlyOwner {
        require(newReceiver != address(0), "GembaERC20Advanced: zero address");
        emit TaxReceiverUpdated(taxReceiver, newReceiver);
        taxReceiver = newReceiver;
    }

    function setPresaleBuyerTaxConfig(bool excluded_, uint16 reducedRate_) external onlyOwner {
        require(reducedRate_ <= MAX_TAX, "GembaERC20Advanced: reduced rate exceeds 5%");
        presaleBuyersExcluded = excluded_;
        presaleBuyersReducedTax = reducedRate_;
        emit PresaleBuyerTaxConfig(excluded_, reducedRate_);
    }

    // ======================== ADDRESS MANAGEMENT ========================

    function setExcludedFromTax(address account, bool excluded) external onlyOwner {
        isExcludedFromTax[account] = excluded;
        emit AddressExcluded(account, excluded);
    }

    function setBanned(address account, bool banned) external onlyOwner {
        require(account != owner(), "GembaERC20Advanced: cannot ban owner");
        isBanned[account] = banned;
        emit AddressBanned(account, banned);
    }

    function setDexPair(address pair, bool isPair) external onlyOwner {
        require(pair != address(0), "GembaERC20Advanced: zero address");
        isDexPair[pair] = isPair;
        emit DexPairUpdated(pair, isPair);
    }

    // ======================== VIEW ========================

    function presaleInfo() external view returns (
        bool active, bool finalized, uint256 rate,
        uint256 tokensLeft, uint256 maxPerWallet, uint256 ethCollected
    ) {
        return (presaleActive, presaleFinalized, presaleRate, presaleTokensLeft, presaleMaxPerWallet, presaleEthCollected);
    }
}
