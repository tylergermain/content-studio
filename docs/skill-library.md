# AI Innovators skill library

On the **AI Innovators** floor, the former Docs shelf is labeled **Skill library**. Press E at it, or choose **Skill library** from the office menu. Other floors retain their docs shelves.

Search skill names and descriptions, filter by category, and read the instructions. The version selector shows each skill’s recent Git history, and **Compare with current** shows what changed. Admins can edit instructions, add a version note, and save a new version. **Restore this version** asks for confirmation and creates a new commit, preserving all earlier history. Members can browse and compare, but cannot edit or restore.

The library is a private Git repository at `<AI Innovators floor>/skill-library`, with entries under `skills/<id>/SKILL.md`. Current instructions are read from disk and previous versions from Git. The initial Studio import includes unique SKILL.md snapshots from Tyler’s custom skills, installed plugin skills, and the Studio’s installed skills, with identical copies deduplicated. The source paths and hashes are recorded in `catalog.json`. Supporting scripts and assets remain with the original installed packages. This library does not install skills or automatically deploy edits back into those packages.

Every save records a local Git commit. No remote is required or automatically configured. GitHub publishing is a separate setup choice. To add a skill, create a skill ID folder containing SKILL.md and commit it in the library repository. A `library-category` frontmatter field controls its category. Preserve any referenced support files in the installed skill package.

Edits require the expected current repository revision and a clean working tree. Concurrent or outside changes require reloading or resolving the uncommitted changes first. History can be viewed without changing the current version. Symlinked skill paths and arbitrary revision expressions are rejected. Keep credentials in their existing private configuration, never in a skill’s instructions or the library repository.
