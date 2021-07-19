import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers, upgrades, network } from 'hardhat';
import { 
  PancakeswapV2RestrictedStrategyAddBaseTokenOnly,
  PancakeswapV2RestrictedStrategyAddBaseTokenOnly__factory,
  PancakeswapV2RestrictedStrategyLiquidate,
  PancakeswapV2RestrictedStrategyLiquidate__factory,
  PancakeswapV2RestrictedStrategyPartialCloseLiquidate__factory,
  PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading,
  PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading__factory,
  PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading,
  PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading__factory,
  WNativeRelayer__factory
 } from '../typechain';
import MainnetConfig from '../.mainnet.json'
import TestnetConfig from '../.testnet.json'
import { Strats } from './entities/strats';
import { mapWorkers } from './entities/worker';

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
  const DEPLOY_STRATS = [
    Strats.partialCloseLiquidate,
    Strats.partialCloseWithdrawMinizmie
  ]
  const WHITELIST_WOKERS = [
    "CAKE-WBNB PancakeswapWorker",
    "BTCB-WBNB PancakeswapWorker",
    "ETH-WBNB PancakeswapWorker",
    "DOT-WBNB PancakeswapWorker",
    "UNI-WBNB PancakeswapWorker",
    "LINK-WBNB PancakeswapWorker",
    "XVS-WBNB PancakeswapWorker",
    "YFI-WBNB PancakeswapWorker",
    "ITAM-WBNB PancakeswapWorker",
    "BUSD-WBNB PancakeswapWorker",
    "bMXX-WBNB PancakeswapWorker",
    "BELT-WBNB PancakeswapWorker",
    "BOR-WBNB PancakeswapWorker",
    "BRY-WBNB PancakeswapWorker",
    "pCWS-WBNB PancakeswapWorker",
    "SWINGBY-WBNB PancakeswapWorker",
    "DODO-WBNB PancakeswapWorker",
    "USDT-WBNB PancakeswapWorker",
    "ODDZ-WBNB PancakeswapWorker",
    "ADA-WBNB PancakeswapWorker",
    "TRX-WBNB PancakeswapWorker",
    "BTT-WBNB PancakeswapWorker",
    "USDT-BUSD PancakeswapWorker",
    "WBNB-BUSD PancakeswapWorker",
    "VAI-BUSD PancakeswapWorker",
    "USDC-BUSD PancakeswapWorker",
    "DAI-BUSD PancakeswapWorker",
    "UST-BUSD PancakeswapWorker",
    "BTCB-BUSD PancakeswapWorker",
    "ALPACA-BUSD PancakeswapWorker",
    "CAKE-BUSD PancakeswapWorker",
    "FORM-BUSD PancakeswapWorker",
    "TUSD-BUSD PancakeswapWorker",
    "COMP-ETH PancakeswapWorker",
    "SUSHI-ETH PancakeswapWorker",
    "WBNB-ETH PancakeswapWorker",
    "BUSD-USDT PancakeswapWorker",
    "WBNB-USDT PancakeswapWorker",
    "CAKE-USDT PancakeswapWorker",
    "USDC-USDT PancakeswapWorker",
    "WBNB-BTCB PancakeswapWorker",
    "BUSD-BTCB PancakeswapWorker",
    "ORBS-BUSD PancakeswapWorker",
    "BUSD-ALPACA PancakeswapWorker",
    "BUSD-TUSD PancakeswapWorker",
  ]







  const config = network.name === "mainnet" ? MainnetConfig : TestnetConfig
  const wNativeRelayer = WNativeRelayer__factory.connect(
    config.SharedConfig.WNativeRelayer, (await ethers.getSigners())[0]);
  const whitelistedWorkerAddrs = mapWorkers(WHITELIST_WOKERS).map((worker) => worker.address)

  if(DEPLOY_STRATS.includes(Strats.btokenOnly)) {
    /**
     * Restricted StrategyAddBaseTokenOnly V2
     */
    console.log(">> Deploying an upgradable Restricted StrategyAddBaseTokenOnly V2 contract");
    const PancakeswapV2RestrictedStrategyAddBaseTokenOnly = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedStrategyAddBaseTokenOnly",
      (await ethers.getSigners())[0],
    )) as PancakeswapV2RestrictedStrategyAddBaseTokenOnly__factory;
    const strategyRestrictedAddBaseTokenOnlyV2 = await upgrades.deployProxy(
      PancakeswapV2RestrictedStrategyAddBaseTokenOnly, [config.Exchanges.Pancakeswap.RouterV2]
    ) as PancakeswapV2RestrictedStrategyAddBaseTokenOnly;
    await strategyRestrictedAddBaseTokenOnlyV2.deployed()
    console.log(`>> Deployed at ${strategyRestrictedAddBaseTokenOnlyV2.address}`);
    console.log("✅ Done")

    console.log(">> Whitelisting workers for strategyRestrictedAddBaseTokenOnlyV2")
    await strategyRestrictedAddBaseTokenOnlyV2.setWorkersOk(whitelistedWorkerAddrs, true)
    console.log("✅ Done")
  }
  
  if(DEPLOY_STRATS.includes(Strats.liquidateAll)) {
    /**
     * Restricted StrategyLiquidate V2
     */
    console.log(">> Deploying an upgradable Restricted StrategyLiquidate V2 contract");
    const PancakeswapV2RestrictedStrategyLiquidate = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedStrategyLiquidate",
      (await ethers.getSigners())[0],
    )) as PancakeswapV2RestrictedStrategyLiquidate__factory;
    const strategyRestrictedLiquidateV2 = await upgrades.deployProxy(
      PancakeswapV2RestrictedStrategyLiquidate, [config.Exchanges.Pancakeswap.RouterV2]
    ) as PancakeswapV2RestrictedStrategyLiquidate;
    await strategyRestrictedLiquidateV2.deployed();
    console.log(`>> Deployed at ${strategyRestrictedLiquidateV2.address}`);
    console.log("✅ Done")

    console.log(">> Whitelisting workers for strategyRestrictedLiquidateV2")
    await strategyRestrictedLiquidateV2.setWorkersOk(whitelistedWorkerAddrs, true)
    console.log("✅ Done")
  }

  if(DEPLOY_STRATS.includes(Strats.withdrawMinimize)) {
    /**
    * Restricted StrategyWithdrawMinimizeTrading V2
    */
    console.log(">> Deploying an upgradable Restricted StrategyWithdrawMinimizeTrading V2 contract");
    const PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading",
      (await ethers.getSigners())[0],
    )) as PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading__factory;
    const strategyRestrictedWithdrawMinimizeTradingV2 = await upgrades.deployProxy(
      PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading, 
      [config.Exchanges.Pancakeswap.RouterV2, config.Tokens.WBNB, config.SharedConfig.WNativeRelayer]
    ) as PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading;
    await strategyRestrictedWithdrawMinimizeTradingV2.deployed()
    console.log(`>> Deployed at ${strategyRestrictedWithdrawMinimizeTradingV2.address}`);

    console.log(">> Whitelisting workers for strategyRestrictedWithdrawMinimizeTradingV2")
    await strategyRestrictedWithdrawMinimizeTradingV2.setWorkersOk(whitelistedWorkerAddrs, true)
    console.log("✅ Done")

    console.log(">> Whitelist RestrictedStrategyWithdrawMinimizeTrading V2 on WNativeRelayer");
    await wNativeRelayer.setCallerOk([strategyRestrictedWithdrawMinimizeTradingV2.address], true);
    console.log("✅ Done")
  }

  if(DEPLOY_STRATS.includes(Strats.partialCloseLiquidate)) {
    /**
     * Restricted StrategyPartialCloseLiquidate V2
     */
    console.log(">> Deploying an upgradable Restricted StrategyPartialCloseLiquidate V2 contract");
    const PancakeswapV2RestrictedStrategyPartialCloseLiquidate = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedStrategyPartialCloseLiquidate",
      (await ethers.getSigners())[0],
    )) as PancakeswapV2RestrictedStrategyPartialCloseLiquidate__factory;
    const restrictedStrategyPartialCloseLiquidate = await upgrades.deployProxy(
      PancakeswapV2RestrictedStrategyPartialCloseLiquidate, [config.Exchanges.Pancakeswap.RouterV2]
    ) as PancakeswapV2RestrictedStrategyLiquidate;
    await restrictedStrategyPartialCloseLiquidate.deployed();
    console.log(`>> Deployed at ${restrictedStrategyPartialCloseLiquidate.address}`);
    console.log("✅ Done")

    console.log(">> Whitelisting workers for strategyRestrictedLiquidateV2")
    await restrictedStrategyPartialCloseLiquidate.setWorkersOk(whitelistedWorkerAddrs, true)
    console.log("✅ Done")
  }

  if(DEPLOY_STRATS.includes(Strats.partialCloseWithdrawMinizmie)) {
    /**
    * Restricted StrategyPartialCloseMinimizeTrading V2
    */
    console.log(">> Deploying an upgradable Restricted StrategyPartialCloseMinimizeTrading V2 contract");
    const PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading",
      (await ethers.getSigners())[0],
    )) as PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading__factory;
    const strategyRestrictedPartialCloseMinimizeTradingV2 = await upgrades.deployProxy(
    PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading, 
    [config.Exchanges.Pancakeswap.RouterV2, config.Tokens.WBNB, config.SharedConfig.WNativeRelayer]
    ) as PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading;
    await strategyRestrictedPartialCloseMinimizeTradingV2.deployed()
    console.log(`>> Deployed at ${strategyRestrictedPartialCloseMinimizeTradingV2.address}`);

    console.log(">> Whitelisting workers for strategyRestrictedPartialCloseMinimizeTradingV2")
    await strategyRestrictedPartialCloseMinimizeTradingV2.setWorkersOk(whitelistedWorkerAddrs, true)
    console.log("✅ Done")

    console.log(">> Whitelist strategyRestrictedPartialCloseMinimizeTradingV2 V2 on WNativeRelayer");
    await wNativeRelayer.setCallerOk([strategyRestrictedPartialCloseMinimizeTradingV2.address], true);
    console.log("✅ Done")
  }
};

export default func;
func.tags = ['ShareRestrictedStrategiesV2'];