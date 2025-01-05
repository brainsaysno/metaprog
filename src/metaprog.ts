import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import path from 'path';
import { z, type ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { retry, type Narrow } from './utils.js';
import { FileSystemCacheHandler, type CacheHandler } from './cache.js';

const BASE_PATH = path.join(__dirname, 'metaprog');

export const DEFAULT_GENERATED_PATH = path.join(BASE_PATH, 'generated');

export const DEFAULT_CACHE_PATH = path.join(BASE_PATH, 'metaprog-cache.json');

type MetaprogFunctionBuilderConfigInput<
  TInputSchema extends readonly ZodType[],
  TOutputSchema extends ZodType,
> = {
  model: BaseChatModel;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  cacheHandler?: CacheHandler;
};

type MetaprogFunctionBuilderConfig<
  TInputSchema extends readonly ZodType[],
  TOutputSchema extends ZodType,
> = {
  model: BaseChatModel;
  inputSchema?: TInputSchema;
  outputSchema?: TOutputSchema;
  cacheHandler: CacheHandler;
};

export class MetaprogFunctionBuilder<
  TInputSchema extends readonly ZodType[],
  TOutputSchema extends ZodType,
> {
  private testCases: {
    input: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> };
    output: z.infer<TOutputSchema>;
  }[] = [];
  private config: MetaprogFunctionBuilderConfig<TInputSchema, TOutputSchema>;

  constructor(
    private description: string,
    config: MetaprogFunctionBuilderConfigInput<TInputSchema, TOutputSchema>,
  ) {
    this.config = {
      ...config,
      cacheHandler:
        config.cacheHandler ??
        new FileSystemCacheHandler(DEFAULT_CACHE_PATH, DEFAULT_GENERATED_PATH),
    };
  }

  public test(
    args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> },
    expected: z.infer<TOutputSchema>,
  ) {
    this.testCases.push({ input: args, output: expected });
    return this;
  }

  private async runAllTests(functionId: string) {
    let currentFunctionId = functionId;
    for (const testCase of this.testCases) {
      currentFunctionId = await this.runTest(
        currentFunctionId,
        testCase.input,
        testCase.output,
      );

      console.log('Running test case', testCase);
    }
  }

  private async runTest(
    functionId: string,
    args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> },
    expected: z.infer<TOutputSchema>,
  ) {
    const builtFunction =
      await this.config.cacheHandler.loadFunction<
        (
          ...args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
        ) => z.infer<TOutputSchema>
      >(functionId);

    let actualResult: z.infer<TOutputSchema>;

    try {
      actualResult = builtFunction(...args);

      console.log('Actual result', actualResult);
      console.log('Expected result', expected);

      if (actualResult !== expected) {
        throw new Error('Function did not return the expected output');
      }

      return functionId;
    } catch (error) {
      return await retry(async () => {
        actualResult ??= error;
        console.error(
          'Metaprog function test failed. Regenerating function...',
        );

        const fixedFunctionId = await this.fixFunction(
          args,
          expected,
          actualResult,
        );

        const fixedFunction =
          await this.config.cacheHandler.loadFunction<
            (
              ...args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
            ) => z.infer<TOutputSchema>
          >(fixedFunctionId);

        const fixedResult = fixedFunction(...args);

        if (fixedResult !== expected) {
          throw new Error('Function failed to generate correctly after retry');
        }

        return fixedFunctionId;
      });
    }
  }

  public async build() {
    const cachedFunctionId = await this.config.cacheHandler.checkCache(
      this.description,
    );

    if (cachedFunctionId) {
      return this.config.cacheHandler.loadFunction<
        (
          ...args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
        ) => z.infer<TOutputSchema>
      >(cachedFunctionId);
    }

    const functionCode = await this.generateFunction();

    const createdFunctionId = await this.config.cacheHandler.writeFunction(
      functionCode,
      this.description,
    );

    await this.runAllTests(createdFunctionId);

    return await this.config.cacheHandler.loadFunction<
      (
        ...args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
      ) => z.infer<TOutputSchema>
    >(createdFunctionId);
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
        - A JSON schema for the function's input arguments (separated by newlines).
        - A JSON schema for the function's output return type, or you will be told it is undefined if it is not provided.

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
        - Do not include any markdown syntax or other formatting.
        - Do not include any comments or other non-code content.
        - Do not include any explanations or other non-code content.
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

        ${
          this.config.inputSchema
            ? `
          <inputSchema>
          {inputSchema}
          </inputSchema>
          `
            : ''
        }

        ${
          this.config.outputSchema
            ? `
        <outputSchema>
        {outputSchema}
        </outputSchema>
        `
            : ''
        }
        `,
      ],
    ]);

    const chain = prompt.pipe(this.config.model);

    const existingFunctionCode = await this.config.cacheHandler.fetchCode(
      this.description,
    );

    const result = await chain.invoke({
      functionDescription: this.description,
      existingFunctionCode,
      arguments: args.map((arg) => JSON.stringify(arg)).join(', '),
      expectedResult: JSON.stringify(expectedResult),
      actualResult: JSON.stringify(actualResult),
      inputSchema: this.config.inputSchema
        ?.map((arg) => zodToJsonSchema(arg))
        .join('\n\n'),
      outputSchema: this.config.outputSchema
        ? zodToJsonSchema(this.config.outputSchema)
        : undefined,
    });

    const functionCode = this.postProcessFunctionCode(result.content as string);

    const functionCache = await this.config.cacheHandler.loadFunctionCache(
      this.description,
    );

    const newId = functionCache
      ? await this.config.cacheHandler.replaceFunction(
          functionCache.id,
          functionCode,
          this.description,
        )
      : await this.config.cacheHandler.writeFunction(
          functionCode,
          this.description,
        );

    return newId;
  }

  private postProcessFunctionCode(functionCode: string) {
    return functionCode.replace(/```typescript/g, '').replace(/```/g, '');
  }

  public async fetchCode() {
    return this.config.cacheHandler.fetchCode(this.description);
  }

  private async generateFunction() {
    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `
        <context>
        I want you to act as a typescript programmer. You will be given a function description and you will generate the code for the function. Additionally, you may be given the json schema for the input arguments (separated by newlines) and the json schema for the output return type.
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

        ${
          this.config.inputSchema
            ? `
          <inputSchema>
          {inputSchema}
          </inputSchema>
          `
            : ''
        }

        ${
          this.config.outputSchema
            ? `
          <outputSchema>
          {outputSchema}
          </outputSchema>
          `
            : ''
        }
        `,
      ],
    ]);

    const chain = prompt.pipe(this.config.model);

    const result = await chain.invoke({
      functionDescription: this.description,
      inputSchema: this.config.inputSchema
        ?.map((arg) => zodToJsonSchema(arg))
        .join('\n\n'),
      outputSchema: this.config.outputSchema
        ? zodToJsonSchema(this.config.outputSchema)
        : undefined,
    });

    const functionCode = this.postProcessFunctionCode(result.content as string);

    return functionCode;
  }
}
