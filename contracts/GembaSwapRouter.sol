// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        returns (uint256 amountOut);
}

interface IWETH9 {
    function deposit() external payable;
    function withdraw(uint256 wad) external;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 value) external returns (bool);
}

/**
 * @title GembaSwapRouter
 * @notice Wraps Uniswap V3 SwapRouter with a platform fee on every swap.
 *         Fee is taken from the input amount before forwarding to Uniswap.
 *         Works with ETH and ERC20 tokens.
 *
 * @dev Fee is in basis points (100 = 1%). Max 1% (100bp).
 *      Fee recipient and fee amount are configurable by owner.
 *      Owner can never set fee above 1% — hardcoded cap.
 */
contract GembaSwapRouter is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    ISwapRouter public immutable uniswapRouter;
    IWETH9 public immutable WETH9;

    address public feeRecipient;
    uint256 public platformFee; // basis points, e.g. 15 = 0.15%
    uint256 public constant MAX_FEE = 100; // 1% hard cap

    event SwapExecuted(
        address indexed user,
        address indexed tokenIn,
        address indexed tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeTaken
    );

    event FeeUpdated(uint256 oldFee, uint256 newFee);
    event FeeRecipientUpdated(address oldRecipient, address newRecipient);

    constructor(
        address router_,
        address weth9_,
        address feeRecipient_,
        uint256 platformFee_
    ) Ownable(msg.sender) {
        require(router_ != address(0), "zero router");
        require(weth9_ != address(0), "zero weth");
        require(feeRecipient_ != address(0), "zero recipient");
        require(platformFee_ <= MAX_FEE, "fee too high");

        uniswapRouter = ISwapRouter(router_);
        WETH9 = IWETH9(weth9_);
        feeRecipient = feeRecipient_;
        platformFee = platformFee_;
    }

    modifier checkDeadline(uint256 deadline) {
        require(block.timestamp <= deadline, "transaction expired");
        _;
    }

    // ===================== ETH → Token =====================

    /// @notice Swap ETH for tokens. Platform fee deducted from ETH input.
    function swapETHForTokens(
        address tokenOut,
        uint24 poolFee,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96,
        uint256 deadline
    ) external payable nonReentrant checkDeadline(deadline) returns (uint256 amountOut) {
        require(msg.value > 0, "zero value");

        // Take platform fee
        uint256 fee = (msg.value * platformFee) / 10000;
        uint256 swapAmount = msg.value - fee;

        // Send fee to recipient
        if (fee > 0) {
            (bool sent, ) = feeRecipient.call{value: fee}("");
            require(sent, "fee transfer failed");
        }

        // Swap via Uniswap
        amountOut = uniswapRouter.exactInputSingle{value: swapAmount}(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(WETH9),
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: msg.sender,
                amountIn: swapAmount,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: sqrtPriceLimitX96
            })
        );

        emit SwapExecuted(msg.sender, address(0), tokenOut, msg.value, amountOut, fee);
    }

    // ===================== Token → ETH =====================

    /// @notice Swap tokens for ETH. Platform fee deducted from ETH output.
    function swapTokensForETH(
        address tokenIn,
        uint24 poolFee,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountOut) {
        require(amountIn > 0, "zero amount");

        // Pull tokens from user
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(address(uniswapRouter), amountIn);

        // Swap to WETH (receive here, not to user)
        uint256 wethReceived = uniswapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: address(WETH9),
                fee: poolFee,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: sqrtPriceLimitX96
            })
        );

        // Unwrap WETH to ETH
        WETH9.withdraw(wethReceived);

        // Take fee from ETH output
        uint256 fee = (wethReceived * platformFee) / 10000;
        amountOut = wethReceived - fee;

        // Send fee
        if (fee > 0) {
            (bool fSent, ) = feeRecipient.call{value: fee}("");
            require(fSent, "fee transfer failed");
        }

        // Send remaining ETH to user
        (bool uSent, ) = msg.sender.call{value: amountOut}("");
        require(uSent, "eth transfer failed");

        emit SwapExecuted(msg.sender, tokenIn, address(0), amountIn, amountOut, fee);
    }

    // ===================== Token → Token (via WETH, fee in ETH) =====================

    /// @notice Swap token for token via WETH. Fee taken as ETH from the WETH hop.
    /// @dev Intermediate hop (tokenIn→WETH) has no slippage protection because
    ///      the overall output is protected by amountOutMinimum on the final hop.
    ///      If intermediate price moves unfavorably, final output check will revert.
    /// @param poolFeeIn Fee tier for tokenIn → WETH pool
    /// @param poolFeeOut Fee tier for WETH → tokenOut pool
    function swapTokensForTokens(
        address tokenIn,
        address tokenOut,
        uint24 poolFeeIn,
        uint24 poolFeeOut,
        uint256 amountIn,
        uint256 amountOutMinimum,
        uint160 sqrtPriceLimitX96,
        uint256 deadline
    ) external nonReentrant checkDeadline(deadline) returns (uint256 amountOut) {
        require(amountIn > 0, "zero amount");

        // Pull tokens from user
        IERC20(tokenIn).safeTransferFrom(msg.sender, address(this), amountIn);

        // Hop 1: tokenIn → WETH (receive here)
        IERC20(tokenIn).approve(address(uniswapRouter), amountIn);
        uint256 wethReceived = uniswapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: address(WETH9),
                fee: poolFeeIn,
                recipient: address(this),
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        // Take fee as ETH
        WETH9.withdraw(wethReceived);
        uint256 fee = (wethReceived * platformFee) / 10000;
        uint256 remainingETH = wethReceived - fee;

        if (fee > 0) {
            (bool fSent, ) = feeRecipient.call{value: fee}("");
            require(fSent, "fee transfer failed");
        }

        // Re-wrap remaining ETH to WETH for hop 2
        WETH9.deposit{value: remainingETH}();

        // Hop 2: WETH → tokenOut (send to user)
        IWETH9(address(WETH9)).approve(address(uniswapRouter), remainingETH);
        amountOut = uniswapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: address(WETH9),
                tokenOut: tokenOut,
                fee: poolFeeOut,
                recipient: msg.sender,
                amountIn: remainingETH,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: sqrtPriceLimitX96
            })
        );

        emit SwapExecuted(msg.sender, tokenIn, tokenOut, amountIn, amountOut, fee);
    }

    // ===================== ETH ↔ WETH Wrap/Unwrap =====================

    /// @notice Wrap ETH to WETH. Platform fee deducted from ETH input.
    function wrapETH() external payable nonReentrant returns (uint256 wethAmount) {
        require(msg.value > 0, "zero value");

        uint256 fee = (msg.value * platformFee) / 10000;
        wethAmount = msg.value - fee;

        // Send fee
        if (fee > 0) {
            (bool sent, ) = feeRecipient.call{value: fee}("");
            require(sent, "fee transfer failed");
        }

        // Wrap remaining ETH
        WETH9.deposit{value: wethAmount}();
        WETH9.transfer(msg.sender, wethAmount);

        emit SwapExecuted(msg.sender, address(0), address(WETH9), msg.value, wethAmount, fee);
    }

    /// @notice Unwrap WETH to ETH. Platform fee deducted from ETH output.
    function unwrapWETH(uint256 amount) external nonReentrant returns (uint256 ethAmount) {
        require(amount > 0, "zero amount");

        // Pull WETH from user
        IERC20(address(WETH9)).safeTransferFrom(msg.sender, address(this), amount);

        // Unwrap
        WETH9.withdraw(amount);

        // Take fee
        uint256 fee = (amount * platformFee) / 10000;
        ethAmount = amount - fee;

        if (fee > 0) {
            (bool fSent, ) = feeRecipient.call{value: fee}("");
            require(fSent, "fee transfer failed");
        }

        (bool uSent, ) = msg.sender.call{value: ethAmount}("");
        require(uSent, "eth transfer failed");

        emit SwapExecuted(msg.sender, address(WETH9), address(0), amount, ethAmount, fee);
    }

    // ===================== Owner functions =====================

    function setFee(uint256 newFee) external onlyOwner {
        require(newFee <= MAX_FEE, "fee too high");
        emit FeeUpdated(platformFee, newFee);
        platformFee = newFee;
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "zero address");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    // Accept ETH from WETH unwrap
    receive() external payable {}
}
