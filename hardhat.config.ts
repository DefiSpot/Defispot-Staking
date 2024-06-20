import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@openzeppelin/hardhat-upgrades";
import "solidity-coverage";
import "hardhat-storage-layout";

import dotenv from "dotenv";

dotenv.config();


const config: HardhatUserConfig = {
  solidity: "0.8.24",
  networks: {
    localhost: {
      url: "http://127.0.0.1:8545/",
      forking: {
        url: process.env.RPC_MAINNET || "",
      }
    },
    mainnet: {
      url: process.env.RPC_MAINNET || "",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY || ""]
    },
    sepolia: {
      url: process.env.RPC_SEPOLIA || "",
      accounts: [process.env.DEPLOYER_PRIVATE_KEY || ""]
    }, 
  },
};

export default config;
