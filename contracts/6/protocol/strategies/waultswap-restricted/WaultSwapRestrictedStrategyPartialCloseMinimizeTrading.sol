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
*/

pragma solidity 0.6.6;

import "@openzeppelin/contracts-ethereum-package/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/Initializable.sol";
import "@openzeppelin/contracts-ethereum-package/contracts/access/Ownable.sol";

import "../../apis/wault/IWaultSwapFactory.sol";
import "@pancakeswap-libs/pancake-swap-core/contracts/interfaces/IPancakePair.sol";

import "../../apis/wault/IWaultSwapRouter02.sol";
import "../../interfaces/IStrategy.sol";
import "../../interfaces/IWETH.sol";
import "../../interfaces/IWNativeRelayer.sol";
import "../../../utils/SafeToken.sol";
import "../../interfaces/IWorker.sol";

contract WaultSwapRestrictedStrategyPartialCloseMinimizeTrading is
  OwnableUpgradeSafe,
  ReentrancyGuardUpgradeSafe,
  IStrategy
{
  using SafeToken for address;
  using SafeMath for uint256;

  IWaultSwapFactory public factory;
  IWaultSwapRouter02 public router;
  IWETH public wbnb;
  IWNativeRelayer public wNativeRelayer;

  mapping(address => bool) public okWorkers;

  event WaultSwapRestrictedStrategyPartialCloseMinimizeTradingEvent(
    address indexed baseToken,
    address indexed farmToken,
    uint256 amounToLiquidate,
    uint256 amountToRepayDebt
  );

  // @notice require that only allowed workers are able to do the rest of the method call
  modifier onlyWhitelistedWorkers() {
    require(
      okWorkers[msg.sender],
      "WaultSwapRestrictedStrategyPartialCloseMinimizeTrading::onlyWhitelistedWorkers:: bad worker"
    );
    _;
  }

  /// @dev Create a new withdraw minimize trading strategy instance.
  /// @param _router The Uniswap router smart contract.
  /// @param _wbnb The wrapped BNB token.
  /// @param _wNativeRelayer The relayer to support native transfer
  function initialize(
    IWaultSwapRouter02 _router,
    IWETH _wbnb,
    IWNativeRelayer _wNativeRelayer
  ) external initializer {
    OwnableUpgradeSafe.__Ownable_init();
    ReentrancyGuardUpgradeSafe.__ReentrancyGuard_init();
    factory = IWaultSwapFactory(_router.factory());
    router = _router;
    wbnb = _wbnb;
    wNativeRelayer = _wNativeRelayer;
  }

  /// @dev Execute worker strategy. Take LP tokens. Return farming token + base token.
  /// However, some base token will be deducted to pay the debt
  /// @param user User address to withdraw liquidity.
  /// @param data Extra calldata information passed along to this strategy.
  function execute(
    address user,
    uint256, /*debt*/
    bytes calldata data
  ) external override onlyWhitelistedWorkers nonReentrant {
    // 1. Find out what farming token we are dealing with.
    (uint256 lpTokenToLiquidate, uint256 toRepaidBaseTokenDebt, uint256 minFarmingToken) =
      abi.decode(data, (uint256, uint256, uint256));
    IWorker worker = IWorker(msg.sender);
    address baseToken = worker.baseToken();
    address farmingToken = worker.farmingToken();
    IPancakePair lpToken = IPancakePair(factory.getPair(farmingToken, baseToken));
    // 2. Approve router to do their stuffs
    require(
      lpToken.approve(address(router), uint256(-1)),
      "WaultSwapRestrictedStrategyPartialCloseMinimizeTrading::execute:: failed to approve LP token"
    );
    farmingToken.safeApprove(address(router), uint256(-1));
    // 3. Remove all liquidity back to base token and farming tokens.
    require(
      lpToken.balanceOf(address(this)) >= lpTokenToLiquidate,
      "WaultSwapRestrictedStrategyPartialCloseMinimizeTrading::execute:: insufficient LP amount recevied from worker"
    );
    router.removeLiquidity(baseToken, farmingToken, lpTokenToLiquidate, 0, 0, address(this), now);
    // 4. Convert farming tokens to base token.
    address[] memory path = new address[](2);
    path[0] = farmingToken;
    path[1] = baseToken;
    {
      uint256 balance = baseToken.myBalance();
      uint256 farmingTokenbalance = farmingToken.myBalance();
      if (toRepaidBaseTokenDebt > balance) {
        // Convert some farming tokens to base token.
        uint256 remainingDebt = toRepaidBaseTokenDebt.sub(balance);
        uint256[] memory farmingTokenToBeRepaidDebts = router.getAmountsIn(remainingDebt, path);
        require(
          farmingTokenbalance >= farmingTokenToBeRepaidDebts[0],
          "WaultSwapRestrictedStrategyPartialCloseMinimizeTrading::execute:: not enough to pay back debt"
        );
        router.swapTokensForExactTokens(remainingDebt, farmingTokenbalance, path, address(this), now);
      }
    }
    // 5. Return remaining LP token back to the original caller
    require(
      lpToken.transfer(msg.sender, lpToken.balanceOf(address(this))),
      "WaultSwapRestrictedStrategyPartialCloseMinimizeTrading::execute:: unable to transfer lp to caller"
    );
    // 6. Return base token back to the original caller.
    baseToken.safeTransfer(msg.sender, baseToken.myBalance());
    // 7. Return remaining farming tokens to user.
    uint256 remainingFarmingToken = farmingToken.myBalance();
    require(
      remainingFarmingToken >= minFarmingToken,
      "WaultSwapRestrictedStrategyPartialCloseMinimizeTrading::execute:: insufficient farming tokens received"
    );
    if (remainingFarmingToken > 0) {
      if (farmingToken == address(wbnb)) {
        SafeToken.safeTransfer(farmingToken, address(wNativeRelayer), remainingFarmingToken);
        wNativeRelayer.withdraw(remainingFarmingToken);
        SafeToken.safeTransferETH(user, remainingFarmingToken);
      } else {
        SafeToken.safeTransfer(farmingToken, user, remainingFarmingToken);
      }
    }
    // 8. Reset approval for safety reason
    require(
      lpToken.approve(address(router), 0),
      "WaultSwapRestrictedStrategyPartialCloseMinimizeTrading::execute:: unable to reset lp token approval"
    );
    farmingToken.safeApprove(address(router), 0);

    emit WaultSwapRestrictedStrategyPartialCloseMinimizeTradingEvent(
      baseToken,
      farmingToken,
      lpTokenToLiquidate,
      toRepaidBaseTokenDebt
    );
  }

  function setWorkersOk(address[] calldata workers, bool isOk) external onlyOwner {
    for (uint256 idx = 0; idx < workers.length; idx++) {
      okWorkers[workers[idx]] = isOk;
    }
  }

  receive() external payable {}
}
