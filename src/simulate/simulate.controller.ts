import { Controller, Get, Query } from '@nestjs/common';
import { SimulateService } from './simulate.service';
import { SimulationTxsDTO } from './dtos/simulation.dto';

@Controller('simulate')
export class SimulateController {
    constructor(
        private readonly simulateService: SimulateService
    ) { }

    @Get('/txs')
    async simulateTxs(@Query() args: SimulationTxsDTO) {
        return await this.simulateService.simulateTxs(args)
    }
}
