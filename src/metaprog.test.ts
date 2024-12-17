import { ChatAnthropic } from '@langchain/anthropic';
import Metaprog, { CACHE_PATH, GENERATED_PATH } from './metaprog.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  apiKey:
    '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',
});

const metaprog = new Metaprog({ model });

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(CACHE_PATH, { force: true });
  fs.rmSync(GENERATED_PATH, { recursive: true, force: true });
});

describe('demand', () => {
  it('should generate a hello world', async () => {
    const result = await metaprog.demand('Console log "Hello world!":');

    const spy = vi.spyOn(console, 'log');

    expect(result).toBeDefined();

    expect(result()).toBeUndefined();
    expect(spy).toHaveBeenCalledWith('Hello world!');
  });

  it('should generate a function with a return type', async () => {
    const result = await metaprog.demand('Multiply two numbers');

    expect(result).toBeDefined();

    expect(result(1, 2)).toBe(2);
    expect(result(2, 3)).toBe(6);
    expect(result(3, 4)).toBe(12);
  });

  it('should cache a generated function', async () => {
    const spy = vi.spyOn(model, 'invoke');

    await metaprog.demand('Multiply two numbers');

    await metaprog.demand('Multiply two numbers');

    await metaprog.demand('Multiply two numbers');

    await metaprog.demand('Multiply two numbers');

    await metaprog.demand('Multiply two numbers');

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should generate a function with complex logic', async () => {
    const result = await metaprog.demand(
      'Sort an array of numbers in descending order',
    );

    expect(result).toBeDefined();

    expect(result([1, 2, 3])).toEqual([3, 2, 1]);
    expect(result([5, 2, 8, 1, 9])).toEqual([9, 8, 5, 2, 1]);
    expect(result([])).toEqual([]);
  });

  it('should handle string manipulation', async () => {
    const result = await metaprog.demand(
      'Reverse a string and make it uppercase',
    );

    expect(result).toBeDefined();

    expect(result('hello')).toBe('OLLEH');
    expect(result('TypeScript')).toBe('TPIRCSEPYT');
    expect(result('')).toBe('');
  });

  it('should generate a function with error handling', async () => {
    const result = await metaprog.demand(
      'Divide two numbers that throws a custom error for division by zero',
    );

    expect(result).toBeDefined();

    expect(result(10, 2)).toBe(5);
    expect(() => result(5, 0)).toThrow();
  });
});
