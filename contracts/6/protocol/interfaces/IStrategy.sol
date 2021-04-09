pragma solidity 0.6.6;

interface IStrategy {
  /// @dev Execute worker strategy. Take LP tokens + ETH. Return LP tokens + ETH.
  /// @param user The original user that is interacting with the operator.
  /// @param debt The user's total debt, for better decision making context.
  /// @param data Extra calldata information passed along to this strategy.
  function execute(address user, uint256 debt, bytes calldata data) external payable;
}
