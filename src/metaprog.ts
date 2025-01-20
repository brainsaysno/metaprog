import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import path from 'path';
import { z, type ZodType } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { retry } from './utils.js';
import { FileSystemCacheHandler, type CacheHandler } from './cache.js';

const BASE_PATH = path.join(__dirname, 'metaprog');

export const DEFAULT_GENERATED_PATH = path.join(BASE_PATH, 'generated');

export const DEFAULT_CACHE_PATH = path.join(BASE_PATH, 'metaprog-cache.json');

export type MetaprogConfig = {
  model: BaseChatModel;
  cacheHandler: CacheHandler;
};

export function createMetaprogBuilder(config: MetaprogConfig) {
  return (prompt: TemplateStringsArray | string, ...args: any[]) =>
    new MetaprogFunctionBuilder(
      typeof prompt === 'string'
        ? prompt
        : prompt.reduce((acc, str, i) => acc + str + (args[i] || ''), ''),
      config,
    );
}

class MetaprogFunctionBuilder<
  TInputSchema extends readonly ZodType[],
  TOutputSchema extends ZodType,
> {
  private testCases: {
    testCallback: (
      generatedFunction: (
        ...args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
      ) => z.infer<TOutputSchema>,
    ) => boolean;
  }[] = [];
  private config: MetaprogConfig;
  private inputSchema?: TInputSchema;
  private outputSchema?: TOutputSchema;

  constructor(
    private description: string,
    config: MetaprogConfig,
  ) {
    this.config = {
      ...config,
      cacheHandler:
        config.cacheHandler ??
        new FileSystemCacheHandler(DEFAULT_CACHE_PATH, DEFAULT_GENERATED_PATH),
    };
  }

  public test(
    testCallback: (
      generatedFunction: (
        ...args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
      ) => z.infer<TOutputSchema>,
    ) => boolean,
  ) {
    this.testCases.push({ testCallback });
    return this;
  }

  private async runAllTests(functionId: string) {
    let currentFunctionId = functionId;
    for (const testCase of this.testCases) {
      currentFunctionId = await this.runTest(
        currentFunctionId,
        testCase.testCallback,
      );

      console.log('Running test case', testCase.testCallback.toString());
    }
  }

  private async runTest(
    functionId: string,
    testCallback: (
      generatedFunction: (
        ...args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
      ) => z.infer<TOutputSchema>,
    ) => boolean,
  ) {
    const testCode = testCallback.toString();

    return await retry(
      async () => {
        console.log('Loading function', functionId);
        let functionUnderTest =
          await this.config.cacheHandler.loadFunction<
            (
              ...args: { [K in keyof TInputSchema]: z.infer<TInputSchema[K]> }
            ) => z.infer<TOutputSchema>
          >(functionId);

        console.log('Function under test', functionUnderTest.toString());

        const result = testCallback(functionUnderTest);

        console.log('Test result', result);

        if (result === false) throw new Error('Test Failed.');

        return functionId;
      },
      {
        beforeRetry: async (error) => {
          console.log('Retrying test', testCode);

          functionId = await this.fixFunction(testCode, error);
        },
      },
    );
  }

  public input<TNewInputSchema extends readonly ZodType[]>(
    ...inputSchema: TNewInputSchema
  ) {
    // @ts-expect-error - This is a necessary hack to bypass type system and narrow the input type
    this.inputSchema = inputSchema;
    return this as MetaprogFunctionBuilder<TNewInputSchema, TOutputSchema>;
  }

  public output<TNewOutputSchema extends ZodType>(
    outputSchema: TNewOutputSchema,
  ) {
    // @ts-expect-error - This is a necessary hack to bypass type system and narrow the output type
    this.outputSchema = outputSchema;
    return this as MetaprogFunctionBuilder<TInputSchema, TNewOutputSchema>;
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
    testCode: string,
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
        <function-description>{functionDescription}</function-description>

        <existing-function-code>{existingFunctionCode}</existing-function-code>

        <test-code-that-failed>{testCodeThatFailed}</test-code-that-failed>

        <code-run-result>
        {codeRunResult}
        </code-run-result>

        ${
          this.inputSchema
            ? `
          <function-input-schema>
          {functionInputSchema}
          </function-input-schema>
          `
            : ''
        }

        ${
          this.outputSchema
            ? `
          <function-output-schema>
          {functionOutputSchema}
          </function-output-schema>
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

    console.log('------ Fixing function ------');
    const result = await chain.invoke({
      functionDescription: this.description,
      existingFunctionCode,
      testCodeThatFailed: testCode,
      codeRunResult: JSON.stringify(actualResult),
      functionInputSchema: this.inputSchema
        ?.map((arg) => zodToJsonSchema(arg))
        .join('\n\n'),
      functionOutputSchema: this.outputSchema
        ? zodToJsonSchema(this.outputSchema)
        : undefined,
    });

    const functionCode = this.postProcessFunctionCode(result.content as string);

    console.log('Existing function code', existingFunctionCode);
    console.log('Fixed function code', functionCode);

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
          this.inputSchema
            ? `
          <inputSchema>
          {inputSchema}
          </inputSchema>
          `
            : ''
        }

        ${
          this.outputSchema
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

    console.log('Generating function');
    const result = await chain.invoke({
      functionDescription: this.description,
      inputSchema: this.inputSchema
        ?.map((arg) => zodToJsonSchema(arg))
        .join('\n\n'),
      outputSchema: this.outputSchema
        ? zodToJsonSchema(this.outputSchema)
        : undefined,
    });

    const functionCode = this.postProcessFunctionCode(result.content as string);

    return functionCode;
  }
}
