import { ethers, network } from "hardhat";
import "@openzeppelin/test-helpers";
import {
  PancakePair__factory,
  SimplePriceOracle__factory,
  Timelock,
  Timelock__factory,
  Vault__factory,
  WorkerConfig__factory,
} from "../typechain";
import MainnetConfig from "../.mainnet.json";
import TestnetConfig from "../.testnet.json";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { VaultsEntity } from "../deploy/interfaces/config";

interface IReserve {
  vault: string;
  fullAmount: string;
  buybackAmount: string;
}

async function _queueWithdrawReserve(
  timelock: Timelock,
  deployer: SignerWithAddress,
  vaultInfo: VaultsEntity,
  eta: number,
  nonce: number
): Promise<IReserve> {
  console.log(`========== queue tx for withdrawing reserve pool from ${vaultInfo.symbol} ==========`);
  const vault = Vault__factory.connect(vaultInfo.address, deployer);
  const reserveAmt = await vault.reservePool();

  const queueTx = await timelock.queueTransaction(
    vault.address,
    "0",
    "withdrawReserve(address,uint256)",
    ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [deployer.address, reserveAmt]),
    eta,
    { nonce, gasPrice: ethers.utils.parseUnits("20", "gwei") }
  );

  console.log(`> queued tx to withdraw reserve hash: ${queueTx.hash}`);

  console.log(`> generate execute command for ${vaultInfo.symbol}`);
  console.log(
    `await timelock.executeTransaction('${vault.address}', '0', 'withdrawReserve(address,uint256)', ethers.utils.defaultAbiCoder.encode(['address','uint256'],['${deployer.address}', '${reserveAmt}']), ${eta})`
  );
  console.log("> ✅ done");

  return {
    vault: vaultInfo.symbol.replace("ib", ""),
    fullAmount: ethers.utils.formatEther(reserveAmt),
    buybackAmount: ethers.utils.formatEther(reserveAmt.mul("5263").div("10000")),
  };
}

async function main() {
  const config = network.name === "mainnet" ? MainnetConfig : TestnetConfig;
  const deployer = (await ethers.getSigners())[0];
  let nonce = await deployer.getTransactionCount();

  /// @dev initialized all variables
  const targetVault = ["ibWBNB", "ibBUSD", "ibETH", "ibALPACA", "ibUSDT", "ibBTCB", "ibTUSD"];
  const reserves: Array<IReserve> = [];
  const eta = Math.floor(Date.now() / 1000) + 86400 + 1800;

  /// @dev connect to Timelock
  const timelock = Timelock__factory.connect(config.Timelock, deployer);

  /// @dev find vault info
  const vaultInfo = config.Vaults.filter((v) => {
    if (targetVault.indexOf(v.symbol) === -1) {
      return false;
    }
    return true;
  });

  const promises = [];
  for (let i = 0; i < vaultInfo.length; i++) {
    promises.push(_queueWithdrawReserve(timelock, deployer, vaultInfo[i], eta, nonce));
    nonce = nonce + 1;
  }
  reserves.push(...(await Promise.all(promises)));

  /// @dev display reserve to be withdrawn
  console.log("========== reserve withdraw summary ==========");
  console.table(reserves);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
