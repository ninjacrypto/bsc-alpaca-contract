// SPDX-License-Identifier: MIT
/**
  ∩~~~~∩ 
  ξ ･×･ ξ 
  ξ　~　ξ 
  ξ　　 ξ 
  ξ　　 “~～~～〇 
  ξ　　　　　　 ξ 
  ξ ξ ξ~～~ξ ξ ξ 
　 ξ_ξξ_ξ　ξ_ξξ_ξ
Alpaca Fin Corporation
**/

pragma solidity 0.8.10;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import "./interfaces/IERC20.sol";
import "./interfaces/IFairLaunch.sol";
import "./interfaces/IProxyToken.sol";
import "./interfaces/IAnyswapV4Router.sol";

import "../utils/SafeToken.sol";

/// @title FairLaunchRelayer
contract FairLaunchRelayer is Initializable, OwnableUpgradeable {
  /// @notice Libraries
  using SafeToken for address;

  /// @notice Events
  event LogFairLaunchDeposit();
  event LogFairLaunchWithdraw();
  event LogFairLaunchHarvest(address _caller, uint256 _harvestAmount);
  event LogForwardToken(address _destination, uint256 _forwardAmount);

  /// @notice Errors
  error FairLaunchRelayer_StakeTokenMismatch();

  /// @notice State
  IFairLaunch public fairLaunch;
  IAnyswapV4Router public router;
  uint256 public fairLaunchPoolId;

  address public destination;
  uint64 public destChainId;

  /// @notice Attributes for AlcapaFeeder
  /// token - address of the token to be deposited in this contract
  /// proxyToken - just a simple ERC20 token for staking with FairLaunch
  address public token;
  address public proxyToken;

  function initialize(
    address _token,
    address _proxyToken,
    address _fairLaunchAddress,
    uint256 _fairLaunchPoolId,
    address _anyswapRouter,
    address _destination,
    uint64 _destChainId
  ) external initializer {
    OwnableUpgradeable.__Ownable_init();

    // Call a view function to check contract's validity
    IERC20(_token).balanceOf(address(this));
    IERC20(_proxyToken).balanceOf(address(this));
    IAnyswapV4Router(_anyswapRouter).mpc();
    IFairLaunch(_fairLaunchAddress).poolLength();

    token = _token;
    proxyToken = _proxyToken;
    fairLaunchPoolId = _fairLaunchPoolId;
    fairLaunch = IFairLaunch(_fairLaunchAddress);
    router = IAnyswapV4Router(_anyswapRouter);
    destination = _destination;
    destChainId = _destChainId;

    (address _stakeToken, , , , ) = fairLaunch.poolInfo(fairLaunchPoolId);

    if (_stakeToken != _proxyToken) {
      revert FairLaunchRelayer_StakeTokenMismatch();
    }

    proxyToken.safeApprove(_fairLaunchAddress, type(uint256).max);
  }

  /// @notice Deposit token to FairLaunch
  function fairLaunchDeposit() external onlyOwner {
    require(IERC20(proxyToken).balanceOf(address(fairLaunch)) == 0, "already deposit");
    IProxyToken(proxyToken).mint(address(this), 1e18);
    fairLaunch.deposit(address(this), fairLaunchPoolId, 1e18);
    emit LogFairLaunchDeposit();
  }

  /// @notice Withdraw all staked token from FairLaunch
  function fairLaunchWithdraw() external onlyOwner {
    fairLaunch.withdrawAll(address(this), fairLaunchPoolId);
    IProxyToken(proxyToken).burn(address(this), proxyToken.myBalance());
    emit LogFairLaunchWithdraw();
  }

  /// @notice Receive reward from FairLaunch
  function fairLaunchHarvest() external {
    _fairLaunchHarvest();
  }

  /// @notice Receive reward from FairLaunch
  function _fairLaunchHarvest() internal {
    uint256 _before = token.myBalance();
    (bool _success, ) = address(fairLaunch).call(abi.encodeWithSelector(0xddc63262, fairLaunchPoolId));
    if (_success) emit LogFairLaunchHarvest(address(this), token.myBalance() - _before);
  }

  /// @notice Harvest reward from FairLaunch and send it to another chain destination address
  function forwardToken() external {
    _fairLaunchHarvest();
    uint256 _forwardAmount = token.myBalance();
    token.safeApprove(address(router), _forwardAmount);
    router.anySwapOutUnderlying(token, destination, _forwardAmount, destChainId);
  }
}
