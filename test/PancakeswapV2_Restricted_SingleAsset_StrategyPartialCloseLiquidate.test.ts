import { ethers, upgrades } from "hardhat";
import { Signer } from "ethers";
import chai from "chai";
import { solidity } from "ethereum-waffle";
import "@openzeppelin/test-helpers";
import {
  MockERC20,
  MockERC20__factory,
  PancakeFactory,
  PancakeFactory__factory,
  PancakeRouter,
  PancakeRouterV2__factory,
  PancakeRouter__factory,
  PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate,
  PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate__factory,
  WETH,
  WETH__factory
} from "../typechain";
import { MockPancakeswapV2CakeMaxiWorker__factory } from "../typechain/factories/MockPancakeswapV2CakeMaxiWorker__factory";
import { MockPancakeswapV2CakeMaxiWorker } from "../typechain/MockPancakeswapV2CakeMaxiWorker";

chai.use(solidity);
const { expect } = chai;

describe('PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate', () => {
  const FOREVER = '2000000000';

  /// Pancakeswap-related instance(s)
  let factoryV2: PancakeFactory;
  let routerV2: PancakeRouter;

  /// MockPancakeswapV2CakeMaxiWorker-related instance(s)
  let mockPancakeswapV2WorkerBaseFTokenPair: MockPancakeswapV2CakeMaxiWorker;
  let mockPancakeswapV2WorkerBNBFtokenPair: MockPancakeswapV2CakeMaxiWorker
  let mockPancakeswapV2EvilWorker: MockPancakeswapV2CakeMaxiWorker

  /// Token-related instance(s)
  let wbnb: WETH
  let baseToken: MockERC20;
  let farmingToken: MockERC20;

  /// Strategy instance(s)
  let strat: PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate;

  // Accounts
  let deployer: Signer;
  let alice: Signer;
  let bob: Signer;

  // Contract Signer
  let baseTokenAsAlice: MockERC20;
  let baseTokenAsBob: MockERC20;

  let farmingTokenAsAlice: MockERC20;
  let farmingTokenAsBob: MockERC20;

  let wbnbTokenAsAlice: WETH;

  let routerV2AsAlice: PancakeRouter;
  let routerV2AsBob: PancakeRouter;

  let stratAsAlice: PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate;
  let stratAsBob: PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate;

  let mockPancakeswapV2WorkerBaseFTokenPairAsAlice: MockPancakeswapV2CakeMaxiWorker;
  let mockPancakeswapV2WorkerBNBFtokenPairAsAlice: MockPancakeswapV2CakeMaxiWorker;
  let mockPancakeswapV2EvilWorkerAsAlice: MockPancakeswapV2CakeMaxiWorker

  beforeEach(async () => {
    [deployer, alice, bob] = await ethers.getSigners();
    // Setup Pancakeswap
    const PancakeFactory = (await ethers.getContractFactory(
      "PancakeFactory",
      deployer
    )) as PancakeFactory__factory;
    factoryV2 = await PancakeFactory.deploy((await deployer.getAddress()));
    await factoryV2.deployed();
    const WBNB = (await ethers.getContractFactory(
      "WETH",
      deployer
    )) as WETH__factory;

    wbnb = await WBNB.deploy();
    const PancakeRouterV2 = (await ethers.getContractFactory(
      "PancakeRouterV2",
      deployer
    )) as PancakeRouterV2__factory;
    routerV2 = await PancakeRouterV2.deploy(factoryV2.address, wbnb.address);
    await routerV2.deployed();

    /// Setup token stuffs
    const MockERC20 = (await ethers.getContractFactory(
      "MockERC20",
      deployer
    )) as MockERC20__factory
    baseToken = await upgrades.deployProxy(MockERC20, ['BTOKEN', 'BTOKEN']) as MockERC20;
    await baseToken.deployed();
    await baseToken.mint(await alice.getAddress(), ethers.utils.parseEther('100'));
    await baseToken.mint(await bob.getAddress(), ethers.utils.parseEther('100'));
    farmingToken = await upgrades.deployProxy(MockERC20, ['FTOKEN', 'FTOKEN']) as MockERC20;
    await farmingToken.deployed();
    await farmingToken.mint(await alice.getAddress(), ethers.utils.parseEther('10'));
    await farmingToken.mint(await bob.getAddress(), ethers.utils.parseEther('10'));
    await factoryV2.createPair(baseToken.address, wbnb.address);
    await factoryV2.createPair(farmingToken.address, wbnb.address);

    /// Setup MockPancakeswapV2CakeMaxiWorker
    const MockPancakeswapV2CakeMaxiWorker = (await ethers.getContractFactory(
      "MockPancakeswapV2CakeMaxiWorker",
      deployer,
    )) as MockPancakeswapV2CakeMaxiWorker__factory;
    mockPancakeswapV2WorkerBaseFTokenPair = await MockPancakeswapV2CakeMaxiWorker.deploy(
      baseToken.address,
      farmingToken.address,
      [baseToken.address, wbnb.address, farmingToken.address],
      [farmingToken.address, wbnb.address]
    ) as MockPancakeswapV2CakeMaxiWorker
    await mockPancakeswapV2WorkerBaseFTokenPair.deployed();
    
    mockPancakeswapV2WorkerBNBFtokenPair = await MockPancakeswapV2CakeMaxiWorker.deploy(
      wbnb.address,
      farmingToken.address,
      [wbnb.address, farmingToken.address],
      [farmingToken.address, wbnb.address]
    ) as MockPancakeswapV2CakeMaxiWorker
    await mockPancakeswapV2WorkerBNBFtokenPair.deployed();
    
    mockPancakeswapV2EvilWorker = await MockPancakeswapV2CakeMaxiWorker.deploy(
      baseToken.address,
      farmingToken.address,
      [baseToken.address, wbnb.address, farmingToken.address],
      [farmingToken.address, wbnb.address
    ]) as MockPancakeswapV2CakeMaxiWorker
    await mockPancakeswapV2EvilWorker.deployed();
    const PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate = (await ethers.getContractFactory(
      "PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate",
      deployer
    )) as PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate__factory;
    strat = await upgrades.deployProxy(PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate, [routerV2.address]) as PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate;
    await strat.deployed();
    await strat.setWorkersOk([mockPancakeswapV2WorkerBaseFTokenPair.address, mockPancakeswapV2WorkerBNBFtokenPair.address], true)
    
    // Assign contract signer
    baseTokenAsAlice = MockERC20__factory.connect(baseToken.address, alice);
    baseTokenAsBob = MockERC20__factory.connect(baseToken.address, bob);

    farmingTokenAsAlice = MockERC20__factory.connect(farmingToken.address, alice);
    farmingTokenAsBob = MockERC20__factory.connect(farmingToken.address, bob);

    wbnbTokenAsAlice = WETH__factory.connect(wbnb.address, alice)

    routerV2AsAlice = PancakeRouter__factory.connect(routerV2.address, alice);
    routerV2AsBob = PancakeRouter__factory.connect(routerV2.address, bob);

    stratAsAlice = PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate__factory.connect(strat.address, alice);
    stratAsBob = PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate__factory.connect(strat.address, bob);

    mockPancakeswapV2WorkerBaseFTokenPairAsAlice = MockPancakeswapV2CakeMaxiWorker__factory.connect(mockPancakeswapV2WorkerBaseFTokenPair.address, alice);
    mockPancakeswapV2WorkerBNBFtokenPairAsAlice = MockPancakeswapV2CakeMaxiWorker__factory.connect(mockPancakeswapV2WorkerBNBFtokenPair.address, alice);
    mockPancakeswapV2EvilWorkerAsAlice = MockPancakeswapV2CakeMaxiWorker__factory.connect(mockPancakeswapV2EvilWorker.address, alice);
    
    // Adding liquidity to the pool
    // Alice adds 0.1 FTOKEN + 1 WBTC + 1 WBNB
    await wbnbTokenAsAlice.deposit({
        value: ethers.utils.parseEther('52')
    })
    await farmingTokenAsAlice.approve(routerV2.address, ethers.utils.parseEther('0.1'));
    await baseTokenAsAlice.approve(routerV2.address, ethers.utils.parseEther('1'));
    await wbnbTokenAsAlice.approve(routerV2.address, ethers.utils.parseEther('2'))
    // Add liquidity to the WBTC-WBNB pool on Pancakeswap
    await routerV2AsAlice.addLiquidity(
      baseToken.address, wbnb.address,
      ethers.utils.parseEther('1'), ethers.utils.parseEther('1'), '0', '0', await alice.getAddress(), FOREVER);
    // Add liquidity to the WBNB-FTOKEN pool on Pancakeswap
    await routerV2AsAlice.addLiquidity(
    farmingToken.address, wbnb.address,
    ethers.utils.parseEther('0.1'), ethers.utils.parseEther('1'), '0', '0', await alice.getAddress(), FOREVER);
});

  context('When bad calldata', async() => {
    it('should revert', async () => {
      // Bob passes some bad calldata that can't be decoded
      await expect(
        stratAsBob.execute(await bob.getAddress(), '0', '0x1234')
      ).to.be.reverted;
    });
  })

  context('When the setOkWorkers caller is not an owner', async() => {
    it('should be reverted', async () => {
      await expect(stratAsBob.setWorkersOk([mockPancakeswapV2EvilWorkerAsAlice.address], true)).to.reverted
    })
  })

  context('When non-worker call the strat', async () => {
    it('should revert', async() => {
      await expect(stratAsBob.execute(
        await bob.getAddress(), '0',
        ethers.utils.defaultAbiCoder.encode(
          ['uint256'], ['0']
        )
      )).to.be.reverted;
    })
  })

  context('When the base token is a wrap native', async () => {
    context('When contract get baseToken amount < minBaseTokenAmount', async () => {
        it('should revert', async () => {
          // Alice uses Partial Close Liquidate strategy yet again, but now with an unreasonable minFarmingTokenAmount request
          // amountOut of 0.1 will be
          // if 0.1 FToken = 1 WBNB
          // 0.1 FToken will be (0.04 * 0.9975) * (1 / (0.1 + 0.04 * 0.9975)) = 0.285203716940671908 WBNB
          await farmingTokenAsAlice.transfer(mockPancakeswapV2WorkerBNBFtokenPair.address, ethers.utils.parseEther('0.1'));
          await expect(mockPancakeswapV2WorkerBNBFtokenPairAsAlice.work(
            0, await alice.getAddress(), '0',
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [strat.address, ethers.utils.defaultAbiCoder.encode(
                ['uint256','uint256'],
                [ ethers.utils.parseEther('0.285203716940671908').add(1), ethers.utils.parseEther('0.04')]
              )],
            )
          )).to.be.revertedWith('PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate::execute:: insufficient baseToken amount received');
        });
      })
    
    context("When caller worker hasn't been whitelisted", async () => {
      it('should revert as bad worker', async () => {
        await wbnbTokenAsAlice.transfer(mockPancakeswapV2EvilWorkerAsAlice.address, ethers.utils.parseEther('0.05'));
        await expect(mockPancakeswapV2EvilWorkerAsAlice.work(
          0, await alice.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [strat.address, ethers.utils.defaultAbiCoder.encode(
              ['uint256','uint256'],
              [ethers.utils.parseEther('0.285203716940671908').add(1),ethers.utils.parseEther('0.04')]
            )],
          )
        )).to.be.revertedWith('PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate::onlyWhitelistedWorkers:: bad worker');
      });
    })
  
    context("when revoking whitelist workers", async () => {
      it('should revert as bad worker', async () => {
        await strat.setWorkersOk([mockPancakeswapV2WorkerBNBFtokenPair.address], false)
        await expect(mockPancakeswapV2WorkerBNBFtokenPairAsAlice.work(
          0, await alice.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [strat.address, ethers.utils.defaultAbiCoder.encode(
              ['uint256','uint256'],
              [ethers.utils.parseEther('0.285203716940671908').add(1),ethers.utils.parseEther('0.04')]
            )],
          )
        )).to.be.revertedWith('PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate::onlyWhitelistedWorkers:: bad worker');
      });
    })
  
    it('should convert SOME farmingToken to baseToken (WBNB)', async () => {
      await farmingTokenAsAlice.transfer(mockPancakeswapV2WorkerBNBFtokenPair.address, ethers.utils.parseEther('0.1'));
      const farmingTokenToLiquidate = ethers.utils.parseEther('0.04')
      // amountOut of 0.04 will be
      // if 0.1 FToken = 1 WBNB
      // 0.04 FToken will be (0.04 * 0.9975) * (1 / (0.1 + 0.04 * 0.9975)) = 0.285203716940671908 WBNB
      const aliceBalanceBefore = await wbnb.balanceOf(await alice.getAddress())
      await mockPancakeswapV2WorkerBNBFtokenPairAsAlice.work(
        0, await alice.getAddress(), '0',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'bytes'],
          [strat.address, ethers.utils.defaultAbiCoder.encode(
            ['uint256','uint256'],
            ['0', farmingTokenToLiquidate]
          )],
        )
      );
      const aliceBalanceAfter = await wbnb.balanceOf(await alice.getAddress())
           
      // the worker will send 0.285203716940671908 wbnb back to alice
      expect(aliceBalanceAfter.sub(aliceBalanceBefore)).to.be.bignumber.eq(ethers.utils.parseEther('0.285203716940671908'))
      // there should be no baseToken or farmingToken left in strategy
      expect(await farmingToken.balanceOf(strat.address)).to.be.bignumber.eq(ethers.utils.parseEther('0'))
      expect(await wbnb.balanceOf(strat.address)).to.be.bignumber.eq(ethers.utils.parseEther('0'))
      // the strategy should send 0.06 farmingToken back to worker
      expect(await farmingToken.balanceOf(mockPancakeswapV2WorkerBNBFtokenPair.address)).to.be.bignumber.eq(ethers.utils.parseEther('0.06'))
    });
  })

  context('When the base token is not a wrap native', async () => {
    context('When contract get baseToken amount < minBaseTokenAmount', async () => {
        it('should revert', async () => {
          // amountOut of 0.4 will be
          // if 0.1 FToken = 1 WBNB
          // 0.1 FToken will be (0.04 * 0.9975) * (1 / (0.1 + 0.04 * 0.9975)) = 0.2852037169406719 WBNB
          // if 1 WBNB = 1 BaseToken
          // 0.2852037169406719 WBNB = (0.2852037169406719* 0.9975) * (1 / (1 + 0.2852037169406719 * 0.9975)) = 0.221481327933600537 BaseToken
          await farmingTokenAsAlice.transfer(mockPancakeswapV2WorkerBaseFTokenPair.address, ethers.utils.parseEther('0.1'));
          await expect(mockPancakeswapV2WorkerBaseFTokenPairAsAlice.work(
            0, await alice.getAddress(), '0',
            ethers.utils.defaultAbiCoder.encode(
              ['address', 'bytes'],
              [strat.address, ethers.utils.defaultAbiCoder.encode(
                ['uint256','uint256'],
                [ ethers.utils.parseEther('0.221481327933600537').add(1), ethers.utils.parseEther('0.04')]
              )],
            )
          )).to.be.revertedWith('PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate::execute:: insufficient baseToken amount received');
        });
    })
    
    context("When caller worker hasn't been whitelisted", async () => {
      it('should revert as bad worker', async () => {
        await wbnbTokenAsAlice.transfer(mockPancakeswapV2EvilWorkerAsAlice.address, ethers.utils.parseEther('0.05'));
        await expect(mockPancakeswapV2EvilWorkerAsAlice.work(
          0, await alice.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [strat.address, ethers.utils.defaultAbiCoder.encode(
              ['uint256','uint256'],
              [ ethers.utils.parseEther('0.221481327933600537').add(1), ethers.utils.parseEther('0.04')]
            )],
          )
        )).to.be.revertedWith('PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate::onlyWhitelistedWorkers:: bad worker');
      });
    })
  
    context("when revoking whitelist workers", async () => {
      it('should revert as bad worker', async () => {
        await strat.setWorkersOk([mockPancakeswapV2WorkerBaseFTokenPair.address], false)
        await expect(mockPancakeswapV2WorkerBaseFTokenPairAsAlice.work(
          0, await alice.getAddress(), '0',
          ethers.utils.defaultAbiCoder.encode(
            ['address', 'bytes'],
            [strat.address, ethers.utils.defaultAbiCoder.encode(
              ['uint256','uint256'],
              [ ethers.utils.parseEther('0.221481327933600537').add(1), ethers.utils.parseEther('0.04')]
            )],
          )
        )).to.be.revertedWith('PancakeswapV2RestrictedSingleAssetStrategyPartialCloseLiquidate::onlyWhitelistedWorkers:: bad worker');
      });
    })
  
    it('should convert SOME farmingToken to baseToken (WBTC)', async () => {
      await farmingTokenAsAlice.transfer(mockPancakeswapV2WorkerBaseFTokenPair.address, ethers.utils.parseEther('0.1'));
      // amountOut of 0.4 will be
      // if 0.1 FToken = 1 WBNB
      // 0.1 FToken will be (0.04 * 0.9975) * (1 / (0.1 + 0.04 * 0.9975)) = 0.2852037169406719 WBNB
      // if 1 WBNB = 1 BaseToken
      // 0.2852037169406719 WBNB = (0.2852037169406719* 0.9975) * (1 / (1 + 0.2852037169406719 * 0.9975)) = 0.221481327933600537 BaseToken
      const aliceBalanceBefore = await baseToken.balanceOf(await alice.getAddress())
      const farmingTokenToLiquidate = ethers.utils.parseEther('0.04')
      await mockPancakeswapV2WorkerBaseFTokenPairAsAlice.work(
        0, await alice.getAddress(), '0',
        ethers.utils.defaultAbiCoder.encode(
          ['address', 'bytes'],
          [strat.address, ethers.utils.defaultAbiCoder.encode(
            ['uint256','uint256'],
            ['0', farmingTokenToLiquidate]
          )],
        )
      );
      const aliceBalanceAfter = await baseToken.balanceOf(await alice.getAddress())

      // the worker will send 0.221481327933600537 baseToken back to alice
      expect(aliceBalanceAfter.sub(aliceBalanceBefore)).to.be.bignumber.eq(ethers.utils.parseEther('0.221481327933600537'))
      // there should be no baseToken or farmingToken left in strategy
      expect(await farmingToken.balanceOf(strat.address)).to.be.bignumber.eq(ethers.utils.parseEther('0'))
      expect(await baseToken.balanceOf(strat.address)).to.be.bignumber.eq(ethers.utils.parseEther('0'))
      // the strategy should send 0.06 farmingToken back to worker
      expect(await farmingToken.balanceOf(mockPancakeswapV2WorkerBaseFTokenPair.address)).to.be.bignumber.eq(ethers.utils.parseEther('0.06'))
    })
  })
})