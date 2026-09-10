/**
 * Unit tests for the alert service.
 *
 * Tests the threshold-crossing detection logic:
 * - Crossing 80% from below triggers an alert
 * - Crossing 100% from below triggers an alert
 * - Usage already above threshold does NOT re-trigger
 * - Zero limit is handled safely (no division by zero)
 */

jest.mock('../src/repositories/alertRepo');

const alertRepo = require('../src/repositories/alertRepo');
const alertService = require('../src/services/alertService');

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(); });
afterAll(() => { console.log.mockRestore(); });
afterEach(() => jest.clearAllMocks());

describe('AlertService', () => {
  describe('checkAndTriggerAlerts', () => {
    test('triggers 80% alert when crossing the threshold', async () => {
      alertRepo.insertAlert.mockResolvedValue(true);

      // currentUsage = 750, requestedQuantity = 100 → newUsage = 850
      // previousPct = 75%, newPct = 85% → crosses 80%
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 750, 1000, 100);

      expect(alertRepo.insertAlert).toHaveBeenCalledWith('t-1', 'api_call', 80);
    });

    test('triggers 100% alert when crossing the threshold', async () => {
      alertRepo.insertAlert.mockResolvedValue(true);

      // currentUsage = 950, requestedQuantity = 100 → newUsage = 1050
      // previousPct = 95%, newPct = 105% → crosses 100%
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 950, 1000, 100);

      expect(alertRepo.insertAlert).toHaveBeenCalledWith('t-1', 'api_call', 100);
    });

    test('does NOT trigger alert when already above 80%', async () => {
      // currentUsage = 850, requestedQuantity = 10 → both are above 80%
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 850, 1000, 10);

      expect(alertRepo.insertAlert).not.toHaveBeenCalled();
    });

    test('does NOT trigger alert when already above 100%', async () => {
      // currentUsage = 1050, requestedQuantity = 50 → both are above 100%
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 1050, 1000, 50);

      expect(alertRepo.insertAlert).not.toHaveBeenCalled();
    });

    test('does NOT trigger any alert when well below thresholds', async () => {
      // currentUsage = 100, requestedQuantity = 10 → 10% / 11%
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 100, 1000, 10);

      expect(alertRepo.insertAlert).not.toHaveBeenCalled();
    });

    test('handles zero limit gracefully (no division by zero)', async () => {
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 0, 0, 10);

      // Should return early, no alert inserted
      expect(alertRepo.insertAlert).not.toHaveBeenCalled();
    });

    test('handles crossing exactly to 80%', async () => {
      alertRepo.insertAlert.mockResolvedValue(true);

      // currentUsage = 790, requestedQuantity = 10 → newUsage = 800
      // previousPct = 79%, newPct = 80% → crosses 80%
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 790, 1000, 10);

      expect(alertRepo.insertAlert).toHaveBeenCalledWith('t-1', 'api_call', 80);
    });

    test('handles crossing exactly to 100%', async () => {
      alertRepo.insertAlert.mockResolvedValue(true);

      // currentUsage = 990, requestedQuantity = 10 → newUsage = 1000
      // previousPct = 99%, newPct = 100% → crosses 100%
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 990, 1000, 10);

      expect(alertRepo.insertAlert).toHaveBeenCalledWith('t-1', 'api_call', 100);
    });

    test('prefers 100% alert when single request crosses both 80% and 100%', async () => {
      alertRepo.insertAlert.mockResolvedValue(true);

      // currentUsage = 0, requestedQuantity = 1100 → newUsage = 1100
      // previousPct = 0%, newPct = 110% → crosses both 80% and 100%
      // The code checks 100% first, so only the 100% alert fires
      await alertService.checkAndTriggerAlerts('t-1', 'api_call', 0, 1000, 1100);

      expect(alertRepo.insertAlert).toHaveBeenCalledWith('t-1', 'api_call', 100);
      expect(alertRepo.insertAlert).toHaveBeenCalledTimes(1);
    });
  });
});
