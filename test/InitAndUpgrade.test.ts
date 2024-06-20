import { expect } from 'chai';
import { ethers, upgrades } from 'hardhat';
import { DefiSpotToken, IERC20, StakingRewards, StakingRewardsV2 } from '../typechain-types';
import { Signer } from 'ethers';


interface setUpConfig {
    owner: Signer;
    rewardDistributor: Signer;
    feesCollector: Signer;
    paramsSetter: Signer;
    spotContanct: DefiSpotToken;
    USDT: IERC20;
}


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

const setUp = async (): Promise<setUpConfig> => {
    const [owner, rewardDistributor, feesCollector, paramsSetter] = await ethers.getSigners();
    
    const SpotToken = await ethers.getContractFactory('DefiSpotToken');
    const initialSupply = ethers.parseEther('1000');

    const spotContanct = await SpotToken.deploy("SPOT", "SPT", initialSupply) as DefiSpotToken;
    await spotContanct.waitForDeployment();

    const MockUSDT = await ethers.getContractFactory('MockUSDT', rewardDistributor);
    const USDT = await MockUSDT.deploy() as IERC20;
    await USDT.waitForDeployment();

    return {spotContanct, USDT, owner, rewardDistributor, feesCollector, paramsSetter};
    
};



describe('InitAndUpgrade', async () => {


    let setUpConfig: setUpConfig;

    beforeEach(async ()=> {
        setUpConfig = await setUp(); 
    })

    describe("Inititialization", async ()=> {

        it('Should initialize the contract with the correct values', async ()=> {

            const {spotContanct, USDT, owner, rewardDistributor, feesCollector, paramsSetter} = setUpConfig;

            const spotContractAddress = await spotContanct.getAddress();
            const USDTAddress = await USDT.getAddress();
            const ownerAddress = await owner.getAddress();
            const rewardDistributorAddress = await rewardDistributor.getAddress();
            const feesCollectorAddress = await feesCollector.getAddress();
            const paramsSetterAddress = await paramsSetter.getAddress(); 
            const blockProductionTime = await getBlockProductionTime();

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            const proxy = await upgrades.deployProxy(StakingRewards, [feesCollectorAddress, spotContractAddress, USDTAddress, paramsSetterAddress, rewardDistributorAddress, blockProductionTime],
                {initializer: 'initialize'}
            ) as unknown as StakingRewards;

            const block = await ethers.provider.getBlock('latest');
            const timestamp = block!.timestamp;
            const maxWithdrawWaitTime = await proxy.MAX_WITHDRAW_WAIT_TIME();

            expect(await proxy.usdtToken()).to.equal(USDTAddress);
            expect(await proxy.spotToken()).to.equal(spotContractAddress);
            expect(await proxy.penaltyFeesCollector()).to.equal(feesCollectorAddress);
            expect(await proxy.hasRole(await proxy.DEFAULT_ADMIN_ROLE(), ownerAddress)).to.equal(true);
            expect(await proxy.hasRole(await proxy.REWARDS_DITRIBUTOR_ROLE(), rewardDistributorAddress)).to.equal(true);
            expect(await proxy.hasRole(await proxy.PARAMS_SETTER_ROLE(), paramsSetterAddress)).to.equal(true);
            expect(await proxy.revenueRewardPeriodEndTime()).to.equal(timestamp);
            expect(await proxy.lastTimeRevenueRewardUpdated()).to.equal(timestamp);
            expect(await proxy.lastTimeTokenRewardUpdated()).to.equal(timestamp);
            expect(await proxy.withdrawWaitTime()).to.equal(maxWithdrawWaitTime);

        });

        it('Should not be initialized twice', async ()=> {

            const {spotContanct, USDT, owner, rewardDistributor, feesCollector, paramsSetter} = setUpConfig;

            const spotContractAddress = await spotContanct.getAddress();
            const USDTAddress = await USDT.getAddress();
            const ownerAddress = await owner.getAddress();
            const rewardDistributorAddress = await rewardDistributor.getAddress();
            const feesCollectorAddress = await feesCollector.getAddress();
            const paramsSetterAddress = await paramsSetter.getAddress(); 
            const blockProductionTime = await getBlockProductionTime();

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            const proxy = await upgrades.deployProxy(StakingRewards, [feesCollectorAddress, spotContractAddress, USDTAddress, paramsSetterAddress, rewardDistributorAddress, blockProductionTime],
                {initializer: 'initialize'}
            ) as unknown as StakingRewards;

            await expect(proxy.connect(rewardDistributor).initialize(feesCollectorAddress, spotContractAddress, USDTAddress, paramsSetterAddress, rewardDistributorAddress, blockProductionTime)).to.be.reverted;

        });

        it("Should revert if fees collector is address(0)", async ()=> {
            const {spotContanct, USDT, owner, rewardDistributor, paramsSetter} = setUpConfig;

            const spotContractAddress = await spotContanct.getAddress();
            const USDTAddress = await USDT.getAddress();
            const rewardDistributorAddress = await rewardDistributor.getAddress();
            const paramsSetterAddress = await paramsSetter.getAddress(); 
            const blockProductionTime = await getBlockProductionTime();

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            await expect(upgrades.deployProxy(StakingRewards, [ethers.ZeroAddress, spotContractAddress, USDTAddress, paramsSetterAddress, rewardDistributorAddress, blockProductionTime],
                {initializer: 'initialize'}
            )).to.be.revertedWithCustomError(StakingRewards,"StakingRewards__NoZeroAddress");
        })

        it("Should revert if spot contract is address(0)", async ()=> {
            const {USDT, owner, rewardDistributor, feesCollector, paramsSetter} = setUpConfig;

            const USDTAddress = await USDT.getAddress();
            const rewardDistributorAddress = await rewardDistributor.getAddress();
            const feesCollectorAddress = await feesCollector.getAddress();
            const paramsSetterAddress = await paramsSetter.getAddress(); 
            const blockProductionTime = await getBlockProductionTime();

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            await expect(upgrades.deployProxy(StakingRewards, [feesCollectorAddress, ethers.ZeroAddress, USDTAddress, paramsSetterAddress, rewardDistributorAddress, blockProductionTime],
                {initializer: 'initialize'}
            )).to.be.revertedWithCustomError(StakingRewards,"StakingRewards__NoZeroAddress");
        })

        it("Should revert if USDT contract is address(0)", async ()=> {
            const {spotContanct, owner, rewardDistributor, feesCollector, paramsSetter} = setUpConfig;

            const spotContractAddress = await spotContanct.getAddress();
            const rewardDistributorAddress = await rewardDistributor.getAddress();
            const feesCollectorAddress = await feesCollector.getAddress();
            const paramsSetterAddress = await paramsSetter.getAddress(); 
            const blockProductionTime = await getBlockProductionTime();

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            await expect(upgrades.deployProxy(StakingRewards, [feesCollectorAddress, spotContractAddress, ethers.ZeroAddress, paramsSetterAddress, rewardDistributorAddress, blockProductionTime],
                {initializer: 'initialize'}
            )).to.be.revertedWithCustomError(StakingRewards,"StakingRewards__NoZeroAddress");
        })

        it("Should revert if params setter is address(0)", async ()=> {
            const {spotContanct, USDT, owner, rewardDistributor, feesCollector} = setUpConfig;

            const spotContractAddress = await spotContanct.getAddress();
            const USDTAddress = await USDT.getAddress();
            const rewardDistributorAddress = await rewardDistributor.getAddress();
            const feesCollectorAddress = await feesCollector.getAddress();
            const blockProductionTime = await getBlockProductionTime();

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            await expect(upgrades.deployProxy(StakingRewards, [feesCollectorAddress, spotContractAddress, USDTAddress, ethers.ZeroAddress, rewardDistributorAddress, blockProductionTime],
                {initializer: 'initialize'}
            )).to.be.revertedWithCustomError(StakingRewards,"StakingRewards__NoZeroAddress");
        })

        it("Should revert if reward distributor is address(0)", async ()=> {
            const {spotContanct, USDT, owner, feesCollector, paramsSetter} = setUpConfig;

            const spotContractAddress = await spotContanct.getAddress();
            const USDTAddress = await USDT.getAddress();
            const feesCollectorAddress = await feesCollector.getAddress();
            const paramsSetterAddress = await paramsSetter.getAddress(); 
            const blockProductionTime = await getBlockProductionTime();

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            await expect(upgrades.deployProxy(StakingRewards, [feesCollectorAddress, spotContractAddress, USDTAddress, paramsSetterAddress, ethers.ZeroAddress, blockProductionTime],
                {initializer: 'initialize'}
            )).to.be.revertedWithCustomError(StakingRewards,"StakingRewards__NoZeroAddress");
        })

    })

    describe("Upgrade", async ()=> {

        it("Should upgrade the contract if caller is default admin", async ()=> {
            const {spotContanct, USDT, owner, rewardDistributor, feesCollector, paramsSetter} = setUpConfig;

            const spotContractAddress = await spotContanct.getAddress();
            const USDTAddress = await USDT.getAddress();
            const rewardDistributorAddress = await rewardDistributor.getAddress();
            const feesCollectorAddress = await feesCollector.getAddress();
            const paramsSetterAddress = await paramsSetter.getAddress(); 
            const blockProductionTime = await getBlockProductionTime();

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            const proxy = await upgrades.deployProxy(StakingRewards, [feesCollectorAddress, spotContractAddress, USDTAddress, paramsSetterAddress, rewardDistributorAddress, blockProductionTime],
                {initializer: 'initialize'}
            ) as unknown as StakingRewards;

            const newVersion = await ethers.getContractFactory('StakingRewardsV2', owner);
            const upgradedProxy = await upgrades.upgradeProxy(await proxy.getAddress(), newVersion, 
                {
                    call: {
                        fn: 'initializeV2',
                    }
                }
            ) as unknown as StakingRewardsV2;

            expect(await upgradedProxy.myVersion()).to.be.equal("2.0.0");
        })

        it("Should revert if caller is not default admin", async ()=> {
            const {spotContanct, USDT, owner, rewardDistributor, feesCollector, paramsSetter} = setUpConfig;

            const spotContractAddress = await spotContanct.getAddress();
            const USDTAddress = await USDT.getAddress();
            const rewardDistributorAddress = await rewardDistributor.getAddress();
            const feesCollectorAddress = await feesCollector.getAddress();
            const paramsSetterAddress = await paramsSetter.getAddress();
            const blockProductionTime = await getBlockProductionTime(); 

            const StakingRewards = await ethers.getContractFactory('StakingRewards', owner);
            const proxy = await upgrades.deployProxy(StakingRewards, [feesCollectorAddress, spotContractAddress, USDTAddress, paramsSetterAddress, rewardDistributorAddress, blockProductionTime],
                {initializer: 'initialize'}
            ) as unknown as StakingRewards;

            const newVersion = await ethers.getContractFactory('StakingRewardsV2', paramsSetter);
            await expect(upgrades.upgradeProxy(await proxy.getAddress(), newVersion, 
                {
                    call: {
                        fn: 'initializeV2',
                    }
                }
            )).to.be.revertedWithCustomError(StakingRewards,"AccessControlUnauthorizedAccount");  
        })

    })

});