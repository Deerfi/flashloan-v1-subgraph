/* eslint-disable prefer-const */
import { BigInt, BigDecimal, store, Address } from '@graphprotocol/graph-ts'
import {
  Pair,
  Pool,
  Token,
  UniswapFactory,
  FlashLoanFactory,
  Transaction,
  Mint as MintEvent,
  Burn as BurnEvent,
  FlashLoan as FlashLoanEvent,
  Bundle
} from '../types/schema'
import { Sync as PairSync } from '../types/templates/Pair/Pair'
import { Pool as PoolContract, Mint, Burn, FlashLoan, Transfer, Sync as PoolSync } from '../types/templates/Pool/Pool'
import { updatePoolDayData, updateTokenDayData, updateFlashLoanDayData, updatePoolHourData } from './dayUpdates'
import { getEthPriceInUSD, findEthPerToken, getTrackedPairLiquidityUSD, getTrackedPoolLiquidityUSD } from './pricing'
import {
  convertTokenToDecimal,
  ADDRESS_ZERO,
  UNISWAP_FACTORY_ADDRESS,
  FLASH_LOAN_FACTORY_ADDRESS,
  ONE_BI,
  createUser,
  createLiquidityPosition,
  ZERO_BD,
  BI_18,
  createLiquiditySnapshot
} from './helpers'

function isCompleteMint(mintId: string): boolean {
  return MintEvent.load(mintId).sender !== null // sufficient checks
}

export function handleTransfer(event: Transfer): void {
  // ignore initial transfers for first adds
  if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.value.equals(BigInt.fromI32(1000))) {
    return
  }

  let factory = FlashLoanFactory.load(FLASH_LOAN_FACTORY_ADDRESS)
  let transactionHash = event.transaction.hash.toHexString()

  // user stats
  let from = event.params.from
  createUser(from)
  let to = event.params.to
  createUser(to)

  // get pool and load contract
  let pool = Pool.load(event.address.toHexString())
  let poolContract = PoolContract.bind(event.address)

  // liquidity token amount being transfered
  let value = convertTokenToDecimal(event.params.value, BI_18)

  // get or create transaction
  let transaction = Transaction.load(transactionHash)
  if (transaction === null) {
    transaction = new Transaction(transactionHash)
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.burns = []
    transaction.flashLoans = []
  }

  // mints
  let mints = transaction.mints
  if (from.toHexString() == ADDRESS_ZERO) {
    // update total supply
    pool.totalSupply = pool.totalSupply.plus(value)
    pool.save()

    // create new mint if no mints so far or if last one is done already
    if (mints.length === 0 || isCompleteMint(mints[mints.length - 1])) {
      let mint = new MintEvent(
        event.transaction.hash
          .toHexString()
          .concat('-')
          .concat(BigInt.fromI32(mints.length).toString())
      )
      mint.transaction = transaction.id
      mint.pool = pool.id
      mint.to = to
      mint.liquidity = value
      mint.timestamp = transaction.timestamp
      mint.transaction = transaction.id
      mint.save()

      // update mints in transaction
      transaction.mints = mints.concat([mint.id])

      // save entities
      transaction.save()
      factory.save()
    }
  }

  // case where direct send first on ETH withdrawls
  if (event.params.to.toHexString() == pool.id) {
    let burns = transaction.burns
    let burn = new BurnEvent(
      event.transaction.hash
        .toHexString()
        .concat('-')
        .concat(BigInt.fromI32(burns.length).toString())
    )
    burn.transaction = transaction.id
    burn.pool = pool.id
    burn.liquidity = value
    burn.timestamp = transaction.timestamp
    burn.to = event.params.to
    burn.sender = event.params.from
    burn.needsComplete = true
    burn.transaction = transaction.id
    burn.save()

    // TODO: Consider using .concat() for handling array updates to protect
    // against unintended side effects for other code paths.
    burns.push(burn.id)
    transaction.burns = burns
    transaction.save()
  }

  // burn
  if (event.params.to.toHexString() == ADDRESS_ZERO && event.params.from.toHexString() == pool.id) {
    pool.totalSupply = pool.totalSupply.minus(value)
    pool.save()

    // this is a new instance of a logical burn
    let burns = transaction.burns
    let burn: BurnEvent
    if (burns.length > 0) {
      let currentBurn = BurnEvent.load(burns[burns.length - 1])
      if (currentBurn.needsComplete) {
        burn = currentBurn as BurnEvent
      } else {
        burn = new BurnEvent(
          event.transaction.hash
            .toHexString()
            .concat('-')
            .concat(BigInt.fromI32(burns.length).toString())
        )
        burn.transaction = transaction.id
        burn.needsComplete = false
        burn.pool = pool.id
        burn.liquidity = value
        burn.transaction = transaction.id
        burn.timestamp = transaction.timestamp
      }
    } else {
      burn = new BurnEvent(
        event.transaction.hash
          .toHexString()
          .concat('-')
          .concat(BigInt.fromI32(burns.length).toString())
      )
      burn.transaction = transaction.id
      burn.needsComplete = false
      burn.pool = pool.id
      burn.liquidity = value
      burn.transaction = transaction.id
      burn.timestamp = transaction.timestamp
    }

    // if this logical burn included a fee mint, account for this
    if (mints.length !== 0 && !isCompleteMint(mints[mints.length - 1])) {
      let mint = MintEvent.load(mints[mints.length - 1])
      burn.feeTo = mint.to
      burn.feeLiquidity = mint.liquidity
      // remove the logical mint
      store.remove('Mint', mints[mints.length - 1])
      // update the transaction

      // TODO: Consider using .slice().pop() to protect against unintended
      // side effects for other code paths.
      mints.pop()
      transaction.mints = mints
      transaction.save()
    }
    burn.save()
    // if accessing last one, replace it
    if (burn.needsComplete) {
      // TODO: Consider using .slice(0, -1).concat() to protect against
      // unintended side effects for other code paths.
      burns[burns.length - 1] = burn.id
    }
    // else add new one
    else {
      // TODO: Consider using .concat() for handling array updates to protect
      // against unintended side effects for other code paths.
      burns.push(burn.id)
    }
    transaction.burns = burns
    transaction.save()
  }

  if (from.toHexString() != ADDRESS_ZERO && from.toHexString() != pool.id) {
    let fromUserLiquidityPosition = createLiquidityPosition(event.address, from)
    fromUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(poolContract.balanceOf(from), BI_18)
    fromUserLiquidityPosition.save()
    createLiquiditySnapshot(fromUserLiquidityPosition, event)
  }

  if (event.params.to.toHexString() != ADDRESS_ZERO && to.toHexString() != pool.id) {
    let toUserLiquidityPosition = createLiquidityPosition(event.address, to)
    toUserLiquidityPosition.liquidityTokenBalance = convertTokenToDecimal(poolContract.balanceOf(to), BI_18)
    toUserLiquidityPosition.save()
    createLiquiditySnapshot(toUserLiquidityPosition, event)
  }

  transaction.save()
}

export function handlePairSync(event: PairSync): void {
  let pair = Pair.load(event.address.toHex())
  let token0 = Token.load(pair.token0)
  let token1 = Token.load(pair.token1)
  let factory = UniswapFactory.load(UNISWAP_FACTORY_ADDRESS)

  // reset factory liquidity by subtracting onluy tarcked liquidity
  factory.totalLiquidityETH = factory.totalLiquidityETH.minus(pair.trackedReserveETH as BigDecimal)

  pair.reserve0 = convertTokenToDecimal(event.params.reserve0, token0.decimals)
  pair.reserve1 = convertTokenToDecimal(event.params.reserve1, token1.decimals)

  if (pair.reserve1.notEqual(ZERO_BD)) pair.token0Price = pair.reserve0.div(pair.reserve1)
  else pair.token0Price = ZERO_BD
  if (pair.reserve0.notEqual(ZERO_BD)) pair.token1Price = pair.reserve1.div(pair.reserve0)
  else pair.token1Price = ZERO_BD

  pair.save()

  // update ETH price now that reserves could have changed
  let bundle = Bundle.load('1')
  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  token0.derivedETH = findEthPerToken(token0 as Token)
  token1.derivedETH = findEthPerToken(token1 as Token)
  token0.save()
  token1.save()

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedPairLiquidityUSD(pair.reserve0, token0 as Token, pair.reserve1, token1 as Token).div(
      bundle.ethPrice
    )
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  // use derived amounts within pair
  pair.trackedReserveETH = trackedLiquidityETH
  pair.reserveETH = pair.reserve0
    .times(token0.derivedETH as BigDecimal)
    .plus(pair.reserve1.times(token1.derivedETH as BigDecimal))
  pair.reserveUSD = pair.reserveETH.times(bundle.ethPrice)

  // use tracked amounts globally
  factory.totalLiquidityETH = factory.totalLiquidityETH.plus(trackedLiquidityETH)
  factory.totalLiquidityUSD = factory.totalLiquidityETH.times(bundle.ethPrice)

  // save entities
  pair.save()
  factory.save()
  token0.save()
  token1.save()
}

export function handlePoolSync(event: PoolSync): void {
  let pool = Pool.load(event.address.toHex())
  let token = Token.load(pool.token)
  let factory = FlashLoanFactory.load(FLASH_LOAN_FACTORY_ADDRESS)

  // reset factory liquidity by subtracting onluy tarcked liquidity
  factory.totalLiquidityETH = factory.totalLiquidityETH.minus(pool.trackedReserveETH as BigDecimal)

  // reset token total liquidity amounts
  token.totalLiquidity = token.totalLiquidity.minus(pool.reserve)

  pool.reserve = convertTokenToDecimal(event.params.reserve, token.decimals)

  pool.tokenPrice = ZERO_BD

  pool.save()

  // update ETH price now that reserves could have changed
  let bundle = Bundle.load('1')
  bundle.ethPrice = getEthPriceInUSD()
  bundle.save()

  token.derivedETH = findEthPerToken(token as Token)
  token.save()

  // get tracked liquidity - will be 0 if neither is in whitelist
  let trackedLiquidityETH: BigDecimal
  if (bundle.ethPrice.notEqual(ZERO_BD)) {
    trackedLiquidityETH = getTrackedPoolLiquidityUSD(pool.reserve, token as Token).div(
      bundle.ethPrice
    )
  } else {
    trackedLiquidityETH = ZERO_BD
  }

  // use derived amounts within pool
  pool.trackedReserveETH = trackedLiquidityETH
  pool.reserveETH = pool.reserve
    .times(token.derivedETH as BigDecimal)
  pool.reserveUSD = pool.reserveETH.times(bundle.ethPrice)

  // use tracked amounts globally
  factory.totalLiquidityETH = factory.totalLiquidityETH.plus(trackedLiquidityETH)
  factory.totalLiquidityUSD = factory.totalLiquidityETH.times(bundle.ethPrice)

  // now correctly set liquidity amounts for each token
  token.totalLiquidity = token.totalLiquidity.plus(pool.reserve)

  // save entities
  pool.save()
  factory.save()
  token.save()
}

export function handleMint(event: Mint): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())
  let mints = transaction.mints
  let mint = MintEvent.load(mints[mints.length - 1])

  let pool = Pool.load(event.address.toHex())
  let factory = FlashLoanFactory.load(FLASH_LOAN_FACTORY_ADDRESS)

  let token = Token.load(pool.token)

  // update exchange info (except balances, sync will cover that)
  let tokenAmount = convertTokenToDecimal(event.params.amount, token.decimals)

  // update txn counts
  token.txCount = token.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = token.derivedETH.times(tokenAmount)
    .times(bundle.ethPrice)

  // update txn counts
  pool.txCount = pool.txCount.plus(ONE_BI)
  factory.txCount = factory.txCount.plus(ONE_BI)

  // save entities
  token.save()
  pool.save()
  factory.save()

  mint.sender = event.params.sender
  mint.amount = tokenAmount as BigDecimal
  mint.logIndex = event.logIndex
  mint.amountUSD = amountTotalUSD as BigDecimal
  mint.save()

  // update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, mint.to as Address)
  createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  updatePoolDayData(event)
  updatePoolHourData(event)
  updateFlashLoanDayData(event)
  updateTokenDayData(token as Token, event)
}

export function handleBurn(event: Burn): void {
  let transaction = Transaction.load(event.transaction.hash.toHexString())

  // safety check
  if (transaction === null) {
    return
  }

  let burns = transaction.burns
  let burn = BurnEvent.load(burns[burns.length - 1])

  let pool = Pool.load(event.address.toHex())
  let factory = FlashLoanFactory.load(FLASH_LOAN_FACTORY_ADDRESS)

  //update token info
  let token = Token.load(pool.token)
  let tokenAmount = convertTokenToDecimal(event.params.amount, token.decimals)

  // update txn counts
  token.txCount = token.txCount.plus(ONE_BI)

  // get new amounts of USD and ETH for tracking
  let bundle = Bundle.load('1')
  let amountTotalUSD = token.derivedETH.times(tokenAmount)
    .times(bundle.ethPrice)

  // update txn counts
  factory.txCount = factory.txCount.plus(ONE_BI)
  pool.txCount = pool.txCount.plus(ONE_BI)

  // update global counter and save
  token.save()
  pool.save()
  factory.save()

  // update burn
  // burn.sender = event.params.sender
  burn.amount = tokenAmount as BigDecimal
  // burn.to = event.params.to
  burn.logIndex = event.logIndex
  burn.amountUSD = amountTotalUSD as BigDecimal
  burn.save()

  // update the LP position
  let liquidityPosition = createLiquidityPosition(event.address, burn.sender as Address)
  createLiquiditySnapshot(liquidityPosition, event)

  // update day entities
  updatePoolDayData(event)
  updatePoolHourData(event)
  updateFlashLoanDayData(event)
  updateTokenDayData(token as Token, event)
}

export function handleFlashLoan(event: FlashLoan): void {
  let pool = Pool.load(event.address.toHexString())
  let token = Token.load(pool.token)
  let amount = convertTokenToDecimal(event.params.amount, token.decimals)
  let premium = convertTokenToDecimal(event.params.premium, token.decimals)

  // totals for volume updates
  let amountTotal = amount.plus(premium)

  // ETH/USD prices
  let bundle = Bundle.load('1')

  // get total amounts of derived USD and ETH for tracking
  let derivedAmountETH = token.derivedETH.times(amountTotal)
  let derivedAmountUSD = derivedAmountETH.times(bundle.ethPrice)

  // only accounts for volume through white listed tokens
  let trackedAmountUSD = derivedAmountUSD

  let trackedAmountETH: BigDecimal
  if (bundle.ethPrice.equals(ZERO_BD)) {
    trackedAmountETH = ZERO_BD
  } else {
    trackedAmountETH = trackedAmountUSD.div(bundle.ethPrice)
  }

  // update token global volume and token liquidity stats
  token.tradeVolume = token.tradeVolume.plus(amountTotal)
  token.tradeVolumeUSD = token.tradeVolumeUSD.plus(trackedAmountUSD)
  token.untrackedVolumeUSD = token.untrackedVolumeUSD.plus(derivedAmountUSD)

  // update txn counts
  token.txCount = token.txCount.plus(ONE_BI)

  // update pool volume data, use tracked amount if we have it as its probably more accurate
  pool.volumeUSD = pool.volumeUSD.plus(trackedAmountUSD)
  pool.volumeToken = pool.volumeToken.plus(amountTotal)
  pool.untrackedVolumeUSD = pool.untrackedVolumeUSD.plus(derivedAmountUSD)
  pool.txCount = pool.txCount.plus(ONE_BI)
  pool.save()

  // update global values, only used tracked amounts for volume
  let factory = FlashLoanFactory.load(FLASH_LOAN_FACTORY_ADDRESS)
  factory.totalVolumeUSD = factory.totalVolumeUSD.plus(trackedAmountUSD)
  factory.totalVolumeETH = factory.totalVolumeETH.plus(trackedAmountETH)
  factory.untrackedVolumeUSD = factory.untrackedVolumeUSD.plus(derivedAmountUSD)
  factory.txCount = factory.txCount.plus(ONE_BI)

  // save entities
  pool.save()
  token.save()
  factory.save()

  let transaction = Transaction.load(event.transaction.hash.toHexString())
  if (transaction === null) {
    transaction = new Transaction(event.transaction.hash.toHexString())
    transaction.blockNumber = event.block.number
    transaction.timestamp = event.block.timestamp
    transaction.mints = []
    transaction.flashLoans = []
    transaction.burns = []
  }
  let flashLoans = transaction.flashLoans
  let flashLoan = new FlashLoanEvent(
    event.transaction.hash
      .toHexString()
      .concat('-')
      .concat(BigInt.fromI32(flashLoans.length).toString())
  )

  // update flash loan event
  flashLoan.transaction = transaction.id
  flashLoan.pool = pool.id
  flashLoan.timestamp = transaction.timestamp
  flashLoan.transaction = transaction.id
  flashLoan.target = event.params.target
  flashLoan.initiator = event.params.initiator
  flashLoan.asset = event.params.asset
  flashLoan.amount = amount
  flashLoan.premium = premium
  flashLoan.from = event.transaction.from
  flashLoan.logIndex = event.logIndex
  // use the tracked amount if we have it
  flashLoan.amountUSD = trackedAmountUSD === ZERO_BD ? derivedAmountUSD : trackedAmountUSD
  flashLoan.save()

  // update the transaction

  // TODO: Consider using .concat() for handling array updates to protect
  // against unintended side effects for other code paths.
  flashLoans.push(flashLoan.id)
  transaction.flashLoans = flashLoans
  transaction.save()

  // update day entities
  let poolDayData = updatePoolDayData(event)
  let poolHourData = updatePoolHourData(event)
  let flashLoanDayData = updateFlashLoanDayData(event)
  let tokenDayData = updateTokenDayData(token as Token, event)

  // flash loan specific updating
  flashLoanDayData.dailyVolumeUSD = flashLoanDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  flashLoanDayData.dailyVolumeETH = flashLoanDayData.dailyVolumeETH.plus(trackedAmountETH)
  flashLoanDayData.dailyVolumeUntracked = flashLoanDayData.dailyVolumeUntracked.plus(derivedAmountUSD)
  flashLoanDayData.save()

  // flash loan specific updating for pool
  poolDayData.dailyVolumeToken = poolDayData.dailyVolumeToken.plus(amountTotal)
  poolDayData.dailyVolumeUSD = poolDayData.dailyVolumeUSD.plus(trackedAmountUSD)
  poolDayData.save()

  // update hourly pool data
  poolHourData.hourlyVolumeToken = poolHourData.hourlyVolumeToken.plus(amountTotal)
  poolHourData.hourlyVolumeUSD = poolHourData.hourlyVolumeUSD.plus(trackedAmountUSD)
  poolHourData.save()

  // flash loan specific updating for token
  tokenDayData.dailyVolumeToken = tokenDayData.dailyVolumeToken.plus(amountTotal)
  tokenDayData.dailyVolumeETH = tokenDayData.dailyVolumeETH.plus(amountTotal.times(token.derivedETH as BigDecimal))
  tokenDayData.dailyVolumeUSD = tokenDayData.dailyVolumeUSD.plus(
    amountTotal.times(token.derivedETH as BigDecimal).times(bundle.ethPrice)
  )
  tokenDayData.save()
}
