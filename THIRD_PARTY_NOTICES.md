# Third-party dependencies

ZipZap's own code is MIT-licensed. Dependencies retain their own licenses. This
file records the direct dependencies currently introduced for repository tooling
and the feasibility experiment; it is not a complete binary distribution notice.

| Direct dependency                                                    | Version | Upstream license metadata | Use                        |
| -------------------------------------------------------------------- | ------- | ------------------------- | -------------------------- |
| [Prettier](https://github.com/prettier/prettier/blob/3.9.10/LICENSE) | 3.9.10  | MIT                       | Repository formatting      |
| [reqwest](https://crates.io/crates/reqwest/0.13.5)                   | 0.13.5  | MIT OR Apache-2.0         | Experimental HTTP client   |
| [Tokio](https://crates.io/crates/tokio/1.53.3)                       | 1.53.3  | MIT                       | Experimental async runtime |

`Cargo.lock` and `package-lock.json` pin transitive versions and integrity data.
Review transitive licensing and advisories and preserve actual required license
texts/notices before shipping binaries in milestone M5. Direct dependency
metadata alone is not a completed distribution review.

aria2 1.37.0 is an optional locally acquired comparison tool, not a bundled
dependency. Its [upstream license](https://github.com/aria2/aria2/blob/release-1.37.0/COPYING)
is GPL-2.0-or-later according to its README. If a future decision bundles or links
it, review the applicable source and redistribution obligations separately;
ZipZap's MIT license does not cover aria2 or resolve that review.
