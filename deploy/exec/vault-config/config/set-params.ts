import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ethers } from "hardhat";
import { TimelockEntity } from "../../../entities";
import { fileService, TimelockService } from "../../../services";
import { getConfig } from "../../../entities/config";
import { ConfigurableInterestVaultConfig__factory } from "../../../../typechain";
import { Multicall2Service } from "../../../services/multicall/multicall2";
import { BigNumber, BigNumberish } from "ethers";

interface SetParamsInput {
  VAULT_SYMBOL: string;
  MIN_DEBT_SIZE_WEI?: BigNumberish;
  RESERVE_POOL_BPS?: BigNumberish;
  KILL_PRIZE_BPS?: BigNumberish;
  INTEREST_MODEL?: string;
  TREASURY_KILL_BPS?: BigNumberish;
  TREASURY_ADDR?: string;
  EXACT_ETA: string;
}

interface SetParamsDerivedInput {
  VAULT_SYMBOL: string;
  MIN_DEBT_SIZE_WEI: BigNumberish;
  RESERVE_POOL_BPS: BigNumberish;
  KILL_PRIZE_BPS: BigNumberish;
  INTEREST_MODEL: string;
  TREASURY_KILL_BPS: BigNumberish;
  TREASURY_ADDR: string;
  WRAPPED_NATIVE: string;
  WNATIVE_RELAYER: string;
  FAIRLAUNCH: string;
  VAULT_CONFIG: string;
  EXACT_ETA: string;
}

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
  const TITLTE = "update_wbnb_busd_usdt_triple_slope_model";
  const NEW_PARAMS: Array<SetParamsInput> = [
    {
      VAULT_SYMBOL: "ibWBNB",
      INTEREST_MODEL: "0xc51d25a2C2d49eE2508B822829d43b9961deCB44",
      EXACT_ETA: "1650875400",
    },
    {
      VAULT_SYMBOL: "ibBUSD",
      INTEREST_MODEL: "0x4eCa08e4f2eD826dba5Bea2Ec133036fE60d30b6",
      EXACT_ETA: "1650875400",
    },
    {
      VAULT_SYMBOL: "ibUSDT",
      INTEREST_MODEL: "0x284e25169CE75fc62c9339207de5d775F46aD406",
      EXACT_ETA: "1650875400",
    },
  ];

  const config = getConfig();
  const timelockTransactions: Array<TimelockEntity.Transaction> = [];
  const deployer = (await ethers.getSigners())[0];
  const multicallService = new Multicall2Service(config.MultiCall, deployer);
  let nonce = await deployer.getTransactionCount();

  /// @dev derived input
  const infos: Array<SetParamsDerivedInput> = await Promise.all(
    NEW_PARAMS.map(async (n) => {
      const vault = config.Vaults.find((v) => v.symbol === n.VAULT_SYMBOL);
      if (vault === undefined) throw new Error(`error: unable to map ${n.VAULT_SYMBOL} to any vault`);

      const vaultConfig = ConfigurableInterestVaultConfig__factory.connect(vault.config, deployer);
      const [
        minDebtSize,
        reservePoolBps,
        killBps,
        interestModel,
        treasury,
        treasuryKillBps,
        wrappedNative,
        wnativeRelayer,
        fairlaunch,
      ] = await multicallService.multiContractCall<
        [BigNumber, BigNumber, BigNumber, string, string, BigNumber, string, string, string]
      >([
        { contract: vaultConfig, functionName: "minDebtSize" },
        { contract: vaultConfig, functionName: "getReservePoolBps" },
        { contract: vaultConfig, functionName: "getKillBps" },
        { contract: vaultConfig, functionName: "interestModel" },
        { contract: vaultConfig, functionName: "treasury" },
        { contract: vaultConfig, functionName: "getKillTreasuryBps" },
        { contract: vaultConfig, functionName: "getWrappedNativeAddr" },
        { contract: vaultConfig, functionName: "getWNativeRelayer" },
        { contract: vaultConfig, functionName: "getFairLaunchAddr" },
      ]);

      return {
        VAULT_SYMBOL: n.VAULT_SYMBOL,
        VAULT_CONFIG: vault.config,
        MIN_DEBT_SIZE_WEI: n.MIN_DEBT_SIZE_WEI || minDebtSize,
        RESERVE_POOL_BPS: n.RESERVE_POOL_BPS || reservePoolBps,
        KILL_PRIZE_BPS: n.KILL_PRIZE_BPS || killBps,
        INTEREST_MODEL: n.INTEREST_MODEL || interestModel,
        TREASURY_ADDR: n.TREASURY_ADDR || treasury,
        TREASURY_KILL_BPS: n.TREASURY_KILL_BPS || treasuryKillBps,
        WRAPPED_NATIVE: wrappedNative,
        WNATIVE_RELAYER: wnativeRelayer,
        FAIRLAUNCH: fairlaunch,
        EXACT_ETA: n.EXACT_ETA,
      } as SetParamsDerivedInput;
    })
  );

  for (const info of infos) {
    // function setParams(
    // uint256 _minDebtSize,
    // uint256 _reservePoolBps,
    // uint256 _killBps,
    // InterestModel _interestModel,
    // address _getWrappedNativeAddr,
    // address _getWNativeRelayer,
    // address _getFairLaunchAddr,
    // uint256 _getKillTreasuryBps,
    // address _treasury
    // )
    timelockTransactions.push(
      await TimelockService.queueTransaction(
        `Update ${info.VAULT_SYMBOL} Vault config`,
        info.VAULT_CONFIG,
        "0",
        "setParams(uint256,uint256,uint256,address,address,address,address,uint256,address)",
        ["uint256", "uint256", "uint256", "address", "address", "address", "address", "uint256", "address"],
        [
          info.MIN_DEBT_SIZE_WEI,
          info.RESERVE_POOL_BPS,
          info.KILL_PRIZE_BPS,
          info.INTEREST_MODEL,
          info.WRAPPED_NATIVE,
          info.WNATIVE_RELAYER,
          info.FAIRLAUNCH,
          info.TREASURY_KILL_BPS,
          info.TREASURY_ADDR,
        ],
        info.EXACT_ETA,
        { nonce: nonce++ }
      )
    );
  }

  const ts = Math.floor(Date.now() / 1000);
  fileService.writeJson(`${ts}_${TITLTE}`, timelockTransactions);
};

export default func;
func.tags = ["TimelockSetParamsVaultConfig"];
