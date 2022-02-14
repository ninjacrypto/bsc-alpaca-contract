import { ethers, network, upgrades, waffle } from "hardhat";
import { Signer, constants, BigNumber } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import "@openzeppelin/test-helpers";
import {
  AlpacaToken,
  CakeToken,
  DebtToken,
  FairLaunch,
  FairLaunch__factory,
  MockContractContext,
  MockContractContext__factory,
  MockERC20,
  MockERC20__factory,
  MockWBNB,
  PancakeFactory,
  PancakeMasterChef,
  PancakeMasterChef__factory,
  PancakePair,
  PancakePair__factory,
  PancakeRouterV2,
  PancakeswapV2RestrictedStrategyAddBaseTokenOnly,
  PancakeswapV2RestrictedStrategyLiquidate,
  PancakeswapV2RestrictedStrategyPartialCloseLiquidate,
  SimpleVaultConfig,
  SyrupBar,
  Vault,
  Vault__factory,
  WNativeRelayer,
  PancakeswapV2RestrictedStrategyAddTwoSidesOptimal,
  PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading,
  PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading,
  MasterChef,
  DeltaNeutralVault,
  DeltaNeutralVault__factory,
  MockWBNB__factory,
  PancakeswapV2RestrictedStrategyAddTwoSidesOptimal__factory,
  DeltaNeutralVaultConfig,
  DeltaNeutralPancakeWorker02,
  DeltaNeutralPancakeWorker02__factory,
  DeltaNeutralVaultGateway,
  DeltaNeutralVaultGateway__factory,
} from "../../../../typechain";
import * as Assert from "../../../helpers/assert";
import * as TimeHelpers from "../../../helpers/time";
import { parseEther } from "ethers/lib/utils";
import { DeployHelper, IDeltaNeutralVaultConfig } from "../../../helpers/deploy";
import { SwapHelper } from "../../../helpers/swap";
import { Worker02Helper } from "../../../helpers/worker";
import { MockContract, smockit } from "@eth-optimism/smock";
import { zeroAddress } from "ethereumjs-util";

chai.use(solidity);
const { expect } = chai;

describe("DeltaNeutralVaultGateway", () => {
  const FOREVER = "2000000000";
  const ALPACA_BONUS_LOCK_UP_BPS = 7000;
  const ALPACA_REWARD_PER_BLOCK = ethers.utils.parseEther("1");
  // const CAKE_REWARD_PER_BLOCK = ethers.utils.parseEther("0.076");
  const CAKE_REWARD_PER_BLOCK = ethers.utils.parseEther("0");
  const REINVEST_BOUNTY_BPS = "100"; // 1% reinvest bounty
  const RESERVE_POOL_BPS = "1000"; // 10% reserve pool
  const KILL_PRIZE_BPS = "1000"; // 10% Kill prize
  const INTEREST_RATE = "0"; // 0% per year
  const MIN_DEBT_SIZE = ethers.utils.parseEther("0.1"); // 1 BTOKEN min debt size
  const WORK_FACTOR = "999999"; // delta neutral worker should have no cap workfactor
  const KILL_FACTOR = "8000";
  const MAX_REINVEST_BOUNTY: string = "900";
  const DEPLOYER = "0xC44f82b07Ab3E691F826951a6E335E1bC1bB0B51";
  const BENEFICIALVAULT_BOUNTY_BPS = "1000";
  const REINVEST_THRESHOLD = ethers.utils.parseEther("1"); // If pendingCake > 1 $CAKE, then reinvest
  const KILL_TREASURY_BPS = "100";
  const POOL_ID = 1;
  const EMPTY_BYTE = ethers.utils.defaultAbiCoder.encode(["uint256"], [0]);

  // Delta Vault Config
  const REBALANCE_FACTOR = "6800";
  const POSITION_VALUE_TOLERANCE_BPS = "200";
  const MAX_VAULT_POSITION_VALUE = ethers.utils.parseEther("100000");
  const DEPOSIT_FEE_BPS = "0"; // 0%

  // Delta Vault Actions
  const ACTION_WORK = 1;
  const ACTION_WRAP = 2;

  /// Pancakeswap-related instance(s)
  let factoryV2: PancakeFactory;
  let routerV2: PancakeRouterV2;

  let wbnb: MockWBNB;
  let lp: PancakePair;

  /// Token-related instance(s)
  let baseToken: MockERC20;
  let cake: CakeToken;
  let syrup: SyrupBar;
  let debtToken: DebtToken;

  /// Strategy-ralted instance(s)
  let addStrat: PancakeswapV2RestrictedStrategyAddBaseTokenOnly;
  let stableTwoSidesStrat: PancakeswapV2RestrictedStrategyAddTwoSidesOptimal;
  let assetTwoSidesStrat: PancakeswapV2RestrictedStrategyAddTwoSidesOptimal;
  let liqStrat: PancakeswapV2RestrictedStrategyLiquidate;
  let minimizeStrat: PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading;
  let partialCloseStrat: PancakeswapV2RestrictedStrategyPartialCloseLiquidate;
  let partialCloseMinimizeStrat: PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading;

  /// Vault-related instance(s)
  let stableSimpleVaultConfig: SimpleVaultConfig;
  let assetSimpleVaultConfig: SimpleVaultConfig;
  let wNativeRelayer: WNativeRelayer;
  let stableVault: Vault;
  let assetVault: Vault;
  let deltaVault: DeltaNeutralVault;
  let deltaVaultConfig: DeltaNeutralVaultConfig;
  let deltaVaultGateway: DeltaNeutralVaultGateway;

  /// DeltaNeutralOracle instance
  let mockPriceOracle: MockContract;

  /// FairLaunch-related instance(s)
  let fairLaunch: FairLaunch;
  let alpacaToken: AlpacaToken;

  /// PancakeswapMasterChef-related instance(s)
  let masterChef: PancakeMasterChef;
  let stableVaultWorker: DeltaNeutralPancakeWorker02;
  let assetVaultWorker: DeltaNeutralPancakeWorker02;

  /// Timelock instance(s)
  let whitelistedContract: MockContractContext;
  let evilContract: MockContractContext;

  // Accounts
  let deployer: Signer;
  let alice: Signer;
  let bob: Signer;
  let eve: Signer;

  let deployerAddress: string;
  let aliceAddress: string;
  let bobAddress: string;
  let eveAddress: string;

  // Contract Signer
  let baseTokenAsAlice: MockERC20;
  let baseTokenAsBob: MockERC20;
  let baseTokenAsDeployer: MockERC20;

  let wbnbTokenAsAlice: MockWBNB;
  let wbnbTokenAsDeployer: MockWBNB;

  let fairLaunchAsAlice: FairLaunch;

  let lpAsAlice: PancakePair;
  let lpAsBob: PancakePair;

  let pancakeMasterChefAsAlice: PancakeMasterChef;
  let pancakeMasterChefAsBob: PancakeMasterChef;

  let pancakeswapV2WorkerAsEve: DeltaNeutralPancakeWorker02__factory;
  let pancakeswapV2Worker01AsEve: DeltaNeutralPancakeWorker02__factory;

  let deltaVaultAsAlice: DeltaNeutralVault;
  let deltaVaultAsBob: DeltaNeutralVault;
  let deltaVaultAsEve: DeltaNeutralVault;

  let deltaVaultGatewayAsAlice: DeltaNeutralVaultGateway;

  // Test Helper
  let swapHelper: SwapHelper;
  let workerHelper: Worker02Helper;

  async function fixture() {
    [deployer, alice, bob, eve] = await ethers.getSigners();
    [deployerAddress, aliceAddress, bobAddress, eveAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      eve.getAddress(),
    ]);
    const deployHelper = new DeployHelper(deployer);
    // Setup MockContractContext
    const MockContractContext = (await ethers.getContractFactory(
      "MockContractContext",
      deployer
    )) as MockContractContext__factory;
    whitelistedContract = await MockContractContext.deploy();
    await whitelistedContract.deployed();
    evilContract = await MockContractContext.deploy();
    await evilContract.deployed();

    // Setup IDeltaNeutralOracle
    mockPriceOracle = await smockit(await ethers.getContractFactory("DeltaNeutralOracle", deployer));

    /// Setup token stuffs
    [baseToken] = await deployHelper.deployBEP20([
      {
        name: "BTOKEN",
        symbol: "BTOKEN",
        decimals: "18",
        holders: [
          { address: deployerAddress, amount: ethers.utils.parseEther("100000000") },
          { address: aliceAddress, amount: ethers.utils.parseEther("100000000") },
          { address: bobAddress, amount: ethers.utils.parseEther("100000000") },
        ],
      },
    ]);
    wbnb = await deployHelper.deployWBNB();

    await wbnb.mint(deployerAddress, ethers.utils.parseEther("100000000"));
    await wbnb.mint(aliceAddress, ethers.utils.parseEther("100000000"));
    await wbnb.mint(bobAddress, ethers.utils.parseEther("100000000"));

    [factoryV2, routerV2, cake, syrup, masterChef] = await deployHelper.deployPancakeV2(wbnb, CAKE_REWARD_PER_BLOCK, [
      { address: deployerAddress, amount: ethers.utils.parseEther("100") },
    ]);

    [alpacaToken, fairLaunch] = await deployHelper.deployAlpacaFairLaunch(
      ALPACA_REWARD_PER_BLOCK,
      ALPACA_BONUS_LOCK_UP_BPS,
      2000,
      2500
    );

    [stableVault, stableSimpleVaultConfig, wNativeRelayer] = await deployHelper.deployVault(
      wbnb,
      {
        minDebtSize: MIN_DEBT_SIZE,
        interestRate: INTEREST_RATE,
        reservePoolBps: RESERVE_POOL_BPS,
        killPrizeBps: KILL_PRIZE_BPS,
        killTreasuryBps: KILL_TREASURY_BPS,
        killTreasuryAddress: DEPLOYER,
      },
      fairLaunch,
      baseToken
    );

    [assetVault, assetSimpleVaultConfig] = await deployHelper.deployVault(
      wbnb,
      {
        minDebtSize: MIN_DEBT_SIZE,
        interestRate: INTEREST_RATE,
        reservePoolBps: RESERVE_POOL_BPS,
        killPrizeBps: KILL_PRIZE_BPS,
        killTreasuryBps: KILL_TREASURY_BPS,
        killTreasuryAddress: DEPLOYER,
      },
      fairLaunch,
      wbnb as unknown as MockERC20
    );
    await assetVault.setFairLaunchPoolId(1);

    // Setup strategies
    [addStrat, liqStrat, stableTwoSidesStrat, minimizeStrat, partialCloseStrat, partialCloseMinimizeStrat] =
      await deployHelper.deployPancakeV2Strategies(routerV2, stableVault, wbnb, wNativeRelayer);

    const PancakeswapV2RestrictedStrategyAddTwoSidesOptimal = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedStrategyAddTwoSidesOptimal",
      deployer
    )) as PancakeswapV2RestrictedStrategyAddTwoSidesOptimal__factory;
    assetTwoSidesStrat = (await upgrades.deployProxy(PancakeswapV2RestrictedStrategyAddTwoSidesOptimal, [
      routerV2.address,
      assetVault.address,
    ])) as PancakeswapV2RestrictedStrategyAddTwoSidesOptimal;

    // Setup BTOKEN-WBNB pair on Pancakeswap
    // Add lp to masterChef's pool
    await factoryV2.createPair(baseToken.address, wbnb.address);
    lp = PancakePair__factory.connect(await factoryV2.getPair(wbnb.address, baseToken.address), deployer);
    await masterChef.add(1, lp.address, true);

    /// Setup DeltaNeutralPancakeWorker02
    stableVaultWorker = await deployHelper.deployDeltaNeutralPancakeWorker02(
      stableVault,
      baseToken,
      masterChef,
      routerV2,
      POOL_ID,
      WORK_FACTOR,
      KILL_FACTOR,
      addStrat,
      REINVEST_BOUNTY_BPS,
      [eveAddress],
      DEPLOYER,
      [cake.address, wbnb.address, baseToken.address],
      [
        stableTwoSidesStrat.address,
        minimizeStrat.address,
        partialCloseStrat.address,
        partialCloseMinimizeStrat.address,
      ],
      stableSimpleVaultConfig,
      mockPriceOracle.address
    );

    /// Setup DeltaNeutralPancakeWorker02
    assetVaultWorker = await deployHelper.deployDeltaNeutralPancakeWorker02(
      assetVault,
      wbnb as unknown as MockERC20,
      masterChef,
      routerV2,
      POOL_ID,
      WORK_FACTOR,
      KILL_FACTOR,
      addStrat,
      REINVEST_BOUNTY_BPS,
      [eveAddress],
      DEPLOYER,
      [cake.address, wbnb.address],
      [assetTwoSidesStrat.address, minimizeStrat.address, partialCloseStrat.address, partialCloseMinimizeStrat.address],
      assetSimpleVaultConfig,
      mockPriceOracle.address
    );

    swapHelper = new SwapHelper(
      factoryV2.address,
      routerV2.address,
      BigNumber.from(9975),
      BigNumber.from(10000),
      deployer
    );

    await swapHelper.addLiquidities([
      {
        token0: cake,
        token1: wbnb,
        amount0desired: ethers.utils.parseEther("100"),
        amount1desired: ethers.utils.parseEther("1000"),
      },
    ]);

    // Set up Delta Neutral Vault Config
    const deltaNeutralConfig = {
      wNativeAddr: wbnb.address,
      wNativeRelayer: wNativeRelayer.address,
      fairlaunchAddr: fairLaunch.address,
      rebalanceFactor: REBALANCE_FACTOR,
      positionValueTolerance: POSITION_VALUE_TOLERANCE_BPS,
      treasuryAddr: eveAddress,
      alpacaBountyBps: BigNumber.from("100"),
      alpacaTokenAddress: alpacaToken.address,
    } as IDeltaNeutralVaultConfig;

    deltaVaultConfig = await deployHelper.deployDeltaNeutralVaultConfig(deltaNeutralConfig);
    // allow deployer to call rebalance
    await deltaVaultConfig.setValueLimit(MAX_VAULT_POSITION_VALUE);
    await deltaVaultConfig.setWhitelistedRebalancer([deployerAddress], true);
    await deltaVaultConfig.setLeverageLevel(3);
    await deltaVaultConfig.setwhitelistedReinvestors([deployerAddress], true);
    const reinvestStablePath = [alpacaToken.address, baseToken.address];
    await deltaVaultConfig.setSwapRouter(routerV2.address);
    await deltaVaultConfig.setReinvestPath(reinvestStablePath);

    // Setup Delta Neutral Vault
    const deltaNeutral = {
      name: "DELTA_NEUTRAL_VAULT",
      symbol: "DELTA_NEUTRAL_VAULT",
      vaultStable: stableVault.address,
      vaultAsset: assetVault.address,
      stableVaultWorker: stableVaultWorker.address,
      assetVaultWorker: assetVaultWorker.address,
      lpToken: lp.address,
      alpacaToken: alpacaToken.address, // change this to alpaca token address
      deltaNeutralOracle: mockPriceOracle.address,
      deltaVaultConfig: deltaVaultConfig.address,
    };
    deltaVault = await deployHelper.deployDeltaNeutralVault(deltaNeutral);

    // Setup Delta Neutral Gateway
    deltaVaultGateway = await deployHelper.deployDeltaNeutralGateway({
      name: "DELTA_NEUTRAL_VAULT_GATEWAY",
      symbol: "DELTA_NEUTRAL_VAULT_GATEWAY",
      deltaVault: deltaVault.address,
    });
    // allow deltaVaultGateway as whitelisted to call delta neutral vault
    await deltaVaultConfig.setWhitelistedCallers([deltaVaultGateway.address], true);

    //whitelisted delta neutral vault contract to call work function
    await stableVaultWorker.setWhitelistedCallers([deltaVault.address], true);
    await assetVaultWorker.setWhitelistedCallers([deltaVault.address], true);

    // whitelisted contract to be able to call work
    await stableSimpleVaultConfig.setWhitelistedCallers([whitelistedContract.address, deltaVault.address], true);
    await assetSimpleVaultConfig.setWhitelistedCallers([whitelistedContract.address, deltaVault.address], true);

    // Set approved add strategies
    await stableSimpleVaultConfig.setApprovedAddStrategy([addStrat.address, stableTwoSidesStrat.address], true);
    await assetSimpleVaultConfig.setApprovedAddStrategy([addStrat.address, assetTwoSidesStrat.address], true);

    // set ok caller to wNativeRelayer
    await wNativeRelayer.setCallerOk([stableVault.address, assetVault.address, deltaVault.address], true);

    // Contract signer
    baseTokenAsAlice = MockERC20__factory.connect(baseToken.address, alice);
    baseTokenAsBob = MockERC20__factory.connect(baseToken.address, bob);
    baseTokenAsDeployer = MockERC20__factory.connect(baseToken.address, deployer);

    wbnbTokenAsAlice = MockWBNB__factory.connect(wbnb.address, alice);
    wbnbTokenAsDeployer = MockWBNB__factory.connect(wbnb.address, deployer);

    lpAsAlice = PancakePair__factory.connect(lp.address, alice);
    lpAsBob = PancakePair__factory.connect(lp.address, bob);

    fairLaunchAsAlice = FairLaunch__factory.connect(fairLaunch.address, alice);

    pancakeMasterChefAsAlice = PancakeMasterChef__factory.connect(masterChef.address, alice);
    pancakeMasterChefAsBob = PancakeMasterChef__factory.connect(masterChef.address, bob);

    deltaVaultAsAlice = DeltaNeutralVault__factory.connect(deltaVault.address, alice);
    deltaVaultAsBob = DeltaNeutralVault__factory.connect(deltaVault.address, bob);
    deltaVaultAsEve = DeltaNeutralVault__factory.connect(deltaVault.address, eve);

    deltaVaultGatewayAsAlice = DeltaNeutralVaultGateway__factory.connect(deltaVaultGateway.address, alice);

    // Set block base fee per gas to 0
    await network.provider.send("hardhat_setNextBlockBaseFeePerGas", ["0x0"]);
  }

  interface IDepositWorkByte {
    posId: number;
    vaultAddress: string;
    workerAddress: string;
    twoSidesStrat: string;
    principalAmount: BigNumber;
    borrowAmount: BigNumber;
    maxReturn: BigNumber;
    farmingTokenAmount: BigNumber;
    minLpReceive: BigNumber;
  }

  interface IWithdrawWorkByte {
    posId: number;
    vaultAddress: string;
    workerAddress: string;
    partialCloseMinimizeStrat: string;
    debt: BigNumber;
    maxLpTokenToLiquidate: BigNumber;
    maxDebtRepayment: BigNumber;
    minFarmingToken: BigNumber;
  }

  function buildDepositWorkByte(input: IDepositWorkByte): string {
    const workByte = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "address", "uint256", "uint256", "uint256", "bytes"],
      [
        input.vaultAddress,
        input.posId,
        input.workerAddress,
        input.principalAmount,
        input.borrowAmount,
        input.maxReturn,
        ethers.utils.defaultAbiCoder.encode(
          ["address", "bytes"],
          [
            input.twoSidesStrat,
            ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [input.farmingTokenAmount, input.minLpReceive]),
          ]
        ),
      ]
    );
    return workByte;
  }

  function buildWithdrawWorkByte(input: IWithdrawWorkByte): string {
    const withdrawWorkByte = ethers.utils.defaultAbiCoder.encode(
      ["address", "uint256", "address", "uint256", "uint256", "uint256", "bytes"],
      [
        input.vaultAddress,
        input.posId,
        input.workerAddress,
        "0",
        "0",
        input.debt,
        ethers.utils.defaultAbiCoder.encode(
          ["address", "bytes"],
          [
            input.partialCloseMinimizeStrat,
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "uint256", "uint256"],
              [input.maxLpTokenToLiquidate, input.maxDebtRepayment, input.minFarmingToken]
            ),
          ]
        ),
      ]
    );
    return withdrawWorkByte;
  }

  async function setMockTokenPrice(stableTokenPrice: BigNumber, assetTokenPrice: BigNumber, lastUpdate?: BigNumber) {
    const latest = lastUpdate ? lastUpdate : await TimeHelpers.latest();
    mockPriceOracle.smocked.getTokenPrice.will.return.with((token: string) => {
      if (token === baseToken.address) {
        return [stableTokenPrice, latest];
      }
      if (token === wbnb.address) {
        return [assetTokenPrice, latest];
      }
      return [0, latest];
    });
  }

  async function setMockLpPrice(lpPrice: BigNumber, lastUpdate?: BigNumber) {
    const latest = lastUpdate ? lastUpdate : await TimeHelpers.latest();
    mockPriceOracle.smocked.lpToDollar.will.return.with((lpAmount: BigNumber) => {
      return [lpAmount.mul(lpPrice).div(ethers.utils.parseEther("1")), latest];
    });
  }

  beforeEach(async () => {
    await waffle.loadFixture(fixture);
    // depsit fund into vaults
    await baseTokenAsDeployer.approve(stableVault.address, ethers.utils.parseEther("10000"));
    await stableVault.deposit(ethers.utils.parseEther("10000"));

    await wbnbTokenAsDeployer.approve(assetVault.address, ethers.utils.parseEther("10000"));
    await assetVault.deposit(ethers.utils.parseEther("10000"));
  });

  describe("#withdraw", async () => {
    describe("when positions initialized", async () => {
      beforeEach(async () => {
        // add liquidity
        await swapHelper.addLiquidities([
          {
            token0: baseToken,
            token1: wbnb,
            amount0desired: ethers.utils.parseEther("90000000"),
            amount1desired: ethers.utils.parseEther("90000000"),
          },
        ]);
        const stableTokenAmount = ethers.utils.parseEther("500");
        const assetTokenAmount = ethers.utils.parseEther("500");
        await baseTokenAsDeployer.approve(deltaVault.address, stableTokenAmount);

        const stableWorkbyteInput: IDepositWorkByte = {
          posId: 0,
          vaultAddress: stableVault.address,
          workerAddress: stableVaultWorker.address,
          twoSidesStrat: stableTwoSidesStrat.address,
          principalAmount: ethers.utils.parseEther("125"),
          borrowAmount: ethers.utils.parseEther("500"),
          farmingTokenAmount: ethers.utils.parseEther("125"),
          maxReturn: BigNumber.from(0),
          minLpReceive: BigNumber.from(0),
        };

        const assetWorkbyteInput: IDepositWorkByte = {
          posId: 0,
          vaultAddress: assetVault.address,
          workerAddress: assetVaultWorker.address,
          twoSidesStrat: assetTwoSidesStrat.address,
          principalAmount: ethers.utils.parseEther("375"),
          borrowAmount: ethers.utils.parseEther("1500"),
          farmingTokenAmount: ethers.utils.parseEther("375"),
          maxReturn: BigNumber.from(0),
          minLpReceive: BigNumber.from(0),
        };

        const stableWorkByte = buildDepositWorkByte(stableWorkbyteInput);
        const assetWorkByte = buildDepositWorkByte(assetWorkbyteInput);

        const data = ethers.utils.defaultAbiCoder.encode(
          ["uint8[]", "uint256[]", "bytes[]"],
          [
            [ACTION_WORK, ACTION_WORK],
            [0, 0],
            [stableWorkByte, assetWorkByte],
          ]
        );
        const stableTokenPrice = ethers.utils.parseEther("1");
        const assetTokenPrice = ethers.utils.parseEther("1");
        const lpPrice = ethers.utils.parseEther("2");

        await setMockTokenPrice(stableTokenPrice, assetTokenPrice);
        await setMockLpPrice(lpPrice);

        const initTx = await deltaVault.initPositions(
          stableTokenAmount,
          assetTokenAmount,
          ethers.utils.parseEther("1000"),
          data,
          {
            value: assetTokenAmount,
          }
        );

        const depositStableTokenAmount = ethers.utils.parseEther("500");
        const depositAssetTokenAmount = ethers.utils.parseEther("500");

        await baseTokenAsAlice.approve(deltaVault.address, depositStableTokenAmount);

        const depositStableWorkbyteInput: IDepositWorkByte = {
          posId: 1,
          vaultAddress: stableVault.address,
          workerAddress: stableVaultWorker.address,
          twoSidesStrat: stableTwoSidesStrat.address,
          principalAmount: ethers.utils.parseEther("125"),
          borrowAmount: ethers.utils.parseEther("500"),
          farmingTokenAmount: ethers.utils.parseEther("125"),
          maxReturn: BigNumber.from(0),
          minLpReceive: BigNumber.from(0),
        };

        const depositAssetWorkbyteInput: IDepositWorkByte = {
          posId: 1,
          vaultAddress: assetVault.address,
          workerAddress: assetVaultWorker.address,
          twoSidesStrat: assetTwoSidesStrat.address,
          principalAmount: ethers.utils.parseEther("375"),
          borrowAmount: ethers.utils.parseEther("1500"),
          farmingTokenAmount: ethers.utils.parseEther("375"),
          maxReturn: BigNumber.from(0),
          minLpReceive: BigNumber.from(0),
        };

        const depositStableWorkByte = buildDepositWorkByte(depositStableWorkbyteInput);
        const depositAssetWorkByte = buildDepositWorkByte(depositAssetWorkbyteInput);

        const depositData = ethers.utils.defaultAbiCoder.encode(
          ["uint8[]", "uint256[]", "bytes[]"],
          [
            [ACTION_WORK, ACTION_WORK],
            [0, 0],
            [depositStableWorkByte, depositAssetWorkByte],
          ]
        );

        const depositTx = await deltaVaultAsAlice.deposit(
          depositStableTokenAmount,
          depositAssetTokenAmount,
          aliceAddress,
          0,
          depositData,
          {
            value: depositAssetTokenAmount,
          }
        );
      });

      context("when alice withdraw from delta neutral vault gateway", async () => {
        it("should be able to withdraw and expected returns stable amount 100%", async () => {
          await swapHelper.loadReserves([baseToken.address, wbnb.address]);
          const lpPrice = await swapHelper.computeLpHealth(
            ethers.utils.parseEther("1"),
            baseToken.address,
            wbnb.address
          );

          await setMockLpPrice(lpPrice);

          // Current Delta Neutral Position
          // Stable Position:
          // Equity=496.859775279132755434, PositionValue=1496.859775279132755434 Debt=1000.00
          // Asset Position:
          // Equity=1490.562691116413626439, PositionValue=4490.562691116413626439, Debt=3000.00
          // totalEquity=496.859775279132755434 + 1490.562691116413626439 = 1987.422466395546381873

          // ***** Target: Delta Neutral Position After Withdraw 200 Equity *****
          // totalEquity = 1987.422466395546381873 - 200 = 1787.422466395546381873
          // - % equity to withdraw
          // % stableEquity = 496.859775279132755434/1987.422466395546381873 = 0.250002092499363611
          // % assetEquity = 1490.562691116413626439/1987.422466395546381873 = 0.749997907500636388

          // Target Stable Position:
          // Equity = 1787.422466395546381873*0.250002092499363611 = 446.859356779260032153
          // PositionValue = 446.859356779260032153 * Lerverage = 446.859356779260032153*3 = 1340.578070337780096459
          // Debt = 1340.578070337780096459 - 446.859356779260032153 = 893.718713558520064306
          // deltaEquity = 446.859356779260032153 - 496.859775279132755434 = -50.000418499872723281
          // debtaDebt = 893.718713558520064306 - 1000.00 = -106.281286441479935694

          // deltaEquityWithSlippage = -50.000418499872723281 * 9970/10000 = -49.850417244373105111
          // deltaDebtWithSlippage = -106.281286441479935694 * 9970/10000 = -105.962442582155495886

          // expectStableEquity = 446.859356779260032153 + (50.000418499872723281 - 49.850417244373105111) = 447.009358034759650323
          // expectStableDebt = 893.718713558520064306 + (106.281286441479935694 - 105.962442582155495886) = 894.037557417844504114

          // Target Asset Position:
          // Equity = 1787.422466395546381873 * 0.749997907500636388 = 1340.563109616286347932
          // PositionValue = 1340.563109616286347932 * 3 = 4021.689328848859043796
          // Debt = 4021.689328848859043796 - 1340.563109616286347932 = 2681.126219232572695864
          // deltaEquity = 1340.563109616286347932 - 1490.562691116413626439 = -149.999581500127278507
          // debtaDebt = 2681.126219232572695864 - 3000  = -318.873780767427304136

          // deltaEquityWithSlippage = -149.999581500127278507 * 9970/10000 = -149.549582755626896671
          // deltaDebtWithSlippage = -318.873780767427304136 * 9970/10000 = -317.917159425125022223

          // expectAssetEquity = 1340.563109616286347932 + (149.999581500127278507 - 149.549582755626896671) = 1341.013108360786729768
          // expectAssetDebt = 2681.126219232572695864 + (318.873780767427304136 - 317.917159425125022223) = 2682.082840574874977777

          const expectStableEquity = ethers.utils.parseEther("447.009358034759650323");
          const expectStableDebt = ethers.utils.parseEther("894.037557417844504114");
          const expectAssetEquity = ethers.utils.parseEther("1341.013108360786729768");
          const expectAssetDebt = ethers.utils.parseEther("2682.082840574874977777");

          // Action1: partialCloseMinimize lp = 78.004799780378508254
          // return stableToken = 105.962442582155495886, repay debt -105.962442582155495886, remaining = 0
          // return assetToken = 49.976458329680142948

          const stableDebtToRepay = ethers.utils.parseEther("105.962442582155495886");
          const stableValueToWithDraw = ethers.utils.parseEther("49.850417244373105111").add(stableDebtToRepay);
          const lpStableToLiquidate = stableValueToWithDraw.mul(ethers.utils.parseEther("1")).div(lpPrice);

          const stableWithdrawInput: IWithdrawWorkByte = {
            posId: 1,
            vaultAddress: stableVault.address,
            workerAddress: stableVaultWorker.address,
            partialCloseMinimizeStrat: partialCloseMinimizeStrat.address,
            debt: stableDebtToRepay,
            maxLpTokenToLiquidate: lpStableToLiquidate, // lp amount to withdraw consists of both equity and debt
            maxDebtRepayment: stableDebtToRepay,
            minFarmingToken: BigNumber.from(0),
          };

          // Action2: partialCloseMinimize lp = 234.028498471773286624
          // return stableToken = 149.931452849760353839
          // return assetToken = 317.917159425125022223, repay debt -317.917159425125022223, remaining = 0

          const assetDebtToRepay = ethers.utils.parseEther("317.917159425125022223");
          const assetValueToWithDraw = ethers.utils.parseEther("149.549582755626896671").add(assetDebtToRepay);
          const lpAssetToLiquidate = assetValueToWithDraw.mul(ethers.utils.parseEther("1")).div(lpPrice);

          const assetWithdrawInput: IWithdrawWorkByte = {
            posId: 1,
            vaultAddress: assetVault.address,
            workerAddress: assetVaultWorker.address,
            partialCloseMinimizeStrat: partialCloseMinimizeStrat.address,
            debt: assetDebtToRepay,
            maxLpTokenToLiquidate: lpAssetToLiquidate,
            maxDebtRepayment: assetDebtToRepay,
            minFarmingToken: BigNumber.from(0),
          };

          const stableWithdrawWorkByte = buildWithdrawWorkByte(stableWithdrawInput);
          const assetWithdrawWorkByte = buildWithdrawWorkByte(assetWithdrawInput);

          const withdrawData = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "uint256[]", "bytes[]"],
            [
              [ACTION_WORK, ACTION_WORK],
              [0, 0],
              [stableWithdrawWorkByte, assetWithdrawWorkByte],
            ]
          );

          await deltaVaultAsAlice.approve(deltaVaultGateway.address, await deltaVault.balanceOf(aliceAddress));

          const withdrawValue = ethers.utils.parseEther("200");
          const shareToWithdraw = await deltaVault.valueToShare(withdrawValue);
          const aliceShareBefore = await deltaVault.balanceOf(aliceAddress);
          const alicebaseTokenBefore = await baseToken.balanceOf(aliceAddress);

          // ======== withdraw ======
          const minStableTokenReceive = ethers.utils.parseEther("149.931452849760353839");
          const minAssetTokenReceive = ethers.utils.parseEther("49.976458329680142948");

          const withdrawTx = await deltaVaultGatewayAsAlice.withdraw(
            shareToWithdraw,
            minStableTokenReceive,
            minAssetTokenReceive,
            withdrawData,
            10000,
            { gasPrice: 0 }
          );
          const gatewayShare = await deltaVault.balanceOf(deltaVaultGatewayAsAlice.address);
          expect(gatewayShare).to.be.eq(BigNumber.from(0));
          expect(await baseToken.balanceOf(deltaVaultGateway.address)).to.be.eq(BigNumber.from(0));
          expect(await wbnb.balanceOf(deltaVaultGateway.address)).to.be.eq(BigNumber.from(0));

          const aliceShareAfter = await deltaVault.balanceOf(aliceAddress);
          const alicebaseTokenAfter = await baseToken.balanceOf(aliceAddress);
          const positionInfoAfter = await deltaVault.positionInfo();
          const baseTokenDiff = alicebaseTokenAfter.sub(alicebaseTokenBefore);
          expect(aliceShareBefore.sub(aliceShareAfter)).to.eq(shareToWithdraw);

          Assert.assertAlmostEqual(positionInfoAfter.stablePositionEquity.toString(), expectStableEquity.toString());
          Assert.assertAlmostEqual(positionInfoAfter.stablePositionDebtValue.toString(), expectStableDebt.toString());
          Assert.assertAlmostEqual(positionInfoAfter.assetPositionEquity.toString(), expectAssetEquity.toString());
          Assert.assertAlmostEqual(positionInfoAfter.assetPositionDebtValue.toString(), expectAssetDebt.toString());

          expect(withdrawTx).to.emit(deltaVaultGateway, "LogWithdraw").withArgs(aliceAddress, baseTokenDiff, 0);
        });

        it("should be able to withdraw and expected returns native amount 100%", async () => {
          await swapHelper.loadReserves([baseToken.address, wbnb.address]);
          const lpPrice = await swapHelper.computeLpHealth(
            ethers.utils.parseEther("1"),
            baseToken.address,
            wbnb.address
          );

          await setMockLpPrice(lpPrice);

          // Current Delta Neutral Position
          // Stable Position:
          // Equity=496.859775279132755434, PositionValue=1496.859775279132755434 Debt=1000.00
          // Asset Position:
          // Equity=1490.562691116413626439, PositionValue=4490.562691116413626439, Debt=3000.00
          // totalEquity=496.859775279132755434 + 1490.562691116413626439 = 1987.422466395546381873

          // ***** Target: Delta Neutral Position After Withdraw 200 Equity *****
          // totalEquity = 1987.422466395546381873 - 200 = 1787.422466395546381873
          // - % equity to withdraw
          // % stableEquity = 496.859775279132755434/1987.422466395546381873 = 0.250002092499363611
          // % assetEquity = 1490.562691116413626439/1987.422466395546381873 = 0.749997907500636388

          // Target Stable Position:
          // Equity = 1787.422466395546381873*0.250002092499363611 = 446.859356779260032153
          // PositionValue = 446.859356779260032153 * Lerverage = 446.859356779260032153*3 = 1340.578070337780096459
          // Debt = 1340.578070337780096459 - 446.859356779260032153 = 893.718713558520064306
          // deltaEquity = 446.859356779260032153 - 496.859775279132755434 = -50.000418499872723281
          // debtaDebt = 893.718713558520064306 - 1000.00 = -106.281286441479935694

          // deltaEquityWithSlippage = -50.000418499872723281 * 9970/10000 = -49.850417244373105111
          // deltaDebtWithSlippage = -106.281286441479935694 * 9970/10000 = -105.962442582155495886

          // expectStableEquity = 446.859356779260032153 + (50.000418499872723281 - 49.850417244373105111) = 447.009358034759650323
          // expectStableDebt = 893.718713558520064306 + (106.281286441479935694 - 105.962442582155495886) = 894.037557417844504114

          // Target Asset Position:
          // Equity = 1787.422466395546381873 * 0.749997907500636388 = 1340.563109616286347932
          // PositionValue = 1340.563109616286347932 * 3 = 4021.689328848859043796
          // Debt = 4021.689328848859043796 - 1340.563109616286347932 = 2681.126219232572695864
          // deltaEquity = 1340.563109616286347932 - 1490.562691116413626439 = -149.999581500127278507
          // debtaDebt = 2681.126219232572695864 - 3000  = -318.873780767427304136

          // deltaEquityWithSlippage = -149.999581500127278507 * 9970/10000 = -149.549582755626896671
          // deltaDebtWithSlippage = -318.873780767427304136 * 9970/10000 = -317.917159425125022223

          // expectAssetEquity = 1340.563109616286347932 + (149.999581500127278507 - 149.549582755626896671) = 1341.013108360786729768
          // expectAssetDebt = 2681.126219232572695864 + (318.873780767427304136 - 317.917159425125022223) = 2682.082840574874977777

          const expectStableEquity = ethers.utils.parseEther("447.009358034759650323");
          const expectStableDebt = ethers.utils.parseEther("894.037557417844504114");
          const expectAssetEquity = ethers.utils.parseEther("1341.013108360786729768");
          const expectAssetDebt = ethers.utils.parseEther("2682.082840574874977777");

          // Action1: partialCloseMinimize lp = 78.004799780378508254
          // return stableToken = 105.962442582155495886, repay debt -105.962442582155495886, remaining = 0
          // return assetToken = 49.976458329680142948

          const stableDebtToRepay = ethers.utils.parseEther("105.962442582155495886");
          const stableValueToWithDraw = ethers.utils.parseEther("49.850417244373105111").add(stableDebtToRepay);
          const lpStableToLiquidate = stableValueToWithDraw.mul(ethers.utils.parseEther("1")).div(lpPrice);

          const stableWithdrawInput: IWithdrawWorkByte = {
            posId: 1,
            vaultAddress: stableVault.address,
            workerAddress: stableVaultWorker.address,
            partialCloseMinimizeStrat: partialCloseMinimizeStrat.address,
            debt: stableDebtToRepay,
            maxLpTokenToLiquidate: lpStableToLiquidate, // lp amount to withdraw consists of both equity and debt
            maxDebtRepayment: stableDebtToRepay,
            minFarmingToken: BigNumber.from(0),
          };

          // Action2: partialCloseMinimize lp = 234.028498471773286624
          // return stableToken = 149.931452849760353839
          // return assetToken = 317.917159425125022223, repay debt -317.917159425125022223, remaining = 0

          const assetDebtToRepay = ethers.utils.parseEther("317.917159425125022223");
          const assetValueToWithDraw = ethers.utils.parseEther("149.549582755626896671").add(assetDebtToRepay);
          const lpAssetToLiquidate = assetValueToWithDraw.mul(ethers.utils.parseEther("1")).div(lpPrice);

          const assetWithdrawInput: IWithdrawWorkByte = {
            posId: 1,
            vaultAddress: assetVault.address,
            workerAddress: assetVaultWorker.address,
            partialCloseMinimizeStrat: partialCloseMinimizeStrat.address,
            debt: assetDebtToRepay,
            maxLpTokenToLiquidate: lpAssetToLiquidate,
            maxDebtRepayment: assetDebtToRepay,
            minFarmingToken: BigNumber.from(0),
          };

          const stableWithdrawWorkByte = buildWithdrawWorkByte(stableWithdrawInput);
          const assetWithdrawWorkByte = buildWithdrawWorkByte(assetWithdrawInput);

          const withdrawData = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "uint256[]", "bytes[]"],
            [
              [ACTION_WORK, ACTION_WORK],
              [0, 0],
              [stableWithdrawWorkByte, assetWithdrawWorkByte],
            ]
          );

          await deltaVaultAsAlice.approve(deltaVaultGateway.address, await deltaVault.balanceOf(aliceAddress));

          const withdrawValue = ethers.utils.parseEther("200");
          const shareToWithdraw = await deltaVault.valueToShare(withdrawValue);
          const aliceShareBefore = await deltaVault.balanceOf(aliceAddress);
          const aliceNativeBefore = await alice.getBalance();

          // ======== withdraw ======
          const minStableTokenReceive = ethers.utils.parseEther("149.931452849760353839");
          const minAssetTokenReceive = ethers.utils.parseEther("49.976458329680142948");

          const withdrawTx = await deltaVaultGatewayAsAlice.withdraw(
            shareToWithdraw,
            minStableTokenReceive,
            minAssetTokenReceive,
            withdrawData,
            0,
            { gasPrice: 0 }
          );
          const gatewayShare = await deltaVault.balanceOf(deltaVaultGatewayAsAlice.address);
          expect(gatewayShare).to.be.eq(BigNumber.from(0));
          expect(await baseToken.balanceOf(deltaVaultGateway.address)).to.be.eq(BigNumber.from(0));
          expect(await wbnb.balanceOf(deltaVaultGateway.address)).to.be.eq(BigNumber.from(0));

          const aliceShareAfter = await deltaVault.balanceOf(aliceAddress);
          const aliceNativeAfter = await alice.getBalance();
          const positionInfoAfter = await deltaVault.positionInfo();

          const nativeTokenDiff = aliceNativeAfter.sub(aliceNativeBefore);
          expect(aliceShareBefore.sub(aliceShareAfter)).to.eq(shareToWithdraw);

          Assert.assertAlmostEqual(positionInfoAfter.stablePositionEquity.toString(), expectStableEquity.toString());
          Assert.assertAlmostEqual(positionInfoAfter.stablePositionDebtValue.toString(), expectStableDebt.toString());
          Assert.assertAlmostEqual(positionInfoAfter.assetPositionEquity.toString(), expectAssetEquity.toString());
          Assert.assertAlmostEqual(positionInfoAfter.assetPositionDebtValue.toString(), expectAssetDebt.toString());

          expect(withdrawTx).to.emit(deltaVaultGateway, "LogWithdraw").withArgs(aliceAddress, 0, nativeTokenDiff);
        });

        it("should be able to withdraw and expected returns stable amount 50% and native amount 50%", async () => {
          await swapHelper.loadReserves([baseToken.address, wbnb.address]);
          const lpPrice = await swapHelper.computeLpHealth(
            ethers.utils.parseEther("1"),
            baseToken.address,
            wbnb.address
          );

          await setMockLpPrice(lpPrice);

          // Current Delta Neutral Position
          // Stable Position:
          // Equity=496.859775279132755434, PositionValue=1496.859775279132755434 Debt=1000.00
          // Asset Position:
          // Equity=1490.562691116413626439, PositionValue=4490.562691116413626439, Debt=3000.00
          // totalEquity=496.859775279132755434 + 1490.562691116413626439 = 1987.422466395546381873

          // ***** Target: Delta Neutral Position After Withdraw 200 Equity *****
          // totalEquity = 1987.422466395546381873 - 200 = 1787.422466395546381873
          // - % equity to withdraw
          // % stableEquity = 496.859775279132755434/1987.422466395546381873 = 0.250002092499363611
          // % assetEquity = 1490.562691116413626439/1987.422466395546381873 = 0.749997907500636388

          // Target Stable Position:
          // Equity = 1787.422466395546381873*0.250002092499363611 = 446.859356779260032153
          // PositionValue = 446.859356779260032153 * Lerverage = 446.859356779260032153*3 = 1340.578070337780096459
          // Debt = 1340.578070337780096459 - 446.859356779260032153 = 893.718713558520064306
          // deltaEquity = 446.859356779260032153 - 496.859775279132755434 = -50.000418499872723281
          // debtaDebt = 893.718713558520064306 - 1000.00 = -106.281286441479935694

          // deltaEquityWithSlippage = -50.000418499872723281 * 9970/10000 = -49.850417244373105111
          // deltaDebtWithSlippage = -106.281286441479935694 * 9970/10000 = -105.962442582155495886

          // expectStableEquity = 446.859356779260032153 + (50.000418499872723281 - 49.850417244373105111) = 447.009358034759650323
          // expectStableDebt = 893.718713558520064306 + (106.281286441479935694 - 105.962442582155495886) = 894.037557417844504114

          // Target Asset Position:
          // Equity = 1787.422466395546381873 * 0.749997907500636388 = 1340.563109616286347932
          // PositionValue = 1340.563109616286347932 * 3 = 4021.689328848859043796
          // Debt = 4021.689328848859043796 - 1340.563109616286347932 = 2681.126219232572695864
          // deltaEquity = 1340.563109616286347932 - 1490.562691116413626439 = -149.999581500127278507
          // debtaDebt = 2681.126219232572695864 - 3000  = -318.873780767427304136

          // deltaEquityWithSlippage = -149.999581500127278507 * 9970/10000 = -149.549582755626896671
          // deltaDebtWithSlippage = -318.873780767427304136 * 9970/10000 = -317.917159425125022223

          // expectAssetEquity = 1340.563109616286347932 + (149.999581500127278507 - 149.549582755626896671) = 1341.013108360786729768
          // expectAssetDebt = 2681.126219232572695864 + (318.873780767427304136 - 317.917159425125022223) = 2682.082840574874977777

          const expectStableEquity = ethers.utils.parseEther("447.009358034759650323");
          const expectStableDebt = ethers.utils.parseEther("894.037557417844504114");
          const expectAssetEquity = ethers.utils.parseEther("1341.013108360786729768");
          const expectAssetDebt = ethers.utils.parseEther("2682.082840574874977777");

          // Action1: partialCloseMinimize lp = 78.004799780378508254
          // return stableToken = 105.962442582155495886, repay debt -105.962442582155495886, remaining = 0
          // return assetToken = 49.976458329680142948

          const stableDebtToRepay = ethers.utils.parseEther("105.962442582155495886");
          const stableValueToWithDraw = ethers.utils.parseEther("49.850417244373105111").add(stableDebtToRepay);
          const lpStableToLiquidate = stableValueToWithDraw.mul(ethers.utils.parseEther("1")).div(lpPrice);

          const stableWithdrawInput: IWithdrawWorkByte = {
            posId: 1,
            vaultAddress: stableVault.address,
            workerAddress: stableVaultWorker.address,
            partialCloseMinimizeStrat: partialCloseMinimizeStrat.address,
            debt: stableDebtToRepay,
            maxLpTokenToLiquidate: lpStableToLiquidate, // lp amount to withdraw consists of both equity and debt
            maxDebtRepayment: stableDebtToRepay,
            minFarmingToken: BigNumber.from(0),
          };

          // Action2: partialCloseMinimize lp = 234.028498471773286624
          // return stableToken = 149.931452849760353839
          // return assetToken = 317.917159425125022223, repay debt -317.917159425125022223, remaining = 0

          const assetDebtToRepay = ethers.utils.parseEther("317.917159425125022223");
          const assetValueToWithDraw = ethers.utils.parseEther("149.549582755626896671").add(assetDebtToRepay);
          const lpAssetToLiquidate = assetValueToWithDraw.mul(ethers.utils.parseEther("1")).div(lpPrice);

          const assetWithdrawInput: IWithdrawWorkByte = {
            posId: 1,
            vaultAddress: assetVault.address,
            workerAddress: assetVaultWorker.address,
            partialCloseMinimizeStrat: partialCloseMinimizeStrat.address,
            debt: assetDebtToRepay,
            maxLpTokenToLiquidate: lpAssetToLiquidate,
            maxDebtRepayment: assetDebtToRepay,
            minFarmingToken: BigNumber.from(0),
          };

          const stableWithdrawWorkByte = buildWithdrawWorkByte(stableWithdrawInput);
          const assetWithdrawWorkByte = buildWithdrawWorkByte(assetWithdrawInput);

          const withdrawData = ethers.utils.defaultAbiCoder.encode(
            ["uint8[]", "uint256[]", "bytes[]"],
            [
              [ACTION_WORK, ACTION_WORK],
              [0, 0],
              [stableWithdrawWorkByte, assetWithdrawWorkByte],
            ]
          );

          await deltaVaultAsAlice.approve(deltaVaultGateway.address, await deltaVault.balanceOf(aliceAddress));

          const withdrawValue = ethers.utils.parseEther("200");
          const shareToWithdraw = await deltaVault.valueToShare(withdrawValue);
          const aliceShareBefore = await deltaVault.balanceOf(aliceAddress);

          // ======== withdraw ======
          const minStableTokenReceive = ethers.utils.parseEther("149.931452849760353839");
          const minAssetTokenReceive = ethers.utils.parseEther("49.976458329680142948");

          const withdrawTx = await deltaVaultGatewayAsAlice.withdraw(
            shareToWithdraw,
            minStableTokenReceive,
            minAssetTokenReceive,
            withdrawData,
            5000,
            { gasPrice: 0 }
          );
          const gatewayShare = await deltaVault.balanceOf(deltaVaultGatewayAsAlice.address);
          expect(gatewayShare).to.be.eq(BigNumber.from(0));
          expect(await baseToken.balanceOf(deltaVaultGateway.address)).to.be.eq(BigNumber.from(0));
          expect(await wbnb.balanceOf(deltaVaultGateway.address)).to.be.eq(BigNumber.from(0));

          const aliceShareAfter = await deltaVault.balanceOf(aliceAddress);
          const positionInfoAfter = await deltaVault.positionInfo();
          expect(aliceShareBefore.sub(aliceShareAfter)).to.eq(shareToWithdraw);

          Assert.assertAlmostEqual(positionInfoAfter.stablePositionEquity.toString(), expectStableEquity.toString());
          Assert.assertAlmostEqual(positionInfoAfter.stablePositionDebtValue.toString(), expectStableDebt.toString());
          Assert.assertAlmostEqual(positionInfoAfter.assetPositionEquity.toString(), expectAssetEquity.toString());
          Assert.assertAlmostEqual(positionInfoAfter.assetPositionDebtValue.toString(), expectAssetDebt.toString());

          // in normal case user will receive stable: 149.931452849760353839 asset: 49.976458329680142948
          // but user provide return bsp of stable token as 50% and asset token 50%
          // stable price = 1, asset price = 1
          // stable value = 149.931452849760353839 * 1 = 149.931452849760353839
          // asset value = 49.976458329680142948 * 1 = 49.976458329680142948
          // total value = 149.931452849760353839 + 49.976458329680142948 = 199.907911179440496787
          // expected stable bps is 5000 = 0.5
          // expected stable value = 199.907911179440496787 * 0.5 = 99.953955589720248393
          // bps calculation
          // current stable value 149.931452849760353839 that grater then expected value
          // have to swap out (149.931452849760353839 - 99.953955589720248393) / 1 = 49.977497260040105446
          // after swap will got asset amount 49.853571678348350553 // get from log in contract
          // expected
          // stable amount = 149.931452849760353839 - 49.977497260040105446 = 99.953955589720248393
          // asset amount = 49.976458329680142948 + 49.853571678348350553 = 99.830092042300144243

          expect(withdrawTx)
            .to.emit(deltaVaultGateway, "LogWithdraw")
            .withArgs(
              aliceAddress,
              ethers.utils.parseEther("99.953955589720248393"),
              ethers.utils.parseEther("99.830030008028493501")
            );
        });

        it("should be able to withdraw and expected returns stable amount 50% and native amount 50%", async () => {
          const withdrawData = ethers.utils.defaultAbiCoder.encode(["uint8[]", "uint256[]", "bytes[]"], [[], [], []]);

          await expect(
            deltaVaultGatewayAsAlice.withdraw(
              ethers.utils.parseEther("0"),
              ethers.utils.parseEther("0"),
              ethers.utils.parseEther("0"),
              withdrawData,
              1000000,
              { gasPrice: 0 }
            )
          ).to.be.revertedWith("ReturnBpsExceed(1000000)");
        });
      });
    });
  });
});
