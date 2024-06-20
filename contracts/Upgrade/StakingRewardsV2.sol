// SPDX-License-Identifier: MIT

pragma solidity 0.8.24;

import {StakingRewards} from "../StakingRewards.sol";

contract StakingRewardsV2 is StakingRewards {

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor(){
        _disableInitializers();
    }

    function initializeV2() public reinitializer(2) {
        
    }

    function myVersion() external pure returns (string memory) {
        return "2.0.0";
    }
}