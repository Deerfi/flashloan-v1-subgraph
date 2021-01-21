import { PoolHourData } from './../types/schema'
/* eslint-disable prefer-const */
import { BigInt, BigDecimal, EthereumEvent } from '@graphprotocol/graph-ts'
import { Pool, Bundle, Token, FlashLoanFactory, FlashLoanDayData, PoolDayData, TokenDayData } from '../types/schema'
import { ONE_BI, ZERO_BD, ZERO_BI, FLASH_LOAN_FACTORY_ADDRESS } from './helpers'

export function updateFlashLoanDayData(event: EthereumEvent): FlashLoanDayData {
  let factory = FlashLoanFactory.load(FLASH_LOAN_FACTORY_ADDRESS)
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let flashLoanDayData = FlashLoanDayData.load(dayID.toString())
  if (flashLoanDayData === null) {
    flashLoanDayData = new FlashLoanDayData(dayID.toString())
    flashLoanDayData.date = dayStartTimestamp
    flashLoanDayData.dailyVolumeUSD = ZERO_BD
    flashLoanDayData.dailyVolumeETH = ZERO_BD
    flashLoanDayData.totalVolumeUSD = ZERO_BD
    flashLoanDayData.totalVolumeETH = ZERO_BD
    flashLoanDayData.dailyVolumeUntracked = ZERO_BD
  }

  flashLoanDayData.totalLiquidityUSD = factory.totalLiquidityUSD
  flashLoanDayData.totalLiquidityETH = factory.totalLiquidityETH
  flashLoanDayData.txCount = factory.txCount
  flashLoanDayData.save()

  return flashLoanDayData as FlashLoanDayData
}

export function updatePoolDayData(event: EthereumEvent): PoolDayData {
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let dayPoolID = event.address
    .toHexString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())
  let pool = Pool.load(event.address.toHexString())
  let poolDayData = PoolDayData.load(dayPoolID)
  if (poolDayData === null) {
    poolDayData = new PoolDayData(dayPoolID)
    poolDayData.date = dayStartTimestamp
    poolDayData.token = pool.token
    poolDayData.poolAddress = event.address
    poolDayData.dailyVolumeToken = ZERO_BD
    poolDayData.dailyVolumeUSD = ZERO_BD
    poolDayData.dailyTxns = ZERO_BI
  }

  poolDayData.totalSupply = pool.totalSupply
  poolDayData.reserve = pool.reserve
  poolDayData.reserveUSD = pool.reserveUSD
  poolDayData.dailyTxns = poolDayData.dailyTxns.plus(ONE_BI)
  poolDayData.save()

  return poolDayData as PoolDayData
}

export function updatePoolHourData(event: EthereumEvent): PoolHourData {
  let timestamp = event.block.timestamp.toI32()
  let hourIndex = timestamp / 3600 // get unique hour within unix history
  let hourStartUnix = hourIndex * 3600 // want the rounded effect
  let hourPoorID = event.address
    .toHexString()
    .concat('-')
    .concat(BigInt.fromI32(hourIndex).toString())
  let pool = Pool.load(event.address.toHexString())
  let poolHourData = PoolHourData.load(hourPoorID)
  if (poolHourData === null) {
    poolHourData = new PoolHourData(hourPoorID)
    poolHourData.hourStartUnix = hourStartUnix
    poolHourData.pool = event.address.toHexString()
    poolHourData.hourlyVolumeToken = ZERO_BD
    poolHourData.hourlyVolumeUSD = ZERO_BD
    poolHourData.hourlyTxns = ZERO_BI
  }

  poolHourData.reserve = pool.reserve
  poolHourData.reserveUSD = pool.reserveUSD
  poolHourData.hourlyTxns = poolHourData.hourlyTxns.plus(ONE_BI)
  poolHourData.save()

  return poolHourData as PoolHourData
}

export function updateTokenDayData(token: Token, event: EthereumEvent): TokenDayData {
  let bundle = Bundle.load('1')
  let timestamp = event.block.timestamp.toI32()
  let dayID = timestamp / 86400
  let dayStartTimestamp = dayID * 86400
  let tokenDayID = token.id
    .toString()
    .concat('-')
    .concat(BigInt.fromI32(dayID).toString())

  let tokenDayData = TokenDayData.load(tokenDayID)
  if (tokenDayData === null) {
    tokenDayData = new TokenDayData(tokenDayID)
    tokenDayData.date = dayStartTimestamp
    tokenDayData.token = token.id
    tokenDayData.priceUSD = token.derivedETH.times(bundle.ethPrice)
    tokenDayData.dailyVolumeToken = ZERO_BD
    tokenDayData.dailyVolumeETH = ZERO_BD
    tokenDayData.dailyVolumeUSD = ZERO_BD
    tokenDayData.dailyTxns = ZERO_BI
    tokenDayData.totalLiquidityUSD = ZERO_BD
  }
  tokenDayData.priceUSD = token.derivedETH.times(bundle.ethPrice)
  tokenDayData.totalLiquidityToken = token.totalLiquidity
  tokenDayData.totalLiquidityETH = token.totalLiquidity.times(token.derivedETH as BigDecimal)
  tokenDayData.totalLiquidityUSD = tokenDayData.totalLiquidityETH.times(bundle.ethPrice)
  tokenDayData.dailyTxns = tokenDayData.dailyTxns.plus(ONE_BI)
  tokenDayData.save()

  /**
   * @todo test if this speeds up sync
   */
  // updateStoredTokens(tokenDayData as TokenDayData, dayID)
  // updateStoredPools(tokenDayData as TokenDayData, dayPoolID)

  return tokenDayData as TokenDayData
}
