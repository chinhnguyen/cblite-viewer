# Specifications

This directory captures the intended behavior, implementation contracts, and development workflow for CBLite Viewer.

Start here:

- `cblite-viewer.md`: product and implementation specification.
- `cblite-cli-contract.md`: `cblite` command shapes, parsing assumptions, fallbacks, and upgrade behavior.
- `tree-state.md`: Databases tree node model, cache state, search placement, and `getParent` requirements.
- `testing.md`: manual regression checklist for local Cursor testing.
- `release.md`: compile, package, local install, and release notes.
- `decisions.md`: rationale for key architectural and UX choices.

Keep specs close to implementation changes. When behavior changes, update the relevant spec in the same pull request or follow-up documentation commit.
