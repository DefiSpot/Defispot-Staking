import { ethers, upgrades } from "hardhat";
import { Address, DefiSpotToken } from "../typechain-types";
import dotenv from "dotenv";
import { BigNumberish } from "ethers";


dotenv.config();

async function deploy() {

    if (!process.env.PENALTY_FEES_COLLECTOR_ADDRESS) throw new Error("REWARDS_TOKEN_ADDRESS is not set");
    if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
    if (!process.env.REWARDS_DITRIBUTOR_ROLE_ADDRESS) throw new Error("REWARDS_DITRIBUTOR_ROLE_ADDRESS is not set");
    if (!process.env.PARAMS_SETTER_ROLE_ADDRESS) throw new Error("PARAMS_SETTER_ROLE_ADDRESS is not set");
    if (!process.env.USDT_ADDRESS) throw new Error("USDT_ADDRESS is not set");

    const environment = process.env.ENVIROMENT || "development";

    const penaltyFeesCollectorAddress = process.env.PENALTY_FEES_COLLECTOR_ADDRESS;
    const rewardsDistributorRole = process.env.REWARDS_DITRIBUTOR_ROLE_ADDRESS;
    const paramsSetterRole = process.env.PARAMS_SETTER_ROLE_ADDRESS;
    const usdtAddress = process.env.USDT_ADDRESS;

    const blockProductionTime: BigNumberish = environment === "development" ? 12n : await getBlockProductionTime();

    let spotTokenAddress: string;

    if(environment === "development") {
        const DefiSpotToken = await ethers.getContractFactory("DefiSpotToken");
        const spotToken: DefiSpotToken = await DefiSpotToken.deploy("Spot Token", "SPOT", 1 * 1e6);
        await spotToken.waitForDeployment();
        spotTokenAddress = await spotToken.getAddress();
        console.log("Spot Token deployed at: ", spotTokenAddress);
    }else {
        if(!process.env.SPOT_TOKEN_ADDRESS) throw new Error("SPOT_TOKEN_ADDRESS is not set");
        spotTokenAddress = process.env.SPOT_TOKEN_ADDRESS;
    }

    const StakingRewards = await ethers.getContractFactory("StakingRewards");

    const proxy = await upgrades.deployProxy(StakingRewards, [penaltyFeesCollectorAddress, spotTokenAddress, usdtAddress, paramsSetterRole, rewardsDistributorRole, blockProductionTime], { initializer: 'initialize' });
    await proxy.waitForDeployment();
    const proxyAddress = await proxy.getAddress();
    console.log("StakingRewards proxy deployed at: ", proxyAddress);
    console.log("StakingRewards implementation deployed at: ", await upgrades.erc1967.getImplementationAddress(proxyAddress));

}


async function main() {
   await deploy()
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

main();