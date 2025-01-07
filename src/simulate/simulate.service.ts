import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common'
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
            this.logger.log(`request received to simulate ${args.swapType} transactions`)
            const simulatedResultToSave = {}
            const supportedChains = (await axios.get(`${process.env.PONDER_BASE_URL}/bridge/swap/chains`))?.data?.data
            let fromTokens = undefined
            const routPromises = []
            const promisesToSimulate = []
            for (let index = 0; index < supportedChains.length; index++) {
                const fromChainId = supportedChains[index].id
                let toChainId = fromChainId
                if (!fromTokens || args.swapType === SWAP_TYPE_ENUM.ON_CHAIN)
                    fromTokens = (await axios.get(`${process.env.PONDER_BASE_URL}/bridge/swap/tokens?chainId=${fromChainId}${args.walletAddr ? `&address=${args.walletAddr}` : ''}`))?.data?.data?.slice(0, 10)
                if (!fromTokens?.length) continue
                // for same chain swapping
                let toTokens = undefined

                // for cross chain swapping
                if (args.swapType === SWAP_TYPE_ENUM.CROSS_CHAIN) {
                    toChainId = supportedChains[(index + 1) % supportedChains.length].id
                    toTokens = (await axios.get(`${process.env.PONDER_BASE_URL}/bridge/swap/tokens?chainId=${toChainId}`))?.data?.data?.slice(0, 10)
                    if (!toTokens?.length) continue
                }
                this.logger.log(`${args.swapType} swapping is started from chain ${fromChainId} to chain ${toChainId}`)
                // const promisesToSimulate = []
                const promises = fromTokens.map(async (fromToken, index) => {
                    const payload = {
                        fromChain: fromChainId,
                        toChain: toChainId,
                        fromToken: [fromToken.address],
                        toToken: fromChainId === toChainId ? [fromTokens[(index + 1) % fromTokens.length].address] : [toTokens[index % toTokens.length].address],
                        fromAmount: [fromToken.balance]?.length > 2 ?
                            [fromToken.balance] : // 50% of the total amount
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
                                const routPromises = route.data.map(async data => {
                                    if (data?.approvalTx?.length) {
                                        simulatedResultToSave[quote.routeId + 'approvalTx'] = await this.txSimulation(data.approvalTx[0])
                                    }
                                    if (data.executionTx) {
                                        simulatedResultToSave[quote.routeId + 'executionTx'] = await this.txSimulation(data.executionTx)
                                    }
                                })
                                promisesToSimulate.push(...routPromises)
                            }
                        }
                    }
                })
                routPromises.push(...promises)

                if (args.swapType === SWAP_TYPE_ENUM.CROSS_CHAIN) {
                    fromTokens = toTokens
                }
            }
            this.logger.log(`Wait for all route-related promises to settle`)
            await Promise.allSettled(routPromises)
            this.logger.log(`Wait for all simulation-related promises to settle`)
            await Promise.allSettled(promisesToSimulate)
            this.saveJsonAsCsv(simulatedResultToSave, 'simulated_txs.csv')
            return { message: 'Success', simulatedResultToSave, status: 200 }

        } catch (error) {
            throw new InternalServerErrorException(error)
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

    saveJsonAsCsv(jsonData: any, filePath: string) {
        try {
            const directory = path.dirname(filePath);
            // Check if directory exists, if not, create it
            if (!fs.existsSync(directory)) {
                fs.mkdirSync(directory, { recursive: true });
            }
            const csv = parse(jsonData);
            fs.writeFileSync(filePath, csv);
            console.log('CSV file saved successfully.');
        } catch (error) {
            console.error('Error converting to CSV:', error);
            throw new Error('Failed to save CSV file.');
        }
    }
}
