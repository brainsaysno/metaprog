export async function retry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (retries > 1) {
      return retry(fn, retries - 1);
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
