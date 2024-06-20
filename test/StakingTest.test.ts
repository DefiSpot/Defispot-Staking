import { expect } from 'chai';
import { ethers, network, upgrades } from 'hardhat';
import { getStorageAt } from "@nomicfoundation/hardhat-network-helpers";
import { DefiSpotToken, IERC20, StakingRewards, StakingRewards__factory } from '../typechain-types';
import { Signer } from 'ethers';


interface SetUpType {
    proxy: StakingRewards;
    spotContanct: DefiSpotToken;
    owner: Signer;
    rewardDistributor: Signer;
    paramsSetter: Signer;
    penaltyFeesCollector: Signer;
    bob: Signer;
    alice: Signer;
    USDT: IERC20;
}

const ONEWEEK = BigInt(7);
const MAXPENALTYDAYS = BigInt(90);
const ONE_DAY = BigInt(60 * 60 * 24);
const MIN_WITHDRAWAL_TIME = ONE_DAY;
const MAX_WITHDRAWAL_TIME = ONE_DAY * 10n;
const MAX_TOKEN_REWARD_RATE = ethers.parseUnits("1", 6);
const USDT_TO_OWNER = ethers.parseUnits("1000000", 6);

let owner: Signer;
let paramsSetter: Signer;
let rewardDistributor: Signer;
let bob: Signer;
let alice: Signer;
let penaltyFeesCollector: Signer;

async function getBlockProductionTime() {
    const provider = ethers.provider;

    const currentBlockNumber = await provider.getBlockNumber();
    const currentBlock = await provider.getBlock(currentBlockNumber);
    const previousBlock = await provider.getBlock(currentBlockNumber - 1);
    if(!currentBlock || !previousBlock) {
        throw new Error("Could not get current or previous block");
    }

    return currentBlock.timestamp - previousBlock.timestamp;
}

const setUpContracts = async (): Promise<SetUpType> => {

    [owner, paramsSetter, rewardDistributor, penaltyFeesCollector, bob, alice] = await ethers.getSigners();

    const SpotToken = await ethers.getContractFactory('DefiSpotToken');
    const initialSupply = ethers.parseEther('1000');

    const spotContanct = await SpotToken.deploy("SPOT", "SPT", initialSupply) as DefiSpotToken;
    await spotContanct.waitForDeployment();

    const usdtContract = await ethers.getContractFactory("MockUSDT", rewardDistributor);
    const USDT = await usdtContract.deploy() as IERC20;
    await USDT.waitForDeployment();

    const spotContanctAddress = await spotContanct.getAddress();
    const Staking: StakingRewards__factory = await ethers.getContractFactory('StakingRewards');
    const stakingRewards = await Staking.deploy() as StakingRewards;
    await stakingRewards.waitForDeployment();
    const blockProductionTime = await getBlockProductionTime();

    const proxy = await upgrades.deployProxy(Staking, [await penaltyFeesCollector.getAddress(), spotContanctAddress, await USDT.getAddress(), await paramsSetter.getAddress(), await rewardDistributor.getAddress(), blockProductionTime], { initializer: "initialize" }) as unknown as StakingRewards;
    await proxy.waitForDeployment();

    await spotContanct.connect(owner).transfer(await bob.getAddress(), ethers.parseEther('100'));
    await spotContanct.connect(owner).transfer(await alice.getAddress(), ethers.parseEther('100'));


    return { proxy, spotContanct, owner, paramsSetter, penaltyFeesCollector, rewardDistributor,bob, alice, USDT };
};


describe('Staking contract', async () => {

    let setUpConfig: SetUpType;

    beforeEach(async () => {
        setUpConfig = await setUpContracts();
    });

    describe("Resctricted functions", async () => {

        // ==================== PENALTY DAYS ============================= 

        describe("Penalty Days Testing", async () => {

            it("Should accept the request from paramsSetter role", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                const penaltyDaysRequest = await proxy.penaltyDaysRequest();
                const block = await ethers.provider.getBlock('latest');
                const blockTimestamp = BigInt(block!.timestamp);
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                expect(penaltyDaysRequest[1]).to.be.equal(ONEWEEK);
                expect(penaltyDaysRequest[0]).to.be.equal(blockTimestamp + penaltyDaysTimelock);
            })

            it("Should not accept the request from not paramsSetter role", async () => {
                const { proxy, bob } = setUpConfig;
                await expect(proxy.connect(bob).requestToSetPenaltyDays(ONEWEEK)).to.be.reverted;
            })

            it("Should allow to change request if value is different updating time", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                const penaltyDaysRequest = await proxy.penaltyDaysRequest();
                const block = await ethers.provider.getBlock('latest');
                const blockTimestampPrev = BigInt(block!.timestamp);
                expect(penaltyDaysRequest[1]).to.be.equal(ONEWEEK);
                expect(penaltyDaysRequest[0]).to.be.equal(blockTimestampPrev + penaltyDaysTimelock);
                const newTimePassed = 10000n
                await network.provider.send("evm_increaseTime", [newTimePassed.toString()]);
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK + 2n);
                const block2 = await ethers.provider.getBlock('latest');
                const blockTimestampNew = BigInt(block2!.timestamp);
                const penaltyDaysRequest2 = await proxy.penaltyDaysRequest();
                expect(penaltyDaysRequest2[1]).to.be.equal(ONEWEEK + 2n);
                expect(penaltyDaysRequest2[0]).to.be.equal(blockTimestampNew + penaltyDaysTimelock);
            });

            it("Should not allow to change request if value is the same but different from 0", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                const penaltyDaysRequest = await proxy.penaltyDaysRequest();
                const block = await ethers.provider.getBlock('latest');
                const blockTimestampPrev = BigInt(block!.timestamp);
                expect(penaltyDaysRequest[1]).to.be.equal(ONEWEEK);
                expect(penaltyDaysRequest[0]).to.be.equal(blockTimestampPrev + penaltyDaysTimelock);
                await network.provider.send("evm_increaseTime", [10000]);
                await expect(proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK)).to.be.revertedWithCustomError(proxy, "StakingRewards__SameAmountOfDays");
            });

            it("Should allow to set request to 0 if previous value is bigger directly", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(3n);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                expect(await proxy.penaltyDays()).to.be.equal(3n);
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(0n);
                expect(await proxy.penaltyDaysRequest()).to.be.deep.equal([0n, 0n]);
                expect(await proxy.penaltyDays()).to.be.equal(0n);
            })

            it("Should not allow to set 0 if value is 0", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await expect(proxy.connect(paramsSetter).requestToSetPenaltyDays(0n)).to.be.revertedWithCustomError(proxy, "StakingRewards__SameAmountOfDays");
            })

            it("Should emit an event when request is updated", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await expect(proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK)).to.emit(proxy, "LogPenaltyDaysRequested").withArgs(ONEWEEK);
            });

            it("Should allow to set penalty days after timelock", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                expect(await proxy.penaltyDays()).to.be.equal(ONEWEEK);
            })

            it("Should not allow unauthotized to apply panalty days request", async ()=> {
                const { proxy, bob, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await expect(proxy.connect(bob).applyPenaltyDaysRequest()).to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
            })

            it("Should revert if no active requests are present", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await expect(proxy.connect(paramsSetter).applyPenaltyDaysRequest()).to.be.revertedWithCustomError(proxy, "StakingRewards__NoActiveRequest");
            })

            it("Should revert if timelock has not passed", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await expect(proxy.connect(paramsSetter).applyPenaltyDaysRequest()).to.be.revertedWithCustomError(proxy, "StakingRewars__PenaltyDaysTimelock");
            })

            it("Should not allow to apply request if buffer time has passed", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                const bufferTime = await proxy.PENALTY_DAYS_TIMELOCK_BUFFER();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [(penaltyDaysTimelock + bufferTime + 1n).toString()]);
                await expect(proxy.connect(paramsSetter).applyPenaltyDaysRequest()).to.be.revertedWithCustomError(proxy, "StakingRewards__TimelockBufferExceeded()");
            })

            it("Should not allow to set penalty days more than max", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await expect(proxy.connect(paramsSetter).requestToSetPenaltyDays(MAXPENALTYDAYS)).to.be.revertedWithCustomError(proxy, "StakingRewards__PenaltyDaysTooHigh");
            })

            it("Should set penalty request to 0 after applying", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                expect(await proxy.penaltyDaysRequest()).to.be.deep.equal([0n, 0n]);
            })

            it("Should allow to make a new request after applying", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK - 2n);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                const block = await ethers.provider.getBlock('latest');
                const blockTimestamp = BigInt(block!.timestamp);
                expect(await proxy.penaltyDaysRequest()).to.be.deep.equal([blockTimestamp + penaltyDaysTimelock, ONEWEEK]);
            })

            it("Should allow to make a new request and apply it if previous request expired", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                const timelockBuffer = await proxy.PENALTY_DAYS_TIMELOCK_BUFFER();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [(penaltyDaysTimelock + timelockBuffer + 2n).toString()]);
                await expect(proxy.connect(paramsSetter).applyPenaltyDaysRequest()).to.be.revertedWithCustomError(proxy, "StakingRewards__TimelockBufferExceeded()");
                expect(await proxy.penaltyDays()).to.be.equal(0n);
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK + 1n);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                expect(await proxy.penaltyDays()).to.be.equal(ONEWEEK + 1n);
            })

            it("Should emit an event when applying penalty days", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await expect(proxy.connect(paramsSetter).applyPenaltyDaysRequest()).to.emit(proxy, "LogPenaltyDaysUpdated").withArgs(ONEWEEK);
            })

            it("Should delete a pending request if a new one is made which is lower than active value", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK - 1n);
                expect(await proxy.penaltyDaysRequest()).to.be.deep.equal([0n, 0n]);
                expect(await proxy.penaltyDays()).to.be.equal(ONEWEEK - 1n);
            })

        })

        // ========================= WITHDRAWAL TIME =========================== 

        describe("Withdrawal Time Testing", async () => {

            it("Should allow to make request if user is authorized", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 2n);
                const withdrawWaitTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 4n);
                const block = await ethers.provider.getBlock("latest");
                const timestamp = BigInt(block!.timestamp);
                const waitTimeRequest = await proxy.withdrawalWaitTimeRequest();
                expect(waitTimeRequest).to.be.deep.equal([timestamp + withdrawWaitTimelock, ONE_DAY * 4n]);
            })

            it("Should revert request if user is not authorized", async ()=> {
                const {proxy, bob} = setUpConfig;
                await expect(proxy.connect(bob).requestToSetWithdrawWaitTime(ONE_DAY * 2n)).to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
            })

            it("Should revert if new time is below MIN_WITHDRAW_WAIT_TIME", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await expect(proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(MIN_WITHDRAWAL_TIME - 1n)).to.be.revertedWithCustomError(proxy, "StakingRewards__WaitTimeLessThanOneDay");
            })

            it("Should revert if request is above MAX_WITHDRAW_WAIT_TIME", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await expect(proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(MAX_WITHDRAWAL_TIME + 1n)).to.be.revertedWithCustomError(proxy, "StakingRewards__WaitTimeMoreThanTenDays");
            })

            it("Should revert if request is the same as the pending one", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 2n);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 4n);
                await expect(proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 4n)).to.revertedWithCustomError(proxy, "StakingRewards__SameAmountOfSeconds");
            })

            it("Should allow to modify request adding waiting time", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const withdrawalTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 2n);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 4n);
                const prevBlock = await ethers.provider.getBlock("latest");
                const prevTimestamp = BigInt(prevBlock!.timestamp);
                const prevRequest = await proxy.withdrawalWaitTimeRequest();
                expect(prevRequest).to.be.deep.equal([prevTimestamp + withdrawalTimelock, ONE_DAY * 4n]);
                await network.provider.send("evm_increaseTime", [10000]);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 5n);
                const currentBlock = await ethers.provider.getBlock("latest");
                const currentTimestamp = BigInt(currentBlock!.timestamp);
                const currentRequest = await proxy.withdrawalWaitTimeRequest();
                expect(currentRequest).to.be.deep.equal([currentTimestamp + withdrawalTimelock, ONE_DAY * 5n]);
                expect(currentRequest[0]).to.be.greaterThan(prevRequest[0]);
            })

            it("Should emit an event when request is updated", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await expect(proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 2n)).to.emit(proxy, "LogWithdrawWaitTimeRequested").withArgs(ONE_DAY * 2n);
            })

            it("Should apply withdrawal wait time if authorized", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const withdrawalTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 3n);
                await network.provider.send("evm_increaseTime", [withdrawalTimelock.toString()]);
                await proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest();
                expect(await proxy.withdrawWaitTime()).to.be.equal(ONE_DAY * 3n);
            })

            it("Should not be able to apply withdrawal wait time if not authorized", async ()=> {
                const { proxy, bob, paramsSetter } = setUpConfig;
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 3n);
                await expect(proxy.connect(bob).applyWithdrawWaitTimeRequest()).to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
            })

            it("Should revert if not request is pending", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                await expect(proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest()).to.be.revertedWithCustomError(proxy, "StakingRewards__NoActiveRequest");
            })

            it("Should revert if not enough time has passed", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const withdrawalTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 3n);
                network.provider.send("evm_increaseTime", [(withdrawalTimelock - 1n).toString()]);
                await expect(proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest()).to.be.revertedWithCustomError(proxy, "StakingRewards__WithdrawalWaitTimeTimelock");
            })

            it("Should revert if time has exceeded timelock buffer", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const withdrawalTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                const withdeawalTimelockBuffer = await proxy.WITHDRAWAL_WAIT_TIMELOCK_BUFFER();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 3n);
                await network.provider.send("evm_increaseTime", [(withdeawalTimelockBuffer + withdrawalTimelock + 1n).toString()]);
                await expect(proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest()).to.be.revertedWithCustomError(proxy, "StakingRewards__TimelockBufferExceeded")
            })

            it("Should set request to 0 after applying it", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const withdrawalTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 3n);
                await network.provider.send("evm_increaseTime", [(withdrawalTimelock).toString()]);
                await proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest();
                expect(await proxy.withdrawWaitTime()).to.be.equal(ONE_DAY * 3n);
                expect(await proxy.withdrawalWaitTimeRequest()).to.be.deep.equal([0n, 0n]);
            })

            it("Should be able to make and apply a new request if previous has exceeded timelock buffer", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const withdrawalTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                const withdeawalTimelockBuffer = await proxy.WITHDRAWAL_WAIT_TIMELOCK_BUFFER();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 3n);
                await network.provider.send("evm_increaseTime", [(withdeawalTimelockBuffer + withdrawalTimelock + 1n).toString()]);
                await expect(proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest()).to.be.revertedWithCustomError(proxy, "StakingRewards__TimelockBufferExceeded")
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 4n);
                await network.provider.send("evm_increaseTime", [(withdrawalTimelock).toString()]);
                await proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest();
                expect(await proxy.withdrawWaitTime()).to.be.equal(ONE_DAY * 4n);
            })

            it("Should emit an event when applying new withdrawal timelock", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const withdrawalTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 3n);
                await network.provider.send("evm_increaseTime", [(withdrawalTimelock).toString()]);
                await expect (proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest()).to.emit(proxy, "LogWithdrawWaitTimeUpdated").withArgs(ONE_DAY * 3n);
            })

            it("Should delete a pending request if a new one is made which is lower than active value", async ()=> {
                const { proxy, paramsSetter } = setUpConfig;
                const withdrawalTimelock = await proxy.WITHDRAWAL_WAIT_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 3n);
                await network.provider.send("evm_increaseTime", [(withdrawalTimelock).toString()]);
                await proxy.connect(paramsSetter).applyWithdrawWaitTimeRequest();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY * 2n);
                expect(await proxy.withdrawalWaitTimeRequest()).to.be.deep.equal([0n, 0n]);
                expect(await proxy.withdrawWaitTime()).to.be.equal(ONE_DAY * 2n);
            })

        })

        // ========================= TOKEN REWARD RATE ==========================

        describe("Token Reward Rate Testing", async () => {

            it("It should set token reward rate", async () => {
                const { rewardDistributor, proxy } = setUpConfig;
                await proxy.connect(rewardDistributor).setTokenRewardRate(MAX_TOKEN_REWARD_RATE);
                expect(await proxy.tokenRewardPerSecond()).to.be.equal(MAX_TOKEN_REWARD_RATE);
            });

            it("Should accept token reward rate to be 0", async () => { // check if this is the intended behavior
                const { rewardDistributor, proxy } = setUpConfig;
                await proxy.connect(rewardDistributor).setTokenRewardRate(0n);
                expect(await proxy.tokenRewardPerSecond()).to.be.equal(0n);
            });

            it("Should not accept token reward rate more than max", async () => {
                const { rewardDistributor, proxy } = setUpConfig;
                await expect(proxy.connect(rewardDistributor).setTokenRewardRate(MAX_TOKEN_REWARD_RATE + 1n)).to.be.revertedWithCustomError(proxy, "StakingRewards__RewardRateExceedsMaxRate");
            });

            it("Should not allow not owner to set token reward rate", async () => {
                const { bob, proxy } = setUpConfig;
                await expect(proxy.connect(bob).setTokenRewardRate(MAX_TOKEN_REWARD_RATE)).to.be.reverted;
            })

            it("Should emit Log Token Reward Rate when updating", async () => {
                const { rewardDistributor, proxy } = setUpConfig;
                await expect(proxy.connect(rewardDistributor).setTokenRewardRate(MAX_TOKEN_REWARD_RATE - 1n)).to.emit(proxy, "LogTokenRewardRateUpdated").withArgs(MAX_TOKEN_REWARD_RATE - 1n);
            });
        })

        // ========================= ADD TOKEN REWARD ==========================

        describe("Add Token Reward Testing", async () => {

            it("Should accept to add token reward from rewardDistributor role", async ()=> {
                const { rewardDistributor, proxy, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addTokenReward(ethers.parseUnits("1000", 6));
                expect(await proxy.tokenRewardBalance()).to.be.equal(ethers.parseUnits("1000", 6));
                expect(await USDT.balanceOf(await rewardDistributor.getAddress())).to.be.equal(USDT_TO_OWNER - ethers.parseUnits("1000", 6));
                expect(await USDT.balanceOf(await proxy.getAddress())).to.be.equal(ethers.parseUnits("1000", 6));
            });

            it("Should not accept to add token reward from not authorized", async () => {
                const { bob, proxy, USDT } = setUpConfig;
                await USDT.connect(bob).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await expect(proxy.connect(bob).addTokenReward(ethers.parseUnits("1000", 6))).to.be.reverted;
            });

            it("Should not accept add token reward if rewardDistributor doesn't have money", async()=>{
                const { rewardDistributor, proxy, USDT } = setUpConfig;
                const execciveAmount = USDT_TO_OWNER + 100000n;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits(execciveAmount.toString(), 6));
                await expect(proxy.connect(rewardDistributor).addTokenReward(ethers.parseUnits(execciveAmount.toString(), 6))).to.be.reverted;
            })

            it("Should not accept 0 amount", async ()=> {
                const { rewardDistributor, proxy } = setUpConfig;
                await expect(proxy.connect(rewardDistributor).addTokenReward(0n)).to.be.revertedWithCustomError(proxy, "StakingRewards__NoZeroAmount");
            })

            it("Should emit Log Token Reward Added when adding token reward", async () => {
                const { rewardDistributor, proxy, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await expect(proxy.connect(rewardDistributor).addTokenReward(ethers.parseUnits("1000", 6))).to.emit(proxy, "LogAddTokenReward").withArgs(ethers.parseUnits("1000", 6));
            });

        })

        // ========================= ADD REVENUE REWARD ==========================

        describe("Add revenue reward", async ()=> {

            it("Should allow to add revenue reward to REWARDS_DITRIBUTOR_ROLE", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                expect(await USDT.balanceOf(await proxy.getAddress())).to.be.equal(ethers.parseUnits("1000", 6));
            });

            it("Should not allow to add revenue rewars if not authorized", async ()=> {
                const { proxy, bob, USDT } = setUpConfig;
                await USDT.connect(bob).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await expect(proxy.connect(bob).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n)).to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");

            })

            it("Should not allow 0 amount", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await expect(proxy.connect(rewardDistributor).addRevenueReward(0, ONE_DAY * 10n)).to.be.revertedWithCustomError(proxy, "StakingRewards__NoZeroAmount");

            })

            it("Should not allow 0 reward duration", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await expect(proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), 0n)).to.be.revertedWithCustomError(proxy, "StakingRewards__NoZeroRewardDuration");
            })

            it("Should successfully trasfer from user USDT", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                const USDT_TO_OWNER = await USDT.balanceOf(await rewardDistributor.getAddress());
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                expect(await USDT.balanceOf(await rewardDistributor.getAddress())).to.be.equal(USDT_TO_OWNER - ethers.parseUnits("1000", 6));
            })

            it("Should revert if user doesn't have enough USDT", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), USDT_TO_OWNER + 2n);
                await expect(proxy.connect(rewardDistributor).addRevenueReward(USDT_TO_OWNER + 2n, ONE_DAY * 10n)).to.be.reverted;
            })

            it("Should update allRevenueRewardIn", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                const initialAllRevenueRewardIn = await proxy.allRevenueRewardIn();
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                expect(await proxy.allRevenueRewardIn()).to.be.equal(initialAllRevenueRewardIn + ethers.parseUnits("1000", 6));
            })

            it("Should update lastTimeRevenueRewardUpdated with current timestamp", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                const block = await ethers.provider.getBlock('latest');
                const blockTimestamp = BigInt(block!.timestamp);
                const lastTimeRevenueRewardUpdated = await getStorageAt(await proxy.getAddress(), 9); // @audit note: change slot if contract's variables change 
                expect(lastTimeRevenueRewardUpdated).to.be.approximately(blockTimestamp, 4000n);
            })

            it("Should update revenueRewardPeriodEndTime correctly", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                const block = await ethers.provider.getBlock('latest');
                const blockTimestamp = BigInt(block!.timestamp);
                const revenueRewardPeriodEndTime = await getStorageAt(await proxy.getAddress(), 10); 
                let BLOCK_TIME_LENGTH = await proxy.connect(rewardDistributor).blockTimeLenght();
                expect(revenueRewardPeriodEndTime).to.be.equal(blockTimestamp + ONE_DAY * 10n - BLOCK_TIME_LENGTH);
            })

            it("Should update revenueRewardPerSecond on rewards duration if revenueRewardPeriodEndTime has passed", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                const initialRevenueRewardPerSecond = await getStorageAt(await proxy.getAddress(), 8); 
                expect(initialRevenueRewardPerSecond).to.be.equal(0n);
                const precisionFactor = await proxy.DECIMAL_PRECISION();
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                const expectedRevenueRewardPerSecond = (ethers.parseUnits("1000", 6) * precisionFactor) / (ONE_DAY * 10n);
                const currentRevenueRewardPerSecond = await getStorageAt(await proxy.getAddress(), 8); // @audit note: change slot if contract's variables change
                expect(currentRevenueRewardPerSecond).to.be.equal(expectedRevenueRewardPerSecond);
            })

            it("Should update revenueRewardPerSecond cumulatively on rewards duration if revenueRewardPeriodEndTime has not passed", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                const precisionFactor = await proxy.DECIMAL_PRECISION();
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                const block = await ethers.provider.getBlock('latest');
                const currentTimestamp = BigInt(block!.timestamp);
                const revenueRewardPeriodEndTime = BigInt(await getStorageAt(await proxy.getAddress(), 10)); // @audit note: change slot if contract's variables change
                expect(currentTimestamp).to.be.lessThan(revenueRewardPeriodEndTime); // @audit note: change slot if contract's variables change
                const prevRevenueRewardPerSecond = BigInt(await getStorageAt(await proxy.getAddress(), 8)); // @audit note: change slot if contract's variables change
                expect(prevRevenueRewardPerSecond).to.be.equal((ethers.parseUnits("1000", 6) * precisionFactor) / (ONE_DAY * 10n));
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                const block2 = await ethers.provider.getBlock('latest');
                const currentTimestamp2 = BigInt(block2!.timestamp); // needed because transactions increase time
                const remainingTime = revenueRewardPeriodEndTime - currentTimestamp2;
                const remainingReward = (remainingTime * prevRevenueRewardPerSecond) / precisionFactor;
                const expectedRevenueRewardPerSecond = ((remainingReward + ethers.parseUnits("1000", 6)) * precisionFactor) / (ONE_DAY * 10n);
                const currentRevenueRewardPerSecond = BigInt(await getStorageAt(await proxy.getAddress(), 8)); // @audit note: change slot if contract's variables change
                expect(currentRevenueRewardPerSecond).to.be.equal(expectedRevenueRewardPerSecond);
            })

            it("Should update revenueRewardOdometer to 0 the first time a reward is added", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                const revenueRewardOdometer = await proxy.revenueRewardOdometer();
                expect(revenueRewardOdometer).to.be.equal(0n);
            })

            it("Should keep revenueRewardOdometer to 0 after multiple rewards are added if staked tokens are 0", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                const revenueRewardOdometer = await proxy.revenueRewardOdometer();
                expect(revenueRewardOdometer).to.be.equal(0n);
            })

            it("Should not update revenueRewardOdometer to more than 0 if reward is created after tokens are staked", async ()=> {
                const { proxy, rewardDistributor, USDT, bob, spotContanct } = setUpConfig;
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                const revenueRewardOdometer = await proxy.revenueRewardOdometer();
                expect(revenueRewardOdometer).to.be.equal(0n);
            })

            it("Should update revenueRewardOdometer correctly if reward is created before tokens are staked", async ()=> {
                const { proxy, rewardDistributor, USDT, bob, spotContanct } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("50"));
                await proxy.connect(bob).stake(ethers.parseEther("50"));
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("50"));
                await proxy.connect(bob).stake(ethers.parseEther("50"));
                const revenueRewardOdometer = await proxy.revenueRewardOdometer();
                expect(revenueRewardOdometer).to.be.greaterThan(0n);
            })

            it("Should emit an event", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await expect(proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n)).to.emit(proxy, "LogRevenueRewardAdded").withArgs(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
            })

        })

        // ========================= WITHDRAW PENALTY FEES COLLECTED ==========================

        describe("Withdraw Penalty Fees Collected", async ()=> {

            it("Should allow to withdraw penalty fees if authorized", async ()=> {
                const { proxy, rewardDistributor, USDT, spotContanct, bob, paramsSetter, penaltyFeesCollector } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                expect(await proxy.penaltyDays()).to.be.equal(ONEWEEK);
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await proxy.connect(bob).withdraw();
                const penaltyFees = await proxy.penaltyFeesCollected();
                expect(penaltyFees).to.be.greaterThan(0n);
                await proxy.connect(rewardDistributor).withdrawAllPenaltyFeesCollected();
                expect(await spotContanct.balanceOf(await penaltyFeesCollector.getAddress())).to.be.equal(penaltyFees);
            })

            it("Should revert if user is not authorized", async ()=> {
                const { proxy, bob } = setUpConfig;
                await expect(proxy.connect(bob).withdrawAllPenaltyFeesCollected()).to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
            })

            it("Should revert if user is authorized but penalty fees are not present", async ()=> {
                const { proxy, rewardDistributor } = setUpConfig;
                await expect(proxy.connect(rewardDistributor).withdrawAllPenaltyFeesCollected()).to.be.revertedWithCustomError(proxy, "StakingRewards__NoPenaltyFeeToCollect");
            })

            it("Should set penalty fees to zero after collecting them", async ()=> {
                const { proxy, rewardDistributor, USDT, spotContanct, bob, paramsSetter, penaltyFeesCollector } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                expect(await proxy.penaltyDays()).to.be.equal(ONEWEEK);
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await proxy.connect(bob).withdraw();
                const penaltyFees = await proxy.penaltyFeesCollected();
                expect(penaltyFees).to.be.greaterThan(0n);
                await proxy.connect(rewardDistributor).withdrawAllPenaltyFeesCollected();
                expect(await spotContanct.balanceOf(await penaltyFeesCollector.getAddress())).to.be.equal(penaltyFees);
                expect(await proxy.penaltyFeesCollected()).to.be.equal(0n);
            })

            it("Should emit an event", async ()=> {
                const { proxy, rewardDistributor, USDT, spotContanct, bob, paramsSetter, penaltyFeesCollector } = setUpConfig;
                const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                await proxy.connect(paramsSetter).requestToSetWithdrawWaitTime(ONE_DAY);
                await proxy.connect(paramsSetter).requestToSetPenaltyDays(ONEWEEK);
                await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                expect(await proxy.penaltyDays()).to.be.equal(ONEWEEK);
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                await network.provider.send("evm_increaseTime", [ONE_DAY.toString()]);
                await proxy.connect(bob).withdraw();
                const penaltyFees = await proxy.penaltyFeesCollected();
                expect(penaltyFees).to.be.greaterThan(0n);
                await expect(proxy.connect(rewardDistributor).withdrawAllPenaltyFeesCollected()).to.emit(proxy, "LogPenaltiesWithdrawn").withArgs(await penaltyFeesCollector.getAddress(), penaltyFees);
            })

        })

        // ========================= WITHDRAW UNALLOCATED STAKING TOKEN REWARDS ==========================

        describe("Withdraw Unallocated Staking Token Rewards", async ()=> {
            
            it("Should allow to withdraw unallocated staking token rewards if authorized", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await proxy.connect(rewardDistributor).setTokenRewardRate(MAX_TOKEN_REWARD_RATE - 1n);
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addTokenReward(ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).withdrawUnallocatedStakingTokenRewards();
                expect(await USDT.balanceOf(await proxy.getAddress())).to.be.equal(0n);
            })

            it("Should revert if user is not authorized", async ()=> {
                const {bob, proxy} = setUpConfig;
                await expect(proxy.connect(bob).withdrawUnallocatedStakingTokenRewards()).to.be.revertedWithCustomError(proxy, "AccessControlUnauthorizedAccount");
            })

            it("Should revert if user is authorized but no unallocated rewards are present", async ()=> {
                const {proxy, rewardDistributor} = setUpConfig;
                await expect(proxy.connect(rewardDistributor).withdrawUnallocatedStakingTokenRewards()).to.be.revertedWithCustomError(proxy, "StakingRewards__NoAmountAvailable");
            })

            it("Should emit an event", async ()=> {
                const { proxy, rewardDistributor, USDT } = setUpConfig;
                await proxy.connect(rewardDistributor).setTokenRewardRate(MAX_TOKEN_REWARD_RATE - 1n);
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addTokenReward(ethers.parseUnits("1000", 6));
                await expect(proxy.connect(rewardDistributor).withdrawUnallocatedStakingTokenRewards()).to.emit(proxy, "LogUnallocatedStakeTokenRewardsWithdrawn").withArgs(ethers.parseUnits("1000", 6));
            })

        })

    })

    describe("External Mutative Functions", async ()=> {

        // ========================= STAKE FUNCTION ==========================

        describe("Stake Function", async ()=> {

            it("Should allow to stake tokens", async ()=> {
                const { proxy, bob, spotContanct } = setUpConfig;
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                expect(await spotContanct.balanceOf(await proxy.getAddress())).to.be.equal(ethers.parseEther("100"));
            })

            it("Should revert is amount is 0", async ()=> {
                const { proxy, bob } = setUpConfig;
                await expect(proxy.connect(bob).stake(0)).to.be.revertedWithCustomError(proxy, "StakingRewards__NoZeroAmount");
            })

            it("Should revert if user doesn't have enough USDT", async ()=> {
                const { proxy, bob, spotContanct } = setUpConfig;
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("1000"));
                await expect(proxy.connect(bob).stake(ethers.parseEther("1000"))).to.be.revertedWithCustomError(spotContanct,"ERC20InsufficientBalance");
            })

            it("Should update total staked tokens", async ()=> {
                const { proxy, bob, spotContanct } = setUpConfig;
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                expect(await proxy.getTotalStakedTokens()).to.be.equal(ethers.parseEther("100"));
            })

            it("Should update user balance", async ()=> {
                const { proxy, bob, spotContanct } = setUpConfig;
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                expect(await proxy.balanceOf(await bob.getAddress())).to.be.equal(ethers.parseEther("100"));
            })

            it("Should update user staking timestamp", async ()=> {
                const { proxy, bob, spotContanct } = setUpConfig;
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                const block = await ethers.provider.getBlock("latest");
                const blockTimestamp = BigInt(block!.timestamp);
                const userStakingTimestamp = await proxy.userStakingTimestamp(await bob.getAddress());
                expect(userStakingTimestamp).to.be.equal(blockTimestamp);
            })

            it("Should emit an event", async ()=> {
                const { proxy, bob, spotContanct } = setUpConfig;
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await expect(proxy.connect(bob).stake(ethers.parseEther("100"))).to.emit(proxy, "LogStaked").withArgs(await bob.getAddress(), ethers.parseEther("100"));
            })

        })

        // ========================= WITHDRAW FUNCTIONS ==========================

        describe("Withdraw Functions", async ()=> {

            // ========================= WITHDRAW REQUEST FUNCTION ==========================

            describe("Withdraw Request function", async ()=> {

                it("Should revert if user tries to withdraw 0", async ()=> {
                    const { proxy, bob } = setUpConfig;
                    await expect(proxy.connect(bob).requestToWithdraw(0n)).to.be.revertedWithCustomError(proxy, "StakingRewards__NoZeroAmount");
                })
    
                it("Should revert if user tries to withdraw more than balance", async ()=> {
                    const { proxy, bob } = setUpConfig;
                    await expect(proxy.connect(bob).requestToWithdraw(ethers.parseEther("200"))).to.be.revertedWithCustomError(proxy, "StakingRewards__NotEnoughBalance");
                })
    
                it("Should revert if there is a pending request", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("50"));
                    await expect(proxy.connect(bob).requestToWithdraw(ethers.parseEther("50"))).to.be.revertedWithCustomError(proxy, "StakingRewards__WithdrawRequestPending");
                })
    
                it("Should update user balance", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    expect(await proxy.balanceOf(await bob.getAddress())).to.be.equal(0n);
                })
    
                it("Should update total staked tokens", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    expect(await proxy.getTotalStakedTokens()).to.be.equal(0n);
                })
    
                it("Should create pending request", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    const whithdrawWaitTime = await proxy.withdrawWaitTime();
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    const block = await ethers.provider.getBlock("latest");
                    const blockTimestamp = BigInt(block!.timestamp);
                    const pendingRequest = await proxy.readyToWithdraw(await bob.getAddress());
                    expect(pendingRequest).to.be.deep.equal([ethers.parseEther("100"), blockTimestamp + whithdrawWaitTime]);
                })
    
                it("Should emit an event", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await expect(proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"))).to.emit(proxy, "LogWithdrawRequested").withArgs(await bob.getAddress(), ethers.parseEther("100"));
                })

            })

            // ========================= CANCEL WITHDRAW REQUEST FUNCTION ==========================

            describe("Canecel Withdraw Request function", async ()=> {

                it("Should revert if there is no pending request", async ()=> {
                    const { proxy, bob } = setUpConfig;
                    await expect(proxy.connect(bob).cancelWithdraw()).to.be.revertedWithCustomError(proxy, "StakingRewards__NoWithdrawRequestPending");
                })

                it("Should update user balance", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await proxy.connect(bob).cancelWithdraw();
                    expect(await proxy.balanceOf(await bob.getAddress())).to.be.equal(ethers.parseEther("100"));
                })

                it("Should update total staked tokens", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await proxy.connect(bob).cancelWithdraw();
                    expect(await proxy.getTotalStakedTokens()).to.be.equal(ethers.parseEther("100"));
                })

                it("Should delete pending request", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await proxy.connect(bob).cancelWithdraw();
                    const pendingRequest = await proxy.readyToWithdraw(await bob.getAddress());
                    expect(pendingRequest).to.be.deep.equal([0n, 0n]);
                })

                it("Should emit an event", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await expect(proxy.connect(bob).cancelWithdraw()).to.emit(proxy, "LogWithdrawalCancelled").withArgs(await bob.getAddress(), ethers.parseEther("100"));
                })
                
            })

            // ========================= WITHDRAW FUNCTION ==========================

            describe("Withdraw function", async ()=> {

                it("Should revert if user tries to withdraw 0", async ()=> {
                    const { proxy, bob } = setUpConfig;
                    await expect(proxy.connect(bob).withdraw()).to.be.revertedWithCustomError(proxy, "StakingRewards__NoAmountAvailable");
                })

                it("Should revert if not enough time has passed", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await expect(proxy.connect(bob).withdraw()).to.be.revertedWithCustomError(proxy, "StakingRewards__WithdrawWaitTimeNotReached");
                })

                it("Should cancel withdrawal request if withdrawn successfully", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    const whithdrawWaitTime = await proxy.withdrawWaitTime();
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await network.provider.send("evm_increaseTime", [whithdrawWaitTime.toString()]);
                    await proxy.connect(bob).withdraw();
                    const pendingRequest = await proxy.readyToWithdraw(await bob.getAddress());
                    expect(pendingRequest).to.be.deep.equal([0n, 0n]);
                })

                it("Should transfer SPOT correctly", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    const whithdrawWaitTime = await proxy.withdrawWaitTime();
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await network.provider.send("evm_increaseTime", [whithdrawWaitTime.toString()]);
                    await proxy.connect(bob).withdraw();
                    expect(await spotContanct.balanceOf(await bob.getAddress())).to.be.equal(ethers.parseEther("100"));
                    expect(await spotContanct.balanceOf(await proxy.getAddress())).to.be.equal(0n);
                })

                it("Should deduct penalty fees if staking period is less than penalty days", async ()=> {
                    const { proxy, bob, spotContanct, paramsSetter } = setUpConfig;
                    const penaltyDaysTimelock = await proxy.PENALTY_DAYS_TIMELOCK();
                    await proxy.connect(paramsSetter).requestToSetPenaltyDays(20n);
                    await network.provider.send("evm_increaseTime", [penaltyDaysTimelock.toString()]);
                    await proxy.connect(paramsSetter).applyPenaltyDaysRequest();
                    expect(await proxy.penaltyDays()).to.be.equal(20n);
                    const whithdrawWaitTime = await proxy.withdrawWaitTime();
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await network.provider.send("evm_increaseTime", [whithdrawWaitTime.toString()]);
                    await proxy.connect(bob).withdraw();
                    const penaltyFees = await proxy.penaltyFeesCollected();
                    expect(penaltyFees).to.be.equal(ethers.parseEther("10"));
                })

                it("Should emit an event", async ()=> {
                    const { proxy, bob, spotContanct } = setUpConfig;
                    const whithdrawWaitTime = await proxy.withdrawWaitTime();
                    await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                    await proxy.connect(bob).stake(ethers.parseEther("100"));
                    await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
                    await network.provider.send("evm_increaseTime", [whithdrawWaitTime.toString()]);
                    await expect(proxy.connect(bob).withdraw()).to.emit(proxy, "LogWithdrawn").withArgs(await bob.getAddress(), ethers.parseEther("100"), 0n);
                })

            })

        })

        describe("Claim Reward Function", async ()=> {

            it("Should get 0 reward if stakes but rewards are 0", async ()=> {
                const { proxy, bob, spotContanct, USDT } = setUpConfig;
                const USDTPrevBalance = await USDT.balanceOf(await bob.getAddress());
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                network.provider.send("evm_increaseTime", [(ONE_DAY * 3n).toString()]);
                await proxy.connect(bob).getReward();
                const USDTBalance = await USDT.balanceOf(await bob.getAddress());
                expect(USDTBalance).to.be.equal(USDTPrevBalance);
            })

            it("Should get 0 if rewards are present but user has staked 0", async ()=> {
                const { proxy, bob, USDT, rewardDistributor } = setUpConfig;
                const USDTPrevBalance = await USDT.balanceOf(await bob.getAddress());
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                network.provider.send("evm_increaseTime", [(ONE_DAY * 3n).toString()]);
                await proxy.connect(bob).getReward();
                const USDTBalance = await USDT.balanceOf(await bob.getAddress());
                expect(USDTBalance).to.be.equal(USDTPrevBalance);
            })

            it("Should get total revenue reward if only one user stakes for entire time", async ()=> {
                const { proxy, bob, USDT, rewardDistributor, spotContanct } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                let rewPerSec = await proxy.connect(rewardDistributor).revenueRewardPerSecond();
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                network.provider.send("evm_increaseTime", [(ONE_DAY * 10n).toString()]);
                await proxy.connect(bob).getReward();
                const USDTBalance = await USDT.balanceOf(await bob.getAddress());
                expect(USDTBalance).to.be.approximately(ethers.parseUnits("1000", 6), ethers.parseUnits("1", 6));
            })

            it("Should get proportional revenue reward if only one user stakes for less than the entire time", async ()=> { 
                const { proxy, bob, USDT, rewardDistributor, spotContanct } = setUpConfig;
                const prevBalance = await USDT.balanceOf(await bob.getAddress());
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                network.provider.send("evm_increaseTime", [(ONE_DAY * 5n).toString()]);
                await proxy.connect(bob).getReward();
                const USDTBalance = await USDT.balanceOf(await bob.getAddress());
                expect(USDTBalance - prevBalance).to.be.approximately(ethers.parseUnits("500", 6), ethers.parseUnits("10", 6));
            })


            it("Should accumulate revenue and token reward if both present", async ()=> { 
                const { proxy, bob, USDT, rewardDistributor, spotContanct } = setUpConfig;
                const prevBalance = await USDT.balanceOf(await bob.getAddress());
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).setTokenRewardRate(ethers.parseUnits("1", 6));
                await proxy.connect(rewardDistributor).addTokenReward(ethers.parseUnits("1000", 6));
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                network.provider.send("evm_increaseTime", [(ONE_DAY * 10n).toString()]);
                await proxy.connect(bob).getReward();
                const USDTBalance = await USDT.balanceOf(await bob.getAddress());
                expect(USDTBalance - prevBalance).to.be.approximately(ethers.parseUnits("2000", 6), ethers.parseUnits("3", 6));
            })
            
            it("Should proportionally divide if multiple users stake for the entire time", async ()=> { 
                const { proxy, bob, alice, USDT, rewardDistributor, spotContanct } = setUpConfig;
                const prevBalanceBob = await USDT.balanceOf(await bob.getAddress());
                const prevBalanceAlice = await USDT.balanceOf(await alice.getAddress());
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                await spotContanct.connect(alice).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(alice).stake(ethers.parseEther("100"));
                
                network.provider.send("evm_increaseTime", [(ONE_DAY * 10n).toString()]);
                
                await proxy.connect(bob).getReward();
                await proxy.connect(alice).getReward();
                
                const USDTBalanceBob = await USDT.balanceOf(await bob.getAddress());
                const USDTBalanceAlice = await USDT.balanceOf(await alice.getAddress());
                expect(USDTBalanceBob - prevBalanceBob).to.be.approximately(ethers.parseUnits("500", 6), ethers.parseUnits("1", 6));
                expect(USDTBalanceAlice - prevBalanceAlice).to.be.approximately(ethers.parseUnits("500", 6), ethers.parseUnits("1", 6));
            })

            it("Should emit an event", async ()=> {
                const { proxy, bob, USDT, rewardDistributor, spotContanct } = setUpConfig;
                await USDT.connect(rewardDistributor).approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
                await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
                await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
                await proxy.connect(bob).stake(ethers.parseEther("100"));
                network.provider.send("evm_increaseTime", [(ONE_DAY * 10n).toString()]);
                await expect(proxy.connect(bob).getReward()).to.emit(proxy, "LogRewardPaid").withArgs(await bob.getAddress(), 999996500n, 0n);
            })

        })

    })

    // ========================= VIEW FUNCTIONS ==========================

    describe("View Functions", async ()=> {

        it("Get withdraw available time", async ()=> {
            const { proxy, bob, spotContanct } = setUpConfig;
            await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
            await proxy.connect(bob).stake(ethers.parseEther("100"));
            await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
            const block = await ethers.provider.getBlock("latest");
            const blockTimestamp = BigInt(block!.timestamp);
            const withdrawAvailableTime = await proxy.connect(bob).getWithdrawAvailableTime();
            expect(withdrawAvailableTime).to.be.approximately(blockTimestamp + await proxy.withdrawWaitTime(), 3000n);
        })

        it("Get withdraw request amount", async ()=> {
            const { proxy, bob, spotContanct } = setUpConfig;
            await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
            await proxy.connect(bob).stake(ethers.parseEther("100"));
            await proxy.connect(bob).requestToWithdraw(ethers.parseEther("100"));
            const withdrawRequestAmount = await proxy.connect(bob).getWithdrawRequestedAmount();
            expect(withdrawRequestAmount).to.be.equal(ethers.parseEther("100"));
        })

        it("Get revenue reward per second", async ()=> {
            const { proxy, rewardDistributor, USDT } = setUpConfig;
            await USDT.approve(await proxy.getAddress(), ethers.parseUnits("1000", 6));
            await proxy.connect(rewardDistributor).addRevenueReward(ethers.parseUnits("1000", 6), ONE_DAY * 10n);
            const revenueRewardPerSecond = await proxy.getRevenueRewardsPerSecond();
            expect(revenueRewardPerSecond / BigInt(1e18)).to.be.equal(ethers.parseUnits("1000", 6) / (ONE_DAY * 10n));
        })

        it("Get balance of", async ()=> {
            const { proxy, bob, spotContanct } = setUpConfig;
            await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
            await proxy.connect(bob).stake(ethers.parseEther("100"));
            const balance = await proxy.balanceOf(await bob.getAddress());
            expect(balance).to.be.equal(ethers.parseEther("100"));
        })

        it("Get lastTimeRevenueRewardApplicable", async ()=> {
            const { proxy } = setUpConfig;
            const block = await ethers.provider.getBlock("latest");
            const blockTimestamp = BigInt(block!.timestamp);
            const lastTimeRevenueRewardApplicable = await proxy.lastTimeRevenueRewardApplicable(blockTimestamp * 10n);
            expect(lastTimeRevenueRewardApplicable).to.be.equal(blockTimestamp);
        })

        it("Get getTotalStakedTokens", async ()=> {
            const { proxy, bob, spotContanct } = setUpConfig;
            await spotContanct.connect(bob).approve(await proxy.getAddress(), ethers.parseEther("100"));
            await proxy.connect(bob).stake(ethers.parseEther("100"));
            const totalStakedTokens = await proxy.getTotalStakedTokens();
            expect(totalStakedTokens).to.be.equal(ethers.parseEther("100"));
        })

    })

})