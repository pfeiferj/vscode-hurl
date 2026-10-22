# Hurl

Syntax highlighting and editing support for [Hurl](https://hurl.dev) files in VS Code.

This is an unofficial extension. Visit <https://hurl.dev> for more information
about the Hurl project.

## Features

- Syntax highlighting for `.hurl` files, including variables, assertions, and
  embedded JSON, XML, and GraphQL in language-tagged blocks.
- Code folding for requests, responses, sections, and bodies.
- JSON and XML indentation with Format Document, Format Selection, and as you type.
  Formatting adjusts indentation only; it does not reflow content.
- Context-aware comments: `#` for Hurl and `<!-- ... -->` for XML.
  Use `Ctrl+/` (`Cmd+/` on macOS).
- Automatic bracket pairs and clickable HTTP(S) request URLs.

Open a `.hurl` file to get started. This extension provides editor support only;
it does not run or validate Hurl requests.

## Requirements

VS Code **1.96.0 or newer**. No Hurl installation or other external dependencies
are required.

Syntax highlighting is enabled by default. If it is missing, check that
`editor.semanticHighlighting.enabled` is not disabled for Hurl in your settings.

## Release Notes

See [CHANGELOG.md](CHANGELOG.md).
