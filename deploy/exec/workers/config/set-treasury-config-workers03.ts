import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { TimelockEntity } from "../../../entities";
import { mapWorkers } from "../../../entities/worker";
import { FileService, TimelockService } from "../../../services";
import { ethers } from "hardhat";
import { SpookyWorker03__factory, TombWorker03__factory } from "../../../../typechain";
/**
 * @description Deployment script for upgrades workers to 02 version
 * @param  {HardhatRuntimeEnvironment} hre
 */
const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  /*
  ░██╗░░░░░░░██╗░█████╗░██████╗░███╗░░██╗██╗███╗░░██╗░██████╗░
  ░██║░░██╗░░██║██╔══██╗██╔══██╗████╗░██║██║████╗░██║██╔════╝░
  ░╚██╗████╗██╔╝███████║██████╔╝██╔██╗██║██║██╔██╗██║██║░░██╗░
  ░░████╔═████║░██╔══██║██╔══██╗██║╚████║██║██║╚████║██║░░╚██╗
  ░░╚██╔╝░╚██╔╝░██║░░██║██║░░██║██║░╚███║██║██║░╚███║╚██████╔╝
  ░░░╚═╝░░░╚═╝░░╚═╝░░╚═╝╚═╝░░╚═╝╚═╝░░╚══╝╚═╝╚═╝░░╚══╝░╚═════╝░
  Check all variables below before execute the deployment script
  */
  const fileName = "mainnet-xALPACA-set-treasury-config-pcs";
  const workerInputs: Array<string> = [
    "WFTM-ALPACA SpookyWorker",
    "TUSD-USDC SpookyWorker",
    "WFTM-USDC SpookyWorker",
    "MIM-WFTM SpookyWorker",
    "DAI-WFTM SpookyWorker",
    "fUSDT-WFTM SpookyWorker",
    "BTC-WFTM SpookyWorker",
    "ALPACA-WFTM SpookyWorker",
    "ETH-WFTM SpookyWorker",
    "BOO-WFTM SpookyWorker",
    "USDC-WFTM SpookyWorker",
    "WFTM-TOMB TombWorker",
    "TSHARE-WFTM TombWorker",
    "TOMB-WFTM TombWorker",
  ];
  const TREASURY_ACCOUNT = "0xe45216Ac4816A5Ec5378B1D13dE8aA9F262ce9De";
  const TREASURY_BOUNTY_BPS = "900";

  const targetedWorkers = mapWorkers(workerInputs);
  const deployer = (await ethers.getSigners())[0];
  const timelockTransactions: Array<TimelockEntity.Transaction> = [];
  let nonce = await deployer.getTransactionCount();

  for (const targetedWorker of targetedWorkers) {
    console.log(`>> Set treasury config for ${targetedWorker.name}`);
    if (targetedWorker.name.includes("TombWorker")) {
      const tombWorker03 = TombWorker03__factory.connect(targetedWorker.address, deployer);
      await tombWorker03.setTreasuryConfig(TREASURY_ACCOUNT, TREASURY_BOUNTY_BPS, {
        nonce: nonce++,
        gasPrice: ethers.utils.parseUnits("10", "gwei"),
      });
      continue;
    }
    const spookyWorker03 = SpookyWorker03__factory.connect(targetedWorker.address, deployer);
    await spookyWorker03.setTreasuryConfig(TREASURY_ACCOUNT, TREASURY_BOUNTY_BPS, {
      nonce: nonce++,
      gasPrice: ethers.utils.parseUnits("10", "gwei"),
    });
    console.log("✅ Done");
  }

  FileService.write(fileName, timelockTransactions);
};

export default func;
func.tags = ["SetTreasuryFieldsWorkers03"];
