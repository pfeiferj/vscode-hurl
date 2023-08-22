// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

import Parser from 'web-tree-sitter'
import { highlights } from './query'
import * as path from 'path';
import { exec } from "child_process";
import Convert from 'ansi-to-html';
var convert = new Convert({escapeXML: true});

const symbolTypeMap: Record<string,string> = {
  "property": "property",
  "comment": "comment",
  "string": "string",
  "string.special": "string",
  "string.regex": "regexp",
  "string.escape": "operator",
  "type": "type",
  "type.builtin": "type",
  "function.builtin": "function",
  "attribute": "decorator",
  "constant.builtin": "enumMember",
  "boolean": "boolean",
  "keyword.operator": "operator",
  "operator": "operator",
  "number": "number",
  "float": "number",
}


let sitter: [Parser, Parser.Query] | null = null
async function parserInit () {
  await Parser.init();
  const parser = new Parser();
  let langFile = path.join(__dirname, "../", 'tree-sitter-hurl.wasm');
  const Hurl = await Parser.Language.load(langFile);
  parser.setLanguage(Hurl);
  const query = Hurl.query(highlights)
  sitter = [parser, query]
}
parserInit()


const tokenTypes = Object.values(symbolTypeMap);
const legend = new vscode.SemanticTokensLegend(tokenTypes);


const provider: vscode.DocumentSemanticTokensProvider = {
  provideDocumentSemanticTokens(
    document: vscode.TextDocument
  ): vscode.ProviderResult<vscode.SemanticTokens> {
    // analyze the document and return semantic tokens

    const tokensBuilder = new vscode.SemanticTokensBuilder(legend);
    if(!sitter) {
      return tokensBuilder.build();
    }
    const [parser, query] = sitter;
    const tree = parser.parse(document.getText())
    const captures = query.captures(tree.rootNode)

    captures.forEach(capture => {
      if(!symbolTypeMap[capture.name]) return
      for(let i = capture.node.startPosition.row; i <= capture.node.endPosition.row; i++) {

        let startColumn = capture.node.startPosition.column
        if(i !== capture.node.startPosition.row) {
          startColumn = 0
        }
        let endColumn = capture.node.endIndex - capture.node.startIndex + capture.node.startPosition.column
        if(i === capture.node.endPosition.row) {
          endColumn = capture.node.endPosition.column
        }
        tokensBuilder.push(
          new vscode.Range(new vscode.Position(i, startColumn), new vscode.Position(i, endColumn)),
          symbolTypeMap[capture.name] || capture.name
        );
      }
    })
    return tokensBuilder.build();
  }
};


const selector = { language: 'hurl', scheme: 'file' }; // register for all Java documents from the local file system

vscode.languages.registerDocumentSemanticTokensProvider(selector, provider, legend);

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	let disposable = vscode.commands.registerCommand('hurl.hurl', () => {
    const path = vscode.window.activeTextEditor?.document.fileName
    if(!path) {
      return
    }
    let data = ""
    exec("hurl " + path + " --color", (error, stdout, stderr) => {
      const panel = vscode.window.createWebviewPanel("hurl", "Hurl", vscode.ViewColumn.Beside,{})
      if (error) {
        console.log(`error: ${error.message}`);
        vscode.window.showErrorMessage(error.message)
        return;
      }
      if (stderr) {
        data += convert.toHtml(stderr)
        panel.webview.html = "<html><body><pre>" + data + "</pre></body></html>"
      }
      if(stdout) {
        data += convert.toHtml(stdout)
        panel.webview.html = "<html><body><pre>" + data + "</pre></body></html>"
      }
    });
	});

	context.subscriptions.push(disposable);
}

// This method is called when your extension is deactivated
export function deactivate() {}
