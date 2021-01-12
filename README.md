# FlashLoan V1 Subgraph

[Deerfi](https://deerfi.com/) is a decentralized marketplace for flash loan on Ethereum.

This subgraph dynamically tracks any pool created by the flash loan factory. It tracks of the current state of FlashLoan contracts, and contains derived stats for things like historical data and USD prices.

- aggregated data across pools and tokens,
- data on individual pools and tokens,
- data on transactions
- data on liquidity providers
- historical data on Deerfi, pools or tokens, aggregated by day

## Running Locally

Make sure to update package.json settings to point to your own graph account.

## Queries

Below are a few ways to show how to query the flashloan-subgraph for data. The queries show most of the information that is queryable, but there are many other filtering options that can be used, just check out the [querying api](https://thegraph.com/docs/graphql-api). These queries can be used locally or in The Graph Explorer playground.

## Key Entity Overviews

#### FlashLoanFactory

Contains data across all of FlashLoan V1. This entity tracks important things like total liquidity (in ETH and USD, see below), all time volume, transaction count, number of pools and more.

#### Token

Contains data on a specific token. This token specific data is aggregated across all pools, and is updated whenever there is a transaction involving that token.

#### Pool

Contains data on a specific pool.

#### Transaction

Every transaction on FlashLoan is stored. Each transaction contains an array of mints, burns, and flashLoans that occured within it.

#### Mint, Burn, FlashLoan

These contain specifc information about a transaction. Things like which pool triggered the transaction, amounts, sender, recipient, and more. Each is linked to a parent Transaction entity.

## Example Queries

### Querying Aggregated FlashLoan Data

This query fetches aggredated data from all flash loan pools and tokens, to give a view into how much activity is happening within the whole protocol.

```graphql
{
  flashLoanFactories(first: 1) {
    poolCount
    totalVolumeUSD
    totalLiquidityUSD
  }
}
```
