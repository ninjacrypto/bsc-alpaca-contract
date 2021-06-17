import chai from 'chai'
import '@openzeppelin/test-helpers'
import { solidity } from 'ethereum-waffle'
import { BigNumber, Signer } from 'ethers'
import { ethers, upgrades } from 'hardhat'
import {
  MockERC20,
  MockERC20__factory,
  OracleMedianizer,
  OracleMedianizer__factory,
  SimplePriceOracle,
  SimplePriceOracle__factory,
} from '../typechain'

chai.use(solidity)
const { expect } = chai

// Accounts
let deployer: Signer
let feeder: Signer
let alice: Signer

let token0: MockERC20
let token1: MockERC20
let token2: MockERC20
let token3: MockERC20

let simplePriceOracle: SimplePriceOracle
let simplePriceOracleAsFeeder: SimplePriceOracle

let bobPriceOracle: SimplePriceOracle
let bobPriceOracleAsFeeder: SimplePriceOracle

let evePriceOracle: SimplePriceOracle
let evePriceOracleAsFeeder: SimplePriceOracle

let oracleMedianizer: OracleMedianizer
let oracleMedianizerAsDeployer: OracleMedianizer
let oracleMedianizerAsAlice: OracleMedianizer

describe('OracleMedianizer', () => {
  beforeEach(async () => {
    ;[deployer, feeder, alice] = await ethers.getSigners()

    const ERC20 = (await ethers.getContractFactory('MockERC20', deployer)) as MockERC20__factory
    token0 = (await upgrades.deployProxy(ERC20, ['token0', 'token0'])) as MockERC20
    await token0.deployed()
    token1 = (await upgrades.deployProxy(ERC20, ['token1', 'token1'])) as MockERC20
    await token1.deployed()
    token2 = (await upgrades.deployProxy(ERC20, ['token2', 'token2'])) as MockERC20
    await token0.deployed()
    token3 = (await upgrades.deployProxy(ERC20, ['token3', 'token3'])) as MockERC20
    await token1.deployed()

    const SimplePriceOracle = (await ethers.getContractFactory(
      'SimplePriceOracle',
      deployer,
    )) as SimplePriceOracle__factory
    simplePriceOracle = (await upgrades.deployProxy(SimplePriceOracle, [
      await feeder.getAddress(),
    ])) as SimplePriceOracle
    await simplePriceOracle.deployed()
    simplePriceOracleAsFeeder = SimplePriceOracle__factory.connect(simplePriceOracle.address, feeder)

    const BobPriceOracle = (await ethers.getContractFactory(
      'SimplePriceOracle',
      deployer,
    )) as SimplePriceOracle__factory
    bobPriceOracle = (await upgrades.deployProxy(BobPriceOracle, [await feeder.getAddress()])) as SimplePriceOracle
    await bobPriceOracle.deployed()
    bobPriceOracleAsFeeder = SimplePriceOracle__factory.connect(bobPriceOracle.address, feeder)

    const EvePriceOracle = (await ethers.getContractFactory(
      'SimplePriceOracle',
      deployer,
    )) as SimplePriceOracle__factory
    evePriceOracle = (await upgrades.deployProxy(EvePriceOracle, [await feeder.getAddress()])) as SimplePriceOracle
    await evePriceOracle.deployed()
    evePriceOracleAsFeeder = SimplePriceOracle__factory.connect(evePriceOracle.address, feeder)

    const OracleMedianizer = (await ethers.getContractFactory('OracleMedianizer', deployer)) as OracleMedianizer__factory
    oracleMedianizer = (await upgrades.deployProxy(OracleMedianizer)) as OracleMedianizer
    await oracleMedianizer.deployed()
    oracleMedianizerAsDeployer = OracleMedianizer__factory.connect(oracleMedianizer.address, deployer)
    oracleMedianizerAsAlice = OracleMedianizer__factory.connect(oracleMedianizer.address, alice)
  })

  describe('#setPrimarySources', async () => {
    context('when the caller is not the owner', async () => {
      it('should be reverted', async () => {
        await expect(
            oracleMedianizerAsAlice.setPrimarySources(token0.address, token1.address, BigNumber.from('1000000000000000000'), [
            simplePriceOracle.address,
          ]),
        ).to.revertedWith('Ownable: caller is not the owner')
      })
    })
    context('when the caller is the owner', async () => {
      context('when bad max deviation value', async () => {
        it('should be reverted', async () => {
          await expect(
            oracleMedianizerAsDeployer.setPrimarySources(token0.address, token1.address, BigNumber.from('0'), [
              simplePriceOracle.address,
            ]),
          ).to.revertedWith('OracleMedianizer::setPrimarySources:: bad max deviation value')
        })
        it('should be reverted', async () => {
          await expect(
            oracleMedianizerAsDeployer.setPrimarySources(
              token0.address,
              token1.address,
              BigNumber.from('2000000000000000000'),
              [simplePriceOracle.address],
            ),
          ).to.revertedWith('OracleMedianizer::setPrimarySources:: bad max deviation value')
        })
      })
      context('when sources length exceed 3', async () => {
        it('should be reverted', async () => {
          await expect(
            oracleMedianizerAsDeployer.setPrimarySources(
              token0.address,
              token1.address,
              BigNumber.from('1000000000000000000'),
              [
                simplePriceOracle.address,
                simplePriceOracle.address,
                simplePriceOracle.address,
                simplePriceOracle.address,
              ],
            ),
          ).to.revertedWith('OracleMedianizer::setPrimarySources:: sources length exceed 3')
        })
      })
      context('when successfully', async () => {
        it('should successfully', async () => {
          await expect(oracleMedianizerAsDeployer.setPrimarySources(
            token0.address,
            token1.address,
            BigNumber.from('1000000000000000000'),
            [simplePriceOracle.address],
          )).to.emit(oracleMedianizerAsDeployer, 'SetPrimarySources')
          
          // T0T1 pair
          const sourceT0T1 = await oracleMedianizerAsDeployer.primarySources(token0.address, token1.address, 0)
          const sourceCountT0T1 = await oracleMedianizerAsDeployer.primarySourceCount(token0.address, token1.address)
          const maxPriceDeviationT0T1 = await oracleMedianizerAsDeployer.maxPriceDeviations(token0.address, token1.address)

          expect(sourceT0T1).to.eq(simplePriceOracle.address)
          expect(sourceCountT0T1).to.eq(BigNumber.from(1))
          expect(maxPriceDeviationT0T1).to.eq(BigNumber.from('1000000000000000000'))

          // T1T0 pair
          const sourceT1T0 = await oracleMedianizerAsDeployer.primarySources(token1.address, token0.address, 0)
          const sourceCountT1T0 = await oracleMedianizerAsDeployer.primarySourceCount(token1.address, token0.address)
          const maxPriceDeviationT1T0 = await oracleMedianizerAsDeployer.maxPriceDeviations(token1.address, token0.address)
          
          expect(sourceT1T0).to.eq(simplePriceOracle.address)
          expect(sourceCountT1T0).to.eq(BigNumber.from(1))
          expect(maxPriceDeviationT1T0).to.eq(BigNumber.from('1000000000000000000'))
        })
      })
    })
  })

  describe('#setMultiPrimarySources', async () => {
    context('when inconsistent length', async () => {
      it('should be reverted', async () => {
        await expect(
            oracleMedianizerAsDeployer.setMultiPrimarySources(
            [token0.address, token2.address],
            [token1.address],
            [BigNumber.from('1000000000000000000')],
            [[simplePriceOracle.address]],
          ),
        ).to.revertedWith('OracleMedianizer::setMultiPrimarySources:: inconsistent length')
      })
      it('should be reverted', async () => {
        await expect(
            oracleMedianizerAsDeployer.setMultiPrimarySources(
            [token0.address, token2.address],
            [token1.address, token3.address],
            [BigNumber.from('1000000000000000000')],
            [[simplePriceOracle.address]],
          ),
        ).to.revertedWith('OracleMedianizer::setMultiPrimarySources:: inconsistent length')
      })
      it('should be reverted', async () => {
        await expect(
            oracleMedianizerAsDeployer.setMultiPrimarySources(
            [token0.address, token2.address],
            [token1.address, token3.address],
            [BigNumber.from('1000000000000000000'), BigNumber.from('900000000000000000')],
            [[simplePriceOracle.address]],
          ),
        ).to.revertedWith('OracleMedianizer::setMultiPrimarySources:: inconsistent length')
      })
    })
    context('when successfully', async () => {
      it('should successfully', async () => {
        await expect(oracleMedianizerAsDeployer.setMultiPrimarySources(
          [token0.address, token2.address],
          [token1.address, token3.address],
          [BigNumber.from('1000000000000000000'), BigNumber.from('1100000000000000000')],
          [[simplePriceOracle.address], [simplePriceOracle.address, bobPriceOracle.address]],
        )).to.emit(oracleMedianizerAsDeployer, 'SetPrimarySources')
        // T0T1 pair
        const sourceT0T1 = await oracleMedianizerAsDeployer.primarySources(token0.address, token1.address, 0)
        const sourceCountT0T1 = await oracleMedianizerAsDeployer.primarySourceCount(token0.address, token1.address)
        const maxPriceDeviationT0T1 = await oracleMedianizerAsDeployer.maxPriceDeviations(token0.address, token1.address)

        expect(sourceT0T1).to.eq(simplePriceOracle.address)
        expect(sourceCountT0T1).to.eq(BigNumber.from(1))
        expect(maxPriceDeviationT0T1).to.eq(BigNumber.from('1000000000000000000'))

        // T1T0 pair
        const sourceT1T0 = await oracleMedianizerAsDeployer.primarySources(token1.address, token0.address, 0)
        const sourceCountT1T0 = await oracleMedianizerAsDeployer.primarySourceCount(token1.address, token0.address)
        const maxPriceDeviationT1T0 = await oracleMedianizerAsDeployer.maxPriceDeviations(token1.address, token0.address)

        expect(sourceT1T0).to.eq(simplePriceOracle.address)
        expect(sourceCountT1T0).to.eq(BigNumber.from(1))
        expect(maxPriceDeviationT1T0).to.eq(BigNumber.from('1000000000000000000'))

        // T2T3 pair
        // source 0
        const sourceT2T3 = await oracleMedianizerAsDeployer.primarySources(token2.address, token3.address, 0)
        // source 1
        const source1T2T3 = await oracleMedianizerAsDeployer.primarySources(token2.address, token3.address, 1)

        const sourceCountT2T3 = await oracleMedianizerAsDeployer.primarySourceCount(token2.address, token3.address)
        const maxPriceDeviationT2T3 = await oracleMedianizerAsDeployer.maxPriceDeviations(token2.address, token3.address)
        
        expect(sourceT2T3).to.eq(simplePriceOracle.address)
        expect(source1T2T3).to.eq(bobPriceOracle.address)
        expect(sourceCountT2T3).to.eq(BigNumber.from(2))
        expect(maxPriceDeviationT2T3).to.eq(BigNumber.from('1100000000000000000'))

        // T3T2 pair
        // source 0
        const sourceT3T2 = await oracleMedianizerAsDeployer.primarySources(token3.address, token2.address, 0)
        // source 1
        const source1T3T2 = await oracleMedianizerAsDeployer.primarySources(token3.address, token2.address, 1)

        const sourceCountT3T2 = await oracleMedianizerAsDeployer.primarySourceCount(token3.address, token2.address)
        const maxPriceDeviationT3T2 = await oracleMedianizerAsDeployer.maxPriceDeviations(token3.address, token2.address)
        
        expect(sourceT3T2).to.eq(simplePriceOracle.address)
        expect(source1T3T2).to.eq(bobPriceOracle.address)
        expect(sourceCountT3T2).to.eq(BigNumber.from(2))
        expect(maxPriceDeviationT3T2).to.eq(BigNumber.from('1100000000000000000'))
      })
    })
  })

  describe('#getPrice', async () => {
    context('when no primary source', async () => {
      it('should be reverted', async () => {
        await expect(oracleMedianizerAsAlice.getPrice(token0.address, token1.address)).to.revertedWith('OracleMedianizer::getPrice:: no primary source')
      })
    })
    context('when no valid source', async () => {
      it('should be reverted', async () => {
        await oracleMedianizerAsDeployer.setPrimarySources(
          token0.address,
          token1.address,
          BigNumber.from('1000000000000000000'),
          [simplePriceOracle.address],
        )

        await expect(oracleMedianizerAsAlice.getPrice(token0.address, token1.address)).to.revertedWith('OracleMedianizer::getPrice:: no valid source')
      })
    })
    context('when has 1 valid sources', async () => {
      it('should successfully', async () => {
        await simplePriceOracleAsFeeder.setPrices(
          [token0.address, token1.address],
          [token1.address, token0.address],
          [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000').div(10)],
        )
        await oracleMedianizerAsDeployer.setPrimarySources(
          token0.address,
          token1.address,
          BigNumber.from('1000000000000000000'),
          [simplePriceOracle.address],
        )

        const [price, lastTime] = await oracleMedianizerAsAlice.getPrice(token0.address, token1.address)
        // result should be Med(price0) => price0 = 1000000000000000000
        expect(price).to.eq(BigNumber.from('1000000000000000000'))
      })
    })
    context('when has 2 valid sources', async () => {
      context('when too much deviation (2 valid sources)', async () => {
        it('should be reverted', async () => {
          await simplePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000').div(10)],
          )
          await bobPriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('900000000000000000'), BigNumber.from('1000000000000000000').div(9)],
          )

          await oracleMedianizerAsDeployer.setPrimarySources(
            token0.address,
            token1.address,
            BigNumber.from('1100000000000000000'),
            [simplePriceOracle.address, bobPriceOracle.address],
          )

          await expect(oracleMedianizerAsAlice.getPrice(token0.address, token1.address)).to.revertedWith("OracleMedianizer::getPrice:: too much deviation 2 valid sources")
        })
      })
      context('when successfully', async () => {
        it('should successfully', async () => {
          await simplePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000').div(10)],
          )
          await bobPriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('900000000000000000'), BigNumber.from('1000000000000000000').div(9)],
          )

          await oracleMedianizerAsDeployer.setPrimarySources(
            token0.address,
            token1.address,
            BigNumber.from('1200000000000000000'),
            [simplePriceOracle.address, bobPriceOracle.address],
          )
          const [price, lastTime] = await oracleMedianizerAsAlice.getPrice(token0.address, token1.address)
          // result should be Med(price0, price1) => (price0 + price1) / 2 = (1000000000000000000 + 900000000000000000) / 2 = 950000000000000000
          expect(price).to.eq(BigNumber.from('950000000000000000'))
        })
      })
    })
    context('when has 3 valid sources', async () => {
      context('when too much deviation', async () => {
        it('should be reverted', async () => {
          await simplePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000').div(10)],
          )
          await bobPriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('900000000000000000'), BigNumber.from('1000000000000000000').div(9)],
          )
          await evePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('800000000000000000'), BigNumber.from('1000000000000000000').div(8)],
          )

          await oracleMedianizerAsDeployer.setPrimarySources(
            token0.address,
            token1.address,
            BigNumber.from('1100000000000000000'),
            [simplePriceOracle.address, bobPriceOracle.address, evePriceOracleAsFeeder.address],
          )
          await expect(oracleMedianizerAsAlice.getPrice(token0.address, token1.address)).to.revertedWith("OracleMedianizer::getPrice:: too much deviation 3 valid sources")
        })
      })
      context(`when price0 and price1 are within max deviation, but price2 doesn't`, async () => {
        it('should be successfully', async () => {
          await simplePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('1100000000000000000'), BigNumber.from('1000000000000000000').div(11)],
          )
          await bobPriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('900000000000000000'), BigNumber.from('1000000000000000000').div(9)],
          )
          await evePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('800000000000000000'), BigNumber.from('1000000000000000000').div(8)],
          )

          await oracleMedianizerAsDeployer.setPrimarySources(
            token0.address,
            token1.address,
            BigNumber.from('1200000000000000000'),
            [simplePriceOracle.address, bobPriceOracle.address, evePriceOracleAsFeeder.address],
          )
          const [price, lastTime] = await oracleMedianizerAsAlice.getPrice(token0.address, token1.address)
          // result should be Med(price1, price2) => (price1 + price2) / 2 = (900000000000000000 + 800000000000000000) / 2 = 850000000000000000
          expect(price).to.eq(BigNumber.from('850000000000000000'))
        })
      })
      context(`when price1 and price2 are within max deviation, but price0 doesn't`, async () => {
        it('should be successfully', async () => {
          await simplePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000').div(10)],
          )
          await bobPriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('900000000000000000'), BigNumber.from('1000000000000000000').div(9)],
          )
          await evePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('700000000000000000'), BigNumber.from('1000000000000000000').div(7)],
          )

          await oracleMedianizerAsDeployer.setPrimarySources(
            token0.address,
            token1.address,
            BigNumber.from('1200000000000000000'),
            [simplePriceOracle.address, bobPriceOracle.address, evePriceOracleAsFeeder.address],
          )
          const [price, lastTime] = await oracleMedianizerAsAlice.getPrice(token0.address, token1.address)
          // result should be Med(price0, price1) => (price0 + price1) / 2 = (1000000000000000000 + 900000000000000000) / 2 = 950000000000000000
          expect(price).to.eq(BigNumber.from('950000000000000000'))
        })
      })
      context('when price0, price1 and price2 are ok', async () => {
        it('should be successfully', async () => {
          await simplePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('1000000000000000000'), BigNumber.from('1000000000000000000').div(10)],
          )
          await bobPriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('900000000000000000'), BigNumber.from('1000000000000000000').div(9)],
          )
          await evePriceOracleAsFeeder.setPrices(
            [token0.address, token1.address],
            [token1.address, token0.address],
            [BigNumber.from('800000000000000000'), BigNumber.from('1000000000000000000').div(8)],
          )

          await oracleMedianizerAsDeployer.setPrimarySources(
            token0.address,
            token1.address,
            BigNumber.from('1200000000000000000'),
            [simplePriceOracle.address, bobPriceOracle.address, evePriceOracleAsFeeder.address],
          )
          const [price, lastTime] = await oracleMedianizerAsAlice.getPrice(token0.address, token1.address)
          // result should be Med(price0, price1, price2) => price1 = 900000000000000000
          expect(price).to.eq(BigNumber.from('900000000000000000'))
        })
      })
    })
  })
})
