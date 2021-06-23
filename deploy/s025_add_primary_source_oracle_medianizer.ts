import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers, network } from 'hardhat';
import { OracleMedianizer__factory } from '../typechain'
import TestnetConfig from '../.testnet.json'
import MainnetConfig from '../.mainnet.json'

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
  const DEFAULT_MAX_PRICE_DEVIATIONS = '1000000000000000000'
  const config = network.name === "mainnet" ? MainnetConfig : TestnetConfig

  const TOKEN0_SYMBOLS = [
    'CAKE'
  ];
  const TOKEN1_SYMBOLS = [
    'BUSD'
  ];
  const MAX_PRICE_DEVIATIONS = [
    DEFAULT_MAX_PRICE_DEVIATIONS
  ];
  const MAX_PRICE_STALES = [
    0
  ]
  const SOURCES = [
    [config.Oracle.ChainLinkOracle]
  ];





  



  const tokenList: any = config.Tokens
  const token0Addrs: Array<string> = TOKEN0_SYMBOLS.map((t) => {
    const addr = tokenList[t]
    if (addr === undefined) {
      throw(`error: token: unable to find address of ${t}`)
    }
    return addr
  })
  const token1Addrs: Array<string> = TOKEN1_SYMBOLS.map((t) => {
    const addr = tokenList[t]
    if (addr === undefined) {
      throw(`error: token: unable to find address of ${t}`)
    }
    return addr
  })

  const oracleMedianizer = OracleMedianizer__factory.connect(config.Oracle.OracleMedianizer, (await ethers.getSigners())[0]);
  console.log(">> Adding primary source to oracle medianizer");
  await oracleMedianizer.setMultiPrimarySources(token0Addrs, token1Addrs, MAX_PRICE_DEVIATIONS, MAX_PRICE_STALES, SOURCES, { gasLimit: '10000000' });
  console.log("✅ Done")
};

export default func;
func.tags = ['AddSourceOracleMedianizer'];