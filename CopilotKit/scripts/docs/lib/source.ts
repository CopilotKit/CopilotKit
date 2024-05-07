import * as ts from "typescript";
import * as fs from "fs/promises";
import { existsSync } from "fs";
import { dirname, resolve } from "path";
import { Comments } from "./comments";

export interface InterfaceDefinition {
  name: string;
  properties: {
    name: string;
    type: string;
    required: boolean;
    comment: string;
  }[];
}

export interface MethodDefinition {
  signature: string;
  comment: string;
  parameters: {
    name: string;
    type: string;
    required: boolean;
    comment: string;
  }[];
}

export class SourceFile {
  public sourceFile!: ts.SourceFile;

  constructor(private readonly filePath: string) {}

  async parse() {
    const fileContents = await fs.readFile(this.filePath, "utf8");
    this.sourceFile = ts.createSourceFile(
      this.filePath,
      fileContents,
      ts.ScriptTarget.Latest,
      true,
    );
  }

  /**
   * Get the interface definition of the first argument of the function or class constructor.
   */
  async getArg0Interface(name: string): Promise<InterfaceDefinition> {
    let interfaceName: string = "";

    const visit = (node: ts.Node) => {
      // if we find a matching function declaration
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.getText() === name &&
        node.parameters.length &&
        node.parameters[0].type &&
        ts.isTypeReferenceNode(node.parameters[0].type)
      ) {
        interfaceName = node.parameters[0].type.typeName.getText();
      }
      // if we find a matching class declaration
      else if (ts.isClassDeclaration(node) && node.name?.getText() === name) {
        const constructor = node.members.find((member) =>
          ts.isConstructorDeclaration(member),
        ) as ts.ConstructorDeclaration;
        if (
          constructor &&
          constructor.parameters.length &&
          constructor.parameters[0].type &&
          ts.isTypeReferenceNode(constructor.parameters[0].type)
        ) {
          interfaceName = constructor.parameters[0].type.typeName.getText();
        }
      }

      ts.forEachChild(node, visit);
    };

    // analyze the source file
    visit(this.sourceFile);

    if (!interfaceName) {
      throw new Error(`No interface found for ${name}`);
    }

    // extract the interface definition
    let interfaceFilePath =
      this.findTypeDeclaration(this.sourceFile, interfaceName) || this.filePath;

    const interfaceSource = new SourceFile(interfaceFilePath);
    await interfaceSource.parse();

    return interfaceSource.extractInterfaceDefinition(interfaceName);
  }

  /**
   * Extracts the interface definition from the source file.
   */
  protected async extractInterfaceDefinition(interfaceName: string): Promise<InterfaceDefinition> {
    const definition: InterfaceDefinition = {
      name: interfaceName,
      properties: [],
    };
    const visit = (node: ts.Node) => {
      if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
        node.members.forEach((member) => {
          if (ts.isPropertySignature(member)) {
            definition.properties.push({
              name: member.name.getText(this.sourceFile),
              type: (member.type?.getText(this.sourceFile) || "unknown")
                .replace(/\n/g, "")
                .replace(/\s+/g, " "),
              required: !member.questionToken,
              comment: Comments.getCleanedCommentsForNode(member, this.sourceFile),
            });
          }
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(this.sourceFile);
    return definition;
  }

  /**
   * Finds the absolute declaration file path of a type if imported.
   */
  findTypeDeclaration(sourceFile: ts.SourceFile, typeName: string): string | null {
    for (const statement of sourceFile.statements) {
      if (ts.isImportDeclaration(statement) && statement.importClause) {
        const namedBindings = statement.importClause.namedBindings;
        if (namedBindings && ts.isNamedImports(namedBindings)) {
          const imports = namedBindings.elements.filter(
            (element) => element.name.text === typeName,
          );
          if (imports.length > 0) {
            const moduleSpecifier = (statement.moduleSpecifier as ts.StringLiteral).text;
            // Resolve the path relative to the directory of the current source file
            let resolvedPath = resolve(dirname(sourceFile.fileName), moduleSpecifier);

            if (existsSync(resolvedPath + ".ts")) {
              return resolvedPath + ".ts";
            } else if (existsSync(resolvedPath + ".tsx")) {
              return resolvedPath + ".tsx";
            }
            return null;
          }
        }
      }
    }
    return null;
  }

  /**
   * Get the public method definitions of a class.
   */
  async getPublicMethodDefinitions(className: string): Promise<MethodDefinition[]> {
    const methodDefinitions: MethodDefinition[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name?.getText() === className) {
        node.members.forEach((member) => {
          if (
            ts.isMethodDeclaration(member) &&
            member.modifiers?.every((modifier) => modifier.kind !== ts.SyntaxKind.PrivateKeyword)
          ) {
            const functionComments = Comments.getTsDocCommentsForFunction(member, this.sourceFile);
            const signature =
              member.name.getText() +
              "(" +
              member.parameters.map((param) => param.getText()).join(", ") +
              ")";
            const methodDefinition = {
              signature,
              comment: functionComments.comment,
              parameters: member.parameters.map((param) => {
                return {
                  name: param.name.getText(),
                  type: param.type?.getText() || "unknown",
                  required: !param.questionToken,
                  comment: functionComments.params[param.name.getText()] || "",
                };
              }),
            };
            methodDefinitions.push(methodDefinition);
          }
        });
      }
      ts.forEachChild(node, visit);
    };

    visit(this.sourceFile);

    return methodDefinitions;
  }
}
