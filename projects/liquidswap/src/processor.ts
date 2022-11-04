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
import { aggregator, coin, optional_aggregator } from "@sentio/sdk/lib/builtin/aptos/0x1";
import { AptosAccountProcessor, MoveResourcesWithVersionPayload } from "@sentio/sdk/lib/aptos/aptos-processor";

import { AptosClient } from "aptos-sdk";

import { BigDecimal } from "@sentio/sdk/lib/core/big-decimal";

import { TypedEntryFunctionPayload, TypedMoveResource } from "@sentio/sdk/lib/aptos/types";
import CoinInfo = coin.CoinInfo;
import { MoveResource, TransactionPayload_EntryFunctionPayload } from "aptos-sdk/src/generated";
import { amm } from "./types/aptos/auxexchange";
import { AptosResourceContext } from "@sentio/sdk/lib/aptos/context";

const commonOptions = { sparse:  true }
const totalValue = new Gauge("total_value", commonOptions)
const tvlAll = new Gauge("tvl_all", commonOptions)
const tvlByPool = new Gauge("tvl_by_pool", commonOptions)
const tvl = new Gauge("tvl", commonOptions)
const volume = new Gauge("vol", commonOptions)

const inputUsd = [100, 1000, 10000, 100000]
const priceImpact = new Gauge('price_impact', commonOptions)

const accountTracker = AccountEventTracker.register("users")
const lpTracker = AccountEventTracker.register("lp")


const auxVolume = new Gauge("aux_vol", commonOptions)
const auxTvlByPool = new Gauge("aux_tvl_by_pool", commonOptions)
const aux_tvl = new Gauge("aux_tvl", commonOptions)

// const auxTvlAll = new Gauge("aux_tvl_all", commonOptions)


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
    lpTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    // ctx.logger.info("PoolCreated", { user: ctx.transaction.sender })

    ctx.logger.info("", {user: "-", value: 0.0001})

    // readPool(ctx.version)
    //
    // savePool(ctx.version, evt.type_arguments)

    // await syncLiquidSwapPools(ctx)
  })
  .onEventLiquidityAddedEvent(async (evt, ctx) => {
    ctx.meter.Counter("event_liquidity_add").add(1)
    lpTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    // await syncLiquidSwapPools(ctx)
  })
  .onEventLiquidityRemovedEvent(async (evt, ctx) => {
    ctx.meter.Counter("event_liquidity_removed").add(1)
    accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    // await syncLiquidSwapPools(ctx)
  })
  .onEventSwapEvent(async (evt, ctx) => {
    const value = await recordTradingVolume(ctx, volume,
        evt.type_arguments[0], evt.type_arguments[1],
        evt.data_typed.x_in + evt.data_typed.x_out,
        evt.data_typed.y_in + evt.data_typed.y_out,
        getCurve(evt.type_arguments[2]))

    const coinXInfo = await getCoinInfo(evt.type_arguments[0])
    const coinYInfo = await getCoinInfo(evt.type_arguments[1])

    ctx.logger.info(`${ctx.transaction.sender} Swap ${coinXInfo.symbol} for ${coinYInfo.symbol}`, {user: ctx.transaction.sender, value: value.toNumber()})

    ctx.meter.Counter("event_swap_by_bridge").add(1, { bridge: coinXInfo.bridge })
    ctx.meter.Counter("event_swap_by_bridge").add(1, { bridge: coinYInfo.bridge })

    accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })

    // await syncLiquidSwapPools(ctx)
  })
  .onEventFlashloanEvent(async (evt, ctx) => {
    const coinXInfo = await getCoinInfo(evt.type_arguments[0])
    const coinYInfo = await getCoinInfo(evt.type_arguments[1])
    ctx.meter.Counter("event_flashloan_by_bridge").add(1, { bridge: coinXInfo.bridge })
    ctx.meter.Counter("event_flashloan_by_bridge").add(1, { bridge: coinYInfo.bridge })

    accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
    // await syncLiquidSwapPools(ctx)
  })

AptosAccountProcessor.bind({address: '0xbd35135844473187163ca197ca93b2ab014370587bb0ed3befff9e902d6bb541', startVersion: 299999})
    .onVersionInterval(syncLiquidSwapPools)

amm.bind({startVersion: 299999})
    .onEntryCreatePool(async (evt, ctx) => {
      ctx.meter.Counter("aux_num_pools").add(1)
      await syncAuxPools(ctx)
    })
    .onEventAddLiquidityEvent(async (evt, ctx) => {
      ctx.meter.Counter("aux_event_liquidity_add").add(1)
      // ctx.logger.info("LiquidityAdded", { user: ctx.transaction.sender })
      await syncAuxPools(ctx)
    })
    .onEventRemoveLiquidityEvent(async (evt, ctx) => {
      ctx.meter.Counter("aux_event_liquidity_removed").add(1)
      accountTracker.trackEvent(ctx, { distinctId: ctx.transaction.sender })
      // ctx.logger.info("LiquidityRemoved", { user: ctx.transaction.sender })
      await syncAuxPools(ctx)
    })
    .onEventSwapEvent(async (evt, ctx) => {
      const value = await recordTradingVolume(ctx, auxVolume, evt.data_typed.in_coin_type, evt.data_typed.out_coin_type, evt.data_typed.in_au, evt.data_typed.out_au)
      const coinXInfo = await getCoinInfo(evt.data_typed.in_coin_type)
      const coinYInfo = await getCoinInfo(evt.data_typed.out_coin_type)
      ctx.meter.Counter("aux_event_swap_by_bridge").add(1, { bridge: coinXInfo.bridge })
      ctx.meter.Counter("aux_event_swap_by_bridge").add(1, { bridge: coinYInfo.bridge })

      await syncAuxPools(ctx)
    })


async function recordTradingVolume(ctx: aptos.AptosContext, volume: Gauge, coinx: string, coiny: string, coinXAmount: bigint, coinYAmount: bigint, curve?: string): Promise<BigDecimal> {
  const whitelistx = whiteListed(coinx)
  const whitelisty = whiteListed(coiny)
  const coinXInfo = await getCoinInfo(coinx)
  const coinYInfo = await getCoinInfo(coiny)
  const timestamp = ctx.transaction.timestamp
  let result = BigDecimal(0.0)

  if (!whitelistx || !whitelisty) {
    return result
  }

  const pair = await getPair(coinx, coiny)

  const baseLabels: Record<string, string> = { pair }
  if (curve) {
    baseLabels.curve = curve
  }

  if (whitelistx) {
    const value = await caculateValueInUsd(coinXAmount, coinXInfo, timestamp)
    result = value

    volume.record(ctx, value, { ...baseLabels, coin: coinXInfo.symbol, bridge: coinXInfo.bridge, type: coinXInfo.token_type.type})
  }
  if (whitelisty) {
    const value = await caculateValueInUsd(coinYAmount, coinYInfo, timestamp)
    result = value

    volume.record(ctx, value, { ...baseLabels, coin: coinYInfo.symbol, bridge: coinYInfo.bridge, type: coinYInfo.token_type.type})
  }

  // fee.record(ctx, result.multipliedBy(0.0025), baseLabels)
  // feeAcc.add(ctx, result.multipliedBy(0.0025), baseLabels)

  return result
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
async function getPair(coinx: string, coiny: string): Promise<string> {
  const coinXInfo = await getCoinInfo(coinx)
  const coinYInfo = await getCoinInfo(coiny)
  if (coinXInfo.symbol.localeCompare(coinYInfo.symbol) > 0) {
    return `${coinYInfo.symbol}-${coinXInfo.symbol}`
  }
  return `${coinXInfo.symbol}-${coinYInfo.symbol}`
}

function getCurve(type: string) {
  if (type.includes("0x190d44266241744264b964a37b8f09863167a12d3e70cda39376cfb4e3561e12::curves::Stable")) {
    return "Stable"
  } else {
    return "Uncorrelated"
  }
}

const recorded = new Set<bigint>()
const auxRecorded = new Set<bigint>()

const SKIP_POOL = false

async function syncLiquidSwapPools(resources: MoveResource[], ctx: AptosResourceContext) {
  if (SKIP_POOL) {
    return
  }

  // // folowing line is hack to run once every 100000 version
  // const version = BigInt(ctx.version.toString())
  // const bucket = version / 100000n;
  // if (recorded.has(bucket)) {
  //   return
  // }
  // recorded.add(bucket)

  const normalClient = new AptosClient("https://aptos-mainnet.nodereal.io/v1/0c58c879d41e4eab8fd2fc0406848c2b")
  // const patchClient = new AptosClient("https://aptos-mainnet.pontem.network/v1")

  let pools: TypedMoveResource<liquidity_pool.LiquidityPool<any, any, any>>[]

  // if (version <= 13100000n) {
  //   let resources = undefined
  //   while (!resources) {
  //     try {
  //       let client = normalClient
  //       if (version > 13100000n) {
  //         client = patchClient
  //       }
  //       resources = await client.getAccountResources('0x5a97986a9d031c4567e15b797be516910cfcb4156312482efc6a19c0a30c948', {ledgerVersion: version})
  //     } catch (e) {
  //       console.log("rpc error, retrying", e)
  //       await delay(1000)
  //     }
  //   }
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
  const timestamp = ctx.timestampInMicros

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

    const pair = await getPair(coinx, coiny)
    const curve = getCurve(pool.type_arguments[2])

    const coinXInfo = await getCoinInfo(coinx)
    const coinYInfo = await getCoinInfo(coiny)

    const coinx_amount = pool.data_typed.coin_x_reserve.value
    const coiny_amount = pool.data_typed.coin_y_reserve.value

    let poolValue = BigDecimal(0)
    if (whitelistx) {
      const value = await caculateValueInUsd(coinx_amount, coinXInfo, timestamp)
      poolValue = poolValue.plus(value)
      // tvlTotal.record(ctx, value, { pool: poolName, type: coinXInfo.token_type.type })

      let coinXTotal = volumeByCoin.get(coinXInfo.token_type.type)
      if (!coinXTotal) {
        coinXTotal = value
      } else {
        coinXTotal = coinXTotal.plus(value)
      }
      volumeByCoin.set(coinXInfo.token_type.type, coinXTotal)

      if (!whitelisty) {
        poolValue = poolValue.plus(value)
        // tvlTotal.record(ctx, value, { pool: poolName, type: coinYInfo.token_type.type})
      }
    }
    if (whitelisty) {
      const value = await caculateValueInUsd(coiny_amount, coinYInfo, timestamp)
      poolValue = poolValue.plus(value)
      // tvlTotal.record(ctx, value, { pool: poolName, type: coinYInfo.token_type.type })

      let coinYTotal = volumeByCoin.get(coinYInfo.token_type.type)
      if (!coinYTotal) {
        coinYTotal = value
      } else {
        coinYTotal = coinYTotal.plus(value)
      }
      volumeByCoin.set(coinYInfo.token_type.type, coinYTotal)

      if (!whitelistx) {
        poolValue = poolValue.plus(value)
      }
    }
    if (poolValue.isGreaterThan(0)) {
      tvlByPool.record(ctx, poolValue, {pair, curve})

      if (curve == "Uncorrelated") {
        const priceX = await getPrice(coinXInfo.token_type.type, timestamp)
        const priceY = await getPrice(coinYInfo.token_type.type, timestamp)
        if (priceX != 0 && priceY != 0) {
          const nX = scaleDown(coinx_amount, coinXInfo.decimals)
          const nY = scaleDown(coiny_amount, coinYInfo.decimals)
          const fee = scaleDown(pool.data_typed.fee, 4)
          const feeFactor = fee.div(BigDecimal(1).minus(fee))

          for (const k of inputUsd) {
            // impactX = fee / (1 - fee) + inX / nX
            const inX = BigDecimal(k).div(priceX)
            const impactX = feeFactor.plus(inX.div(nX))
            priceImpact.record(ctx, impactX, {
              pair, curve,
              fee: fee.toString(),
              inputUsd: k.toString(),
              direction: 'X to Y'
            })

            const inY = BigDecimal(k).div(priceY)
            const impactY = feeFactor.plus(inY.div(nY))
            priceImpact.record(ctx, impactY, {
              pair, curve,
              fee: fee.toString(),
              inputUsd: k.toString(),
              direction: 'Y to X'
            })
          }
        }
      }
    }
    tvlAllValue = tvlAllValue.plus(poolValue)
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
      coinInfo = await requestCoinInfo(k, ctx.version)
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
          }, {ledgerVersion: ctx.version})
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

async function syncAuxPools(ctx: aptos.AptosContext) {
  if (SKIP_POOL) {
    return
  }

  // folowing line is hack to run once every 100000 version
  const version = BigInt(ctx.version.toString())
  const bucket = version / 100000n;
  if (auxRecorded.has(bucket)) {
    return
  }
  auxRecorded.add(bucket)

  const normalClient = new AptosClient("https://aptos-mainnet.nodereal.io/v1/0c58c879d41e4eab8fd2fc0406848c2b")

  let pools: TypedMoveResource<amm.Pool<any, any>>[]

  // if (version <= 13100000n) {
  let resources = undefined
  while (!resources) {
    try {
      resources = await normalClient.getAccountResources('0xbd35135844473187163ca197ca93b2ab014370587bb0ed3befff9e902d6bb541', {ledgerVersion: version})
    } catch (e) {
      console.log("rpc error, retrying", e)
      await delay(1000)
    }
  }
  pools = aptos.TYPE_REGISTRY.filterAndDecodeResources<amm.Pool<any, any>>("0xbd35135844473187163ca197ca93b2ab014370587bb0ed3befff9e902d6bb541::amm::Pool", resources)

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

    const pair = await getPair(coinx, coiny)
    // const curve = getCurve(pool.type_arguments[2])

    const coinXInfo = await getCoinInfo(coinx)
    const coinYInfo = await getCoinInfo(coiny)

    const coinx_amount = pool.data_typed.x_reserve.value
    const coiny_amount = pool.data_typed.y_reserve.value

    let poolValue = BigDecimal(0)
    if (whitelistx) {
      const value = await caculateValueInUsd(coinx_amount, coinXInfo, timestamp)
      poolValue = poolValue.plus(value)

      let coinXTotal = volumeByCoin.get(coinXInfo.token_type.type)
      if (!coinXTotal) {
        coinXTotal = value
      } else {
        coinXTotal = coinXTotal.plus(value)
      }
      volumeByCoin.set(coinXInfo.token_type.type, coinXTotal)

      if (!whitelisty) {
        poolValue = poolValue.plus(value)
      }
    }
    if (whitelisty) {
      const value = await caculateValueInUsd(coiny_amount, coinYInfo, timestamp)
      poolValue = poolValue.plus(value)

      let coinYTotal = volumeByCoin.get(coinYInfo.token_type.type)
      if (!coinYTotal) {
        coinYTotal = value
      } else {
        coinYTotal = coinYTotal.plus(value)
      }
      volumeByCoin.set(coinYInfo.token_type.type, coinYTotal)

      if (!whitelistx) {
        poolValue = poolValue.plus(value)
      }
    }
    if (poolValue.isGreaterThan(0)) {
      auxTvlByPool.record(ctx, poolValue, {pair})
    }
    tvlAllValue = tvlAllValue.plus(poolValue)
  }

  for (const [k, v] of volumeByCoin) {
    const coinInfo = CORE_TOKENS.get(k)
    if (!coinInfo) {
      throw Error("unexpected coin " + k)
    }
    // const price = await getPrice(coinInfo, timestamp)
    // priceGauge.record(ctx, price, { coin: coinInfo.symbol })
    if (v.isGreaterThan(0)) {
      aux_tvl.record(ctx, v, {coin: coinInfo.symbol, bridge: coinInfo.bridge, type: coinInfo.token_type.type})
    }
  }
}