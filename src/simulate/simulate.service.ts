import { Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common'
import axios from 'axios'
import { SimulationTxsDTO } from './dtos/simulation.dto'
import { SWAP_TYPE_ENUM } from 'utills/enums/swap_enum'
import *as fs from 'fs';
import { parse } from 'json2csv';
import * as path from 'path';
import * as csvParser from 'csv-parser';
import BigNumber from 'bignumber.js'

@Injectable()
export class SimulateService {
    private readonly logger = new Logger(SimulateService.name)

    constructor() { }

    async simulateTxs(args: SimulationTxsDTO) {
        try {
            this.logger.log(`request received to simulate the swap transactions`)
            const supportedChains = (await axios.get(`${process.env.PONDER_BASE_URL}/bridge/swap/chains`))?.data?.data
            let fromChainId = undefined
            let toChainId = undefined
            if (args.fromChainId || args.toChainId) {
                const supportedChainsMap: Map<number, any> = new Map(supportedChains.map(chain => [+chain.id, chain]))
                if (args.fromChainId) {
                    fromChainId = supportedChainsMap.get(args.fromChainId)?.id
                    if (!fromChainId)
                        throw new NotFoundException(`Invalid chain id ${args.fromChainId}`)
                }
                if (args.toChainId) {
                    toChainId = supportedChainsMap.get(args.toChainId)?.id
                    if (!toChainId)
                        throw new NotFoundException(`Invalid chain id ${args.toChainId}`)
                }
            }

            let fromTokens = undefined
            let toTokens = undefined
            const routPromises = []
            const txsToSimulate = []
            for (let index = 0; index < supportedChains.length; index++) {
                fromChainId = args.fromChainId?.toString() || supportedChains[index].id
                toChainId = args.toChainId?.toString() || args.swapType === SWAP_TYPE_ENUM.ON_CHAIN ? fromChainId : supportedChains[(index + 1) % supportedChains.length].id
                if (fromChainId === toChainId && args.swapType === SWAP_TYPE_ENUM.CROSS_CHAIN) continue
                if (fromChainId !== toChainId && args.swapType === SWAP_TYPE_ENUM.ON_CHAIN) continue
                if (!fromTokens || !args.fromChainId)
                    fromTokens = (await axios.get(`${process.env.PONDER_BASE_URL}/bridge/swap/tokens?chainId=${fromChainId}${args.walletAddr ? `&address=${args.walletAddr}` : ''}`))?.data?.data
                if (!fromTokens?.length) continue
                if (!args.fromTokens?.length) {
                    fromTokens = fromTokens.slice(0, 10)
                }
                // for cross chain swapping
                if ((args.swapType === SWAP_TYPE_ENUM.CROSS_CHAIN && !toTokens?.length) || (args.fromChainId && !args.toChainId)) {
                    toTokens = (await axios.get(`${process.env.PONDER_BASE_URL}/bridge/swap/tokens?chainId=${toChainId}`))?.data?.data?.slice(0, 10)
                    if (!toTokens?.length) continue
                }
                if (!args.toTokens?.length && toTokens?.length) {
                    toTokens = toTokens.slice(0, 10)
                }
                this.logger.log(`${args.swapType} swapping is started from chain ${fromChainId} to chain ${toChainId}`)
                const promises = fromTokens.map(async (fromToken, index) => {
                    const toTokenAddress = fromChainId === toChainId ? fromTokens[(index + 1) % fromTokens.length].address : toTokens[index % toTokens.length].address
                    if (args.fromTokens?.length && !args.fromTokens.includes(fromToken.address)) return
                    if (args.toTokens?.length && !args.toTokens.includes(toTokenAddress)) return
                    const payload = {
                        fromChain: fromChainId,
                        toChain: toChainId,
                        fromToken: [fromToken.address],
                        toToken: [toTokenAddress],
                        fromAmount: [fromToken.balance]?.length > 2 ?
                            [fromToken.balance] :
                            [new BigNumber(10).multipliedBy(new BigNumber(10).pow(fromToken.decimals)).toString(10)], //default $10,
                        fromAddress: args.walletAddr || '0xcd567c7F896cD2D80D51A496f3aAC9a817ED13A9',
                    }

                    this.logger.log(`${index} ${args.swapType} swapping is started from token ${payload.fromToken} to token ${payload.toToken}`)
                    const quotes = (await axios.post(`${process.env.PONDER_BASE_URL}/bridge/swap/quote`, payload)).data
                    if (quotes?.data?.routes?.length) {
                        let quote = undefined
                        if (args.protocol) {
                            quote = quotes.data.routes.find(quote =>
                                quote.protocol.toUpperCase() === args.protocol.toUpperCase()
                            )
                        } else {
                            quote = quotes.data.routes[0]
                        }
                        if (quote) {
                            payload['routeId'] = quote.routeId
                            payload['provider'] = quote.protocol
                            const route = (await axios.post(`${process.env.PONDER_BASE_URL}/bridge/swap/route`, payload)).data
                            if (route?.data?.length) {
                                route.data.map(data => {
                                    if (data?.approvalTx?.length) {
                                        txsToSimulate.push(this.formateTxSimulatationPayload(data.approvalTx[0]))
                                    }
                                    if (data.executionTx) {
                                        txsToSimulate.push(this.formateTxSimulatationPayload(data.executionTx))
                                    }
                                })
                            }
                        }
                    }
                })
                this.logger.log(`Waiting for promises to resolve for routes from chain ${fromChainId} to chain ${toChainId}`)
                await Promise.allSettled(promises)
                routPromises.push(...promises)
                if (args.swapType === SWAP_TYPE_ENUM.CROSS_CHAIN && !args.fromChainId) {
                    fromTokens = toTokens
                }
                if (args.fromChainId && args.toChainId) break
                if ((args.fromChainId || args.toChainId) && args.swapType === SWAP_TYPE_ENUM.ON_CHAIN) break
            }
            this.logger.log(`Wait for all route-related promises to resolve`)
            await Promise.allSettled(routPromises)
            let simulatedResultToSave = []
            if (txsToSimulate.length) {
                this.logger.log(`Wait for all simulation-related promises to resolve`)
                simulatedResultToSave = await this.simulateInBulk(txsToSimulate)
                if (simulatedResultToSave?.length)
                    this.saveJsonAsCsv(simulatedResultToSave, 'simulated_txs.csv')
            }
            return { message: 'Success', simulatedResultToSave, status: 200 }

        } catch (error) {
            throw new InternalServerErrorException(error?.response || error)
        }
    }

    async txSimulation(txDetail: any) {
        try {
            const simulateTx = await axios.post(process.env.TENDERLY_SIMULATE_TX_URL, {
                network_id: txDetail.chainId,
                //   block_number: 16533883,
                from: txDetail.from,
                to: txDetail.to,
                //   gas: 8000000,
                //   gas_price: 0,
                //   value: 0,
                input: txDetail.data,
                simulation_type: "quick"
            }, {
                headers: {
                    'X-Access-Key': process.env.TENDERLY_ACCESS_KEY
                }
            })
            return simulateTx.data
        } catch (error) {
            this.logger.log(`Error occured to simulate the tx: ${JSON.stringify(txDetail)} Error ${JSON.stringify(error)}`)
        }
    }

    private formateTxSimulatationPayload(txDetail: any) {
        try {
            return {
                network_id: txDetail.chainId,
                from: txDetail.from,
                to: txDetail.to,
                input: txDetail.data,
                simulation_type: "quick"
            }
        } catch (error) {
            this.logger.log(`Error occured to formate the simulation tx payload`)
        }
    }

    saveJsonAsCsv(jsonData: any, filePath: string) {
        try {
            const directory = path.dirname(filePath)
            // Check if directory exists, if not, create it
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true })
            }
            const csv = parse(jsonData)
            fs.writeFileSync(filePath, csv)
            console.log('CSV file saved successfully.')
        } catch (error) {
            console.error('Error converting to CSV:', error)
            throw new Error('Failed to save CSV file.')
        }
    }

    private async simulateInBulk(batchSimulationTxs: any[]) {
        try {
            return (
                await axios.post(
                    process.env.TENDERLY_BUNDLE_SIMULATE_TX_URL,
                    // the transaction
                    {
                        simulations: batchSimulationTxs
                    },
                    {
                        headers: {
                            'X-Access-Key': process.env.TENDERLY_ACCESS_KEY,
                        },
                    },
                )
            )?.data

        } catch (error) {
            console.error('Error to simulate txs:', error);
            throw new Error('Failed to simulate the txs');
        }
    }
}
