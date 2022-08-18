import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { RepurchaseBorrowStrategy__factory } from "../../../../typechain";
import { getDeployer, isFork } from "../../../../utils/deployer-helper";

interface ISetWhitelistedStratWorkers {
  STRAT_NAME: string;
  STRAT_ADDR: string;
  WORKERS: Array<string>;
}

type ISetWhitelistedStratsWorkers = Array<ISetWhitelistedStratWorkers>;

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
  const WHITELISTED_STRATS_WORKERS: ISetWhitelistedStratsWorkers = [
    {
      STRAT_NAME: "RepurchaseBorrowStrategy",
      STRAT_ADDR: "0xdDf2715911ae70a2E7ef42ea8BD86D1c2c319F5e",
      WORKERS: ["0x83A5d5c54Ad83bBeA8667B3B95d7610E16e52723", "0x4b70c41F514FBBEa718234Ac72f36c1b077a4162"],
    },
    {
      STRAT_NAME: "RepurchaseRepayStrategy",
      STRAT_ADDR: "0x40D23cD168F46E5B8302C690E6EA54D6dbf279D6",
      WORKERS: ["0x83A5d5c54Ad83bBeA8667B3B95d7610E16e52723", "0x4b70c41F514FBBEa718234Ac72f36c1b077a4162"],
    },
  ];

  const deployer = await getDeployer();
  let nonce = await deployer.getTransactionCount();

  for (let i = 0; i < WHITELISTED_STRATS_WORKERS.length; i++) {
    const params = WHITELISTED_STRATS_WORKERS[i];
    const ops = isFork() ? { nonce: nonce++, gasLimit: 2000000 } : { nonce: nonce++ };

    const strat = RepurchaseBorrowStrategy__factory.connect(params.STRAT_ADDR, deployer);
    await strat.setWorkersOk(params.WORKERS, true, ops);
    const worker_addresses = params.WORKERS.map((worker) => `'${worker}'`);
    console.log(`await '${params.STRAT_ADDR}'.setWorkersOk('${worker_addresses}', true)`);
    console.log("✅ Done");
  }
};

export default func;
func.tags = ["SetSharedStratsWhitelistedWorkers"];
