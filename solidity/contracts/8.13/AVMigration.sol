// SPDX-License-Identifier: BUSL
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

pragma solidity 0.8.13;

import "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/IERC20Upgradeable.sol";
import "@openzeppelin/contracts-upgradeable/token/ERC20/utils/SafeERC20Upgradeable.sol";
import "solidity/contracts/8.13/utils/Ownable.sol";

import { IDeltaNeutralVault } from "./interfaces/IDeltaNeutralVault.sol";
import { IAVMigrationStruct } from "./interfaces/IAVMigrationStruct.sol";

contract AVMigration is IAVMigrationStruct, Ownable {
  using SafeERC20Upgradeable for IERC20Upgradeable;

  mapping(address => address) public vaultMap;

  error AVMigration_DestinationVaultDoesNotExist();

  event LogMigration(
    address indexed _shareOwner,
    address indexed _srcVault,
    address indexed _dstVault,
    uint256 _sharesFromSrc,
    uint256 _sharesToDst
  );

  function migrate(
    address srcVault,
    uint256 _minStableTokenAmount,
    uint256 _minShareReceive
  ) public {
    address dstVault = vaultMap[srcVault];
    if (dstVault == address(0)) {
      revert AVMigration_DestinationVaultDoesNotExist();
    }

    uint256 sharesFromSrc = IERC20Upgradeable(srcVault).balanceOf(msg.sender);
    IERC20Upgradeable(srcVault).safeTransferFrom(msg.sender, address(this), sharesFromSrc);
    uint256 stableFromSrc = IDeltaNeutralVault(srcVault).withdraw(
      sharesFromSrc,
      _minStableTokenAmount,
      0,
      abi.encode(0)
    );

    IERC20Upgradeable(IDeltaNeutralVault(srcVault).stableToken()).approve(dstVault, stableFromSrc);

    uint256 shareToDst = IDeltaNeutralVault(dstVault).deposit(
      stableFromSrc,
      0,
      msg.sender,
      _minShareReceive,
      abi.encode(0)
    );

    emit LogMigration(msg.sender, srcVault, dstVault, sharesFromSrc, shareToDst);
  }

  function setMigrationPaths(VaultMigrationPath[] calldata migrationPaths) public onlyOwner {
    uint8 len = uint8(migrationPaths.length);
    for (uint8 i = 0; i < len; ) {
      vaultMap[migrationPaths[i].srcVault] = migrationPaths[i].dstVault;
      unchecked {
        i++;
      }
    }
  }
}
