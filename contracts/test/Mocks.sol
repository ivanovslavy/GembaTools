// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// TEST-ONLY helpers for the GembaTools audit suite. Never deployed by the factories.
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockERC20 is ERC20 {
    constructor() ERC20("Mock", "MOCK") {}
    function mint(address to, uint256 a) external { _mint(to, a); }
}

contract MockERC721 is ERC721 {
    uint256 public nextId;
    constructor() ERC721("MockNFT", "MNFT") {}
    function mint(address to) external returns (uint256 id) { id = nextId++; _mint(to, id); }
}

/// @notice Minimal, ETH-backed WETH9 for router tests (deposit/withdraw/transfer).
contract MockWETH9 {
    string public name = "Wrapped Ether";
    string public symbol = "WETH";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function deposit() public payable { balanceOf[msg.sender] += msg.value; }
    function withdraw(uint256 wad) public {
        require(balanceOf[msg.sender] >= wad, "WETH: balance");
        balanceOf[msg.sender] -= wad;
        (bool ok, ) = msg.sender.call{value: wad}("");
        require(ok, "WETH: ETH send");
    }
    function approve(address g, uint256 w) public returns (bool) { allowance[msg.sender][g] = w; return true; }
    function transfer(address dst, uint256 w) public returns (bool) { return transferFrom(msg.sender, dst, w); }
    function transferFrom(address src, address dst, uint256 w) public returns (bool) {
        require(balanceOf[src] >= w, "WETH: balance");
        if (src != msg.sender && allowance[src][msg.sender] != type(uint256).max) {
            require(allowance[src][msg.sender] >= w, "WETH: allowance");
            allowance[src][msg.sender] -= w;
        }
        balanceOf[src] -= w; balanceOf[dst] += w;
        return true;
    }
    receive() external payable { deposit(); }
}

/// @notice USDT-style token whose approve() returns NO boolean (non-standard ERC20).
///         A raw IERC20(x).approve(...) call reverts on the empty return; SafeERC20's
///         forceApprove tolerates it. Used to prove the A4 fix.
contract NoReturnApproveToken {
    string public name = "NoRet";
    string public symbol = "NRT";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    function mint(address to, uint256 a) external { balanceOf[to] += a; }
    function approve(address s, uint256 v) external { allowance[msg.sender][s] = v; } // NO return value
    function transfer(address d, uint256 v) external returns (bool) {
        balanceOf[msg.sender] -= v; balanceOf[d] += v; return true;
    }
    function transferFrom(address f, address t, uint256 v) external returns (bool) {
        if (allowance[f][msg.sender] != type(uint256).max) allowance[f][msg.sender] -= v;
        balanceOf[f] -= v; balanceOf[t] += v; return true;
    }
}

/// @notice WETH9 whose transfer() always returns false — proves wrapETH now checks
///         the return value (A6). deposit/withdraw behave normally.
contract FalseReturnWETH9 {
    mapping(address => uint256) public balanceOf;
    function deposit() external payable { balanceOf[msg.sender] += msg.value; }
    function withdraw(uint256 wad) external { balanceOf[msg.sender] -= wad; (bool ok,) = msg.sender.call{value: wad}(""); require(ok); }
    function approve(address, uint256) external pure returns (bool) { return true; }
    function transfer(address, uint256) external pure returns (bool) { return false; } // always false
}

/// @notice Mock Uniswap V3 SwapRouter. Pays `amountIn * rateNum / rateDen` of tokenOut
///         from its own inventory; enforces amountOutMinimum like the real router.
contract MockSwapRouter {
    struct ExactInputSingleParams {
        address tokenIn; address tokenOut; uint24 fee; address recipient;
        uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96;
    }
    uint256 public rateNum = 1;
    uint256 public rateDen = 1;
    bool public reenterOnPay; // for the reentrancy test
    function setRate(uint256 n, uint256 d) external { rateNum = n; rateDen = d; }

    function exactInputSingle(ExactInputSingleParams calldata p) external payable returns (uint256 amountOut) {
        if (msg.value == 0) {
            // token input: pull it from the caller (the GembaSwapRouter)
            IERC20(p.tokenIn).transferFrom(msg.sender, address(this), p.amountIn);
        }
        amountOut = (p.amountIn * rateNum) / rateDen;
        require(amountOut >= p.amountOutMinimum, "Too little received"); // mimic V3 slippage
        require(IERC20(p.tokenOut).transfer(p.recipient, amountOut), "payout");
    }
    receive() external payable {}
}
