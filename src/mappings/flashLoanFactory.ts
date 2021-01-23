/* eslint-disable prefer-const */
import { log } from '@graphprotocol/graph-ts'
import { FlashLoanFactory, Pool, Token, Bundle } from '../types/schema'
import { PoolCreated } from '../types/FlashLoanFactory/FlashLoanFactory'
import { Pool as PoolTemplate } from '../types/templates'
import {
  FLASH_LOAN_FACTORY_ADDRESS,
  ZERO_BD,
  ZERO_BI,
  fetchTokenSymbol,
  fetchTokenName,
  fetchTokenDecimals,
  fetchTokenTotalSupply
} from './helpers'

export function handleNewPool(event: PoolCreated): void {
  // load factory (create if first exchange)
  let factory = FlashLoanFactory.load(FLASH_LOAN_FACTORY_ADDRESS)
  if (factory === null) {
    factory = new FlashLoanFactory(FLASH_LOAN_FACTORY_ADDRESS)
    factory.poolCount = 0
    factory.totalVolumeETH = ZERO_BD
    factory.totalLiquidityETH = ZERO_BD
    factory.totalVolumeUSD = ZERO_BD
    factory.untrackedVolumeUSD = ZERO_BD
    factory.totalLiquidityUSD = ZERO_BD
    factory.txCount = ZERO_BI

    // create new bundle
    let bundle = new Bundle('1')
    bundle.ethPrice = ZERO_BD
    bundle.save()
  }
  factory.poolCount = factory.poolCount + 1
  factory.save()

  // create the tokens
  let token = Token.load(event.params.token.toHexString())

  // fetch info if null
  if (token === null) {
    token = new Token(event.params.token.toHexString())
    token.symbol = fetchTokenSymbol(event.params.token)
    token.name = fetchTokenName(event.params.token)
    token.totalSupply = fetchTokenTotalSupply(event.params.token)
    let decimals = fetchTokenDecimals(event.params.token)
    // bail if we couldn't figure out the decimals
    if (decimals === null) {
      log.debug('mybug the decimal on token 0 was null', [])
      return
    }

    token.decimals = decimals
    token.derivedETH = ZERO_BD
    token.tradeVolume = ZERO_BD
    token.tradeVolumeUSD = ZERO_BD
    token.untrackedVolumeUSD = ZERO_BD
    token.totalLiquidity = ZERO_BD
    // token.allPools = []
    token.txCount = ZERO_BI
  }

  let pool = new Pool(event.params.pool.toHexString()) as Pool
  pool.token = token.id
  pool.liquidityProviderCount = ZERO_BI
  pool.createdAtTimestamp = event.block.timestamp
  pool.createdAtBlockNumber = event.block.number
  pool.txCount = ZERO_BI
  pool.reserve = ZERO_BD
  pool.trackedReserveETH = ZERO_BD
  pool.reserveETH = ZERO_BD
  pool.reserveUSD = ZERO_BD
  pool.totalSupply = ZERO_BD
  pool.volumeToken = ZERO_BD
  pool.volumeUSD = ZERO_BD
  pool.untrackedVolumeUSD = ZERO_BD
  pool.tokenPrice = ZERO_BD

  // create the tracked contract based on the template
  PoolTemplate.create(event.params.pool)

  // save updated values
  token.save()
  pool.save()
  factory.save()
}
