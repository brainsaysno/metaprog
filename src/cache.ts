import fs from 'fs/promises';
import path from 'path';
import { nanoid } from 'nanoid';

type MetaprogCacheItem = {
  id: string;
  description: string;
};

export interface CacheHandler {
  loadFunctionCache(description: string): Promise<MetaprogCacheItem | null>;
  checkCache(functionDescription: string): Promise<string | null>;
  replaceFunction(
    id: string,
    functionCode: string,
    description: string,
  ): Promise<string>;
  writeFunction(
    functionCode: string,
    description: string,
    id?: string,
  ): Promise<string>;
  loadFunction<T>(id: string): Promise<T>;
  fetchCode(description: string): Promise<string>;
  clearCache(): Promise<void>;
}

export class FileSystemCacheHandler implements CacheHandler {
  constructor(
    private cachePath: string,
    private generatedPath: string,
  ) {}

  private async loadCache(): Promise<MetaprogCacheItem[]> {
    try {
      const cache = await fs.readFile(this.cachePath, 'utf-8');
      return JSON.parse(cache) as MetaprogCacheItem[];
    } catch (error) {
      return [];
    }
  }

  async loadFunctionCache(
    description: string,
  ): Promise<MetaprogCacheItem | null> {
    const cache = await this.loadCache();
    const functionCache = cache.find(
      (item) => item.description === description,
    );

    if (!functionCache) {
      return null;
    }

    return functionCache;
  }

  async checkCache(functionDescription: string) {
    const cache = await this.loadCache();
    return (
      cache.find((item) => item.description === functionDescription)?.id ?? null
    );
  }

  async replaceFunction(id: string, functionCode: string, description: string) {
    const cache = await this.loadCache();
    const newCache = cache.filter((item) => item.id !== id);
    const newId = nanoid();

    newCache.push({ id: newId, description });
    await fs.writeFile(this.cachePath, JSON.stringify(newCache, null, 2));

    const filePath = path.join(this.generatedPath, `${newId}.ts`);
    await fs.writeFile(filePath, functionCode);

    return newId;
  }

  async writeFunction(
    functionCode: string,
    description: string,
    id: string = nanoid(),
  ): Promise<string> {
    const filePath = path.join(this.generatedPath, `${id}.ts`);

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, functionCode);

    const cache = await this.loadCache();
    cache.push({ id, description });
    await fs.writeFile(this.cachePath, JSON.stringify(cache, null, 2));

    return id;
  }

  async loadFunction<T>(id: string): Promise<T> {
    const filePath = path.join(this.generatedPath, `${id}.ts`);
    const { default: func } = await import(filePath);
    return func as T;
  }

  async fetchCode(description: string): Promise<string> {
    const cache = await this.loadCache();
    const functionCache = cache.find(
      (item) => item.description === description,
    );

    if (!functionCache) {
      throw new Error('Function not found in cache');
    }

    return await fs.readFile(
      path.join(this.generatedPath, `${functionCache?.id}.ts`),
      'utf-8',
    );
  }

  async clearCache(): Promise<void> {
    await fs.rm(this.cachePath, { force: true });
    await fs.rm(this.generatedPath, { recursive: true, force: true });
  }
}
