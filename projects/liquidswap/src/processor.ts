import { liquidity_pool } from './types/aptos/liquidswap'
import { AccountEventTracker, aptos, Counter, Gauge } from "@sentio/sdk";
import {
  caculateValueInUsd,
  delay,
  getCoinInfo,
  getPrice,
  requestCoinInfo,
  scaleDown,
  whiteListed,
  CORE_TOKENS, getRandomInt
} from "./utils";
import { aggregator, coin, optional_aggregator, timestamp } from "@sentio/sdk/lib/builtin/aptos/0x1";
import { AptosClient } from "aptos-sdk";

import * as crypto from "crypto"
import { BigDecimal } from "@sentio/sdk/lib/core/big-decimal";

import Long from 'Long'
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { TypedMoveResource } from "@sentio/sdk/lib/aptos/types";
import CoinInfo = coin.CoinInfo;

const commonOptions = { sparse:  true }
const totalValue = new Gauge("total_value", commonOptions)
// const totalAmount = new Gauge("total_amount", commonOptions)

const tvlAll = new Gauge("tvl_all", commonOptions)
const tvl = new Gauge("tvl", commonOptions)
// const amountCounter = new Gauge("amount", commonOptions)
// const volumeByPool = new Gauge("vol_by_pool", commonOptions)
const volume = new Gauge("vol", commonOptions)
// const priceGauge = new Gauge("price", commonOptions)

// const eventCounter = new Counter("num_event", commonOptions)

const accountTracker = AccountEventTracker.register("users")

// const POOL_TYPE = "0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12::liquidity_pool::LiquidityPool"
//
// const ALL_POOLS = new Set<string>()
// let poolVersion = Long.ZERO

// const tmpFile = path.resolve(os.tmpdir(), "sentio", "cache", "sets")

// interface SavedPools {
//   version: string
//   pools: string[]
// }
//
// function savePool(version: Long, types: string[]) {
//   poolVersion = version
//   const value = types.join(", ")
//   if (!ALL_POOLS.has(value)) {
//     ALL_POOLS.add(value)
//     const data: SavedPools  = { version: poolVersion.toString(), pools: Array.from(ALL_POOLS)}
//     const json = JSON.stringify(data)
//     fs.mkdirSync(path.resolve(tmpFile, ".."), { recursive: true})
//     fs.writeFileSync(tmpFile , json)
//   }
// }
//
// function readPool(version: Long) {
//   if (ALL_POOLS.size !== 0) {
//     return
//   }
//   if (!fs.existsSync(tmpFile)) {
//     return
//   }
//   const json: SavedPools = JSON.parse(fs.readFileSync(tmpFile, "utf-8"))
//   const poolVersion = Long.fromString(json.version)
//   if (version.lte(poolVersion)) {
//     return
//   }
//   console.log("loading pools", json.pools.length)
//
//   for (const x of json.pools) {
//     ALL_POOLS.add(x)
//   }
//   console.log(json)
// }

liquidity_pool.bind({startVersion: 299999})
  .onEventPoolCreatedEvent(async (evt, ctx) => {
    ctx.meter.Counter("num_pools").add(1)
    accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    ctx.logger.info("PoolCreated", { user: ctx.transaction.sender })

    // readPool(ctx.version)
    //
    // savePool(ctx.version, evt.type_arguments)

    // await syncPools(ctx)
  })
  .onEventLiquidityAddedEvent(async (evt, ctx) => {
    // ctx.meter.Counter("event_liquidity_add").add(1)
    accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    ctx.logger.info("LiquidityAdded", { user: ctx.transaction.sender })

    // await syncPools(ctx)
  })
  .onEventLiquidityRemovedEvent(async (evt, ctx) => {
    // ctx.meter.Counter("event_liquidity_removed").add(1)
    accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    ctx.logger.info("LiquidityRemoved", { user: ctx.transaction.sender })

    // await syncPools(ctx)
  })
  .onEventSwapEvent(async (evt, ctx) => {
    // const pool = await getPoolName(evt.type_arguments)
    // await recordTradingVolume(ctx, evt.type_arguments[0], evt.type_arguments[1], evt.data_typed.x_in, evt.data_typed.y_in, pool)
    //
    // const coinXInfo = await getCoinInfo(evt.type_arguments[0])
    // const coinYInfo = await getCoinInfo(evt.type_arguments[1])
    // ctx.meter.Counter("event_swap_by_bridge").add(1, { bridge: coinXInfo.bridge })
    // ctx.meter.Counter("event_swap_by_bridge").add(1, { bridge: coinYInfo.bridge })

    accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    ctx.logger.info("Swap", { user: ctx.transaction.sender })

    // await syncPools(ctx)
  })
  .onEventFlashloanEvent(async (evt, ctx) => {
    // const pool = await getPoolName(evt.type_arguments)
    // await recordTradingVolume(ctx, evt.type_arguments[0], evt.type_arguments[1], evt.data_typed.x_in, evt.data_typed.y_in, pool)
    //
    // const coinXInfo = await getCoinInfo(evt.type_arguments[0])
    // const coinYInfo = await getCoinInfo(evt.type_arguments[1])
    // ctx.meter.Counter("event_flashloan_by_bridge").add(1, { bridge: coinXInfo.bridge })
    // ctx.meter.Counter("event_flashloan_by_bridge").add(1, { bridge: coinYInfo.bridge })

    accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    ctx.logger.info("Flashloan", { user: ctx.transaction.sender })

    // await syncPools(ctx)
  })

// async function addForVolume(ctx: aptos.AptosContext, type: string, amount: bigint, timestamp: string, pool: string, valueOverride?: BigDecimal): Promise<BigDecimal> {
//   if (!whiteListed(type)) {
//     if (valueOverride) {
//       const coin = await getCoinInfo(type)
//       volumeGauge.record(ctx, value, {coin: coin.symbol, pool: pool})
//       return valueOverride
//     }
//   }
//   const coin = await getCoinInfo(type)
//   const value = await caculateValueInUsd(amount, coin, timestamp)
//   volumeGauge.record(ctx, value, {coin: coin.symbol, pool: pool})
//   return value
// }

async function recordTradingVolume(ctx: aptos.AptosContext, coinx: string, coiny: string, coinx_amount: bigint, coiny_amount: bigint, poolName: string) {
  // const coinx = pool.type_arguments[0]
  // const coiny = pool.type_arguments[1]

  const whitelistx = whiteListed(coinx)
  const whitelisty = whiteListed(coiny)
  if (!whitelistx && !whitelisty) {
    return
  }

  const timestamp = ctx.transaction.timestamp
  const coinXInfo = await getCoinInfo(coinx)
  const coinYInfo = await getCoinInfo(coiny)

  if (whitelistx) {
    const value = await caculateValueInUsd(coinx_amount, coinXInfo, timestamp)
    // volumeByPool.record(ctx, value, {coin: coinXInfo.symbol, pool: poolName})
    volume.record(ctx, value, {coin: coinXInfo.symbol, bridge: coinXInfo.bridge, type: coinXInfo.token_type.type})
    // if (coinXInfo.bridge)

    if (!whitelisty) {
      volume.record(ctx, value, {coin: coinYInfo.symbol, bridge: coinYInfo.bridge, type: coinYInfo.token_type.type})
      // volumeByPool.record(ctx, value, {coin: coinYInfo.symbol, pool: poolName})
    }
  }
  if (whitelisty) {
    const value = await caculateValueInUsd(coiny_amount, coinYInfo, timestamp)
    // volumeByPool.record(ctx, value, {coin: coinYInfo.symbol, pool: poolName})
    volume.record(ctx, value, {coin: coinYInfo.symbol, bridge: coinYInfo.bridge, type: coinYInfo.token_type.type})

    if (!whitelistx) {
      volume.record(ctx, value, {coin: coinXInfo.symbol, bridge: coinXInfo.bridge, type: coinXInfo.token_type.type})
      // volumeByPool.record(ctx, value, {coin: coinXInfo.symbol, pool: poolName})
    }
  }

}

// async function addFor(ctx: aptos.AptosContext, type: string, amount: bigint, timestamp: string, pool: string) {
//   const coin = await getCoinInfo(type)
//   if (coin) {
//     const value = await caculateValueInUsd(amount, coin, timestamp)
//     valueCounter.record(ctx, value, {coin: coin.symbol, pool: pool})
//     amountCounter.record(ctx, scaleDown(amount, coin.decimals), {coin: coin.symbol, pool: pool})
//   }
// }

// async function subFor(ctx: aptos.AptosContext, type: string, amount: bigint, timestamp: string, pool: string) {
//   const coin = await getCoinInfo(type)
//   const value = await caculateValueInUsd(amount, coin, timestamp)
//   valueCounter.sub(ctx, value, { coin: coin.symbol, pool: pool })
//   amountCounter.sub(ctx, scaleDown(amount, coin.decimals), { coin: coin.symbol, pool: pool })
// }

// TODO pool name should consider not just use symbol name
async function getPoolName(coins: [string, string, string]): Promise<string> {
  const coinx = await getCoinInfo(coins[0])
  const coiny = await getCoinInfo(coins[1])
  // if (!coinx || !coiny) {
  //   return undefined
  // }
  const token = coins[2].includes("curves::Stable") ? "S" : "U"
  // const xfullname = coins[0].split("::").slice(1).join("::")
  // const yfullname = coins[1].split("::").slice(1).join("::")
  const id = crypto.createHash("md5").update(coins.join()).digest("hex")
  return `${coinx.symbol}-${coiny.symbol}-${token}-${id.slice(0, 6)}`
   // return [coinx, coiny, pool]
}

const recorded = new Set<bigint>()

async function syncPools(ctx: aptos.AptosContext) {
  const version = BigInt(ctx.version.toString())
  const bucket = version / 100000n;
  if (recorded.has(bucket)) {
    return
  }
  recorded.add(bucket)

  // const client = getRpcClient(aptos.AptosNetwork.MAIN_NET)
  // const client = new AptosClient("https://mainnet.aptoslabs.com/")

  const normalClient = new AptosClient("https://aptos-mainnet.nodereal.io/v1/0c58c879d41e4eab8fd2fc0406848c2b")
  const patchClient = new AptosClient("https://aptos-mainnet.pontem.network/v1")

  let pools: TypedMoveResource<liquidity_pool.LiquidityPool<any, any, any>>[] = []

  // if (version <= 13100000n) {
    let resources = undefined
    while (!resources) {
      try {
        let client = normalClient
        if (version > 13100000n) {
          client = patchClient
        }
        resources = await client.getAccountResources('0x5a97986a9d031c4567e15b797be516910cfcb4156312482efc6a19c0a30c948', {ledgerVersion: version})
      } catch (e) {
        console.log("rpc error, retrying", e)
        await delay(1000)
      }
    }
    pools = aptos.TYPE_REGISTRY.filterAndDecodeResources<liquidity_pool.LiquidityPool<any, any, any>>("0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12::liquidity_pool::LiquidityPool", resources)
  // } else {
  //   await Promise.all(Array.from(ALL_POOLS).map(async p =>  {
  //     const coinx = p.split(", ")[0]
  //     const coiny = p.split(", ")[1]
  //     const whitelistx = whiteListed(coinx)
  //     const whitelisty = whiteListed(coiny)
  //     if (!whitelistx && !whitelisty) {
  //       return []
  //     }
  //     let resources = undefined
  //     while (!resources) {
  //       try {
  //         console.log("rpc call", `${POOL_TYPE}<${p}>`)
  //         resources = await client.getAccountResource('0x5a97986a9d031c4567e15b797be516910cfcb4156312482efc6a19c0a30c948',
  //             `${POOL_TYPE}<${p}>`,
  //             {ledgerVersion: version})
  //         const decoded = aptos.TYPE_REGISTRY.decodeResource<liquidity_pool.LiquidityPool<any, any, any>>(resources)
  //         if (decoded) {
  //           pools.push(decoded)
  //         }
  //       } catch (e) {
  //         console.log("rpc error, retrying", e)
  //         await delay(1000)
  //       }
  //     }
  //     return resources
  //   }))
  // }

  const volumeByCoin = new Map<string, BigDecimal>()
  const timestamp = ctx.transaction.timestamp

  console.log("num of pools: ", pools.length, ctx.version.toString())

  let tvlAllValue = BigDecimal(0)
  for (const pool of pools) {
    // savePool(ctx.version, pool.type_arguments)
    const coinx = pool.type_arguments[0]
    const coiny = pool.type_arguments[1]
    const whitelistx = whiteListed(coinx)
    const whitelisty = whiteListed(coiny)
    if (!whitelistx && !whitelisty) {
      continue
    }

    const coinXInfo = await getCoinInfo(coinx)
    const coinYInfo = await getCoinInfo(coiny)

    const coinx_amount = pool.data_typed.coin_x_reserve.value
    const coiny_amount = pool.data_typed.coin_y_reserve.value

    const poolName = await getPoolName(pool.type_arguments as [string,string,string])

    if (whitelistx) {
      const value = await caculateValueInUsd(coinx_amount, coinXInfo, timestamp)
      tvlAllValue = tvlAllValue.plus(value)
      // tvlTotal.record(ctx, value, { pool: poolName, type: coinXInfo.token_type.type })

      let coinXTotal = volumeByCoin.get(coinXInfo.token_type.type)
      if (!coinXTotal) {
        coinXTotal = value
      } else {
        coinXTotal = coinXTotal.plus(value)
      }
      volumeByCoin.set(coinXInfo.token_type.type, coinXTotal)

      if (!whitelisty) {
        tvlAllValue = tvlAllValue.plus(value)
        // tvlTotal.record(ctx, value, { pool: poolName, type: coinYInfo.token_type.type})
      }
    }
    if (whitelisty) {
      const value = await caculateValueInUsd(coiny_amount, coinYInfo, timestamp)
      tvlAllValue = tvlAllValue.plus(value)
      // tvlTotal.record(ctx, value, { pool: poolName, type: coinYInfo.token_type.type })

      let coinYTotal = volumeByCoin.get(coinYInfo.token_type.type)
      if (!coinYTotal) {
        coinYTotal = value
      } else {
        coinYTotal = coinYTotal.plus(value)
      }
      volumeByCoin.set(coinYInfo.token_type.type, coinYTotal)

      if (!whitelistx) {
        tvlAllValue = tvlAllValue.plus(value)
        // tvlTotal.record(ctx, value, { pool: poolName, type: coinXInfo.token_type.type })
      }
    }
  }
  tvlAll.record(ctx, tvlAllValue)

  for (const [k, v] of volumeByCoin) {
    const coinInfo = CORE_TOKENS.get(k)
    if (!coinInfo) {
      throw Error("unexpected coin " + k)
    }
    // const price = await getPrice(coinInfo, timestamp)
    // priceGauge.record(ctx, price, { coin: coinInfo.symbol })
    if (v.isGreaterThan(0)) {
      tvl.record(ctx, v, {coin: coinInfo.symbol, bridge: coinInfo.bridge, type: coinInfo.token_type.type})
    }
  }

  const allPromises = Array.from(CORE_TOKENS.entries()).map(async ([k,v]) => {
    const price = await getPrice(v.token_type.type, timestamp)

    let coinInfo: CoinInfo<any> | undefined
    try {
      coinInfo = await requestCoinInfo(k, version)
    } catch (e) {
      return
    }

    const aggOption = (coinInfo.supply.vec as optional_aggregator.OptionalAggregator[])[0]
    let amount
    if (aggOption.integer.vec.length) {
      const intValue = (aggOption.integer.vec[0] as optional_aggregator.Integer)
      amount = intValue.value
    } else {
      const agg = (aggOption.aggregator.vec[0] as aggregator.Aggregator)
      let aggString: any
      while (!aggString) {
        try {
          aggString = await normalClient.getTableItem(agg.handle, {
            key: agg.key,
            key_type: "address",
            value_type: "u128"
          }, {ledgerVersion: version})
        } catch (e) {
          if (e.status === 429) {
            await delay(1000 + getRandomInt(1000))
          } else {
            throw e
          }
        }
      }
      amount = BigInt(aggString)
    }

    // totalAmount.record(ctx, scaleDown(amount, extedCoinInfo.decimals), { coin: extedCoinInfo.symbol, bridge: extedCoinInfo.bridge })
    const value = scaleDown(amount, v.decimals).multipliedBy(price)
    if (value.isGreaterThan(0)) {
      totalValue.record(ctx, value, {coin: v.symbol, bridge: v.bridge, type: v.token_type.type})
    }
  })

  await Promise.all(allPromises)
}