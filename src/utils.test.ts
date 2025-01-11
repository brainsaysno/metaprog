import { describe, it, expect, vi } from 'vitest';
import { retry } from './utils.js';

describe('retry', () => {
  it('should return the result if successful on first try', async () => {
    const mockFn = vi.fn().mockResolvedValue('success');

    const result = await retry(mockFn);

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(1);
  });

  it('should retry on failure and succeed eventually', async () => {
    const mockFn = vi
      .fn()
      .mockRejectedValueOnce(new Error('fail'))
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValue('success');

    const result = await retry(mockFn, { retries: 3 });

    expect(result).toBe('success');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should throw error if all retries are exhausted', async () => {
    const error = new Error('test error');
    const mockFn = vi.fn().mockRejectedValue(error);

    await expect(retry(mockFn, { retries: 3 })).rejects.toThrow(error);
    expect(mockFn).toHaveBeenCalledTimes(3);
  });

  it('should use default of 3 retries when retries parameter is not provided', async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error('fail'));

    await expect(retry(mockFn)).rejects.toThrow('fail');
    expect(mockFn).toHaveBeenCalledTimes(3);
  });
});
