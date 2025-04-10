"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const typescript_1 = require("typescript");
const node_path_1 = require("node:path");
const node_fs_1 = require("node:fs");
const REPO_PATH = `${(0, node_path_1.resolve)('.')}/rs-admin-api`;
const FACILITY_CONTROLLER = `${(0, node_path_1.resolve)('.')}/rs-admin-api/src/controllers/facilityAccount.controller.js`;
function parseFile(path) {
    const content = (0, node_fs_1.readFileSync)(path, 'utf-8');
    const sourceFile = (0, typescript_1.createSourceFile)(path, content, typescript_1.ScriptTarget.ES2020, true);
    traverse(sourceFile);
}
function print() {
    const fileList = (0, node_fs_1.globSync)(`${REPO_PATH}/**/**/*.js`);
    let i = 0;
    for (const file of fileList) {
        parseFile(file);
        console.log("\n\n");
        i += 1;
        if (i == 10) {
            return;
        }
    }
}
function traverse(node, level = 0) {
    for (let i = 0; i < level; i++) {
        process.stdout.write(' ');
    }
    console.log(typescript_1.SyntaxKind[node.kind]); // Log the type of each node
    (0, typescript_1.forEachChild)(node, (child) => traverse(child, level + 1)); // Recursively visit child nodes
}
// print();
parseFile(FACILITY_CONTROLLER);
