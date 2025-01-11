import { ChatAnthropic } from '@langchain/anthropic';
import {
  DEFAULT_CACHE_PATH,
  DEFAULT_GENERATED_PATH,
  MetaprogFunctionBuilder,
} from './metaprog.js';
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { ChatMessageChunk } from '@langchain/core/messages';
import { z } from 'zod';
import { FileSystemCacheHandler } from './cache.js';

const cacheHandler = new FileSystemCacheHandler(
  DEFAULT_CACHE_PATH,
  DEFAULT_GENERATED_PATH,
);

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  apiKey: 'invalid_api_key_that_shouldnt_be_used',
});

afterEach(async () => {
  vi.restoreAllMocks();
  await cacheHandler.clearCache();
});

describe('MetapprogFunctionBuilder', () => {
  it('should generate a hello world', async () => {
    vi.spyOn(model, 'invoke').mockResolvedValue(
      new ChatMessageChunk({
        content: `export default function helloWorld() { console.log('Hello world!'); }`,
        role: 'assistant',
      }),
    );

    const func = await new MetaprogFunctionBuilder(
      'Console log "Hello world!"',
      {
        model,
        cacheHandler,
      },
    ).build();

    const spy = vi.spyOn(console, 'log');

    expect(func).toBeDefined();

    expect(func()).toBeUndefined();
    expect(spy).toHaveBeenCalledWith('Hello world!');
  });

  it('should generate a function with a return type', async () => {
    vi.spyOn(model, 'invoke').mockResolvedValue(
      new ChatMessageChunk({
        content: `export default function multiply(a: number, b: number): number { return a * b; }`,
        role: 'assistant',
      }),
    );

    const func = await new MetaprogFunctionBuilder('Multiply two numbers', {
      model,
      cacheHandler,
    }).build();

    expect(func).toBeDefined();

    expect(func(1, 2)).toBe(2);
    expect(func(2, 3)).toBe(6);
    expect(func(3, 4)).toBe(12);
  });

  it('should cache a generated function', async () => {
    const spy = vi.spyOn(model, 'invoke').mockResolvedValue(
      new ChatMessageChunk({
        content: `export default function multiply(a: number, b: number): number { return a * b; }`,
        role: 'assistant',
      }),
    );

    const func = new MetaprogFunctionBuilder('Multiply two numbers', {
      model,
      cacheHandler,
    });

    await func.build();
    await func.build();
    await func.build();
    await func.build();
    await func.build();

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('should pass errors to the caller', async () => {
    vi.spyOn(model, 'invoke').mockResolvedValue(
      new ChatMessageChunk({
        content: `export default function divide(a: number, b: number): number { if (b === 0) throw new Error('Division by zero'); return a / b; }`,
        role: 'assistant',
      }),
    );

    const result = await new MetaprogFunctionBuilder(
      'Divide two numbers that throws a custom error for division by zero',
      { model, cacheHandler },
    ).build();

    expect(result).toBeDefined();

    expect(result(10, 2)).toBe(5);
    expect(() => result(5, 0)).toThrow();
  });

  it('should allow tests', async () => {
    vi.spyOn(model, 'invoke')
      .mockResolvedValueOnce(
        new ChatMessageChunk({
          content: `export default function add(a: number, b: number): number { return a + b; }`,
          role: 'assistant',
        }),
      )
      .mockResolvedValueOnce(
        new ChatMessageChunk({
          content: `export default function add(a: number, b: number): number { return a + b; }`,
          role: 'assistant',
        }),
      )
      .mockResolvedValueOnce(
        new ChatMessageChunk({
          content: `export default function add(a: number, b: number): number { return Number(a) + Number(b); }`,
          role: 'assistant',
        }),
      );

    const func = await new MetaprogFunctionBuilder('Add two numbers', {
      model,
      cacheHandler,
    })
      .test((f) => f('1', '2') === 3)
      .test((f) => f('2', '3') === 5)
      .build();

    expect(func).toBeDefined();

    expect(func(1, 2)).toBe(3);
    expect(func(2, 3)).toBe(5);
  });

  it('should allow input schema for single input', async () => {
    const inputSchema = [
      z.object({
        a: z.number(),
        b: z.number(),
      }),
    ];

    vi.spyOn(model, 'invoke').mockResolvedValue(
      new ChatMessageChunk({
        content: `export default function add({a, b}: {a: number, b: number}): number { return a + b; }`,
        role: 'assistant',
      }),
    );

    const func = await new MetaprogFunctionBuilder('Add two numbers', {
      model,
      inputSchema,
      cacheHandler,
    }).build();

    expectTypeOf(func).toBeFunction();
    expectTypeOf(func).parameter(0).toEqualTypeOf<{
      a: number;
      b: number;
    }>();
  });

  it('should allow input schema for multiple inputs', async () => {
    const inputSchema = [
      z.object({
        a: z.number(),
        b: z.number(),
      }),
      z.object({
        c: z.number(),
        d: z.number(),
      }),
    ] as const;

    vi.spyOn(model, 'invoke').mockResolvedValue(
      new ChatMessageChunk({
        content: `export default function add({a, b}: {a: number, b: number}, {c, d}: {c: number, d: number}): number { return a + b + c + d; }`,
        role: 'assistant',
      }),
    );

    const func = await new MetaprogFunctionBuilder('Add four numbers', {
      model,
      inputSchema,
      cacheHandler,
    }).build();

    expectTypeOf(func).toBeFunction();
    expectTypeOf(func).parameter(0).toEqualTypeOf<{
      a: number;
      b: number;
    }>();
    expectTypeOf(func).parameter(1).toEqualTypeOf<{
      c: number;
      d: number;
    }>();
  });
});
