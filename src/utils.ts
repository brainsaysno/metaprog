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
