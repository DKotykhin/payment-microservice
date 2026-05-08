import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { MessageBrokerService } from 'src/message-broker/message-broker.service';
import { HealthCheckService } from '../health-check.service';

describe('HealthCheckService', () => {
  let service: HealthCheckService;
  let dataSource: jest.Mocked<Pick<DataSource, 'query'>>;
  let messageBroker: jest.Mocked<MessageBrokerService>;

  beforeEach(async () => {
    jest.useFakeTimers();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthCheckService,
        {
          provide: getDataSourceToken(),
          useValue: { query: jest.fn() },
        },
        {
          provide: MessageBrokerService,
          useValue: { checkConnection: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<HealthCheckService>(HealthCheckService);
    dataSource = module.get(getDataSourceToken());
    messageBroker = module.get(MessageBrokerService);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('checkAppConnections', () => {
    it('should return serving true when all dependencies are healthy', async () => {
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      messageBroker.checkConnection.mockResolvedValue(undefined);

      const resultPromise = service.checkAppConnections();
      jest.advanceTimersByTime(3000);
      const result = await resultPromise;

      expect(result.serving).toBe(true);
      expect(result.message).toBe('All dependencies are healthy');
      expect(result.dependencies).toHaveLength(2);
      expect(result.dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'postgres', healthy: true }),
          expect.objectContaining({ name: 'rabbitmq', healthy: true }),
        ]),
      );
    });

    it('should return serving false when postgres is unhealthy', async () => {
      dataSource.query.mockRejectedValue(new Error('connection refused'));
      messageBroker.checkConnection.mockResolvedValue(undefined);

      const resultPromise = service.checkAppConnections();
      jest.advanceTimersByTime(3000);
      const result = await resultPromise;

      expect(result.serving).toBe(false);
      expect(result.message).toBe('One or more dependencies are unhealthy');
      expect(result.dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'postgres', healthy: false, message: 'connection refused' }),
          expect.objectContaining({ name: 'rabbitmq', healthy: true }),
        ]),
      );
    });

    it('should return serving false when rabbitmq is unhealthy', async () => {
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      messageBroker.checkConnection.mockRejectedValue(new Error('channel closed'));

      const resultPromise = service.checkAppConnections();
      jest.advanceTimersByTime(3000);
      const result = await resultPromise;

      expect(result.serving).toBe(false);
      expect(result.message).toBe('One or more dependencies are unhealthy');
      expect(result.dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'postgres', healthy: true }),
          expect.objectContaining({ name: 'rabbitmq', healthy: false, message: 'channel closed' }),
        ]),
      );
    });

    it('should return serving false when all dependencies are unhealthy', async () => {
      dataSource.query.mockRejectedValue(new Error('pg error'));
      messageBroker.checkConnection.mockRejectedValue(new Error('rabbitmq error'));

      const resultPromise = service.checkAppConnections();
      jest.advanceTimersByTime(3000);
      const result = await resultPromise;

      expect(result.serving).toBe(false);
      expect(result.message).toBe('One or more dependencies are unhealthy');
      expect(result.dependencies.every((dep) => !dep.healthy)).toBe(true);
    });

    it('should include latencyMs for each dependency', async () => {
      dataSource.query.mockResolvedValue([{ '?column?': 1 }]);
      messageBroker.checkConnection.mockResolvedValue(undefined);

      const resultPromise = service.checkAppConnections();
      jest.advanceTimersByTime(3000);
      const result = await resultPromise;

      for (const dep of result.dependencies) {
        expect(typeof dep.latencyMs).toBe('number');
        expect(dep.latencyMs).toBeGreaterThanOrEqual(0);
      }
    });

    it('should handle non-Error rejection values', async () => {
      dataSource.query.mockRejectedValue('string error');
      messageBroker.checkConnection.mockResolvedValue(undefined);

      const resultPromise = service.checkAppConnections();
      jest.advanceTimersByTime(3000);
      const result = await resultPromise;

      expect(result.serving).toBe(false);
      expect(result.dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ name: 'postgres', healthy: false, message: 'string error' }),
        ]),
      );
    });

    it('should return unhealthy when a dependency times out', async () => {
      dataSource.query.mockReturnValue(new Promise<never>(() => {}));
      messageBroker.checkConnection.mockResolvedValue(undefined);

      const resultPromise = service.checkAppConnections();
      jest.advanceTimersByTime(3000);
      const result = await resultPromise;

      expect(result.serving).toBe(false);
      expect(result.dependencies).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'postgres',
            healthy: false,
            message: 'postgres health check timed out',
          }),
        ]),
      );
    });
  });
});
