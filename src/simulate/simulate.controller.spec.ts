import { Test, TestingModule } from '@nestjs/testing';
import { SimulateController } from './simulate.controller';

describe('SimulateController', () => {
  let controller: SimulateController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SimulateController],
    }).compile();

    controller = module.get<SimulateController>(SimulateController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
