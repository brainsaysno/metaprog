import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import path from 'path';
import { z, type ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { retry } from './utils.js';

type MetaprogCache = {
  id: string;
  description: string;
}[];

const BASE_PATH = path.join(__dirname, 'metaprog');

export const GENERATED_PATH = path.join(BASE_PATH, 'generated');

export const CACHE_PATH = path.join(BASE_PATH, 'metaprog-cache.json');

type MetaprogFunctionConfig<
  TInputSchema extends ZodType[],
  TOutputSchema extends ZodType,
> = {
  model: BaseChatModel;
  arguments?: Narrow<TInputSchema>;
  return?: TOutputSchema;
};

type Narrow<T> = {
  [K in keyof T]: K extends keyof []
    ? T[K]
    : T[K] extends (...args: any[]) => unknown
      ? T[K]
      : Narrow<T[K]>;
};

export class MetaprogFunction<
  TInputSchema extends ZodType[],
  TOutputSchema extends ZodType,
> {
  constructor(
    private description: string,
    private config: MetaprogFunctionConfig<TInputSchema, TOutputSchema>,
  ) {}

  public async test(
    args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> },
    expected: z.infer<TOutputSchema>,
  ) {
    const builtFunction = await this.build();

    let actualResult: z.infer<TOutputSchema>;

    try {
      actualResult = builtFunction(...args);

      if (actualResult !== expected) {
        throw new Error('Function did not return the expected output');
      }
    } catch (error) {
      await retry(async () => {
        actualResult ??= error;
        console.error('Test failed, regenerating function...');

        const fixedFunction = await this.fixFunction(
          args,
          expected,
          actualResult,
        );

        const fixedResult = fixedFunction(...args);

        if (fixedResult !== expected) {
          throw new Error('Function failed to generate correctly after retry');
        }
      });
    }
  }

  public async build() {
    const cachedFunctionId = await this.checkCache(this.description);

    if (cachedFunctionId) {
      return this.loadFunction(cachedFunctionId);
    }

    const functionCode = await this.generateFunction();

    const createdFunctionId = await this.writeFunction(functionCode);

    const createdFunction = await this.loadFunction(createdFunctionId);

    return createdFunction;
  }

  private async loadExistingCache() {
    try {
      const cache = await fs.readFile(CACHE_PATH, 'utf-8');

      return JSON.parse(cache) as MetaprogCache;
    } catch (error) {
      return [];
    }
  }

  private async checkCache(functionDescription: string) {
    const cache = await this.loadExistingCache();

    return (
      cache.find((item) => item.description === functionDescription)?.id ?? null
    );
  }

  private async fixFunction(
    args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> },
    expectedResult: z.infer<TOutputSchema>,
    actualResult: z.infer<TOutputSchema>,
  ) {
    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `
        <context>
        You are a TypeScript debugging assistant. Your role is to analyze a function description and a failing test case to debug and improve the provided code. The function is wrong and doesn't work correctly so you must identify the bug and fix it. You may also be given:
        - A JSON schema for the function's arguments (separated by newlines).
        - A JSON schema for the return type, or you will be told it is undefined.

        You should modify the function as needed to ensure:
        1. The function passes the given test case.
        2. The function replicates the described behavior as closely as possible.

        Pay special attention to the arguments and return types and ensure the function is correct.
        </context>

        <requirements>
        - Produce a working TypeScript function that:
          - Passes the failing test case.
          - Adheres to the given JSON schemas (if provided).
          - Is exported as default.
        - Output only the corrected TypeScript code, ready to execute.
        </requirements>
      `,
      ],
      [
        'user',
        `
        <functionDescription>{functionDescription}</functionDescription>

        <existingFunctionCode>{existingFunctionCode}</existingFunctionCode>

        <arguments>
        {arguments}
        </arguments>

        <expectedResult>
        {expectedResult}
        </expectedResult>

        <actualResult>
        {actualResult}
        </actualResult>


        <argumentsSchema>
        {argumentsSchema}
        </argumentsSchema>

        <returnSchema>
        {returnSchema}
        </returnSchema>
        `,
      ],
    ]);

    const chain = prompt.pipe(this.config.model);

    const cache = await this.loadExistingCache();
    const functionCache = cache.find(
      (item) => item.description === this.description,
    );

    const existingFunctionCode = await fs.readFile(
      path.join(GENERATED_PATH, `${functionCache?.id}.ts`),
      'utf-8',
    );

    const result = await chain.invoke({
      functionDescription: this.description,
      existingFunctionCode,
      arguments: args.map((arg) => JSON.stringify(arg)).join(', '),
      expectedResult: JSON.stringify(expectedResult),
      actualResult: JSON.stringify(actualResult),
      argumentsSchema: this.config.arguments
        ?.map((arg) => zodToJsonSchema(arg))
        .join('\n\n'),
      returnSchema: this.config.return
        ? zodToJsonSchema(this.config.return)
        : undefined,
    });

    const functionCode = this.postProcessFunctionCode(result.content as string);

    const newId = functionCache?.id
      ? await this.replaceFunction(functionCache.id, functionCode)
      : await this.writeFunction(functionCode);

    return await this.loadFunction(newId);
  }

  private postProcessFunctionCode(functionCode: string) {
    return functionCode.replace(/```typescript/g, '').replace(/```/g, '');
  }

  public async fetchCode() {
    const cache = await this.loadExistingCache();
    const functionCache = cache.find(
      (item) => item.description === this.description,
    );

    if (!functionCache) {
      throw new Error('Function not found in cache');
    }

    const existingFunctionCode = await fs.readFile(
      path.join(GENERATED_PATH, `${functionCache?.id}.ts`),
      'utf-8',
    );

    return existingFunctionCode;
  }

  private async generateFunction() {
    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `
        <context>
        I want you to act as a typescript programmer. You will be given a function description and you will generate the code for the function. Additionally, you may be given the json schema for the arguments (separated by newlines) and the json schema for the return type.
        </context>

        <requirements>
        The function should replicate the behavior of the description as closely as possible. The function should be exported as default.

        Just output the code, nothing else, it should be valid typescript code, ready to be executed. Don't include any markdown syntax or other formatting.
        </requirements>
`,
      ],
      [
        'user',
        `
        <functionDescription>{functionDescription}</functionDescription>
        
        <argumentsSchema>
        {argumentsSchema}
        </argumentsSchema>

        <returnSchema>
        {returnSchema}
        </returnSchema>
        `,
      ],
    ]);

    const chain = prompt.pipe(this.config.model);

    const result = await chain.invoke({
      functionDescription: this.description,
      argumentsSchema: this.config.arguments
        ?.map((arg) => zodToJsonSchema(arg))
        .join('\n\n'),
      returnSchema: this.config.return
        ? zodToJsonSchema(this.config.return)
        : undefined,
    });

    const functionCode = this.postProcessFunctionCode(result.content as string);

    return functionCode;
  }

  private async replaceFunction(id: string, functionCode: string) {
    const cache = await this.loadExistingCache();

    const newCache = cache.filter((item) => item.id !== id);

    const newId = nanoid();

    newCache.push({ id: newId, description: this.description });

    await fs.writeFile(CACHE_PATH, JSON.stringify(newCache, null, 2));

    const filePath = path.join(GENERATED_PATH, `${newId}.ts`);

    await fs.writeFile(filePath, functionCode);

    return newId;
  }

  private async writeFunction(
    functionCode: string,
    id: string = nanoid(),
  ): Promise<string> {
    console.log(id);
    const filePath = path.join(GENERATED_PATH, `${id}.ts`);

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, functionCode);

    const cache = await this.loadExistingCache();

    cache.push({ id, description: this.description });

    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));

    return id;
  }

  private async loadFunction(id: string) {
    const filePath = path.join(GENERATED_PATH, `${id}.ts`);

    const { default: func } = await import(filePath);
    return func as (
      ...args: {
        [K in keyof TInputSchema]: z.infer<TInputSchema[K]>;
      }
    ) => z.infer<TOutputSchema>;
  }
}
