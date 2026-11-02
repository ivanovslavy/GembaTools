const { expect } = require("chai");
const { loadFixture } = require("@nomicfoundation/hardhat-network-helpers");
const { ethers } = require("hardhat");
const { deployAll, FEE, vx } = require("./helpers/fixtures");

describe("ATTACKS", () => {
  it("reentrant factory caller cannot re-enter createToken via the refund (DEFEATED)", async () => {
    const { erc20Factory, alice } = await loadFixture(deployAll);
    const A = await ethers.getContractFactory("ReentrantFactoryCaller");
    const atk = await A.deploy(await erc20Factory.getAddress());
    // two VALID vouchers for the attacker contract + 3×FEE so the refund (2×FEE) also covers the fee on
    // re-entry — leaving nonReentrant as the only thing that can stop it.
    const a1 = await vx(erc20Factory, await atk.getAddress());
    const a2 = await vx(erc20Factory, await atk.getAddress());
    await atk.connect(alice).attack(...a1, ...a2, { value: FEE * 3n });
    expect(await atk.reenterAttempts()).to.equal(1n);
    expect(await atk.reenterReverted()).to.equal(true);
  });

  it("factory with a rejecting fee recipient fails CLOSED (deploy reverts, no silent loss)", async () => {
    const { owner, alice, voucherSigner } = await loadFixture(deployAll);
    const Rej = await ethers.getContractFactory("RejectingReceiver");
    const rej = await Rej.deploy();
    const F = await ethers.getContractFactory("GembaERC20Factory");
    const badFactory = await F.deploy(owner.address, await rej.getAddress(), voucherSigner.address);
    // fee .call to the rejecting recipient reverts → whole createToken reverts
    await expect(badFactory.connect(alice).createToken("N", "S", 18, 1n, ...(await vx(badFactory, alice)), { value: FEE })).to.be.reverted;
  });

  it("reentrant swap fee-recipient cannot re-enter the router (DEFEATED)", async () => {
    const { owner, alice, mockRouter, weth } = await loadFixture(deployAll);
    const R = await ethers.getContractFactory("ReentrantSwapReceiver");
    const recv = await R.deploy();
    const SR = await ethers.getContractFactory("GembaSwapRouter");
    const router = await SR.deploy(await mockRouter.getAddress(), await weth.getAddress(), await recv.getAddress(), 100n);
    await recv.setRouter(await router.getAddress());
    await recv.arm();
    await router.connect(alice).wrapETH({ value: ethers.parseEther("1") });
    expect(await recv.reenterAttempts()).to.equal(1n);
    expect(await recv.reenterReverted()).to.equal(true);
  });

  it("A3 FIXED: fee-on-transfer token swaps successfully (router uses the amount actually received)", async () => {
    const { swapRouter, mockRouter, weth, owner, alice } = await loadFixture(deployAll);
    // fund the mock DEX with WETH inventory so the token→ETH path can settle
    await weth.connect(owner).deposit({ value: ethers.parseEther("50") });
    await weth.connect(owner).transfer(await mockRouter.getAddress(), ethers.parseEther("50"));

    const Fee = await ethers.getContractFactory("FeeOnTransferERC20");
    const fee = await Fee.deploy(1000); // 10% fee-on-transfer
    await fee.mint(alice.address, ethers.parseEther("10"));
    await fee.connect(alice).approve(await swapRouter.getAddress(), ethers.parseEther("10"));

    const before = await ethers.provider.getBalance(alice.address);
    // previously reverted (router approved amountIn=10 but only held the 9 it
    // received). Now it measures the 9 actually received and swaps that.
    const tx = await swapRouter.connect(alice).swapTokensForETH(await fee.getAddress(), 3000, ethers.parseEther("10"), 0, 0, Math.floor(Date.now()/1000)+3600);
    const rc = await tx.wait();
    const after = await ethers.provider.getBalance(alice.address);
    expect(after).to.be.gt(before - rc.gasUsed * rc.gasPrice); // alice received ETH — swap settled
    console.log("      A3 FIXED: fee-on-transfer swap settles using the actual received amount");
  });

  it("A4 FIXED: token with a no-return approve() (USDT-style) swaps via forceApprove", async () => {
    const { swapRouter, mockRouter, weth, owner, alice } = await loadFixture(deployAll);
    await weth.connect(owner).deposit({ value: ethers.parseEther("50") });
    await weth.connect(owner).transfer(await mockRouter.getAddress(), ethers.parseEther("50"));

    const T = await ethers.getContractFactory("NoReturnApproveToken");
    const usdt = await T.deploy();
    await usdt.mint(alice.address, ethers.parseEther("10"));
    await usdt.connect(alice).approve(await swapRouter.getAddress(), ethers.parseEther("10"));

    // a raw approve() would revert on the empty return; forceApprove tolerates it
    await expect(
      swapRouter.connect(alice).swapTokensForETH(await usdt.getAddress(), 3000, ethers.parseEther("10"), 0, 0, Math.floor(Date.now()/1000)+3600)
    ).to.not.be.reverted;
    console.log("      A4 FIXED: non-standard (no-bool) approve handled by SafeERC20.forceApprove");
  });

  it("A6 FIXED: wrapETH reverts when WETH transfer returns false (return value checked)", async () => {
    const { mockRouter, feeRecipient, alice } = await loadFixture(deployAll);
    const FW = await ethers.getContractFactory("FalseReturnWETH9");
    const fw = await FW.deploy();
    const SR = await ethers.getContractFactory("GembaSwapRouter");
    const router = await SR.deploy(await mockRouter.getAddress(), await fw.getAddress(), feeRecipient.address, 30n);
    await expect(router.connect(alice).wrapETH({ value: ethers.parseEther("1") })).to.be.revertedWith("weth transfer failed");
    console.log("      A6 FIXED: wrapETH checks WETH9.transfer return value");
  });
});
