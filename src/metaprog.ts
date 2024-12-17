import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { ChatPromptTemplate } from '@langchain/core/prompts';
import fs from 'fs/promises';
import { nanoid } from 'nanoid';
import path from 'path';

type MetaprogConfig = {
  model: BaseChatModel;
};

type MetaprogCache = {
  id: string;
  description: string;
}[];

const BASE_PATH = path.join(__dirname, 'metaprog');

export const GENERATED_PATH = path.join(BASE_PATH, 'generated');

export const CACHE_PATH = path.join(BASE_PATH, 'metaprog-cache.json');

export default class Metaprog {
  constructor(private config: MetaprogConfig) {}

  async demand(functionDescription: string) {
    const cachedFunctionId = await this.checkCache(functionDescription);

    if (cachedFunctionId) {
      return this.loadFunction(cachedFunctionId);
    }

    const functionCode = await this.generateFunction(functionDescription);

    const createdFunctionId = await this.writeFunction(functionCode);

    const createdFunction = await this.loadFunction(createdFunctionId);

    await this.writeCache(createdFunctionId, functionDescription);

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

  private async writeCache(id: string, functionDescription: string) {
    const cache = await this.loadExistingCache();

    cache.push({ id, description: functionDescription });

    await fs.writeFile(CACHE_PATH, JSON.stringify(cache, null, 2));
  }

  private async generateFunction(functionDescription: string) {
    const prompt = ChatPromptTemplate.fromMessages([
      [
        'system',
        `I want you to act as a typescript programmer. I will give you a function description and you will generate the code for the function.

        The function should replicate the behavior of the description as closely as possible. The function should be exported as default.

        Just output the code, nothing else, it should be valid typescript code, ready to be executed.`,
      ],
      ['user', '{functionDescription}'],
    ]);

    const chain = prompt.pipe(this.config.model);

    const result = await chain.invoke({
      functionDescription,
    });

    console.debug(result);

    const functionCode = result.content as string;

    return functionCode;
  }

  private async writeFunction(functionCode: string): Promise<string> {
    const id = nanoid();

    const filePath = path.join(GENERATED_PATH, `${id}.ts`);

    await fs.mkdir(path.dirname(filePath), { recursive: true });

    await fs.writeFile(filePath, functionCode);

    return id;
  }

  private async loadFunction(id: string) {
    const filePath = path.join(GENERATED_PATH, `${id}.ts`);

    const { default: func } = await import(filePath);
    return func as (...args: any[]) => any;
  }
}

// class MetaprogFunction<TArgs extends any[], TReturn> {
//   constructor(private func: (...args: TArgs) => TReturn) {}

//   public call(...args: TArgs) {
//     return this.func(...args);
//   }

//   public getArgs() {
//     return this.args;
//   }

//   public getReturn() {
//     return this.return;
//   }
// }
