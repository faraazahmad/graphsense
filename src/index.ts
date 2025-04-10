import { createSourceFile, forEachChild, ImportDeclaration, isNamedImports, NamedImports, Node, ScriptTarget, SyntaxKind } from 'typescript';
import { resolve, dirname } from 'node:path';
import { globSync, readFileSync } from 'node:fs';
import { debug } from 'node:console';

const REPO_PATH = `${resolve('.')}/rs-admin-api`;
function print(): void {
    const fileList = globSync(`${REPO_PATH}/**/**/*.js`)

    let i = 0;
    for (const file of fileList) {
        parseFile(file);
        console.log("\n\n");
        i += 1;
        if (i == 10) { return; }
    }
}

const FACILITY_CONTROLLER = `${resolve('.')}/rs-admin-api/src/controllers/facilityAccount.controller.js`;

function parseFile(path: string) {
    const content = readFileSync(path, 'utf-8');
    const sourceFile = createSourceFile(
        path,
        content,
        ScriptTarget.ES2020,
        true
    );

    traverse(sourceFile);
}

let results: any[] = [];
function traverse(node: Node, level: number = 0) {
  if (node.kind === SyntaxKind.ImportDeclaration) {
      const importDeclaration = node as ImportDeclaration;
      const importData = {
          clause: "",
          source: "",
      };
      forEachChild(node, (child) => {
          if (child.kind === SyntaxKind.StringLiteral) {
              let path;
              const text = child.getText();
              if (text.includes('./')) {
                  let rawPath = `${dirname(FACILITY_CONTROLLER)}/${text.slice(1, text.length-1)}`;
                  if (rawPath.includes('./') && !rawPath.endsWith('.js')) { rawPath += '.js'; }
                  path = resolve(rawPath);
              } else {
                  path = text.slice(1, text.length-1);
              }

              importData.source = path;
          }
      });
      if (importDeclaration.importClause?.namedBindings) {
          const namedBindings = importDeclaration.importClause.namedBindings;

        // Check if named bindings are NamedImports
        if (namedBindings.kind === SyntaxKind.NamedImports) {
            const namedImports = namedBindings as NamedImports;

            // Access each element in NamedImports
            namedImports.elements.forEach(element => {
                results.push({ clause: element.name.text, source: importData.source });
            });
        }
      } else if (importDeclaration.importClause?.name){
          importData.clause = importDeclaration.importClause.name.getText();
          results.push(importData);
      }
      return;
  }
  forEachChild(node, (child) => traverse(child, level + 1));        // Recursively visit child nodes
}

// print();
parseFile(FACILITY_CONTROLLER);
console.log(results)
