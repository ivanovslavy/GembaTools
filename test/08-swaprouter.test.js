const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll } = require("./helpers/fixtures");

const DL = () => Math.floor(Date.now() / 1000) + 3600;

// Fund the mock Uniswap router with tokenOut + WETH inventory so swaps can settle.
async function withDex() {
  const f = await loadFixture(deployAll);
  const Mock20 = await ethers.getContractFactory("MockERC20");
  const tokenOut = await Mock20.deploy();
  await tokenOut.mint(await f.mockRouter.getAddress(), ethers.parseEther("1000000"));
  // WETH inventory for token→ETH paths (owner deposits ETH → WETH → mock)
  await f.weth.connect(f.owner).deposit({ value: ethers.parseEther("50") });
  await f.weth.connect(f.owner).transfer(await f.mockRouter.getAddress(), ethers.parseEther("50"));
  return { ...f, tokenOut };
}

describe("GembaSwapRouter", () => {
  it("wrapETH: 0.3% fee to recipient, rest wrapped to user", async () => {
    const { swapRouter, weth, feeRecipient, alice } = await loadFixture(deployAll);
    const recvBefore = await ethers.provider.getBalance(feeRecipient.address);
    await swapRouter.connect(alice).wrapETH({ value: ethers.parseEther("1") });
    const fee = ethers.parseEther("1") * 30n / 10000n;
    expect(await weth.balanceOf(alice.address)).to.equal(ethers.parseEther("1") - fee);
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(recvBefore + fee);
  });

  it("unwrapWETH: fee from ETH output", async () => {
    const { swapRouter, weth, alice } = await loadFixture(deployAll);
    await weth.connect(alice).deposit({ value: ethers.parseEther("2") });
    await weth.connect(alice).approve(await swapRouter.getAddress(), ethers.parseEther("2"));
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await swapRouter.connect(alice).unwrapWETH(ethers.parseEther("2"));
    const rc = await tx.wait();
    const fee = ethers.parseEther("2") * 30n / 10000n;
    const after = await ethers.provider.getBalance(alice.address);
    // received ≈ 2 - fee - gas
    expect(after).to.be.closeTo(before + ethers.parseEther("2") - fee - rc.gasUsed * rc.gasPrice, ethers.parseEther("0.001"));
  });

  it("swapETHForTokens: fee on ETH input, tokens to user at mock rate", async () => {
    const { swapRouter, tokenOut, feeRecipient, alice } = await withDex();
    const recvBefore = await ethers.provider.getBalance(feeRecipient.address);
    await swapRouter.connect(alice).swapETHForTokens(await tokenOut.getAddress(), 3000, 0, 0, DL(), { value: ethers.parseEther("1") });
    const fee = ethers.parseEther("1") * 30n / 10000n;
    const swapAmount = ethers.parseEther("1") - fee;
    expect(await tokenOut.balanceOf(alice.address)).to.equal(swapAmount); // 1:1 mock rate
    expect(await ethers.provider.getBalance(feeRecipient.address)).to.equal(recvBefore + fee);
  });

  it("slippage: reverts when mock returns below amountOutMinimum", async () => {
    const { swapRouter, tokenOut, mockRouter, alice } = await withDex();
    await mockRouter.setRate(1, 2); // pays half
    await expect(
      swapRouter.connect(alice).swapETHForTokens(await tokenOut.getAddress(), 3000, ethers.parseEther("1"), 0, DL(), { value: ethers.parseEther("1") })
    ).to.be.reverted;
  });

  it("expired deadline reverts", async () => {
    const { swapRouter, tokenOut, alice } = await withDex();
    await expect(
      swapRouter.connect(alice).swapETHForTokens(await tokenOut.getAddress(), 3000, 0, 0, 1, { value: ethers.parseEther("1") })
    ).to.be.revertedWith("transaction expired");
  });

  it("swapTokensForETH: pulls token, unwraps, fee from ETH output", async () => {
    const { swapRouter, tokenOut, weth, alice } = await withDex();
    // use tokenOut as the input token; give alice some + approve
    await tokenOut.mint(alice.address, ethers.parseEther("10"));
    await tokenOut.connect(alice).approve(await swapRouter.getAddress(), ethers.parseEther("10"));
    const before = await ethers.provider.getBalance(alice.address);
    const tx = await swapRouter.connect(alice).swapTokensForETH(await tokenOut.getAddress(), 3000, ethers.parseEther("10"), 0, 0, DL());
    const rc = await tx.wait();
    // mock 1:1 → 10 WETH → withdraw → fee 0.3% → ~9.97 ETH to alice
    const after = await ethers.provider.getBalance(alice.address);
    expect(after).to.be.gt(before - rc.gasUsed * rc.gasPrice); // net positive ETH minus gas
  });

  it("setFee owner-only + MAX_FEE 1% cap", async () => {
    const { swapRouter, owner, alice } = await loadFixture(deployAll);
    await expect(swapRouter.connect(alice).setFee(50)).to.be.reverted;
    await expect(swapRouter.connect(owner).setFee(101)).to.be.revertedWith("fee too high");
    await swapRouter.connect(owner).setFee(100);
    expect(await swapRouter.platformFee()).to.equal(100n);
  });
});
