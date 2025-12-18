import { completePartialMarkdown } from "@copilotkitnext/core";

describe("completePartialMarkdown", () => {
  describe("Common streaming cutoff scenarios", () => {
    it("auto-closes bold text cut off mid-word", () => {
      const input = "The **important";
      const result = completePartialMarkdown(input);
      expect(result).toBe("The **important**");
    });

    it("auto-closes bold text cut off mid-sentence", () => {
      const input = "This is **really important information";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This is **really important information**");
    });

    it("auto-closes italic text cut off mid-word", () => {
      const input = "This is *emphasis";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This is *emphasis*");
    });

    it("auto-closes italic with underscore cut off", () => {
      const input = "This text is _important";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This text is _important_");
    });

    it("auto-closes inline code cut off mid-command", () => {
      const input = "Run `npm install";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Run `npm install`");
    });

    it("auto-closes inline code with function call", () => {
      const input = "Use `console.log(";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Use `console.log(`");
    });

    it("auto-closes code block cut off mid-code", () => {
      const input = "```javascript\nconsole.log('hello world');";
      const result = completePartialMarkdown(input);
      expect(result).toBe("```javascript\nconsole.log('hello world');\n```");
    });

    it("auto-closes code block with just language", () => {
      const input = "```python";
      const result = completePartialMarkdown(input);
      expect(result).toBe("```python\n```");
    });

    it("auto-closes link text cutoff", () => {
      const input = "Click [here for more info";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Click [here for more info]");
    });

    it("auto-closes link URL cutoff (very common)", () => {
      const input = "Visit [our website](https://example.com";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Visit [our website](https://example.com)");
    });

    it("auto-closes link with partial path", () => {
      const input = "See [documentation](/docs/getting-started";
      const result = completePartialMarkdown(input);
      expect(result).toBe("See [documentation](/docs/getting-started)");
    });
  });

  describe("Multiple elements with last one incomplete", () => {
    it("completes last bold when previous elements are complete", () => {
      const input = "First **complete** and then **incomplete";
      const result = completePartialMarkdown(input);
      expect(result).toBe("First **complete** and then **incomplete**");
    });

    it("completes last italic when mixed with complete elements", () => {
      const input = "Use `npm start` and then *check the logs";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Use `npm start` and then *check the logs*");
    });

    it("completes last code when mixed with complete elements", () => {
      const input = "Run `npm install` then `npm run";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Run `npm install` then `npm run`");
    });

    it("handles bold and code mixed - bold incomplete", () => {
      const input = "Install with `npm install` and **remember to";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Install with `npm install` and **remember to**");
    });

    it("handles bold and code mixed - code incomplete", () => {
      const input = "This is **important** when using `some-command";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This is **important** when using `some-command`");
    });
  });

  describe("Nested elements (realistic streaming scenarios)", () => {
    it("auto-closes code inside bold (common in documentation)", () => {
      const input = "The **important `config";
      const result = completePartialMarkdown(input);
      expect(result).toBe("The **important `config`**");
    });

    it("auto-closes bold inside link text", () => {
      const input = "Check [**important section";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Check [**important section**]");
    });

    it("auto-closes link inside bold text", () => {
      const input = "This is **see [the docs";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This is **see [the docs]**");
    });
  });

  describe("Edge cases", () => {
    it("handles empty input (start of stream)", () => {
      const input = "";
      const result = completePartialMarkdown(input);
      expect(result).toBe("");
    });

    it("handles whitespace-only input", () => {
      const input = "   \n  ";
      const result = completePartialMarkdown(input);
      expect(result).toBe("   \n  ");
    });

    it("handles plain text with no markdown", () => {
      const input = "Just regular text without any formatting";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Just regular text without any formatting");
    });

    it("handles already complete markdown (no changes needed)", () => {
      const input = "This **bold** and *italic* and `code` are complete";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This **bold** and *italic* and `code` are complete");
    });

    it("handles single markdown character (edge case)", () => {
      const input = "Text with *";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Text with **");
    });

    it("handles single backtick (edge case)", () => {
      const input = "Command: `";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Command: ``");
    });

    it("handles unmatched parentheses (realistic in code)", () => {
      const input = "Call function(param1, param2";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Call function(param1, param2)");
    });

    it("handles unmatched brackets (realistic in arrays)", () => {
      const input = "Items: [item1, item2";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Items: [item1, item2]");
    });

    it("handles multiple unmatched parentheses", () => {
      const input = "Nested calls: func1(func2(param";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Nested calls: func1(func2(param))");
    });
  });

  describe("Code block variations (common in streaming)", () => {
    it("auto-closes code block with tildes", () => {
      const input = "~~~bash\nnpm install";
      const result = completePartialMarkdown(input);
      expect(result).toBe("~~~bash\nnpm install\n~~~");
    });

    it("handles indented code block", () => {
      const input = "    ```sql\n    SELECT * FROM users";
      const result = completePartialMarkdown(input);
      expect(result).toBe("    ```sql\n    SELECT * FROM users\n    ```");
    });

    it("handles longer code fence (4+ backticks)", () => {
      const input = "````markdown\n```\ncode inside\n```";
      const result = completePartialMarkdown(input);
      expect(result).toBe("````markdown\n```\ncode inside\n```\n````");
    });
  });

  describe("Emphasis variations that occur in streaming", () => {
    it("auto-closes double underscore bold", () => {
      const input = "This is __very important";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This is __very important__");
    });

    it("auto-closes strikethrough (if supported)", () => {
      const input = "This is ~~old information";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This is ~~old information~~");
    });
  });

  // NEW STRESS TESTS - Let's try to break this!
  describe("Deep nesting stress tests", () => {
    it("handles triple nested elements (realistic docs scenario)", () => {
      const input = "See **bold with _italic and `code";
      const result = completePartialMarkdown(input);
      expect(result).toBe("See **bold with _italic and `code`_**");
    });

    it("handles quadruple nesting (extreme but possible)", () => {
      const input = "Check [**bold _italic `code";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Check [**bold _italic `code`_**]");
    });

    it("handles all emphasis types together", () => {
      const input = "**Bold __underscore ~~strike _italic `code";
      const result = completePartialMarkdown(input);
      expect(result).toBe("**Bold __underscore ~~strike _italic `code`_~~__**");
    });

    it("handles deeply nested parentheses in code context", () => {
      const input = "Use `func(param1, func2(param3, func4(";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Use `func(param1, func2(param3, func4(`");
    });
  });

  describe("URL and link stress tests", () => {
    it("handles complex URLs with query parameters", () => {
      const input =
        "Visit [API docs](https://api.example.com/v1/docs?filter=all&sort=";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "Visit [API docs](https://api.example.com/v1/docs?filter=all&sort=)"
      );
    });

    it("handles URLs with fragments and encoded characters", () => {
      const input =
        "See [section](https://example.com/page#section%20with%20spaces";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "See [section](https://example.com/page#section%20with%20spaces)"
      );
    });

    it("handles image syntax with alt text containing emphasis", () => {
      const input = "![**Important** image";
      const result = completePartialMarkdown(input);
      expect(result).toBe("![**Important** image]");
    });

    it("handles image with partial URL", () => {
      const input = "![Alt text](https://cdn.example.com/images/photo";
      const result = completePartialMarkdown(input);
      expect(result).toBe("![Alt text](https://cdn.example.com/images/photo)");
    });

    it("handles multiple links in sequence with incomplete last one", () => {
      const input = "See [first](url1) and [second](url2) and [third";
      const result = completePartialMarkdown(input);
      expect(result).toBe("See [first](url1) and [second](url2) and [third]");
    });
  });

  describe("Code block content stress tests", () => {
    it("handles code block containing markdown-like syntax", () => {
      const input = "```markdown\n# Header\n**Bold** text\n*italic*";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "```markdown\n# Header\n**Bold** text\n*italic*\n```"
      );
    });

    it("handles code block with nested code fences", () => {
      const input = "````\n```javascript\nconsole.log('nested');\n```";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "````\n```javascript\nconsole.log('nested');\n```\n````"
      );
    });

    it("handles SQL with asterisks and underscores", () => {
      const input = "```sql\nSELECT * FROM users_table WHERE name LIKE '%test_";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "```sql\nSELECT * FROM users_table WHERE name LIKE '%test_\n```"
      );
    });

    it("handles regex patterns in code", () => {
      const input = "```javascript\nconst pattern = /\\*{2,}.*_+.*`+/";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "```javascript\nconst pattern = /\\*{2,}.*_+.*`+/\n```"
      );
    });

    it("handles bash commands with special characters", () => {
      const input =
        "```bash\nfind . -name '*.md' | grep -E '**bold**|_italic_|`code`";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "```bash\nfind . -name '*.md' | grep -E '**bold**|_italic_|`code`\n```"
      );
    });
  });

  describe("Real-world streaming patterns", () => {
    it("handles streaming API documentation", () => {
      const input =
        "The `POST /api/users` endpoint accepts **required parameters**: `name` (string), `email` (string), and **optional";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "The `POST /api/users` endpoint accepts **required parameters**: `name` (string), `email` (string), and **optional**"
      );
    });

    it("handles streaming code explanation", () => {
      const input =
        "This function `calculateTotal(items)` will **iterate through each item** and _sum the values_, then **return the";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "This function `calculateTotal(items)` will **iterate through each item** and _sum the values_, then **return the**"
      );
    });

    it("handles streaming error message", () => {
      const input =
        "**Error**: Failed to connect to `database.example.com:5432`. Check [network settings](./troubleshooting.md#network";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "**Error**: Failed to connect to `database.example.com:5432`. Check [network settings](./troubleshooting.md#network)"
      );
    });

    it("handles streaming configuration example", () => {
      const input =
        "Set the environment variable `NODE_ENV=production` and ensure **all required fields** are configured in [config.json";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "Set the environment variable `NODE_ENV=production` and ensure **all required fields** are configured in [config.json]"
      );
    });

    it("handles streaming tutorial with mixed formatting", () => {
      const input =
        "1. Install dependencies with `npm install`\n2. **Configure** your `.env` file\n3. Run the [development server";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "1. Install dependencies with `npm install`\n2. **Configure** your `.env` file\n3. Run the [development server]"
      );
    });
  });

  describe("Special character and Unicode stress tests", () => {
    it("handles emphasis with emoji and Unicode", () => {
      const input = "This is **really important 🚨 información crítica";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "This is **really important 🚨 información crítica**"
      );
    });

    it("handles code with special characters", () => {
      const input = "Use `console.log('Hello 世界! ñáéíóú')` to **debug";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "Use `console.log('Hello 世界! ñáéíóú')` to **debug**"
      );
    });

    it("handles links with international domains", () => {
      const input =
        "Visit [日本語サイト](https://example.日本/path/to/resource";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "Visit [日本語サイト](https://example.日本/path/to/resource)"
      );
    });

    it("handles emphasis with mathematical symbols", () => {
      const input = "The formula is **E = mc²** and the result _≈ 3.14159";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "The formula is **E = mc²** and the result _≈ 3.14159_"
      );
    });
  });

  describe("Performance and edge cases", () => {
    it("handles very long strings efficiently", () => {
      const input = "**" + "a".repeat(1000) + " and more text";
      const result = completePartialMarkdown(input);
      expect(result).toBe("**" + "a".repeat(1000) + " and more text**");
      expect(result.length).toBeGreaterThan(1000);
    });

    it("handles many nested parentheses", () => {
      const input = "Complex nesting: ((((((((((incomplete";
      const result = completePartialMarkdown(input);
      expect(result).toBe("Complex nesting: ((((((((((incomplete))))))))))");
    });

    it("handles alternating emphasis markers", () => {
      const input = "*_*_*_*_*_incomplete";
      const result = completePartialMarkdown(input);
      expect(result).toBe("*_*_*_*_*_incomplete_*");
    });

    it("handles mixed quotes and emphasis", () => {
      const input =
        "He said \"this is **really important** and 'very _critical";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "He said \"this is **really important** and 'very _critical_"
      );
    });
  });

  describe("Malformed markdown recovery", () => {
    it("handles unmatched emphasis in realistic context", () => {
      const input =
        "The **API endpoint** returns _JSON data_ but **sometimes the response";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "The **API endpoint** returns _JSON data_ but **sometimes the response**"
      );
    });

    it("handles code fence without language but with content", () => {
      const input = "```\nfunction test() {\n  return 'hello';";
      const result = completePartialMarkdown(input);
      expect(result).toBe("```\nfunction test() {\n  return 'hello';\n```");
    });

    it("handles strikethrough in middle of other emphasis", () => {
      const input = "This is **bold with ~~strikethrough text";
      const result = completePartialMarkdown(input);
      expect(result).toBe("This is **bold with ~~strikethrough text~~**");
    });

    it("handles multiple emphasis types without proper ordering", () => {
      const input = "_italic **bold ~~strike `code";
      const result = completePartialMarkdown(input);
      expect(result).toBe("_italic **bold ~~strike `code`~~**_");
    });
  });

  describe("Streaming with realistic pauses", () => {
    it("handles mid-word cutoff in technical terms", () => {
      const input =
        "Configure the `webpack.config.js` file with **optimization";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "Configure the `webpack.config.js` file with **optimization**"
      );
    });

    it("handles cutoff after punctuation", () => {
      const input = "First step: **install Node.js**. Second step: **configure";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "First step: **install Node.js**. Second step: **configure**"
      );
    });

    it("handles cutoff in compound words", () => {
      const input = "The **server-side";
      const result = completePartialMarkdown(input);
      expect(result).toBe("The **server-side**");
    });

    it("handles cutoff with numbers and symbols", () => {
      const input = "Version **2.1.0** introduces **new features like auto-";
      const result = completePartialMarkdown(input);
      expect(result).toBe(
        "Version **2.1.0** introduces **new features like auto-**"
      );
    });
  });
});
