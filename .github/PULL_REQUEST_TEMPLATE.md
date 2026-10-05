# Pull request

## What changed

<!-- One or two sentences. Link the issue if there is one. -->

## Checklist

- [ ] Commit messages follow [Conventional Commits](CONTRIBUTING.md#commits) (`type(scope): description`)
- [ ] Version bumped and `CHANGELOG.md` updated (`npm run version:patch`) if this change ships
- [ ] `npm run format:check && npm run lint && npm run typecheck && npm test` pass locally
- [ ] `cargo fmt --check`, `cargo clippy -D warnings` and `cargo test` pass if Rust changed
- [ ] `npm run bindings` committed together with any Rust type change
- [ ] New UI strings added to both `en.json` and `ru.json`
