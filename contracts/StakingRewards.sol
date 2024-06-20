//SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";  
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol"; 
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol"; 
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract StakingRewards is UUPSUpgradeable, AccessControlUpgradeable {
    
    using SafeERC20 for IERC20;

    struct WithdrawalRequest {
        uint256 amount;
        uint256 time;
    }


    struct PendingRequest { 
        uint256 timeToWait;
        uint256 newValue;
    }

    /* ========== STATE VARIABLES ========== */

    // Precision factor for decimal calculations
    uint256 public constant DECIMAL_PRECISION =  1e18;

    uint256 public constant MAX_TOKEN_REWARD_RATE = 1e6; // @todo client needs to decide and set it here

    uint256 public constant MAX_PENALTY_DAYS = 90;

    uint256 public constant MIN_WITHDRAW_WAIT_TIME = 1 days;

    uint256 public constant MAX_WITHDRAW_WAIT_TIME = 10 days;

    // Time the owner has to wait in order to apply the new penalty days
    uint256 public constant PENALTY_DAYS_TIMELOCK = 5 days; // TODO added 5 days check with client

    // Time avilable for the owner to apply the new penalty days value after the timelock has passed
    uint256 public constant PENALTY_DAYS_TIMELOCK_BUFFER = 5 days; // TODO added 5 days check with client

    // Time the owner has to wait in order to apply the new withdrawal time
    uint256 public constant WITHDRAWAL_WAIT_TIMELOCK = MAX_WITHDRAW_WAIT_TIME * 2; // TODO check with client

    // Time avilable for the owner to apply the new withdrawal time value after the timelock has passed
    uint256 public constant WITHDRAWAL_WAIT_TIMELOCK_BUFFER = 5 days; // TODO added 5 days check with client

    /* -------- Access Control -------- */

    bytes32 public constant PARAMS_SETTER_ROLE = keccak256("PARAMS_SETTER_ROLE");

    bytes32 public constant REWARDS_DITRIBUTOR_ROLE = keccak256("REWARDS_DITRIBUTOR_ROLE");

    // Timelock request to update the withdrawal wait time
    PendingRequest public withdrawalWaitTimeRequest; 

    // Timelock request to update the penalty days amount
    PendingRequest public penaltyDaysRequest; 
 
    // Token to be staked
    IERC20 public spotToken; 

    // Reward token
    IERC20 public usdtToken;

    // Address to collect penalty fees
    address public penaltyFeesCollector; 
    
    // Total amount of staked tokens
    uint256 private totalStakedTokens;

    /* -------- Revenue -------- */
    // Revenue rewards to airdrop every second. Derived from amount and time
    uint256 public revenueRewardPerSecond; 

    // Unix timestamp indicating the marker in current reward period OR the end of the current reward period
    uint256 public lastTimeRevenueRewardUpdated;

    // Unix timestamp for when the current revenue reward period ends
    // It is defaulted to the current block timestamp when the contract is initiated
    uint256 public revenueRewardPeriodEndTime; 

    // Total amount of accrued rewards PER STAKED TOKEN
    uint256 public revenueRewardOdometer; 

    // All the revenue reward added to the contract
    uint256 public allRevenueRewardIn;

    // All revenue reward but only for the users that have executed the contract. i.e. updateRewards(address)
    uint256 public allRevenueRewardOut;

    // Total amount of accrued user revenue rewards PER STAKED TOKEN
    mapping(address user => uint256 revenureRewardOdometer) public userRevenueRewardOdometer;
    
    // Total amount of accrued user rewards
    mapping(address user => uint256 totalRewards) public allUserRewards;
    
    // Revenue rewards to be paid out since the last payout
    mapping(address user => uint256 payout) public revenueRewardsToPayout;

    /* -------- Tokens -------- */

    // Amount of undistributed rewards in the contract
    uint256 public tokenRewardBalance;

    // Timestamp of the last time the token rewards were updated
    uint256 public lastTimeTokenRewardUpdated;

    // Total amount of accrued rewards PER STAKED TOKEN
    uint256 public tokenRewardOdometer;

    // Total spotToken that has been allocated for stakers. This includes spotToken that has been 
    // deposited and distributed AND the earned spotToken that has not been claimed yet
    uint256 public allEarnedTokenReward;

    // Total token rewards that has been transferred to stakers
    uint256 public allTokenRewardPaid;

    // Amount of spotToken tokens to be globally distributed per second
    uint256 public tokenRewardPerSecond;

    // Total amount of accrued user token rewards PER STAKED TOKEN
    mapping(address user => uint256 tokenRewardOdometer) public userTokenRewardOdometer;

    // New user rewards to be paid out since the last payout.
    mapping(address user => uint256 payout) public tokenRewardsToPayout;

    // Timestamp of the time the user staked
    mapping(address user => uint256 timestamp) public userStakingTimestamp;

    // User withdrawal requests
    mapping(address user => WithdrawalRequest) public readyToWithdraw;

    // User staked amounts
    mapping(address user => uint256 balance) private balances;

    // Time to wait to withdraw the staked amounts
    uint256 public withdrawWaitTime;

    // Penalty fees collected by the contract
    uint256 public penaltyFeesCollected;

    // Amount of days the user has to wait to withdraw without penalty
    uint256 public penaltyDays;

    // block production time in seconds, e.g. 12 on eth mainnet
    uint256 public blockTimeLenght; 

    /* ========== EVENTS ========== */

    event LogRevenueRewardAdded(uint256 reward, uint256 rewardsDuration);
    event LogStaked(address indexed user, uint256 amount);
    event LogWithdrawn(address indexed user, uint256 amountToWithdraw, uint256 penaltyAmount);
    event LogWithdrawRequested(address indexed user, uint256 amount);
    event LogRewardPaid(address indexed user, uint256 revenueReward, uint256 tokenReward);
    event LogPenaltiesWithdrawn(address indexed user, uint256 penaltyFeesCollected);
    event LogPenaltyDaysUpdated(uint256 _days);
    event LogAddTokenReward(uint256 amount);
    event LogWithdrawWaitTimeUpdated(uint256 time);
    event LogTokenRewardRateUpdated(uint256 rate);
    event LogWithdrawalCancelled(address indexed user, uint256 amount);
    event LogPenaltyDaysRequested(uint256 _days);
    event LogWithdrawWaitTimeRequested(uint256 _timeInSeconds);
    event LogUnallocatedStakeTokenRewardsWithdrawn(uint256 amount);


    /* ========== ERRORS ========== */

    error StakingRewards__NoZeroAddress();
    error StakingRewards__NoZeroAmount();
    error StakingRewards__NotEnoughBalance();
    error StakingRewards__WithdrawRequestPending();
    error StakingRewards__NoWithdrawRequestPending();
    error StakingRewards__NoAmountAvailable();
    error StakingRewards__WithdrawWaitTimeNotReached();
    error StakingRewards__NoPenaltyFeeToCollect();
    error StakingRewards__PenaltyDaysTooHigh();
    error StakingRewards__WaitTimeLessThanOneDay();
    error StakingRewards__WaitTimeMoreThanTenDays();
    error StakingRewards__RewardRateExceedsMaxRate();
    error StakingRewars__PenaltyDaysTimelock();
    error StakingRewards__WithdrawalWaitTimeTimelock();
    error StakingRewards__SameAmountOfDays();
    error StakingRewards__SameAmountOfSeconds();
    error StakingRewards__NoActiveRequest();
    error StakingRewards__TimelockBufferExceeded();
    error StakingRewards__NoZeroRewardDuration();


    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }   

    /**
    * @dev Initializes the contract with the given parameters.
    * @param _penaltyFeesCollector The address that will collect penalty fees.
    * @param _spotTokenAddress The address of the spotToken token contract.
    * @param _usdtToken The address of the usdtToken token contract.
    * @param _paramsSetter The address which controls the setting of resctricted parameters.
    * @param _rewardsDistributor The address in charge of setting rewards.
    * @param _blockProductionTime The time it takes to produce a block.
    *
    * Requirements:
    * - `_penaltyFeesCollector`, `_spotTokenAddress`, `_usdtToken`, `_paramsSetter` and `_rewardsDistributor` cannot be the zero address.
    */
    function initialize(
        address _penaltyFeesCollector, 
        address _spotTokenAddress,
        address _usdtToken,
        address _paramsSetter,
        address _rewardsDistributor,
        uint256 _blockProductionTime // can be zero
    )
        public
        initializer
    {

        if(_penaltyFeesCollector == address(0) || _spotTokenAddress == address(0) || _usdtToken == address(0) || _paramsSetter == address(0) || _rewardsDistributor == address(0) ) revert StakingRewards__NoZeroAddress();

        __UUPSUpgradeable_init();
        __AccessControl_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(PARAMS_SETTER_ROLE, _paramsSetter);
        _grantRole(REWARDS_DITRIBUTOR_ROLE, _rewardsDistributor);

        spotToken = IERC20(_spotTokenAddress);
        usdtToken = IERC20(_usdtToken);
        
        penaltyFeesCollector = _penaltyFeesCollector;
        revenueRewardPeriodEndTime = block.timestamp;
        lastTimeRevenueRewardUpdated = block.timestamp;
        lastTimeTokenRewardUpdated = block.timestamp;
        blockTimeLenght = _blockProductionTime;


        withdrawWaitTime = MAX_WITHDRAW_WAIT_TIME;  
    }

    //////////////////////////////////////////////////////////////////////////////
    // =========================== EXTERNAL FUNCTIONS ===========================
    //////////////////////////////////////////////////////////////////////////////



    // **********************  MUTATIVE FUNCTIONS **********************

    /**
    * @dev Allows a user to stake a certain amount of tokens.
    * @param amount The amount of tokens to stake.
    *
    * Emits a {LogStaked} event indicating the address of the staker and the amount staked.
    *
    * Requirements:
    * - `amount` must be greater than 0.
    * - The sender must have at least `amount` tokens to stake.
    */
    function stake(uint256 amount) external  {

        if(amount <= 0) revert StakingRewards__NoZeroAmount();
        
        _updateRevenueReward(msg.sender);
        _updateTokenReward(msg.sender);

        totalStakedTokens += amount;
        balances[msg.sender] += amount;
        
        userStakingTimestamp[msg.sender] = block.timestamp;

        spotToken.safeTransferFrom(msg.sender, address(this), amount);

        emit LogStaked(msg.sender, amount);
    }

    /**
    * @dev Submits a request from the staker to withdraw a certain amount from their staked balance.
    * @param amount The amount of tokens the staker wants to withdraw.
    *
    * The user can withdraw the amount specified anytime after the request wait time is over.
    *
    * Emits a {LogWithdrawRequested} event indicating the address of the staker and the amount requested for withdrawal.
    *
    * Requirements:
    * - `amount` must be greater than 0.
    * - The staker must have at least `amount` tokens staked.
    * - The staker must not have a pending withdrawal request.
    */
    function requestToWithdraw(uint256 amount) external  { 

        if(amount <= 0) revert StakingRewards__NoZeroAmount();
        //If a user makes a request to withdraw the entire balance it reverts here
        if(amount > balances[msg.sender]) revert StakingRewards__NotEnoughBalance();

        //Make sure a request is not pending. both amount and time need to be zero.
        if(readyToWithdraw[msg.sender].amount != 0) revert StakingRewards__WithdrawRequestPending();

        _updateRevenueReward(msg.sender); 
        _updateTokenReward(msg.sender); 

        balances[msg.sender] -= amount;
        totalStakedTokens -= amount;

        readyToWithdraw[msg.sender] = WithdrawalRequest(amount, block.timestamp + withdrawWaitTime);
        
        emit LogWithdrawRequested(msg.sender, amount);
    }

    /**
    * @dev Cancels the pending withdrawal request of the staker.
    *
    * Emits a {LogWithdrawCancelled} event indicating the address of the staker and the amount that was requested for withdrawal.
    *
    * Requirements:
    * - The staker must have a pending withdrawal request.
    */
    function cancelWithdraw() external  { 

        uint256 amountToWithdraw = readyToWithdraw[msg.sender].amount; 

        if(amountToWithdraw == 0) revert StakingRewards__NoWithdrawRequestPending();

        balances[msg.sender] += amountToWithdraw;
        totalStakedTokens += amountToWithdraw;

        delete readyToWithdraw[msg.sender];

        emit LogWithdrawalCancelled(msg.sender, amountToWithdraw); 
        
    }

    /**
    * @dev Allows the staker to withdraw their staked tokens after the withdrawal wait time has passed.
    *
    * If the staker withdraws before the penalty days have passed, a penalty is deducted from the withdrawal amount.
    * The penalty is added to the penalty fees collected by the contract.
    *
    * Emits a {LogWithdrawn} event indicating the address of the staker, the amount withdrawn, and the penalty amount.
    *
    * Requirements:
    * - The staker must have a pending withdrawal request.
    * - The withdrawal wait time must have passed.
    */
    function withdraw() external  {
        WithdrawalRequest memory _withdrawalRequest = readyToWithdraw[msg.sender];

        if(_withdrawalRequest.amount <= 0) revert StakingRewards__NoAmountAvailable();
        if(_withdrawalRequest.time > block.timestamp) revert StakingRewards__WithdrawWaitTimeNotReached();

        _updateRevenueReward(msg.sender);
        _updateTokenReward(msg.sender);
        
        uint256 secondsSinceStaking = block.timestamp - userStakingTimestamp[msg.sender];
        uint256 daysSinceStaking = secondsSinceStaking / 1 days;
        uint256 penaltyAmount;


        if (daysSinceStaking < penaltyDays) {
            penaltyAmount = (_withdrawalRequest.amount * (penaltyDays - daysSinceStaking)) / 100;
            _withdrawalRequest.amount -= penaltyAmount;
            penaltyFeesCollected += penaltyAmount; 
        }
        
        readyToWithdraw[msg.sender].amount = 0;
        readyToWithdraw[msg.sender].time = 0;

        spotToken.safeTransfer(msg.sender, _withdrawalRequest.amount);

        emit LogWithdrawn(msg.sender, _withdrawalRequest.amount, penaltyAmount);
    }

    /**
    * @dev Allows the staker to claim their accrued rewards.
    *
    * The function updates the revenue and token rewards counters for the staker, and then transfers the rewards to the staker.
    * The rewards include both the revenue rewards and the token rewards.
    *
    * Emits a {LogRewardPaid} event indicating the address of the staker, the revenue rewards paid, and the token rewards paid.
    *
    * Requirements:
    * - The staker must have accrued rewards.
    */
    function getReward() external  {

        _updateRevenueReward(msg.sender);
        _updateTokenReward(msg.sender);
        
        uint256 _userRevenueRewardToPayout = revenueRewardsToPayout[msg.sender];
        
        if (_userRevenueRewardToPayout > 0) {
            allRevenueRewardOut += _userRevenueRewardToPayout; 
            
            allUserRewards[msg.sender] += _userRevenueRewardToPayout; 
            revenueRewardsToPayout[msg.sender] = 0;
        }

        uint256 _userTokenRewardsToPayout = tokenRewardsToPayout[msg.sender];
        
        if (_userTokenRewardsToPayout > 0) {
            allTokenRewardPaid += _userTokenRewardsToPayout;
            allUserRewards[msg.sender] += _userTokenRewardsToPayout;
            tokenRewardsToPayout[msg.sender] = 0;
            tokenRewardBalance -= _userTokenRewardsToPayout;
        }
        uint256 totalReward = _userRevenueRewardToPayout + _userTokenRewardsToPayout;
        if (totalReward > 0){
            usdtToken.safeTransfer(msg.sender, totalReward);
        }
            

        emit LogRewardPaid(msg.sender, _userRevenueRewardToPayout, _userTokenRewardsToPayout);
    }

    //************************* RESTRICTED FUNCTIONS **************************** 
    
    /**
    * @dev Applies the pending request to change the penalty days.
    *
    * The function can only be called by the PARAMS_SETTER_ROLE role.
    * The function checks if there is a pending request, if the time to wait has passed, and if the time to wait plus the buffer has not been exceeded.
    * If all checks pass, the penalty days are updated to the new days in the request, and the request is deleted.
    *
    * Emits a {LogPenaltyDaysUpdated} event indicating the new penalty days.
    *
    * Requirements:
    * - There must be a pending request to change the penalty days.
    * - The time to wait in the request must have passed.
    * - The time to wait in the request plus the buffer must not have been exceeded.
    */
    function applyPenaltyDaysRequest() external onlyRole(PARAMS_SETTER_ROLE) { 

        PendingRequest memory _penaltyDaysRequest = penaltyDaysRequest;

        if(_penaltyDaysRequest.timeToWait <= 0) revert StakingRewards__NoActiveRequest();
        if(_penaltyDaysRequest.timeToWait > block.timestamp) revert StakingRewars__PenaltyDaysTimelock();
        if(block.timestamp > _penaltyDaysRequest.timeToWait + PENALTY_DAYS_TIMELOCK_BUFFER) revert StakingRewards__TimelockBufferExceeded();

        penaltyDays = _penaltyDaysRequest.newValue;

        delete penaltyDaysRequest; 

        emit LogPenaltyDaysUpdated(_penaltyDaysRequest.newValue);

    }

    /**
    * @dev Submits a request to change the penalty days.
    * @param _days The new number of penalty days.
    *
    * The function can only be called by the PARAMS_SETTER_ROLE role.
    * The function checks if the new days are not the same as the current days, and if the new days do not exceed the maximum penalty days.
    * If all checks pass, a request is created with the new days and the time to wait.
    *
    * Emits a {LogPenaltyDaysRequested} event indicating the new penalty days requested.
    *
    * Requirements:
    * - The caller must be the PARAMS_SETTER_ROLE role.
    * - `_days` must not be the same as the current penalty days.
    * - `_days` must not exceed the maximum penalty days.
    */
    function requestToSetPenaltyDays(uint256 _days) external onlyRole(PARAMS_SETTER_ROLE) { 

        if(_days >= MAX_PENALTY_DAYS) revert StakingRewards__PenaltyDaysTooHigh();
        
        // skip timelock if new value is better for the users
        if(_days < penaltyDays){ 
            penaltyDays = _days;
            delete penaltyDaysRequest; // to make sure no concurrent request stays active
            return;
        }

        PendingRequest memory _penaltyDaysRequest = penaltyDaysRequest;

        // _days = 0 is covered by the previous if, won't have a timelock
        if(_penaltyDaysRequest.newValue == _days) revert StakingRewards__SameAmountOfDays(); 

        _penaltyDaysRequest.timeToWait = block.timestamp + PENALTY_DAYS_TIMELOCK;

        _penaltyDaysRequest.newValue = _days;

        penaltyDaysRequest = _penaltyDaysRequest;

        emit LogPenaltyDaysRequested(_days); 

    }

    /**
    * @dev Applies the pending request to change the withdrawal wait time.
    *
    * The function can only be called by the PARAMS_SETTER_ROLE role.
    * The function checks if there is a pending request, if the time to wait has passed, and if the time to wait plus the buffer has not been exceeded.
    * If all checks pass, the withdrawal wait time is updated to the new time in the request, and the request is deleted.
    *
    * Emits a {LogWithdrawWaitTimeUpdated} event indicating the new withdrawal wait time.
    *
    * Requirements:
    * - There must be a pending request to change the withdrawal wait time.
    * - The time to wait in the request must have passed.
    * - The time to wait in the request plus the buffer must not have been exceeded.
    */
    function applyWithdrawWaitTimeRequest() external onlyRole(PARAMS_SETTER_ROLE) {

        PendingRequest memory _withdrawalWaitTimeRequest = withdrawalWaitTimeRequest;

        if(_withdrawalWaitTimeRequest.timeToWait <= 0) revert StakingRewards__NoActiveRequest();
        if(_withdrawalWaitTimeRequest.timeToWait > block.timestamp) revert StakingRewards__WithdrawalWaitTimeTimelock();


        if(block.timestamp > _withdrawalWaitTimeRequest.timeToWait + WITHDRAWAL_WAIT_TIMELOCK_BUFFER) revert StakingRewards__TimelockBufferExceeded(); 

        withdrawWaitTime = _withdrawalWaitTimeRequest.newValue;

        delete withdrawalWaitTimeRequest;

        emit LogWithdrawWaitTimeUpdated(_withdrawalWaitTimeRequest.newValue);

    }

    /**
    * @dev Submits a request to change the withdrawal wait time.
    * @param _newTimeInSeconds The new withdrawal wait time in seconds.
    *
    * The function can only be called by the rewards distribution address.
    * The function checks if the new time is not the same as the current time, and if the new time does not exceed the maximum withdrawal wait time.
    * If all checks pass, a request is created with the new time and the time to wait.
    *
    * Emits a {LogWithdrawWaitTimeRequested} event indicating the new withdrawal wait time requested.
    *
    * Requirements:
    * - The caller must be the PARAMS_SETTER_ROLE role.
    * - `_newTimeInSeconds` must not be the same as the current withdrawal wait time.
    * - `_newTimeInSeconds` must not exceed the maximum withdrawal wait time.
    */
    function requestToSetWithdrawWaitTime(uint256 _newTimeInSeconds) external onlyRole(PARAMS_SETTER_ROLE) { 

        if(_newTimeInSeconds < MIN_WITHDRAW_WAIT_TIME) revert StakingRewards__WaitTimeLessThanOneDay();
        if(_newTimeInSeconds > MAX_WITHDRAW_WAIT_TIME) revert StakingRewards__WaitTimeMoreThanTenDays();

        // skip timelock if new value is better for the users
        if(_newTimeInSeconds < withdrawWaitTime){ 
            withdrawWaitTime = _newTimeInSeconds;
            delete withdrawalWaitTimeRequest; // to make sure no concurrent request stays active
            return;
        }

        PendingRequest memory _withdrawalWaitTimeRequest = withdrawalWaitTimeRequest;

        if(_withdrawalWaitTimeRequest.newValue == _newTimeInSeconds) revert StakingRewards__SameAmountOfSeconds();

        _withdrawalWaitTimeRequest.timeToWait = block.timestamp + WITHDRAWAL_WAIT_TIMELOCK;

        _withdrawalWaitTimeRequest.newValue = _newTimeInSeconds;

        withdrawalWaitTimeRequest = _withdrawalWaitTimeRequest;


        emit LogWithdrawWaitTimeRequested(_newTimeInSeconds);

    }
    
    /**
    * @dev Adds token rewards to the contract.
    * @param _amount The amount of tokens to add as rewards.
    *
    * The function can only be called by the REWARDS_DITRIBUTOR_ROLE role.
    * The function transfers the tokens from the rewards distribution address to this contract, and updates the token reward balance.
    *
    * Emits a {LogRewardAdded} event indicating the amount of tokens added as rewards.
    *
    * Requirements:
    * - The caller must have the REWARDS_DITRIBUTOR_ROLE role.
    * - `_amount` must be greater than 0.
    * - The rewards distribution address must have at least `_amount` tokens.
    */
    function addTokenReward(uint256 _amount) external onlyRole(REWARDS_DITRIBUTOR_ROLE) {
        if(_amount <= 0) revert StakingRewards__NoZeroAmount();
        tokenRewardBalance += _amount; 
        usdtToken.safeTransferFrom(msg.sender, address(this), _amount);
        emit LogAddTokenReward(_amount);
    }
    
    /**
    * @dev Adds revenue rewards to the contract.
    * @param _amount The amount of revenue to add as rewards.
    * @param _rewardsDuration The duration over which the rewards should be distributed.
    *
    * The function can only be called by the REWARDS_DITRIBUTOR_ROLE role.
    * The function updates the revenue reward, calculates the new revenue reward per second, and transfers the revenue from the rewards distribution address to this contract.
    *
    * Emits a {LogRevenueRewardAdded} event indicating the amount of revenue added as rewards and the duration over which the rewards should be distributed.
    *
    * Requirements:
    * - The caller must have the REWARDS_DITRIBUTOR_ROLE role.
    * - `_amount` must be greater than 0.
    * - The rewards distribution address must have at least `_amount` of revenue.
    */
    function addRevenueReward(uint256 _amount, uint256 _rewardsDuration) external onlyRole(REWARDS_DITRIBUTOR_ROLE) {

        if(_amount <= 0) revert StakingRewards__NoZeroAmount();
        if(_rewardsDuration <= 0) revert StakingRewards__NoZeroRewardDuration();

        _updateRevenueReward(address(0));

        if (block.timestamp >= revenueRewardPeriodEndTime) { 
            revenueRewardPerSecond = (_amount * DECIMAL_PRECISION) / _rewardsDuration;
        } else {
            uint256 _remainingDuration = revenueRewardPeriodEndTime - block.timestamp;
            uint256 _remainingReward = (_remainingDuration * revenueRewardPerSecond) / DECIMAL_PRECISION;
            revenueRewardPerSecond = ((_amount + _remainingReward) * DECIMAL_PRECISION) / _rewardsDuration;
        }
        
        allRevenueRewardIn += _amount;


        revenueRewardPeriodEndTime = block.timestamp + _rewardsDuration - blockTimeLenght; // buffer block duration to avoid overflow to next block

        usdtToken.safeTransferFrom(msg.sender, address(this), _amount);

        emit LogRevenueRewardAdded(_amount, _rewardsDuration);
    }

    /**
    * @dev Sets the rate of token rewards per second.
    * @param _tokenRewardRate The new rate of token rewards per second.
    *
    * The function can only be called by the REWARDS_DITRIBUTOR_ROLE role.
    * The function checks if the new rate does not exceed the maximum token reward rate.
    * If the check passes, the token rewards are updated and the token reward rate is set to the new rate.
    *
    * Emits a {LogTokenRewardRateUpdated} event indicating the new rate of token rewards per second.
    *
    * Requirements:
    * - The caller must have the REWARDS_DITRIBUTOR_ROLE role.
    * - `_tokenRewardRate` must not exceed the maximum token reward rate.
    */
    function setTokenRewardRate(uint256 _tokenRewardRate) external onlyRole(REWARDS_DITRIBUTOR_ROLE) {
        if(_tokenRewardRate > MAX_TOKEN_REWARD_RATE) revert StakingRewards__RewardRateExceedsMaxRate();
        _updateTokenReward(address(0));
        tokenRewardPerSecond = _tokenRewardRate;
        emit LogTokenRewardRateUpdated(_tokenRewardRate);
    }

    /**
    * @dev Allows the contract owner to withdraw all penalty fees collected by the contract.
    *
    * Emits a {LogPenaltyFeesCollectedWithdrawn} event indicating the address of the contract owner and the amount of penalty fees withdrawn.
    *
    * Requirements:
    * - The caller must have the REWARDS_DITRIBUTOR_ROLE role.
    * - There must be penalty fees collected by the contract.
    */
    function withdrawAllPenaltyFeesCollected() external onlyRole(REWARDS_DITRIBUTOR_ROLE) { 
        uint256 _penaltyFeesCollected = penaltyFeesCollected;
        if(_penaltyFeesCollected <= 0) revert StakingRewards__NoPenaltyFeeToCollect();

        address _penaltyFeesCollector = penaltyFeesCollector;

        penaltyFeesCollected = 0;

        spotToken.safeTransfer(_penaltyFeesCollector, _penaltyFeesCollected);

        emit LogPenaltiesWithdrawn(_penaltyFeesCollector, _penaltyFeesCollected);
    }


    /**
    * @dev Withdraws the unallocated staking token rewards.
    *
    * Emits a {LogUnallocatedStakeTokenRewardsWithdrawn} event indicating the amount of tokens transferred to the rewards distributor.
    *
    * Requirements:
    * - The caller must have the REWARDS_DITRIBUTOR_ROLE role.
    * - There must be available tokens to reward.
    */
    function withdrawUnallocatedStakingTokenRewards() external onlyRole(REWARDS_DITRIBUTOR_ROLE) {
        _updateTokenReward(address(0));

        uint256 remainingTokenRewardToReward = allEarnedTokenReward - allTokenRewardPaid;
        uint256 availablespotTokenReward = tokenRewardBalance - remainingTokenRewardToReward;

        if(availablespotTokenReward <= 0) revert StakingRewards__NoAmountAvailable();

        tokenRewardBalance = remainingTokenRewardToReward;

        usdtToken.safeTransfer(msg.sender, availablespotTokenReward); 

        emit LogUnallocatedStakeTokenRewardsWithdrawn(availablespotTokenReward);
    }


    //********************** VIEWS **********************

    function getWithdrawAvailableTime() external view returns (uint256) {
        return readyToWithdraw[msg.sender].time;
    }

    function getWithdrawRequestedAmount() external view returns (uint256) {
        return readyToWithdraw[msg.sender].amount;
    }

    
    function balanceOf(address _account) external view returns (uint256) {
        return balances[_account];
    }

    function getRevenueRewardsPerSecond() external view returns (uint256) { 
        return revenueRewardPerSecond;
    }


    //////////////////////////////////////////////////////////////////////////////
    // ================== PUBLIC FUNCTIONS ======================================
    //////////////////////////////////////////////////////////////////////////////
    
    // ************************** VIEWS **************************

    function lastTimeRevenueRewardApplicable(uint256 _periodFinish) public view returns (uint256) {
        return Math.min(block.timestamp, _periodFinish);
    }

    function getTotalStakedTokens() public view returns (uint256) {
        return totalStakedTokens;
    }

    /**
    * @dev Calculates the token reward for a user for the current period.
    * @param _tokenRewardOdometer The total amount of accrued rewards per staked token.
    * @param _account The address of the user.
    * @return The token reward for the user for the current period.
    *
    * Note: No reward will be given if all the tokens have been already reserved. This happens when `_tokenRewardOdometer` and `userTokenRewardOdometer[_account]` have the same value.
    */
    function calculateUserTokenRewardForCurrentPeriod(
        uint256 _tokenRewardOdometer,
        address _account
    )
        public
        view
        returns (uint256)
    {
        
        uint256 _userTokenRewardOdometer =  userTokenRewardOdometer[_account];
        uint256 userBalance = balances[_account];
        uint256 rewardPerStakeDiff = _tokenRewardOdometer - _userTokenRewardOdometer;

        return userBalance * rewardPerStakeDiff / DECIMAL_PRECISION;
    }

    /**
    * @dev Calculates the total token rewards earned since the last time the token rewards were updated.
    * @return The total token rewards earned since the last time the token rewards were updated.
    */
    function calculateTotalTokenRewardsEarnedSinceLastTimeUpdated()
    public
    view
    returns (uint256)
    {
        // There is no rewards if no one is staking
        if(getTotalStakedTokens() == 0){
            return 0;
        }
        uint256 durationSinceLastTimeTokenRewardUpdated = block.timestamp - lastTimeTokenRewardUpdated;
        uint256 tokenRewardsEarnedSinceLastTimeRewardUpdated = durationSinceLastTimeTokenRewardUpdated * tokenRewardPerSecond;
        return tokenRewardsEarnedSinceLastTimeRewardUpdated;
    }


    //////////////////////////////////////////////////////////////////////////////
    // ========================= INTERNAL FUNCTIONS =============================
    //////////////////////////////////////////////////////////////////////////////

    // **********************  MUTATIVE FUNCTIONS **********************

    /**
    * @dev Updates the revenue reward for a user.
    * @param _account The address of the user.
    */
    function _updateRevenueReward(address _account) internal  {
        uint256 lastTimeRevenueRewardApplicable_ = lastTimeRevenueRewardApplicable(revenueRewardPeriodEndTime); 
        uint256 updatedRevenueRewardOdometer = 
            _calculateNewRevenueRewardOdometerAmount(lastTimeRevenueRewardApplicable_);
        
        if (_account != address(0)) {
            uint256 updatedRevenuePayout = _calculateNewUserRevenueRewardToPayout(
                updatedRevenueRewardOdometer,
                _account
            ); 
            
            userRevenueRewardOdometer[_account] = updatedRevenueRewardOdometer;
            revenueRewardsToPayout[_account] = updatedRevenuePayout;
        }

        revenueRewardOdometer = updatedRevenueRewardOdometer;
        lastTimeRevenueRewardUpdated = block.timestamp;
    }

    /**
    * @dev Updates the token reward for a user.
    * @param _account The address of the user.
    */
    function _updateTokenReward(address _account) internal  {     
        uint256 remainingTokenRewardToReward = allEarnedTokenReward - allTokenRewardPaid;
        uint256 availablespotTokenToReward = tokenRewardBalance - remainingTokenRewardToReward;

        uint256 totalTokenRewardsEarnedSinceLastTimeUpdated;
        uint256 _totalTokenRewardsEarnedSinceLastTimeUpdated = calculateTotalTokenRewardsEarnedSinceLastTimeUpdated();
        // adjust according to the available rewards
        totalTokenRewardsEarnedSinceLastTimeUpdated = _totalTokenRewardsEarnedSinceLastTimeUpdated > availablespotTokenToReward ?
            availablespotTokenToReward : _totalTokenRewardsEarnedSinceLastTimeUpdated;
        
        allEarnedTokenReward += totalTokenRewardsEarnedSinceLastTimeUpdated;

        uint256 updatedTokenRewardOdometer = _calculateNewTokenRewardOdometerAmount(
            availablespotTokenToReward,
            totalTokenRewardsEarnedSinceLastTimeUpdated
        );
        
        if (_account != address(0)) {
            uint256 updatedTokenPayout = tokenRewardsToPayout[_account] + calculateUserTokenRewardForCurrentPeriod(
                updatedTokenRewardOdometer,
                _account
            );
            
            userTokenRewardOdometer[_account] = updatedTokenRewardOdometer;
            tokenRewardsToPayout[_account] = updatedTokenPayout;
        }
        tokenRewardOdometer = updatedTokenRewardOdometer;

        // update the last time the token rewards were updated
        // if the contract doesn't hold enough rewards to be distributed, the updated time is adjusted proportionally, so that it matches the time when the rewards did run out
        if(_totalTokenRewardsEarnedSinceLastTimeUpdated > availablespotTokenToReward){

            uint256 _lastTimeTokenRewardUpdated = lastTimeTokenRewardUpdated;
            uint256 elapsedSinceLastTime = block.timestamp - _lastTimeTokenRewardUpdated;
            uint256 adjustedTime = elapsedSinceLastTime * availablespotTokenToReward / _totalTokenRewardsEarnedSinceLastTimeUpdated;

            lastTimeTokenRewardUpdated = _lastTimeTokenRewardUpdated + adjustedTime;
        } else{
            lastTimeTokenRewardUpdated = block.timestamp;
        }
        
    }

    /**
    * @dev Authorizes an upgrade of the contract.
    * @param newImplementation The address of the new contract implementation.
    *
    * The function can only be called by the REWARDS_DITRIBUTOR_ROLE role.
    * The function sets the address of the new contract implementation.
    *
    * Emits an {UpgradeAuthorized} event indicating the address of the new contract implementation.
    *
    * Requirements:
    * - The caller must have the REWARDS_DITRIBUTOR_ROLE role.
    */
    function _authorizeUpgrade(address newImplementation) internal override onlyRole(DEFAULT_ADMIN_ROLE) { 
    }


    // ************************** VIEWS **************************
   
    /**
    * @dev Calculates the new revenue reward odometer amount.
    * @param _lastTimeRevenueRewardApplicable The last time the revenue reward is applicable.
    * @return The new revenue reward odometer amount.
    */
    function _calculateNewRevenueRewardOdometerAmount(
        uint256 _lastTimeRevenueRewardApplicable
        )
        internal
        view
        returns (uint256)
    {
        uint256 _stakedTokens = getTotalStakedTokens();

        if (_stakedTokens == 0 || lastTimeRevenueRewardUpdated >= _lastTimeRevenueRewardApplicable) {
            return revenueRewardOdometer;
        }
        // durationSinceLastTimeRewardUpdated are the seconds between the last time the rewards were updated and the
        // end of the reward period. (or if the period hasn't ended then the current block time)
        
        uint256 durationSinceLastTimeRewardUpdated = _lastTimeRevenueRewardApplicable - lastTimeRevenueRewardUpdated;
        uint256 rewardsEarnedSinceLastTimeRewardUpdated = (durationSinceLastTimeRewardUpdated * revenueRewardPerSecond) / DECIMAL_PRECISION;
        uint256 newRewardsEarnedPerToken = (rewardsEarnedSinceLastTimeRewardUpdated * DECIMAL_PRECISION) / _stakedTokens;
        
        return revenueRewardOdometer + newRewardsEarnedPerToken;
    }

    /**
    * @dev Calculates the new token reward odometer amount.
    * @param _availablespotTokenToReward The amount of tokens available for rewards.
    * @param _totalTokenRewardsEarnedSinceLastTimeUpdated The total token rewards earned since the last time the token rewards were updated.
    * @return The new token reward odometer amount.
    */
    function _calculateNewTokenRewardOdometerAmount(
        uint256 _availablespotTokenToReward,
        uint256 _totalTokenRewardsEarnedSinceLastTimeUpdated
    )
        internal
        view
        returns (uint256)
    {
        uint256 _stakedTokens = getTotalStakedTokens();
        
        if (_stakedTokens == 0){
            return tokenRewardOdometer;
        }
        // If all the spotToken has been allocated then the odometer stops increasing. (i.e rewards/staked reaches the max  )
        if(_availablespotTokenToReward == 0){
            return tokenRewardOdometer;
        }
        
        uint256 newRewardEarnedPerStake = _totalTokenRewardsEarnedSinceLastTimeUpdated * DECIMAL_PRECISION / _stakedTokens; 
        return tokenRewardOdometer + newRewardEarnedPerStake;
    }

    /**
    * @dev Calculates the new revenue reward to payout for a user.
    * @param _revenueRewardOdometer The total amount of accrued rewards per staked token.
    * @param _account The address of the user.
    * @return The new revenue reward to payout for the user.
    */
    function _calculateNewUserRevenueRewardToPayout(
        uint256 _revenueRewardOdometer, //updated
        address _account
    )
        internal 
        view
        returns (uint256)
    {
        uint256 _userRevenueRewardOdometer = userRevenueRewardOdometer[_account];
        uint256 _userRevenueRewardToPayout = revenueRewardsToPayout[_account];
        uint256 _userBalance = balances[_account];
        
        uint256 rewardPerStakeDiff = _revenueRewardOdometer - _userRevenueRewardOdometer;
        
        return (_userBalance * rewardPerStakeDiff / DECIMAL_PRECISION) + _userRevenueRewardToPayout;
    }


}
