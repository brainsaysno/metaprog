import { ChatAnthropic } from '@langchain/anthropic';
import {
  DEFAULT_CACHE_PATH,
  DEFAULT_GENERATED_PATH,
  MetaprogFunction,
} from './metaprog.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import dotenv from 'dotenv';
import { ChatMessageChunk } from '@langchain/core/messages';

dotenv.config();

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  apiKey: 'invalid_api_key_that_shouldnt_be_used',
});

afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(DEFAULT_CACHE_PATH, { force: true });
  fs.rmSync(DEFAULT_GENERATED_PATH, { recursive: true, force: true });
});

describe('function generation', () => {
  it('should generate a hello world', async () => {
    vi.spyOn(model, 'invoke').mockResolvedValue(
      new ChatMessageChunk({
        content: `export default function helloWorld() { console.log('Hello world!'); }`,
        role: 'assistant',
      }),
    );

    const func = await new MetaprogFunction('Console log "Hello world!"', {
      model,
    }).build();

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

    const func = await new MetaprogFunction('Multiply two numbers', {
      model,
    }).build();

    expect(func).toBeDefined();

    expect(func(1, 2)).toBe(2);
    expect(func(2, 3)).toBe(6);
    expect(func(3, 4)).toBe(12);
  });

  it('should cache a generated function', async () => {
    const spy = vi.spyOn(model, 'invoke').mockResolvedValue(
      new ChatMessageChunk({
        content: `export default function helloWorld() { console.log('Hello world!'); }`,
        role: 'assistant',
      }),
    );

    const func = new MetaprogFunction('Multiply two numbers', { model });

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

    const result = await new MetaprogFunction(
      'Divide two numbers that throws a custom error for division by zero',
      { model },
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

    const func = new MetaprogFunction('Add two numbers', {
      model,
    });

    await func.test(['1', '2'], 3);
  });
});
