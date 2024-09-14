# Hurl

Plugin for [Hurl](https://hurl.dev) files.

NOTE: This is an unofficial plugin, visit <https://hurl.dev> for more information
about the Hurl project.

## Features

Semantic Token Highlighting:
Utilizes a tree-sitter parser to enable token based syntax highlighting for
.hurl files.

Hurl runner:
Adds a command to call Hurl for the current file and display the output in vscode.

---

## Example

![Screenshot from 2022-12-25 00-17-25](https://user-images.githubusercontent.com/9106735/209457733-e04f5d99-fec2-4db7-b067-22bccad9e750.png)


## Requirements

Syntax highlighting does not require external dependencies.

Hurl command requires [Hurl](https://hurl.dev) to be installed on your path.

---

## Release Notes

## 1.3.4
* Latest tree-sitter-hurl with fixes for comments without a new line character

## 1.3.3
* Latest tree-sitter-hurl with fixes comments with no characters (Thanks @pravic!)

## 1.3.2
* Latest tree-sitter-hurl with fixes for multiline strings and comments at beginning of file

## 1.3.1

* Add support for comments and brackets (Thanks @smithamax!)
* Show stderr in case of error exit code (Thanks @carlo-colombo!)

## 1.3.0

* Handle hurl v4 custom http methods and missing and new filters
* Fixes comment highlighting

## 1.2.2

Fix failure from api changes. (Thanks @cailloumajor for alerting me!)

## 1.2.1

Handle additional options: (Thanks @elbart!)
  * compressed
  * path\_as\_is
  * proxy

## 1.2.0

Handle hurl v3 http version syntax ("HTTP" instead of "HTTP/*")

### 1.1.2

New line handling fixes.

### 1.1.1

Support for all front page hurl.dev examples.

### 1.1.0

Colorize output of hurl in vscode panel.

### 1.0.1

Update to tree-sitter-hurl to correct parsing issue with the http version token

### 1.0.0

Initial release of Hurl language extension.
