import { ethers, upgrades } from "hardhat";
import dotenv from "dotenv";


dotenv.config();

async function upgrade(){

    if (!process.env.DEPLOYER_PRIVATE_KEY) throw new Error("DEPLOYER_PRIVATE_KEY is not set");
    if (!process.env.PROXY_ADDRESS) throw new Error("PROXY_ADDRESS is not set");

    const proxyAddress = process.env.PROXY_ADDRESS;

    const version2 = await ethers.getContractFactory("StakingRewardsV2");

    const upgradedContract = await upgrades.upgradeProxy(proxyAddress, version2, { call: {
        fn: "initializeV2", args:[]
    }});

    await upgradedContract.waitForDeployment();

    console.log("Proxy address: ", proxyAddress);
    console.log("Upgraded contract address: ", await upgrades.erc1967.getImplementationAddress(proxyAddress));
}

async function main() {
    await upgrade()
}

main();