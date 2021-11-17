import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { ConfigEntity, TimelockEntity } from "../../../entities";
import { FileService, TimelockService } from "../../../services";

interface IAddGrazingRangeCampaignParam {
  NAME: string;
  STAKING_TOKEN: string;
  REWARD_TOKEN: string;
  START_BLOCK: string;
}

type IAddGrazingRangeCampaignParamList = Array<IAddGrazingRangeCampaignParam>;

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
  const CAMPAIGNS: IAddGrazingRangeCampaignParamList = [
    {
      NAME: "ibALPACA-WNOW",
      STAKING_TOKEN: "0xf1bE8ecC990cBcb90e166b71E368299f0116d421",
      REWARD_TOKEN: "0x56aa0237244c67b9a854b4efe8479cca0b105289",
      START_BLOCK: "12697000",
    },
  ];
  const EXACT_ETA = "1637059500";

  const config = ConfigEntity.getConfig();
  const timelockTransactions: Array<TimelockEntity.Transaction> = [];

  for (let i = 0; i < CAMPAIGNS.length; i++) {
    const campaign = CAMPAIGNS[i];
    timelockTransactions.push(
      await TimelockService.queueTransaction(
        `add ${campaign.NAME} to Grazing Range`,
        config.GrazingRange.address,
        "0",
        "addCampaignInfo(address,address,uint256)",
        ["address", "address", "uint256"],
        [campaign.STAKING_TOKEN, campaign.REWARD_TOKEN, campaign.START_BLOCK],
        EXACT_ETA
      )
    );
  }

  FileService.write("add-gr-campaign-info", timelockTransactions);
};

export default func;
func.tags = ["TimelockAddGrazingRangeCampaigns"];
