import { Test, TestingModule } from '@nestjs/testing';
import { SimulateService } from './simulate.service';

describe('SimulateService', () => {
  let service: SimulateService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SimulateService],
    }).compile();

    service = module.get<SimulateService>(SimulateService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
