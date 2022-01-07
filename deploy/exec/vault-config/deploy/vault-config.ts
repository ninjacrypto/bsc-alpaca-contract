import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers, upgrades, network } from "hardhat";
import { ConfigurableInterestVaultConfig__factory } from "../../../../typechain";
import { ConfigEntity } from "../../../entities";

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
  const MIN_DEBT_SIZE = ethers.utils.parseEther("100");
  const RESERVE_POOL_BPS = "1900";
  const KILL_PRIZE_BPS = "100";
  const TREASURY_KILL_BPS = "400";
  const TREASURY_ADDR = "0x0FfA891ab6f410bbd7403b709e7d38D7a812125B";

  const config = ConfigEntity.getConfig();

  console.log(">> Deploying an upgradable configurableInterestVaultConfig contract");
  const ConfigurableInterestVaultConfig = (await ethers.getContractFactory(
    "ConfigurableInterestVaultConfig",
    (
      await ethers.getSigners()
    )[0]
  )) as ConfigurableInterestVaultConfig__factory;
  const configurableInterestVaultConfig = await upgrades.deployProxy(ConfigurableInterestVaultConfig, [
    MIN_DEBT_SIZE,
    RESERVE_POOL_BPS,
    KILL_PRIZE_BPS,
    config.SharedConfig.TripleSlopeModel103,
    config.Tokens.WBNB,
    config.SharedConfig.WNativeRelayer,
    config.FairLaunch.address,
    TREASURY_KILL_BPS,
    TREASURY_ADDR,
  ]);
  await configurableInterestVaultConfig.deployed();
  console.log(`>> Deployed at ${configurableInterestVaultConfig.address}`);
};

export default func;
func.tags = ["ConfigurableInterestVaultConfig"];
