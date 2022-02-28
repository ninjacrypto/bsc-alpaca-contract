import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import { ChainlinkPriceOracle2__factory } from "../../../../typechain";
import { getConfig } from "../../../entities/config";

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
  const TOKEN0_SYMBOLS = ["WFTM", "WFTM", "WFTM"];
  const TOKEN1_SYMBOLS = ["fUSDT", "DAI", "MIM"];
  const AGGREGATORV3S = [
    ["0xf4766552D15AE4d256Ad41B6cf2933482B0680dc"],
    ["0xf4766552D15AE4d256Ad41B6cf2933482B0680dc"],
    ["0xf4766552D15AE4d256Ad41B6cf2933482B0680dc"],
  ];

  const config = getConfig();
  const tokenList: any = config.Tokens;
  const token0Addrs: Array<string> = TOKEN0_SYMBOLS.map((t) => {
    const addr = tokenList[t];
    if (addr === undefined) {
      throw `error: token: unable to find address of ${t}`;
    }
    return addr;
  });
  const token1Addrs: Array<string> = TOKEN1_SYMBOLS.map((t) => {
    const addr = tokenList[t];
    if (addr === undefined) {
      throw `error: token: unable to find address of ${t}`;
    }
    return addr;
  });

  const chainlinkPriceOracle2 = ChainlinkPriceOracle2__factory.connect(
    config.Oracle.ChainLinkOracle,
    (await ethers.getSigners())[0]
  );
  console.log(">> Adding price source to chain link price oracle");
  await chainlinkPriceOracle2.setPriceFeeds(token0Addrs, token1Addrs, AGGREGATORV3S);
  console.log("✅ Done");
};

export default func;
func.tags = ["AddSourceChainlinkPriceOracle2"];
