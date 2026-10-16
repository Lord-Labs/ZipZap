# Supplemental upstream notices

Some published packages omit a license file. These files supply the upstream
notice from the package's recorded VCS revision. `sources.json` records provenance
and SHA-256. The selectors crate declares MPL-2.0; its notice uses Mozilla's
canonical MPL text and its exact crate source accompanies distribution.

is-reference and locate-character publish MIT in README/package metadata without
a separate copyright line or license text, including at their recorded npm
gitHead revisions. Their files preserve author attribution and supply the standard
MIT permission text without inventing a copyright owner/year.

The generator also reuses the parent rolldown/Tauri CLI notices for their matching
platform binding packages. All other collected notices come from locked package
contents. This directory is not a relicense of any dependency.
