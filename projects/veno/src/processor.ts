import { Counter, Gauge } from '@sentio/sdk'
import { ERC20Processor } from '@sentio/sdk/eth/builtin'
import { FountainProcessor, WithdrawEarlyEvent, ClaimVaultPenaltyEvent, FountainContext } from './types/eth/fountain.js'
import { ReservoirProcessor } from './types/eth/reservoir.js'
import { VenostormProcessor } from './types/eth/venostorm.js'
import { LiquidCroProcessor, StakeEvent, RequestUnbondEvent, UnbondEvent, AccrueRewardEvent, LiquidCroContext } from './types/eth/liquidcro.js'
import { EthChainId } from "@sentio/sdk/eth";
import './liquidatom.js'

const DepositEventHandler = async (event: any, ctx: any) => {
  const user = event.args.user
  const pid = Number(event.args.pid)
  const amount = Number(event.args.amount) / Math.pow(10, 18)

  ctx.meter.Counter(`deposit_counter`).add(amount, {
    pid: pid.toString()
  })

  ctx.eventLogger.emit("Deposit", {
    distinctId: user,
    pid,
    amount
  })
}

const VenostormWithdrawEventHandler = async (event: any, ctx: any) => {
  const hash = event.transactionHash

  const user = event.args.user
  const amount = Number(event.args.amount) / Math.pow(10, 18)
  const pid = Number(event.args.pid)

  ctx.meter.Counter(`withdraw_counter`).add(amount,
    {
      pid: pid
    }
  )

  ctx.eventLogger.emit("Withdraw", {
    distinctId: user,
    pid: pid,
    amount
  })
}



const WithdrawEventHandler = async (event: any, ctx: any) => {
  const hash = event.transactionHash
  const user = event.args.user
  const stakeId = Number(event.args.stakeId)
  const amount = Number(event.args.amount) / Math.pow(10, 18)
  const weightedAmount = Number(event.args.weightedAmount)
  let pid = -1
  try {
    const stake = await ctx.contract.getUserStake(user, stakeId)
    pid = Number(stake[1])
    // console.log("get pid from view function ", pid)
  }
  catch (e) {
    console.log(e.message, "Get pid failure, tx ", hash)
  }

  ctx.meter.Counter(`withdraw_counter`).add(amount,
    {
      pid: pid
    }
  )

  ctx.eventLogger.emit("Withdraw", {
    distinctId: user,
    pid: pid,
    amount
  })
}

const WithdrawEarlyEventHandler = async (event: WithdrawEarlyEvent, ctx: FountainContext) => {
  const user = event.args.user
  const amount = Number(event.args.amount) / Math.pow(10, 18)
  const stakeId = Number(event.args.stakeId)
  // const hash = event.transactionHash
  // console.log(`WithdrawEarly tx ${hash}`)

  ctx.meter.Counter(`withdraw_early_counter`).add(amount)

  ctx.eventLogger.emit("WithdrawEarly", {
    distinctId: user,
    stakeId,
    amount
  })
}

const ClaimVaultPenaltyEventHandler = async (event: ClaimVaultPenaltyEvent, ctx: FountainContext) => {
  const user = event.args.user
  const pendingVaultPenaltyReward = Number(event.args.pendingVaultPenaltyReward) / Math.pow(10, 18)

  ctx.meter.Counter(`penalty_claimed_counter`).add(pendingVaultPenaltyReward)

  ctx.eventLogger.emit("ClaimVaultPenalty", {
    distinctId: user,
    pendingVaultPenaltyReward
  })
}

const StakeEventHandler = async (event: StakeEvent, ctx: LiquidCroContext) => {
  const receiver = event.args.receiver
  const croAmount = Number(event.args.croAmount) / Math.pow(10, 18)
  const shareAmount = Number(event.args.shareAmount) / Math.pow(10, 18)
  ctx.meter.Counter(`lcro_staked_counter`).add(croAmount)

  ctx.eventLogger.emit("StakeLcro", {
    distinctId: receiver,
    croAmount,
    shareAmount
  })
}

const RequestUnbondEventHandler = async (event: RequestUnbondEvent, ctx: LiquidCroContext) => {
  const receiver = event.args.receiver
  const tokenId = Number(event.args.tokenId)
  const shareAmount = Number(event.args.shareAmount) / Math.pow(10, 18)
  const liquidCro2CroExchangeRate = Number(event.args.liquidCro2CroExchangeRate)
  const batchNo = Number(event.args.batchNo)
  try {
    const EXCHANGE_RATE_PRECISION = Number(await ctx.contract.EXCHANGE_RATE_PRECISION())
    const lcro_unstaked = shareAmount * liquidCro2CroExchangeRate / EXCHANGE_RATE_PRECISION

    ctx.meter.Counter(`lcro_unstaked_counter`).add(lcro_unstaked)

    ctx.eventLogger.emit("RequestUnbond", {
      distinctId: receiver,
      tokenId,
      shareAmount,
      liquidCro2CroExchangeRate,
      batchNo,
      EXCHANGE_RATE_PRECISION,
      lcro_unstaked
    })
  }
  catch (e) {
    console.log(e.message, "get EXCHANGE_RATE_PRECISION issue at ", ctx.transactionHash)
  }
}

const UnbondEventHandler = async (event: UnbondEvent, ctx: LiquidCroContext) => {
  const receiver = event.args.receiver
  const tokenId = Number(event.args.tokenId)
  const croAmount = Number(event.args.croAmount) / Math.pow(10, 18)
  const croFeeAmount = Number(event.args.croFeeAmount) / Math.pow(10, 18)
  ctx.meter.Counter(`lcro_claimed`).add(croAmount)
  ctx.meter.Counter(`lcro_withdrawal_fees`).add(croFeeAmount)


  ctx.eventLogger.emit("Unbond", {
    distinctId: receiver,
    tokenId,
    croAmount,
    croFeeAmount
  })
}
const AccrueRewardEventHandler = async (event: AccrueRewardEvent, ctx: LiquidCroContext) => {
  const amount = Number(event.args.amount) / Math.pow(10, 18)
  const txnHash = event.args.txnHash
  ctx.meter.Counter(`accrueReward_counter`).add(amount)
  ctx.eventLogger.emit("AccrueReward", {
    amount,
    txnHash
  })
}



FountainProcessor.bind({ address: '0xb4be51216f4926ab09ddf4e64bc20f499fd6ca95', network: EthChainId.CRONOS })
  .onEventDeposit(DepositEventHandler)
  .onEventWithdraw(WithdrawEventHandler)
  .onEventWithdrawEarly(WithdrawEarlyEventHandler)
  .onEventClaimVaultPenalty(ClaimVaultPenaltyEventHandler)


ReservoirProcessor.bind({ address: '0x21179329c1dcfd36ffe0862cca2c7e85538cca07', network: EthChainId.CRONOS })
  .onEventDeposit(DepositEventHandler)
  .onEventWithdraw(WithdrawEventHandler)

VenostormProcessor.bind({ address: '0x579206e4e49581ca8ada619e9e42641f61a84ac3', network: EthChainId.CRONOS })
  .onEventDeposit(DepositEventHandler)
  .onEventWithdraw(VenostormWithdrawEventHandler)

LiquidCroProcessor.bind({ address: '0x9fae23a2700feecd5b93e43fdbc03c76aa7c08a6', network: EthChainId.CRONOS })
  .onEventStake(StakeEventHandler)
  .onEventRequestUnbond(RequestUnbondEventHandler)
  .onEventUnbond(UnbondEventHandler)
  .onEventAccrueReward(AccrueRewardEventHandler)


