## Overview

The `StakingRewards` contract provides a mechanism for users to stake SPOT tokens and earn rewards in USDT. In addition to the standard staking rewards, the contract features an optional "revenue" stream that admins can activate to distribute additional USDT rewards to stakers. This contract is designed with security and flexibility in mind, incorporating various controls and timelocks to ensure proper governance and user protection.

### Key Features

1. **Dual Reward System:**

   - **Staking Rewards:** Users earn rewards in USDT based on the amount of SPOT tokens they stake.
   - **Revenue Rewards:** Admins can activate an additional stream of USDT rewards, distributed over a specified period, to provide extra incentives to stakers.
2. **Penalty Mechanism:**

   - Users who withdraw their staked tokens before a predefined period (penalty days) incur a penalty, which is collected by the contract and can be withdrawn by the admins.
3. **Timelocks for sensitive setters:**

   - **Penalty Days Timelock:** Changes to the penalty period require a waiting period before they take effect, providing a buffer for users to adapt to the changes.
   - **Withdrawal Wait Time Timelock:** Similar to the penalty days, changes to the withdrawal wait time are also subject to a timelock to ensure transparency and prevent abrupt changes.

   Timelock are implemented to guarantee users safety. Both of the setters will not incur in the timelock if the input value is lower than the current one.
4. **Access Control:**

   - The contract uses role-based access control to manage permissions for setting parameters and distributing rewards. This ensures that only authorized addresses can perform critical operations.

### Usage Scenarios

1. **Earning Passive Income:**

   - Users can stake their SPOT tokens to earn USDT rewards, providing a source of passive income.
2. **Incentivized Staking:**

   - Admins can activate revenue rewards to incentivize staking during promotional periods or to boost overall staking activity.

### Technical Specifications

Technical Specifications can be found in /docs/TechnicalSpecifications.html and in the NatSpec.

# Running the Project

Follow these steps to run the project:

1. **Install dependencies**

   ```sh
   npm install
   ```
2. **Copy .env.example file into .env**

   ```sh
   cp .env.example .env
   ```
3. **Compile the smart contracts**

   ```sh
   npx hardhat compile
   ```
4. **Run the local development network**

   ```sh
   npx hardhat node
   ```
5. **Deploy the smart contracts to the local network**

   Open a new terminal window and run:

   ```sh
   npx hardhat run scripts/deploy.ts --network localhost
   ```
6. **Run tests**

   ```sh
   npx hardhat test
   ```
7. **Measure test coverage**

   ```sh
   npx hardhat coverage
   ```
8. **Run a specific script**

   ```sh
   npx hardhat run scripts/<your-script>.ts
   ```

Replace `<your-script>` with the name of the script you want to run.

Note: In order to run the deploy script, the .env variable ENVIRONMENT shall not be set to 'development'.

## Additional Commands

- **Clean the cache and artifacts**

  ```sh
  npx hardhat clean
  ```
- **Get help**

  ```sh
  npx hardhat help
  ```

Make sure to configure your `hardhat.config.js` as needed for your specific setup and network requirements.
