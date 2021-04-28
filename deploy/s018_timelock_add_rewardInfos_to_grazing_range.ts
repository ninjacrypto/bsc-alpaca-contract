import { HardhatRuntimeEnvironment } from 'hardhat/types';
import { DeployFunction } from 'hardhat-deploy/types';
import { ethers } from 'hardhat';
import { Timelock__factory } from '../typechain'

interface IAddGrazingRangeRewardInfoParam {
    PHASE_NAME: string
    CAMPAIGN_ID: string
    ENDBLOCK: string
    REWARD_PER_BLOCK: string
}

type IAddGrazingRangeRewardInfoParamList = Array<IAddGrazingRangeRewardInfoParam>

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
  const TIMELOCK = '0xb3c3aE82358DF7fC0bd98629D5ed91767e45c337';
  const GRAZING_RANGE = '0x9Ff38741EB7594aCE7DD8bb8107Da38aEE7005D6'
  const EXACT_ETA = '1619603280';
  const REWARDINFO: IAddGrazingRangeRewardInfoParamList = [{
    PHASE_NAME: 'PHASE_1',
    CAMPAIGN_ID: '0',
    ENDBLOCK: '8380000',
    REWARD_PER_BLOCK: ethers.utils.parseEther('142.857143').toString()
  }]
  











  const timelock = Timelock__factory.connect(TIMELOCK, (await ethers.getSigners())[0]);

  for(let i = 0; i < REWARDINFO.length; i++) {
    const rewardInfo = REWARDINFO[i]
    console.log(`>> Timelock: Adding a grazing range's reward info: "${rewardInfo.PHASE_NAME}" via Timelock`);
    await timelock.queueTransaction(
        GRAZING_RANGE, '0',
        'addRewardInfo(uint256,uint256,uint256)',
        ethers.utils.defaultAbiCoder.encode(
            ['uint256', 'uint256', 'uint256'],
            [
                rewardInfo.CAMPAIGN_ID,
                rewardInfo.ENDBLOCK,
                rewardInfo.REWARD_PER_BLOCK,
            ]
        ), EXACT_ETA
    );
    console.log("generate timelock.executeTransaction:")
    console.log(`await timelock.executeTransaction('${GRAZING_RANGE}', '0', 'addRewardInfo(uint256,uint256,uint256)', ethers.utils.defaultAbiCoder.encode(['uint256', 'uint256', 'uint256'],['${rewardInfo.CAMPAIGN_ID}','${rewardInfo.ENDBLOCK}','${rewardInfo.REWARD_PER_BLOCK}']), ${EXACT_ETA})`)
    console.log("✅ Done");
  }
};

export default func;
func.tags = ['TimelockAddGrazingRangeRewardInfos'];