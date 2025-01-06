import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { SimulateModule } from './simulate/simulate.module';
import * as dotenv from 'dotenv'
import { ConfigModule } from '@nestjs/config'
import { ScheduleModule } from '@nestjs/schedule';
dotenv.config()

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: `config/${process.env.NODE_ENV}.env` }),
    ScheduleModule.forRoot(),
    SimulateModule
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
