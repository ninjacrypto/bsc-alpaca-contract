import { ethers, upgrades, waffle } from "hardhat";
import { Signer, constants, BigNumber, utils } from "ethers";
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
  DeltaNeutralPancakeWorker02,
  DeltaNeutralPancakeWorker02__factory,
  SimpleVaultConfig,
  SyrupBar,
  Vault,
  Vault__factory,
  WNativeRelayer,
  PancakeswapV2RestrictedStrategyAddTwoSidesOptimal,
  PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading,
  PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading,
  PriceHelper,
  ChainLinkPriceOracle,
  ChainLinkPriceOracle__factory,
  MockAggregatorV3__factory,
} from "../../../../../typechain";
import * as AssertHelpers from "../../../../helpers/assert";
import * as TimeHelpers from "../../../../helpers/time";
import { parseEther } from "ethers/lib/utils";
import { DeployHelper } from "../../../../helpers/deploy";
import { SwapHelper } from "../../../../helpers/swap";
import { Worker02Helper } from "../../../../helpers/worker";

chai.use(solidity);
const { expect } = chai;

describe("Vault - DeltaNetPancakeWorker02", () => {
  const FOREVER = "2000000000";
  const ALPACA_BONUS_LOCK_UP_BPS = 7000;
  const ALPACA_REWARD_PER_BLOCK = ethers.utils.parseEther("5000");
  const CAKE_REWARD_PER_BLOCK = ethers.utils.parseEther("0.076");
  const REINVEST_BOUNTY_BPS = "100"; // 1% reinvest bounty
  const RESERVE_POOL_BPS = "1000"; // 10% reserve pool
  const KILL_PRIZE_BPS = "1000"; // 10% Kill prize
  const INTEREST_RATE = "3472222222222"; // 30% per year
  const MIN_DEBT_SIZE = ethers.utils.parseEther("1"); // 1 BTOKEN min debt size
  const WORK_FACTOR = "100000000";
  const KILL_FACTOR = "8000";
  const MAX_REINVEST_BOUNTY: string = "900";
  const DEPLOYER = "0xC44f82b07Ab3E691F826951a6E335E1bC1bB0B51";
  const BENEFICIALVAULT_BOUNTY_BPS = "1000";
  const REINVEST_THRESHOLD = ethers.utils.parseEther("1"); // If pendingCake > 1 $CAKE, then reinvest
  const KILL_TREASURY_BPS = "100";
  const POOL_ID = 1;

  /// Pancakeswap-related instance(s)
  let factoryV2: PancakeFactory;
  let routerV2: PancakeRouterV2;

  let wbnb: MockWBNB;
  let lp: PancakePair;

  /// Token-related instance(s)
  let baseToken: MockERC20;
  let farmToken: MockERC20;
  let busd: MockERC20;
  let cake: CakeToken;
  let syrup: SyrupBar;

  /// Strategy-ralted instance(s)
  let addStrat: PancakeswapV2RestrictedStrategyAddBaseTokenOnly;
  let twoSidesStrat: PancakeswapV2RestrictedStrategyAddTwoSidesOptimal;
  let liqStrat: PancakeswapV2RestrictedStrategyLiquidate;
  let minimizeStrat: PancakeswapV2RestrictedStrategyWithdrawMinimizeTrading;
  let partialCloseStrat: PancakeswapV2RestrictedStrategyPartialCloseLiquidate;
  let partialCloseMinimizeStrat: PancakeswapV2RestrictedStrategyPartialCloseMinimizeTrading;

  /// Vault-related instance(s)
  let simpleVaultConfig: SimpleVaultConfig;
  let wNativeRelayer: WNativeRelayer;
  let vault: Vault;

  /// FairLaunch-related instance(s)
  let fairLaunch: FairLaunch;
  let alpacaToken: AlpacaToken;

  /// PancakeswapMasterChef-related instance(s)
  let masterChef: PancakeMasterChef;
  let deltaNeutralWorker: DeltaNeutralPancakeWorker02;

  /// Timelock instance(s)
  let whitelistedContract: MockContractContext;
  let evilContract: MockContractContext;

  let priceHelper: PriceHelper;
  let chainlink: ChainLinkPriceOracle;

  // Accounts
  let deployer: Signer;
  let alice: Signer;
  let bob: Signer;
  let eve: Signer;
  let deltaNet: Signer;

  let deployerAddress: string;
  let aliceAddress: string;
  let bobAddress: string;
  let eveAddress: string;
  let deltaNetAddress: string;

  // Contract Signer
  let baseTokenAsAlice: MockERC20;
  let baseTokenAsBob: MockERC20;
  let baseTokenAsEve: MockERC20;
  let baseTokenAsDeltaNet: MockERC20;

  let farmTokenAsAlice: MockERC20;

  let fairLaunchAsAlice: FairLaunch;

  let lpAsAlice: PancakePair;
  let lpAsBob: PancakePair;

  let pancakeMasterChefAsAlice: PancakeMasterChef;
  let pancakeMasterChefAsBob: PancakeMasterChef;

  let deltaNeutralWorkerAsEve: DeltaNeutralPancakeWorker02;

  let chainLinkOracleAsDeployer: ChainLinkPriceOracle;

  let MockAggregatorV3Factory: MockAggregatorV3__factory;

  let vaultAsAlice: Vault;
  let vaultAsBob: Vault;
  let vaultAsEve: Vault;
  let vaultAsDeltaNet: Vault;

  // Test Helper
  let swapHelper: SwapHelper;

  async function fixture() {
    [deployer, alice, bob, eve] = await ethers.getSigners();
    deltaNet = alice;
    [deployerAddress, aliceAddress, bobAddress, eveAddress] = await Promise.all([
      deployer.getAddress(),
      alice.getAddress(),
      bob.getAddress(),
      eve.getAddress(),
    ]);
    deltaNetAddress = aliceAddress;
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

    /// Setup token stuffs
    [baseToken, farmToken] = await deployHelper.deployBEP20([
      {
        name: "BTOKEN",
        symbol: "BTOKEN",
        decimals: "18",
        holders: [
          { address: deployerAddress, amount: ethers.utils.parseEther("1000") },
          { address: aliceAddress, amount: ethers.utils.parseEther("1000") },
          { address: bobAddress, amount: ethers.utils.parseEther("1000") },
          { address: eveAddress, amount: ethers.utils.parseEther("1000") },
        ],
      },
      {
        name: "FTOKEN",
        symbol: "FTOKEN",
        decimals: "18",
        holders: [
          { address: deployerAddress, amount: ethers.utils.parseEther("1000") },
          { address: aliceAddress, amount: ethers.utils.parseEther("1000") },
          { address: bobAddress, amount: ethers.utils.parseEther("1000") },
          { address: eveAddress, amount: ethers.utils.parseEther("1000") },
        ],
      },
    ]);
    wbnb = await deployHelper.deployWBNB();
    busd = await deployHelper.deployERC20();
    [factoryV2, routerV2, cake, syrup, masterChef] = await deployHelper.deployPancakeV2(wbnb, CAKE_REWARD_PER_BLOCK, [
      { address: deployerAddress, amount: ethers.utils.parseEther("100") },
    ]);
    [alpacaToken, fairLaunch] = await deployHelper.deployAlpacaFairLaunch(
      ALPACA_REWARD_PER_BLOCK,
      ALPACA_BONUS_LOCK_UP_BPS,
      132,
      137
    );
    [vault, simpleVaultConfig, wNativeRelayer] = await deployHelper.deployVault(
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
    // Setup strategies
    [addStrat, liqStrat, twoSidesStrat, minimizeStrat, partialCloseStrat, partialCloseMinimizeStrat] =
      await deployHelper.deployPancakeV2Strategies(routerV2, vault, wbnb, wNativeRelayer);

    // whitelisted contract to be able to call work
    await simpleVaultConfig.setWhitelistedCallers([whitelistedContract.address], true);

    // whitelisted to be able to call kill
    await simpleVaultConfig.setWhitelistedLiquidators([await alice.getAddress(), await eve.getAddress()], true);

    // Set approved add strategies
    await simpleVaultConfig.setApprovedAddStrategy([addStrat.address, twoSidesStrat.address], true);

    // Setup BTOKEN-FTOKEN pair on Pancakeswap
    // Add lp to masterChef's pool
    await factoryV2.createPair(baseToken.address, farmToken.address);
    lp = PancakePair__factory.connect(await factoryV2.getPair(farmToken.address, baseToken.address), deployer);
    await masterChef.add(1, lp.address, true);

    /// Setup DeltaNeutralPancakeWorker02
    [priceHelper, chainlink] = await deployHelper.deployPriceHelper(
      [baseToken.address, farmToken.address],
      [ethers.utils.parseEther("1"), ethers.utils.parseEther("200")],
      [18, 18],
      busd.address
    );

    MockAggregatorV3Factory = (await ethers.getContractFactory(
      "MockAggregatorV3",
      deployer
    )) as MockAggregatorV3__factory;

    chainLinkOracleAsDeployer = ChainLinkPriceOracle__factory.connect(chainlink.address, deployer);

    deltaNeutralWorker = await deployHelper.deployDeltaNeutralPancakeWorker02(
      vault,
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
      [twoSidesStrat.address, minimizeStrat.address, partialCloseStrat.address, partialCloseMinimizeStrat.address],
      simpleVaultConfig,
      priceHelper
    );
    await deltaNeutralWorker.setWhitelistedCallers(
      [whitelistedContract.address, deltaNeutralWorker.address, aliceAddress, bobAddress],
      true
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
        token0: baseToken,
        token1: farmToken,
        amount0desired: ethers.utils.parseEther("1"),
        amount1desired: ethers.utils.parseEther("0.1"),
      },
      {
        token0: cake,
        token1: wbnb,
        amount0desired: ethers.utils.parseEther("0.1"),
        amount1desired: ethers.utils.parseEther("1"),
      },
      {
        token0: baseToken,
        token1: wbnb,
        amount0desired: ethers.utils.parseEther("1"),
        amount1desired: ethers.utils.parseEther("1"),
      },
      {
        token0: farmToken,
        token1: wbnb,
        amount0desired: ethers.utils.parseEther("1"),
        amount1desired: ethers.utils.parseEther("1"),
      },
    ]);

    // Contract signer
    baseTokenAsAlice = MockERC20__factory.connect(baseToken.address, alice);
    baseTokenAsBob = MockERC20__factory.connect(baseToken.address, bob);
    baseTokenAsEve = MockERC20__factory.connect(baseToken.address, eve);
    baseTokenAsDeltaNet = MockERC20__factory.connect(baseToken.address, deltaNet);

    farmTokenAsAlice = MockERC20__factory.connect(farmToken.address, alice);

    lpAsAlice = PancakePair__factory.connect(lp.address, alice);
    lpAsBob = PancakePair__factory.connect(lp.address, bob);

    fairLaunchAsAlice = FairLaunch__factory.connect(fairLaunch.address, alice);
    pancakeMasterChefAsAlice = PancakeMasterChef__factory.connect(masterChef.address, alice);
    pancakeMasterChefAsBob = PancakeMasterChef__factory.connect(masterChef.address, bob);

    vaultAsAlice = Vault__factory.connect(vault.address, alice);
    vaultAsBob = Vault__factory.connect(vault.address, bob);
    vaultAsEve = Vault__factory.connect(vault.address, eve);
    vaultAsDeltaNet = Vault__factory.connect(vault.address, deltaNet);

    deltaNeutralWorkerAsEve = DeltaNeutralPancakeWorker02__factory.connect(deltaNeutralWorker.address, eve);
  }

  beforeEach(async () => {
    await waffle.loadFixture(fixture);
  });

  context("when worker is initialized", async () => {
    it("should has FTOKEN as a farmingToken in DeltaNeutralPancakeWorker", async () => {
      expect(await deltaNeutralWorker.farmingToken()).to.be.equal(farmToken.address);
    });

    // TOFIXTEST: should we remove this?
    it("should give rewards out when you stake LP tokens", async () => {
      // Deployer sends some LP tokens to Alice and Bob
      await lp.transfer(aliceAddress, ethers.utils.parseEther("0.05"));
      await lp.transfer(bobAddress, ethers.utils.parseEther("0.05"));

      // Alice and Bob stake 0.01 LP tokens and waits for 1 day
      await lpAsAlice.approve(masterChef.address, ethers.utils.parseEther("0.01"));
      await lpAsBob.approve(masterChef.address, ethers.utils.parseEther("0.02"));
      await pancakeMasterChefAsAlice.deposit(POOL_ID, ethers.utils.parseEther("0.01"));
      await pancakeMasterChefAsBob.deposit(POOL_ID, ethers.utils.parseEther("0.02")); // alice +1 Reward

      // Alice and Bob withdraw stake from the pool
      await pancakeMasterChefAsBob.withdraw(POOL_ID, ethers.utils.parseEther("0.02")); // alice +1/3 Reward  Bob + 2/3 Reward
      await pancakeMasterChefAsAlice.withdraw(POOL_ID, ethers.utils.parseEther("0.01")); // alice +1 Reward

      AssertHelpers.assertAlmostEqual(
        (await cake.balanceOf(aliceAddress)).toString(),
        CAKE_REWARD_PER_BLOCK.mul(BigNumber.from(7)).div(BigNumber.from(3)).toString()
      );
      AssertHelpers.assertAlmostEqual(
        (await cake.balanceOf(bobAddress)).toString(),
        CAKE_REWARD_PER_BLOCK.mul(2).div(3).toString()
      );
    });
  });

  context("when owner is setting worker", async () => {
    describe("#reinvestConfig", async () => {
      it("should set reinvest config correctly", async () => {
        await expect(
          deltaNeutralWorker.setReinvestConfig(250, ethers.utils.parseEther("1"), [cake.address, baseToken.address])
        )
          .to.be.emit(deltaNeutralWorker, "SetReinvestConfig")
          .withArgs(deployerAddress, 250, ethers.utils.parseEther("1"), [cake.address, baseToken.address]);
        expect(await deltaNeutralWorker.reinvestBountyBps()).to.be.eq(250);
        expect(await deltaNeutralWorker.reinvestThreshold()).to.be.eq(ethers.utils.parseEther("1"));
        expect(await deltaNeutralWorker.getReinvestPath()).to.deep.eq([cake.address, baseToken.address]);
      });

      it("should revert when owner set reinvestBountyBps > max", async () => {
        await expect(
          deltaNeutralWorker.setReinvestConfig(1000, "0", [cake.address, baseToken.address])
        ).to.be.revertedWith("ExceedReinvestBounty()");
        expect(await deltaNeutralWorker.reinvestBountyBps()).to.be.eq(100);
      });

      it("should revert when owner set reinvest path that doesn't start with $CAKE and end with $BTOKN", async () => {
        await expect(
          deltaNeutralWorker.setReinvestConfig(200, "0", [baseToken.address, cake.address])
        ).to.be.revertedWith("InvalidReinvestPath()");
      });
    });

    describe("#setMaxReinvestBountyBps", async () => {
      it("should set max reinvest bounty", async () => {
        await deltaNeutralWorker.setMaxReinvestBountyBps(200);
        expect(await deltaNeutralWorker.maxReinvestBountyBps()).to.be.eq(200);
      });

      it("should revert when new max reinvest bounty over 30%", async () => {
        await expect(deltaNeutralWorker.setMaxReinvestBountyBps("3001")).to.be.revertedWith("ExceedReinvestBps()");
        expect(await deltaNeutralWorker.maxReinvestBountyBps()).to.be.eq(MAX_REINVEST_BOUNTY);
      });
    });

    describe("#setTreasuryConfig", async () => {
      it("should successfully set a treasury account", async () => {
        const aliceAddr = aliceAddress;
        await deltaNeutralWorker.setTreasuryConfig(aliceAddr, REINVEST_BOUNTY_BPS);
        expect(await deltaNeutralWorker.treasuryAccount()).to.eq(aliceAddr);
      });

      it("should successfully set a treasury bounty", async () => {
        await deltaNeutralWorker.setTreasuryConfig(DEPLOYER, 499);
        expect(await deltaNeutralWorker.treasuryBountyBps()).to.eq(499);
      });

      it("should revert when a new treasury bounty > max reinvest bounty bps", async () => {
        await expect(deltaNeutralWorker.setTreasuryConfig(DEPLOYER, parseInt(MAX_REINVEST_BOUNTY) + 1)).to.revertedWith(
          "ExceedReinvestBounty()"
        );
        expect(await deltaNeutralWorker.treasuryBountyBps()).to.eq(REINVEST_BOUNTY_BPS);
      });
    });

    describe("#setStrategyOk", async () => {
      it("should set strat ok", async () => {
        await deltaNeutralWorker.setStrategyOk([aliceAddress], true);
        expect(await deltaNeutralWorker.okStrats(aliceAddress)).to.be.eq(true);
      });
    });

    describe("#setWhitelistCallers", async () => {
      it("should set whitelisted callers", async () => {
        await expect(deltaNeutralWorker.setWhitelistedCallers([deployerAddress], true)).to.emit(
          deltaNeutralWorker,
          "SetWhitelistedCallers"
        );
        expect(await deltaNeutralWorker.whitelistCallers(deployerAddress)).to.be.eq(true);
      });
    });
  });

  context("when user uses LYF", async () => {
    context("when user is contract", async () => {
      it("should revert if evil contract try to call onlyEOAorWhitelisted function", async () => {
        await expect(
          evilContract.executeTransaction(
            vault.address,
            0,
            "work(uint256,address,uint256,uint256,uint256,bytes)",
            ethers.utils.defaultAbiCoder.encode(
              ["uint256", "address", "uint256", "uint256", "uint256", "bytes"],
              [
                0,
                deltaNeutralWorker.address,
                ethers.utils.parseEther("0.3"),
                "0",
                "0",
                ethers.utils.defaultAbiCoder.encode(
                  ["address", "bytes"],
                  [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
                ),
              ]
            )
          )
        ).to.be.revertedWith("not eoa");
      });

      it("should allow whitelisted contract to open position without debt", async () => {
        // Deployer deposit 3 BTOKEN to the vault
        await baseToken.approve(vault.address, ethers.utils.parseEther("3"));
        await vault.deposit(ethers.utils.parseEther("3"));

        // Deployer funds whitelisted contract
        await baseToken.transfer(whitelistedContract.address, ethers.utils.parseEther("1"));

        // whitelisted contract approve Alpaca to to take BTOKEN
        await whitelistedContract.executeTransaction(
          baseToken.address,
          "0",
          "approve(address,uint256)",
          ethers.utils.defaultAbiCoder.encode(["address", "uint256"], [vault.address, ethers.utils.parseEther("0.3")])
        );
        expect(await baseToken.allowance(whitelistedContract.address, vault.address)).to.be.eq(
          ethers.utils.parseEther("0.3")
        );

        // whitelisted contract should able to open position with 0 debt
        await whitelistedContract.executeTransaction(
          vault.address,
          0,
          "work(uint256,address,uint256,uint256,uint256,bytes)",
          ethers.utils.defaultAbiCoder.encode(
            ["uint256", "address", "uint256", "uint256", "uint256", "bytes"],
            [
              0,
              deltaNeutralWorker.address,
              ethers.utils.parseEther("0.3"),
              "0",
              "0",
              ethers.utils.defaultAbiCoder.encode(
                ["address", "bytes"],
                [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
              ),
            ]
          )
        );

        const [worker, owner] = await vault.positions(1);
        expect(owner).to.be.eq(whitelistedContract.address);
        expect(worker).to.be.eq(deltaNeutralWorker.address);
      });

      it("should revert if evil contract try to call onlyWhitelistedLiquidators function", async () => {
        await expect(
          evilContract.executeTransaction(
            vault.address,
            0,
            "kill(uint256)",
            ethers.utils.defaultAbiCoder.encode(["uint256"], [0])
          )
        ).to.be.revertedWith("!whitelisted liquidator");
      });
    });

    context("when user is not in whitelisted callers", async () => {
      context("#work", async () => {
        it("should not allow to open a position", async () => {
          // Deployer deposits 3 BTOKEN to the bank
          const deposit = ethers.utils.parseEther("3");
          await baseToken.approve(vault.address, deposit);
          await vault.deposit(deposit);
          // Now Alice can take 1 BTOKEN loan + 1 BTOKEN of her to create a new position
          const loan = ethers.utils.parseEther("1");
          await baseTokenAsEve.approve(vault.address, ethers.utils.parseEther("1"));
          await expect(
            vaultAsEve.work(
              0,
              deltaNeutralWorker.address,
              ethers.utils.parseEther("1"),
              loan,
              "0",
              ethers.utils.defaultAbiCoder.encode(
                ["address", "bytes"],
                [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
              )
            )
          ).to.be.revertedWith("NotWhitelistedCaller()");
        });
      });
    });

    context("when user is EOA", async () => {
      // TOFIXTEST: change to deltanet user
      context("#work", async () => {
        it("should allow to open a position without debt", async () => {
          // Deployer deposits 3 BTOKEN to the bank
          await baseToken.approve(vault.address, ethers.utils.parseEther("3"));
          await vault.deposit(ethers.utils.parseEther("3"));
          // Alice can take 0 debt ok
          await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("0.3"));
          await vaultAsAlice.work(
            0,
            deltaNeutralWorker.address,
            ethers.utils.parseEther("0.3"),
            ethers.utils.parseEther("0"),
            "0",
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            )
          );
        });

        it("should not allow to open a position with debt less than MIN_DEBT_SIZE", async () => {
          // Deployer deposits 3 BTOKEN to the bank
          await baseToken.approve(vault.address, ethers.utils.parseEther("3"));
          await vault.deposit(ethers.utils.parseEther("3"));
          // Alice cannot take 0.3 debt because it is too small
          await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("0.3"));
          await expect(
            vaultAsAlice.work(
              0,
              deltaNeutralWorker.address,
              ethers.utils.parseEther("0.3"),
              ethers.utils.parseEther("0.3"),
              "0",
              ethers.utils.defaultAbiCoder.encode(
                ["address", "bytes"],
                [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
              )
            )
          ).to.be.revertedWith("too small debt size");
        });

        // TODO: remove because this test case test about work factor
        it("should not allow to open the position with bad work factor", async () => {
          // // Deployer deposits 3 BTOKEN to the bank
          // await baseToken.approve(vault.address, ethers.utils.parseEther("3"));
          // await vault.deposit(ethers.utils.parseEther("3"));
          // // Alice cannot take 1 BTOKEN loan because she only put 0.3 BTOKEN as a collateral
          // await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("0.3"));
          // await expect(
          //   vaultAsAlice.work(
          //     0,
          //     deltaNeutralWorker.address,
          //     ethers.utils.parseEther("0.3"),
          //     ethers.utils.parseEther("1"),
          //     "0",
          //     ethers.utils.defaultAbiCoder.encode(
          //       ["address", "bytes"],
          //       [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //     )
          //   )
          // ).to.be.revertedWith("bad work factor");
        });

        it("should not allow positions if Vault has less BaseToken than requested loan", async () => {
          // Alice cannot take 1 BTOKEN loan because the contract does not have it
          await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
          await expect(
            vaultAsAlice.work(
              0,
              deltaNeutralWorker.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1"),
              "0",
              ethers.utils.defaultAbiCoder.encode(
                ["address", "bytes"],
                [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
              )
            )
          ).to.be.revertedWith("insufficient funds in the vault");
        });

        it("should work", async () => {
          // Deployer deposits 3 BTOKEN to the bank
          const deposit = ethers.utils.parseEther("3");
          await baseToken.approve(vault.address, deposit);
          await vault.deposit(deposit);
          // Now Alice can take 1 BTOKEN loan + 1 BTOKEN of her to create a new position
          const loan = ethers.utils.parseEther("1");
          await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
          await vaultAsAlice.work(
            0,
            deltaNeutralWorker.address,
            ethers.utils.parseEther("1"),
            loan,
            "0",
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            )
          );
          // health calculation
          // lp balance = 0.231205137369691323
          // lp price = 28.299236836137312801
          // lp balance in dollar = 6.542928940156556263
          // base token price = 1.0
          // health should be lpBalace * lp price / baseTokenPrice => 0.231205137369691323 * 28.299236836137312801 / 1.0 = 6.542928940156556263
          let lpBalance = await deltaNeutralWorker.totalLpBalance();
          let lpToken = await deltaNeutralWorker.lpToken();
          let lpInDollar = await priceHelper.lpToDollar(lpBalance, lpToken);
          let lpPrice = lpInDollar.mul(BigNumber.from("1000000000000000000")).div(lpBalance);
          let tokenPrice = await priceHelper.getTokenPrice(baseToken.address);
          const expectedHealth = ethers.utils.parseEther("6.542928940156556263");
          expect(await deltaNeutralWorker.health(1)).to.be.eq(expectedHealth);
          // Eve comes and trigger reinvest
          await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          await deltaNeutralWorkerAsEve.reinvest();
          AssertHelpers.assertAlmostEqual(
            CAKE_REWARD_PER_BLOCK.mul("2").mul(REINVEST_BOUNTY_BPS).div("10000").toString(),
            (await cake.balanceOf(eveAddress)).toString()
          );
          await vault.deposit(0); // Random action to trigger interest computation
          const healthDebt = await vault.positionInfo("1");
          expect(healthDebt[0]).to.be.above(expectedHealth);
          const interest = ethers.utils.parseEther("0.3"); // 30% interest rate
          AssertHelpers.assertAlmostEqual(healthDebt[1].toString(), interest.add(loan).toString());
          AssertHelpers.assertAlmostEqual(
            (await baseToken.balanceOf(vault.address)).toString(),
            deposit.sub(loan).toString()
          );
          AssertHelpers.assertAlmostEqual((await vault.vaultDebtVal()).toString(), interest.add(loan).toString());
          const reservePool = interest.mul(RESERVE_POOL_BPS).div("10000");
          AssertHelpers.assertAlmostEqual(reservePool.toString(), (await vault.reservePool()).toString());
          AssertHelpers.assertAlmostEqual(
            deposit.add(interest).sub(reservePool).toString(),
            (await vault.totalToken()).toString()
          );
        });

        it("should has correct interest rate growth", async () => {
          // Deployer deposits 3 BTOKEN to the bank
          const deposit = ethers.utils.parseEther("3");
          await baseToken.approve(vault.address, deposit);
          await vault.deposit(deposit);
          // Now Alice can take 1 BTOKEN loan + 1 BTOKEN of her to create a new position
          const loan = ethers.utils.parseEther("1");
          await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
          await vaultAsAlice.work(
            0,
            deltaNeutralWorker.address,
            ethers.utils.parseEther("1"),
            loan,
            "0",
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            )
          );
          await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          await deltaNeutralWorkerAsEve.reinvest();
          await vault.deposit(0); // Random action to trigger interest computation
          await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          await vault.deposit(0); // Random action to trigger interest computation
          const interest = ethers.utils.parseEther("0.3"); //30% interest rate
          const reservePool = interest.mul(RESERVE_POOL_BPS).div("10000");
          AssertHelpers.assertAlmostEqual(
            deposit
              .add(interest.sub(reservePool))
              .add(interest.sub(reservePool).mul(13).div(10))
              .add(interest.sub(reservePool).mul(13).div(10))
              .toString(),
            (await vault.totalToken()).toString()
          );
        });

        // TODO: remove this because this one check how user manage position
        it("should close position correctly when user holds multiple positions", async () => {
          // // Set interests to 0% per year for easy testing
          // await simpleVaultConfig.setParams(
          //   ethers.utils.parseEther("1"), // 1 BTOKEN min debt size,
          //   "0", // 0% per year
          //   "1000", // 10% reserve pool
          //   "1000", // 10% Kill prize
          //   wbnb.address,
          //   wNativeRelayer.address,
          //   fairLaunch.address,
          //   "0",
          //   ethers.constants.AddressZero
          // );
          // // Set Reinvest bounty to 10% of the reward
          // await deltaNeutralWorker.setReinvestConfig("100", "0", [cake.address, wbnb.address, baseToken.address]);
          // const [path, reinvestPath] = await Promise.all([
          //   deltaNeutralWorker.getPath(),
          //   deltaNeutralWorker.getReinvestPath(),
          // ]);
          // // Bob deposits 10 BTOKEN
          // await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("10"));
          // await vaultAsBob.deposit(ethers.utils.parseEther("10"));
          // // Alice deposits 12 BTOKEN
          // await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("12"));
          // await vaultAsAlice.deposit(ethers.utils.parseEther("12"));
          // // Position#1: Bob borrows 10 BTOKEN
          // await swapHelper.loadReserves(path);
          // let accumLp = BigNumber.from(0);
          // let workerLpBefore = BigNumber.from(0);
          // let totalShare = BigNumber.from(0);
          // let shares: Array<BigNumber> = [];
          // await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("10"));
          // await vaultAsBob.work(
          //   TARGET_POSITION_ID,
          //   deltaNeutralWorker.address,
          //   ethers.utils.parseEther("10"),
          //   ethers.utils.parseEther("10"),
          //   "0", // max return = 0, don't return NATIVE to the debt
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // // Pre-compute expectation
          // let [expectedLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(
          //   ethers.utils.parseEther("20"),
          //   path
          // );
          // accumLp = accumLp.add(expectedLp);
          // let expectedShare = workerHelper.computeBalanceToShare(expectedLp, totalShare, workerLpBefore);
          // shares.push(expectedShare);
          // totalShare = totalShare.add(expectedShare);
          // // Expect
          // let [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // expect(await deltaNeutralWorker.totalLPBalance, `Bob should has LP Balance xxxx`).to.be.eq(0);
          // expect(
          //   await baseToken.balanceOf(addStrat.address),
          //   `expect add BTOKEN strat to have ${debrisBtoken} BTOKEN debris`
          // ).to.be.eq(debrisBtoken);
          // expect(
          //   await farmToken.balanceOf(addStrat.address),
          //   `expect add BTOKEN strat to have ${debrisFtoken} FTOKEN debris`
          // ).to.be.eq(debrisFtoken);
          // expect(workerLpAfter, `expect Worker to stake ${accumLp} LP`).to.be.eq(accumLp);
          // // Position#2: Bob borrows another 2 BTOKEN
          // [workerLpBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // let eveCakeBefore = await cake.balanceOf(eveAddress);
          // let deployerCakeBefore = await cake.balanceOf(DEPLOYER);
          // await swapHelper.loadReserves(path);
          // await swapHelper.loadReserves(reinvestPath);
          // await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("1"));
          // await vaultAsBob.work(
          //   0,
          //   deltaNeutralWorker.address,
          //   ethers.utils.parseEther("1"),
          //   ethers.utils.parseEther("2"),
          //   "0", // max return = 0, don't return BTOKEN to the debt
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // let eveCakeAfter = await cake.balanceOf(eveAddress);
          // let deployerCakeAfter = await cake.balanceOf(DEPLOYER);
          // let totalRewards = swapHelper.computeTotalRewards(workerLpBefore, CAKE_REWARD_PER_BLOCK, BigNumber.from(2));
          // let reinvestFees = totalRewards.mul(REINVEST_BOUNTY_BPS).div(10000);
          // let reinvestLeft = totalRewards.sub(reinvestFees);
          // let reinvestAmts = await swapHelper.computeSwapExactTokensForTokens(reinvestLeft, reinvestPath, true);
          // let reinvestBtoken = reinvestAmts[reinvestAmts.length - 1].add(debrisBtoken);
          // let reinvestLp = BigNumber.from(0);
          // [reinvestLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(reinvestBtoken, path);
          // accumLp = accumLp.add(reinvestLp);
          // [expectedLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(
          //   ethers.utils.parseEther("3"),
          //   path
          // );
          // accumLp = accumLp.add(expectedLp);
          // expectedShare = workerHelper.computeBalanceToShare(expectedLp, totalShare, workerLpBefore.add(reinvestLp));
          // shares.push(expectedShare);
          // totalShare = totalShare.add(expectedShare);
          // expect(await deltaNeutralWorker.totalLPBalance, `Bob should has new LP Balance xxxx`).to.be.eq(0);
          // expect(
          //   deployerCakeAfter.sub(deployerCakeBefore),
          //   `expect DEPLOYER to get ${reinvestFees} CAKE as treasury fees`
          // ).to.be.eq(reinvestFees);
          // expect(eveCakeAfter.sub(eveCakeBefore), `expect eve's CAKE to remain the same`).to.be.eq("0");
          // expect(workerLpAfter, `expect Worker to stake ${accumLp} LP`).to.be.eq(accumLp);
          // expect(
          //   await baseToken.balanceOf(addStrat.address),
          //   `expect add BTOKEN strat to have ${debrisBtoken} BTOKEN debris`
          // ).to.be.eq(debrisBtoken);
          // expect(
          //   await farmToken.balanceOf(addStrat.address),
          //   `expect add BTOKEN strat to have ${debrisFtoken} FTOKEN debris`
          // ).to.be.eq(debrisFtoken);
          // // ---------------- Reinvest#1 -------------------
          // // Wait for 1 day and someone calls reinvest
          // // await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          // let [workerLPBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // deployerCakeBefore = await cake.balanceOf(DEPLOYER);
          // eveCakeBefore = await cake.balanceOf(eveAddress);
          // await swapHelper.loadReserves(path);
          // await swapHelper.loadReserves(reinvestPath);
          // await deltaNeutralWorkerAsEve.reinvest();
          // deployerCakeAfter = await cake.balanceOf(DEPLOYER);
          // eveCakeAfter = await cake.balanceOf(eveAddress);
          // [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // totalRewards = swapHelper.computeTotalRewards(workerLPBefore, CAKE_REWARD_PER_BLOCK, BigNumber.from(2));
          // reinvestFees = totalRewards.mul(REINVEST_BOUNTY_BPS).div(10000);
          // reinvestLeft = totalRewards.sub(reinvestFees);
          // reinvestAmts = await swapHelper.computeSwapExactTokensForTokens(reinvestLeft, reinvestPath, true);
          // reinvestBtoken = reinvestAmts[reinvestAmts.length - 1].add(debrisBtoken);
          // [reinvestLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(reinvestBtoken, path);
          // accumLp = accumLp.add(reinvestLp);
          // expect(await deltaNeutralWorker.shares(1), `expect Pos#1 has ${shares[0]} shares`).to.be.eq(shares[0]);
          // expect(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1)),
          //   `expect Pos#1 LPs = ${workerHelper.computeShareToBalance(shares[0], totalShare, workerLpAfter)}`
          // ).to.be.eq(workerHelper.computeShareToBalance(shares[0], totalShare, workerLpAfter));
          // expect(await deltaNeutralWorker.shares(2), `expect Pos#2 has ${shares[1]} shares`).to.be.eq(shares[1]);
          // expect(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(2)),
          //   `expect Pos#2 LPs = ${workerHelper.computeShareToBalance(shares[1], totalShare, workerLpAfter)}`
          // ).to.be.eq(workerHelper.computeShareToBalance(shares[1], totalShare, workerLpAfter));
          // expect(deployerCakeAfter.sub(deployerCakeBefore), `expect DEPLOYER's CAKE to remain the same`).to.be.eq("0");
          // expect(eveCakeAfter.sub(eveCakeBefore), `expect eve to get ${reinvestFees}`).to.be.eq(reinvestFees);
          // expect(workerLpAfter).to.be.eq(accumLp);
          // // Check Position#1 info
          // let [bob1Health, bob1DebtToShare] = await vault.positionInfo("1");
          // const bob1ExpectedHealth = await swapHelper.computeLpHealth(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1)),
          //   baseToken.address,
          //   farmToken.address
          // );
          // expect(bob1Health, `expect Pos#1 health = ${bob1ExpectedHealth}`).to.be.eq(bob1ExpectedHealth);
          // expect(bob1Health).to.be.gt(ethers.utils.parseEther("20"));
          // AssertHelpers.assertAlmostEqual(ethers.utils.parseEther("10").toString(), bob1DebtToShare.toString());
          // // Check Position#2 info
          // let [bob2Health, bob2DebtToShare] = await vault.positionInfo("2");
          // const bob2ExpectedHealth = await swapHelper.computeLpHealth(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(2)),
          //   baseToken.address,
          //   farmToken.address
          // );
          // expect(bob2Health, `expect Pos#2 health = ${bob2ExpectedHealth}`).to.be.eq(bob2ExpectedHealth);
          // expect(bob2Health).to.be.gt(ethers.utils.parseEther("3"));
          // AssertHelpers.assertAlmostEqual(ethers.utils.parseEther("2").toString(), bob2DebtToShare.toString());
          // let bobBefore = await baseToken.balanceOf(bobAddress);
          // let bobAlpacaBefore = await alpacaToken.balanceOf(bobAddress);
          // // Bob close position#1
          // await vaultAsBob.work(
          //   1,
          //   deltaNeutralWorker.address,
          //   "0",
          //   "0",
          //   "1000000000000000000000",
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [liqStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // let bobAfter = await baseToken.balanceOf(bobAddress);
          // let bobAlpacaAfter = await alpacaToken.balanceOf(bobAddress);
          // // Check Bob account, Bob must be richer as he earn more from yield
          // expect(bobAlpacaAfter).to.be.gt(bobAlpacaBefore);
          // expect(bobAfter).to.be.gt(bobBefore);
          // // Bob add another 10 BTOKEN
          // await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("10"));
          // await vaultAsBob.work(
          //   2,
          //   deltaNeutralWorker.address,
          //   ethers.utils.parseEther("10"),
          //   0,
          //   "0", // max return = 0, don't return NATIVE to the debt
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // bobBefore = await baseToken.balanceOf(bobAddress);
          // bobAlpacaBefore = await alpacaToken.balanceOf(bobAddress);
          // // Bob close position#2
          // await vaultAsBob.work(
          //   2,
          //   deltaNeutralWorker.address,
          //   "0",
          //   "0",
          //   "1000000000000000000000000000000",
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [liqStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // bobAfter = await baseToken.balanceOf(bobAddress);
          // bobAlpacaAfter = await alpacaToken.balanceOf(bobAddress);
          // // Check Bob account, Bob must be richer as she earned from leverage yield farm without getting liquidated
          // expect(bobAfter).to.be.gt(bobBefore);
          // expect(bobAlpacaAfter).to.be.gt(bobAlpacaBefore);
        });

        // TODO: remove this because this one check how user manage position
        it("should close position correctly when user holds mix positions of leveraged and non-leveraged", async () => {
          // // Set interests to 0% per year for easy testing
          // await simpleVaultConfig.setParams(
          //   ethers.utils.parseEther("1"), // 1 BTOKEN min debt size,
          //   "0", // 0% per year
          //   "1000", // 10% reserve pool
          //   "1000", // 10% Kill prize
          //   wbnb.address,
          //   wNativeRelayer.address,
          //   fairLaunch.address,
          //   "0",
          //   ethers.constants.AddressZero
          // );
          // const [path, reinvestPath] = await Promise.all([
          //   deltaNeutralWorker.getPath(),
          //   deltaNeutralWorker.getReinvestPath(),
          // ]);
          // // Set Reinvest bounty to 10% of the reward
          // await deltaNeutralWorker.setReinvestConfig("100", "0", [cake.address, wbnb.address, baseToken.address]);
          // // Bob deposits 10 BTOKEN
          // await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("10"));
          // await vaultAsBob.deposit(ethers.utils.parseEther("10"));
          // // Alice deposits 12 BTOKEN
          // await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("12"));
          // await vaultAsAlice.deposit(ethers.utils.parseEther("12"));
          // // Position#1: Bob borrows 10 BTOKEN
          // await swapHelper.loadReserves(path);
          // let accumLp = BigNumber.from(0);
          // let workerLpBefore = BigNumber.from(0);
          // let totalShare = BigNumber.from(0);
          // let shares: Array<BigNumber> = [];
          // await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("10"));
          // await vaultAsBob.work(
          //   0,
          //   deltaNeutralWorker.address,
          //   ethers.utils.parseEther("10"),
          //   ethers.utils.parseEther("10"),
          //   "0", // max return = 0, don't return NATIVE to the debt
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // // Pre-compute expectation
          // let [expectedLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(
          //   ethers.utils.parseEther("20"),
          //   path
          // );
          // accumLp = accumLp.add(expectedLp);
          // let expectedShare = workerHelper.computeBalanceToShare(expectedLp, totalShare, workerLpBefore);
          // shares.push(expectedShare);
          // totalShare = totalShare.add(expectedShare);
          // // Expect
          // let [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // expect(await deltaNeutralWorker.shares(1), `expect Pos#1 has ${shares[0]} shares`).to.be.eq(shares[0]);
          // expect(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1)),
          //   `expect Pos#1 LPs = ${expectedLp}`
          // ).to.be.eq(expectedLp);
          // expect(await deltaNeutralWorker.totalShare(), `expect totalShare = ${totalShare}`).to.be.eq(totalShare);
          // expect(
          //   await baseToken.balanceOf(addStrat.address),
          //   `expect add BTOKEN strat to have ${debrisBtoken} BTOKEN debris`
          // ).to.be.eq(debrisBtoken);
          // expect(
          //   await farmToken.balanceOf(addStrat.address),
          //   `expect add BTOKEN strat to have ${debrisFtoken} FTOKEN debris`
          // ).to.be.eq(debrisFtoken);
          // expect(workerLpAfter, `expect Worker to stake ${accumLp} LP`).to.be.eq(accumLp);
          // // Position#2: Bob borrows another 2 BTOKEN
          // [workerLpBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // let eveCakeBefore = await cake.balanceOf(eveAddress);
          // let deployerCakeBefore = await cake.balanceOf(DEPLOYER);
          // // Position#2: Bob open 1x position with 3 BTOKEN
          // await swapHelper.loadReserves(path);
          // await swapHelper.loadReserves(reinvestPath);
          // await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("3"));
          // await vaultAsBob.work(
          //   0,
          //   deltaNeutralWorker.address,
          //   ethers.utils.parseEther("3"),
          //   "0",
          //   "0", // max return = 0, don't return BTOKEN to the debt
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // let eveCakeAfter = await cake.balanceOf(eveAddress);
          // let deployerCakeAfter = await cake.balanceOf(DEPLOYER);
          // let totalRewards = swapHelper.computeTotalRewards(workerLpBefore, CAKE_REWARD_PER_BLOCK, BigNumber.from(2));
          // let reinvestFees = totalRewards.mul(REINVEST_BOUNTY_BPS).div(10000);
          // let reinvestLeft = totalRewards.sub(reinvestFees);
          // let reinvestAmts = await swapHelper.computeSwapExactTokensForTokens(reinvestLeft, reinvestPath, true);
          // let reinvestBtoken = reinvestAmts[reinvestAmts.length - 1].add(debrisBtoken);
          // let reinvestLp = BigNumber.from(0);
          // [reinvestLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(reinvestBtoken, path);
          // accumLp = accumLp.add(reinvestLp);
          // [expectedLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(
          //   ethers.utils.parseEther("3"),
          //   path
          // );
          // accumLp = accumLp.add(expectedLp);
          // expectedShare = workerHelper.computeBalanceToShare(expectedLp, totalShare, workerLpBefore.add(reinvestLp));
          // shares.push(expectedShare);
          // totalShare = totalShare.add(expectedShare);
          // expect(await deltaNeutralWorker.shares(1), `expect Pos#1 has ${shares[0]} shares`).to.be.eq(shares[0]);
          // expect(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1)),
          //   `expect Pos#1 LPs = ${workerHelper.computeShareToBalance(shares[0], totalShare, workerLpAfter)}`
          // ).to.be.eq(workerHelper.computeShareToBalance(shares[0], totalShare, workerLpAfter));
          // expect(await deltaNeutralWorker.shares(2), `expect Pos#2 has ${shares[1]} shares`).to.be.eq(shares[1]);
          // expect(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(2)),
          //   `expect Pos#2 LPs = ${workerHelper.computeShareToBalance(shares[1], totalShare, workerLpAfter)}`
          // ).to.be.eq(workerHelper.computeShareToBalance(shares[1], totalShare, workerLpAfter));
          // expect(
          //   deployerCakeAfter.sub(deployerCakeBefore),
          //   `expect DEPLOYER to get ${reinvestFees} CAKE as treasury fees`
          // ).to.be.eq(reinvestFees);
          // expect(eveCakeAfter.sub(eveCakeBefore), `expect eve's CAKE to remain the same`).to.be.eq("0");
          // expect(workerLpAfter, `expect Worker to stake ${accumLp} LP`).to.be.eq(accumLp);
          // expect(
          //   await baseToken.balanceOf(addStrat.address),
          //   `expect add BTOKEN strat to have ${debrisBtoken} BTOKEN debris`
          // ).to.be.eq(debrisBtoken);
          // expect(
          //   await farmToken.balanceOf(addStrat.address),
          //   `expect add BTOKEN strat to have ${debrisFtoken} FTOKEN debris`
          // ).to.be.eq(debrisFtoken);
          // // ---------------- Reinvest#1 -------------------
          // // Wait for 1 day and someone calls reinvest
          // await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          // let [workerLPBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // deployerCakeBefore = await cake.balanceOf(DEPLOYER);
          // eveCakeBefore = await cake.balanceOf(eveAddress);
          // await swapHelper.loadReserves(path);
          // await swapHelper.loadReserves(reinvestPath);
          // await deltaNeutralWorkerAsEve.reinvest();
          // deployerCakeAfter = await cake.balanceOf(DEPLOYER);
          // eveCakeAfter = await cake.balanceOf(eveAddress);
          // [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          // totalRewards = swapHelper.computeTotalRewards(workerLPBefore, CAKE_REWARD_PER_BLOCK, BigNumber.from(2));
          // reinvestFees = totalRewards.mul(REINVEST_BOUNTY_BPS).div(10000);
          // reinvestLeft = totalRewards.sub(reinvestFees);
          // reinvestAmts = await swapHelper.computeSwapExactTokensForTokens(reinvestLeft, reinvestPath, true);
          // reinvestBtoken = reinvestAmts[reinvestAmts.length - 1].add(debrisBtoken);
          // [reinvestLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(reinvestBtoken, path);
          // accumLp = accumLp.add(reinvestLp);
          // expect(await deltaNeutralWorker.shares(1), `expect Pos#1 has ${shares[0]} shares`).to.be.eq(shares[0]);
          // expect(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1)),
          //   `expect Pos#1 LPs = ${workerHelper.computeShareToBalance(shares[0], totalShare, workerLpAfter)}`
          // ).to.be.eq(workerHelper.computeShareToBalance(shares[0], totalShare, workerLpAfter));
          // expect(await deltaNeutralWorker.shares(2), `expect Pos#2 has ${shares[1]} shares`).to.be.eq(shares[1]);
          // expect(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(2)),
          //   `expect Pos#2 LPs = ${workerHelper.computeShareToBalance(shares[1], totalShare, workerLpAfter)}`
          // ).to.be.eq(workerHelper.computeShareToBalance(shares[1], totalShare, workerLpAfter));
          // expect(deployerCakeAfter.sub(deployerCakeBefore), `expect DEPLOYER's CAKE to remain the same`).to.be.eq("0");
          // expect(eveCakeAfter.sub(eveCakeBefore), `expect eve to get ${reinvestFees}`).to.be.eq(reinvestFees);
          // expect(workerLpAfter).to.be.eq(accumLp);
          // // Check Position#1 info
          // let [bob1Health, bob1DebtToShare] = await vault.positionInfo("1");
          // const bob1ExpectedHealth = await swapHelper.computeLpHealth(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1)),
          //   baseToken.address,
          //   farmToken.address
          // );
          // expect(bob1Health, `expect Pos#1 health = ${bob1ExpectedHealth}`).to.be.eq(bob1ExpectedHealth);
          // expect(bob1Health).to.be.gt(ethers.utils.parseEther("20"));
          // AssertHelpers.assertAlmostEqual(ethers.utils.parseEther("10").toString(), bob1DebtToShare.toString());
          // // Check Position#2 info
          // let [bob2Health, bob2DebtToShare] = await vault.positionInfo("2");
          // const bob2ExpectedHealth = await swapHelper.computeLpHealth(
          //   await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(2)),
          //   baseToken.address,
          //   farmToken.address
          // );
          // expect(bob2Health, `expect Pos#2 health = ${bob2ExpectedHealth}`).to.be.eq(bob2ExpectedHealth);
          // expect(bob2Health).to.be.gt(ethers.utils.parseEther("3"));
          // AssertHelpers.assertAlmostEqual("0", bob2DebtToShare.toString());
          // let bobBefore = await baseToken.balanceOf(bobAddress);
          // let bobAlpacaBefore = await alpacaToken.balanceOf(bobAddress);
          // // Bob close position#1
          // await vaultAsBob.work(
          //   1,
          //   deltaNeutralWorker.address,
          //   "0",
          //   "0",
          //   "1000000000000000000000",
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [liqStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // let bobAfter = await baseToken.balanceOf(bobAddress);
          // let bobAlpacaAfter = await alpacaToken.balanceOf(bobAddress);
          // // Check Bob account, Bob must be richer as he earn more from yield
          // expect(bobAlpacaAfter).to.be.gt(bobAlpacaBefore);
          // expect(bobAfter).to.be.gt(bobBefore);
          // // Bob add another 10 BTOKEN
          // await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("10"));
          // await vaultAsBob.work(
          //   2,
          //   deltaNeutralWorker.address,
          //   ethers.utils.parseEther("10"),
          //   0,
          //   "0", // max return = 0, don't return NATIVE to the debt
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // bobBefore = await baseToken.balanceOf(bobAddress);
          // bobAlpacaBefore = await alpacaToken.balanceOf(bobAddress);
          // // Bob close position#2
          // await vaultAsBob.work(
          //   2,
          //   deltaNeutralWorker.address,
          //   "0",
          //   "0",
          //   "1000000000000000000000000000000",
          //   ethers.utils.defaultAbiCoder.encode(
          //     ["address", "bytes"],
          //     [liqStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
          //   )
          // );
          // bobAfter = await baseToken.balanceOf(bobAddress);
          // bobAlpacaAfter = await alpacaToken.balanceOf(bobAddress);
          // // Check Bob account, Bob must be richer as she earned from leverage yield farm without getting liquidated
          // // But bob shouldn't earn more ALPACAs from closing position#2
          // expect(bobAfter).to.be.gt(bobBefore);
          // expect(bobAlpacaAfter).to.be.eq(bobAlpacaBefore);
        });
      });

      context("#kill", async () => {
        it("should not allow user not whitelisted to liquidate", async () => {
          await expect(vaultAsBob.kill("1")).to.be.revertedWith("!whitelisted liquidator");
        });

        it("should be able to liquidate bad position", async () => {
          // Deployer deposits 3 BTOKEN to the bank
          const deposit = ethers.utils.parseEther("3");
          await baseToken.approve(vault.address, deposit);
          await vault.deposit(deposit);
          // Now Alice can take 1 BTOKEN loan + 1 BTOKEN of her to create a new position
          const loan = ethers.utils.parseEther("1");
          await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
          await vaultAsAlice.work(
            0,
            deltaNeutralWorker.address,
            ethers.utils.parseEther("1"),
            loan,
            "0",
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            )
          );
          await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          await deltaNeutralWorkerAsEve.reinvest();
          await vault.deposit(0); // Random action to trigger interest computation
          await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          await vault.deposit(0); // Random action to trigger interest computation
          const interest = ethers.utils.parseEther("0.3"); //30% interest rate
          const reservePool = interest.mul(RESERVE_POOL_BPS).div("10000");
          AssertHelpers.assertAlmostEqual(
            deposit
              .add(interest.sub(reservePool))
              .add(interest.sub(reservePool).mul(13).div(10))
              .add(interest.sub(reservePool).mul(13).div(10))
              .toString(),
            (await vault.totalToken()).toString()
          );
          // Calculate the expected result.
          // set interest rate to be 0 to be easy for testing.
          await simpleVaultConfig.setParams(
            MIN_DEBT_SIZE,
            0,
            RESERVE_POOL_BPS,
            KILL_PRIZE_BPS,
            wbnb.address,
            wNativeRelayer.address,
            fairLaunch.address,
            KILL_TREASURY_BPS,
            deployerAddress
          );
          // Now eve kill the position
          await expect(vaultAsEve.kill("1")).to.be.revertedWith("can't liquidate");
        });

        it("should liquidate user position correctly", async () => {
          // Bob deposits 20 BTOKEN
          await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("20"));
          await vaultAsBob.deposit(ethers.utils.parseEther("20"));
          // Position#1: Alice borrows 10 BTOKEN loan
          await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("10"));
          await vaultAsAlice.work(
            0,
            deltaNeutralWorker.address,
            ethers.utils.parseEther("10"),
            ethers.utils.parseEther("10"),
            "0", // max return = 0, don't return BTOKEN to the debt
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            )
          );

          // Price swing 10%
          // Feed new price from 200 for 20% to make lp price down ~10%
          // 200 * (1 - 0.2) = 160
          let mockAggregatorV3 = await MockAggregatorV3Factory.deploy(ethers.utils.parseEther("160"), 18);
          await mockAggregatorV3.deployed();
          chainLinkOracleAsDeployer.setPriceFeeds([farmToken.address], [busd.address], [mockAggregatorV3.address]);
          await expect(vaultAsEve.kill("1")).to.be.revertedWith("can't liquidate");

          // Price swing 20%
          // Feed new price from 160 for 40% to make lp price down ~20%
          // 160 * (1 - 0.4) = 96
          mockAggregatorV3 = await MockAggregatorV3Factory.deploy(ethers.utils.parseEther("96"), 18);
          await mockAggregatorV3.deployed();
          chainLinkOracleAsDeployer.setPriceFeeds([farmToken.address], [busd.address], [mockAggregatorV3.address]);
          await expect(vaultAsEve.kill("1")).to.be.revertedWith("can't liquidate");

          // Price swing 23.43%
          // Feed new price from 96 for 46.86% to make lp price down ~23.43%
          // 96 * (1 - 0.4686) = 51.0144
          mockAggregatorV3 = await MockAggregatorV3Factory.deploy(ethers.utils.parseEther("51.0144"), 18);
          await mockAggregatorV3.deployed();
          chainLinkOracleAsDeployer.setPriceFeeds([farmToken.address], [busd.address], [mockAggregatorV3.address]);
          await expect(vaultAsEve.kill("1")).to.be.revertedWith("can't liquidate");
          // Price swing 30%
          // Feed new price from 96 for 60% to make lp price down ~23.43%
          // 51.0144 * (1 - 0.6) = 20.40576
          mockAggregatorV3 = await MockAggregatorV3Factory.deploy(ethers.utils.parseEther("20.40576"), 18);
          await mockAggregatorV3.deployed();
          chainLinkOracleAsDeployer.setPriceFeeds([farmToken.address], [busd.address], [mockAggregatorV3.address]);

          // Now you can liquidate because of the price fluctuation
          const eveBefore = await baseToken.balanceOf(eveAddress);
          await expect(vaultAsEve.kill("1")).to.be.revertedWith("NotAllowToLiquidate()");
          expect(await baseToken.balanceOf(eveAddress)).to.be.eq(eveBefore);
        });
      });

      context("#deposit-#withdraw", async () => {
        it("should deposit and withdraw BTOKEN from Vault (bad debt case)", async () => {
          // Deployer deposits 10 BTOKEN to the Vault
          const deposit = ethers.utils.parseEther("10");
          await baseToken.approve(vault.address, deposit);
          await vault.deposit(deposit);

          expect(await vault.balanceOf(deployerAddress)).to.be.equal(deposit);

          // Bob borrows 2 BTOKEN loan
          const loan = ethers.utils.parseEther("2");
          await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("1"));
          await vaultAsBob.work(
            0,
            deltaNeutralWorker.address,
            ethers.utils.parseEther("1"),
            loan,
            "0", // max return = 0, don't return BTOKEN to the debt
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            )
          );

          expect(await baseToken.balanceOf(vault.address)).to.be.equal(deposit.sub(loan));
          expect(await vault.vaultDebtVal()).to.be.equal(loan);
          expect(await vault.totalToken()).to.be.equal(deposit);

          // Alice deposits 2 BTOKEN
          const aliceDeposit = ethers.utils.parseEther("2");
          await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("2"));
          await vaultAsAlice.deposit(aliceDeposit);

          AssertHelpers.assertAlmostEqual(
            deposit.sub(loan).add(aliceDeposit).toString(),
            (await baseToken.balanceOf(vault.address)).toString()
          );

          // check Alice ibBTOKEN balance = 2/10 * 10 = 2 ibBTOKEN
          AssertHelpers.assertAlmostEqual(aliceDeposit.toString(), (await vault.balanceOf(aliceAddress)).toString());
          AssertHelpers.assertAlmostEqual(deposit.add(aliceDeposit).toString(), (await vault.totalSupply()).toString());

          // Price swing to 1$
          let mockAggregatorV3 = await MockAggregatorV3Factory.deploy(ethers.utils.parseEther("1"), 18);
          await mockAggregatorV3.deployed();
          chainLinkOracleAsDeployer.setPriceFeeds([farmToken.address], [busd.address], [mockAggregatorV3.address]);

          // Alice liquidates Bob position#1
          let aliceBefore = await baseToken.balanceOf(aliceAddress);

          await expect(vaultAsAlice.kill("1")).to.be.revertedWith("NotAllowToLiquidate()");

          // let aliceAfter = await baseToken.balanceOf(aliceAddress);

          // // Bank balance is increase by liquidation
          // AssertHelpers.assertAlmostEqual(
          //   ethers.utils.parseEther("10.002702699312215556").toString(),
          //   (await baseToken.balanceOf(vault.address)).toString()
          // );
          // // Alice is liquidator, Alice should receive 10% Kill prize
          // // BTOKEN back from liquidation 0.00300199830261993, 10% of it is 0.000300199830261993
          // AssertHelpers.assertAlmostEqual(
          //   ethers.utils.parseEther("0.000300199830261993").toString(),
          //   aliceAfter.sub(aliceBefore).toString()
          // );

          // // Alice withdraws 2 BOKTEN
          // aliceBefore = await baseToken.balanceOf(aliceAddress);
          // await vaultAsAlice.withdraw(await vault.balanceOf(aliceAddress));
          // let aliceAfter = await baseToken.balanceOf(aliceAddress);
          // console.log(aliceAfter);

          // // alice gots 2/12 * 10.002702699312215556 = 1.667117116552036
          // AssertHelpers.assertAlmostEqual(
          //   ethers.utils.parseEther("1.667117116552036").toString(),
          //   aliceAfter.sub(aliceBefore).toString()
          // );
        });
      });

      context("#reinvest", async () => {
        it("should reinvest correctly", async () => {
          // Set interests to 0% per year for easy testing
          await simpleVaultConfig.setParams(
            ethers.utils.parseEther("1"), // 1 BTOKEN min debt size,
            "0", // 0% per year
            "1000", // 10% reserve pool
            "1000", // 10% Kill prize
            wbnb.address,
            wNativeRelayer.address,
            fairLaunch.address,
            "0",
            ethers.constants.AddressZero
          );
          // Set Reinvest bounty to 10% of the reward
          await deltaNeutralWorker.setReinvestConfig("100", "0", [cake.address, wbnb.address, baseToken.address]);
          const [path, reinvestPath] = await Promise.all([
            deltaNeutralWorker.getPath(),
            deltaNeutralWorker.getReinvestPath(),
          ]);
          // DeltaNet deposits 10 BTOKEN
          await baseTokenAsDeltaNet.approve(vault.address, ethers.utils.parseEther("30"));
          await vaultAsDeltaNet.deposit(ethers.utils.parseEther("30"));
          // Position#1: DeltaNet borrows 10 BTOKEN
          await swapHelper.loadReserves(path);
          let accumLp = BigNumber.from(0);
          let workerLpBefore = BigNumber.from(0);
          await baseTokenAsDeltaNet.approve(vault.address, ethers.utils.parseEther("10"));
          await vaultAsDeltaNet.work(
            0,
            deltaNeutralWorker.address,
            ethers.utils.parseEther("10"),
            ethers.utils.parseEther("10"),
            "0", // max return = 0, don't return NATIVE to the debt
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            )
          );
          // Pre-compute expectation
          let [expectedLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(
            ethers.utils.parseEther("20"),
            path
          );
          accumLp = accumLp.add(expectedLp);

          // Expect
          let [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          expect(await deltaNeutralWorker.totalLpBalance(), "expected total Lp amount").to.be.eq(expectedLp);
          expect(
            await baseToken.balanceOf(addStrat.address),
            `expect add BTOKEN strat to have ${debrisBtoken} BTOKEN debris`
          ).to.be.eq(debrisBtoken);
          expect(
            await farmToken.balanceOf(addStrat.address),
            `expect add BTOKEN strat to have ${debrisFtoken} FTOKEN debris`
          ).to.be.eq(debrisFtoken);
          expect(workerLpAfter, `expect Worker to stake ${accumLp} LP`).to.be.eq(accumLp);
          // DeltaNet borrows another 2 BTOKEN
          [workerLpBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          let eveCakeBefore = await cake.balanceOf(eveAddress);
          let deployerCakeBefore = await cake.balanceOf(DEPLOYER);
          await swapHelper.loadReserves(path);
          await swapHelper.loadReserves(reinvestPath);
          await baseTokenAsDeltaNet.approve(vault.address, ethers.utils.parseEther("1"));
          // alice add collateral more in position
          await vaultAsDeltaNet.work(
            1, // change from create new position
            deltaNeutralWorker.address,
            ethers.utils.parseEther("1"),
            ethers.utils.parseEther("2"),
            "0", // max return = 0, don't return BTOKEN to the debt
            ethers.utils.defaultAbiCoder.encode(
              ["address", "bytes"],
              [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            )
          );
          [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          let eveCakeAfter = await cake.balanceOf(eveAddress);
          let deployerCakeAfter = await cake.balanceOf(DEPLOYER);
          let totalRewards = swapHelper.computeTotalRewards(workerLpBefore, CAKE_REWARD_PER_BLOCK, BigNumber.from(2));
          let reinvestFees = totalRewards.mul(REINVEST_BOUNTY_BPS).div(10000);
          let reinvestLeft = totalRewards.sub(reinvestFees);
          let reinvestAmts = await swapHelper.computeSwapExactTokensForTokens(reinvestLeft, reinvestPath, true);
          let reinvestBtoken = reinvestAmts[reinvestAmts.length - 1].add(debrisBtoken);
          let reinvestLp = BigNumber.from(0);
          [reinvestLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(reinvestBtoken, path);
          accumLp = accumLp.add(reinvestLp);
          [expectedLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(
            ethers.utils.parseEther("3"),
            path
          );
          accumLp = accumLp.add(expectedLp);
          expect(
            deployerCakeAfter.sub(deployerCakeBefore),
            `expect DEPLOYER to get ${reinvestFees} CAKE as treasury fees`
          ).to.be.eq(reinvestFees);
          expect(eveCakeAfter.sub(eveCakeBefore), `expect eve's CAKE to remain the same`).to.be.eq("0");
          expect(workerLpAfter, `expect Worker to stake ${accumLp} LP`).to.be.eq(accumLp);
          expect(
            await baseToken.balanceOf(addStrat.address),
            `expect add BTOKEN strat to have ${debrisBtoken} BTOKEN debris`
          ).to.be.eq(debrisBtoken);
          expect(
            await farmToken.balanceOf(addStrat.address),
            `expect add BTOKEN strat to have ${debrisFtoken} FTOKEN debris`
          ).to.be.eq(debrisFtoken);
          // ---------------- Reinvest#1 -------------------
          // Wait for 1 day and someone calls reinvest
          await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
          let [workerLPBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          deployerCakeBefore = await cake.balanceOf(DEPLOYER);
          eveCakeBefore = await cake.balanceOf(eveAddress);
          await swapHelper.loadReserves(path);
          await swapHelper.loadReserves(reinvestPath);
          await deltaNeutralWorkerAsEve.reinvest();
          deployerCakeAfter = await cake.balanceOf(DEPLOYER);
          eveCakeAfter = await cake.balanceOf(eveAddress);
          [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
          totalRewards = swapHelper.computeTotalRewards(workerLPBefore, CAKE_REWARD_PER_BLOCK, BigNumber.from(2));
          reinvestFees = totalRewards.mul(REINVEST_BOUNTY_BPS).div(10000);
          reinvestLeft = totalRewards.sub(reinvestFees);
          reinvestAmts = await swapHelper.computeSwapExactTokensForTokens(reinvestLeft, reinvestPath, true);
          reinvestBtoken = reinvestAmts[reinvestAmts.length - 1].add(debrisBtoken);
          [reinvestLp, debrisBtoken, debrisFtoken] = await swapHelper.computeOneSidedOptimalLp(reinvestBtoken, path);
          accumLp = accumLp.add(reinvestLp);
          expect(deployerCakeAfter.sub(deployerCakeBefore), `expect DEPLOYER's CAKE to remain the same`).to.be.eq("0");
          expect(eveCakeAfter.sub(eveCakeBefore), `expect eve to get ${reinvestFees}`).to.be.eq(reinvestFees);
          expect(workerLpAfter).to.be.eq(accumLp);
          // Check Position info
          let [vaultHealth, vaultDebtToShare] = await vault.positionInfo("1");
          // health calculation
          // lp balance =  1.245043209303108183
          // lp price =  28.31456242504544871
          // lp balance in dollar =  35.252853671691783003
          // base token price =  1.0
          // lp balance in dollar / base token price
          // 35.252853671691783003 / 1.0 = 35.252853671691783003

          const vaultExpectedHealth = ethers.utils.parseEther("35.252853671691783003");
          expect(vaultHealth, `expect Position health = ${vaultExpectedHealth}`).to.be.eq(vaultExpectedHealth);
          // now we got debt to share as 12 because DeltaNet barrow 10 and 2
          AssertHelpers.assertAlmostEqual(ethers.utils.parseEther("12").toString(), vaultDebtToShare.toString());
        });
      });

      context("#partialclose", async () => {
        context("#liquidate", async () => {
          context("when maxReturn is lessDebt", async () => {
            // back cannot be less than lessDebt as less debt is Min(debt, back, maxReturn) = maxReturn
            it("should pay debt 'maxReturn' BTOKEN and return 'liquidatedAmount - maxReturn' BTOKEN to user", async () => {
              // Set interests to 0% per year for easy testing
              await simpleVaultConfig.setParams(
                ethers.utils.parseEther("1"), // 1 BTOKEN min debt size,
                "0", // 0% per year
                "1000", // 10% reserve pool
                "1000", // 10% Kill prize
                wbnb.address,
                wNativeRelayer.address,
                fairLaunch.address,
                "0",
                ethers.constants.AddressZero
              );
              const [path, reinvestPath] = await Promise.all([
                deltaNeutralWorker.getPath(),
                deltaNeutralWorker.getReinvestPath(),
              ]);
              // Set Reinvest bounty to 1% of the reward
              await deltaNeutralWorker.setReinvestConfig("100", "0", [cake.address, wbnb.address, baseToken.address]);
              // DeltaNet deposits 10 BTOKEN
              await baseTokenAsDeltaNet.approve(vault.address, ethers.utils.parseEther("10"));
              await vaultAsDeltaNet.deposit(ethers.utils.parseEther("10"));
              // Position: DeltaNet borrows 10 BTOKEN loan and supply another 10 BToken
              // Thus, DeltaNet's position value will be worth 20 BTOKEN
              // After calling `work()`
              // 20 BTOKEN needs to swap 3.587061715703192586 BTOKEN to FTOKEN
              // new reserve after swap will be 4.587061715703192586 0.021843151027158060
              // based on optimal swap formula, BTOKEN-FTOKEN to be added into the LP will be 16.412938284296807414 BTOKEN - 0.078156848972841940 FTOKEN
              // new reserve after adding liquidity 21.000000000000000000 BTOKEN - 0.100000000000000000 FTOKEN
              // lp amount from adding liquidity will be 1.131492691639043045 LP
              const borrowedAmount = ethers.utils.parseEther("10");
              const principalAmount = ethers.utils.parseEther("10");
              let [workerLpBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
              await swapHelper.loadReserves(path);
              await swapHelper.loadReserves(reinvestPath);
              await baseTokenAsDeltaNet.approve(vault.address, ethers.utils.parseEther("10"));
              await vaultAsDeltaNet.work(
                0,
                deltaNeutralWorker.address,
                principalAmount,
                borrowedAmount,
                "0", // max return = 0, don't return NATIVE to the debt
                ethers.utils.defaultAbiCoder.encode(
                  ["address", "bytes"],
                  [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
                )
              );
              let [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
              const [expectedLp, debrisBtoken] = await swapHelper.computeOneSidedOptimalLp(
                borrowedAmount.add(principalAmount),
                path
              );
              expect(workerLpAfter.sub(workerLpBefore)).to.eq(expectedLp);
              const deployerCakeBefore = await cake.balanceOf(DEPLOYER);
              const deltaNetBefore = await baseToken.balanceOf(deltaNetAddress);
              // calculation
              // lp balance =  1.131492691639043045
              // lp price =  28.311959568634539084
              // lp balance in dollar =  32.034775337890054677
              // base token price =  1.0
              // lp balance in dollar / base token price
              // 32.034775337890054677 / 1.0 = 32.034775337890054677
              const [deltaNetHealthBefore] = await vault.positionInfo("1");
              expect(deltaNetHealthBefore).to.be.eq(ethers.utils.parseEther("32.034775337890054677"));
              const lpUnderPosition = await deltaNeutralWorker.totalLpBalance();
              const liquidatedLp = lpUnderPosition.div(2);
              const returnDebt = ethers.utils.parseEther("6");
              [workerLpBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
              // Pre-compute
              await swapHelper.loadReserves(path);
              await swapHelper.loadReserves(reinvestPath);
              // Compute reinvest
              const [reinvestFees, reinvestLp] = await swapHelper.computeReinvestLp(
                workerLpBefore,
                debrisBtoken,
                CAKE_REWARD_PER_BLOCK,
                BigNumber.from(REINVEST_BOUNTY_BPS),
                reinvestPath,
                path,
                BigNumber.from(1)
              );
              // Compute liquidate
              const [btokenAmount, ftokenAmount] = await swapHelper.computeRemoveLiquidiy(
                baseToken.address,
                farmToken.address,
                liquidatedLp
              );
              const sellFtokenAmounts = await swapHelper.computeSwapExactTokensForTokens(
                ftokenAmount,
                await deltaNeutralWorker.getReversedPath(),
                true
              );
              const liquidatedBtoken = sellFtokenAmounts[sellFtokenAmounts.length - 1]
                .add(btokenAmount)
                .sub(returnDebt);

              await vaultAsDeltaNet.work(
                1,
                deltaNeutralWorker.address,
                "0",
                "0",
                returnDebt,
                ethers.utils.defaultAbiCoder.encode(
                  ["address", "bytes"],
                  [
                    partialCloseStrat.address,
                    ethers.utils.defaultAbiCoder.encode(
                      ["uint256", "uint256", "uint256"],
                      [liquidatedLp, returnDebt, liquidatedBtoken]
                    ),
                  ]
                )
              );
              const deltaNetAfter = await baseToken.balanceOf(deltaNetAddress);
              const deployerCakeAfter = await cake.balanceOf(DEPLOYER);
              expect(deployerCakeAfter.sub(deployerCakeBefore), `expect Deployer to get ${reinvestFees}`).to.be.eq(
                reinvestFees
              );
              expect(deltaNetAfter.sub(deltaNetBefore), `expect DeltaNet get ${liquidatedBtoken}`).to.be.eq(
                liquidatedBtoken
              );
              // Check position info
              const [deltaNetHealthAfter] = await vault.positionInfo("1");
              // DeltaNet's health after partial close position must be 50% less than before
              // due to he exit half of lp under his position
              // calculation
              // lp balance =  0.576022514621445879
              // lp price =  28.325952106647866799
              // lp balance in dollar =  16.316386161517946552
              // base token price =  1.0
              // lp balance in dollar / base token price
              // 16.316386161517946552 / 1.0 = 16.316386161517946552
              expect(deltaNetHealthAfter).to.be.eq(ethers.utils.parseEther("16.316386161517946552"));
              [workerLpAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
              // LP tokens + 0.010276168801924356 LP from reinvest of worker should be decreased by lpUnderPosition / 2
              // due to Bob execute StrategyClosePartialLiquidate
              expect(workerLpAfter).to.be.eq(workerLpBefore.add(reinvestLp).sub(lpUnderPosition.div(2)));
            });
          });

          context("when debt is lessDebt", async () => {
            // back cannot be less than lessDebt as less debt is Min(debt, back, maxReturn) = debt
            it("should pay back all debt and return 'liquidatedAmount - debt' BTOKEN to user", async () => {
              // Set interests to 0% per year for easy testing
              await simpleVaultConfig.setParams(
                ethers.utils.parseEther("1"), // 1 BTOKEN min debt size,
                "0", // 0% per year
                "1000", // 10% reserve pool
                "1000", // 10% Kill prize
                wbnb.address,
                wNativeRelayer.address,
                fairLaunch.address,
                "0",
                ethers.constants.AddressZero
              );
              // DeltaNet deposits 10 BTOKEN
              await baseTokenAsDeltaNet.approve(vault.address, ethers.utils.parseEther("10"));
              await vaultAsDeltaNet.deposit(ethers.utils.parseEther("10"));
              // Position: DeltaNet borrows 10 BTOKEN loan and supply another 10 BToken
              // Thus, DeltaNet's position value will be worth 20 BTOKEN
              // After calling `work()`
              // 20 BTOKEN needs to swap 3.587061715703192586 BTOKEN to FTOKEN
              // new reserve after swap will be 4.587061715703192586 0.021843151027158060
              // based on optimal swap formula, BTOKEN-FTOKEN to be added into the LP will be 16.412938284296807414 BTOKEN - 0.078156848972841940 FTOKEN
              // new reserve after adding liquidity 21.000000000000000000 BTOKEN - 0.100000000000000000 FTOKEN
              // lp amount from adding liquidity will be 1.131492691639043045 LP
              let [workerLPBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
              const borrowedAmount = ethers.utils.parseEther("10");
              const principalAmount = ethers.utils.parseEther("10");
              await baseTokenAsDeltaNet.approve(vault.address, ethers.utils.parseEther("10"));
              await vaultAsDeltaNet.work(
                0,
                deltaNeutralWorker.address,
                principalAmount,
                borrowedAmount,
                "0", // max return = 0, don't return BTOKEN to the debt
                ethers.utils.defaultAbiCoder.encode(
                  ["address", "bytes"],
                  [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
                )
              );
              let [workerLPAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
              expect(workerLPAfter.sub(workerLPBefore)).to.eq(parseEther("1.131492691639043045"));
              // DeltaNet think he made enough. He now wants to close position partially.
              // He close 50% of his position and return all debt
              const deltaNetBefore = await baseToken.balanceOf(deltaNetAddress);
              const [deltaNetHealthBefore] = await vault.positionInfo("1");
              const lpUnderPosition = await deltaNeutralWorker.totalLpBalance();
              [workerLPBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
              // DeltaNet think he made enough. He now wants to close position partially.
              // After calling `work()`, the `_reinvest()` is invoked
              // since 1 blocks have passed since approve and work now reward will be 0.076 * 1 =~ 0.075999999998831803 ~   CAKE
              // reward without bounty will be 0.075999999998831803 - 0.000759999999988318 =~ 0.0752399999988435 CAKE
              // 0.0752399999988435 CAKE can be converted into:
              // (0.0752399999988435 * 0.9975 * 1) / (0.1 + 0.0752399999988435 * 0.9975) = 0.428740847712892766 WBNB
              // 0.428740847712892766 WBNB can be converted into (0.428740847712892766 * 0.9975 * 1) / (1 + 0.428740847712892766 * 0.9975) = 0.299557528330150526 BTOKEN
              // based on optimal swap formula, 0.299557528330150526 BTOKEN needs to swap 0.149435199790075736 BTOKEN
              // new reserve after swap will be 21.149435199790075736 BTOKEN - 0.099295185694161018 FTOKEN
              // based on optimal swap formula, BTOKEN-FTOKEN to be added into the LP will be 0.150122328540074790 BTOKEN - 0.000704814305838982 FTOKEN
              // new reserve after adding liquidity receiving from `_reinvest()` is 21.299557528330150526 BTOKEN - 0.100000000000000000 FTOKEN
              // more LP amount after executing add strategy will be 0.010276168801924356 LP
              // accumulated LP of the worker will be 1.131492691639043045 + 0.010276168801924356 = 1.1417688604409675 LP
              // DeltaNet close 50% of his position, thus he will close 1.131492691639043045 * (1.131492691639043045 / (1.131492691639043045)) =~ 1.131492691639043045 / 2 = 0.5657463458195215 LP
              // 0.5657463458195215 LP will be converted into 8.264866063854500749 BTOKEN - 0.038802994160144191 FTOKEN
              // 0.038802994160144191 FTOKEN will be converted into (0.038802994160144191 * 0.9975 * 13.034691464475649777) / (0.061197005839855809 + 0.038802994160144191 * 0.9975) = 5.050104921127982573 BTOKEN
              // thus, DeltaNet will receive 8.264866063854500749 + 5.050104921127982573 = 13.314970984982483322 BTOKEN
              await vaultAsDeltaNet.work(
                1,
                deltaNeutralWorker.address,
                "0",
                "0",
                ethers.utils.parseEther("5000000000"),
                ethers.utils.defaultAbiCoder.encode(
                  ["address", "bytes"],
                  [
                    partialCloseStrat.address,
                    ethers.utils.defaultAbiCoder.encode(
                      ["uint256", "uint256", "uint256"],
                      [
                        lpUnderPosition.div(2),
                        ethers.utils.parseEther("5000000000"),
                        ethers.utils.parseEther("3.314970984982483322"),
                      ]
                    ),
                  ]
                )
              );
              const deltaNetAfter = await baseToken.balanceOf(deltaNetAddress);
              // After DeltaNet liquidate half of his position which worth
              // 13.314970984982483322 BTOKEN (price impact+trading fee included)
              // DeltaNet wish to return 5,000,000,000 BTOKEN (when maxReturn > debt, return all debt)
              // The following criteria must be stratified:
              // - DeltaNet should get 13.314970984982483322 - 10 = 3.314970984982483322 BTOKEN back.
              // - DeltaNet's position debt must be 0
              expect(
                deltaNetBefore.add(ethers.utils.parseEther("3.314970984982483322")),
                "Expect BTOKEN in Bob's account after close position to increase by ~3.32 BTOKEN"
              ).to.be.eq(deltaNetAfter);
              // Check Bob position info
              const [deltaNetHealth, deltaNetDebtVal] = await vault.positionInfo("1");
              // DeltaNet's health after partial close position must be 50% less than before
              // due to he exit half of lp under his position
              // calculation
              // lp balance =  0.576022514621445879
              // lp price =  28.325952106647866799
              // lp balance in dollar =  16.316386161517946552
              // base token price =  1.0
              // lp balance in dollar / base token price
              // 16.316386161517946552 / 1.0 = 16.316386161517946552
              expect(deltaNetHealth).to.be.eq(ethers.utils.parseEther("16.316386161517946552"));
              // DeltaNet's debt should be 0 BTOKEN due he said he wants to return at max 5,000,000,000 BTOKEN (> debt, return all debt)
              expect(deltaNetDebtVal).to.be.eq("0");
              // Check LP deposited by Worker on MasterChef
              [workerLPAfter] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
              // LP tokens + LP tokens from reinvest of worker should be decreased by lpUnderBobPosition/2
              // due to DeltaNet execute StrategyClosePartialLiquidate
              expect(workerLPAfter).to.be.eq(
                workerLPBefore.add(parseEther("0.010276168801924356")).sub(lpUnderPosition.div(2))
              );
            });
          });

          // QUESTION: do we need this test?
          context("when worker factor is not satisfy", async () => {
            //       it("should revert bad work factor", async () => {
            //         // Set interests to 0% per year for easy testing
            //         await simpleVaultConfig.setParams(
            //           ethers.utils.parseEther("1"), // 1 BTOKEN min debt size,
            //           "0", // 0% per year
            //           "1000", // 10% reserve pool
            //           "1000", // 10% Kill prize
            //           wbnb.address,
            //           wNativeRelayer.address,
            //           fairLaunch.address,
            //           "0",
            //           ethers.constants.AddressZero
            //         );
            //         // Bob deposits 10 BTOKEN
            //         await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("10"));
            //         await vaultAsBob.deposit(ethers.utils.parseEther("10"));
            //         // Position#1: Bob borrows 10 BTOKEN
            //         await baseTokenAsBob.approve(vault.address, ethers.utils.parseEther("10"));
            //         await vaultAsBob.work(
            //           0,
            //           deltaNeutralWorker.address,
            //           ethers.utils.parseEther("10"),
            //           ethers.utils.parseEther("10"),
            //           "0", // max return = 0, don't return BTOKEN to the debt
            //           ethers.utils.defaultAbiCoder.encode(
            //             ["address", "bytes"],
            //             [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
            //           )
            //         );
            //         // Bob think he made enough. He now wants to close position partially.
            //         // He liquidate all of his position but not payback the debt.
            //         const lpUnderBobPosition = await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1));
            //         // Bob closes position with maxReturn 0 and liquidate all of his position
            //         // Expect that Bob will not be able to close his position as he liquidate all underlying assets but not paydebt
            //         // which made his position debt ratio higher than allow work factor
            //         await expect(
            //           vaultAsBob.work(
            //             1,
            //             deltaNeutralWorker.address,
            //             "0",
            //             "0",
            //             "0",
            //             ethers.utils.defaultAbiCoder.encode(
            //               ["address", "bytes"],
            //               [
            //                 partialCloseStrat.address,
            //                 ethers.utils.defaultAbiCoder.encode(
            //                   ["uint256", "uint256", "uint256"],
            //                   [lpUnderBobPosition, "0", "0"]
            //                 ),
            //               ]
            //             )
            //           )
            //         ).revertedWith("bad work factor");
            //       });
            // });
          });
        });

        context("When the treasury Account and treasury bounty bps haven't been set", async () => {
          // if we adjust position with same condition, we not got a same lp amount
          it("should not auto reinvest", async () => {
            await deltaNeutralWorker.setTreasuryConfig(constants.AddressZero, 0);
            // Deployer deposits 3 BTOKEN to the bank
            const deposit = ethers.utils.parseEther("3");
            await baseToken.approve(vault.address, deposit);
            await vault.deposit(deposit);
            // Now DeltaNet can take 1 BTOKEN loan + 1 BTOKEN of her to create a new position
            await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
            const path = await deltaNeutralWorker.getPath();
            await swapHelper.loadReserves(path);
            const [expectedLp1] = await swapHelper.computeOneSidedOptimalLp(ethers.utils.parseEther("2"), path);
            await vaultAsAlice.work(
              0,
              deltaNeutralWorker.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1"),
              "0",
              ethers.utils.defaultAbiCoder.encode(
                ["address", "bytes"],
                [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
              )
            );

            // lp balance =  0.231205137369691323
            // lp price =  28.299236836137312801
            // lp balance in dollar =  6.542928940156556263
            // base token price =  1.0
            // lp balance in dollar / base token price
            // 6.542928940156556263 / 1.0 = 6.542928940156556263
            const [health] = await vault.positionInfo("1");
            const totalLpBalance = await deltaNeutralWorker.totalLpBalance();
            expect(totalLpBalance, `expect #1 should be ${ethers.utils.formatEther(expectedLp1)}`).to.be.eq(
              expectedLp1
            );
            expect(totalLpBalance).to.be.eq(expectedLp1);
            expect(health).to.be.eq(ethers.utils.parseEther("6.542928940156556263"));

            const [expectedLp2] = await swapHelper.computeOneSidedOptimalLp(ethers.utils.parseEther("2"), path);
            await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
            await vaultAsAlice.work(
              1,
              deltaNeutralWorker.address,
              ethers.utils.parseEther("1"),
              ethers.utils.parseEther("1"),
              "0",
              ethers.utils.defaultAbiCoder.encode(
                ["address", "bytes"],
                [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
              )
            );

            const [healthAfter] = await vault.positionInfo("1");
            const totalLpBalanceAfter = await deltaNeutralWorker.totalLpBalance();
            expect(
              totalLpBalanceAfter,
              `expect #2 should be ${ethers.utils.formatEther(expectedLp2.add(expectedLp1))}`
            ).to.be.eq(expectedLp2.add(expectedLp1));

            // DeltaNet opens more position.
            // calculation
            // lp balance =  0.390305727260109981
            // lp price =  28.307221370693567499
            // lp balance in dollar =  11.04847062380148017
            // base token price =  1.0
            // lp balance in dollar / base token price
            // 11.04847062380148017 / 1.0 = 11048470623801480170
            expect(healthAfter).to.be.eq(ethers.utils.parseEther("11.048470623801480170"));
          });
        });

        // QUESTION: Do we need this test?
        // context("#addCollateral", async () => {
        //   //   const deposit = ethers.utils.parseEther("3");
        //   //   const borrowedAmount = ethers.utils.parseEther("1");
        //   //   beforeEach(async () => {
        //   //     // Deployer deposits 3 BTOKEN to the bank
        //   //     await baseToken.approve(vault.address, deposit);
        //   //     await vault.deposit(deposit);
        //   //     // Now Alice can borrow 1 BTOKEN + 1 BTOKEN of her to create a new position
        //   //     await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
        //   //     // Position#1: Alice borrows 1 BTOKEN and supply another 1 BTOKEN
        //   //     // After calling `work()`
        //   //     // 2 BTOKEN needs to swap 0.0732967258967755614 BTOKEN to 0.042234424701074812 FTOKEN
        //   //     // new reserve after swap will be 1.732967258967755614 BTOKEN 0.057765575298925188 FTOKEN
        //   //     // based on optimal swap formula, BTOKEN-FTOKEN to be added into the LP will be 1.267032741032244386 BTOKEN + 0.042234424701074812 FTOKEN
        //   //     // lp amount from adding liquidity will be (0.042234424701074812 / 0.057765575298925188) * 0.316227766016837933(first total supply) = 0.231205137369691323 LP
        //   //     // new reserve after adding liquidity 2.999999999999999954 BTOKEN + 0.100000000000000000 FTOKEN
        //   //     // ----------------
        //   //     // BTOKEN-FTOKEN reserve = 2.999999999999999954 BTOKEN + 0.100000000000000000 FTOKEN
        //   //     // BTOKEN-FTOKEN total supply = 0.547432903386529256 BTOKEN-FTOKEN LP
        //   //     // ----------------
        //   //     await swapHelper.loadReserves(await deltaNeutralWorker.getPath());
        //   //     await vaultAsAlice.work(
        //   //       0,
        //   //       deltaNeutralWorker.address,
        //   //       ethers.utils.parseEther("1"),
        //   //       borrowedAmount,
        //   //       "0",
        //   //       ethers.utils.defaultAbiCoder.encode(
        //   //         ["address", "bytes"],
        //   //         [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
        //   //       )
        //   //     );
        //   //     const [expectedLp] = await swapHelper.computeOneSidedOptimalLp(
        //   //       ethers.utils.parseEther("1").add(borrowedAmount),
        //   //       await deltaNeutralWorker.getPath()
        //   //     );
        //   //     const expectedHealth = await swapHelper.computeLpHealth(expectedLp, baseToken.address, farmToken.address);
        //   //     expect(await deltaNeutralWorker.health(1)).to.be.eq(expectedHealth);
        //   //     expect(await deltaNeutralWorker.shares(1)).to.eq(expectedLp);
        //   //     expect(await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1))).to.eq(expectedLp);
        //   //   });
        //   //   async function successBtokenOnly(lastWorkBlock: BigNumber, goRouge: boolean) {
        //   //     await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
        //   //     let accumLp = await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1));
        //   //     const [workerLpBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
        //   //     const debris = await baseToken.balanceOf(addStrat.address);
        //   //     const reinvestPath = await deltaNeutralWorker.getReinvestPath();
        //   //     const path = await deltaNeutralWorker.getPath();
        //   //     let reserves = await swapHelper.loadReserves(reinvestPath);
        //   //     reserves.push(...(await swapHelper.loadReserves(path)));
        //   //     await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
        //   //     await vaultAsAlice.addCollateral(
        //   //       1,
        //   //       ethers.utils.parseEther("1"),
        //   //       goRouge,
        //   //       ethers.utils.defaultAbiCoder.encode(
        //   //         ["address", "bytes"],
        //   //         [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
        //   //       )
        //   //     );
        //   //     const blockAfter = await TimeHelpers.latestBlockNumber();
        //   //     const blockDiff = blockAfter.sub(lastWorkBlock);
        //   //     const totalRewards = workerLpBefore
        //   //       .mul(CAKE_REWARD_PER_BLOCK.mul(blockDiff).mul(1e12).div(workerLpBefore))
        //   //       .div(1e12);
        //   //     const totalReinvestFees = totalRewards.mul(REINVEST_BOUNTY_BPS).div(10000);
        //   //     const reinvestLeft = totalRewards.sub(totalReinvestFees);
        //   //     const reinvestAmts = await swapHelper.computeSwapExactTokensForTokens(reinvestLeft, reinvestPath, true);
        //   //     const reinvestBtoken = reinvestAmts[reinvestAmts.length - 1].add(debris);
        //   //     const [reinvestLp] = await swapHelper.computeOneSidedOptimalLp(reinvestBtoken, path);
        //   //     accumLp = accumLp.add(reinvestLp);
        //   //     // Compute add collateral
        //   //     const addCollateralBtoken = ethers.utils.parseEther("1");
        //   //     const [addCollateralLp] = await swapHelper.computeOneSidedOptimalLp(addCollateralBtoken, path);
        //   //     accumLp = accumLp.add(addCollateralLp);
        //   //     const [health, debt] = await vault.positionInfo("1");
        //   //     expect(health).to.be.above(ethers.utils.parseEther("3"));
        //   //     const interest = ethers.utils.parseEther("0.3"); // 30% interest rate
        //   //     AssertHelpers.assertAlmostEqual(debt.toString(), interest.add(borrowedAmount).toString());
        //   //     AssertHelpers.assertAlmostEqual(
        //   //       (await baseToken.balanceOf(vault.address)).toString(),
        //   //       deposit.sub(borrowedAmount).toString()
        //   //     );
        //   //     AssertHelpers.assertAlmostEqual(
        //   //       (await vault.vaultDebtVal()).toString(),
        //   //       interest.add(borrowedAmount).toString()
        //   //     );
        //   //     const reservePool = interest.mul(RESERVE_POOL_BPS).div("10000");
        //   //     AssertHelpers.assertAlmostEqual(reservePool.toString(), (await vault.reservePool()).toString());
        //   //     AssertHelpers.assertAlmostEqual(
        //   //       deposit.add(interest).sub(reservePool).toString(),
        //   //       (await vault.totalToken()).toString()
        //   //     );
        //   //     expect(await deltaNeutralWorker.shares(1), `expect Alice's shares = ${accumLp}`).to.be.eq(accumLp);
        //   //     expect(
        //   //       await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1)),
        //   //       `expect Alice's staked LPs = ${accumLp}`
        //   //     ).to.be.eq(accumLp);
        //   //     expect(
        //   //       await cake.balanceOf(DEPLOYER),
        //   //       `expect Deployer gets ${ethers.utils.formatEther(totalReinvestFees)} CAKE`
        //   //     ).to.be.eq(totalReinvestFees);
        //   //   }
        //   //   async function successTwoSides(lastWorkBlock: BigNumber, goRouge: boolean) {
        //   //     await TimeHelpers.increase(TimeHelpers.duration.days(ethers.BigNumber.from("1")));
        //   //     // Random action to trigger interest computation
        //   //     await vault.deposit("0");
        //   //     // Set intertest rate to 0 for easy testing
        //   //     await simpleVaultConfig.setParams(
        //   //       MIN_DEBT_SIZE,
        //   //       0,
        //   //       RESERVE_POOL_BPS,
        //   //       KILL_PRIZE_BPS,
        //   //       wbnb.address,
        //   //       wNativeRelayer.address,
        //   //       fairLaunch.address,
        //   //       KILL_TREASURY_BPS,
        //   //       deployerAddress
        //   //     );
        //   //     let accumLp = await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1));
        //   //     const [workerLpBefore] = await masterChef.userInfo(POOL_ID, deltaNeutralWorker.address);
        //   //     const debris = await baseToken.balanceOf(addStrat.address);
        //   //     const reinvestPath = await deltaNeutralWorker.getReinvestPath();
        //   //     const path = await deltaNeutralWorker.getPath();
        //   //     let reserves = await swapHelper.loadReserves(reinvestPath);
        //   //     reserves.push(...(await swapHelper.loadReserves(path)));
        //   //     await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
        //   //     await farmTokenAsAlice.approve(vault.address, ethers.utils.parseEther("0.1"));
        //   //     await vaultAsAlice.addCollateral(
        //   //       1,
        //   //       ethers.utils.parseEther("1"),
        //   //       goRouge,
        //   //       ethers.utils.defaultAbiCoder.encode(
        //   //         ["address", "bytes"],
        //   //         [
        //   //           twoSidesStrat.address,
        //   //           ethers.utils.defaultAbiCoder.encode(["uint256", "uint256"], [ethers.utils.parseEther("0.1"), "0"]),
        //   //         ]
        //   //       )
        //   //     );
        //   //     const blockAfter = await TimeHelpers.latestBlockNumber();
        //   //     const blockDiff = blockAfter.sub(lastWorkBlock);
        //   //     const totalRewards = workerLpBefore
        //   //       .mul(CAKE_REWARD_PER_BLOCK.mul(blockDiff).mul(1e12).div(workerLpBefore))
        //   //       .div(1e12);
        //   //     const totalReinvestFees = totalRewards.mul(REINVEST_BOUNTY_BPS).div(10000);
        //   //     const reinvestLeft = totalRewards.sub(totalReinvestFees);
        //   //     const reinvestAmts = await swapHelper.computeSwapExactTokensForTokens(reinvestLeft, reinvestPath, true);
        //   //     const reinvestBtoken = reinvestAmts[reinvestAmts.length - 1].add(debris);
        //   //     const [reinvestLp] = await swapHelper.computeOneSidedOptimalLp(reinvestBtoken, path);
        //   //     accumLp = accumLp.add(reinvestLp);
        //   //     // Compute add collateral
        //   //     const addCollateralBtoken = ethers.utils.parseEther("1");
        //   //     const addCollateralFtoken = ethers.utils.parseEther("0.1");
        //   //     const [addCollateralLp, debrisBtoken, debrisFtoken] = await swapHelper.computeTwoSidesOptimalLp(
        //   //       addCollateralBtoken,
        //   //       addCollateralFtoken,
        //   //       path
        //   //     );
        //   //     accumLp = accumLp.add(addCollateralLp);
        //   //     const [health, debt] = await vault.positionInfo("1");
        //   //     expect(health).to.be.above(ethers.utils.parseEther("3"));
        //   //     const interest = ethers.utils.parseEther("0.3"); // 30% interest rate
        //   //     AssertHelpers.assertAlmostEqual(debt.toString(), interest.add(borrowedAmount).toString());
        //   //     AssertHelpers.assertAlmostEqual(
        //   //       (await baseToken.balanceOf(vault.address)).toString(),
        //   //       deposit.sub(borrowedAmount).toString()
        //   //     );
        //   //     AssertHelpers.assertAlmostEqual(
        //   //       (await vault.vaultDebtVal()).toString(),
        //   //       interest.add(borrowedAmount).toString()
        //   //     );
        //   //     const reservePool = interest.mul(RESERVE_POOL_BPS).div("10000");
        //   //     AssertHelpers.assertAlmostEqual(reservePool.toString(), (await vault.reservePool()).toString());
        //   //     AssertHelpers.assertAlmostEqual(
        //   //       deposit.add(interest).sub(reservePool).toString(),
        //   //       (await vault.totalToken()).toString()
        //   //     );
        //   //     expect(await deltaNeutralWorker.shares(1), `expect Alice's shares = ${accumLp}`).to.be.eq(accumLp);
        //   //     expect(
        //   //       await deltaNeutralWorker.shareToBalance(await deltaNeutralWorker.shares(1)),
        //   //       `expect Alice's staked LPs = ${accumLp}`
        //   //     ).to.be.eq(accumLp);
        //   //     expect(await cake.balanceOf(DEPLOYER), `expect Deployer gets ${totalReinvestFees} CAKE`).to.be.eq(
        //   //       totalReinvestFees
        //   //     );
        //   //     expect(
        //   //       await baseToken.balanceOf(twoSidesStrat.address),
        //   //       `expect TwoSides to have debris ${debrisBtoken} BTOKEN`
        //   //     ).to.be.eq(debrisBtoken);
        //   //     expect(
        //   //       await farmToken.balanceOf(twoSidesStrat.address),
        //   //       `expect TwoSides to have debris ${debrisFtoken} FTOKEN`
        //   //     ).to.be.eq(debrisFtoken);
        //   //   }
        //   //   async function revertNotEnoughCollateral(goRouge: boolean, stratAddress: string) {
        //   //     // Simulate price swing to make position under water
        //   //     await farmToken.approve(routerV2.address, ethers.utils.parseEther("888"));
        //   //     await routerV2.swapExactTokensForTokens(
        //   //       ethers.utils.parseEther("888"),
        //   //       "0",
        //   //       [farmToken.address, baseToken.address],
        //   //       deployerAddress,
        //   //       FOREVER
        //   //     );
        //   //     // Add super small collateral that it would still under the water after collateral is getting added
        //   //     await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("0.000000000000000001"));
        //   //     await expect(
        //   //       vaultAsAlice.addCollateral(
        //   //         1,
        //   //         ethers.utils.parseEther("0.000000000000000001"),
        //   //         goRouge,
        //   //         ethers.utils.defaultAbiCoder.encode(
        //   //           ["address", "bytes"],
        //   //           [stratAddress, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
        //   //         )
        //   //       )
        //   //     ).to.be.revertedWith("debtRatio > killFactor margin");
        //   //   }
        //   //   async function revertUnapprovedStrat(goRouge: boolean, stratAddress: string) {
        //   //     await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("88"));
        //   //     await expect(
        //   //       vaultAsAlice.addCollateral(
        //   //         1,
        //   //         ethers.utils.parseEther("1"),
        //   //         goRouge,
        //   //         ethers.utils.defaultAbiCoder.encode(
        //   //           ["address", "bytes"],
        //   //           [stratAddress, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
        //   //         )
        //   //       )
        //   //     ).to.be.revertedWith("!approved strat");
        //   //   }
        //   //   async function revertReserveNotConsistent(goRouge: boolean, stratAddress: string) {
        //   //     await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("88"));
        //   //     await expect(
        //   //       vaultAsAlice.addCollateral(
        //   //         1,
        //   //         ethers.utils.parseEther("1"),
        //   //         goRouge,
        //   //         ethers.utils.defaultAbiCoder.encode(
        //   //           ["address", "bytes"],
        //   //           [stratAddress, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
        //   //         )
        //   //       )
        //   //     ).to.be.revertedWith("reserve !consistent");
        //   //   }
        //   context("when go rouge is false", async () => {
        //     context("when worker is stable", async () => {
        //       //       it("should increase health when add BTOKEN only strat is choosen", async () => {
        //       //         await successBtokenOnly(await TimeHelpers.latestBlockNumber(), false);
        //       //       });
        //       //       it("should increase health when twosides strat is choosen", async () => {
        //       //         await successTwoSides(await TimeHelpers.latestBlockNumber(), false);
        //       //       });
        //       //       it("should revert when not enough collateral to pass kill factor", async () => {
        //       //         await revertNotEnoughCollateral(false, addStrat.address);
        //       //       });
        //       //       it("should revert when using liquidate strat", async () => {
        //       //         await revertUnapprovedStrat(false, liqStrat.address);
        //       //       });
        //       //       it("should revert when using minimize trading strat", async () => {
        //       //         await revertUnapprovedStrat(false, minimizeStrat.address);
        //       //       });
        //       //       it("should revert when using partial close liquidate start", async () => {
        //       //         await revertUnapprovedStrat(false, partialCloseStrat.address);
        //       //       });
        //       //       it("should revert when using partial close minimize start", async () => {
        //       //         await revertUnapprovedStrat(false, partialCloseMinimizeStrat.address);
        //       //       });
        //       //     });
        //       //     context("when worker is unstable", async () => {
        //       //       it("should revert", async () => {
        //       //         // Set worker to unstable
        //       //         simpleVaultConfig.setWorker(
        //       //           deltaNeutralWorker.address,
        //       //           true,
        //       //           true,
        //       //           WORK_FACTOR,
        //       //           KILL_FACTOR,
        //       //           false,
        //       //           true
        //       //         );
        //       //         await baseTokenAsAlice.approve(vault.address, ethers.utils.parseEther("1"));
        //       //         await expect(
        //       //           vaultAsAlice.addCollateral(
        //       //             1,
        //       //             ethers.utils.parseEther("1"),
        //       //             false,
        //       //             ethers.utils.defaultAbiCoder.encode(
        //       //               ["address", "bytes"],
        //       //               [addStrat.address, ethers.utils.defaultAbiCoder.encode(["uint256"], ["0"])]
        //       //             )
        //       //           )
        //       //         ).to.be.revertedWith("worker !stable");
        //       //       });
        //       //     });
        //     });

        //     context("when go rouge is true", async () => {
        //       //     context("when worker is unstable", async () => {
        //       //       beforeEach(async () => {
        //       //         // Set worker to unstable
        //       //         await simpleVaultConfig.setWorker(
        //       //           deltaNeutralWorker.address,
        //       //           true,
        //       //           true,
        //       //           WORK_FACTOR,
        //       //           KILL_FACTOR,
        //       //           false,
        //       //           true
        //       //         );
        //       //       });
        //       //       it("should increase health when add BTOKEN only strat is choosen", async () => {
        //       //         await successBtokenOnly((await TimeHelpers.latestBlockNumber()).sub(1), true);
        //       //       });
        //       //       it("should increase health when twosides strat is choosen", async () => {
        //       //         await successTwoSides((await TimeHelpers.latestBlockNumber()).sub(1), true);
        //       //       });
        //       //       it("should revert when not enough collateral to pass kill factor", async () => {
        //       //         await revertNotEnoughCollateral(true, addStrat.address);
        //       //       });
        //       //       it("should revert when using liquidate strat", async () => {
        //       //         await revertUnapprovedStrat(true, liqStrat.address);
        //       //       });
        //       //       it("should revert when using minimize trading strat", async () => {
        //       //         await revertUnapprovedStrat(true, minimizeStrat.address);
        //       //       });
        //       //       it("should revert when using partial close liquidate start", async () => {
        //       //         await revertUnapprovedStrat(true, partialCloseStrat.address);
        //       //       });
        //       //       it("should revert when using partial close minimize start", async () => {
        //       //         await revertUnapprovedStrat(true, partialCloseMinimizeStrat.address);
        //       //       });
        //     });

        //     context("when reserve is inconsistent", async () => {
        //       //       beforeEach(async () => {
        //       //         // Set worker to unstable
        //       //         await simpleVaultConfig.setWorker(
        //       //           deltaNeutralWorker.address,
        //       //           true,
        //       //           true,
        //       //           WORK_FACTOR,
        //       //           KILL_FACTOR,
        //       //           false,
        //       //           false
        //       //         );
        //       //       });
        //       //       it("should revert", async () => {
        //       //         await revertReserveNotConsistent(true, addStrat.address);
        //     });
        //   });
        // });
      });
    });
  });
});

// let lpBalance = await deltaNeutralWorker.totalLpBalance();
//             let lpToken = await deltaNeutralWorker.lpToken();
//             let lpInDollar = await priceHelper.lpToDollar(lpBalance, lpToken);
//             let lpPrice = lpInDollar.mul(BigNumber.from("1000000000000000000")).div(lpBalance);
//             let tokenPrice = await priceHelper.getTokenPrice(baseToken.address);
//             console.log("// lp balance = ", ethers.utils.formatEther(lpBalance));
//             console.log("// lp price = ", ethers.utils.formatEther(lpPrice));
//             console.log("// lp balance in dollar = ", ethers.utils.formatEther(lpInDollar));
//             console.log("// base token price = ", ethers.utils.formatEther(tokenPrice));
//             console.log("// lp balance in dollar / base token price");
//             console.log(
//               `// ${ethers.utils.formatEther(lpInDollar)} / ${ethers.utils.formatEther(tokenPrice)} = ${lpInDollar
//                 .mul(BigNumber.from("1000000000000000000"))
//                 .div(tokenPrice)}`
//             );
