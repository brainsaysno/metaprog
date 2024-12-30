import { ChatAnthropic } from '@langchain/anthropic';
import { CACHE_PATH, GENERATED_PATH, MetaprogFunction } from './metaprog.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import dotenv from 'dotenv';

dotenv.config();

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  apiKey: process.env.ANTHROPIC_API_KEY,
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(CACHE_PATH, { force: true });
  fs.rmSync(GENERATED_PATH, { recursive: true, force: true });
});

describe('function generation', () => {
  it('should generate a hello world', async () => {
    const result = await new MetaprogFunction('Console log "Hello world!"', {
      model,
    }).build();

    const spy = vi.spyOn(console, 'log');

    expect(result).toBeDefined();

    expect(result()).toBeUndefined();
    expect(spy).toHaveBeenCalledWith('Hello world!');
  });

  it('should generate a function with a return type', async () => {
    const result = await new MetaprogFunction('Multiply two numbers', {
      model,
    }).build();

    expect(result).toBeDefined();

    expect(result(1, 2)).toBe(2);
    expect(result(2, 3)).toBe(6);
    expect(result(3, 4)).toBe(12);
  });

  it('should cache a generated function', async () => {
    const spy = vi.spyOn(model, 'invoke');
    const func = new MetaprogFunction('Multiply two numbers', { model });

    await func.build();
    await func.build();
    await func.build();
    await func.build();
    await func.build();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should generate a function with complex logic', async () => {
    const result = await new MetaprogFunction(
      'Sort an array of numbers in descending order',
      { model },
    ).build();

    expect(result).toBeDefined();

    expect(result([1, 2, 3])).toEqual([3, 2, 1]);
    expect(result([5, 2, 8, 1, 9])).toEqual([9, 8, 5, 2, 1]);
    expect(result([])).toEqual([]);
  });

  it('should handle string manipulation', async () => {
    const result = await new MetaprogFunction(
      'Reverse a string and make it uppercase',
      { model },
    ).build();

    expect(result).toBeDefined();

    expect(result('hello')).toBe('OLLEH');
    expect(result('TypeScript')).toBe('TPIRCSEPYT');
    expect(result('')).toBe('');
  });

  it('should generate a function with error handling', async () => {
    const result = await new MetaprogFunction(
      'Divide two numbers that throws a custom error for division by zero',
      { model },
    ).build();

    expect(result).toBeDefined();

    expect(result(10, 2)).toBe(5);
    expect(() => result(5, 0)).toThrow();
  });

  it('should allow tests', async () => {
    const func = new MetaprogFunction('Add two numbers', {
      model,
    });

    await func.build();

    console.log(await func.fetchCode());

    await func.test(['1', '2'], 3);

    console.log(await func.fetchCode());
  });
});
