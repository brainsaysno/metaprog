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
  console.log('Retrying', fn.toString());
  console.log('Retries', retries);
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

export type Narrow<T> = {
  [K in keyof T]: K extends keyof []
    ? T[K]
    : T[K] extends (...args: any[]) => unknown
      ? T[K]
      : Narrow<T[K]>;
};
