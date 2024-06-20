// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";

//import "hardhat/console.sol";
contract DefiSpotToken is ERC20Capped, AccessControl {
    bytes32 public constant MINTER = keccak256("MINTER");
    bytes32 public constant MINTER_MAKER = keccak256("MINTER_MAKER");

    constructor (string memory _name, string memory _symbol, uint256 initialSpotToMint)
        ERC20Capped(1_000_000_000*10**18)
        ERC20(_name, _symbol)
    {
        _mint(msg.sender, initialSpotToMint);
        //@Todo Which admin functions do we need to use a multisig wallet.
        //@Todo For instance, do we need a multisig to change the minting rate per second? @audit-note should the token have an emission rate?
        //@Todo Can a multisig wallet by an automated script?
        //@Todo Ability to add an address to the rate adjuster role?
        _grantRole(MINTER_MAKER, msg.sender);  // @audit completely useless roles assignement.
        _setRoleAdmin(DEFAULT_ADMIN_ROLE, MINTER_MAKER);
        _setRoleAdmin(MINTER, MINTER_MAKER);
        _grantRole(MINTER, msg.sender);
    }

    // @TODO Check this function to guarantee enough tokens to the stakers.
    function mint(uint256 amount) 
        public 
        onlyRole(MINTER)
        returns (bool) 
    {
        // @Todo Aggregar role rate adjuster.
        _mint(msg.sender, amount);
        return true;
    }
}

