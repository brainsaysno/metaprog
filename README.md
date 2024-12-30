# Metaprog

> An experimental and versatile library for exploring LLM-assisted meta-programming.

Metaprog aims to automate or streamline certain coding tasks by leveraging large language models (LLMs) to generate, cache, revise, and test TypeScript functions on the fly.

## Key Features

- On-demand function generation based on a function description.
- Integration with large language models from the [LangChain](https://github.com/hwchase17/langchain) ecosystem.
- Automatic caching of generated functions to avoid re-generation.
- Automated test and re-prompt process if a generated function fails a user-supplied test case.
- Strong type-safety and flexible configuration for input and output schemas using [Zod](https://github.com/colinhacks/zod).

## Installation

You'll need to install the Metaprog package, as well as LangChain and the LLM you want to use. For the rest of the guide, we'll use Anthropic's Claude 3.5 Sonnet model.

```bash
npm install metaprog @langchain/core @langchain/anthropic # or any other LLM provider

# or

pnpm add metaprog @langchain/core @langchain/anthropic

# or

yarn add metaprog @langchain/core @langchain/anthropic
```

## Basic Usage

Below is a simple example demonstrating how to generate a function that logs "Hello world!" to the console.

```typescript
import { MetaprogFunction } from 'metaprog';
import { ChatAnthropic } from '@langchain/anthropic';

// Prepare a model from LangChain (replace apiKey with a valid key if necessary)
const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  apiKey: 'your_api_key_here',
});

// Create a MetaprogFunction instance with a brief description
const builder = new MetaprogFunction('Console log "Hello world!"', {
  model,
});

async function main() {
  // Build (generate or load from cache) the function
  const func = await helloWorldFunc.build();

  // Invoke the generated function
  func(); // Should log "Hello world!"
}

main();
```

### How It Works

1. You provide a textual description of what the function should do.
2. Metaprog sends this description (and optional schemas for input or output) to an LLM.
3. The LLM returns TypeScript code, which is then compiled and cached locally.
4. You can immediately invoke the compiled function within your application.
5. On subsequent runs, Metaprog checks the cache to avoid re-generation.

## Using Schemas for Validation

To further constrain or validate your function’s input and output, you can provide [Zod](https://github.com/colinhacks/zod) schemas. This will be used on the generation process as well as to strictly type the built function.

```typescript
import { z } from 'zod';
import { MetaprogFunction } from 'metaprog';
import { ChatAnthropic } from '@langchain/anthropic';

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  apiKey: 'your_api_key_here',
});

// Define input/output Zod schemas
const inputSchema = [z.number(), z.number()];
const outputSchema = z.number();

const multiplyFunc = new MetaprogFunction(
  'Get shortest path between two nodes given an adjacency matrix',
  {
    model,
    inputSchema,
    outputSchema,
  },
);

async function run() {
  const func = await multiplyFunc.build();
  console.log('2 * 3 =', func(2, 3)); // Logs: 2 * 3 = 6
}

run();
```

## Advanced Usage

### Automatic Testing and Regeneration

Metaprog can automatically run a test against the generated function. If the function fails, it will ask the LLM to fix the generated code and retry until it passes (up to a configurable number of retries). This is useful for a test-driven approach to code generation.

```typescript
// Example with a test that expects the function to return 3
// when passing inputs ["1", "2"].

import { z } from 'zod';
import { MetaprogFunction } from 'metaprog';
import { ChatAnthropic } from '@langchain/anthropic';

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  apiKey: 'your_api_key_here',
});

// Suppose we want to add two numbers (strings we parse to numbers)
const inputSchema = [z.string(), z.string()];
const outputSchema = z.number();

const addStringsFunc = new MetaprogFunction('Add two numbers', {
  model,
  inputSchema,
  outputSchema,
});

async function run() {
  // The test expects addStringsFunc("1", "2") to be 3
  await addStringsFunc.test(['1', '2'], 3);

  // If it passes, we can use the function
  const func = await addStringsFunc.build();
  const result = func('1', '2');
  console.log('Result:', result); // Logs: 3
}

run();
```

If the first generated function fails the test, Metaprog invokes its "fix" cycle, prompting the LLM to correct the function until it passes.

### Caching

All generated functions are cached so that on subsequent runs, the same function doesn’t need to be re-fetched from the LLM. This reduces both latency and usage quotas on your LLM. By default, files are stored under a "generated" folder, and metadata is stored in a JSON file. You can configure or implement your own cache strategy by providing a custom `CacheHandler` class.

#### Custom Cache Handler

If you want more control over how or where functions are stored, implement the `CacheHandler` interface:

```typescript
import { CacheHandler } from 'metaprog';

class MyCustomCacheHandler implements CacheHandler {
  // Your cache handler code
}

// Then provide it to MetaprogFunction:
import { MetaprogFunction } from 'metaprog';
import { ChatAnthropic } from '@langchain/anthropic';

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-20240620',
  apiKey: 'your_api_key_here',
});

const myCustomCache = new MyCustomCacheHandler();

const myFunc = new MetaprogFunction(
  'Some descriptive text',
  { model },
  myCustomCache,
);
```

## Contributing

Contributions are welcome! Feel free to submit issues or PRs on GitHub if you find bugs or want to propose new features.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
