export async function retry<T, U>(
  fn: () => Promise<T>,
  {
    beforeRetry,
    retries = 3,
  }: {
    beforeRetry?: (error?: Error) => U;
    retries?: number;
  } = {},
): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries > 1) {
      await beforeRetry?.(error as Error);
      return retry(fn, {
        beforeRetry,
        retries: retries - 1,
      });
    }
    throw error;
  }
}
