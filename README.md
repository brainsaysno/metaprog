<div id="top"></div>

<div align="center">

[![Contributors][contributors-shield]][contributors-url]
[![Forks][forks-shield]][forks-url]
[![Stargazers][stars-shield]][stars-url]
[![Issues][issues-shield]][issues-url]

</div>

<br />
<div align="center">
  <a href="https://github.com/brainsaysno/metaprog">
    <img width="35%" alt="Panda banner" src="https://github.com/user-attachments/assets/6d76bf9d-975b-4a8f-aae1-e7d3303c0536"/>
  </a>
  <br/>
  <i> An experimental and versatile library for exploring LLM-assisted meta-programming. </i>
  <br/>
  <br/>

<h1 align="center"><i>metaprog</i></h1>
  <p align="center">
    <a href="https://github.com/brainsaysno/metaprog"><strong>Explore docs »</strong></a>
    <br />
    <br />
    <a href="https://github.com/brainsaysno/metaprog/issues/new?labels=enhancement">Suggest a feature</a>
    ·
    <a href="https://github.com/brainsaysno/metaprog/issues/new?labels=bug">Report a bug</a>
  </p>
</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About the Project</a>
      <ul>
        <li><a href="#key-features">Key Features</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#installation">Installation</a></li>
        <li><a href="#basic-usage">Basic Usage</a></li>
      </ul>
    </li>
    <li><a href="#advanced-usage">Advanced Usage</a>
      <ul>
        <li><a href="#using-schemas-for-validation">Using Schemas for Validation</a></li>
        <li><a href="#automatic-testing-and-regeneration">Automatic Testing and Regeneration</a></li>
        <li><a href="#caching">Caching</a></li>
      </ul>
    </li>
    <li><a href="#contributing">Contributing</a></li>
    <li><a href="#license">License</a></li>
  </ol>
</details>

## About the Project

**_Metaprog_** is an AI metaprogramming library for TypeScript that enables you to generate, validate and test code using _LLMs_ on runtime. It provides a simple yet powerful builder API to describe the code you want to generate and automatically handles the interaction with **LLMs**, validation of the output, and testing of the generated code.

### Key Features

- On-demand function generation based on a function description
- Integration with LLMs from the [_LangChain_](https://github.com/hwchase17/langchain) ecosystem
- Automatic caching of generated functions to avoid re-generation
- Automated test and re-prompt process if a generated function fails a user-supplied test case
- Strong type-safety and flexible configuration for input and output schemas using [_Zod_](https://github.com/colinhacks/zod)

## Getting Started

### Installation

You'll need to install the Metaprog package, as well as LangChain and the LLM-specific package you want to use. For the rest of the guide, we'll use Anthropic's Claude 3.5 Sonnet model.

```bash
npm install metaprog @langchain/core @langchain/anthropic # or any other LLM provider

# or

pnpm add metaprog @langchain/core @langchain/anthropic

# or

yarn add metaprog @langchain/core @langchain/anthropic
```

### Basic Usage

Below is a simple (and extremely overkill) example demonstrating how to generate a function that logs "Hello world!" to the console.

```typescript
import { createMetaprogBuilder } from 'metaprog';
import { ChatAnthropic } from '@langchain/anthropic';

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-latest',
  apiKey: 'your_api_key_here',
});

const meta = createMetaprogBuilder({ model });

const func = await meta`Console log "Hello world!"`.build();

func(); // logs "Hello world!"
```

#### How It Works

1. You provide a textual description of what the function should do.
2. Metaprog sends this description (and optional schemas for input or output) to an LLM.
3. The LLM returns TypeScript code, which is then compiled and cached locally.
4. You can immediately invoke the compiled function within your application.
5. On subsequent runs, Metaprog checks the cache to avoid re-generation.

### Using Schemas for Validation

To further constrain or validate your function's input and output, you can provide [Zod](https://github.com/colinhacks/zod) schemas. This will be used on the generation process as well as to strictly type the built function.

```typescript
import { z } from 'zod';
import { createMetaprogBuilder } from 'metaprog';
import { ChatAnthropic } from '@langchain/anthropic';

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-latest',
  apiKey: 'your_api_key_here',
});

const meta = createMetaprogBuilder({ model });

// Define input/output Zod schemas
const pathFinder =
  await meta`Get shortest path between two nodes on a graph given an adjacency matrix, a start node, and an end node.`
    .input(
      z.array(z.array(z.number())).describe('Adjacency matrix'),
      z.number().describe('Start node'),
      z.number().describe('End node'),
    )
    .output(z.number().describe('Shortest path length'))
    .build();

// The function is strictly typed as:
// (adjacencyMatrix: number[][], startNode: number, endNode: number) => number
pathFinder(
  [
    [0, 1, 7],
    [1, 2, 3],
    [5, 3, 4],
  ],
  0,
  2,
); // 4
```

## Advanced Usage

### Automatic Testing and Regeneration

Metaprog can automatically run a test against the generated function. If the function fails, it will ask the LLM to fix the generated code and retry until it passes (up to a configurable number of retries).

```typescript
import { z } from 'zod';
import { createMetaprogBuilder } from 'metaprog';
import { ChatAnthropic } from '@langchain/anthropic';

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-latest',
  apiKey: 'your_api_key_here',
});

const meta = createMetaprogBuilder({ model });

const addStrings = await meta`Add two numbers`
  .test((f) => f('1', '2') === 3) // If not passed, retries generation
  .test((f) => f('-5', '15') === 10) // If not passed, retries generation
  .build();

addStrings('1', '2'); // This result is ensured to be 3 as per the test
```

### Caching

All generated functions are cached so that on subsequent runs, the same function doesn't need to be re-generated unnecesarily. This reduces both latency and usage quotas on your LLM. By default, files are stored under a "generated" folder, and metadata is stored in a JSON file.

#### Custom Cache Handler

If you want more control over how or where functions are stored, implement the `CacheHandler` interface:

```typescript
import { CacheHandler } from 'metaprog';

class MyCustomCacheHandler implements CacheHandler {
  // Your cache handler code
}

// Then provide it to MetaprogFunctionBuilder:
import { MetaprogFunctionBuilder } from 'metaprog';
import { ChatAnthropic } from '@langchain/anthropic';

const model = new ChatAnthropic({
  model: 'claude-3-5-sonnet-latest',
  apiKey: 'your_api_key_here',
});

const myCustomCache = new MyCustomCacheHandler();

const myFunc = new MetaprogFunctionBuilder(
  'Some descriptive text',
  { model },
  myCustomCache,
);
```

## Contributing

Contributions are welcome! Feel free to submit issues or PRs on GitHub if you find bugs or want to propose new features.

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.

[contributors-shield]: https://img.shields.io/github/contributors/brainsaysno/metaprog.svg?style=for-the-badge&r
[contributors-url]: https://github.com/brainsaysno/metaprog/graphs/contributors?r
[forks-shield]: https://img.shields.io/github/forks/brainsaysno/metaprog.svg?style=for-the-badge&r
[forks-url]: https://github.com/brainsaysno/metaprog/network/members?r
[stars-shield]: https://img.shields.io/github/stars/brainsaysno/metaprog.svg?style=for-the-badge&r
[stars-url]: https://github.com/brainsaysno/metaprog/stargazers?r
[issues-shield]: https://img.shields.io/github/issues/brainsaysno/metaprog.svg?style=for-the-badge&r
[issues-url]: https://github.com/brainsaysno/metaprog/issues?r
